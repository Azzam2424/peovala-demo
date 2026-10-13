/* Time tracking: agent time clock, live status board, timesheets, corrections, punch-based adherence, payroll exports.
   Works in the server edition (A.api present) and in the browser-only demo (simulated punches + local storage). */
(function () {
  const A = window.App, E = A.E, esc = A.esc, fmtN = A.fmtN, pct = A.pct, $ = A.$;
  const SERVER = typeof A.api === 'function';
  const TC = A.TC = { cache: {}, loaded: {}, sheets: {} };
  const CODES = E.TIME_CODES;
  const codeName = c => c === 'OUT' ? 'Logged out' : c === 'LOGIN' ? 'Log in' : c === 'LOGOUT' ? 'Log out' : c === 'TRAIN' ? 'Training' : (CODES[c] || {}).name || c;
  TC.codeName = codeName;

  /* ---------- clock ---------- */
  TC.now = function () {
    try {
      const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
      if (SERVER && A.S.settings.timezone) opts.timeZone = A.S.settings.timezone;
      const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(new Date()), g = t => parts.find(p => p.type === t).value;
      return { date: `${g('year')}-${g('month')}-${g('day')}`, min: (+g('hour') % 24) * 60 + +g('minute') };
    } catch (e) { const d = new Date(); return { date: E.today(), min: d.getHours() * 60 + d.getMinutes() }; }
  };
  TC.endMin = date => { const n = TC.now(); return date < n.date ? 1440 : date === n.date ? n.min : -1; };
  TC.pastDays = () => A.S.days.filter(d => TC.endMin(d) >= 0);
  TC.defaultDate = () => { const ds = TC.pastDays(), n = TC.now(); if (!ds.length) return null; if (ds.includes(n.date) && n.min >= A.S.settings.openH * 60) return n.date; return ds.filter(d => d < n.date).pop() || ds[ds.length - 1]; };

  /* ---------- data ---------- */
  function demoEvents(a, date) {
    const end = TC.endMin(date); if (end < 0) return [];
    const loc = A.S.punches && A.S.punches[date] && A.S.punches[date][a.id];
    const ev = loc || E.simulatePunches(a, date, a.shifts[date], A.S.settings, 7).map((e, i) => Object.assign({ id: 's' + i, src: 'clock' }, e));
    return ev.filter(e => e.t <= end);
  }
  TC.events = (a, date) => {
    if (!a) return [];
    if (!SERVER) return demoEvents(a, date);
    const end = TC.endMin(date); if (end < 0) return [];
    return ((TC.cache[date] || {})[a.id] || []).filter(e => e.t <= end);
  };
  TC.ready = date => !SERVER || TC.loaded[date] === true || TC.endMin(date) < 0;
  TC.ensureDay = function (date) {
    if (!SERVER || !date || TC.loaded[date] || TC.endMin(date) < 0) return;
    TC.loaded[date] = 'loading';
    A.api('GET', `/time/day?date=${date}`).then(r => { TC.cache[date] = r.events || {}; TC.loaded[date] = true; A.render(); })
      .catch(e => { TC.loaded[date] = false; A.toast(e.message); });
  };
  // server sync: [{id, agent, date, t, code, note, by, src, deleted}]
  TC.applyRemote = function (list) {
    let changed = false;
    (list || []).forEach(x => {
      if (!TC.loaded[x.date]) return;
      const day = TC.cache[x.date] = TC.cache[x.date] || {}, arr = day[x.agent] = day[x.agent] || [];
      const i = arr.findIndex(e => e.id === x.id);
      if (x.deleted) { if (i >= 0) { arr.splice(i, 1); changed = true; } }
      else if (i < 0) { arr.push(x); arr.sort((p, q) => p.t - q.t); changed = true; }
      Object.keys(TC.sheets).forEach(k => delete TC.sheets[k]);
    });
    return changed;
  };
  function materialize(a, date) {
    const S = A.S; S.punches = S.punches || {}; S.punches[date] = S.punches[date] || {};
    if (!S.punches[date][a.id]) S.punches[date][a.id] = demoEvents(a, date).map(e => Object.assign({}, e));
    return S.punches[date][a.id];
  }
  TC.check = function (events, code, end) {
    const open = E.daySegments(events, end).open;
    if (code === 'LOGIN') return open ? 'You are already logged in.' : null;
    if (!open) return 'Log in first.';
    if (code === open) return `You are already in ${codeName(code)}.`;
    return null;
  };
  TC.punch = async function (code) {
    const a = A.agent(A.UI.me); if (!a) return;
    const n = TC.now(), err = TC.check(TC.events(a, n.date), code, n.min);
    if (err) { A.toast(err); return; }
    if (SERVER) {
      const r = await A.call(() => A.api('POST', '/time/punch', { code }), null, true); if (!r) return;
      TC.cache[r.date] = TC.cache[r.date] || {}; TC.cache[r.date][a.id] = r.events; TC.loaded[r.date] = true;
    } else {
      materialize(a, n.date).push({ id: 'l' + Date.now(), t: n.min, code, src: 'clock' }); A.save();
    }
    Object.keys(TC.sheets).forEach(k => delete TC.sheets[k]);
    A.toast(code === 'LOGIN' ? 'Logged in. You are in Production.' : code === 'LOGOUT' ? 'Logged out. Have a good evening.' : `Now in ${codeName(code)}`);
    A.render();
  };
  TC.addEvent = async function (a, date, t, code, note) {
    if (SERVER) {
      const r = await A.call(() => A.api('POST', '/time/events', { agent: a.id, date, t, code, note }), null, true); if (!r) return false;
      TC.cache[date] = TC.cache[date] || {}; TC.cache[date][a.id] = r.events;
    } else { const arr = materialize(a, date); arr.push({ id: 'c' + Date.now(), t, code, note, by: A.who(), src: 'correction' }); arr.sort((p, q) => p.t - q.t); A.log('Time corrected', `${a.name} ${E.fmtDate(date)}: added ${codeName(code)} ${E.fmt(t)} (${note})`); A.save(); }
    Object.keys(TC.sheets).forEach(k => delete TC.sheets[k]);
    return true;
  };
  TC.removeEvent = async function (a, date, id, note) {
    if (SERVER) {
      const r = await A.call(() => A.api('POST', `/time/events/${encodeURIComponent(id)}/delete`, { note }), null, true); if (!r) return false;
      TC.cache[date] = TC.cache[date] || {}; TC.cache[date][a.id] = r.events;
    } else { const arr = materialize(a, date), i = arr.findIndex(e => e.id === id); if (i >= 0) { const e = arr.splice(i, 1)[0]; A.log('Time corrected', `${a.name} ${E.fmtDate(date)}: removed ${codeName(e.code)} ${E.fmt(e.t)} (${note})`); } A.save(); }
    Object.keys(TC.sheets).forEach(k => delete TC.sheets[k]);
    return true;
  };

  /* ---------- per agent-day facts ---------- */
  TC.day = function (a, date) {
    const end = TC.endMin(date), w = a.shifts[date], ev = TC.events(a, date);
    const sum = E.daySummary(ev, Math.max(0, end)), adh = E.punchAdherence(w, ev, A.S.settings, Math.max(0, end));
    return { a, w, ev, end, sum, adh, absence: a.absence[date] };
  };
  // aggregated rows for a date range: demo computes locally, server asks the API
  TC.sheetRows = function (from, to) {
    const key = from + '|' + to;
    if (TC.sheets[key] && (Date.now() - TC.sheets[key].at < 60000)) return TC.sheets[key].rows;
    if (SERVER) {
      if (TC.sheets[key] && TC.sheets[key].pending) return TC.sheets[key].pending;
      const pending = A.api('GET', `/time/timesheets?from=${from}&to=${to}`).then(r => { TC.sheets[key] = { at: Date.now(), rows: r.rows }; return r.rows; });
      TC.sheets[key] = { at: 0, pending }; pending.catch(() => delete TC.sheets[key]);
      return pending;
    }
    const rows = [];
    E.range(from, to).forEach(d => { if (TC.endMin(d) < 0) return; A.S.agents.forEach(a => { const x = TC.day(a, d); if (!x.w && !x.ev.length && !x.absence) return; rows.push({ agent: a.id, date: d, login: x.sum.login, logout: x.sum.logout, mins: x.sum.mins, paid: x.sum.paid, billable: x.sum.billable, unpaid: x.sum.unpaid, sched: x.w ? E.paidInt(x.w) * 15 : 0, adh: x.adh.adh, conf: x.adh.conf, late: x.adh.late, early: x.adh.early, absence: x.absence || null, open: x.sum.open }); }); });
    TC.sheets[key] = { at: Date.now(), rows };
    return rows;
  };
  const range = () => { const ds = TC.pastDays(); return ds.length ? [ds[0], ds[ds.length - 1]] : null; };
  TC.range = range;

  /* ---------- small renderers ---------- */
  const pill = c => `<span class="tcpill tc-${c}">${esc(codeName(c))}</span>`;
  TC.pill = pill;
  const hrs = m => fmtN((m || 0) / 60, 2);
  function timeline(w, segs, end) {
    const s = A.S.settings;
    let lo = s.openH * 60, hi = s.closeH * 60;
    segs.forEach(g => { lo = Math.min(lo, Math.floor(g.from / 60) * 60); hi = Math.max(hi, Math.ceil(g.to / 60) * 60); });
    const span = hi - lo, X = m => ((m - lo) / span * 100).toFixed(3) + '%', W = (a, b) => ((b - a) / span * 100).toFixed(3) + '%';
    let sched = '';
    if (w) {
      const st = s.openH * 60 + w.s * 15;
      sched += `<span class="tl-seg tc-PROD" style="left:${X(st)};width:${W(st, st + w.len * 15)}"></span>`;
      w.acts.forEach(x => { const c = { B: 'BREAK', L: 'MEAL', M: 'MEET', T: 'TRB', C: 'COACH', O: 'PROD', X: 'OUTX' }[x.t]; const a0 = st + x.at * 15; sched += `<span class="tl-seg tc-${c}" style="left:${X(a0)};width:${W(a0, a0 + x.len * 15)}" title="${esc(E.ACT[x.t].name)} ${E.fmt(a0)}–${E.fmt(a0 + x.len * 15)}"></span>`; });
    }
    const act = segs.map(g => `<span class="tl-seg tc-${g.code}" style="left:${X(g.from)};width:${W(g.from, g.to)}" title="${esc(codeName(g.code))} ${E.fmt(g.from)}–${E.fmt(g.to)}"></span>`).join('');
    const ticks = []; for (let h = lo; h <= hi; h += 60) ticks.push(`<span style="left:${X(h)}">${String(h / 60).padStart(2, '0')}</span>`);
    const nowLine = end > lo && end < hi && end < 1440 ? `<span class="tl-now" style="left:${X(end)}"></span>` : '';
    return `<div class="tl"><div class="tl-lab">Scheduled</div><div class="tl-track">${sched}${nowLine}</div><div class="tl-lab">Actual</div><div class="tl-track">${act}${nowLine}</div><div></div><div class="tl-axis">${ticks.join('')}</div></div>`;
  }
  TC.timeline = timeline;
  const legend = () => `<div class="legend">${Object.keys(CODES).filter(c => !CODES[c].off).map(c => `<span><i class="box tc-${c}"></i>${esc(CODES[c].name)}</span>`).join('')}</div>`;

  /* ---------- agent self-service time clock ---------- */
  TC.portalHTML = function (a) {
    const n = TC.now(), today = n.date;
    if (SERVER && !TC.ready(today)) { TC.ensureDay(today); return '<p class="muted">Loading your time clock…</p>'; }
    const ev = TC.events(a, today), sum = E.daySummary(ev, n.min), w = a.shifts[today], open = sum.open;
    const adh = E.punchAdherence(w, ev, A.S.settings, n.min);
    const btn = (code, primary) => `<button class="tcbtn tc-${code} ${open === code ? 'on' : ''} ${primary ? 'primary' : ''}" data-act="tc-punch" data-code="${code}" ${open === code ? 'aria-pressed="true"' : ''}><span class="dot"></span>${esc(codeName(code))}</button>`;
    const r = range(), rows = r ? TC.sheetRows(r[0], r[1]) : [];
    let hist = '';
    if (rows && rows.then) { rows.then(() => A.render()); hist = '<p class="muted">Loading your timesheet…</p>'; }
    else {
      const mine = (rows || []).filter(x => x.agent === a.id).sort((p, q) => p.date < q.date ? 1 : -1);
      hist = `<div class="tbl-wrap"><table><thead><tr><th>Day</th><th>Shift</th><th>Log in</th><th>Log out</th><th class="r">Production</th><th class="r">Paid</th><th class="r">Billable</th><th class="r">Adherence</th></tr></thead><tbody>${mine.map(x => `<tr><td>${E.fmtDate(x.date)}</td><td class="num">${x.absence ? esc(E.ABS[x.absence] || x.absence) : A.shiftText(a.shifts[x.date])}</td><td class="num">${E.minToLabel(x.login)}</td><td class="num">${x.open ? 'logged in' : E.minToLabel(x.logout)}</td><td class="r num">${hrs(x.mins.PROD)} h</td><td class="r num">${hrs(x.paid)} h</td><td class="r num">${hrs(x.billable)} h</td><td class="r num">${x.adh == null ? '–' : pct(x.adh)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No time recorded yet.</td></tr>'}</tbody></table></div>`;
    }
    return `<div class="grid g-side">
      <section class="panel clock">
        <div class="clock-state"><span class="eyebrow">Your status</span><div class="clock-now">${open ? pill(open) : '<span class="tcpill tc-OUT">Logged out</span>'}${open ? `<span class="muted">since ${E.fmt(sum.openFrom)} · <span class="tc-dur" data-from="${sum.openFrom}">${E.durLabel(n.min - sum.openFrom)}</span></span>` : ''}</div>
          <p class="muted" style="margin:4px 0 0">Today: ${w ? 'scheduled ' + A.shiftText(w) : a.absence[today] ? esc(E.ABS[a.absence[today]]) : 'no shift scheduled'}${w && open && E.expectedAt(w, n.min, A.S.settings) !== open && !E.matches(E.expectedAt(w, n.min, A.S.settings), open) ? ` · <b class="warnink">scheduled now: ${esc(codeName(E.expectedAt(w, n.min, A.S.settings)))}</b>` : ''}</p></div>
        <div class="tcbtns">${open ? Object.keys(CODES).filter(c => !CODES[c].off || c === open).map(c => btn(c)).join('') + `<button class="tcbtn out" data-act="tc-punch" data-code="LOGOUT">Log out</button>` : `<button class="tcbtn primary big" data-act="tc-punch" data-code="LOGIN">Log in</button>`}</div>
        <div class="mt">${timeline(w, sum.segs, n.min)}</div>
        ${legend()}
      </section>
      <section class="panel" style="align-self:start"><h2>Today so far</h2><p class="sub">${sum.login != null ? 'First log in ' + E.fmt(sum.login) : 'Not logged in yet'}${adh.adh != null ? ' · adherence ' + pct(adh.adh) : ''}</p>
        <table class="mini"><tbody>${Object.keys(CODES).map(c => `<tr><td>${pill(c)}</td><td class="r num">${E.durLabel(sum.mins[c])}</td></tr>`).join('')}
        <tr><td><b>Paid time</b></td><td class="r num"><b>${E.durLabel(sum.paid)}</b></td></tr><tr><td>Billable</td><td class="r num">${E.durLabel(sum.billable)}</td></tr></tbody></table></section>
    </div>
    <section class="mt"><h2 style="font-size:15px;margin-bottom:8px">My timesheet</h2>${hist}</section>`;
  };
  A.ACTS['tc-punch'] = t => TC.punch(t.dataset.code);

  /* ---------- staff: time tracking view ---------- */
  A.UI.tt = { tab: 'live', date: null, queue: -1, team: '', filter: 'all', q: '', page: 0 };
  function dayRows(date) {
    const S = A.S, U = A.UI.tt, qid = U.queue >= 0 && S.queues[U.queue] ? S.queues[U.queue].id : null, q = U.q.trim().toLowerCase();
    return A.selFilter(S.agents.filter(a => (!qid || a.queue === qid) && (!U.team || a.team === U.team) && A.agentMatches(a, A.searchTerms(q))))
      .map(a => TC.day(a, date)).filter(x => x.w || x.ev.length);
  }
  A.VIEWS.time = {
    html() {
      const S = A.S, U = A.UI.tt, ds = TC.pastDays();
      const head = A.head('Real time', 'Time tracking', 'Agents log in, log out and switch states from their self-service page. Here you see who is working right now, their timesheets and adherence calculated from real punches. Corrections are kept in the audit log.',
        `<button class="btn" data-act="tt-export">Export timesheets</button><button class="btn primary" data-act="tt-payroll">Export payroll summary</button>`);
      if (!ds.length) return head + A.empty('No time data in this period yet', `Time tracking covers days up to today. The planning period starts ${E.fmtDate(S.settings.periodStart)}; choose a period that includes today to see live status.`);
      if (!U.date || !ds.includes(U.date)) U.date = TC.defaultDate();
      const n = TC.now(), isToday = U.date === n.date;
      const tabs = `<div class="toolbar"><div class="seg" role="group"><button data-set="tt.tab" data-val="live" aria-pressed="${U.tab === 'live'}">${isToday ? 'Live status' : 'Day view'}</button><button data-set="tt.tab" data-val="sheets" aria-pressed="${U.tab === 'sheets'}">Timesheets & payroll</button></div>
        ${U.tab === 'live' ? A.dateStepper('tt.date', U.date, ds) : `<span class="muted">${E.fmtDate(ds[0])} – ${E.fmtDate(ds[ds.length - 1])}</span>`}</div>
        <div class="toolbar">${A.queueSeg('tt.queue', U.queue, true)}<select data-bind="tt.team" data-reset="tt.page" aria-label="Team"><option value="">All teams</option>${[...new Set(S.agents.filter(a => U.queue < 0 || a.queue === (S.queues[U.queue] || {}).id).map(a => a.team))].sort().map(t => `<option ${U.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><input id="tt-q" type="search" placeholder="Find agents (comma-separated)" value="${esc(U.q)}" style="flex:1 1 160px;max-width:240px"></div>`;
      if (U.tab === 'sheets') return head + tabs + sheetsHTML(ds[0], ds[ds.length - 1]);
      if (!TC.ready(U.date)) { TC.ensureDay(U.date); return head + tabs + '<p class="muted">Loading punches…</p>'; }
      const rows = dayRows(U.date), end = TC.endMin(U.date), s = S.settings;
      const schedNow = rows.filter(x => x.w && E.expectedAt(x.w, end, s) !== 'OUT');
      const loggedIn = rows.filter(x => x.sum.open);
      const outNow = rows.filter(x => x.adh.outSince != null || (x.w && isToday && E.expectedAt(x.w, end, s) !== 'OUT' && !x.sum.open));
      const late = rows.filter(x => x.adh.late > 5 && x.ev.length), noShow = rows.filter(x => x.w && !x.ev.length && (end >= s.openH * 60 + x.w.s * 15));
      const adhRows = rows.filter(x => x.adh.adh != null), avgAdh = adhRows.length ? adhRows.reduce((t, x) => t + x.adh.inAdh, 0) / adhRows.reduce((t, x) => t + x.adh.sched, 0) : null;
      const kp = isToday
        ? `<div class="kpi"><span class="l">Logged in now</span><span class="v">${fmtN(loggedIn.length)}</span><span class="d">${fmtN(schedNow.length)} scheduled now</span></div><div class="kpi"><span class="l">In production now</span><span class="v">${fmtN(loggedIn.filter(x => x.sum.open === 'PROD').length)}</span><span class="d">${fmtN(loggedIn.filter(x => x.sum.open === 'BREAK' || x.sum.open === 'MEAL').length)} on break or meal</span></div><div class="kpi"><span class="l">Out of adherence now</span><span class="v">${fmtN(outNow.length)}</span><span class="d">incl. not logged in</span></div>`
        : `<div class="kpi"><span class="l">Agents who worked</span><span class="v">${fmtN(rows.filter(x => x.ev.length).length)}</span><span class="d">${fmtN(rows.filter(x => x.w).length)} scheduled</span></div><div class="kpi"><span class="l">Paid hours</span><span class="v">${fmtN(rows.reduce((t, x) => t + x.sum.paid, 0) / 60)}</span><span class="d">${fmtN(rows.reduce((t, x) => t + x.sum.billable, 0) / 60)} billable</span></div><div class="kpi"><span class="l">No-shows</span><span class="v">${fmtN(noShow.length)}</span><span class="d">scheduled, never logged in</span></div>`;
      const filt = { all: rows, in: loggedIn, out: outNow, late, noshow: noShow }[U.filter] || rows;
      const per = 50, pages = Math.max(1, Math.ceil(filt.length / per)); U.page = Math.min(U.page, pages - 1);
      A._visibleAll = filt.map(x => x.a.id);
      const slice = filt.slice().sort((p, q) => (q.adh.outSince != null) - (p.adh.outSince != null) || p.a.team.localeCompare(q.a.team) || p.a.name.localeCompare(q.a.name)).slice(U.page * per, U.page * per + per);
      return head + tabs + `<div class="kpis">${kp}<div class="kpi"><span class="l">Late log-ins</span><span class="v">${fmtN(late.length)}</span><span class="d">more than 5 min after shift start</span></div><div class="kpi"><span class="l">Adherence ${isToday ? 'so far' : ''}</span><span class="v">${avgAdh == null ? '–' : pct(avgAdh)}</span><span class="d">${avgAdh == null ? '' : avgAdh >= 0.92 ? '<span class="pill good">On target</span>' : '<span class="pill warn">Below 92%</span>'}</span></div></div>
        <div class="toolbar"><div class="seg" role="group">${[['all', 'All', rows.length], ['in', 'Logged in', loggedIn.length], ['out', 'Out of adherence', outNow.length], ['late', 'Late', late.length], ['noshow', isToday ? 'Not logged in yet' : 'No-show', noShow.length]].map(([k, l, c]) => `<button data-set="tt.filter" data-val="${k}" data-reset="tt.page" aria-pressed="${U.filter === k}">${l} <span class="cnt">${c}</span></button>`).join('')}</div>${legend()}</div>
        <div class="tbl-wrap"><table><thead><tr><th class="selcol">${A.selAllBox(A._visibleAll)}</th><th>Agent</th><th>Shift</th><th>Log in</th><th>Log out</th><th>${isToday ? 'Now' : 'Last state'}</th>${Object.keys(CODES).map(c => `<th class="r">${esc(CODES[c].name.replace('Training (billable)', 'Train. B').replace('Training (non-billable)', 'Train. NB'))}</th>`).join('')}<th class="r">Paid</th><th class="r">Billable</th><th class="r">Adherence</th></tr></thead><tbody>
        ${slice.map(x => { const exp = x.w && isToday ? E.expectedAt(x.w, end, s) : null, out = x.adh.outSince != null || (exp && exp !== 'OUT' && !x.sum.open);
          return `<tr class="click ${A.selRowCls(x.a.id)}" data-act="tt-open" data-id="${esc(x.a.id)}"><td class="selcol">${A.selBox(x.a.id, x.a.name)}</td><td>${esc(x.a.name)}<div class="sub2">${esc(x.a.id)} · ${esc(x.a.team)}</div></td><td class="num">${x.w ? A.shiftText(x.w) : x.absence ? esc(E.ABS[x.absence] || '') : '<span class="muted">not scheduled</span>'}</td><td class="num">${E.minToLabel(x.sum.login)}${x.adh.late > 5 && x.ev.length ? ` <span class="pill warn">+${x.adh.late}</span>` : ''}</td><td class="num">${x.sum.open ? '<span class="muted">–</span>' : E.minToLabel(x.sum.logout)}</td>
            <td>${x.sum.open ? pill(x.sum.open) + ` <span class="sub2">${E.fmt(x.sum.openFrom)}</span>` : pill('OUT')}${out && isToday ? ` <span class="pill crit" title="Scheduled: ${esc(codeName(exp))}">${esc(codeName(exp))}</span>` : ''}</td>
            ${Object.keys(CODES).map(c => `<td class="r num">${x.sum.mins[c] ? hrs(x.sum.mins[c]) : '<span class="muted">–</span>'}</td>`).join('')}<td class="r num"><b>${hrs(x.sum.paid)}</b></td><td class="r num">${hrs(x.sum.billable)}</td><td class="r num">${x.adh.adh == null ? '–' : pct(x.adh.adh)}</td></tr>`; }).join('') || '<tr><td colspan="17" class="muted">No agents match.</td></tr>'}
        </tbody></table></div>
        <div class="pager"><span>Page ${U.page + 1} of ${pages} · hours shown as decimals</span><span class="actions"><button class="btn sm" data-set="tt.page" data-val="${U.page - 1}" data-type="num" ${U.page === 0 ? 'disabled' : ''}>Previous</button><button class="btn sm" data-set="tt.page" data-val="${U.page + 1}" data-type="num" ${U.page >= pages - 1 ? 'disabled' : ''}>Next</button></span></div>`;
    }
  };
  function payrollRows(from, to) {
    const rows = TC.sheetRows(from, to); if (rows.then) return rows;
    const S = A.S, by = {};
    rows.forEach(x => {
      const a = A.agent(x.agent); if (!a) return;
      const o = by[x.agent] = by[x.agent] || { a, days: 0, paid: 0, bill: 0, unpaid: 0, prod: 0, train: 0, pto: 0, npto: 0, late: 0, adhIn: 0, adhN: 0, mins: {} };
      if (x.paid || x.unpaid) o.days++;
      o.paid += x.paid; o.bill += x.billable; o.unpaid += x.unpaid; o.prod += x.mins.PROD; o.train += (x.mins.TRB || 0) + (x.mins.TRN || 0);
      Object.keys(CODES).forEach(c => (o.mins[c] = (o.mins[c] || 0) + (x.mins[c] || 0)));
      if (x.absence) { const c = E.absCat(x.absence), h = a.hours / S.settings.daysPerWeek * 60; if (c === 'pto') o.pto += h; else if (c === 'npto') o.npto += h; }
      if (x.late > 5 && (x.paid || x.unpaid)) o.late++;
      if (x.adh != null) { o.adhIn += x.adh * (x.sched || 1); o.adhN += (x.sched || 1); }
    });
    return Object.values(by).sort((p, q) => p.a.team.localeCompare(q.a.team) || p.a.name.localeCompare(q.a.name));
  }
  function sheetsHTML(from, to) {
    const U = A.UI.tt, S = A.S, list = payrollRows(from, to);
    if (list.then) { list.then(() => A.render()).catch(e => A.toast(e.message)); return '<p class="muted">Calculating timesheets…</p>'; }
    const qid = U.queue >= 0 && S.queues[U.queue] ? S.queues[U.queue].id : null, q = U.q.trim().toLowerCase();
    const f = list.filter(o => (!A.UI.selOnly || !A.sel.size || A.sel.has(o.a.id)) && (!qid || o.a.queue === qid) && (!U.team || o.a.team === U.team) && A.agentMatches(o.a, A.searchTerms(q)));
    const tot = k => f.reduce((t, o) => t + o[k], 0);
    const per = 50, pages = Math.max(1, Math.ceil(f.length / per)); U.page = Math.min(U.page, pages - 1);
    return `<div class="kpis"><div class="kpi"><span class="l">Paid hours</span><span class="v">${fmtN(tot('paid') / 60)}</span><span class="d">${fmtN(f.length)} agents</span></div><div class="kpi"><span class="l">Billable hours</span><span class="v">${fmtN(tot('bill') / 60)}</span><span class="d">${tot('paid') ? pct(tot('bill') / tot('paid'), 0) : '–'} of paid time</span></div><div class="kpi"><span class="l">Non-billable paid</span><span class="v">${fmtN((tot('paid') - tot('bill')) / 60)}</span><span class="d">breaks, meetings, coaching, training</span></div><div class="kpi"><span class="l">PTO hours</span><span class="v">${fmtN(tot('pto') / 60)}</span><span class="d">${fmtN(tot('npto') / 60)} non-PTO hours</span></div><div class="kpi"><span class="l">Adherence</span><span class="v">${tot('adhN') ? pct(tot('adhIn') / tot('adhN')) : '–'}</span><span class="d">weighted by scheduled time</span></div></div>
      <div class="tbl-wrap"><table><thead><tr><th>Agent</th><th class="r">Days worked</th><th class="r">Paid h</th><th class="r">Billable h</th><th class="r">Non-billable h</th><th class="r">Unpaid meal h</th><th class="r">Production h</th><th class="r">Training h</th><th class="r">PTO h</th><th class="r">Non-PTO h</th><th class="r">Late days</th><th class="r">Adherence</th></tr></thead><tbody>
      ${f.slice(U.page * per, U.page * per + per).map(o => `<tr><td>${esc(o.a.name)}<div class="sub2">${esc(o.a.id)} · ${esc(o.a.team)}</div></td><td class="r num">${o.days}</td><td class="r num"><b>${hrs(o.paid)}</b></td><td class="r num">${hrs(o.bill)}</td><td class="r num">${hrs(o.paid - o.bill)}</td><td class="r num">${hrs(o.unpaid)}</td><td class="r num">${hrs(o.prod)}</td><td class="r num">${hrs(o.train)}</td><td class="r num">${o.pto ? hrs(o.pto) : '–'}</td><td class="r num">${o.npto ? hrs(o.npto) : '–'}</td><td class="r num">${o.late || '–'}</td><td class="r num">${o.adhN ? pct(o.adhIn / o.adhN) : '–'}</td></tr>`).join('') || '<tr><td colspan="12" class="muted">No timesheets in this range.</td></tr>'}
      </tbody></table></div>
      <div class="pager"><span>Page ${U.page + 1} of ${pages} · ${E.fmtDate(from)} – ${E.fmtDate(to)}</span><span class="actions"><button class="btn sm" data-set="tt.page" data-val="${U.page - 1}" data-type="num" ${U.page === 0 ? 'disabled' : ''}>Previous</button><button class="btn sm" data-set="tt.page" data-val="${U.page + 1}" data-type="num" ${U.page >= pages - 1 ? 'disabled' : ''}>Next</button></span></div>`;
  }
  function openDay(id) {
    const a = A.agent(id), date = A.UI.tt.date || TC.now().date; if (!a) return;
    A.UI.ttOpen = { id, date };
    A.openModal(`${a.name} · ${E.fmtDate(date)}`, () => {
      const x = TC.day(a, date), canEdit = A.UI.role !== 'agent';
      return `<div class="kv"><span>Shift</span><b>${x.w ? A.shiftText(x.w) : x.absence ? esc(E.ABS[x.absence]) : 'Not scheduled'}</b><span>Log in / out</span><b>${E.minToLabel(x.sum.login)} – ${x.sum.open ? 'still logged in' : E.minToLabel(x.sum.logout)}</b><span>Paid / billable</span><b>${E.durLabel(x.sum.paid)} / ${E.durLabel(x.sum.billable)}</b><span>Adherence</span><b>${x.adh.adh == null ? '–' : pct(x.adh.adh)}${x.adh.late > 0 && x.ev.length ? ` · ${x.adh.late} min late` : ''}${x.adh.early ? ` · left ${x.adh.early} min early` : ''}</b></div>
        ${timeline(x.w, x.sum.segs, Math.max(0, x.end))}${legend()}
        <table class="mini"><thead><tr><th>Time</th><th>Punch</th><th>Source</th><th>Note</th><th></th></tr></thead><tbody>${x.ev.slice().sort((p, q) => p.t - q.t).map(e => `<tr><td class="num">${E.fmt(e.t)}</td><td>${e.code === 'LOGIN' || e.code === 'LOGOUT' ? `<b>${codeName(e.code)}</b>` : pill(e.code)}</td><td class="muted">${e.src === 'correction' ? 'Correction' + (e.by ? ' by ' + esc(e.by) : '') : 'Time clock'}</td><td>${esc(e.note || '')}</td><td>${canEdit ? `<button class="x" data-act="tt-del" data-eid="${esc(e.id)}" aria-label="Remove punch">×</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No punches.</td></tr>'}</tbody></table>
        ${canEdit ? `<div class="form-sec"><h3>Add a correction</h3><div class="form" style="grid-template-columns:110px 1fr 2fr auto;align-items:end"><div class="field"><label for="tc-t">Time</label><input id="tc-t" type="time" value="${(E.fmt24 || E.fmt)(x.sum.open ? TC.now().min : (x.w ? A.S.settings.openH * 60 + x.w.s * 15 : 540))}"></div><div class="field"><label for="tc-c">Punch</label><select id="tc-c">${E.PUNCH_CODES.map(c => `<option value="${c}">${esc(codeName(c))}</option>`).join('')}</select></div><div class="field"><label for="tc-n">Reason (required)</label><input id="tc-n" type="text" maxlength="140" placeholder="e.g. Forgot to log out"></div><button class="btn" data-act="tt-add">Add</button></div></div>` : ''}`;
    }, null, { wide: true });
  }
  Object.assign(A.ACTS, {
    'tt-open': t => openDay(t.dataset.id),
    'tt-add': async () => {
      const o = A.UI.ttOpen, a = A.agent(o.id), tv = $('#tc-t').value, note = $('#tc-n').value.trim(), m = E.parseTime(tv);
      if (m == null) { A.toast('Enter a time'); return; } if (!note) { A.toast('Add a reason for the correction'); return; }
      if (await TC.addEvent(a, o.date, m, $('#tc-c').value, note)) { A.toast('Correction saved'); A.renderOverlay(); A._dirty = true; }
    },
    'tt-del': async t => {
      const o = A.UI.ttOpen, a = A.agent(o.id), note = ($('#tc-n') && $('#tc-n').value.trim()) || 'Removed by ' + A.who();
      if (await TC.removeEvent(a, o.date, t.dataset.eid, note)) { A.toast('Punch removed'); A.renderOverlay(); A._dirty = true; }
    },
    'tt-export': () => { const r = range(); if (!r) { A.toast('No time data in this period'); return; } A.withBusy('Preparing timesheets…', async () => A.exportXLSX(`Peovala_timesheets_${r[0]}_to_${r[1]}.xlsx`, [await A.REPORTS.timesheets.sheet()])); },
    'tt-payroll': () => { const r = range(); if (!r) { A.toast('No time data in this period'); return; } A.withBusy('Preparing payroll summary…', async () => A.exportXLSX(`Peovala_payroll_${r[0]}_to_${r[1]}.xlsx`, [await A.REPORTS.payroll.sheet(), await A.REPORTS.timesheets.sheet()])); }
  });

  /* ---------- adherence from punches (replaces the simulated view) ---------- */
  A.adhCalc = function () {
    const S = A.S, U = A.UI.ad, ds = TC.pastDays(), s = S.settings, n = A.nI();
    if (!U.date || !ds.includes(U.date)) U.date = TC.defaultDate();
    if (!U.date) return { rows: [], list: [] };
    const end = TC.endMin(U.date), maxIdx = Math.min(n - 1, Math.floor((Math.min(end, s.closeH * 60) - s.openH * 60) / 15));
    if (U.now == null || U.now > maxIdx) U.now = Math.max(0, maxIdx);
    const minute = Math.min(end, s.openH * 60 + U.now * 15 + 7);
    const qid = U.queue >= 0 && S.queues[U.queue] ? S.queues[U.queue].id : null;
    const list = S.agents.filter(a => (!qid || a.queue === qid) && (!U.team || a.team === U.team));
    const rows = [];
    list.forEach(a => {
      const w = a.shifts[U.date]; if (!w) return;
      const ev = TC.events(a, U.date), adh = E.punchAdherence(w, ev, s, minute), { segs } = E.daySegments(ev, minute);
      const exp = E.expectedAt(w, minute, s), act = E.actualAt(segs, minute);
      if (exp === 'OUT' && act === 'OUT') return;
      const out = !E.matches(exp, act);
      rows.push({ a, sched: exp, actual: act, out, mins: out && adh.outSince != null ? minute - adh.outSince + 1 : 0, adh: adh.adh == null ? 1 : adh.adh, started: true });
    });
    return { rows, list, minute };
  };
  A.VIEWS.adherence = {
    html() {
      const S = A.S, U = A.UI.ad, ds = TC.pastDays();
      const head = A.head('Real time', 'Adherence', 'Scheduled activity compared with what agents actually punched on the time clock, minute by minute.', `<button class="btn" data-act="export-adherence">Export to Excel</button>`);
      if (!ds.length) return head + A.empty('No adherence data in this period yet', 'Adherence covers days up to today. Choose a planning period that includes today.');
      if (!U.date || !ds.includes(U.date)) U.date = TC.defaultDate();
      if (!TC.ready(U.date)) { TC.ensureDay(U.date); return head + '<p class="muted">Loading punches…</p>'; }
      const { rows, minute } = A.adhCalc(), out = rows.filter(r => r.out), ackKey = r => U.date + ':' + U.now + ':' + r.a.id;
      const avg = rows.length ? rows.reduce((t, r) => t + r.adh, 0) / rows.length : 1, n = A.nI(), end = TC.endMin(U.date);
      const maxIdx = Math.min(n - 1, Math.floor((Math.min(end, S.settings.closeH * 60) - S.settings.openH * 60) / 15));
      const teams = {}; rows.forEach(r => { const t = teams[r.a.team] = teams[r.a.team] || { n: 0, out: 0, adh: 0 }; t.n++; if (r.out) t.out++; t.adh += r.adh; });
      const show = A.selFilter((U.onlyOut === 'out' ? out : rows).map(r => Object.assign(r, { id: r.a.id }))).sort((p, q) => q.mins - p.mins).slice(0, 150);
      A._visibleAll = show.map(r => r.a.id);
      const teamsAll = [...new Set(S.agents.filter(a => U.queue < 0 || a.queue === (S.queues[U.queue] || {}).id).map(a => a.team))].sort();
      return head + `<div class="toolbar">${A.queueSeg('ad.queue', U.queue, true)}<select data-bind="ad.team" aria-label="Team"><option value="">All teams</option>${teamsAll.map(t => `<option ${U.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${A.dateStepper('ad.date', U.date, ds)}</div>
        <section class="panel" style="margin-bottom:14px"><div class="split"><label class="flabel" for="ad-now">Time <span class="num" style="color:var(--ink)">${E.fmt(minute)}</span></label><span class="muted" style="font-size:12px">${U.date === TC.now().date ? 'Up to now' : 'Drag to replay the day'}</span></div><input class="range" id="ad-now" type="range" min="0" max="${Math.max(0, maxIdx)}" value="${U.now}"></section>
        <div class="kpis"><div class="kpi"><span class="l">Scheduled at ${E.fmt(minute)}</span><span class="v">${fmtN(rows.length)}</span><span class="d">${fmtN(rows.filter(r => r.sched === 'PROD').length)} on phone</span></div>
          <div class="kpi"><span class="l">Out of adherence</span><span class="v">${fmtN(out.length)}</span><span class="d">${pct(out.length / (rows.length || 1))} of scheduled</span></div>
          <div class="kpi"><span class="l">Adherence so far</span><span class="v">${pct(avg)}</span><span class="d">${avg >= 0.92 ? '<span class="pill good">On target</span>' : '<span class="pill warn">Below 92%</span>'}</span></div>
          <div class="kpi"><span class="l">Not logged in</span><span class="v">${fmtN(rows.filter(r => r.actual === 'OUT').length)}</span><span class="d">but scheduled</span></div>
          <div class="kpi"><span class="l">Acknowledged</span><span class="v">${fmtN(out.filter(r => S.acks[ackKey(r)]).length)}</span><span class="d">of ${fmtN(out.length)} exceptions</span></div></div>
        <div class="grid g-side"><div><div class="toolbar"><div class="seg" role="group"><button data-set="ad.onlyOut" data-val="out" aria-pressed="${U.onlyOut === 'out'}">Exceptions</button><button data-set="ad.onlyOut" data-val="all" aria-pressed="${U.onlyOut === 'all'}">All scheduled</button></div><span class="muted">${fmtN(show.length)} shown</span></div>
          <div class="tbl-wrap"><table><thead><tr><th class="selcol">${A.selAllBox(A._visibleAll)}</th><th>Agent</th><th>Team</th><th>Scheduled</th><th>Actual</th><th class="r">Out for</th><th class="r">Adherence</th><th></th></tr></thead><tbody>
          ${show.map(r => `<tr class="${A.selRowCls(r.a.id)}"><td class="selcol">${A.selBox(r.a.id, r.a.name)}</td><td><span class="lnk" data-act="tt-open-adh" data-id="${esc(r.a.id)}">${esc(r.a.name)}</span></td><td class="mono">${esc(r.a.team)}</td><td>${pill(r.sched)}</td><td>${r.out ? `<span class="pill crit">${esc(codeName(r.actual))}</span>` : pill(r.actual)}</td><td class="r num">${r.out ? r.mins + ' min' : '–'}</td><td class="r num">${pct(r.adh)}</td><td>${r.out ? (S.acks[ackKey(r)] ? '<span class="muted">Acknowledged</span>' : `<button class="btn sm" data-act="adh-ack" data-k="${esc(ackKey(r))}">Acknowledge</button>`) : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Everyone scheduled is in adherence.</td></tr>'}
          </tbody></table></div></div>
          <section class="panel" style="align-self:start"><h2>Teams to watch</h2><p class="sub">Lowest adherence so far</p><table class="mini"><thead><tr><th>Team</th><th class="r">Agents</th><th class="r">Out now</th><th class="r">Adherence</th></tr></thead><tbody>${Object.entries(teams).sort((a, b) => a[1].adh / a[1].n - b[1].adh / b[1].n).slice(0, 12).map(([t, v]) => `<tr><td class="mono">${esc(t)}</td><td class="r num">${v.n}</td><td class="r num">${v.out}</td><td class="r num">${pct(v.adh / v.n)}</td></tr>`).join('')}</tbody></table></section></div>`;
    }
  };
  A.ACTS['tt-open-adh'] = t => { A.UI.tt.date = A.UI.ad.date; openDay(t.dataset.id); };
  A.ACTS['adh-ack'] = t => { A.S.acks[t.dataset.k] = Date.now(); A.save(); A.render(); };
  A.ACTS['adh-refresh'] = () => A.render();

  /* ---------- reports ---------- */
  const R = A.REPORTS;
  R.adherence = { name: 'Adherence snapshot', desc: 'Scheduled against actual state for the date and time chosen in Adherence.', sheet: () => {
    const { rows, minute } = A.adhCalc(), out = [['Agent ID', 'Name', 'Team', 'Date', 'Time', 'Scheduled', 'Actual', 'Out of adherence', 'Minutes out', 'Adherence so far %']];
    rows.forEach(r => out.push([r.a.id, r.a.name, r.a.team, A.UI.ad.date, E.fmt(minute || 0), codeName(r.sched), codeName(r.actual), r.out ? 'Yes' : 'No', r.mins, +(r.adh * 100).toFixed(1)]));
    return { name: 'Adherence snapshot', rows: out };
  } };
  function tsSheet(rows) {
    const out = [['Agent ID', 'Name', 'Team', 'Queue', 'Date', 'Shift', 'Absence', 'Log in', 'Log out', ...Object.keys(CODES).map(c => CODES[c].name + ' h'), 'Paid h', 'Billable h', 'Unpaid h', 'Adherence %', 'Conformance %', 'Late min', 'Left early min']];
    const only = A.UI.rep && A.UI.rep.selOnly && A.sel.size;
    rows.filter(x => !only || A.sel.has(x.agent)).sort((p, q) => p.agent < q.agent ? -1 : p.agent > q.agent ? 1 : p.date < q.date ? -1 : 1).forEach(x => { const a = A.agent(x.agent); if (!a) return; out.push([a.id, a.name, a.team, a.queue, x.date, a.shifts[x.date] ? A.shiftText(a.shifts[x.date]) : '', x.absence ? (E.ABS[x.absence] || x.absence) : '', E.minToLabel(x.login), x.open ? 'logged in' : E.minToLabel(x.logout), ...Object.keys(CODES).map(c => +((x.mins[c] || 0) / 60).toFixed(2)), +(x.paid / 60).toFixed(2), +(x.billable / 60).toFixed(2), +(x.unpaid / 60).toFixed(2), x.adh == null ? '' : +(x.adh * 100).toFixed(1), x.conf == null ? '' : +(x.conf * 100).toFixed(1), x.late || 0, x.early || 0]); });
    return { name: 'Timesheets', rows: out };
  }
  R.timesheets = { name: 'Timesheets', desc: 'Every agent-day up to today: log in and out, hours per time code, paid and billable hours, adherence.', sheet: () => {
    const r = range(); if (!r) return { name: 'Timesheets', rows: [['No time data in this period']] };
    const rows = TC.sheetRows(r[0], r[1]); return rows.then ? rows.then(tsSheet) : tsSheet(rows);
  } };
  function paySheet(list) {
    const out = [['Agent ID', 'Name', 'Team', 'Queue', 'Contract h/week', 'Days worked', 'Paid h', 'Billable h', 'Non-billable paid h', 'Unpaid meal h', ...Object.keys(CODES).map(c => CODES[c].name + ' h'), 'PTO h', 'Non-PTO h', 'Late days', 'Adherence %']];
    const only = A.UI.rep && A.UI.rep.selOnly && A.sel.size;
    list.filter(o => !only || A.sel.has(o.a.id)).forEach(o => out.push([o.a.id, o.a.name, o.a.team, o.a.queue, o.a.hours, o.days, +(o.paid / 60).toFixed(2), +(o.bill / 60).toFixed(2), +((o.paid - o.bill) / 60).toFixed(2), +(o.unpaid / 60).toFixed(2), ...Object.keys(CODES).map(c => +((o.mins[c] || 0) / 60).toFixed(2)), +(o.pto / 60).toFixed(2), +(o.npto / 60).toFixed(2), o.late, o.adhN ? +(o.adhIn / o.adhN * 100).toFixed(1) : '']));
    return { name: 'Payroll summary', rows: out };
  }
  R.payroll = { name: 'Payroll summary', desc: 'Per agent: paid, billable and non-billable hours, time per code, PTO and non-PTO hours.', sheet: () => {
    const r = range(); if (!r) return { name: 'Payroll summary', rows: [['No time data in this period']] };
    const l = payrollRows(r[0], r[1]); return l.then ? l.then(() => paySheet(payrollRows(r[0], r[1]))) : paySheet(l);
  } };
  A.REPORT_ALL.push('timesheets', 'payroll');

  /* ---------- live duration ticker & input ---------- */
  setInterval(() => {
    if (!A.S) return;
    const n = TC.now();
    document.querySelectorAll('.tc-dur').forEach(el => { el.textContent = E.durLabel(n.min - +el.dataset.from); });
  }, 20000);
  setInterval(() => { if (A.S && SERVER && TC.loaded[TC.now().date] && ['time', 'adherence', 'portal'].includes(A.UI.view) && A.UI.role === 'agent') { TC.loaded[TC.now().date] = false; TC.ensureDay(TC.now().date); } }, 60000);
  A.timeInput = e => { if (e.target.id === 'tt-q') { A.UI.tt.q = e.target.value; A.UI.tt.page = 0; A.rerenderKeepFocus('tt-q'); return true; } return false; };
})();
