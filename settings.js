/* Advanced settings: every company-specific rule in one place.
   Edits go into a draft; "Save changes" validates, applies the rules to the engine and views, and rebuilds when needed. */
(function () {
  const A = window.App, E = A.E, esc = A.esc, fmtN = A.fmtN, $ = A.$;
  const clone = o => JSON.parse(JSON.stringify(o));
  const DAYN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // originals, kept so the wrappers below can fall back to engine behaviour
  const O = { fmt: E.fmt, fmtDate: E.fmtDate, fmtDateY: E.fmtDateY, weekStart: E.weekStart, parseTime: E.parseTime, queueCalls: E.queueCalls, computeRequirements: E.computeRequirements, report: E.report, reforecast: E.reforecast, shiftSpec: E.shiftSpec, checkAgent: E.checkAgent, daySummary: E.daySummary, punchAdherence: E.punchAdherence, matches: E.matches };
  E.fmt24 = O.fmt;
  const BASE_CODES = clone(E.TIME_CODES), BASE_ABS = clone(E.ABS_INFO);
  const CODE_HEX = { PROD: '#2a78d6', BREAK: '#eb6834', MEAL: '#1baf7a', MEET: '#6250d6', TRB: '#eda100', TRN: '#e87ba4', COACH: '#008300' };
  const VIEWS = [['overview', 'Overview'], ['forecast', 'Forecast'], ['capacity', 'Capacity plan'], ['schedule', 'Schedule'], ['requests', 'Requests & time off'], ['activities', 'Activity planner'], ['intraday', 'Intraday'], ['time', 'Time tracking'], ['adherence', 'Adherence'], ['employees', 'Employees'], ['reports', 'Reports & exports']];
  const PERMS = [['editShifts', 'Edit shifts and activities'], ['build', 'Build schedules'], ['publish', 'Publish schedules'], ['plot', 'Plot absence'], ['approve', 'Approve requests'], ['editTime', 'Correct time punches'], ['employees', 'Add, edit and import employees'], ['forecast', 'Change forecasts, queues and capacity'], ['export', 'Export to Excel'], ['settings', 'Change settings']];
  const ACT_PERM = {
    build: ['build-open', 'build-run'], publish: ['publish-open', 'publish'], editShifts: ['sel-edit', 'be-apply', 'act-apply'],
    plot: ['ap-open', 'sel-plot', 'ap-apply', 'abs-add', 'abs-del'], approve: ['req-approve', 'req-deny', 'req-bulk'], editTime: ['tt-add', 'tt-del'],
    employees: ['add-agent', 'save-agent', 'delete-agent', 'import-agents', 'do-import', 'clear-agents'],
    forecast: ['apply-fit', 'apply-queue', 'cap-apply', 'import-forecast', 'import-history', 'add-queue', 'create-queue', 'remove-queue', 'clear-override', 'cl-add', 'cl-del'],
    export: ['export-schedule', 'export-one', 'export-all', 'sel-export', 'tt-export', 'tt-payroll', 'export-agents', 'export-forecast', 'export-capacity', 'export-adherence']
  };
  const REQ_TYPES = [['change', 'Shift time change'], ['swap', 'Shift swap'], ['dayoff', 'Day-off swap'], ['timeoff', 'Time off'], ['overtime', 'Overtime']];
  const NOTIFY = [['published', 'Schedule published', 'Agents'], ['changed', 'A shift of mine changed', 'Agents'], ['reqNew', 'New request submitted', 'Approvers'], ['reqDecided', 'Request approved or denied', 'Agents'], ['swapOffer', 'Swap offered to me', 'Agents'], ['adhAlert', 'Agent out of adherence', 'Supervisors'], ['missedLogin', 'Missed log in', 'Supervisors'], ['leaveLow', 'Leave balance running low', 'Agents'], ['understaffed', 'Understaffed intervals forecast', 'Planners']];

  /* ================= defaults ================= */
  function defaults(s, S) {
    const hrs = S && S.agents.length ? [...new Set(S.agents.map(a => a.hours))].sort((a, b) => b - a) : [40, 30, 20];
    const sites = S ? [...new Set(S.agents.map(a => a.site).filter(Boolean))].sort() : [];
    const tz = s.timezone || 'Europe/Berlin';
    const allViews = VIEWS.map(v => v[0]);
    return {
      v: 1,
      company: { name: 'Peovala Demo GmbH', legal: 'Peovala Demo GmbH', industry: 'Contact centre', country: 'DE', email: 'wfm@example.com', phone: '', accent: '', showName: true, fiscalStart: 1 },
      regional: { lang: 'en-GB', dateFmt: 'd MMM yyyy', timeFmt: '24', weekStart: 0, currency: 'EUR', tz },
      week: Array.from({ length: 7 }, () => ({ open: s.openH * 60, close: s.closeH * 60, closed: false })),
      sites: sites.map(n => ({ name: n, tz, region: 'DE-NW', address: '', active: true })),
      fields: [{ key: 'payroll_id', label: 'Payroll ID', type: 'text', options: '', required: false }, { key: 'cost_centre', label: 'Cost centre', type: 'select', options: 'CC-100, CC-200, CC-300', required: false }],
      contracts: hrs.map(h => ({ id: 'C' + h, name: (h >= 35 ? 'Full-time ' : 'Part-time ') + h + ' h', hours: h, days: s.daysPerWeek, minWeekH: 0, maxWeekH: h + 4, maxDayH: 10, maxConsec: s.maxConsec, minRestH: s.minRestH, otAllowed: true })),
      bands: { E: { from: Math.max(s.openH * 60, 360), to: 525 }, M: { from: 540, to: 705 }, L: { from: 720, to: Math.max(720, s.closeH * 60 - 240) } },
      rotations: rotationPresets(E.weekStart(s.periodStart || E.today())),
      templates: [{ name: 'Early', start: 420, end: 930 }, { name: 'Day', start: 540, end: 1050 }, { name: 'Mid', start: 660, end: 1170 }, { name: 'Late', start: 810, end: 1320 }, { name: 'Part-time morning', start: 480, end: 735 }],
      breakRules: [{ from: 4, breaks: 1, breakMin: s.breakMin, lunchMin: 0 }, { from: 6.25, breaks: 1, breakMin: s.breakMin, lunchMin: s.lunchMin }, { from: 8, breaks: 2, breakMin: s.breakMin, lunchMin: s.lunchMin }],
      timeCodes: Object.entries(BASE_CODES).map(([k, c]) => ({ code: k, name: c.name, paid: !!c.paid, billable: !!c.billable, color: CODE_HEX[k] || '#7f8a88', off: false, builtin: true, adhAs: k === 'TRB' || k === 'TRN' ? 'TRAIN' : k, payCode: '' })),
      absTypes: Object.entries(BASE_ABS).map(([k, v]) => ({ code: k, name: v.name, cat: v.work ? 'work' : v.pto ? 'pto' : 'npto', paid: !!v.paid, leave: !!v.leave, planned: !!v.planned, self: ['VAC', 'PER', 'UNP'].includes(k), maxYear: 0, off: false, builtin: true, payCode: '' })),
      leave: { annualDays: s.annualLeaveDays, accrual: 'upfront', yearStart: 1, carryMax: 5, carryUntil: 3, minNotice: 0, maxConsec: 0, maxOffPct: 0, halfDays: true, blackout: [] },
      requests: { types: { change: { on: true, approval: 'manual', notice: 0 }, swap: { on: true, approval: 'manual', notice: 0 }, dayoff: { on: true, approval: 'manual', notice: 0 }, timeoff: { on: true, approval: s.autoApproveTimeOff ? 'auto' : 'manual', notice: 0 }, overtime: { on: true, approval: 'manual', notice: 0 } }, approver: 'either', escalateH: 48, maxSwapsMonth: 0, reasonRequired: false, cancelPending: true },
      clock: { confirm: true, earlyLogin: -1, grace: 0, autoLogoutH: 12, adhTarget: 90, exceptionMin: 5, correctionReason: true, agentEdit: false },
      payroll: { round: 'none', roundMin: 15, period: 'monthly', otDailyH: 10, otWeeklyH: 40, otRate: 1.25, sundayRate: 1.5, holidayRate: 2, nightFrom: 1380, nightTo: 360, nightRate: 1.25 },
      roles: [
        { id: 'planner', name: 'WFM planner (administrator)', builtin: true, views: allViews.concat('settings'), perms: Object.fromEntries(PERMS.map(p => [p[0], true])) },
        { id: 'supervisor', name: 'Team supervisor', builtin: true, views: ['overview', 'schedule', 'requests', 'activities', 'intraday', 'time', 'adherence', 'employees', 'reports'], perms: { editShifts: true, build: false, publish: true, plot: true, approve: true, editTime: true, employees: true, forecast: false, export: true, settings: false } },
        { id: 'analyst', name: 'WFM analyst (read only)', builtin: false, views: ['overview', 'forecast', 'capacity', 'schedule', 'intraday', 'adherence', 'reports'], perms: { export: true } }
      ],
      notify: { events: Object.fromEntries(NOTIFY.map(([k]) => [k, { inapp: true, email: ['published', 'reqDecided', 'reqNew', 'swapOffer'].includes(k), sms: false }])), digest: 'daily', quietFrom: 1260, quietTo: 420 },
      security: { sessionMin: 480, pwdMin: 12, mfa: 'optional', sso: 'none', ipAllow: '', retention: 24 }
    };
  }
  function rotationPresets(anchor) {
    const wk = (wd, we) => [wd, wd, wd, wd, wd, we, we];
    return [
      { id: 'R1', name: 'Early → Mid → Late (3 weeks)', len: 21, anchor, cells: [...wk('E', 'off'), ...wk('M', 'off'), ...wk('L', 'off')] },
      { id: 'R2', name: 'Weekend cover (2 weeks)', len: 14, anchor, cells: [...wk('any', 'off'), 'off', 'off', 'any', 'any', 'any', 'any', 'any'] },
      { id: 'R3', name: '4 on / 4 off', len: 8, anchor, cells: ['any', 'any', 'any', 'any', 'off', 'off', 'off', 'off'] }
    ];
  }
  A.rotationPresets = rotationPresets;
  // fill missing keys from defaults without touching what the company already set
  function fill(t, d) {
    if (t == null || typeof t !== 'object' || Array.isArray(t)) return clone(d);
    Object.keys(d).forEach(k => {
      if (!(k in t)) t[k] = clone(d[k]);
      else if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) t[k] = fill(t[k], d[k]);
    });
    return t;
  }
  const cfg = () => (A.S && A.S.settings && A.S.settings.cfg) || null;
  A.cfg = cfg;

  /* ================= applying the configuration ================= */
  let byId = new Map(), byHours = new Map();
  const contractOf = a => (a && a.contract && byId.get(a.contract)) || (a && byHours.get(a.hours)) || null;
  A.contractOf = contractOf;
  function applyCfg() {
    const S = A.S; if (!S) return;
    const s = S.settings; s.cfg = fill(s.cfg, defaults(s, S));
    const c = s.cfg;
    // time codes (mutated in place: other modules hold a reference)
    Object.keys(E.TIME_CODES).forEach(k => delete E.TIME_CODES[k]);
    c.timeCodes.forEach(t => { E.TIME_CODES[t.code] = { name: t.name, paid: !!t.paid, billable: !!t.billable, off: !!t.off }; });
    E.PUNCH_CODES.length = 0; E.PUNCH_CODES.push('LOGIN', 'LOGOUT', ...c.timeCodes.map(t => t.code));
    // absence types
    Object.keys(E.ABS_INFO).forEach(k => delete E.ABS_INFO[k]); Object.keys(E.ABS).forEach(k => delete E.ABS[k]);
    c.absTypes.forEach(x => { E.ABS_INFO[x.code] = { name: x.name, pto: x.cat === 'pto', paid: x.cat !== 'npto' || !!x.paid, planned: !!x.planned, leave: !!x.leave, work: x.cat === 'work', off: !!x.off, self: !!x.self }; E.ABS[x.code] = x.name; });
    byId = new Map(c.contracts.map(k => [k.id, k])); byHours = new Map(); c.contracts.forEach(k => { if (!byHours.has(k.hours)) byHours.set(k.hours, k); });
    s.annualLeaveDays = c.leave.annualDays; s.autoApproveTimeOff = c.requests.types.timeoff.approval !== 'manual';
    // colours and branding
    let st = document.getElementById('cfg-style'); if (!st) { st = document.createElement('style'); st.id = 'cfg-style'; document.head.appendChild(st); }
    st.textContent = c.timeCodes.filter(t => !t.builtin || (t.color && t.color.toLowerCase() !== (CODE_HEX[t.code] || '').toLowerCase())).map(t => `.tc-${t.code}{--c:${t.color}}`).join('\n');
    const root = document.documentElement.style;
    if (/^#[0-9a-f]{6}$/i.test(c.company.accent || '')) {
      const h = c.company.accent, r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16), lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      root.setProperty('--accent', h); root.setProperty('--accent-ink', lum > 0.6 ? '#14201f' : '#ffffff'); root.setProperty('--accent-soft', `color-mix(in oklab, ${h} 16%, var(--surface))`);
    } else ['--accent', '--accent-ink', '--accent-soft'].forEach(p => root.removeProperty(p));
    const bn = document.querySelector('.brand-name');
    if (bn) bn.innerHTML = 'Peovala' + (c.company.showName && c.company.name ? `<small>${esc(c.company.name)}</small>` : '');
  }
  A.applyCfg = applyCfg;

  /* ---------- engine wrappers ---------- */
  E.fmt = function (min) {
    const c = cfg(); if (!c || c.regional.timeFmt !== '12') return O.fmt(min);
    min = Math.round(min); const h = Math.floor(min / 60), m = ((min % 60) + 60) % 60, hh = ((h % 24) + 24) % 24;
    return `${hh % 12 || 12}:${String(m).padStart(2, '0')}${hh < 12 ? 'am' : 'pm'}`;
  };
  E.parseTime = function (t) {
    if (t == null || t === '') return null;
    const m = String(t).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/i);
    if (m) { let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; return h * 60 + (+(m[2] || 0)); }
    return O.parseTime(t);
  };
  E.fmtDateY = function (iso) {
    const c = cfg(), f = c ? c.regional.dateFmt : 'd MMM yyyy';
    if (f === 'd MMM yyyy' || !E.valid(iso)) return O.fmtDateY(iso);
    const [y, m, d] = iso.split('-');
    return { 'dd/MM/yyyy': `${d}/${m}/${y}`, 'MM/dd/yyyy': `${m}/${d}/${y}`, 'yyyy-MM-dd': iso, 'dd.MM.yyyy': `${d}.${m}.${y}`, 'MMM d, yyyy': `${MONS[+m - 1]} ${+d}, ${y}` }[f] || O.fmtDateY(iso);
  };
  E.fmtDate = function (iso, withDow = true) {
    const c = cfg(), f = c ? c.regional.dateFmt : 'd MMM yyyy';
    if (!E.valid(iso) || !['MM/dd/yyyy', 'MMM d, yyyy', 'dd.MM.yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd'].includes(f)) return O.fmtDate(iso, withDow);
    const [, m, d] = iso.split('-'), dw = withDow ? E.DAYS[E.dow(iso)] + ' ' : '';
    if (f === 'MM/dd/yyyy' || f === 'MMM d, yyyy') return `${dw}${MONS[+m - 1]} ${+d}`;
    if (f === 'dd.MM.yyyy') return `${dw}${d}.${m}.`;
    if (f === 'dd/MM/yyyy') return `${dw}${d}/${m}`;
    return `${dw}${m}-${d}`;
  };
  E.weekStart = function (iso) {
    const c = cfg(), ws = c ? +c.regional.weekStart : 0;
    if (!ws) return O.weekStart(iso);
    return E.addDays(iso, -((E.dow(iso) - ws + 7) % 7));
  };
  // opening hours per weekday: no calls are planned while the centre is closed
  E.queueCalls = function (q, s, days, specials, scen) {
    const out = O.queueCalls(q, s, days, specials, scen), c = s && s.cfg; if (!c || !c.week) return out;
    const n = E.nInt(s), base = s.openH * 60;
    return out.map((arr, k) => {
      const wd = c.week[E.dow(days[k])]; if (!wd) return arr;
      if (wd.closed) return arr.map(() => 0);
      if (wd.open <= base && wd.close >= base + n * 15) return arr;
      return arr.map((v, i) => { const t = base + i * 15; return t >= wd.open && t + 15 <= wd.close ? v : 0; });
    });
  };
  // per-queue service targets and chat concurrency
  const qs = (s, q) => {
    if (q.slTarget == null && q.slSeconds == null && q.maxOcc == null && q.shrinkage == null) return s;
    return Object.assign({}, s, { slTarget: q.slTarget ?? s.slTarget, slSeconds: q.slSeconds ?? s.slSeconds, maxOcc: q.maxOcc ?? s.maxOcc, shrinkage: q.shrinkage ?? s.shrinkage });
  };
  const qEff = q => (q.channel === 'chat' && q.concurrency > 1) ? Object.assign({}, q, { aht: q.aht / q.concurrency }) : q;
  E.computeRequirements = (queues, s, days, specials, scen) => queues.map(q => O.computeRequirements([qEff(q)], qs(s, q), days, specials, scen)[0]);
  E.report = function (queues, s, R, net) {
    if (!queues.some(q => qs(s, q) !== s)) return O.report(queues, s, R, net);
    const out = queues.map((q, qi) => O.report([q], qs(s, q), [R[qi]], [net[qi]]).queues[0]);
    const calls = out.reduce((t, q) => t + q.week.calls, 0), add = k => out.reduce((t, q) => t + q.week[k], 0);
    return { queues: out, total: { calls, sl: calls ? out.reduce((t, q) => t + q.week.sl * q.week.calls, 0) / calls : 1, reqH: add('reqH'), netH: add('netH'), over: add('over'), under: add('under'), underInt: add('underInt') } };
  };
  E.reforecast = (q, Rq, k, actual, now, s) => O.reforecast(q, Rq, k, actual, now, qs(s, q));
  // shift length, breaks and lunch from the contract and the break rules
  E.shiftSpec = function (agent, s) {
    const c = s && s.cfg; if (!c || !c.breakRules) return O.shiftSpec(agent, s);
    const k = contractOf(agent), days = k ? k.days : s.daysPerWeek;
    const paidMin = Math.round(agent.hours / days * 60);
    let r = null; c.breakRules.forEach(x => { if (paidMin / 60 >= x.from - 1e-9 && (!r || x.from > r.from)) r = x; });
    const lunch = r ? +r.lunchMin || 0 : 0, breakInt = Math.ceil((r ? +r.breakMin || 0 : 0) / 15), breaks = breakInt ? (r ? +r.breaks || 0 : 0) : 0;
    const len = Math.ceil((paidMin + lunch) / 15), lunchInt = Math.ceil(lunch / 15);
    return { paidMin, len, lunchInt, breaks, breakInt: breakInt || 1, onPhoneInt: len - lunchInt - breaks * breakInt, days };
  };
  // labour rules per contract, opening hours per weekday
  E.checkAgent = function (a, s, days) {
    const c = s && s.cfg; if (!c || !c.contracts) return O.checkAgent(a, s, days);
    const k = contractOf(a), s2 = k ? Object.assign({}, s, { maxConsec: k.maxConsec, minRestH: k.minRestH, daysPerWeek: k.days }) : s;
    const issues = O.checkAgent(a, s2, days).filter(x => x.rule !== 'hoursmax'), sh = a.shifts || {};
    days.forEach(iso => {
      const w = sh[iso]; if (!w) return;
      const wd = c.week[E.dow(iso)], st = s.openH * 60 + w.s * 15, en = st + w.len * 15;
      if (wd && wd.closed) issues.push({ date: iso, rule: 'hours', text: `${E.fmtDate(iso)}: the centre is closed on ${DAYN[E.dow(iso)]}s` });
      else if (wd && (st < wd.open || en > wd.close)) issues.push({ date: iso, rule: 'hours', text: `${E.fmtDate(iso)}: ${E.fmt(st)}–${E.fmt(en)} is outside ${DAYN[E.dow(iso)]} opening hours ${E.fmt(wd.open)}–${E.fmt(wd.close)}` });
      if (k && k.maxDayH && E.paidInt(w) / 4 > k.maxDayH + 1e-9) issues.push({ date: iso, rule: 'daymax', text: `${E.fmtDate(iso)}: ${fmtN(E.paidInt(w) / 4, 2)} paid h, ${k.name} allows ${k.maxDayH} h a day` });
    });
    const weeks = {}, dpw = s2.daysPerWeek;
    days.forEach(iso => { const ws = E.weekStart(iso); const v = weeks[ws] = weeks[ws] || { paid: 0, n: 0, worked: 0, abs: 0 }; v.n++; const w = sh[iso]; if (w) { v.paid += E.paidInt(w) / 4; v.worked++; } if (a.absence && a.absence[iso] && (E.ABS_INFO[a.absence[iso]] || {}).paid) v.abs++; });
    Object.entries(weeks).forEach(([ws, v]) => {
      v.paid += Math.min(v.abs, Math.max(0, dpw - v.worked)) * a.hours / dpw;
      if (v.n !== 7) return;
      const max = k ? k.maxWeekH : a.hours + 4, min = k ? k.minWeekH : 0;
      if (v.paid > max + 1e-9) issues.push({ date: ws, rule: 'hoursmax', text: `Week of ${E.fmtDate(ws, false)}: ${v.paid.toFixed(1)} h paid, maximum ${max} h` });
      else if (min && v.paid < min - 1e-9) issues.push({ date: ws, rule: 'hoursmin', text: `Week of ${E.fmtDate(ws, false)}: ${v.paid.toFixed(1)} h paid, minimum ${min} h` });
    });
    return issues;
  };
  // timesheet rounding (applies to log in and log out)
  E.daySummary = function (events, end) {
    const c = cfg(), p = c && c.payroll;
    if (!p || p.round === 'none' || !events || !events.length) return O.daySummary(events, end);
    const m = Math.max(1, +p.roundMin || 15), up = t => Math.ceil(t / m) * m, dn = t => Math.floor(t / m) * m, nr = t => Math.round(t / m) * m;
    const ev = events.map(e => {
      if (e.code === 'LOGIN') return Object.assign({}, e, { t: p.round === 'nearest' ? nr(e.t) : p.round === 'employee' ? dn(e.t) : up(e.t) });
      if (e.code === 'LOGOUT') return Object.assign({}, e, { t: Math.min(end, p.round === 'nearest' ? nr(e.t) : p.round === 'employee' ? up(e.t) : dn(e.t)) });
      return e;
    });
    return O.daySummary(ev, end);
  };
  E.punchAdherence = function (w, events, s, end) {
    const r = O.punchAdherence(w, events, s, end), c = s && s.cfg, g = c ? +c.clock.grace || 0 : 0;
    if (g) { if (r.late && r.late <= g) r.late = 0; if (r.early && r.early <= g) r.early = 0; }
    return r;
  };
  E.matches = function (exp, act) {
    if (O.matches(exp, act)) return true;
    const c = cfg(), t = c && c.timeCodes.find(x => x.code === act);
    return !!(t && t.adhAs && t.adhAs !== act && t.adhAs !== 'NONE' && O.matches(exp, t.adhAs));
  };

  /* ---------- app wrappers: roles, requests, time clock, allowance, payroll ---------- */
  A.roleDef = id => { const c = cfg(); return c ? c.roles.find(r => r.id === id) : null; };
  A.roleName = id => id === 'agent' ? 'Agent (self-service)' : (A.roleDef(id) || {}).name || id;
  A.can = perm => { const r = A.UI.role; if (r === 'planner') return true; if (r === 'agent') return false; const d = A.roleDef(r); return !!(d && d.perms && d.perms[perm]); };
  const oAllowed = A.allowed;
  A.allowed = v => {
    const r = A.UI.role; if (r === 'agent' || r === 'planner') return oAllowed(v);
    const d = A.roleDef(r); if (!d) return oAllowed(v);
    return v === 'settings' ? !!(d.perms && d.perms.settings) : d.views.includes(v);
  };
  A.roleOptions = cur => { const c = cfg(), list = c ? c.roles : [{ id: 'planner', name: 'WFM planner' }, { id: 'supervisor', name: 'Team supervisor' }]; return list.map(r => `<option value="${esc(r.id)}" ${cur === r.id ? 'selected' : ''}>${esc(r.name.replace(' (administrator)', ''))}</option>`).join('') + `<option value="agent" ${cur === 'agent' ? 'selected' : ''}>Agent (self-service)</option>`; };
  A.who = () => A.UI.role === 'agent' ? (A.agent(A.UI.me) || {}).name || 'Agent' : (A.roleDef(A.UI.role) || {}).name || 'Planner';
  Object.entries(ACT_PERM).forEach(([perm, acts]) => acts.forEach(n => {
    const f = A.ACTS[n]; if (!f) return;
    A.ACTS[n] = function (t, e) {
      if (!A.can(perm)) { A.toast(`${A.roleName(A.UI.role)} can't ${PERMS.find(p => p[0] === perm)[1].toLowerCase()}. An administrator can allow it in Settings → Roles & permissions.`); return; }
      return f.apply(this, arguments);
    };
  }));
  // requests
  A.reqOn = type => { const c = cfg(); return !c || !c.requests.types[type] || c.requests.types[type].on !== false; };
  A.selfAbs = () => Object.entries(E.ABS_INFO).filter(([, v]) => v.self && !v.off).map(([k]) => k);
  const oEval = A.evaluate;
  A.evaluate = function (r) {
    const ev = oEval(r), c = cfg(); if (!c || !ev) return ev;
    const S = A.S, t = c.requests.types[r.type], p = r.p || {}, a = A.agent(r.agent), add = m => { if (!ev.issues.includes(m)) ev.issues.push(m); };
    if (t && t.on === false && !ev.err) { ev.err = 'This request type is switched off in Settings'; ev.issues.unshift(ev.err); }
    const first = [p.date, p.start, p.from, p.to].filter(Boolean).sort()[0], today = E.today();
    if (t && t.notice > 0 && first && E.diffDays(today, first) < t.notice) add(`Needs ${t.notice} day${t.notice > 1 ? 's' : ''} notice (${E.fmtDate(first)} is ${Math.max(0, E.diffDays(today, first))} away)`);
    if (c.requests.reasonRequired && !(r.note || '').trim()) add('A reason is required for this request');
    if (r.type === 'swap' && c.requests.maxSwapsMonth > 0 && a) {
      const mon = (p.date || '').slice(0, 7), n = S.requests.filter(x => x !== r && x.agent === a.id && x.type === 'swap' && ['approved', 'pending'].includes(x.status) && (x.p.date || '').slice(0, 7) === mon).length;
      if (n >= c.requests.maxSwapsMonth) add(`${a.name} already has ${n} swap${n > 1 ? 's' : ''} this month (limit ${c.requests.maxSwapsMonth})`);
    }
    if (r.type === 'overtime' && a) { const k = contractOf(a); if (k && !k.otAllowed) add(`${k.name} contracts do not allow overtime`); }
    if (r.type === 'timeoff' && a && p.start && p.end) {
      const L = c.leave, info = E.ABS_INFO[p.kind] || {}, dates = E.range(p.start, p.end);
      if (info.off) add(`${E.ABS[p.kind] || p.kind} is switched off in Settings`);
      if (L.minNotice > 0 && E.diffDays(today, p.start) < L.minNotice) add(`Time off needs ${L.minNotice} days notice`);
      if (L.maxConsec > 0 && dates.length > L.maxConsec) add(`${dates.length} days in a row; the limit is ${L.maxConsec}`);
      (L.blackout || []).forEach(b => { if (b.from && b.to && p.start <= b.to && p.end >= b.from) add(`Overlaps the blackout period ${b.name || ''} (${E.fmtDate(b.from)} – ${E.fmtDate(b.to)})`); });
      const at = c.absTypes.find(x => x.code === p.kind);
      if (at && at.maxYear > 0) { const y = p.start.slice(0, 4), used = Object.entries(a.absence || {}).filter(([d, k]) => k === p.kind && d.startsWith(y)).length; if (used + dates.length > at.maxYear) add(`${at.name}: ${used + dates.length} of ${at.maxYear} days this year`); }
      if (L.maxOffPct > 0) {
        const team = S.agents.filter(x => x.team === a.team), cap = Math.floor(team.length * L.maxOffPct / 100);
        dates.forEach(d => { const off = team.filter(x => x.id !== a.id && x.absence[d] && E.absCat(x.absence[d]) !== 'work').length; if (off + 1 > cap) add(`${E.fmtDate(d)}: ${off} of ${team.length} in ${a.team} already off (limit ${L.maxOffPct}%)`); });
      }
    }
    return ev;
  };
  A.autoApprove = function (r) {
    const c = cfg(), t = c ? c.requests.types[r.type] : null, mode = t ? t.approval : (r.type === 'timeoff' && A.S.settings.autoApproveTimeOff ? 'auto' : 'manual');
    if (mode === 'manual') return false;
    const ev = A.evaluate(r); if (ev.err) return false;
    return mode === 'always' || !ev.issues.length;
  };
  // time clock
  if (A.TC) {
    const oCheck = A.TC.check;
    A.TC.check = function (events, code, end) {
      const e = oCheck(events, code, end); if (e) return e;
      const c = cfg(); if (code !== 'LOGIN' || !c || !(c.clock.earlyLogin >= 0)) return null;
      const a = A.agent(A.UI.me), n = A.TC.now(), w = a && a.shifts[n.date]; if (!w) return null;
      const st = A.S.settings.openH * 60 + w.s * 15;
      return end < st - c.clock.earlyLogin ? `Your shift starts at ${E.fmt(st)}. You can log in from ${E.fmt(st - c.clock.earlyLogin)}.` : null;
    };
  }
  const confirmPunch = A.ACTS['tc-punch'];
  A.ACTS['tc-punch'] = (t, e) => { const c = cfg(); if (c && !c.clock.confirm) return A.TC.punch(t.dataset.code); return confirmPunch(t, e); };
  // time-off allowance capped by the share of a queue allowed off on one day
  const oAllow = A.allowance;
  A.allowance = function (qi, k) {
    const v = oAllow(qi, k), c = cfg(); if (!c || !(c.leave.maxOffPct > 0)) return v;
    const S = A.S, q = S.queues[qi], d = S.days[k]; let n = 0, off = 0;
    S.agents.forEach(a => { if (a.queue !== q.id) return; n++; const ab = a.absence[d]; if (ab && E.absCat(ab) !== 'work') off++; });
    return Math.max(0, Math.min(v, Math.floor(n * c.leave.maxOffPct / 100) - off));
  };
  // payroll export: overtime, Sunday and holiday hours, company fields
  if (A.REPORTS && A.REPORTS.payroll) {
    const oSheet = A.REPORTS.payroll.sheet;
    A.REPORTS.payroll.sheet = () => { const r = oSheet(); return r && r.then ? r.then(addPay) : addPay(r); };
  }
  function addPay(sh) {
    const c = cfg(); if (!c || !sh || !sh.rows || sh.rows.length < 2 || !A.TC) return sh;
    const rg = A.TC.range(); if (!rg) return sh; const rows = A.TC.sheetRows(rg[0], rg[1]); if (!rows || rows.then) return sh;
    const p = c.payroll, hol = new Set(A.S.specials.filter(x => x.factor === 0 && !x.queue).map(x => x.date)), by = {};
    rows.forEach(x => { const o = by[x.agent] = by[x.agent] || { daily: 0, weeks: {}, sun: 0, hol: 0 }; const ph = x.paid / 60; o.daily += Math.max(0, ph - p.otDailyH); const wk = E.weekStart(x.date); o.weeks[wk] = (o.weeks[wk] || 0) + ph; if (E.dow(x.date) === 6) o.sun += ph; if (hol.has(x.date)) o.hol += ph; });
    const out = [sh.rows[0].concat(['Contract', `Overtime h (day over ${p.otDailyH} h)`, `Overtime h (week over ${p.otWeeklyH} h)`, `Sunday h (×${p.sundayRate})`, `Public holiday h (×${p.holidayRate})`, ...c.fields.map(f => f.label)])];
    sh.rows.slice(1).forEach(r => {
      const a = A.agent(r[0]), o = by[r[0]] || { daily: 0, weeks: {}, sun: 0, hol: 0 }, k = contractOf(a);
      const wOt = Object.values(o.weeks).reduce((t, h) => t + Math.max(0, h - p.otWeeklyH), 0);
      out.push(r.concat([k ? k.name : '', +o.daily.toFixed(2), +wOt.toFixed(2), +o.sun.toFixed(2), +o.hol.toFixed(2), ...c.fields.map(f => ((a && a.fields) || {})[f.key] ?? '')]));
    });
    return { name: sh.name, rows: out };
  }
  // employee drawer: contract and company fields
  A.cfgAgentFields = function (a) {
    const c = cfg(); if (!c) return '';
    const auto = byHours.get(a.hours), f = a.fields || {};
    const fld = x => {
      const id = 'agf-' + x.key, v = f[x.key] ?? '', lab = `<label for="${id}">${esc(x.label)}${x.required ? ' *' : ''}</label>`;
      if (x.type === 'select') return `<div class="field">${lab}<select id="${id}" data-agf="${esc(x.key)}"><option value=""></option>${x.options.split(',').map(o => o.trim()).filter(Boolean).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
      if (x.type === 'bool') return `<div class="field"><span class="flabel">${esc(x.label)}</span><label class="check"><input type="checkbox" id="${id}" data-agf="${esc(x.key)}" ${v ? 'checked' : ''}> Yes</label></div>`;
      return `<div class="field">${lab}<input id="${id}" data-agf="${esc(x.key)}" type="${x.type === 'number' ? 'number' : x.type === 'date' ? 'date' : 'text'}" value="${esc(v)}"></div>`;
    };
    const rots = c.rotations || [], ro = a.rot && rots.find(x => x.id === a.rot.id), pf = a.pref || {};
    const offOpts = ro ? Array.from({ length: ro.len % 7 === 0 ? ro.len / 7 : ro.len }, (_, i) => [ro.len % 7 === 0 ? i * 7 : i, ro.len % 7 === 0 ? 'Week ' + (i + 1) : 'Day ' + (i + 1)]) : [];
    const rotHTML = `<div class="field"><label for="ag-rot">Rotation</label><select id="ag-rot"><option value="">No rotation</option>${rots.map(x => `<option value="${esc(x.id)}" ${ro && ro.id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      ${ro ? `<div class="field"><label for="ag-rotoff">Starts the pattern at</label><select id="ag-rotoff">${offOpts.map(([v, l]) => `<option value="${v}" ${((a.rot.off || 0) % ro.len) === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="hint">Counted from ${E.fmtDate(ro.anchor)}</span></div>` : ''}
      <div class="field"><label for="ag-pband">Preferred shift</label><select id="ag-pband"><option value="">No preference</option>${[['E', 'Early'], ['M', 'Mid'], ['L', 'Late']].map(([k, l]) => `<option value="${k}" ${pf.band === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    const prefOff = `<div class="field" style="grid-column:1/-1"><span class="flabel">Preferred days off (used when possible)</span><div class="days-pick">${E.DAYS.map((d, i) => `<label><input type="checkbox" name="ag-poff" value="${i}" ${(pf.off || []).includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div></div>`;
    return rotHTML + prefOff + `<div class="field"><label for="ag-contract">Contract</label><select id="ag-contract"><option value="">Match by hours${auto ? ' (' + esc(auto.name) + ')' : ''}</option>${c.contracts.map(k => `<option value="${esc(k.id)}" ${a.contract === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></div>${c.fields.map(fld).join('')}`;
  };
  A.cfgSaveAgent = function (a) {
    const c = cfg(); if (!c) return true;
    const sel = $('#ag-contract'); if (sel) { if (sel.value) { a.contract = sel.value; const k = byId.get(sel.value); if (k && !$('#ag-hours').dataset.touched) a.hours = k.hours; } else delete a.contract; }
    const f = Object.assign({}, a.fields || {});
    document.querySelectorAll('[data-agf]').forEach(el => { f[el.dataset.agf] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
    a.fields = f;
    const rs = $('#ag-rot'); if (rs) { if (rs.value) { const prevId = a.rot && a.rot.id; a.rot = { id: rs.value, off: prevId === rs.value && $('#ag-rotoff') ? +$('#ag-rotoff').value : 0 }; } else delete a.rot; }
    const pb = $('#ag-pband'); if (pb) { const off = [...document.querySelectorAll('input[name="ag-poff"]:checked')].map(x => +x.value); if (pb.value || off.length) a.pref = { band: pb.value || '', off }; else delete a.pref; }
    return true;
  };
  A.cfgCheckAgent = function () {
    const c = cfg(); if (!c) return null;
    const miss = c.fields.filter(x => x.required && x.type !== 'bool').find(x => { const el = document.getElementById('agf-' + x.key); return el && !el.value.trim(); });
    return miss ? `${miss.label} is required` : null;
  };
  document.addEventListener('input', e => { if (e.target.id === 'ag-hours') e.target.dataset.touched = '1'; });

  /* ================= holiday calendars ================= */
  function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`; }
  const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const nthDow = (y, m, dow, n) => { const first = ymd(y, m, 1); const off = (dow - E.dow(first) + 7) % 7; return E.addDays(first, off + (n - 1) * 7); };
  const lastDow = (y, m, dow) => { const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); return E.addDays(last, -((E.dow(last) - dow + 7) % 7)); };
  const observedUS = d => E.dow(d) === 5 ? E.addDays(d, -1) : E.dow(d) === 6 ? E.addDays(d, 1) : d;
  const REGIONS = [['DE', 'Germany: national holidays'], ['DE-NW', 'Germany: North Rhine-Westphalia'], ['DE-BY', 'Germany: Bavaria'], ['DE-BE', 'Germany: Berlin'], ['DE-HE', 'Germany: Hesse'], ['GB-ENG', 'United Kingdom: England & Wales'], ['US', 'United States: federal']];
  function holidays(region, y) {
    const e = easter(y), out = [];
    const add = (date, name) => out.push({ date, name });
    if (region.startsWith('DE')) {
      add(ymd(y, 1, 1), 'Neujahr'); add(E.addDays(e, -2), 'Karfreitag'); add(E.addDays(e, 1), 'Ostermontag'); add(ymd(y, 5, 1), 'Tag der Arbeit');
      add(E.addDays(e, 39), 'Christi Himmelfahrt'); add(E.addDays(e, 50), 'Pfingstmontag'); add(ymd(y, 10, 3), 'Tag der Deutschen Einheit'); add(ymd(y, 12, 25), '1. Weihnachtstag'); add(ymd(y, 12, 26), '2. Weihnachtstag');
      if (region === 'DE-NW' || region === 'DE-BY' || region === 'DE-HE') add(E.addDays(e, 60), 'Fronleichnam');
      if (region === 'DE-NW' || region === 'DE-BY') add(ymd(y, 11, 1), 'Allerheiligen');
      if (region === 'DE-BY') { add(ymd(y, 1, 6), 'Heilige Drei Könige'); add(ymd(y, 8, 15), 'Mariä Himmelfahrt'); }
      if (region === 'DE-BE') add(ymd(y, 3, 8), 'Internationaler Frauentag');
    } else if (region === 'GB-ENG') {
      const sub = (d, taken) => { let x = d; while (E.dow(x) >= 5 || taken.includes(x)) x = E.addDays(x, 1); return x; };
      add(sub(ymd(y, 1, 1), []), "New Year's Day"); add(E.addDays(e, -2), 'Good Friday'); add(E.addDays(e, 1), 'Easter Monday');
      add(nthDow(y, 5, 0, 1), 'Early May bank holiday'); add(lastDow(y, 5, 0), 'Spring bank holiday'); add(lastDow(y, 8, 0), 'Summer bank holiday');
      const xmas = sub(ymd(y, 12, 25), []); add(xmas, 'Christmas Day'); add(sub(ymd(y, 12, 26), [xmas]), 'Boxing Day');
    } else if (region === 'US') {
      add(observedUS(ymd(y, 1, 1)), "New Year's Day"); add(nthDow(y, 1, 0, 3), 'Martin Luther King Jr. Day'); add(nthDow(y, 2, 0, 3), "Washington's Birthday");
      add(lastDow(y, 5, 0), 'Memorial Day'); add(observedUS(ymd(y, 6, 19)), 'Juneteenth'); add(observedUS(ymd(y, 7, 4)), 'Independence Day'); add(nthDow(y, 9, 0, 1), 'Labor Day');
      add(nthDow(y, 10, 0, 2), 'Columbus Day'); add(observedUS(ymd(y, 11, 11)), 'Veterans Day'); add(nthDow(y, 11, 3, 4), 'Thanksgiving Day'); add(observedUS(ymd(y, 12, 25)), 'Christmas Day');
    }
    return out.sort((a, b) => a.date < b.date ? -1 : 1);
  }
  A.holidays = holidays;

  /* ================= settings view ================= */
  A.UI.st = { tab: 'company', q: '', d: null, base: null, errs: [], hol: { region: 'DE-NW', year: +E.today().slice(0, 4), factor: 0 } };
  const U = () => A.UI.st;
  function newDraft() {
    const S = A.S; applyCfg();
    const d = { s: clone(S.settings), queues: clone(S.queues.map(q => ({ id: q.id, name: q.name, aht: q.aht, channel: q.channel || 'voice', concurrency: q.concurrency || 1, slTarget: q.slTarget ?? S.settings.slTarget, slSeconds: q.slSeconds ?? S.settings.slSeconds, maxOcc: q.maxOcc ?? S.settings.maxOcc, shrinkage: q.shrinkage ?? S.settings.shrinkage }))) };
    delete d.s.periodStart; delete d.s.periodEnd;
    U().d = d; U().base = JSON.stringify(d); U().errs = [];
  }
  const gv = p => A.getPath(U().d, p);
  const fid = p => 'cf-' + p.replace(/[^a-zA-Z0-9]+/g, '-');
  const field = (p, label, ctrl, hint, cls = '') => `<div class="field ${cls}">${label ? `<label for="${fid(p)}">${label}</label>` : ''}${ctrl}${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  function inp(p, label, o = {}) {
    const v = gv(p), kind = o.kind || (o.type === 'number' ? 'num' : 'str');
    const shown = kind === 'pct' ? (v == null ? '' : +(v * 100).toFixed(2)) : v ?? '';
    const at = ['min', 'max', 'step', 'placeholder', 'maxlength'].filter(k => o[k] != null).map(k => `${k}="${esc(o[k])}"`).join(' ');
    const ctrl = `<input id="${fid(p)}" type="${o.type || 'text'}" data-cfg="${p}" data-kind="${kind}" value="${esc(shown)}" ${at} ${o.rr ? 'data-rr="1"' : ''} ${o.dis ? 'disabled' : ''} ${o.aria ? `aria-label="${esc(o.aria)}"` : ''}>`;
    return o.bare ? ctrl : field(p, label, o.unit ? `<div class="unit">${ctrl}<span>${o.unit}</span></div>` : ctrl, o.hint, o.cls);
  }
  function sel(p, label, opts, o = {}) {
    const v = gv(p), kind = o.kind || 'str';
    const ctrl = `<select id="${fid(p)}" data-cfg="${p}" data-kind="${kind}" ${o.rr ? 'data-rr="1"' : ''} ${o.dis ? 'disabled' : ''} ${o.aria ? `aria-label="${esc(o.aria)}"` : ''}>${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    return o.bare ? ctrl : field(p, label, ctrl, o.hint, o.cls);
  }
  function chk(p, label, o = {}) {
    const v = o.inv ? !gv(p) : gv(p);
    const box = `<input type="checkbox" id="${fid(p)}" data-cfg="${p}" data-kind="${o.inv ? 'notbool' : 'bool'}" ${v ? 'checked' : ''} ${o.rr ? 'data-rr="1"' : ''} ${o.dis ? 'disabled' : ''} ${o.aria ? `aria-label="${esc(o.aria)}"` : ''}>`;
    return o.bare ? box : `<label class="check ${o.cls || ''}">${box} ${label}</label>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}`;
  }
  const timeOpts = (from = 0, to = 1440, step = 30) => { const o = []; for (let m = from; m <= to; m += step) o.push([m, m === 1440 ? (E.fmt(0) + ' (midnight)') : E.fmt(m)]); return o; };
  const tsel = (p, label, o = {}) => sel(p, label, timeOpts(o.from, o.to, o.step), Object.assign({ kind: 'num' }, o));
  const sec = (title, sub, body, act = '') => `<section class="panel st-card"><div class="split"><div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${act}</div>${body}</section>`;
  const grid = (...f) => `<div class="form st-form">${f.join('')}</div>`;
  const addBtn = (list, label) => `<button class="btn sm" data-act="st-add" data-list="${list}">${label}</button>`;
  const delBtn = (list, i, label) => `<button class="x" data-act="st-del" data-list="${list}" data-i="${i}" aria-label="${esc(label)}">×</button>`;
  const serverNote = '<p class="note-s">Saved with your company settings. The connected server edition sends the messages and enforces these at sign-in; this browser demo stores them only.</p>';

  const TABS = [
    ['Organisation', 'company', 'Company & branding', 'name logo colour color accent brand legal industry country email fiscal'],
    ['Organisation', 'regional', 'Regional formats', 'language date time 12 24 hour week start currency timezone time zone format'],
    ['Organisation', 'sites', 'Sites & locations', 'site location office remote timezone address region'],
    ['Organisation', 'fields', 'Employee fields', 'custom field payroll id cost centre employee attribute'],
    ['Operations', 'hours', 'Opening hours', 'opening hours weekday closed open close sunday saturday'],
    ['Operations', 'queues', 'Queues & service levels', 'queue service level sl target answer seconds occupancy shrinkage aht channel chat email concurrency'],
    ['Operations', 'holidays', 'Holidays & special days', 'holiday public bank special day calendar volume factor closed nrw germany uk us'],
    ['Workforce rules', 'contracts', 'Contracts & labour rules', 'contract part-time full-time hours rest consecutive max day week overtime arbzg labour law working time'],
    ['Workforce rules', 'breaks', 'Breaks & meals', 'break lunch meal paid unpaid rule'],
    ['Workforce rules', 'templates', 'Shift templates', 'template shift early late pattern'],
    ['Workforce rules', 'rotations', 'Rotations & shift bands', 'rotation pattern rotate cycle 4 on 4 off weekend early mid late band crew stagger assign'],
    ['Workforce rules', 'scheduling', 'Schedule builder', 'start granularity consistency gap planning period builder'],
    ['Time & attendance', 'codes', 'Time codes', 'time code status production meal break training coaching billable paid colour'],
    ['Time & attendance', 'clock', 'Time clock & adherence', 'clock login log in grace adherence confirm status early auto logout exception'],
    ['Time & attendance', 'payroll', 'Timesheets & payroll', 'rounding overtime premium night sunday holiday rate pay period payroll'],
    ['Absence & requests', 'absences', 'Absence types', 'absence pto vacation sick unpaid leave type paid'],
    ['Absence & requests', 'leave', 'Leave policy', 'annual leave entitlement accrual carry over blackout notice allowance'],
    ['Absence & requests', 'requests', 'Requests & approvals', 'request approval auto approve swap overtime notice escalate'],
    ['Access & alerts', 'roles', 'Roles & permissions', 'role permission access supervisor planner analyst rights'],
    ['Access & alerts', 'notify', 'Notifications', 'notification email sms alert digest quiet'],
    ['Access & alerts', 'security', 'Security & sign-in', 'security password mfa sso session ip retention'],
    ['System', 'data', 'Data, backup & audit', 'export import backup reset audit log json']
  ];

  function changedPaths() {
    const out = [], base = JSON.parse(U().base || '{}');
    const walk = (a, b, p) => {
      if (a && b && typeof a === 'object' && typeof b === 'object') { new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => walk(a[k], b[k], p ? p + '.' + k : k)); return; }
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push(p);
    };
    walk(base, U().d, ''); return out;
  }
  function barHTML() {
    const n = changedPaths().length;
    return n ? `<span><b>${n}</b> unsaved change${n > 1 ? 's' : ''}</span><span class="actions"><button class="btn sm" data-act="st-discard">Discard</button><button class="btn sm primary" data-act="st-save">Save changes</button></span>` : '';
  }
  function updateBar() {
    const b = document.getElementById('st-bar'); if (!b) return;
    const h = barHTML(); if (b._h === h) return; // re-rendering on blur would swallow a click on Save
    const n = (h.match(/<b>(\d+)<\/b>/) || [])[1], cur = b.querySelector('b');
    if (n && cur && b._h) { cur.textContent = n; b.querySelector('span').lastChild.textContent = ` unsaved change${n > 1 ? 's' : ''}`; b._h = h; return; }
    b.innerHTML = h; b._h = h; b.hidden = !h;
  }

  /* ---------- tab bodies ---------- */
  const R = {};
  R.company = () => {
    const c = 's.cfg.company', acc = gv(c + '.accent');
    return sec('Company profile', 'Shown in the app header, on exports and in messages to staff.',
      grid(inp(c + '.name', 'Company name'), inp(c + '.legal', 'Legal entity'), sel(c + '.industry', 'Industry', ['Contact centre', 'Customer service outsourcing (BPO)', 'Retail', 'Banking & insurance', 'Telecommunications', 'Healthcare', 'Utilities', 'Public sector', 'Travel & hospitality', 'Other'].map(x => [x, x])),
        sel(c + '.country', 'Country', [['DE', 'Germany'], ['AT', 'Austria'], ['CH', 'Switzerland'], ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['NL', 'Netherlands'], ['FR', 'France'], ['ES', 'Spain'], ['US', 'United States'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['EG', 'Egypt'], ['OTHER', 'Other']]),
        inp(c + '.email', 'WFM contact email', { type: 'email', hint: 'Agents see this on the self-service page' }), inp(c + '.phone', 'WFM phone'),
        sel(c + '.fiscalStart', 'Financial year starts', MONTHS.map((m, i) => [i + 1, m]), { kind: 'num' }))) +
      sec('Branding', 'Your colour is used for buttons, highlights and the active menu item in light and dark mode.',
        `<div class="form st-form"><div class="field"><label for="cf-accent">Brand colour</label><div class="unit"><input type="color" id="cf-accent" data-cfg="${c}.accent" data-kind="str" value="${esc(acc || '#0f6e6a')}" data-rr="1"><span>${acc ? esc(acc) : 'Peovala teal (default)'}</span></div>${acc ? `<button class="linkbtn" data-act="st-set" data-p="${c}.accent" data-v="">Use the default colour</button>` : ''}</div>
        <div class="field"><span class="flabel">Header</span>${chk(c + '.showName', 'Show the company name under the Peovala logo')}</div>
        <div class="field"><span class="flabel">Preview</span><div class="st-prev" style="${acc ? `--pa:${esc(acc)}` : ''}"><span class="pb">Primary button</span><span class="pl">Selected item</span></div></div></div>`);
  };
  R.regional = () => {
    const r = 's.cfg.regional'; let tzs = []; try { tzs = Intl.supportedValuesOf('timeZone'); } catch (e) { tzs = ['Europe/Berlin', 'Europe/London', 'America/New_York', 'Asia/Dubai']; }
    const ex = '2026-10-12';
    return sec('Language, dates and times', 'Applies to every screen and export for all users of this company.',
      grid(sel(r + '.lang', 'Language', [['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['de-DE', 'Deutsch'], ['fr-FR', 'Français'], ['ar', 'العربية (Arabic)'], ['es-ES', 'Español']], { hint: 'The interface is in English in this demo; other languages ship with the release.' }),
        sel(r + '.dateFmt', 'Date format', [['d MMM yyyy', '12 Oct 2026'], ['dd/MM/yyyy', '12/10/2026'], ['dd.MM.yyyy', '12.10.2026'], ['MM/dd/yyyy', '10/12/2026'], ['MMM d, yyyy', 'Oct 12, 2026'], ['yyyy-MM-dd', '2026-10-12 (ISO)']], { rr: 1 }),
        sel(r + '.timeFmt', 'Time format', [['24', '24-hour (17:30)'], ['12', '12-hour (5:30pm)']], { rr: 1 }),
        sel(r + '.weekStart', 'Week starts on', [[0, 'Monday'], [6, 'Sunday'], [5, 'Saturday']], { kind: 'num', hint: 'Used by the week view, weekly hours and days-off planning' }),
        sel(r + '.currency', 'Currency', [['EUR', 'Euro (€)'], ['GBP', 'Pound (£)'], ['USD', 'US dollar ($)'], ['CHF', 'Swiss franc'], ['AED', 'UAE dirham'], ['SAR', 'Saudi riyal'], ['EGP', 'Egyptian pound']]),
        field(r + '.tz', 'Company time zone', `<input id="${fid(r + '.tz')}" list="tzlist" data-cfg="${r}.tz" data-kind="str" value="${esc(gv(r + '.tz'))}"><datalist id="tzlist">${tzs.map(z => `<option value="${esc(z)}">`).join('')}</datalist>`, 'Sites can override this'))) +
      `<p class="muted st-ex">Example with the saved settings: ${esc(E.fmtDateY(ex))} · ${esc(E.fmtDate(ex))} · ${esc(E.fmt(17 * 60 + 30))}</p>`;
  };
  R.sites = () => {
    const S = A.S, L = 's.cfg.sites', list = gv(L), cnt = {}; S.agents.forEach(a => { cnt[a.site] = (cnt[a.site] || 0) + 1; });
    return sec('Sites & locations', 'Offices and remote groups. Each site can have its own time zone and holiday calendar.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Site name</th><th>Time zone</th><th>Holiday calendar</th><th>Address</th><th class="r">Agents</th><th>Active</th><th></th></tr></thead><tbody>
      ${list.map((x, i) => `<tr><td>${inp(`${L}.${i}.name`, '', { bare: 1, aria: 'Site name' })}</td><td>${inp(`${L}.${i}.tz`, '', { bare: 1, aria: 'Time zone' })}</td><td>${sel(`${L}.${i}.region`, '', REGIONS.concat([['', 'None']]), { bare: 1, aria: 'Holiday calendar' })}</td><td>${inp(`${L}.${i}.address`, '', { bare: 1, aria: 'Address', placeholder: 'Street, city' })}</td><td class="r num">${fmtN(cnt[x.name] || 0)}</td><td class="c">${chk(`${L}.${i}.active`, '', { bare: 1, aria: 'Active' })}</td><td>${cnt[x.name] ? '' : delBtn(L, i, 'Remove site')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No sites yet</td></tr>'}
      </tbody></table></div>`, addBtn(L, 'Add site'));
  };
  R.fields = () => {
    const L = 's.cfg.fields', list = gv(L);
    return sec('Employee fields', 'Extra details you keep for each employee. They appear in the employee panel and in the payroll export.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Choices (for a list)</th><th>Required</th><th></th></tr></thead><tbody>
      ${list.map((x, i) => `<tr><td>${inp(`${L}.${i}.label`, '', { bare: 1, aria: 'Label' })}</td><td>${inp(`${L}.${i}.key`, '', { bare: 1, aria: 'Key' })}</td><td>${sel(`${L}.${i}.type`, '', [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Choose from a list'], ['bool', 'Yes / no']], { bare: 1, rr: 1, aria: 'Type' })}</td><td>${x.type === 'select' ? inp(`${L}.${i}.options`, '', { bare: 1, aria: 'Choices', placeholder: 'Comma-separated' }) : '<span class="muted">–</span>'}</td><td class="c">${chk(`${L}.${i}.required`, '', { bare: 1, aria: 'Required' })}</td><td>${delBtn(L, i, 'Remove field')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No custom fields</td></tr>'}
      </tbody></table></div>`, addBtn(L, 'Add field'));
  };
  R.hours = () => {
    const L = 's.cfg.week', w = gv(L);
    return sec('Opening hours', 'When the contact centre takes contacts. No calls are forecast and no shifts are planned while it is closed. Holidays are set under Holidays & special days.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Day</th><th>Open</th><th>Opens</th><th>Closes</th><th class="r">Hours</th></tr></thead><tbody>
      ${w.map((d, i) => `<tr><td><b>${DAYN[i]}</b></td><td class="c">${chk(`${L}.${i}.closed`, '', { bare: 1, rr: 1, inv: 1, aria: DAYN[i] + ' open' })}</td>
        <td>${d.closed ? '<span class="muted">Closed</span>' : tsel(`${L}.${i}.open`, '', { bare: 1, to: 1410, rr: 1, aria: DAYN[i] + ' opens' })}</td><td>${d.closed ? '' : tsel(`${L}.${i}.close`, '', { bare: 1, from: 30, rr: 1, aria: DAYN[i] + ' closes' })}</td><td class="r num">${d.closed ? '–' : fmtN((d.close - d.open) / 60, 1)}</td></tr>`).join('')}
      </tbody></table></div><div class="actions mt"><button class="btn sm" data-act="st-copy-mon">Copy Monday to all weekdays</button><button class="btn sm" data-act="st-copy-all">Copy Monday to every day</button></div>`);
  };
  R.queues = () => {
    const L = 'queues', list = gv(L), s = 's';
    return sec('Service level by queue', 'Each queue can have its own target. Chat queues can handle several conversations at once.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Queue</th><th>Channel</th><th class="r">Handle time (s)</th><th class="r">Concurrency</th><th class="r">SL target %</th><th class="r">Answered within (s)</th><th class="r">Max occupancy %</th><th class="r">Shrinkage %</th></tr></thead><tbody>
      ${list.map((q, i) => `<tr><td>${inp(`${L}.${i}.name`, '', { bare: 1, aria: 'Queue name' })}<div class="sub2">${esc(q.id)}</div></td><td>${sel(`${L}.${i}.channel`, '', [['voice', 'Voice'], ['chat', 'Chat'], ['email', 'Email'], ['callback', 'Callback'], ['social', 'Social'], ['backoffice', 'Back office']], { bare: 1, rr: 1, aria: 'Channel' })}</td>
        <td>${inp(`${L}.${i}.aht`, '', { type: 'number', bare: 1, min: 10, max: 7200, aria: 'Handle time' })}</td><td>${q.channel === 'chat' ? inp(`${L}.${i}.concurrency`, '', { type: 'number', bare: 1, min: 1, max: 6, aria: 'Concurrency' }) : '<span class="muted">1</span>'}</td>
        <td>${inp(`${L}.${i}.slTarget`, '', { type: 'number', kind: 'pct', bare: 1, min: 1, max: 99, aria: 'SL target' })}</td><td>${inp(`${L}.${i}.slSeconds`, '', { type: 'number', bare: 1, min: 1, aria: 'Answered within' })}</td>
        <td>${inp(`${L}.${i}.maxOcc`, '', { type: 'number', kind: 'pct', bare: 1, min: 50, max: 100, aria: 'Max occupancy' })}</td><td>${inp(`${L}.${i}.shrinkage`, '', { type: 'number', kind: 'pct', bare: 1, min: 0, max: 60, step: 0.5, aria: 'Shrinkage' })}</td></tr>`).join('')}
      </tbody></table></div>`) +
      sec('Defaults for new queues', 'Also the target used for the overall service level colours.',
        grid(inp(s + '.slTarget', 'Service level target', { type: 'number', kind: 'pct', min: 1, max: 99, unit: '%' }), inp(s + '.slSeconds', 'Answered within', { type: 'number', min: 1, unit: 'sec' }), inp(s + '.maxOcc', 'Maximum occupancy', { type: 'number', kind: 'pct', min: 50, max: 100, unit: '%' }), inp(s + '.shrinkage', 'Unplanned shrinkage', { type: 'number', kind: 'pct', min: 0, max: 60, step: 0.5, unit: '%', hint: 'Sickness and other time lost at short notice' })) +
        '<div class="actions"><button class="btn sm" data-act="st-q-defaults">Apply these defaults to every queue</button></div>');
  };
  R.holidays = () => {
    const S = A.S, H = U().hol, y0 = +E.today().slice(0, 4), prev = holidays(H.region, H.year), have = new Set(S.specials.map(x => x.date + '|' + (x.queue || '')));
    return `<p class="note-i">Changes on this page apply straight away and recalculate the forecast.</p>` +
      sec('Add a public holiday calendar', 'Adds every public holiday of a year in one step.',
        `<div class="form st-form"><div class="field"><label for="hol-region">Calendar</label><select id="hol-region">${REGIONS.map(([k, l]) => `<option value="${k}" ${H.region === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="hol-year">Year</label><select id="hol-year">${[y0 - 1, y0, y0 + 1, y0 + 2].map(y => `<option ${H.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div class="field"><label for="hol-factor">On these days</label><select id="hol-factor"><option value="0" ${H.factor === 0 ? 'selected' : ''}>Centre closed</option><option value="0.5" ${H.factor === 0.5 ? 'selected' : ''}>Open, half the volume</option><option value="0.3" ${H.factor === 0.3 ? 'selected' : ''}>Open, 30% of the volume</option></select></div></div>
        <div class="chips">${prev.map(h => `<span class="chipx ${have.has(h.date + '|') ? 'have' : ''}">${esc(E.fmtDate(h.date))} · ${esc(h.name)}</span>`).join('')}</div>
        <div class="actions mt"><button class="btn primary sm" data-act="hol-add">Add ${prev.filter(h => !have.has(h.date + '|')).length} holidays</button></div>`) +
      sec('Holidays & special days', 'Scale the forecast on a date: 0 closes the centre, 1.3 means 30% more contacts. Leave the queue empty for all queues.',
        `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Date</th><th>Name</th><th class="r">Volume factor</th><th>Queue</th><th></th></tr></thead><tbody>
        ${S.specials.map((sp, i) => `<tr><td class="num">${E.fmtDateY(sp.date)} <span class="muted">${E.DAYS[E.dow(sp.date)]}</span></td><td>${esc(sp.name)}</td><td class="r num">${sp.factor === 0 ? 'Closed' : '×' + sp.factor}</td><td>${sp.queue || 'All'}</td><td><button class="x" data-act="sp-del" data-i="${i}" aria-label="Remove">×</button></td></tr>`).join('')}
        <tr><td><input id="sp-date" type="date" value="${S.days[0]}" aria-label="Date"></td><td><input id="sp-name" type="text" placeholder="e.g. Product launch" aria-label="Name"></td><td class="r"><input id="sp-f" type="number" step="0.05" min="0" value="1.2" style="width:80px" aria-label="Volume factor"></td><td><select id="sp-q" aria-label="Queue"><option value="">All</option>${S.queues.map(q => `<option>${q.id}</option>`).join('')}</select></td><td><button class="btn sm" data-act="sp-add">Add</button></td></tr>
        </tbody></table></div>`);
  };
  R.contracts = () => {
    const L = 's.cfg.contracts', list = gv(L), S = A.S, cnt = {};
    S.agents.forEach(a => { const k = contractOf(a); if (k) cnt[k.id] = (cnt[k.id] || 0) + 1; });
    return sec('Contracts', 'Each contract has its own working week and limits. Agents are matched by contract hours unless a contract is set in their employee details.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Name</th><th class="r">Hours / week</th><th class="r">Days / week</th><th class="r">Min h / week</th><th class="r">Max h / week</th><th class="r">Max paid h / day</th><th class="r">Max days in a row</th><th class="r">Min rest (h)</th><th>Overtime</th><th class="r">Agents</th><th></th></tr></thead><tbody>
      ${list.map((k, i) => `<tr><td>${inp(`${L}.${i}.name`, '', { bare: 1, aria: 'Contract name' })}</td>${[['hours', 1, 60, 0.5], ['days', 1, 7, 1], ['minWeekH', 0, 80, 0.5], ['maxWeekH', 1, 80, 0.5], ['maxDayH', 1, 16, 0.25], ['maxConsec', 1, 14, 1], ['minRestH', 0, 24, 0.5]].map(([f, mn, mx, st]) => `<td>${inp(`${L}.${i}.${f}`, '', { type: 'number', bare: 1, min: mn, max: mx, step: st, aria: f })}</td>`).join('')}<td class="c">${chk(`${L}.${i}.otAllowed`, '', { bare: 1, aria: 'Overtime allowed' })}</td><td class="r num">${fmtN(cnt[k.id] || 0)}</td><td>${cnt[k.id] ? '' : delBtn(L, i, 'Remove contract')}</td></tr>`).join('')}
      </tbody></table></div>`, addBtn(L, 'Add contract')) +
      sec('Load a legal preset', 'Sets rest, daily and weekly limits and the break rules for every contract. Review before saving.',
        `<div class="actions"><button class="btn sm" data-act="st-preset" data-v="DE">Germany (ArbZG)</button><button class="btn sm" data-act="st-preset" data-v="UK">United Kingdom (Working Time Regulations)</button><button class="btn sm" data-act="st-preset" data-v="US">United States (FLSA, company policy)</button></div><p class="note-s">Presets are a starting point, not legal advice. Check them against your collective agreement or works council rules.</p>`);
  };
  R.breaks = () => {
    const L = 's.cfg.breakRules', list = gv(L), S = A.S;
    const tmp = Object.assign({}, S.settings, { cfg: U().d.s.cfg, daysPerWeek: U().d.s.daysPerWeek });
    const ex = [4, 6, 7.5, 8, 9, 10].map(h => { const sp2 = E.shiftSpec({ hours: h * tmp.daysPerWeek + 1e-6 }, tmp); return `<tr><td class="num">${h} h paid</td><td class="num">${fmtN(sp2.len / 4, 2)} h</td><td>${sp2.breaks ? sp2.breaks + ' × ' + sp2.breakInt * 15 + ' min' : 'none'}</td><td>${sp2.lunchInt ? sp2.lunchInt * 15 + ' min' : 'none'}</td></tr>`; }).join('');
    return sec('Break and meal rules', 'The longest rule a shift reaches applies. Breaks are paid; meals are unpaid and make the shift longer.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Shifts of at least (paid h)</th><th class="r">Breaks</th><th class="r">Break length (min)</th><th class="r">Unpaid meal (min)</th><th></th></tr></thead><tbody>
      ${list.map((x, i) => `<tr><td>${inp(`${L}.${i}.from`, '', { type: 'number', bare: 1, min: 0, max: 16, step: 0.25, aria: 'From paid hours' })}</td><td>${inp(`${L}.${i}.breaks`, '', { type: 'number', bare: 1, min: 0, max: 6, aria: 'Breaks' })}</td><td>${inp(`${L}.${i}.breakMin`, '', { type: 'number', bare: 1, min: 0, max: 60, step: 5, aria: 'Break length' })}</td><td>${inp(`${L}.${i}.lunchMin`, '', { type: 'number', bare: 1, min: 0, max: 120, step: 15, aria: 'Meal length' })}</td><td>${delBtn(L, i, 'Remove rule')}</td></tr>`).join('')}
      </tbody></table></div>`, addBtn(L, 'Add rule')) +
      sec('What this gives', 'Shift length including the meal, with the saved rules. Updates as you edit.', `<table class="mini"><thead><tr><th>Paid time</th><th>Shift length</th><th>Breaks</th><th>Meal</th></tr></thead><tbody>${ex}</tbody></table>`) +
      sec('Spacing', '', grid(inp('s.minGapMin', 'Minimum gap between activities', { type: 'number', min: 0, step: 15, unit: 'min', hint: 'Also from the shift start and end' })));
  };
  R.templates = () => {
    const L = 's.cfg.templates', list = gv(L);
    return sec('Shift templates', 'Named shifts you use often. Apply them to selected agents with "Edit shifts" in the selection bar.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Name</th><th>Starts</th><th>Ends</th><th class="r">Length</th><th></th></tr></thead><tbody>
      ${list.map((t, i) => `<tr><td>${inp(`${L}.${i}.name`, '', { bare: 1, aria: 'Template name' })}</td><td>${tsel(`${L}.${i}.start`, '', { bare: 1, step: 15, to: 1425, rr: 1, aria: 'Starts' })}</td><td>${tsel(`${L}.${i}.end`, '', { bare: 1, step: 15, from: 15, rr: 1, aria: 'Ends' })}</td><td class="r num">${t.end > t.start ? fmtN((t.end - t.start) / 60, 2) + ' h' : '<span class="crit-ink">ends before it starts</span>'}</td><td>${delBtn(L, i, 'Remove template')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No templates</td></tr>'}
      </tbody></table></div>`, addBtn(L, 'Add template'));
  };
  const CELL = c => c === 'off' ? 'off' : c === 'any' ? 'any' : c.startsWith('t:') ? 'tpl' : c;
  R.rotations = () => {
    const S = A.S, d = U().d, c = d.s.cfg, B = 's.cfg.bands', L = 's.cfg.rotations', saved = (cfg() || {}).rotations || [];
    const cnt = {}; S.agents.forEach(a => { if (a.rot) cnt[a.rot.id] = (cnt[a.rot.id] || 0) + 1; });
    const opts = [['any', 'Work'], ['off', 'Off'], ['E', 'Early'], ['M', 'Mid'], ['L', 'Late'], ...c.templates.map(t => ['t:' + t.name, t.name])];
    const bandRow = (k, l) => `<tr><td><b>${l}</b></td><td>${tsel(`${B}.${k}.from`, '', { bare: 1, step: 15, aria: l + ' from' })}</td><td>${tsel(`${B}.${k}.to`, '', { bare: 1, step: 15, aria: l + ' until' })}</td></tr>`;
    const rotCard = (ro, i) => {
      ro.len = Math.max(1, Math.min(56, Math.round(+ro.len || 7)));
      while (ro.cells.length < ro.len) ro.cells.push(ro.cells.length % 7 >= 5 ? 'off' : 'any');
      ro.cells.length = ro.len;
      const weekly = ro.len % 7 === 0, rows = weekly ? ro.len / 7 : Math.ceil(ro.len / 7), workDays = ro.cells.filter(x => x !== 'off').length;
      let grid = `<table class="cfg rotgrid"><thead><tr><th></th>${Array.from({ length: 7 }, (_, j) => `<th class="c">${weekly ? E.DAYS[j] : ''}</th>`).join('')}</tr></thead><tbody>`;
      for (let w = 0; w < rows; w++) grid += `<tr><th>${weekly ? 'Week ' + (w + 1) : 'Days ' + (w * 7 + 1) + '–' + Math.min(ro.len, w * 7 + 7)}</th>${Array.from({ length: 7 }, (_, j) => { const x = w * 7 + j; if (x >= ro.len) return '<td></td>'; const v = ro.cells[x]; return `<td><select class="rc rc-${CELL(v)}" data-cfg="${L}.${i}.cells.${x}" data-kind="str" data-rr="1" aria-label="${weekly ? 'Week ' + (w + 1) + ' ' + E.DAYS[j] : 'Day ' + (x + 1)}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}${opts.some(o => o[0] === v) ? '' : `<option selected value="${esc(v)}">${esc(v)}</option>`}</select></td>`; }).join('')}</tr>`;
      grid += '</tbody></table>';
      return `<div class="rotcard"><div class="form st-form" style="grid-template-columns:2fr 1fr 1fr auto;align-items:end">${inp(`${L}.${i}.name`, 'Rotation name')}${inp(`${L}.${i}.len`, 'Cycle length (days)', { type: 'number', min: 1, max: 56, rr: 1, hint: weekly ? (ro.len / 7) + ' week' + (ro.len > 7 ? 's' : '') : 'Not whole weeks: the pattern moves across weekdays' })}${inp(`${L}.${i}.anchor`, 'Day 1 of the cycle', { type: 'date', rr: 1 })}<div class="field"><span class="flabel">&nbsp;</span>${cnt[ro.id] ? `<span class="muted">${fmtN(cnt[ro.id])} agents</span>` : `<button class="btn sm" data-act="st-del" data-list="${L}" data-i="${i}">Remove</button>`}</div></div>
        <div class="tbl-wrap mt">${grid}</div><p class="note-s">${workDays} working day${workDays === 1 ? '' : 's'} in ${ro.len} (${fmtN(workDays / ro.len * 7, 1)} per week). The builder uses the band or template for the start time and the contract for the shift length.</p></div>`;
    };
    const teams = [...new Set(S.agents.map(a => a.team))].sort(), AS = U().assign || (U().assign = { rot: (saved[0] || {}).id || '', who: A.sel.size ? 'sel' : 'team', team: teams[0], start: 'stagger' });
    const sr = saved.find(x => x.id === AS.rot);
    const startOpts = sr ? [['stagger', 'Staggered: spread evenly over the cycle'], ...Array.from({ length: sr.len % 7 === 0 ? sr.len / 7 : sr.len }, (_, k) => [String(sr.len % 7 === 0 ? k * 7 : k), 'Everyone at ' + (sr.len % 7 === 0 ? 'week ' : 'day ') + (k + 1)])] : [['stagger', 'Staggered']];
    const byTeam = {}; S.agents.forEach(a => { if (a.rot) { const k = a.team; byTeam[k] = byTeam[k] || {}; byTeam[k][a.rot.id] = (byTeam[k][a.rot.id] || 0) + 1; } });
    return sec('Shift bands', 'Start-time windows used by rotations ("Early", "Mid", "Late") and by agent shift preferences.',
      `<div class="tbl-wrap"><table class="cfg" style="max-width:520px"><thead><tr><th>Band</th><th>Shift starts from</th><th>Up to</th></tr></thead><tbody>${bandRow('E', 'Early')}${bandRow('M', 'Mid')}${bandRow('L', 'Late')}</tbody></table></div>`) +
      sec('Rotation patterns', 'A repeating cycle of working days and shift types. Agents on a rotation work exactly these days; absences still take priority.',
        c.rotations.map(rotCard).join('') || '<p class="muted">No rotations yet.</p>',
        `<span class="actions"><select id="rot-preset" aria-label="Start from"><option value="blank">Blank weekly pattern</option><option value="R1">Early → Mid → Late</option><option value="R2">Weekend cover</option><option value="R3">4 on / 4 off</option><option value="R4">5 on / 2 off, days rotating</option></select><button class="btn sm" data-act="rot-add">Add rotation</button></span>`) +
      sec('Assign agents', 'Changes here apply straight away. Save new or changed rotations first.',
        saved.length ? `<div class="form st-form" style="align-items:end">
          <div class="field"><label for="ra-rot">Rotation</label><select id="ra-rot">${saved.map(x => `<option value="${esc(x.id)}" ${AS.rot === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="" ${AS.rot === '' ? 'selected' : ''}>Remove from rotation</option></select></div>
          <div class="field"><label for="ra-who">Agents</label><select id="ra-who"><option value="sel" ${AS.who === 'sel' ? 'selected' : ''}>Selected agents (${fmtN(A.sel.size)})</option><option value="team" ${AS.who === 'team' ? 'selected' : ''}>A whole team</option></select></div>
          ${AS.who === 'team' ? `<div class="field"><label for="ra-team">Team</label><select id="ra-team">${teams.map(t => `<option ${AS.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>` : ''}
          ${AS.rot ? `<div class="field"><label for="ra-start">Start</label><select id="ra-start">${startOpts.map(([k, l]) => `<option value="${k}" ${AS.start === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
          <div class="field"><button class="btn primary" data-act="rot-assign">${AS.rot ? 'Assign' : 'Remove'}</button></div></div>
          <div class="tbl-wrap mt"><table class="mini"><thead><tr><th>Rotation</th><th class="r">Agents</th><th>Teams</th></tr></thead><tbody>${saved.map(x => `<tr><td>${esc(x.name)}</td><td class="r num">${fmtN(cnt[x.id] || 0)}</td><td class="muted">${esc(Object.keys(byTeam).filter(t => byTeam[t][x.id]).slice(0, 8).join(', '))}${Object.keys(byTeam).filter(t => byTeam[t][x.id]).length > 8 ? ' …' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Save a rotation first.</p>');
  };
  R.scheduling = () => sec('Schedule builder', 'How the automatic schedule is built.',
    grid(sel('s.startStep', 'Shift start times', [[1, 'Every 15 minutes'], [2, 'Every 30 minutes'], [4, 'On the hour']], { kind: 'num' }),
      sel('s.consistency', 'Start-time consistency', [[0.02, 'Flexible: best coverage'], [0.15, 'Balanced'], [0.6, 'Same start every day']], { kind: 'num' }),
      inp('s.daysPerWeek', 'Default working days per week', { type: 'number', min: 1, max: 7, hint: 'For agents without a contract' }),
      inp('s.maxConsec', 'Default max days in a row', { type: 'number', min: 1, max: 14 }),
      inp('s.minRestH', 'Default minimum rest', { type: 'number', min: 0, max: 24, step: 0.5, unit: 'h' }),
      inp('s.maxPeriodDays', 'Longest planning period', { type: 'number', min: 7, max: 92, unit: 'days', hint: 'Longer periods take more time to build' })));
  R.codes = () => {
    const L = 's.cfg.timeCodes', list = gv(L);
    const adh = [['PROD', 'Production'], ['BREAK', 'Break'], ['MEAL', 'Meal'], ['MEET', 'Meeting'], ['TRAIN', 'Training'], ['COACH', 'Coaching'], ['NONE', 'Never in adherence']];
    return sec('Time codes', 'The statuses agents choose on the time clock. Inactive codes are hidden from agents but kept in history.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Colour</th><th>Code</th><th>Name</th><th>Paid</th><th>Billable</th><th>Matches schedule activity</th><th>Payroll code</th><th>Active</th><th></th></tr></thead><tbody>
      ${list.map((t, i) => `<tr><td><input type="color" data-cfg="${L}.${i}.color" data-kind="str" value="${esc(t.color)}" aria-label="Colour"></td><td>${t.builtin ? `<span class="mono">${esc(t.code)}</span>` : inp(`${L}.${i}.code`, '', { bare: 1, maxlength: 10, aria: 'Code' })}</td><td>${inp(`${L}.${i}.name`, '', { bare: 1, aria: 'Name' })}</td>
        <td class="c">${chk(`${L}.${i}.paid`, '', { bare: 1, aria: 'Paid' })}</td><td class="c">${chk(`${L}.${i}.billable`, '', { bare: 1, aria: 'Billable' })}</td><td>${sel(`${L}.${i}.adhAs`, '', t.code === 'TRB' || t.code === 'TRN' ? [['TRAIN', 'Training']] : adh, { bare: 1, dis: t.builtin, aria: 'Adherence' })}</td>
        <td>${inp(`${L}.${i}.payCode`, '', { bare: 1, aria: 'Payroll code', placeholder: 'e.g. 1001' })}</td><td class="c">${chk(`${L}.${i}.off`, '', { bare: 1, inv: 1, dis: t.code === 'PROD', aria: 'Active' })}</td><td>${t.builtin ? '' : delBtn(L, i, 'Remove code')}</td></tr>`).join('')}
      </tbody></table></div>`, addBtn(L, 'Add time code'));
  };
  R.clock = () => {
    const c = 's.cfg.clock';
    return sec('Time clock', 'What agents can do when they clock in and change status.',
      `<div class="st-checks">${chk(c + '.confirm', 'Ask agents to confirm every status change', { hint: 'Shows the confirmation pop-up before a status is switched' })}${chk(c + '.correctionReason', 'Corrections need a reason')}${chk(c + '.agentEdit', 'Agents may request corrections to their own punches')}</div>` +
      grid(sel(c + '.earlyLogin', 'Earliest log in before shift', [[-1, 'No limit'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']], { kind: 'num' }),
        sel(c + '.autoLogoutH', 'Log out automatically after', [[0, 'Never'], [10, '10 hours'], [12, '12 hours'], [14, '14 hours'], [16, '16 hours']], { kind: 'num', hint: 'Catches agents who forget to log out' }))) +
      sec('Adherence', 'How strictly the real status is compared with the schedule.',
        grid(inp(c + '.adhTarget', 'Adherence target', { type: 'number', min: 50, max: 100, unit: '%' }), inp(c + '.grace', 'Grace for late start and early finish', { type: 'number', min: 0, max: 30, unit: 'min', hint: 'Lateness within this is not counted' }), inp(c + '.exceptionMin', 'Flag an exception after', { type: 'number', min: 1, max: 60, unit: 'min out of adherence' })));
  };
  R.payroll = () => {
    const p = 's.cfg.payroll', rd = gv(p + '.round');
    return sec('Rounding', 'Applied to log in and log out times on timesheets and payroll.',
      grid(sel(p + '.round', 'Rounding rule', [['none', 'No rounding: exact minutes'], ['nearest', 'To the nearest interval'], ['employee', 'In favour of the employee'], ['company', 'In favour of the company']], { rr: 1 }),
        rd === 'none' ? '' : sel(p + '.roundMin', 'Interval', [[1, '1 minute'], [5, '5 minutes'], [6, '6 minutes (1/10 h)'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes']], { kind: 'num' }))) +
      sec('Pay period and premiums', 'Overtime, Sunday and public-holiday hours are added to the Payroll summary export.',
        grid(sel(p + '.period', 'Pay period', [['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['semimonthly', 'Twice a month'], ['monthly', 'Monthly']]),
          inp(p + '.otDailyH', 'Overtime after (per day)', { type: 'number', min: 1, max: 24, step: 0.5, unit: 'h' }), inp(p + '.otWeeklyH', 'Overtime after (per week)', { type: 'number', min: 1, max: 80, step: 0.5, unit: 'h' }), inp(p + '.otRate', 'Overtime rate', { type: 'number', min: 1, max: 3, step: 0.05, unit: '×' }),
          inp(p + '.sundayRate', 'Sunday rate', { type: 'number', min: 1, max: 3, step: 0.05, unit: '×' }), inp(p + '.holidayRate', 'Public holiday rate', { type: 'number', min: 1, max: 3, step: 0.05, unit: '×' }),
          tsel(p + '.nightFrom', 'Night premium from', { step: 30 }), tsel(p + '.nightTo', 'Night premium until', { step: 30 }), inp(p + '.nightRate', 'Night rate', { type: 'number', min: 1, max: 3, step: 0.05, unit: '×' })));
  };
  R.absences = () => {
    const L = 's.cfg.absTypes', list = gv(L);
    return sec('Absence types', 'Every type of time away. PTO is paid time off; non-PTO is unpaid unless marked paid; working away covers training days and trips.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Paid</th><th>Uses annual leave</th><th>Booked ahead</th><th>Agents can request</th><th class="r">Max days / year</th><th>Payroll code</th><th>Active</th><th></th></tr></thead><tbody>
      ${list.map((x, i) => `<tr><td>${x.builtin ? `<span class="mono">${esc(x.code)}</span>` : inp(`${L}.${i}.code`, '', { bare: 1, maxlength: 10, aria: 'Code' })}</td><td>${inp(`${L}.${i}.name`, '', { bare: 1, aria: 'Name' })}</td>
        <td>${sel(`${L}.${i}.cat`, '', [['pto', 'PTO'], ['npto', 'Non-PTO'], ['work', 'Working away']], { bare: 1, rr: 1, aria: 'Category' })}</td><td class="c">${x.cat === 'npto' ? chk(`${L}.${i}.paid`, '', { bare: 1, aria: 'Paid' }) : '<span class="muted">yes</span>'}</td>
        <td class="c">${chk(`${L}.${i}.leave`, '', { bare: 1, aria: 'Uses annual leave' })}</td><td class="c">${chk(`${L}.${i}.planned`, '', { bare: 1, aria: 'Booked ahead' })}</td><td class="c">${chk(`${L}.${i}.self`, '', { bare: 1, aria: 'Agents can request' })}</td>
        <td>${inp(`${L}.${i}.maxYear`, '', { type: 'number', bare: 1, min: 0, max: 366, aria: 'Max days per year' })}</td><td>${inp(`${L}.${i}.payCode`, '', { bare: 1, aria: 'Payroll code' })}</td>
        <td class="c">${chk(`${L}.${i}.off`, '', { bare: 1, inv: 1, aria: 'Active' })}</td><td>${x.builtin ? '' : delBtn(L, i, 'Remove type')}</td></tr>`).join('')}
      </tbody></table></div><p class="note-s">0 days per year means no limit. Inactive types stay on past records but can't be booked.</p>`, addBtn(L, 'Add absence type'));
  };
  R.leave = () => {
    const l = 's.cfg.leave', B = l + '.blackout', bl = gv(B);
    return sec('Annual leave', '', grid(inp(l + '.annualDays', 'Annual leave entitlement', { type: 'number', min: 0, max: 60, unit: 'days' }),
      sel(l + '.accrual', 'Entitlement is', [['upfront', 'Given at the start of the leave year'], ['monthly', 'Earned monthly'], ['perPeriod', 'Earned each pay period']]),
      sel(l + '.yearStart', 'Leave year starts', MONTHS.map((m, i) => [i + 1, m]), { kind: 'num' }), inp(l + '.carryMax', 'Carry over up to', { type: 'number', min: 0, max: 60, unit: 'days' }),
      sel(l + '.carryUntil', 'Carried days expire end of', MONTHS.map((m, i) => [i + 1, m]), { kind: 'num' }),
      field(l + '.halfDays', '', chk(l + '.halfDays', 'Allow half days'), '')) ) +
      sec('Booking rules', 'Checked when agents request time off and shown to the approver.',
        grid(inp(l + '.minNotice', 'Minimum notice', { type: 'number', min: 0, max: 365, unit: 'days', hint: '0 = no notice needed' }), inp(l + '.maxConsec', 'Longest single booking', { type: 'number', min: 0, max: 60, unit: 'days', hint: '0 = no limit' }), inp(l + '.maxOffPct', 'Most of a team off on one day', { type: 'number', min: 0, max: 100, unit: '%', hint: '0 = use only the staffing allowance' }))) +
      sec('Blackout periods', 'Dates when time off can\'t be booked, such as peak season.',
        `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Name</th><th>From</th><th>To</th><th></th></tr></thead><tbody>${bl.map((b, i) => `<tr><td>${inp(`${B}.${i}.name`, '', { bare: 1, aria: 'Name' })}</td><td>${inp(`${B}.${i}.from`, '', { type: 'date', bare: 1, aria: 'From' })}</td><td>${inp(`${B}.${i}.to`, '', { type: 'date', bare: 1, aria: 'To' })}</td><td>${delBtn(B, i, 'Remove blackout')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No blackout periods</td></tr>'}</tbody></table></div>`, addBtn(B, 'Add blackout period'));
  };
  R.requests = () => {
    const r = 's.cfg.requests';
    return sec('Request types', 'Turn request types on or off and choose how they are approved.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Request</th><th>Enabled</th><th>Approval</th><th class="r">Min notice (days)</th></tr></thead><tbody>
      ${REQ_TYPES.map(([k, l]) => `<tr><td><b>${l}</b></td><td class="c">${chk(`${r}.types.${k}.on`, '', { bare: 1, aria: l + ' enabled' })}</td><td>${sel(`${r}.types.${k}.approval`, '', [['manual', 'Always reviewed by a person'], ['auto', 'Automatic when all rules pass'], ['always', 'Automatic unless impossible']], { bare: 1, aria: l + ' approval' })}</td><td>${inp(`${r}.types.${k}.notice`, '', { type: 'number', bare: 1, min: 0, max: 90, aria: l + ' notice' })}</td></tr>`).join('')}
      </tbody></table></div>`) +
      sec('Approval workflow', '', grid(sel(r + '.approver', 'Who approves', [['supervisor', 'The agent\'s supervisor'], ['planner', 'WFM planners'], ['either', 'Supervisor or WFM planner']]),
        sel(r + '.escalateH', 'Escalate if not decided within', [[0, 'Never'], [24, '24 hours'], [48, '48 hours'], [72, '72 hours']], { kind: 'num' }),
        inp(r + '.maxSwapsMonth', 'Shift swaps per agent per month', { type: 'number', min: 0, max: 31, hint: '0 = no limit' })) +
        `<div class="st-checks">${chk(r + '.reasonRequired', 'Agents must give a reason')}${chk(r + '.cancelPending', 'Agents can cancel requests that are still pending')}</div>`);
  };
  R.roles = () => {
    const L = 's.cfg.roles', roles = gv(L);
    const cell = (i, r, path, label, isView) => { const lock = r.id === 'planner'; const v = isView ? (r.views || []).includes(path) : !!(r.perms || {})[path]; return `<td class="c"><input type="checkbox" ${v || lock ? 'checked' : ''} ${lock ? 'disabled' : ''} data-cfg="${L}.${i}.${isView ? 'views' : 'perms.' + path}" data-kind="${isView ? 'arr' : 'bool'}" data-val="${path}" aria-label="${esc(r.name)}: ${esc(label)}"></td>`; };
    return sec('Roles & permissions', 'What each role can see and do. Use "View as" at the top to try a role. Agents always see only their own self-service page.',
      `<div class="tbl-wrap"><table class="cfg roles"><thead><tr><th>Screen or action</th>${roles.map((r, i) => `<th class="c">${r.builtin ? `<b>${esc(r.name)}</b>` : `${inp(`${L}.${i}.name`, '', { bare: 1, aria: 'Role name' })}`}${r.builtin ? '' : `<button class="linkbtn" data-act="st-del" data-list="${L}" data-i="${i}">Remove</button>`}</th>`).join('')}</tr></thead><tbody>
      <tr class="grp"><td colspan="${roles.length + 1}">Screens</td></tr>
      ${VIEWS.map(([k, l]) => `<tr><td>${l}</td>${roles.map((r, i) => cell(i, r, k, l, true)).join('')}</tr>`).join('')}
      <tr class="grp"><td colspan="${roles.length + 1}">Actions</td></tr>
      ${PERMS.map(([k, l]) => `<tr><td>${l}</td>${roles.map((r, i) => cell(i, r, k, l, false)).join('')}</tr>`).join('')}
      </tbody></table></div><p class="note-s">The administrator role always keeps full access so nobody is locked out of Settings.</p>`, addBtn(L, 'Add role'));
  };
  R.notify = () => {
    const n = 's.cfg.notify';
    return sec('Notifications', 'Who is told about what, and how.',
      `<div class="tbl-wrap"><table class="cfg"><thead><tr><th>Event</th><th>Sent to</th><th class="c">In the app</th><th class="c">Email</th><th class="c">SMS</th></tr></thead><tbody>
      ${NOTIFY.map(([k, l, who]) => `<tr><td>${l}</td><td class="muted">${who}</td>${['inapp', 'email', 'sms'].map(ch => `<td class="c">${chk(`${n}.events.${k}.${ch}`, '', { bare: 1, aria: l + ' ' + ch })}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>` + grid(sel(n + '.digest', 'Email summary for managers', [['off', 'Off'], ['daily', 'Daily'], ['weekly', 'Weekly']]), tsel(n + '.quietFrom', 'Quiet hours from', { step: 30 }), tsel(n + '.quietTo', 'Quiet hours until', { step: 30 })) + serverNote);
  };
  R.security = () => {
    const s = 's.cfg.security';
    return sec('Security & sign-in', '', grid(sel(s + '.sso', 'Single sign-on', [['none', 'Off: email and password'], ['entra', 'Microsoft Entra ID'], ['google', 'Google Workspace'], ['okta', 'Okta'], ['saml', 'Other SAML 2.0']]),
      sel(s + '.mfa', 'Two-step verification', [['off', 'Off'], ['optional', 'Optional'], ['admins', 'Required for planners and supervisors'], ['all', 'Required for everyone']]),
      inp(s + '.pwdMin', 'Minimum password length', { type: 'number', min: 8, max: 64, unit: 'characters' }),
      sel(s + '.sessionMin', 'Sign out after inactivity', [[30, '30 minutes'], [60, '1 hour'], [240, '4 hours'], [480, '8 hours'], [720, '12 hours']], { kind: 'num' }),
      sel(s + '.retention', 'Keep time and audit records for', [[12, '12 months'], [24, '24 months'], [36, '3 years'], [72, '6 years'], [120, '10 years']], { kind: 'num' }),
      field(s + '.ipAllow', 'Allowed IP ranges', `<textarea id="${fid(s + '.ipAllow')}" data-cfg="${s}.ipAllow" data-kind="str" rows="3" placeholder="One range per line, e.g. 203.0.113.0/24">${esc(gv(s + '.ipAllow'))}</textarea>`, 'Empty = sign in from anywhere')) + serverNote);
  };
  R.data = () => {
    const S = A.S, only = U().auditSet;
    const log = S.audit.filter(x => !only || /setting|holiday|special/i.test(x.action)).slice(0, 40);
    return sec('Backup and move settings', 'Export the full configuration to a file, or load one from another Peovala site. Imported settings are shown as unsaved changes so you can review them first.',
      `<div class="actions"><button class="btn" data-act="st-export">Export settings</button><label class="btn">Import settings<input type="file" id="st-import" accept=".json,application/json" hidden></label><button class="btn" data-act="st-defaults">Restore default settings</button></div>`) +
      sec('Audit log', 'Latest changes. The full log is in Reports & exports.',
        `<label class="check sm"><input type="checkbox" data-act="st-audit" ${only ? 'checked' : ''}> Settings changes only</label><div class="tbl-wrap mt"><table class="mini"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Detail</th></tr></thead><tbody>${log.map(x => `<tr><td class="num">${new Date(x.ts).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(x.who)}</td><td>${esc(x.action)}</td><td>${esc(x.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No changes yet</td></tr>'}</tbody></table></div>`) +
      sec('Demo data', 'Everything is stored in this browser only.', `<div class="actions"><button class="btn danger" data-act="reset-demo">Reset to demo data</button><button class="btn" data-act="clear-agents">Start with an empty roster</button></div>`);
  };

  /* ---------- view ---------- */
  A.VIEWS.settings = {
    html() {
      if (!U().d) newDraft();
      const st = U(), q = st.q.trim().toLowerCase();
      const match = t => !q || (t[2] + ' ' + t[3] + ' ' + t[0]).toLowerCase().includes(q) || q.split(/\s+/).every(w => (t[2] + ' ' + t[3]).toLowerCase().includes(w));
      const vis = TABS.filter(match);
      if (!TABS.some(t => t[1] === st.tab)) st.tab = 'company';
      const cur = TABS.find(t => t[1] === st.tab);
      let nav = '', g = '';
      vis.forEach(t => { if (t[0] !== g) { nav += `${g ? '</div>' : ''}<div class="st-g"><div class="nav-h">${t[0]}</div>`; g = t[0]; } nav += `<button data-act="st-tab" data-val="${t[1]}" ${t[1] === st.tab ? 'aria-current="page"' : ''}>${t[2]}${st.errs.some(e => e.tab === t[1]) ? '<span class="errdot" aria-label="has errors"></span>' : ''}</button>`; });
      nav += g ? '</div>' : '<p class="muted" style="padding:0 10px">No settings match.</p>';
      const errs = st.errs.length ? `<div class="note crit st-errs"><b>Fix ${st.errs.length} problem${st.errs.length > 1 ? 's' : ''} before saving</b><ul class="issues">${st.errs.map(e => `<li><button class="linkbtn" data-act="st-tab" data-val="${e.tab}">${esc(TABS.find(t => t[1] === e.tab)[2])}</button>: ${esc(e.msg)}</li>`).join('')}</ul></div>` : '';
      const bar = barHTML();
      return A.head('Administration', 'Settings', 'Set Peovala up the way your company works: hours, queues, contracts, time codes, absence, approvals, access and more.', `<input id="st-q" type="search" placeholder="Search settings" value="${esc(st.q)}" aria-label="Search settings" class="st-search">`) +
        `<div class="st-layout"><nav class="st-nav" aria-label="Settings sections">${nav}</nav><div class="st-main"><div class="st-title"><span class="eyebrow">${esc(cur[0])}</span><h2>${esc(cur[2])}</h2></div>${errs}${R[st.tab]()}</div></div>
        <div class="st-bar" id="st-bar" role="region" aria-label="Unsaved changes" ${bar ? '' : 'hidden'}>${bar}</div>`;
    },
    after() { const b = document.querySelector('.st-nav button[aria-current="page"]'), n = document.querySelector('.st-nav'); if (b && n && n.scrollWidth > n.clientWidth) n.scrollLeft = b.offsetLeft - 8; const bar = document.getElementById('st-bar'); if (bar) bar._h = barHTML(); }
  };

  /* ---------- editing ---------- */
  function onCfg(e) {
    const t = e.target; if (!t.dataset || !t.dataset.cfg || !U().d) return;
    const k = t.dataset.kind, p = t.dataset.cfg;
    if (e.type === 'input' && (k === 'bool' || k === 'notbool' || k === 'arr' || t.tagName === 'SELECT')) return;
    let v;
    if (k === 'bool') v = t.checked;
    else if (k === 'notbool') v = !t.checked;
    else if (k === 'arr') { const arr = (gv(p) || []).filter(x => x !== t.dataset.val); if (t.checked) arr.push(t.dataset.val); v = arr; }
    else if (k === 'num') v = t.value === '' ? null : +t.value;
    else if (k === 'pct') v = t.value === '' ? null : Math.round(+t.value * 100) / 10000;
    else v = t.value;
    A.setPath(U().d, p, v);
    if (t.id === 'cf-accent') A.setPath(U().d, p, v.toLowerCase());
    if (e.type === 'change' && t.dataset.rr) { const y = scrollY; A.render(); scrollTo(0, y); } else updateBar();
  }
  document.addEventListener('input', onCfg);
  document.addEventListener('change', onCfg);
  document.addEventListener('input', e => { if (e.target.id === 'st-q') { U().q = e.target.value; const v = TABS.filter(t => (t[2] + ' ' + t[3]).toLowerCase().includes(U().q.trim().toLowerCase())); if (v.length && !v.some(t => t[1] === U().tab)) U().tab = v[0][1]; A.rerenderKeepFocus('st-q'); } });
  document.addEventListener('change', e => {
    const t = e.target, H = U().hol;
    if (t.id === 'hol-region') { H.region = t.value; A.render(); }
    else if (t.id === 'hol-year') { H.year = +t.value; A.render(); }
    else if (t.id === 'hol-factor') { H.factor = +t.value; }
    else if (t.id === 'st-import' && t.files[0]) importFile(t.files[0]);
    else if (['ra-rot', 'ra-who', 'ra-team', 'ra-start'].includes(t.id)) { const AS = U().assign; AS[t.id.slice(3)] = t.value; if (t.id === 'ra-rot') AS.start = 'stagger'; rr(); }
  });

  const NEW_ROW = {
    's.cfg.sites': () => ({ name: 'New site', tz: (cfg() || {}).regional ? cfg().regional.tz : 'Europe/Berlin', region: 'DE-NW', address: '', active: true }),
    's.cfg.fields': () => ({ key: 'field_' + (gv('s.cfg.fields').length + 1), label: 'New field', type: 'text', options: '', required: false }),
    's.cfg.contracts': () => ({ id: 'K' + Date.now().toString(36).slice(-5).toUpperCase(), name: 'New contract', hours: 25, days: 5, minWeekH: 0, maxWeekH: 30, maxDayH: 8, maxConsec: 6, minRestH: 11, otAllowed: true }),
    's.cfg.templates': () => ({ name: 'New shift', start: 540, end: 1050 }),
    's.cfg.breakRules': () => { const l = gv('s.cfg.breakRules'), last = l[l.length - 1]; return { from: last ? last.from + 1 : 4, breaks: last ? last.breaks : 1, breakMin: last ? last.breakMin : 15, lunchMin: last ? last.lunchMin : 0 }; },
    's.cfg.timeCodes': () => { let n = 1; while (gv('s.cfg.timeCodes').some(t => t.code === 'CUST' + n)) n++; return { code: 'CUST' + n, name: 'New status', paid: true, billable: false, color: '#6b7a78', off: false, builtin: false, adhAs: 'NONE', payCode: '' }; },
    's.cfg.absTypes': () => { let n = 1; while (gv('s.cfg.absTypes').some(t => t.code === 'ABS' + n)) n++; return { code: 'ABS' + n, name: 'New absence type', cat: 'npto', paid: false, leave: false, planned: true, self: false, maxYear: 0, off: false, builtin: false, payCode: '' }; },
    's.cfg.leave.blackout': () => ({ name: 'Peak season', from: E.today(), to: E.addDays(E.today(), 14) }),
    's.cfg.roles': () => ({ id: 'role' + Date.now().toString(36).slice(-4), name: 'New role', builtin: false, views: ['overview', 'schedule'], perms: {} })
  };
  const rr = () => { const y = scrollY; A.render(); scrollTo(0, y); };
  Object.assign(A.ACTS, {
    'st-tab': t => { U().tab = t.dataset.val; A.render(); const m = document.querySelector('.st-main'); if (m && m.getBoundingClientRect().top < 0) m.scrollIntoView({ block: 'start' }); },
    'st-add': t => { const l = gv(t.dataset.list); l.push(NEW_ROW[t.dataset.list]()); rr(); },
    'st-del': t => { gv(t.dataset.list).splice(+t.dataset.i, 1); rr(); },
    'st-set': t => { A.setPath(U().d, t.dataset.p, t.dataset.v); rr(); },
    'st-discard': () => { newDraft(); A.render(); A.toast('Changes discarded'); },
    'st-save': () => save(),
    'st-copy-mon': () => { const w = gv('s.cfg.week'); for (let i = 1; i < 5; i++) w[i] = clone(w[0]); rr(); },
    'st-copy-all': () => { const w = gv('s.cfg.week'); for (let i = 1; i < 7; i++) w[i] = clone(w[0]); rr(); },
    'st-q-defaults': () => { const d = U().d; d.queues.forEach(q => { q.slTarget = d.s.slTarget; q.slSeconds = d.s.slSeconds; q.maxOcc = d.s.maxOcc; q.shrinkage = d.s.shrinkage; }); rr(); A.toast('Defaults copied to every queue. Save to apply.'); },
    'st-preset': t => {
      const d = U().d, c = d.s.cfg, v = t.dataset.v;
      const P = { DE: { rest: 11, day: 10, week: 48, consec: 6, br: [[4, 1, 15, 0], [6.25, 1, 15, 30], [8, 2, 15, 30], [9.25, 2, 15, 45]] }, UK: { rest: 11, day: 12, week: 48, consec: 6, br: [[4, 1, 15, 0], [6.25, 1, 15, 30], [8, 2, 15, 30]] }, US: { rest: 8, day: 12, week: 60, consec: 6, br: [[4, 1, 15, 0], [6.25, 1, 15, 30], [8, 2, 15, 30]] } }[v];
      c.contracts.forEach(k => { k.minRestH = P.rest; k.maxDayH = P.day; k.maxWeekH = Math.max(k.hours, Math.min(P.week, k.hours + 8)); k.maxConsec = P.consec; });
      c.breakRules = P.br.map(([from, breaks, breakMin, lunchMin]) => ({ from, breaks, breakMin, lunchMin }));
      d.s.minRestH = P.rest; if (v === 'US') { c.payroll.otWeeklyH = 40; c.payroll.otDailyH = 12; c.payroll.otRate = 1.5; } else { c.payroll.otWeeklyH = 40; c.payroll.otDailyH = 10; }
      rr(); A.toast(`${t.textContent} loaded. Review and save.`);
    },
    'st-export': () => {
      const S = A.S, d = U().d, data = { app: 'Peovala', kind: 'settings', version: 1, exported: new Date().toISOString(), settings: d.s, queues: d.queues, specials: S.specials };
      A.saveFile(`Peovala_settings_${E.today()}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      A.log('Settings exported', 'JSON backup');
    },
    'st-defaults': t => {
      if (!t.classList.contains('armed')) { t.classList.add('armed'); t.textContent = 'Click again to restore defaults'; return; }
      const S = A.S, base = E.defaultSettings(), d = U().d;
      Object.keys(base).forEach(k => { if (k !== 'periodStart' && k !== 'periodEnd' && k !== 'timezone') d.s[k] = base[k]; });
      d.s.cfg = defaults(Object.assign({}, base, { timezone: S.settings.timezone }), S);
      d.queues.forEach(q => { q.slTarget = base.slTarget; q.slSeconds = base.slSeconds; q.maxOcc = base.maxOcc; q.shrinkage = base.shrinkage; q.channel = 'voice'; q.concurrency = 1; });
      rr(); A.toast('Defaults loaded as unsaved changes. Save to apply.');
    },
    'rot-add': () => {
      const c = U().d.s.cfg, pv = ($('#rot-preset') || {}).value || 'blank', anchor = E.weekStart(A.S.settings.periodStart);
      let id = 1; while (c.rotations.some(r => r.id === 'R' + id)) id++;
      const P = rotationPresets(anchor), ro = pv === 'blank' ? { name: 'New rotation', len: 7, anchor, cells: ['any', 'any', 'any', 'any', 'any', 'off', 'off'] }
        : pv === 'R4' ? { name: '5 on / 2 off (days rotate)', len: 7 * 7, anchor, cells: Array.from({ length: 49 }, (_, x) => ((x % 7) - Math.floor(x / 7) + 7) % 7 >= 5 ? 'off' : 'any') }
        : clone(P.find(r => r.id === pv));
      ro.id = 'R' + id; c.rotations.push(ro); rr();
    },
    'rot-assign': () => {
      const S = A.S, AS = U().assign, saved = (cfg() || {}).rotations || [], ro = saved.find(x => x.id === AS.rot);
      const list = AS.who === 'sel' ? [...A.sel].map(id => A.agent(id)).filter(Boolean) : S.agents.filter(a => a.team === AS.team);
      if (!list.length) { A.toast(AS.who === 'sel' ? 'Select agents first (tick the boxes next to their names)' : 'This team has no agents'); return; }
      A.snapshot(list.map(a => a.id), 'Assign rotation');
      if (!ro) list.forEach(a => delete a.rot);
      else { const groups = ro.len % 7 === 0 ? ro.len / 7 : ro.len, unit = ro.len % 7 === 0 ? 7 : 1; list.forEach((a, i) => { a.rot = { id: ro.id, off: AS.start === 'stagger' ? (i % groups) * unit : +AS.start }; }); }
      A.log(ro ? 'Rotation assigned' : 'Rotation removed', `${ro ? ro.name + ': ' : ''}${list.length} agent${list.length > 1 ? 's' : ''}${AS.who === 'team' ? ' in ' + AS.team : ''}${ro && AS.start === 'stagger' ? ', staggered' : ''}`, true);
      A.save(); rr(); A.toast(`${list.length} agent${list.length > 1 ? 's' : ''} ${ro ? 'now on ' + ro.name : 'taken off their rotation'}. Build the schedule to apply.`);
    },
    'st-audit': t => { U().auditSet = t.checked; rr(); },
    'hol-add': () => {
      const S = A.S, H = U().hol, have = new Set(S.specials.map(x => x.date + '|' + (x.queue || '')));
      const add = holidays(H.region, H.year).filter(h => !have.has(h.date + '|'));
      if (!add.length) { A.toast('These holidays are already in the list'); return; }
      add.forEach(h => S.specials.push({ date: h.date, name: h.name, factor: H.factor }));
      S.specials.sort((a, b) => a.date < b.date ? -1 : 1);
      A.log('Holidays added', `${add.length} holidays, ${REGIONS.find(r => r[0] === H.region)[1]} ${H.year}`, true);
      A.reqChanged(`${add.length} holidays added. Requirement recalculated.`);
    }
  });
  function importFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const x = JSON.parse(rd.result);
        if (!x || x.kind !== 'settings' || !x.settings || !x.settings.cfg) throw new Error('This is not a Peovala settings file');
        const d = U().d, S = A.S;
        Object.keys(x.settings).forEach(k => { if (!['periodStart', 'periodEnd'].includes(k)) d.s[k] = x.settings[k]; });
        d.s.cfg = fill(d.s.cfg, defaults(d.s, S));
        (x.queues || []).forEach(q => { const t = d.queues.find(y => y.id === q.id); if (t) Object.assign(t, q); });
        U().importSpecials = x.specials || null;
        rr(); A.toast(`Settings loaded from ${file.name}: ${changedPaths().length} changes to review. Save to apply.`);
      } catch (e) { A.toast('Could not read the file: ' + e.message); }
    };
    rd.readAsText(file);
  }

  /* ---------- validation & save ---------- */
  function validate(d) {
    const e = [], c = d.s.cfg, push = (tab, msg) => e.push({ tab, msg }), num = v => typeof v === 'number' && isFinite(v);
    if (!String(c.company.name || '').trim()) push('company', 'Enter the company name');
    const open = c.week.filter(w => !w.closed);
    if (!open.length) push('hours', 'The centre must be open on at least one day');
    c.week.forEach((w, i) => { if (!w.closed && !(w.close - w.open >= 120)) push('hours', `${DAYN[i]}: opening hours must cover at least 2 hours`); });
    if (open.length) { const lo = Math.floor(Math.min(...open.map(w => w.open)) / 60), hi = Math.ceil(Math.max(...open.map(w => w.close)) / 60); if (hi - lo < 4) push('hours', 'Opening hours must span at least 4 hours across the week'); }
    d.queues.forEach(q => {
      if (!String(q.name || '').trim()) push('queues', `${q.id}: enter a name`);
      if (!(q.aht >= 10 && q.aht <= 7200)) push('queues', `${q.name}: handle time must be 10–7,200 seconds`);
      if (!(q.slTarget >= 0.01 && q.slTarget <= 0.99)) push('queues', `${q.name}: service level target must be 1–99%`);
      if (!(q.slSeconds >= 1)) push('queues', `${q.name}: answered-within must be at least 1 second`);
      if (!(q.maxOcc >= 0.5 && q.maxOcc <= 1)) push('queues', `${q.name}: occupancy must be 50–100%`);
      if (!(q.shrinkage >= 0 && q.shrinkage <= 0.6)) push('queues', `${q.name}: shrinkage must be 0–60%`);
      if (!(q.concurrency >= 1 && q.concurrency <= 6)) push('queues', `${q.name}: concurrency must be 1–6`);
    });
    if (!(d.s.slTarget >= 0.01 && d.s.slTarget <= 0.99)) push('queues', 'Default service level must be 1–99%');
    if (!c.contracts.length) push('contracts', 'Keep at least one contract');
    c.contracts.forEach(k => {
      const n = k.name || 'A contract';
      if (!String(k.name || '').trim()) push('contracts', 'Every contract needs a name');
      if (!(k.hours >= 1 && k.hours <= 60)) push('contracts', `${n}: weekly hours must be 1–60`);
      if (!(k.days >= 1 && k.days <= 7 && Number.isInteger(k.days))) push('contracts', `${n}: days per week must be a whole number 1–7`);
      if (num(k.hours) && num(k.days) && num(k.maxDayH) && k.hours / k.days > k.maxDayH + 1e-9) push('contracts', `${n}: ${fmtN(k.hours / k.days, 2)} h a day is more than the daily maximum of ${k.maxDayH} h`);
      if (num(k.minWeekH) && num(k.maxWeekH) && k.minWeekH > k.maxWeekH) push('contracts', `${n}: minimum weekly hours are above the maximum`);
      if (num(k.maxWeekH) && k.maxWeekH < k.hours) push('contracts', `${n}: maximum weekly hours are below the contract hours`);
      if (!(k.maxConsec >= 1 && k.maxConsec <= 14)) push('contracts', `${n}: days in a row must be 1–14`);
      if (!(k.minRestH >= 0 && k.minRestH <= 24)) push('contracts', `${n}: rest must be 0–24 h`);
    });
    c.breakRules.forEach((b, i) => { if (!(b.from >= 0) || !(b.breaks >= 0 && b.breaks <= 6) || !(b.breakMin >= 0 && b.breakMin <= 60) || !(b.lunchMin >= 0 && b.lunchMin <= 120)) push('breaks', `Rule ${i + 1}: check the numbers`); });
    if (new Set(c.breakRules.map(b => b.from)).size !== c.breakRules.length) push('breaks', 'Two rules start at the same shift length');
    ['E', 'M', 'L'].forEach(k => { const b = c.bands[k]; if (!(b.to >= b.from)) push('rotations', `${{ E: 'Early', M: 'Mid', L: 'Late' }[k]} band: "up to" is before "from"`); });
    c.rotations.forEach(r => { if (!String(r.name || '').trim()) push('rotations', 'Every rotation needs a name'); if (!(r.len >= 1 && r.len <= 56)) push('rotations', `${r.name}: cycle length must be 1–56 days`); if (!E.valid(r.anchor)) push('rotations', `${r.name}: choose day 1 of the cycle`); if (!r.cells.some(x => x !== 'off')) push('rotations', `${r.name}: has no working days`); });
    c.templates.forEach(t => { if (!String(t.name || '').trim()) push('templates', 'Every template needs a name'); if (!(t.end > t.start)) push('templates', `${t.name}: must end after it starts`); });
    const codeRe = /^[A-Z][A-Z0-9_]{1,9}$/;
    c.timeCodes.forEach(t => { if (!codeRe.test(t.code)) push('codes', `"${t.code}": codes are 2–10 capital letters or digits`); if (!String(t.name || '').trim()) push('codes', `${t.code}: enter a name`); });
    if (new Set(c.timeCodes.map(t => t.code)).size !== c.timeCodes.length) push('codes', 'Two time codes use the same code');
    if (['LOGIN', 'LOGOUT', 'OUT', 'TRAIN', 'OUTX'].some(x => c.timeCodes.some(t => t.code === x))) push('codes', 'LOGIN, LOGOUT, OUT, TRAIN and OUTX are reserved');
    c.absTypes.forEach(t => { if (!codeRe.test(t.code)) push('absences', `"${t.code}": codes are 2–10 capital letters or digits`); if (!String(t.name || '').trim()) push('absences', `${t.code}: enter a name`); });
    if (new Set(c.absTypes.map(t => t.code)).size !== c.absTypes.length) push('absences', 'Two absence types use the same code');
    if (!c.absTypes.some(t => !t.off)) push('absences', 'Keep at least one absence type active');
    if (!(c.leave.annualDays >= 0 && c.leave.annualDays <= 60)) push('leave', 'Annual leave must be 0–60 days');
    c.leave.blackout.forEach(b => { if (!E.valid(b.from) || !E.valid(b.to) || b.to < b.from) push('leave', `${b.name || 'Blackout'}: check the dates`); });
    c.fields.forEach(f => { if (!/^[a-z][a-z0-9_]{0,30}$/.test(f.key)) push('fields', `"${f.key}": keys are lowercase letters, digits and _`); if (!String(f.label || '').trim()) push('fields', 'Every field needs a label'); });
    if (new Set(c.fields.map(f => f.key)).size !== c.fields.length) push('fields', 'Two fields use the same key');
    c.roles.forEach(r => { if (!String(r.name || '').trim()) push('roles', 'Every role needs a name'); });
    c.sites.forEach(s => { if (!String(s.name || '').trim()) push('sites', 'Every site needs a name'); });
    if (!(d.s.maxPeriodDays >= 7 && d.s.maxPeriodDays <= 92)) push('scheduling', 'The longest planning period must be 7–92 days');
    if (!(c.clock.adhTarget >= 50 && c.clock.adhTarget <= 100)) push('clock', 'Adherence target must be 50–100%');
    if (!(c.payroll.otDailyH > 0) || !(c.payroll.otWeeklyH > 0)) push('payroll', 'Overtime thresholds must be above 0');
    return e;
  }
  function save() {
    const S = A.S, s = S.settings, d = U().d, errs = validate(d);
    U().errs = errs;
    if (errs.length) { A.render(); A.toast(`${errs.length} problem${errs.length > 1 ? 's' : ''} to fix before saving`); return; }
    const changed = changedPaths();
    if (!changed.length && !U().importSpecials) { A.toast('Nothing to save'); return; }
    const c = d.s.cfg, open = c.week.filter(w => !w.closed);
    d.s.openH = Math.floor(Math.min(...open.map(w => w.open)) / 60); d.s.closeH = Math.min(24, Math.ceil(Math.max(...open.map(w => w.close)) / 60));
    const gridChanged = d.s.openH !== s.openH || d.s.closeH !== s.closeH;
    const has = re => changed.some(p => re.test(p));
    const rebuild = gridChanged || has(/^s\.cfg\.(week|breakRules)|^s\.cfg\.contracts(\.\d+(\.(hours|days))?)?$|^s\.(startStep|consistency|minGapMin|daysPerWeek)/);
    const reqCalc = rebuild || has(/^queues|^s\.(slTarget|slSeconds|maxOcc|shrinkage)|^s\.cfg\.regional\.weekStart/) || !!U().importSpecials;
    const oldTabs = [...new Set(changed.map(p => tabOf(p)))].filter(Boolean);
    const keep = { periodStart: s.periodStart, periodEnd: s.periodEnd };
    Object.keys(d.s).forEach(k => { s[k] = clone(d.s[k]); }); Object.assign(s, keep);
    d.queues.forEach(q => { const t = S.queues.find(x => x.id === q.id); if (!t) return; ['name', 'aht', 'channel', 'concurrency', 'slTarget', 'slSeconds', 'maxOcc', 'shrinkage'].forEach(k => (t[k] = q[k])); });
    if (U().importSpecials) { S.specials = U().importSpecials; U().importSpecials = null; }
    if (A.UI.role !== 'planner' && A.UI.role !== 'agent' && !s.cfg.roles.some(r => r.id === A.UI.role)) A.UI.role = 'planner';
    applyCfg();
    if (gridChanged) {
      S.queues.forEach(q => { delete q.override; delete q.overrideDow; });
      S.agents.forEach(a => { a.earliest = Math.max(a.earliest, s.openH * 60); a.latest = Math.min(a.latest, s.closeH * 60); if (a.latest <= a.earliest) { a.earliest = s.openH * 60; a.latest = s.closeH * 60; } a.shifts = {}; });
      S.builtDays = []; A.UI.id.now = A.UI.ad.now = null;
    }
    S.demo = false;
    A.log('Settings changed', `${changed.length} change${changed.length > 1 ? 's' : ''}: ${oldTabs.map(t => TABS.find(x => x[1] === t)[2]).join(', ')}${rebuild ? '; schedule rebuilt' : ''}`, true);
    const done = () => { newDraft(); A.toast(rebuild ? 'Settings saved. Schedule rebuilt with the new rules (locked shifts kept).' : reqCalc ? 'Settings saved. Forecast and staffing recalculated.' : 'Settings saved'); };
    if (reqCalc || rebuild) A.withBusy(rebuild ? 'Applying settings and rebuilding the schedule…' : 'Applying settings…', () => { A.derive(); if (rebuild) A.buildNow({ silent: true }); done(); });
    else { A.save(); done(); A.render(); }
  }
  function tabOf(p) {
    const m = p.match(/^s\.cfg\.([a-zA-Z]+)/);
    const map = { company: 'company', regional: 'regional', sites: 'sites', fields: 'fields', week: 'hours', contracts: 'contracts', breakRules: 'breaks', templates: 'templates', rotations: 'rotations', bands: 'rotations', timeCodes: 'codes', clock: 'clock', payroll: 'payroll', absTypes: 'absences', leave: 'leave', requests: 'requests', roles: 'roles', notify: 'notify', security: 'security' };
    if (m) return map[m[1]] || null;
    if (/^queues|^s\.(slTarget|slSeconds|maxOcc|shrinkage)/.test(p)) return 'queues';
    if (/^s\.minGapMin/.test(p)) return 'breaks';
    if (/^s\./.test(p)) return 'scheduling';
    return null;
  }

  /* ---------- keep the configuration applied ---------- */
  const baseDerive = A.derive;
  A.derive = function () { applyCfg(); return baseDerive.apply(this, arguments); };
  const baseFresh = A.freshDemo;
  A.freshDemo = function () { if (A.UI.st) A.UI.st.d = null; return baseFresh.apply(this, arguments); };
})();
