/* Peovala scheduling engine v2
   Erlang C staffing, date-range forecasting, automatic shift scheduling with locked shifts,
   labour rules, coverage reporting, re-forecasting, adherence simulation, history forecasting.
   Pure functions: runs in the browser and in Node. */
(function (root) {
  const E = {};
  E.DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  E.INT_SEC = 900;
  E.ACT = {
    B: { name: 'Break', paid: true },
    L: { name: 'Lunch', paid: false },
    M: { name: 'Meeting', paid: true },
    T: { name: 'Training', paid: true },
    C: { name: 'Coaching', paid: true },
    O: { name: 'Offline work', paid: true },
    X: { name: 'Time off (part day)', paid: false }
  };
  // Absence catalogue. pto = paid time off; planned = booked in advance; leave = deducts annual leave
  E.ABS_INFO = {
    VAC: { name: 'Vacation', pto: true, paid: true, planned: true, leave: true },
    PER: { name: 'Personal day', pto: true, paid: true, planned: true },
    HOL: { name: 'Public holiday (individual)', pto: true, paid: true, planned: true },
    BRV: { name: 'Bereavement', pto: true, paid: true },
    SICK: { name: 'Sick leave (paid)', pto: true, paid: true },
    DOC: { name: 'Doctor appointment', pto: true, paid: true, planned: true },
    UNP: { name: 'Unpaid leave', pto: false, paid: false, planned: true },
    PAR: { name: 'Parental leave', pto: false, paid: false, planned: true },
    CHS: { name: 'Child sick (unpaid)', pto: false, paid: false },
    NS: { name: 'No-show (unexcused)', pto: false, paid: false },
    SUS: { name: 'Suspension', pto: false, paid: false },
    TRN: { name: 'Training day', pto: false, paid: true, planned: true, work: true },
    BT: { name: 'Business trip', pto: false, paid: true, planned: true, work: true }
  };
  E.ABS = {}; Object.entries(E.ABS_INFO).forEach(([k, v]) => (E.ABS[k] = v.name));
  E.absCat = k => { const i = E.ABS_INFO[k]; return !i ? 'other' : i.work ? 'work' : i.pto ? 'pto' : 'npto'; };
  E.actPaid = x => x.t === 'X' ? !!(E.ABS_INFO[x.k] || {}).paid : E.ACT[x.t] ? E.ACT[x.t].paid : true;

  /* ---------- time tracking (punches) ---------- */
  // events for one agent-day: [{t: minute from midnight, code}] with code LOGIN, LOGOUT or a time code
  E.TIME_CODES = {
    PROD: { name: 'Production', paid: true, billable: true },
    BREAK: { name: 'Break', paid: true, billable: false },
    MEAL: { name: 'Meal', paid: false, billable: false },
    MEET: { name: 'Meeting', paid: true, billable: false },
    TRB: { name: 'Training (billable)', paid: true, billable: true },
    TRN: { name: 'Training (non-billable)', paid: true, billable: false },
    COACH: { name: 'Coaching', paid: true, billable: false }
  };
  E.PUNCH_CODES = ['LOGIN', 'LOGOUT'].concat(Object.keys(E.TIME_CODES));
  E.daySegments = function (events, endMin) {
    const ev = (events || []).slice().sort((a, b) => a.t - b.t || (a.code === 'LOGIN' ? -1 : 0)), segs = [];
    let cur = null, from = 0;
    const close = t => { if (cur && t > from) segs.push({ code: cur, from, to: t }); };
    ev.forEach(e => {
      if (e.t > endMin) return;
      if (e.code === 'LOGIN') { if (!cur) { cur = 'PROD'; from = e.t; } return; }
      if (e.code === 'LOGOUT') { close(e.t); cur = null; return; }
      if (!E.TIME_CODES[e.code]) return;
      close(e.t); cur = e.code; from = e.t;
    });
    if (cur) close(endMin);
    return { segs, open: cur, openFrom: cur ? from : null };
  };
  E.daySummary = function (events, endMin) {
    const { segs, open, openFrom } = E.daySegments(events, endMin), mins = {};
    Object.keys(E.TIME_CODES).forEach(k => (mins[k] = 0));
    let paid = 0, billable = 0, unpaid = 0;
    segs.forEach(g => { const m = g.to - g.from, c = E.TIME_CODES[g.code]; mins[g.code] += m; if (c.paid) paid += m; else unpaid += m; if (c.billable) billable += m; });
    const ev = (events || []).filter(e => e.t <= endMin);
    const logins = ev.filter(e => e.code !== 'LOGOUT').map(e => e.t), outs = ev.filter(e => e.code === 'LOGOUT').map(e => e.t);
    return { segs, open, openFrom, mins, paid, billable, unpaid, login: logins.length ? Math.min(...logins) : null, logout: open ? null : (outs.length ? Math.max(...outs) : null) };
  };
  // what an agent should be doing at a minute, from the schedule
  E.expectedAt = function (w, minute, s) {
    if (!w) return 'OUT';
    const i = Math.floor((minute - s.openH * 60) / 15);
    const st = E.stateAt(w, i);
    return { OFF: 'OUT', PH: 'PROD', B: 'BREAK', L: 'MEAL', M: 'MEET', T: 'TRAIN', C: 'COACH', O: 'PROD', X: 'OUT' }[st] || 'PROD';
  };
  E.matches = (expected, actual) => expected === actual || (expected === 'TRAIN' && (actual === 'TRB' || actual === 'TRN')) || (expected === 'OUT' && actual === 'OUT');
  E.actualAt = function (segs, minute) { for (const g of segs) if (minute >= g.from && minute < g.to) return g.code; return 'OUT'; };
  // adherence from real punches, minute by minute up to endMin
  E.punchAdherence = function (w, events, s, endMin) {
    const { segs } = E.daySegments(events, endMin);
    if (!w) return { sched: 0, inAdh: 0, adh: null, late: 0, early: 0, conf: null, outSince: null };
    const st = s.openH * 60 + w.s * 15, en = st + w.len * 15, upto = Math.min(en, endMin);
    let sched = 0, inAdh = 0, outSince = null, schedPaid = 0, worked = 0;
    for (let m = st; m < upto; m++) {
      const exp = E.expectedAt(w, m, s), act = E.actualAt(segs, m);
      if (exp === 'OUT') continue;
      sched++;
      if (exp !== 'MEAL') schedPaid++;
      if (act !== 'OUT' && act !== 'MEAL') worked++;
      if (E.matches(exp, act)) { inAdh++; outSince = null; } else if (outSince == null) outSince = m;
    }
    if (outSince != null && upto < endMin) outSince = null;
    const first = segs.length ? segs[0].from : null, last = segs.length ? segs[segs.length - 1].to : null;
    return { sched, inAdh, adh: sched ? inAdh / sched : null, conf: schedPaid ? worked / schedPaid : null,
      late: first == null ? (endMin > st ? Math.min(endMin, en) - st : 0) : Math.max(0, first - st), early: last != null && endMin >= en && last < en - 1 ? en - last : 0, outSince };
  };
  // realistic punches that follow a shift with small deviations (demo data)
  E.simulatePunches = function (agent, iso, w, s, seed) {
    if (!w) return [];
    const r = E.rng(E.hash(agent.id + '|' + iso) ^ (seed || 1)), j = (a, b) => Math.round(a + r() * (b - a));
    if (r() < 0.012) return [];
    const st = s.openH * 60 + w.s * 15, en = st + w.len * 15, ev = [];
    const late = r() < 0.07 ? j(4, 22) : j(-6, 2);
    ev.push({ t: st + late, code: 'LOGIN' });
    const trainCode = E.hash(agent.id) % 3 === 0 ? 'TRN' : 'TRB';
    let last = st + late;
    w.acts.slice().sort((a, b) => a.at - b.at).forEach(x => {
      const code = { B: 'BREAK', L: 'MEAL', M: 'MEET', T: trainCode, C: 'COACH', O: null, X: 'OUT' }[x.t];
      if (code === null) return;
      let a = st + x.at * 15 + j(-2, 4); if (a <= last) a = last + 1;
      let b = a + x.len * 15 + (r() < 0.15 ? j(2, 9) : j(-1, 2));
      if (code === 'OUT') { ev.push({ t: a, code: 'LOGOUT' }); ev.push({ t: b, code: 'LOGIN' }); }
      else { ev.push({ t: a, code }); ev.push({ t: b, code: 'PROD' }); }
      last = b;
    });
    if (r() < 0.04) { const a = Math.max(last + 20, st + Math.floor(w.len * 15 * 0.7)); if (a + 15 < en - 10) { ev.push({ t: a, code: 'COACH' }); ev.push({ t: a + j(10, 20), code: 'PROD' }); } }
    const out = en + (r() < 0.06 ? j(-25, -6) : j(-3, 7));
    ev.push({ t: Math.max(out, last + 1), code: 'LOGOUT' });
    return ev.sort((a, b) => a.t - b.t);
  };
  E.minToLabel = m => m == null ? '–' : E.fmt(m);
  E.durLabel = m => { m = Math.round(m || 0); const h = Math.floor(m / 60), mm = m % 60; return h ? `${h} h ${String(mm).padStart(2, '0')} min` : `${mm} min`; };

  E.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  E.hash = function (str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  /* ---------- dates (ISO yyyy-mm-dd, UTC arithmetic) ---------- */
  E.parse = iso => { const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  E.valid = iso => /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) && !isNaN(E.parse(iso));
  E.addDays = (iso, n) => new Date(E.parse(iso) + n * 864e5).toISOString().slice(0, 10);
  E.dow = iso => (new Date(E.parse(iso)).getUTCDay() + 6) % 7;
  E.diffDays = (a, b) => Math.round((E.parse(b) - E.parse(a)) / 864e5);
  E.range = (a, b) => { const out = []; if (!E.valid(a) || !E.valid(b)) return out; for (let x = a; x <= b && out.length < 400; x = E.addDays(x, 1)) out.push(x); return out; };
  E.weekStart = iso => E.addDays(iso, -E.dow(iso));
  E.today = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); };
  E.nextMonday = () => { const t = E.today(); return E.addDays(t, 7 - E.dow(t)); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  E.fmtDate = (iso, withDow = true) => { if (!E.valid(iso)) return ''; const d = new Date(E.parse(iso)); return (withDow ? E.DAYS[E.dow(iso)] + ' ' : '') + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
  E.fmtDateY = iso => { if (!E.valid(iso)) return ''; const d = new Date(E.parse(iso)); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };

  E.defaultSettings = () => {
    const start = E.nextMonday();
    return {
      openH: 7, closeH: 22,
      slTarget: 0.8, slSeconds: 20, maxOcc: 0.88,
      shrinkage: 0.12,
      daysPerWeek: 5, maxConsec: 6,
      startStep: 2, minRestH: 11,
      lunchMin: 30, lunchAfterPaidH: 6,
      breakMin: 15, breakEveryPaidH: 4,
      minGapMin: 60, consistency: 0.15,
      periodStart: start, periodEnd: E.addDays(start, 13),
      autoApproveTimeOff: true, annualLeaveDays: 30, timezone: 'Europe/Berlin',
      maxPeriodDays: 42
    };
  };
  E.defaultSpecials = (start) => {
    const y = +start.slice(0, 4);
    const list = [
      { date: y + '-12-24', name: 'Christmas Eve', factor: 0.6 },
      { date: y + '-12-25', name: 'Christmas Day', factor: 0 },
      { date: y + '-12-26', name: 'Boxing Day', factor: 0 },
      { date: y + '-12-31', name: "New Year's Eve", factor: 0.5 },
      { date: (y + 1) + '-01-01', name: "New Year's Day", factor: 0 },
      { date: y + '-11-01', name: 'All Saints’ Day (NRW)', factor: 0 },
      { date: E.addDays(start, 3), name: 'Monthly invoice run', factor: 1.25, queue: 'BIL' },
      { date: E.addDays(start, 8), name: 'Autumn promotion launch', factor: 1.35, queue: 'SAL' }
    ];
    return list.sort((a, b) => a.date < b.date ? -1 : 1);
  };

  E.nInt = s => (s.closeH - s.openH) * 4;
  E.fmt = min => { min = Math.round(min); const h = Math.floor(min / 60), m = ((min % 60) + 60) % 60; return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
  E.idxToMin = (i, s) => s.openH * 60 + i * 15;
  E.parseTime = t => { if (t == null || t === '') return null; const m = String(t).trim().match(/^(\d{1,2})(?::(\d{2}))?/); if (!m) return null; return (+m[1]) * 60 + (+(m[2] || 0)); };

  /* ---------- Erlang C ---------- */
  E.agentsNeeded = function (calls, aht, s) {
    if (!(calls > 0.0001) || !(aht > 0)) return 0;
    const A = calls * aht / E.INT_SEC, T = s.slSeconds, target = s.slTarget, maxOcc = s.maxOcc;
    let B = 1;
    for (let k = 1; k < 20000; k++) {
      B = A * B / (k + A * B);
      if (k > A) {
        const C = k * B / (k - A * (1 - B));
        const sl = 1 - C * Math.exp(-(k - A) * T / aht);
        if (sl >= target && A / k <= maxOcc) return k;
      }
    }
    return Math.ceil(A / maxOcc);
  };
  E.erlang = function (calls, aht, N, T) {
    const A = calls * aht / E.INT_SEC; if (N <= A) return { sl: 0, asa: Infinity, occ: 1, C: 1 };
    let B = 1; for (let k = 1; k <= N; k++) B = A * B / (k + A * B);
    const C = N * B / (N - A * (1 - B));
    return { sl: Math.max(0, 1 - C * Math.exp(-(N - A) * T / aht)), asa: C * aht / (N - A), occ: A / N, C };
  };
  function slInt(A, k, T, aht) {
    if (k <= 0 || k <= A) return 0;
    let B = 1; for (let j = 1; j <= k; j++) B = A * B / (j + A * B);
    const C = k * B / (k - A * (1 - B));
    return Math.max(0, Math.min(1, 1 - C * Math.exp(-(k - A) * T / aht)));
  }
  E.slFor = function (calls, aht, agents, T) {
    if (!(calls > 0.0001)) return 1;
    if (agents <= 0) return 0;
    const A = calls * aht / E.INT_SEC, lo = Math.floor(agents), f = agents - lo;
    const a = slInt(A, lo, T, aht); if (f < 1e-6) return a;
    return a + (slInt(A, lo + 1, T, aht) - a) * f;
  };

  /* ---------- Forecast ---------- */
  function gauss(x, mu, sd) { return Math.exp(-0.5 * ((x - mu) / sd) ** 2); }
  E.SHAPES = {
    standard: [[10.5, 1.6, 1.0], [14.5, 2.0, 0.85], [19, 1.5, 0.3]],
    technical: [[11, 2.2, 1.0], [15.5, 2.4, 0.9], [19.5, 1.5, 0.35]],
    sales: [[12, 2.0, 0.8], [18, 2.0, 1.0]],
    premium: [[10, 1.8, 1.0], [14, 2.2, 0.8]],
    flat: []
  };
  E.shape = function (type, s, weekend) {
    const n = E.nInt(s), out = new Array(n), peaks = E.SHAPES[type] || E.SHAPES.standard;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const h = s.openH + (i + 0.5) / 4; let w = 0.12;
      for (const [mu, sd, amp] of peaks) w += amp * gauss(h, mu + (weekend ? 1 : 0), sd * (weekend ? 1.2 : 1));
      out[i] = w; sum += w;
    }
    return out.map(v => v / sum);
  };
  E.defaultQueues = () => ([
    { id: 'BIL', name: 'Billing', aht: 300, weekly: 60000, shape: 'standard', dayShare: [0.18, 0.165, 0.155, 0.15, 0.145, 0.115, 0.09], mix: 0.34, growth: 0.04 },
    { id: 'TEC', name: 'Technical Support', aht: 480, weekly: 35000, shape: 'technical', dayShare: [0.175, 0.16, 0.155, 0.15, 0.15, 0.115, 0.095], mix: 0.30, growth: 0.08 },
    { id: 'SAL', name: 'Sales', aht: 360, weekly: 30000, shape: 'sales', dayShare: [0.15, 0.15, 0.15, 0.15, 0.16, 0.135, 0.105], mix: 0.21, growth: 0.02 },
    { id: 'PRE', name: 'Premium (EN/FR/AR)', aht: 420, weekly: 15000, shape: 'premium', dayShare: [0.17, 0.16, 0.16, 0.155, 0.15, 0.115, 0.09], mix: 0.15, growth: 0.1 }
  ]);
  E.dayFactor = (q, iso, specials) => {
    let f = 1;
    (specials || []).forEach(sp => { if (sp.date === iso && (!sp.queue || sp.queue === q.id)) f *= sp.factor; });
    return f;
  };
  E.queueCalls = function (q, s, days, specials, scen) {
    const n = E.nInt(s), wk = E.shape(q.shape, s, false), we = E.shape(q.shape, s, true);
    const tot = q.dayShare.reduce((a, b) => a + b, 0) || 1, vf = scen ? scen.vol : 1;
    return days.map(iso => {
      const f = E.dayFactor(q, iso, specials) * vf, dw = E.dow(iso);
      if (q.override && q.override[iso]) return pad(q.override[iso], n).map(v => v * vf);
      if (q.overrideDow && q.overrideDow[dw]) return pad(q.overrideDow[dw], n).map(v => v * f);
      const dv = q.weekly * q.dayShare[dw] / tot * f, sh = dw >= 5 ? we : wk;
      return sh.map(w => dv * w);
    });
  };
  function pad(arr, n) { const o = new Array(n).fill(0); for (let i = 0; i < n && i < arr.length; i++) o[i] = +arr[i] || 0; return o; }

  E.computeRequirements = function (queues, s, days, specials, scen) {
    const keep = 1 - s.shrinkage;
    return queues.map(q => {
      const aht = q.aht * (scen ? scen.aht : 1);
      const calls = E.queueCalls(q, s, days, specials, scen);
      const N = calls.map(day => day.map(c => E.agentsNeeded(c, aht, s)));
      const req = N.map(day => day.map(v => v / keep));
      return { calls, N, req, aht };
    });
  };

  /* ---------- History & forecasting ---------- */
  // daily totals for `weeks` weeks before `start`
  E.genHistory = function (q, s, start, weeks, seed, specials) {
    const r = E.rng(seed), out = [], tot = q.dayShare.reduce((a, b) => a + b, 0) || 1;
    const g = q.growth || 0;
    for (let k = weeks * 7; k >= 1; k--) {
      const iso = E.addDays(start, -k), dw = E.dow(iso), wAgo = k / 7;
      const trend = Math.pow(1 + g, -wAgo / 52 * 4); // growth expressed per ~quarter in demo
      const v = q.weekly * q.dayShare[dw] / tot * trend * (0.93 + r() * 0.14) * E.dayFactor(q, iso, specials);
      out.push({ date: iso, calls: Math.round(v), aht: Math.round(q.aht * (0.95 + r() * 0.1)) });
    }
    return out;
  };
  // returns {weekly, dayShare, mape, method}
  E.fitForecast = function (hist, method, nWeeks) {
    nWeeks = Math.max(2, Math.min(nWeeks || 6, Math.floor(hist.length / 7)));
    const fit = (h) => {
      const recent = h.slice(-nWeeks * 7);
      const byDow = [[], [], [], [], [], [], []];
      recent.forEach((x, i) => byDow[E.dow(x.date)].push({ v: x.calls, w: 1 + Math.floor(i / 7) }));
      let dayVals;
      if (method === 'wma') dayVals = byDow.map(a => { const sw = a.reduce((t, x) => t + x.w, 0); return a.reduce((t, x) => t + x.v * x.w, 0) / (sw || 1); });
      else dayVals = byDow.map(a => a.reduce((t, x) => t + x.v, 0) / (a.length || 1));
      let weekly = dayVals.reduce((a, b) => a + b, 0);
      if (method === 'trend') {
        const weeksTot = []; for (let w = 0; w < Math.floor(h.length / 7); w++) weeksTot.push(h.slice(w * 7, w * 7 + 7).reduce((t, x) => t + x.calls, 0));
        const m = weeksTot.length, xs = weeksTot.map((_, i) => i), mx = (m - 1) / 2, my = weeksTot.reduce((a, b) => a + b, 0) / m;
        let num = 0, den = 0; xs.forEach((x, i) => { num += (x - mx) * (weeksTot[i] - my); den += (x - mx) ** 2; });
        const slope = den ? num / den : 0; weekly = my + slope * (m - mx);
      }
      const sum = dayVals.reduce((a, b) => a + b, 0) || 1;
      return { weekly, dayShare: dayVals.map(v => v / sum) };
    };
    // backtest: last 2 weeks
    let mape = null;
    if (hist.length >= (nWeeks + 2) * 7) {
      const train = hist.slice(0, -14), test = hist.slice(-14), f = fit(train);
      let err = 0, c = 0;
      test.forEach(x => { if (x.calls > 0) { const p = f.weekly * f.dayShare[E.dow(x.date)]; err += Math.abs(p - x.calls) / x.calls; c++; } });
      mape = c ? err / c : null;
    }
    const f = fit(hist);
    return { weekly: Math.round(f.weekly), dayShare: f.dayShare, mape, method, nWeeks };
  };

  /* ---------- Agents ---------- */
  const FIRST = ['Lena', 'Jonas', 'Mia', 'Leon', 'Emma', 'Paul', 'Hannah', 'Felix', 'Sophie', 'Lukas', 'Amira', 'Omar', 'Layla', 'Yusuf', 'Fatima', 'Karim', 'Elif', 'Emre', 'Zeynep', 'Mehmet', 'Chloé', 'Lucas', 'Camille', 'Hugo', 'Inès', 'Noah', 'Sara', 'David', 'Laura', 'Daniel', 'Julia', 'Tim', 'Anna', 'Max', 'Nina', 'Ali', 'Rania', 'Samir', 'Olga', 'Piotr', 'Marta', 'Ivan', 'Giulia', 'Marco', 'Elena', 'Tobias', 'Katrin', 'Sven', 'Aylin', 'Nour'];
  const LAST = ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Schwarz', 'Yilmaz', 'Kaya', 'Demir', 'Şahin', 'Haddad', 'Khalil', 'Mansour', 'Nasser', 'Dubois', 'Martin', 'Bernard', 'Laurent', 'Kowalski', 'Nowak', 'Rossi', 'Bianchi', 'Popescu', 'Ivanova', 'Krüger', 'Lange', 'Braun', 'Zimmermann', 'Hartmann', 'Schulz', 'Krause'];
  const SITES = ['Essen', 'Essen', 'Dortmund', 'Remote'];

  E.generateAgents = function (count, queues, s, seed) {
    const r = E.rng(seed || 42), agents = [];
    const mixTot = queues.reduce((a, q) => a + (q.mix || 1), 0);
    const days = E.range(s.periodStart, s.periodEnd);
    let idx = 0;
    queues.forEach((q, qi) => {
      const n = qi === queues.length - 1 ? count - idx : Math.round(count * (q.mix || 1) / mixTot);
      for (let k = 0; k < n; k++) {
        const x = r();
        const hours = x < 0.68 ? 40 : x < 0.88 ? 30 : 20;
        let earliest = s.openH * 60, latest = s.closeH * 60;
        const y = r();
        if (hours === 20 && y < 0.45) latest = 14 * 60;
        else if (y < 0.14) latest = 17 * 60;
        else if (y < 0.24) earliest = 12 * 60;
        const fixedOff = []; const z = r();
        if (z < 0.08) fixedOff.push(5, 6); else if (z < 0.2) fixedOff.push(6);
        const absence = {};
        if (r() < 0.12 && days.length) { const d0 = Math.floor(r() * days.length), len = 1 + Math.floor(r() * 5); for (let j = 0; j < len && d0 + j < days.length; j++) absence[days[d0 + j]] = r() < 0.8 ? 'VAC' : 'TRN'; }
        if (r() < 0.03 && days.length) absence[days[Math.floor(r() * days.length)]] = 'SICK';
        const skills = []; if (r() < 0.25) { const o = queues[(qi + 1 + Math.floor(r() * (queues.length - 1))) % queues.length]; if (o.id !== q.id) skills.push(o.id); }
        idx++;
        const teamNo = Math.floor(k / 15) + 1;
        agents.push({
          id: 'A' + String(idx).padStart(4, '0'),
          name: FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)],
          team: q.id + '-T' + String(teamNo).padStart(2, '0'),
          site: SITES[Math.floor(r() * SITES.length)],
          queue: q.id, skills, hours, earliest, latest,
          fixedOff, absence, leaveUsed: Math.floor(r() * 18), shifts: {}
        });
      }
    });
    return agents;
  };

  E.shiftSpec = function (agent, s) {
    const paidMin = Math.round(agent.hours / s.daysPerWeek * 60);
    const lunch = paidMin / 60 > s.lunchAfterPaidH ? s.lunchMin : 0;
    const breaks = Math.floor(paidMin / 60 / s.breakEveryPaidH);
    const len = Math.ceil((paidMin + lunch) / 15);
    const lunchInt = Math.ceil(lunch / 15), breakInt = Math.ceil(s.breakMin / 15);
    return { paidMin, len, lunchInt, breaks, breakInt, onPhoneInt: len - lunchInt - breaks * breakInt };
  };
  E.defaultActs = function (agent, s, len) {
    const sp = E.shiftSpec(agent, s), list = [];
    for (let b = 0; b < sp.breaks; b++) list.push({ t: 'B', len: sp.breakInt });
    if (sp.lunchInt) list.splice(Math.floor(list.length / 2), 0, { t: 'L', len: sp.lunchInt });
    return list.map((x, j) => ({ t: x.t, len: x.len, at: Math.max(0, Math.min(len - x.len, Math.round((j + 1) / (list.length + 1) * len - x.len / 2))) }));
  };
  E.paidInt = w => w.len - w.acts.filter(x => !E.actPaid(x)).reduce((t, x) => t + x.len, 0);
  E.onPhoneInt = w => w.len - w.acts.reduce((t, x) => t + x.len, 0);

  function onPhoneHours(agent, s) {
    const sp = E.shiftSpec(agent, s);
    return Math.min(sp.days || s.daysPerWeek, 7 - (agent.fixedOff || []).length) * sp.onPhoneInt / 4;
  }
  // scale demo volumes so a standard week fits the workforce
  E.calibrate = function (queues, agents, s, fill) {
    const wk = E.range(E.weekStart(s.periodStart), E.addDays(E.weekStart(s.periodStart), 6));
    queues.forEach(q => {
      const cap = agents.filter(a => a.queue === q.id).reduce((t, a) => t + onPhoneHours(a, s), 0) * (1 - 0.06);
      if (!cap) return;
      for (let it = 0; it < 5; it++) {
        const R = E.computeRequirements([q], s, wk, [])[0];
        let h = 0; R.req.forEach(d => d.forEach(v => (h += v / 4)));
        if (!h) break;
        q.weekly = Math.round(q.weekly * (cap * fill) / h);
      }
    });
  };

  /* ---------- Scheduler ---------- */
  // Builds shifts for every unlocked day in `days`. Returns {shifts: [ {iso: shift} per agent ], warnings}
  /* opts (all optional):
     frozen: Set of agent indices kept exactly as they are (outside the build scope)
     dayRule(ai, k): null | {off:true} | {work:true, lo, hi (start window, interval index), at (exact start), len, label}  -- rotations
     weekend: 'off' | 'fair' | 'alternate';  pairOff: keep days off together;  maxLate: late shifts per week (0 = no limit)
     pref(ai): {band:[lo,hi], off:[dow], w}  -- agent preferences;  ot: {maxInt, allowed(ai), maxLen(ai), min}  -- overtime to close gaps */
  E.buildSchedule = function (agents, queues, s, R, days, seed, opts) {
    const o = opts || {}, frozen = o.frozen || null;
    const n = E.nInt(s), r = E.rng(seed || 7), step = Math.max(1, s.startStep | 0), D = days.length;
    const lateIdx = Math.round((12 * 60 - s.openH * 60) / 15), stats = { otInt: 0, bandFallback: 0, prefMet: 0, prefN: 0 };
    const out = agents.map(() => ({})), warnings = [];
    const gapInt = Math.round(s.minGapMin / 15), maxC = s.maxConsec || 6, rest = s.minRestH * 60;
    const segs = [];
    days.forEach((d, k) => { const ws = E.weekStart(d); if (!segs.length || segs[segs.length - 1].ws !== ws) segs.push({ ws, ks: [] }); segs[segs.length - 1].ks.push(k); });
    const absMin = k => k * 1440 + s.openH * 60; // minutes from period start (day 0, 00:00)
    const prevDay = E.addDays(days[0], -1);
    const segOf = []; segs.forEach((g, gi) => g.ks.forEach(k => (segOf[k] = gi)));

    queues.forEach((q, qi) => {
      const req = R[qi].req, members = [];
      agents.forEach((a, ai) => { if (a.queue === q.id) members.push(ai); });
      if (!members.length) return;
      const meta = {};
      members.forEach(ai => {
        const a = agents[ai], sp = E.shiftSpec(a, s), sh = a.shifts || {};
        let lo = Math.max(0, Math.ceil(((a.earliest ?? s.openH * 60) - s.openH * 60) / 15));
        let hi = Math.min(n, Math.floor(((a.latest ?? s.closeH * 60) - s.openH * 60) / 15));
        if (hi - lo < sp.len) { warnings.push(`${a.id} ${a.name}: availability window is shorter than a ${sp.len / 4} h shift; window extended`); hi = Math.min(n, lo + sp.len); lo = Math.max(0, hi - sp.len); }
        const isFrozen = !!(frozen && frozen.has(ai));
        const rr = !isFrozen && o.dayRule ? days.map((d, k) => o.dayRule(ai, k)) : null, rules = rr && rr.some(Boolean) ? rr : null;
        const locked = days.map(d => (sh[d] && (sh[d].locked || isFrozen)) ? sh[d] : null);
        const blocked = days.map((d, k) => isFrozen || !!(a.absence && a.absence[d]) || (!rules && (a.fixedOff || []).includes(E.dow(d))) || !!(rules && rules[k] && rules[k].off));
        const work = locked.map(Boolean);
        const ends = locked.map((l, k) => l ? absMin(k) + (l.s + l.len) * 15 : null);
        let before = 0; for (let j = 1; j <= maxC; j++) { if (sh[E.addDays(days[0], -j)]) before++; else break; }
        const pw = sh[prevDay]; const prevEndOut = pw ? -1440 + s.openH * 60 + (pw.s + pw.len) * 15 : null;
        const ws0 = E.weekStart(days[0]), prevWE = !!(sh[E.addDays(ws0, -1)] || sh[E.addDays(ws0, -2)]);
        meta[ai] = { sp, lo, hi, locked, blocked, work, ends, before, prevEndOut, anchor: null, frozen: isFrozen, rules, rot: !!(rules && rules.some(Boolean)), pref: o.pref ? o.pref(ai) : null, wkEnd: 0, prevWE, late: {} };
      });

      /* 1. working days per calendar week, matched to workload and the consecutive-day limit */
      const demand = req.map(day => day.reduce((t, v) => t + v, 0) / 4);
      const assigned = new Array(D).fill(0);
      members.forEach(ai => meta[ai].locked.forEach((l, k) => { if (l) assigned[k] += E.onPhoneInt(l) / 4; }));
      // rotation agents work exactly the days their pattern says (absences and locked days excepted)
      members.forEach(ai => { const m = meta[ai]; if (!m.rot) return; m.rules.forEach((ru, k) => { if (ru && ru.work && !m.blocked[k] && !m.locked[k]) { m.work[k] = true; assigned[k] += m.sp.onPhoneInt / 4; } }); });
      const avgD = demand.reduce((t, v) => t + v, 0) / (D || 1) || 1;
      const order = members.slice().sort(() => r() - 0.5)
        .sort((x, y) => meta[x].blocked.filter(b => !b).length - meta[y].blocked.filter(b => !b).length || agents[y].hours - agents[x].hours);
      const run = (m, k) => {
        let L = 1, j = k - 1; while (j >= 0 && m.work[j]) { L++; j--; } if (j < 0) L += m.before;
        j = k + 1; while (j < D && m.work[j]) { L++; j++; } return L;
      };
      order.forEach(ai => {
        const m = meta[ai], a = agents[ai], h = m.sp.onPhoneInt / 4;
        if (m.rot || m.frozen) return;
        segs.forEach(seg => {
          const L = seg.ks.length;
          let want = Math.round((m.sp.days || s.daysPerWeek) * L / 7);
          want -= seg.ks.filter(k => a.absence && a.absence[days[k]]).length;
          want -= seg.ks.filter(k => m.locked[k]).length;
          if (want <= 0) return;
          const pool = seg.ks.filter(k => !m.blocked[k] && !m.locked[k] && demand[k] > 0.01);
          let got = 0;
          for (let t = 0; t < want && pool.length; t++) {
            let best = -1, bv = -Infinity;
            pool.forEach((k, j) => {
              if (run(m, k) > maxC) return;
              let v = (demand[k] - assigned[k]) / avgD + r() * 0.0005;
              const we = E.dow(days[k]) >= 5;
              if (we && o.weekend === 'fair') v -= 0.06 * m.wkEnd;
              if (we && o.weekend === 'alternate' && m.prevWE) v -= 0.6;
              if (o.pairOff) v += 0.03 * ((k > 0 && m.work[k - 1] ? 1 : 0) + (k < D - 1 && m.work[k + 1] ? 1 : 0));
              if (m.pref && m.pref.off && m.pref.off.includes(E.dow(days[k]))) v -= m.pref.w * 0.25;
              if (v > bv) { bv = v; best = j; }
            });
            if (best < 0) break;
            const k = pool.splice(best, 1)[0]; m.work[k] = true; assigned[k] += h; got++;
          }
          if (got < want && L === 7 && pool.length + got < want) warnings.push(`${a.id} ${a.name}: only ${got} of ${want} working days possible in week of ${E.fmtDate(seg.ws, false)}`);
          const wk = seg.ks.filter(k => E.dow(days[k]) >= 5 && m.work[k]).length; m.wkEnd += wk; if (seg.ks.some(k => E.dow(days[k]) >= 5)) m.prevWE = wk > 0;
        });
      });

      /* 2. shift start per day: greedy coverage fill, honouring rest periods on both sides */
      for (let k = 0; k < D; k++) {
        const cov = new Float64Array(n);
        members.forEach(ai => { const l = meta[ai].locked[k]; if (!l) return; for (let i = l.s; i < l.s + l.len && i < n; i++) cov[i] += 1; l.acts.forEach(x => { for (let j = 0; j < x.len; j++) { const p = l.s + x.at + j; if (p < n) cov[p] -= 1; } }); });
        const working = members.filter(ai => meta[ai].work[k] && !meta[ai].locked[k]);
        working.sort((x, y) => (meta[x].hi - meta[x].lo - meta[x].sp.len) - (meta[y].hi - meta[y].lo - meta[y].sp.len) || meta[y].sp.len - meta[x].sp.len);
        const P = new Float64Array(n + 1);
        const rebuild = () => { for (let i = 0; i < n; i++) P[i + 1] = P[i] + (req[k][i] - cov[i]); };
        rebuild();
        working.forEach(ai => {
          const m = meta[ai], ru = m.rules && m.rules[k], L = ru && ru.len ? ru.len : m.sp.len, w = Math.max(0, m.sp.onPhoneInt + L - m.sp.len) / L;
          let lo = m.lo, hi = m.hi - L;
          if (ru && ru.at != null) { lo = hi = Math.max(0, Math.min(n - L, ru.at)); }
          else if (ru && ru.lo != null) { const l2 = Math.max(lo, ru.lo), h2 = Math.min(hi, ru.hi); if (l2 <= h2) { lo = l2; hi = h2; } else { stats.bandFallback++; warnings.push(`${agents[ai].id} ${agents[ai].name}: ${E.fmtDate(days[k])} ${ru.label || 'rotation'} shift is outside their availability; nearest possible time used`); } }
          if (o.maxLate > 0 && !(ru && (ru.at != null || ru.lo != null)) && (m.late[segOf[k]] || 0) >= o.maxLate && lo <= lateIdx - 1) hi = Math.min(hi, lateIdx - 1);
          const prevEnd = k > 0 ? (m.work[k - 1] ? m.ends[k - 1] : null) : m.prevEndOut;
          if (prevEnd != null) lo = Math.max(lo, Math.ceil((prevEnd + rest - absMin(k)) / 15));
          if (k + 1 < D && m.locked[k + 1]) hi = Math.min(hi, Math.floor((absMin(k + 1) + m.locked[k + 1].s * 15 - rest - absMin(k)) / 15) - L);
          lo = Math.ceil(lo / step) * step;
          let breach = false;
          if (lo > hi) { breach = true; lo = Math.max(0, Math.min(n - L, hi)); hi = lo; }
          let bestS = lo, bestV = -Infinity;
          for (let st = lo; st <= hi; st += step) {
            let v = P[st + L] - P[st];
            if (m.anchor != null && !(ru && ru.lo != null)) v -= s.consistency * Math.abs(st - m.anchor);
            if (m.pref && m.pref.band) { const [bl, bh] = m.pref.band; v -= m.pref.w * 2 * (st < bl ? bl - st : st > bh ? st - bh : 0); }
            if (v > bestV) { bestV = v; bestS = st; }
          }
          if (m.pref && m.pref.band) { stats.prefN++; if (bestS >= m.pref.band[0] && bestS <= m.pref.band[1]) stats.prefMet++; }
          if (bestS >= lateIdx) m.late[segOf[k]] = (m.late[segOf[k]] || 0) + 1;
          if (breach) warnings.push(`${agents[ai].id} ${agents[ai].name}: ${E.fmtDate(days[k])} rest period below ${s.minRestH} h`);
          for (let i = bestS; i < bestS + L; i++) cov[i] += w;
          rebuild();
          out[ai][days[k]] = ru && ru.len && ru.len > m.sp.len ? { s: bestS, len: L, acts: [], ot: 0 } : { s: bestS, len: L, acts: [] };
          if (m.anchor == null && !(ru && (ru.lo != null || ru.at != null))) m.anchor = bestS;
          m.ends[k] = absMin(k) + (bestS + L) * 15;
        });
      }

      /* 3. breaks and lunch where the surplus is highest */
      for (let k = 0; k < D; k++) {
        const iso = days[k], cov = new Float64Array(n), plans = [];
        members.forEach(ai => {
          const l = meta[ai].locked[k], w = out[ai][iso];
          if (l) { for (let i = l.s; i < l.s + l.len && i < n; i++) cov[i] += 1; l.acts.forEach(x => { for (let j = 0; j < x.len; j++) { const p = l.s + x.at + j; if (p < n) cov[p] -= 1; } }); }
          if (w) {
            for (let i = w.s; i < w.s + w.len; i++) cov[i] += 1;
            const sp = meta[ai].sp, acts = [];
            for (let b = 0; b < sp.breaks; b++) acts.push({ t: 'B', len: sp.breakInt });
            if (sp.lunchInt) acts.splice(Math.floor(acts.length / 2), 0, { t: 'L', len: sp.lunchInt });
            acts.forEach((a, j) => (a.target = Math.round((j + 1) / (acts.length + 1) * w.len - a.len / 2)));
            plans.push({ sh: w, acts });
          }
        });
        plans.sort(() => r() - 0.5);
        ['L', 'B'].forEach(type => plans.forEach(pl => pl.acts.forEach((act, j) => {
          if (act.t !== type || act.at != null) return;
          const L = pl.sh.len;
          for (const g of [gapInt, Math.ceil(gapInt / 2), 0]) {
            let best = null, bv = -Infinity;
            const lo = Math.max(g, act.target - 4), hi = Math.min(L - g - act.len, act.target + 4);
            for (let p = lo; p <= hi; p++) {
              let ok = true;
              pl.acts.forEach((o, kk) => { if (kk === j || o.at == null) return; if (kk < j && p < o.at + o.len + g) ok = false; if (kk > j && p + act.len + g > o.at) ok = false; });
              if (!ok) continue;
              let v = 0; for (let i = 0; i < act.len; i++) { const x = pl.sh.s + p + i; v += cov[x] - req[k][x]; }
              v -= Math.abs(p - act.target) * 0.01;
              if (v > bv) { bv = v; best = p; }
            }
            if (best != null) { act.at = best; for (let i = 0; i < act.len; i++) cov[pl.sh.s + best + i] -= 1; break; }
          }
          if (act.at == null) act.at = Math.max(0, Math.min(L - act.len, act.target));
        })));
        plans.forEach(pl => { pl.sh.acts = pl.acts.map(a => ({ t: a.t, at: a.at, len: a.len })).sort((a, b) => a.at - b.at); });
      }

      /* 4. optional overtime: extend shifts into intervals that are still short, within availability, rest and contract limits */
      if (o.ot && o.ot.maxInt > 0) for (let k = 0; k < D; k++) {
        const iso = days[k], cov = new Float64Array(n), add = (w, sgn) => { for (let i = w.s; i < w.s + w.len && i < n; i++) cov[i] += sgn; w.acts.forEach(x => { for (let j = 0; j < x.len; j++) { const p = w.s + x.at + j; if (p < n) cov[p] -= sgn; } }); };
        members.forEach(ai => { const w = out[ai][iso] || meta[ai].locked[k]; if (w) add(w, 1); });
        const thr = o.ot.min ?? 0.5, cand = members.filter(ai => out[ai][iso] && (!o.ot.allowed || o.ot.allowed(ai))).sort(() => r() - 0.5);
        const shiftAt = (ai, kk) => kk < 0 || kk >= D ? null : (out[ai][days[kk]] || meta[ai].locked[kk]);
        for (let pass = 0; pass < o.ot.maxInt; pass++) {
          let grew = false;
          cand.forEach(ai => {
            const m = meta[ai], w = out[ai][iso], cap = o.ot.maxLen ? o.ot.maxLen(ai) : Infinity;
            if ((w.ot || 0) >= o.ot.maxInt || w.len >= cap) return;
            const e = w.s + w.len, nx = shiftAt(ai, k + 1), pv = shiftAt(ai, k - 1);
            const endOk = e < Math.min(n, m.hi) && req[k][e] - cov[e] >= thr && (!nx || absMin(k) + (e + 1) * 15 + rest <= absMin(k + 1) + nx.s * 15);
            const prevEnd = pv ? absMin(k - 1) + (pv.s + pv.len) * 15 : (k === 0 ? m.prevEndOut : null);
            const fixedStart = !!(m.rules && m.rules[k] && (m.rules[k].lo != null || m.rules[k].at != null));
            const stOk = !fixedStart && w.s - 1 >= m.lo && req[k][w.s - 1] - cov[w.s - 1] >= thr && (prevEnd == null || prevEnd + rest <= absMin(k) + (w.s - 1) * 15);
            if (endOk && (!stOk || req[k][e] - cov[e] >= req[k][w.s - 1] - cov[w.s - 1])) { w.len++; cov[e] += 1; }
            else if (stOk) { w.s--; w.len++; w.acts.forEach(x => (x.at += 1)); cov[w.s] += 1; }
            else return;
            w.ot = (w.ot || 0) + 1; stats.otInt++; grew = true;
          });
          if (!grew) break;
        }
      }
    });
    return { shifts: out, warnings, stats };
  };

  /* ---------- Rule checks for one agent ---------- */
  E.checkAgent = function (a, s, days) {
    const issues = [], n = E.nInt(s), rest = s.minRestH * 60, sh = a.shifts || {};
    let runLen = 0;
    const start = E.addDays(days[0], -1), list = E.range(start, days[days.length - 1]);
    let prev = null, prevIso = null;
    list.forEach(iso => {
      const w = sh[iso];
      if (!w) { runLen = 0; prev = null; return; }
      runLen++;
      if (days.includes(iso)) {
        if (runLen > (s.maxConsec || 6)) issues.push({ date: iso, rule: 'consec', text: `${E.fmtDate(iso)}: ${runLen} consecutive working days (max ${s.maxConsec})` });
        if (w.s < 0 || w.s + w.len > n) issues.push({ date: iso, rule: 'hours', text: `${E.fmtDate(iso)}: shift outside opening hours` });
        const st = s.openH * 60 + w.s * 15, en = st + w.len * 15;
        if (st < (a.earliest ?? 0) || en > (a.latest ?? 1440)) issues.push({ date: iso, rule: 'avail', text: `${E.fmtDate(iso)}: ${E.fmt(st)}–${E.fmt(en)} is outside availability ${E.fmt(a.earliest)}–${E.fmt(a.latest)}` });
        if (a.absence && a.absence[iso]) issues.push({ date: iso, rule: 'absence', text: `${E.fmtDate(iso)}: scheduled during ${E.ABS[a.absence[iso]] || 'absence'}` });
        if (prev && prevIso === E.addDays(iso, -1)) {
          const gap = 1440 + (s.openH * 60 + w.s * 15) - (s.openH * 60 + (prev.s + prev.len) * 15);
          if (gap < rest) issues.push({ date: iso, rule: 'rest', text: `${E.fmtDate(iso)}: only ${(gap / 60).toFixed(1)} h rest before shift (min ${s.minRestH} h)` });
        }
        const acts = w.acts.slice().sort((x, y) => x.at - y.at);
        for (let i = 1; i < acts.length; i++) if (acts[i].at < acts[i - 1].at + acts[i - 1].len) issues.push({ date: iso, rule: 'overlap', text: `${E.fmtDate(iso)}: overlapping activities` });
        if (acts.some(x => x.at < 0 || x.at + x.len > w.len)) issues.push({ date: iso, rule: 'act', text: `${E.fmtDate(iso)}: activity outside the shift` });
      }
      prev = w; prevIso = iso;
    });
    // weekly hours vs contract
    const weeks = {};
    days.forEach(iso => { const ws = E.weekStart(iso); weeks[ws] = weeks[ws] || { paid: 0, n: 0, worked: 0, abs: 0 }; weeks[ws].n++; const w = sh[iso]; if (w) { weeks[ws].paid += E.paidInt(w) / 4; weeks[ws].worked++; } if (a.absence && a.absence[iso] && (E.ABS_INFO[a.absence[iso]] || {}).paid) weeks[ws].abs++; });
    // paid absence credits at most the contract days not worked that week
    Object.values(weeks).forEach(v => { v.paid += Math.min(v.abs, Math.max(0, s.daysPerWeek - v.worked)) * a.hours / s.daysPerWeek; });
    Object.entries(weeks).forEach(([ws, v]) => { if (v.n === 7 && v.paid > a.hours + 4) issues.push({ date: ws, rule: 'hoursmax', text: `Week of ${E.fmtDate(ws, false)}: ${v.paid.toFixed(1)} h paid, contract ${a.hours} h` }); });
    return issues;
  };

  /* ---------- Coverage & reporting ---------- */
  E.netCoverage = function (agents, queues, s, days) {
    const n = E.nInt(s), qIndex = {}, D = days.length;
    queues.forEach((q, i) => (qIndex[q.id] = i));
    const net = queues.map(() => Array.from({ length: D }, () => new Float64Array(n)));
    const sched = queues.map(() => Array.from({ length: D }, () => new Float64Array(n)));
    agents.forEach(a => {
      const qi = qIndex[a.queue]; if (qi == null || !a.shifts) return;
      for (let k = 0; k < D; k++) {
        const w = a.shifts[days[k]]; if (!w) continue;
        const N = net[qi][k], S = sched[qi][k];
        for (let i = Math.max(0, w.s); i < w.s + w.len && i < n; i++) { N[i] += 1; S[i] += 1; }
        for (const x of w.acts) for (let j = 0; j < x.len; j++) { const p = w.s + x.at + j; if (p >= 0 && p < n) N[p] -= 1; }
      }
    });
    return { net, sched };
  };
  E.dayStats = function (calls, aht, req, net, s) {
    const n = calls.length, keep = 1 - s.shrinkage;
    let c = 0, slw = 0, reqH = 0, netH = 0, over = 0, under = 0, underInt = 0, occNum = 0, occDen = 0;
    const sl = new Array(n);
    for (let i = 0; i < n; i++) {
      const avail = net[i] * keep;
      sl[i] = E.slFor(calls[i], aht, avail, s.slSeconds);
      c += calls[i]; slw += calls[i] * sl[i]; reqH += req[i] / 4; netH += net[i] / 4;
      const g = net[i] - req[i]; if (g > 0) over += g / 4; else under += -g / 4;
      if (req[i] > 0 && net[i] < req[i] * 0.95 - 0.5) underInt++;
      const A = calls[i] * aht / E.INT_SEC; if (avail > 0) { occNum += Math.min(A, avail); occDen += avail; }
    }
    return { calls: c, sl: c ? slw / c : 1, reqH, netH, over, under, underInt, occ: occDen ? occNum / occDen : 0, slSeries: sl };
  };
  E.report = function (queues, s, R, net) {
    const out = queues.map((q, qi) => {
      const days = R[qi].calls.map((calls, k) => E.dayStats(calls, R[qi].aht, R[qi].req[k], net[qi][k], s));
      const sum = key => days.reduce((t, x) => t + x[key], 0), calls = sum('calls');
      return { id: q.id, name: q.name, days, week: { calls, sl: calls ? days.reduce((t, x) => t + x.sl * x.calls, 0) / calls : 1, reqH: sum('reqH'), netH: sum('netH'), over: sum('over'), under: sum('under'), underInt: sum('underInt'), occ: days.reduce((t, x) => t + x.occ * x.netH, 0) / (sum('netH') || 1) } };
    });
    const calls = out.reduce((t, q) => t + q.week.calls, 0), add = k => out.reduce((t, q) => t + q.week[k], 0);
    return { queues: out, total: { calls, sl: calls ? out.reduce((t, q) => t + q.week.sl * q.week.calls, 0) / calls : 1, reqH: add('reqH'), netH: add('netH'), over: add('over'), under: add('under'), underInt: add('underInt') } };
  };

  /* ---------- Intraday ---------- */
  E.reforecast = function (q, Rq, k, actual, now, s) {
    const n = E.nInt(s), fc = Rq.calls[k];
    let fSum = 0, aSum = 0, ahtW = 0;
    for (let i = 0; i < now; i++) { fSum += fc[i]; aSum += actual[i].calls; ahtW += actual[i].calls * actual[i].aht; }
    const volRatio = fSum > 0 ? aSum / fSum : 1, aht = aSum > 0 ? ahtW / aSum : Rq.aht;
    const calls = new Array(n), req = new Array(n);
    for (let i = 0; i < n; i++) { calls[i] = i < now ? actual[i].calls : fc[i] * volRatio; req[i] = E.agentsNeeded(calls[i], i < now ? actual[i].aht : aht, s) / (1 - s.shrinkage); }
    return { calls, req, volRatio, aht };
  };
  E.simulateActuals = function (q, Rq, k, now, seed) {
    const r = E.rng(seed), bias = 0.9 + r() * 0.25, ahtBias = 0.96 + r() * 0.1, out = [];
    for (let i = 0; i < now; i++) out.push({ calls: Math.max(0, Math.round(Rq.calls[k][i] * bias * (0.88 + r() * 0.24))), aht: Math.round(Rq.aht * ahtBias * (0.92 + r() * 0.16)) });
    return out;
  };
  // scheduled state of an agent at interval i
  E.stateAt = function (w, i) {
    if (!w || i < w.s || i >= w.s + w.len) return 'OFF';
    for (const x of w.acts) if (i >= w.s + x.at && i < w.s + x.at + x.len) return x.t;
    return 'PH';
  };
  // simulated real-time adherence for agents with a shift on iso
  E.simulateAdherence = function (agents, iso, now, s, seed) {
    const rows = [];
    agents.forEach((a, ai) => {
      const w = a.shifts && a.shifts[iso]; if (!w) return;
      const r = E.rng(E.hash(a.id + iso) ^ seed ^ (now * 2654435761));
      const sched = E.stateAt(w, now);
      let actual, out = false;
      const roll = r();
      const startedBefore = now >= w.s;
      if (sched === 'OFF') { if (now < w.s) return; actual = roll < 0.06 ? 'On call' : 'Logged out'; out = actual !== 'Logged out'; }
      else if (sched === 'PH') {
        if (roll < 0.035) { actual = now - w.s < 2 ? 'Logged out' : 'Break'; out = true; }
        else if (roll < 0.06) { actual = 'Offline'; out = true; }
        else actual = roll < 0.6 ? 'On call' : roll < 0.8 ? 'After-call work' : 'Available';
      } else {
        if (roll < 0.09) { actual = 'On call'; out = true; } else actual = E.ACT[sched].name;
      }
      const mins = out ? 1 + Math.floor(r() * 14) : 0;
      // adherence so far today
      const elapsed = Math.max(0, Math.min(now, w.s + w.len) - w.s) * 15;
      const lostMin = elapsed ? Math.round(elapsed * (0.01 + r() * 0.07)) + mins : 0;
      rows.push({ ai, sched, actual, out, mins, adh: elapsed ? Math.max(0, 1 - lostMin / elapsed) : 1, elapsed, started: startedBefore });
    });
    return rows;
  };

  /* ---------- CSV ---------- */
  E.parseCSV = function (text) {
    const rows = []; let row = [], cur = '', q = false;
    const first = text.split('\n')[0];
    const delim = first.split(';').length > first.split(',').length ? ';' : (first.split('\t').length > first.split(',').length ? '\t' : ',');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(v => v.trim() !== '')) rows.push(row); row = []; }
      else cur += c;
    }
    row.push(cur); if (row.some(v => v.trim() !== '')) rows.push(row);
    return rows;
  };
  E.toCSV = rows => rows.map(r => r.map(v => { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
  const dayIdx = t => E.DAYS.findIndex(x => x.toLowerCase() === String(t).trim().slice(0, 3).toLowerCase());
  E.AGENT_HEADERS = ['agent_id', 'name', 'email', 'team', 'site', 'queue', 'secondary_skills', 'weekly_hours', 'earliest_start', 'latest_end', 'fixed_days_off'];
  E.agentRows = agents => [E.AGENT_HEADERS, ...agents.map(a => [a.id, a.name, a.email || '', a.team, a.site || '', a.queue, (a.skills || []).join(' '), a.hours, E.fmt(a.earliest), E.fmt(a.latest), (a.fixedOff || []).map(d => E.DAYS[d]).join(' ')])];
  E.agentsFromRows = function (rows, queues, s) {
    if (rows.length < 2) throw new Error('No data rows found.');
    const h = rows[0].map(x => String(x).trim().toLowerCase().replace(/\s+/g, '_')), col = k => h.indexOf(k);
    if (col('agent_id') < 0 || col('queue') < 0) throw new Error('Missing required columns agent_id and queue.');
    const qids = new Set(queues.map(q => q.id)), errors = [], agents = [], seen = new Set();
    const days = v => String(v || '').split(/[\s|/,]+/).map(dayIdx).filter(k => k >= 0);
    rows.slice(1).forEach((r, k) => {
      const g = c => (col(c) >= 0 ? String(r[col(c)] ?? '').trim() : '');
      const q = g('queue').toUpperCase(), id = g('agent_id') || 'X' + (k + 1);
      if (!qids.has(q)) { errors.push(`Row ${k + 2}: unknown queue "${g('queue')}"`); return; }
      if (seen.has(id)) { errors.push(`Row ${k + 2}: duplicate agent_id ${id}`); return; }
      seen.add(id);
      agents.push({
        id, name: g('name') || id, email: g('email').toLowerCase(), team: g('team') || q + '-T01', site: g('site'), queue: q,
        skills: g('secondary_skills').toUpperCase().split(/[\s|/,]+/).filter(x => qids.has(x) && x !== q),
        hours: +g('weekly_hours') || 40,
        earliest: E.parseTime(g('earliest_start')) ?? s.openH * 60, latest: E.parseTime(g('latest_end')) ?? s.closeH * 60,
        fixedOff: days(g('fixed_days_off')), absence: {}, leaveUsed: 0, shifts: {}
      });
    });
    return { agents, errors };
  };

  root.Engine = E;
  if (typeof module !== 'undefined') module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
