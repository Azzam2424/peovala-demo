/* Peovala app core: state, persistence, undo, audit, exports, charts, shell, generic events */
(function () {
  const E = window.Engine;
  const A = window.App = {};
  A.E = E;
  const esc = A.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = A.fmtN = (v, d = 0) => (v == null || isNaN(v) || !isFinite(v)) ? '–' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  A.pct = (v, d = 1) => (v == null || isNaN(v)) ? '–' : fmtN(v * 100, d) + '%';
  const $ = A.$ = s => document.querySelector(s);
  A.VIEWS = {};
  A.ACTS = {};
  A.CH = {};

  /* ---------- state ---------- */
  A.S = null;
  A.UI = {
    view: 'overview', role: 'planner', me: 'A0001',
    ov: { queue: 0 }, fc: { queue: 0, date: null, method: 'avg', weeks: 6, vol: 0, aht: 0 }, cap: { queue: -1 },
    sc: { mode: 'day', date: null, queue: 0, team: '', q: '', page: 0 }, rq: { tab: 'pending', type: '', queue: '' },
    act: { type: 'M', dur: 60, mode: 'group', from: null, to: null, early: null, late: null, teams: [], plan: null, q: '' },
    id: { queue: 0, date: null, now: null, seed: 11 }, ad: { date: null, now: null, queue: -1, team: '', onlyOut: 'out', seed: 3 },
    emp: { q: '', queue: '', hours: '', site: '', skill: '', page: 0 }, rep: { key: 'daily' }, portal: { tab: 'time' },
    drawer: null, modal: null, busy: null
  };
  try { const x = JSON.parse(localStorage.getItem('intervala.view') || 'null'); if (x) { A.UI.view = x.v || A.UI.view; A.UI.sc.mode = x.m || 'day'; } } catch (e) { }

  A.freshDemo = function () {
    const settings = E.defaultSettings(), queues = E.defaultQueues();
    settings.periodStart = E.addDays(E.weekStart(E.today()), -7); settings.periodEnd = E.addDays(settings.periodStart, 20); // demo: last week, this week, next week
    settings.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const agents = E.generateAgents(3000, queues, settings, 42);
    E.calibrate(queues, agents, settings, 1.02);
    A.S = {
      v: 3, settings, queues, specials: E.defaultSpecials(settings.periodStart), agents,
      requests: [], audit: [], pub: { version: 0, at: null }, changes: 0, builtDays: [], warnings: [], seed: 7, demo: true,
      history: {}, acks: {}, punches: {},
      capacity: { horizon: 26, attrition: 2.5, classes: [{ week: 4, queue: 'TEC', heads: 25, train: 4, nest: 2 }, { week: 10, queue: 'BIL', heads: 30, train: 3, nest: 2 }] }
    };
    queues.forEach((q, i) => { A.S.history[q.id] = E.genHistory(q, settings, settings.periodStart, 16, 100 + i, A.S.specials); });
    A.derive();
    A.buildNow({ silent: true });
    A.seedRequests();
    A.S.audit = [];
    A.log('Demo data loaded', '3,000 agents, 4 queues');
    A.S.changes = 0;
  };

  A.derive = function () {
    const S = A.S;
    S.days = E.range(S.settings.periodStart, S.settings.periodEnd);
    S.idx = {}; S.agents.forEach((a, i) => { S.idx[a.id] = i; a.shifts = a.shifts || {}; a.absence = a.absence || {}; a.skills = a.skills || []; });
    S.R = E.computeRequirements(S.queues, S.settings, S.days, S.specials);
    A.refresh();
    const fix = o => { if (!o.date || !S.days.includes(o.date)) o.date = S.days[0]; };
    [A.UI.fc, A.UI.sc, A.UI.id, A.UI.ad].forEach(fix);
  };
  A.refresh = function () {
    const S = A.S;
    const cov = E.netCoverage(S.agents, S.queues, S.settings, S.days);
    S.net = cov.net; S.sched = cov.sched;
    S.rep = E.report(S.queues, S.settings, S.R, S.net);
    A.save();
  };
  A.agent = id => A.S.agents[A.S.idx[id]];
  A.qIndex = id => A.S.queues.findIndex(q => q.id === id);
  A.dayK = iso => A.S.days.indexOf(iso);
  A.unbuiltDays = () => { const b = new Set(A.S.builtDays); return A.S.days.filter(d => !b.has(d)); };

  A.buildNow = function (opts = {}) {
    const S = A.S;
    const qs = opts.queue != null && opts.queue >= 0 ? [opts.queue] : S.queues.map((_, i) => i);
    if (!opts.silent) A.snapshot(S.agents.filter(a => qs.includes(A.qIndex(a.queue))).map(a => a.id), 'Build schedule');
    if (opts.unlock) S.agents.forEach(a => { if (qs.includes(A.qIndex(a.queue))) S.days.forEach(d => { if (a.shifts[d]) a.shifts[d].locked = false; }); });
    const t0 = performance.now();
    const res = E.buildSchedule(S.agents, qs.map(i => S.queues[i]), S.settings, qs.map(i => S.R[i]), S.days, S.seed);
    const qids = new Set(qs.map(i => S.queues[i].id));
    S.agents.forEach((a, ai) => {
      if (!qids.has(a.queue)) return;
      S.days.forEach(d => { const cur = a.shifts[d]; if (cur && cur.locked) return; const w = res.shifts[ai][d]; if (w) a.shifts[d] = w; else delete a.shifts[d]; });
    });
    S.warnings = res.warnings;
    S.builtDays = Array.from(new Set(S.builtDays.concat(S.days))).sort();
    S.buildMs = performance.now() - t0; S.builtAt = Date.now(); S.stale = false;
    A.refresh();
    if (!opts.silent) A.log('Schedule built', `${S.days.length} days, ${qs.length === S.queues.length ? 'all queues' : S.queues[qs[0]].name}, ${fmtN(S.buildMs)} ms`, true);
  };
  A.withBusy = function (msg, fn) {
    A.UI.busy = msg; A.renderOverlay();
    setTimeout(async () => { try { await fn(); } catch (e) { A.toast(e.message); } finally { A.UI.busy = null; A.render(); } }, 30);
  };
  // same helpers as the server edition, working on browser storage
  A.persistDays = async () => { A.save(); return true; };
  A.persistAgentsAll = async () => { A.save(); return true; };
  A.saveAgentLeave = () => A.save();
  A.call = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) A.toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; } catch (e) { A.toast(e.message); return null; } };

  /* ---------- audit, undo, publish ---------- */
  A.who = () => A.UI.role === 'agent' ? (A.agent(A.UI.me) || {}).name || 'Agent' : A.UI.role === 'supervisor' ? 'Supervisor' : 'Planner';
  A.log = function (action, detail, change) {
    A.S.audit.unshift({ ts: Date.now(), who: A.who(), action, detail });
    if (A.S.audit.length > 800) A.S.audit.length = 800;
    if (change) A.S.changes++;
  };
  const undo = [], redo = [];
  const cloneShifts = a => JSON.parse(JSON.stringify({ shifts: a.shifts, absence: a.absence, leaveUsed: a.leaveUsed }));
  A.snapshot = function (ids, label) {
    undo.push({ label, items: ids.map(id => ({ id, data: cloneShifts(A.agent(id)) })) });
    if (undo.length > 25) undo.shift();
    redo.length = 0;
  };
  function swap(from, to) {
    const e = from.pop(); if (!e) return null;
    to.push({ label: e.label, items: e.items.map(x => ({ id: x.id, data: cloneShifts(A.agent(x.id)) })) });
    e.items.forEach(x => { const a = A.agent(x.id); if (a) Object.assign(a, x.data); });
    A.refresh(); return e.label;
  }
  A.undo = () => { const l = swap(undo, redo); if (l) { A.log('Undo', l, true); A.toast('Undone: ' + l); } A.render(); };
  A.redo = () => { const l = swap(redo, undo); if (l) { A.log('Redo', l, true); A.toast('Redone: ' + l); } A.render(); };
  A.canUndo = () => undo.length > 0; A.canRedo = () => redo.length > 0;
  A.undoLabel = () => undo.length ? undo[undo.length - 1].label : '';

  /* ---------- persistence (IndexedDB) ---------- */
  const DBN = 'intervala', ST = 'state';
  function idb() { return new Promise((res, rej) => { try { const r = indexedDB.open(DBN, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }); }
  let saveT;
  A.save = function () {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      try {
        const S = A.S, pack = {};
        Object.keys(S).forEach(k => { if (!['R', 'net', 'sched', 'rep', 'days', 'idx'].includes(k)) pack[k] = S[k]; });
        const db = await idb(); const tx = db.transaction(ST, 'readwrite'); tx.objectStore(ST).put(JSON.parse(JSON.stringify(pack)), 'main');
      } catch (e) { }
    }, 700);
  };
  A.load = async function () {
    try {
      const db = await idb();
      const v = await new Promise((res, rej) => { const r = db.transaction(ST).objectStore(ST).get('main'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      if (!v || v.v !== 3) return false;
      v.settings = Object.assign(E.defaultSettings(), v.settings);
      A.S = v; A.derive(); return true;
    } catch (e) { return false; }
  };

  /* ---------- exports ---------- */
  let dl = null;
  if (window.claude && window.claude.use) window.claude.use('downloads').then(d => { dl = d; }).catch(() => { });
  A.saveFile = async function (filename, data) {
    if (dl) {
      try { await dl.save({ filename, data }); A.toast('Saved ' + filename); return; }
      catch (e) { if (e && e.code === 'declined') return; if (e && e.code === 'rate_limited') { A.toast('A save prompt is already open'); return; } }
    }
    try {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      if (!(window.claude && window.claude.use)) A.toast('Saved ' + filename);
      else if (!dl) A.toast('Downloads are not available in this view. Open the page in a browser tab to save files.');
    } catch (e) { A.toast('Could not save the file in this view'); }
  };
  // sheets: [{name, rows:[[...]], widths?:[]}]
  A.exportXLSX = function (filename, sheets) {
    if (!window.XLSX) { A.toast('Excel library did not load. Check your connection and reload.'); return; }
    const wb = XLSX.utils.book_new();
    sheets.forEach(sh => {
      const ws = XLSX.utils.aoa_to_sheet(sh.rows);
      const widths = sh.widths || (sh.rows[0] || []).map((_, c) => Math.min(42, Math.max(8, ...sh.rows.slice(0, 200).map(r => String(r[c] == null ? '' : r[c]).length + 2))));
      ws['!cols'] = widths.map(w => ({ wch: w }));
      if (sh.rows.length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, (sh.rows[0] || []).length - 1) } }) };
      XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    });
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
    A.saveFile(filename, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    A.log('Exported to Excel', filename);
  };
  A.fileStamp = () => A.S.settings.periodStart + '_to_' + A.S.settings.periodEnd;

  /* ---------- small helpers ---------- */
  A.nI = () => E.nInt(A.S.settings);
  A.tLabel = i => E.fmt(E.idxToMin(i, A.S.settings));
  A.slPill = sl => { const t = A.S.settings.slTarget; const c = sl >= t ? 'good' : sl >= t - 0.05 ? 'warn' : 'crit'; return `<span class="pill ${c}">${sl >= t ? 'On target' : sl >= t - 0.05 ? 'At risk' : 'Below target'}</span>`; };
  A.toast = function (msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 3200); };
  A.niceStep = raw => { if (raw <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
  A.paidHours = (a, days) => (days || A.S.days).reduce((t, d) => t + (a.shifts[d] ? E.paidInt(a.shifts[d]) / 4 : 0), 0);
  A.shiftText = w => w ? `${A.tLabel(w.s)}–${A.tLabel(w.s + w.len)}` : 'Off';
  A.band = w => { if (!w) return 'off'; const st = E.idxToMin(w.s, A.S.settings); return st < 9 * 60 ? 'early' : st < 12 * 60 ? 'mid' : 'late'; };
  A.getPath = (o, p) => p.split('.').reduce((x, k) => x == null ? x : x[k], o);
  A.setPath = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); const t = ks.reduce((x, k) => x[k], o); t[last] = v; };
  A.allowance = function (qi, k) {
    const d = A.S.rep.queues[qi].days[k];
    return Math.max(0, Math.floor((d.netH - d.reqH) / 7.5));
  };
  A.dateStepper = function (path, cur, days) {
    days = days || A.S.days;
    const i = days.indexOf(cur);
    return `<div class="dstep"><button class="btn sm" data-dstep="${path}" data-dir="-1" ${i <= 0 ? 'disabled' : ''} aria-label="Previous day">‹</button><select data-bind="${path}" aria-label="Date">${days.map(d => `<option value="${d}" ${d === cur ? 'selected' : ''}>${E.fmtDate(d)}${A.special(d) ? ' ★' : ''}</option>`).join('')}</select><button class="btn sm" data-dstep="${path}" data-dir="1" ${i >= days.length - 1 ? 'disabled' : ''} aria-label="Next day">›</button></div>`;
  };
  A.special = (d, qid) => A.S.specials.find(s => s.date === d && (!qid || !s.queue || s.queue === qid));
  A.queueSeg = function (path, cur, all) {
    return `<div class="seg" role="group">${all ? `<button data-set="${path}" data-val="-1" data-type="num" aria-pressed="${cur === -1}">All queues</button>` : ''}${A.S.queues.map((q, i) => `<button data-set="${path}" data-val="${i}" data-type="num" aria-pressed="${cur === i}">${esc(q.name)}</button>`).join('')}</div>`;
  };
  A.head = (eyebrow, title, desc, actions) => `<div class="head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}</div><div class="actions">${actions || ''}</div></div>`;
  A.staleBanner = function () {
    const un = A.unbuiltDays();
    if (!un.length) return '';
    return `<div class="banner"><span><b>${un.length} day${un.length > 1 ? 's' : ''} in this period have no schedule yet</b> (${E.fmtDate(un[0])}${un.length > 1 ? ' – ' + E.fmtDate(un[un.length - 1]) : ''}). Build the schedule to cover them; locked shifts stay as they are.</span><button class="btn primary sm" data-act="build-open">Build schedule</button></div>`;
  };

  /* ---------- charts ---------- */
  A.drawChart = function (id, cfg) {
    const el = document.getElementById(id); if (!el) return;
    const W = Math.max(260, el.clientWidth), H = cfg.height || 200, m = { l: 48, r: 10, t: 10, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b, n = cfg.n, bw = pw / n;
    let max = cfg.ymax || 0; if (!cfg.ymax) cfg.series.forEach(s => s.values.forEach(v => { if (v != null && v > max) max = v; }));
    let min = cfg.ymin != null ? cfg.ymin : 0;
    const step = A.niceStep(((max - min) || 1) / 4), ymax = cfg.ymax || Math.ceil((max || 1) / step) * step;
    const y = v => m.t + ph - ((v - min) / ((ymax - min) || 1)) * ph, x = i => m.l + i * bw;
    const xl = cfg.xl || A.tLabel, yf = cfg.yf || (v => fmtN(v, step < 1 ? 1 : 0));
    let g = '';
    for (let v = min; v <= ymax + 1e-9; v += step) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(${v === min ? '--line2' : '--line'})"/><text x="${m.l - 8}" y="${y(v) + 3.5}" text-anchor="end">${yf(v)}</text>`;
    (cfg.bands || []).forEach(b => { g += `<rect x="${x(b.i)}" y="${m.t}" width="${bw}" height="${ph}" fill="var(--sunk)"/>`; });
    const every = cfg.every || Math.max(1, Math.round(n / (W < 520 ? 4 : 8) / 4) * 4);
    for (let i = 0; i <= n; i += every) { if (cfg.xl && i >= n) break; g += `<text x="${cfg.xl ? x(i) + bw / 2 : x(i)}" y="${H - 6}" text-anchor="middle">${esc(xl(i))}</text>`; }
    cfg.series.forEach(s => {
      if (s.type !== 'bar') return;
      const gap = bw > 5 ? Math.min(2, bw * 0.15) : 0;
      s.values.forEach((v, i) => { if (v > min) { const h = Math.max(0, y(min) - y(v)); g += `<rect x="${x(i) + gap / 2}" y="${y(v)}" width="${Math.max(.5, bw - gap)}" height="${h}" rx="${bw > 8 ? 2 : 0}" fill="${s.color}" opacity="${s.opacity || 1}"/>`; } });
    });
    cfg.series.forEach(s => {
      if (s.type !== 'line' && s.type !== 'step') return;
      let d = '', pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        if (s.type === 'step') { d += (pen ? 'L' : 'M') + x(i) + ',' + y(v) + 'L' + x(i + 1) + ',' + y(v); }
        else d += (pen ? 'L' : 'M') + (x(i) + bw / 2) + ',' + y(v);
        pen = true;
      });
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
      if (s.type === 'line' && s.dots) s.values.forEach((v, i) => { if (v != null) g += `<circle cx="${x(i) + bw / 2}" cy="${y(v)}" r="3" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5"/>`; });
    });
    if (cfg.target != null) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(cfg.target)}" y2="${y(cfg.target)}" stroke="var(--ink2)" stroke-dasharray="3 3"/><text x="${W - m.r}" y="${y(cfg.target) - 4}" text-anchor="end" style="fill:var(--ink2)">target</text>`;
    if (cfg.now != null) g += `<line x1="${x(cfg.now)}" x2="${x(cfg.now)}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--ink)" stroke-dasharray="2 3"/><text x="${x(cfg.now) + 4}" y="${m.t + 10}" style="fill:var(--ink)">now</text>`;
    g += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="var(--ink2)" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
    const legend = cfg.series.length > 1 || cfg.legend ? `<div class="legend">${cfg.series.map(s => `<span><i class="${s.type === 'bar' ? 'box' : ''} ${s.dash ? 'dash' : ''}" style="background:${s.color};color:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    el.innerHTML = legend + `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.label || '')}">${g}</svg>`;
    A.CH[id] = { cfg, m, bw, n };
  };
  document.addEventListener('mousemove', e => {
    const tip = $('#tip');
    if (A.drag) return;
    const svg = e.target.closest && e.target.closest('.chart svg');
    document.querySelectorAll('.chart .xh').forEach(l => { if (!svg || !svg.contains(l)) l.setAttribute('visibility', 'hidden'); });
    const cell = e.target.closest && e.target.closest('[data-tip]');
    if (cell) { tip.innerHTML = cell.dataset.tip; placeTip(e); return; }
    const hc = e.target.closest && e.target.closest('.heat .c');
    if (hc && A.heatTip) { tip.innerHTML = A.heatTip(hc); placeTip(e); return; }
    if (!svg) { tip.hidden = true; return; }
    const c = A.CH[svg.parentElement.id]; if (!c) return;
    const r = svg.getBoundingClientRect(), i = Math.floor((e.clientX - r.left - c.m.l) / c.bw);
    const xh = svg.querySelector('.xh');
    if (i < 0 || i >= c.n) { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); return; }
    const cx = c.m.l + i * c.bw + c.bw / 2; xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
    const title = c.cfg.tt ? c.cfg.tt(i) : `${A.tLabel(i)}–${A.tLabel(i + 1)}`;
    tip.innerHTML = `<div class="t">${esc(title)}</div>` + c.cfg.series.map(s => `<div class="row"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><b>${s.values[i] == null ? '–' : (s.fmt ? s.fmt(s.values[i]) : fmtN(s.values[i], s.dp == null ? 1 : s.dp))}</b></div>`).join('') + (c.cfg.extra ? c.cfg.extra(i) : '');
    placeTip(e);
  });
  function placeTip(e) { const tip = $('#tip'); tip.hidden = false; const w = tip.offsetWidth, h = tip.offsetHeight; let X = e.clientX + 14, Y = e.clientY + 14; if (X + w > innerWidth - 8) X = e.clientX - w - 14; if (Y + h > innerHeight - 8) Y = e.clientY - h - 14; tip.style.left = X + 'px'; tip.style.top = Y + 'px'; }
  A.placeTip = placeTip;

  /* ---------- shell ---------- */
  const NAV = [
    ['Planning', [['overview', 'Overview'], ['forecast', 'Forecast'], ['capacity', 'Capacity plan']]],
    ['Scheduling', [['schedule', 'Schedule'], ['requests', 'Requests & time off'], ['activities', 'Activity planner']]],
    ['Real time', [['intraday', 'Intraday'], ['time', 'Time tracking'], ['adherence', 'Adherence']]],
    ['People & data', [['employees', 'Employees'], ['reports', 'Reports & exports'], ['settings', 'Settings']]]
  ];
  const ROLE_VIEWS = { planner: null, supervisor: ['overview', 'schedule', 'requests', 'activities', 'intraday', 'time', 'adherence', 'employees', 'reports'], agent: ['portal'] };
  A.allowed = v => A.UI.role === 'agent' ? v === 'portal' : (!ROLE_VIEWS[A.UI.role] || ROLE_VIEWS[A.UI.role].includes(v));
  function renderNav() {
    const S = A.S, pending = S.requests.filter(r => r.status === 'pending').length;
    let h = '';
    if (A.UI.role === 'agent') h = `<div class="nav-g"><div class="nav-h">Self-service</div><button data-nav="portal" aria-current="page">My schedule</button></div>`;
    else NAV.forEach(([g, items]) => {
      const vis = items.filter(([k]) => A.allowed(k)); if (!vis.length) return;
      h += `<div class="nav-g"><div class="nav-h">${g}</div>${vis.map(([k, l]) => `<button data-nav="${k}" ${A.UI.view === k ? 'aria-current="page"' : ''}><span>${l}</span>${k === 'requests' && pending ? `<span class="badge">${pending}</span>` : ''}</button>`).join('')}</div>`;
    });
    $('#nav').innerHTML = h;
    $('#railfoot').innerHTML = `${S.demo ? '<span class="chip demo">Demo data</span>' : ''}<span>${fmtN(S.agents.length)} agents · ${S.queues.length} queues</span>`;
  }
  function renderTop() {
    const S = A.S, s = S.settings, U = A.UI;
    const presets = [['', 'Quick range'], ['today', 'Today'], ['tw', 'This week'], ['pw', 'Previous week'], ['w0', 'Next week'], ['w2', 'Next 2 weeks'], ['w4', 'Next 4 weeks'], ['w6', 'Next 6 weeks'], ['m', 'Rest of this month']];
    const agentOpts = U.role === 'agent' ? `<select id="me-pick" data-bind="me" aria-label="Agent">${S.agents.slice(0, 400).map(a => `<option value="${a.id}" ${a.id === U.me ? 'selected' : ''}>${esc(a.name)} · ${a.id}</option>`).join('')}${S.idx[U.me] >= 400 ? `<option selected value="${U.me}">${esc(A.agent(U.me).name)}</option>` : ''}</select>` : '';
    $('#top').innerHTML = `
      <div class="period">
        <span class="flabel">Planning period</span>
        <input type="date" id="p-from" value="${s.periodStart}" aria-label="From date">
        <span class="muted">to</span>
        <input type="date" id="p-to" value="${s.periodEnd}" aria-label="To date">
        <button class="btn sm" data-act="period-apply">Apply</button>
        <select id="p-preset" aria-label="Quick range">${presets.map(([v, l]) => `<option value="${v}" ${U.preset && v && U.preset.v === v && U.preset.from === s.periodStart && U.preset.to === s.periodEnd ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="muted nowrap">${S.days.length} days</span>
      </div>
      <div class="top-r">
        ${U.role !== 'agent' ? `<div class="undo"><button class="btn sm ghost" data-act="undo" ${A.canUndo() ? '' : 'disabled'} title="${A.canUndo() ? 'Undo ' + esc(A.undoLabel()) : 'Nothing to undo'}">Undo</button><button class="btn sm ghost" data-act="redo" ${A.canRedo() ? '' : 'disabled'}>Redo</button></div>
        <button class="pubchip ${S.changes ? 'draft' : ''}" data-act="publish-open" title="Publish schedule">${S.changes ? `Draft · ${fmtN(S.changes)} change${S.changes > 1 ? 's' : ''}` : S.pub.version ? `Published v${S.pub.version}` : 'Not published'}</button>` : ''}
        <label class="role"><span class="flabel">View as</span><select data-bind="role" aria-label="Role">${A.roleOptions ? A.roleOptions(U.role) : `<option value="planner" ${U.role === 'planner' ? 'selected' : ''}>WFM planner</option><option value="supervisor" ${U.role === 'supervisor' ? 'selected' : ''}>Team supervisor</option><option value="agent" ${U.role === 'agent' ? 'selected' : ''}>Agent (self-service)</option>`}</select></label>
        ${agentOpts}
      </div>`;
  }
  A.render = function () {
    if (!A.allowed(A.UI.view)) A.UI.view = A.UI.role === 'agent' ? 'portal' : (NAV.flatMap(g => g[1].map(x => x[0])).find(k => A.allowed(k)) || 'overview');
    renderNav(); renderTop();
    try { localStorage.setItem('intervala.view', JSON.stringify({ v: A.UI.view, m: A.UI.sc.mode })); } catch (e) { }
    const v = A.VIEWS[A.UI.view];
    $('#main').innerHTML = v.html();
    if (v.after) v.after();
    A.renderOverlay();
  };
  A.renderOverlay = function () {
    const o = $('#overlay'), U = A.UI;
    if (U.busy) { o.innerHTML = `<div class="scrim"></div><div class="busy" role="status"><span class="spin"></span>${esc(U.busy)}</div>`; return; }
    if (U.drawer) { o.innerHTML = `<div class="scrim" data-act="close"></div>` + A.VIEWS.employees.drawer(); return; }
    if (U.modal) { o.innerHTML = `<div class="scrim" data-act="close"></div><div class="modal ${U.modal.wide ? 'wide' : ''}" role="dialog" aria-label="${esc(U.modal.title)}"><header><h2>${esc(U.modal.title)}</h2><button class="x" data-act="close" aria-label="Close">×</button></header><div class="body">${U.modal.body()}</div><footer>${U.modal.foot ? U.modal.foot() : '<button class="btn" data-act="close">Close</button>'}</footer></div>`; if (U.modal.after) U.modal.after(); return; }
    o.innerHTML = '';
  };
  A.openModal = function (title, body, foot, opts = {}) { A.UI.drawer = null; A.UI.modal = { title, body: typeof body === 'function' ? body : () => body, foot: typeof foot === 'function' ? foot : (foot ? () => foot : null), wide: opts.wide, after: opts.after }; A.renderOverlay(); };
  A.closeOverlay = function () { A.UI.drawer = null; A.UI.modal = null; A.renderOverlay(); };

  /* ---------- period ---------- */
  A.setPeriod = function (from, to) {
    const s = A.S.settings;
    if (!E.valid(from) || !E.valid(to)) { A.toast('Enter both dates'); return false; }
    if (to < from) { A.toast('The end date must be on or after the start date'); return false; }
    const n = E.diffDays(from, to) + 1;
    if (n > s.maxPeriodDays) { A.toast(`A planning period can cover up to ${s.maxPeriodDays} days. You chose ${n}.`); return false; }
    s.periodStart = from; s.periodEnd = to;
    A.derive();
    A.log('Planning period changed', `${E.fmtDateY(from)} – ${E.fmtDateY(to)}`);
    return true;
  };

  /* ---------- generic events ---------- */
  function coerce(el, v) { return el.dataset.type === 'num' ? +v : v; }
  document.addEventListener('click', e => {
    const t = e.target.closest('button, [data-act], [data-agent], [data-set], [data-row]'); if (!t || t.disabled) return;
    if (A.drag && A.drag.moved) return;
    const ds = t.dataset, U = A.UI;
    if (ds.nav) { U.view = ds.nav; A.closeOverlay(); A.render(); window.scrollTo(0, 0); return; }
    if (ds.set) { A.setPath(U, ds.set, coerce(t, ds.val)); if (ds.reset) ds.reset.split(' ').forEach(p => A.setPath(U, p, 0)); A.render(); return; }
    if (ds.dstep) { const cur = A.getPath(U, ds.dstep), days = A.S.days, i = days.indexOf(cur) + (+ds.dir); if (i >= 0 && i < days.length) { A.setPath(U, ds.dstep, days[i]); A.render(); } return; }
    if (ds.agent && !ds.act) { U.modal = null; U.drawer = ds.agent; U.drawerDate = ds.date || null; A.renderOverlay(); return; }
    if (ds.act && A.ACTS[ds.act]) { A.ACTS[ds.act](t, e); return; }
    if (ds.row && A.ACTS['row-' + ds.rowkind]) A.ACTS['row-' + ds.rowkind](t, e);
  });
  document.addEventListener('change', e => {
    const t = e.target, U = A.UI;
    if (t.dataset.bind) {
      let v = t.type === 'checkbox' ? t.checked : coerce(t, t.value);
      if (t.dataset.bind === 'role') { U.role = v; U.view = v === 'agent' ? 'portal' : U.view === 'portal' ? 'overview' : U.view; A.closeOverlay(); A.render(); return; }
      A.setPath(U, t.dataset.bind, v);
      if (t.dataset.reset) t.dataset.reset.split(' ').forEach(p => A.setPath(U, p, 0));
      if (!t.dataset.norender) A.render();
      return;
    }
    if (t.id === 'p-preset' && t.value) {
      const today = E.today(), tws = E.weekStart(today), base = E.addDays(tws, 7); let from = base, to;
      if (t.value === 'today') { from = to = today; }
      else if (t.value === 'tw') { from = tws; to = E.addDays(tws, 6); }
      else if (t.value === 'pw') { from = E.addDays(tws, -7); to = E.addDays(tws, -1); }
      else if (t.value === 'w0') to = E.addDays(base, 6); else if (t.value === 'w2') to = E.addDays(base, 13); else if (t.value === 'w4') to = E.addDays(base, 27); else if (t.value === 'w6') to = E.addDays(base, 41);
      else { from = today; const d = new Date(E.parse(from)); to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); }
      const sc = A.UI.sc;
      if (t.value === 'today') { if (sc.mode !== 'day') sc.mode = 'day'; }
      else if (['tw', 'pw', 'w0'].includes(t.value) && sc.mode === 'month') sc.mode = 'week';
      else if (!['tw', 'pw', 'w0'].includes(t.value) && (sc.mode === 'week' || sc.mode === 'month')) sc.mode = 'range';
      [A.UI.sc, A.UI.fc, A.UI.id, A.UI.ad].forEach(o => { if (o) o.date = from <= today && today <= to ? today : from; });
      A.UI.preset = { v: t.value, from, to };
      $('#p-from').value = from; $('#p-to').value = to; A.ACTS['period-apply']();
      return;
    }
    if (A.onChange) A.onChange(e);
  });
  document.addEventListener('input', e => { if (A.onInput) A.onInput(e); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (A.UI.drawer || A.UI.modal) && !A.UI.busy) A.closeOverlay();
    const tag = (e.target.tagName || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !['input', 'textarea', 'select'].includes(tag) && A.UI.role !== 'agent') {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); A.undo(); }
      else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); A.redo(); }
    }
    if (e.key === 'Enter' && e.target.closest && e.target.closest('tr[data-agent], tr[data-row]')) e.target.click();
  });
  A.rerenderKeepFocus = function (id) { const el = document.getElementById(id); const pos = el && el.selectionStart; A.render(); const n = document.getElementById(id); if (n) { n.focus(); try { if (pos != null) n.setSelectionRange(pos, pos); } catch (err) { } } };

  Object.assign(A.ACTS, {
    close: () => A.closeOverlay(),
    undo: () => A.undo(), redo: () => A.redo(),
    'period-apply': () => {
      const from = $('#p-from').value, to = $('#p-to').value;
      A.withBusy('Recalculating forecast and coverage…', () => { if (A.setPeriod(from, to)) A.toast(`Planning period set to ${A.S.days.length} days`); });
    },
    'build-open': () => {
      const S = A.S, un = A.unbuiltDays().length, locked = S.agents.reduce((t, a) => t + S.days.filter(d => a.shifts[d] && a.shifts[d].locked).length, 0);
      A.openModal('Build schedule', `<p class="muted" style="margin:0">Creates shifts, breaks and lunches for <b>${E.fmtDateY(S.settings.periodStart)} – ${E.fmtDateY(S.settings.periodEnd)}</b> (${S.days.length} days${un ? `, ${un} not built yet` : ''}) from the forecast, availability, absences and shift rules.</p>
        <div class="form" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="b-queue">Queues</label><select id="b-queue"><option value="-1">All queues</option>${S.queues.map((q, i) => `<option value="${i}">${esc(q.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="b-var">Solution</label><select id="b-var"><option value="same">Repeatable result</option><option value="new">Try a different solution</option></select></div>
        </div>
        <label class="check"><input type="checkbox" id="b-keep" checked> Keep ${fmtN(locked)} locked shifts (manual edits, approved requests, planned activities)</label>`,
        `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="build-run">Build schedule</button>`);
    },
    'build-run': () => {
      const q = +$('#b-queue').value, keep = $('#b-keep').checked;
      if ($('#b-var').value === 'new') A.S.seed = (A.S.seed || 7) + 1;
      A.closeOverlay();
      A.withBusy(`Building schedule for ${fmtN(A.S.agents.length)} agents across ${A.S.days.length} days…`, () => { A.buildNow({ queue: q, unlock: !keep }); A.toast(`Schedule built in ${fmtN(A.S.buildMs)} ms`); });
    },
    'publish-open': () => {
      const S = A.S;
      A.openModal('Publish schedule', `<p style="margin:0">Publishing makes the current schedule for <b>${E.fmtDateY(S.settings.periodStart)} – ${E.fmtDateY(S.settings.periodEnd)}</b> the official version agents see in self-service.</p>
        <div class="kv"><span>Current version</span><b>${S.pub.version ? 'v' + S.pub.version + ' · ' + new Date(S.pub.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never published'}</b><span>Changes since then</span><b>${fmtN(S.changes)}</b><span>Pending requests</span><b>${S.requests.filter(r => r.status === 'pending').length}</b><span>Rule warnings</span><b>${S.warnings.length}</b></div>`,
        `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="publish">Publish v${S.pub.version + 1}</button>`);
    },
    publish: () => { const S = A.S; S.pub = { version: S.pub.version + 1, at: Date.now(), from: S.settings.periodStart, to: S.settings.periodEnd }; S.changes = 0; A.log('Schedule published', 'Version ' + S.pub.version); A.closeOverlay(); A.save(); A.render(); A.toast('Schedule published as v' + S.pub.version); }
  });

  addEventListener('resize', () => { clearTimeout(A._rt); A._rt = setTimeout(() => { const v = A.VIEWS[A.UI.view]; if (v && v.after) v.after(); }, 160); });
})();
