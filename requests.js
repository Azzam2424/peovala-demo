/* Requests (shift change, swap, day-off swap, time off, overtime), approvals, impact, self-service portal */
(function () {
  const A = window.App, E = A.E, esc = A.esc, fmtN = A.fmtN, pct = A.pct, $ = A.$;
  const TYPES = {
    change: 'Shift time change', swap: 'Shift swap', dayoff: 'Day-off swap', timeoff: 'Time off', overtime: 'Overtime'
  };
  A.REQ_TYPES = TYPES;
  const clone = o => JSON.parse(JSON.stringify(o));

  // describe a request in one line
  A.reqSummary = function (r) {
    const a = A.agent(r.agent), p = r.p, d = x => E.fmtDate(x);
    switch (r.type) {
      case 'change': return `${d(p.date)}: move shift to ${A.tLabel(p.s)}–${A.tLabel(p.s + (p.len || 0))}`;
      case 'swap': { const b = A.agent(p.with); return `${d(p.date)}: swap with ${b ? b.name : p.with}`; }
      case 'dayoff': return `Work ${d(p.to)} instead of ${d(p.from)}`;
      case 'timeoff': return `${E.ABS[p.kind] || 'Time off'} ${d(p.start)}${p.end !== p.start ? ' – ' + d(p.end) : ''}`;
      case 'overtime': return `${d(p.date)}: +${(p.before + p.after) * 15} min (${p.before ? p.before * 15 + ' before' : ''}${p.before && p.after ? ', ' : ''}${p.after ? p.after * 15 + ' after' : ''})`;
    }
    return '';
  };

  // build the list of changes a request would make: [{id, date, shift|null, absence?}]
  function changesOf(r) {
    const S = A.S, a = A.agent(r.agent), p = r.p, out = [];
    if (!a) return { err: 'Agent no longer exists' };
    if (r.type === 'change') {
      const w = a.shifts[p.date]; if (!w) return { err: 'No shift on that day any more' };
      const nw = clone(w); nw.s = p.s; nw.locked = true; out.push({ id: a.id, date: p.date, shift: nw });
    } else if (r.type === 'swap') {
      const b = A.agent(p.with); if (!b) return { err: 'Colleague not found' };
      const wa = a.shifts[p.date], wb = b.shifts[p.date];
      if (!wa && !wb) return { err: 'Neither agent works that day' };
      out.push({ id: a.id, date: p.date, shift: wb ? Object.assign(clone(wb), { locked: true }) : null });
      out.push({ id: b.id, date: p.date, shift: wa ? Object.assign(clone(wa), { locked: true }) : null });
    } else if (r.type === 'dayoff') {
      const w = a.shifts[p.from]; if (!w) return { err: `No shift on ${E.fmtDate(p.from)} any more` };
      if (a.shifts[p.to]) return { err: `Already working on ${E.fmtDate(p.to)}` };
      out.push({ id: a.id, date: p.from, shift: null });
      out.push({ id: a.id, date: p.to, shift: Object.assign(clone(w), { locked: true }) });
    } else if (r.type === 'timeoff') {
      E.range(p.start, p.end).forEach(d => out.push({ id: a.id, date: d, shift: null, absence: p.kind }));
    } else if (r.type === 'overtime') {
      const w = a.shifts[p.date]; if (!w) return { err: 'No shift on that day' };
      const nw = clone(w); nw.s -= p.before; nw.len += p.before + p.after; nw.acts.forEach(x => (x.at += p.before)); nw.locked = true; nw.ot = (nw.ot || 0) + p.before + p.after;
      out.push({ id: a.id, date: p.date, shift: nw });
    }
    return { changes: out };
  }
  A.changesOf = changesOf;

  // rule check + service-level impact without touching state
  A.evaluate = function (r) {
    const S = A.S, res = changesOf(r);
    if (res.err) return { err: res.err, issues: [res.err], impact: [] };
    const ch = res.changes, ids = [...new Set(ch.map(c => c.id))], issues = [];
    // rules on temp copies
    ids.forEach(id => {
      const a = A.agent(id), tmp = Object.assign({}, a, { shifts: Object.assign({}, a.shifts), absence: Object.assign({}, a.absence) });
      const before = new Set(E.checkAgent(a, S.settings, S.days).map(x => x.text));
      ch.filter(c => c.id === id).forEach(c => { if (c.shift) tmp.shifts[c.date] = c.shift; else delete tmp.shifts[c.date]; if (c.absence) tmp.absence[c.date] = c.absence; });
      const dates = ch.filter(c => c.id === id).map(c => c.date);
      const lo = dates.reduce((m, d) => d < m ? d : m, dates[0]), hi = dates.reduce((m, d) => d > m ? d : m, dates[0]);
      const win = E.range(E.addDays(lo, -1), E.addDays(hi, 1));
      E.checkAgent(tmp, S.settings, win).forEach(x => { if (!before.has(x.text) && (x.rule !== 'absence')) issues.push((ids.length > 1 ? a.name + ': ' : '') + x.text); });
    });
    if (r.type === 'swap') {
      const a = A.agent(r.agent), b = A.agent(r.p.with);
      if (b && b.queue !== a.queue && !(b.skills || []).includes(a.queue)) issues.push(`${b.name} is not skilled for ${a.queue}`);
      const wa = a.shifts[r.p.date], wb = b && b.shifts[r.p.date];
      if (wa && wb && wa.len !== wb.len) issues.push(`Shift lengths differ (${wa.len / 4} h vs ${wb.len / 4} h); paid hours change for both`);
    }
    if (r.type === 'timeoff') {
      const a = A.agent(r.agent);
      const used = E.range(r.p.start, r.p.end).filter(d => !(a.fixedOff || []).includes(E.dow(d))).length;
      if (r.p.kind === 'VAC' && (a.leaveUsed || 0) + used > S.settings.annualLeaveDays) issues.push(`Exceeds annual leave: ${a.leaveUsed + used} of ${S.settings.annualLeaveDays} days`);
      E.range(r.p.start, r.p.end).forEach(d => { if (!S.days.includes(d)) return; const k = A.dayK(d), qi = A.qIndex(a.queue); if (a.shifts[d] && A.allowance(qi, k) < 1) issues.push(`${E.fmtDate(d)}: no time-off allowance left for ${S.queues[qi].name}`); });
    }
    // impact per (queue, day)
    const groups = {};
    ch.forEach(c => { const a = A.agent(c.id), qi = A.qIndex(a.queue), k = A.dayK(c.date); if (qi < 0 || k < 0) return; const key = qi + ':' + k; (groups[key] = groups[key] || { qi, k, items: [] }).items.push({ a, c }); });
    const impact = Object.values(groups).map(g => {
      const net = Float64Array.from(S.net[g.qi][g.k]), n = net.length;
      const apply = (w, sign) => { if (!w) return; for (let i = Math.max(0, w.s); i < w.s + w.len && i < n; i++) net[i] += sign; w.acts.forEach(x => { for (let j = 0; j < x.len; j++) { const p = w.s + x.at + j; if (p >= 0 && p < n) net[p] -= sign; } }); };
      g.items.forEach(({ a, c }) => { apply(a.shifts[c.date], -1); apply(c.shift, 1); });
      const q = S.queues[g.qi], R = S.R[g.qi];
      const before = S.rep.queues[g.qi].days[g.k], after = E.dayStats(R.calls[g.k], R.aht, R.req[g.k], net, S.settings);
      return { queue: q.name, date: S.days[g.k], before: before.sl, after: after.sl, dH: after.netH - before.netH };
    });
    return { issues, impact, changes: ch };
  };

  A.applyChanges = function (ch, label) {
    const ids = [...new Set(ch.map(c => c.id))];
    A.snapshot(ids, label);
    ch.forEach(c => {
      const a = A.agent(c.id);
      if (c.shift) a.shifts[c.date] = c.shift; else delete a.shifts[c.date];
      if (c.absence) a.absence[c.date] = c.absence;
    });
  };
  A.decide = function (r, status, note, by) {
    if (status === 'approved') {
      const ev = A.evaluate(r);
      if (ev.err) { A.toast('Cannot approve: ' + ev.err); return false; }
      A.applyChanges(ev.changes, TYPES[r.type] + ' for ' + A.agent(r.agent).name);
      if (r.type === 'timeoff' && r.p.kind === 'VAC') { const a = A.agent(r.agent); a.leaveUsed = (a.leaveUsed || 0) + E.range(r.p.start, r.p.end).filter(d => !(a.fixedOff || []).includes(E.dow(d))).length; }
    }
    r.status = status; r.decidedAt = Date.now(); r.by = by || A.who(); r.note2 = note || '';
    A.log(`Request ${status}`, `${r.id} · ${TYPES[r.type]} · ${A.agent(r.agent) ? A.agent(r.agent).name : r.agent}`, status === 'approved');
    A.refresh();
    return true;
  };
  A.submitRequest = function (r) {
    const S = A.S;
    r.id = 'R' + String((S.reqSeq = (S.reqSeq || 1000) + 1));
    r.created = Date.now(); r.status = 'pending';
    S.requests.unshift(r);
    A.log('Request submitted', `${r.id} · ${TYPES[r.type]} · ${A.agent(r.agent).name}`);
    const auto = A.autoApprove ? A.autoApprove(r) : (r.type === 'timeoff' && S.settings.autoApproveTimeOff && (ev => !ev.err && !ev.issues.length)(A.evaluate(r)));
    if (auto) { A.decide(r, 'approved', r.type === 'timeoff' ? 'Within time-off allowance' : 'Meets all rules', 'Auto-approval'); return 'auto'; }
    A.save();
    return 'pending';
  };

  A.seedRequests = function () {
    const S = A.S, r = E.rng(99), days = S.days, n = A.nI(), made = [];
    const pick = arr => arr[Math.floor(r() * arr.length)];
    const ts = () => Date.now() - Math.floor(r() * 5 * 864e5);
    let guard = 0;
    while (made.length < 34 && guard++ < 2000) {
      const a = pick(S.agents), type = pick(['change', 'change', 'swap', 'swap', 'dayoff', 'timeoff', 'timeoff', 'overtime']);
      const workDays = days.filter(d => a.shifts[d]), offDays = days.filter(d => !a.shifts[d] && !a.absence[d] && !(a.fixedOff || []).includes(E.dow(d)));
      if (!workDays.length) continue;
      let p = null;
      if (type === 'change') { const d = pick(workDays), w = a.shifts[d], ns = w.s + (r() < 0.5 ? -4 : 4); if (ns < 0 || ns + w.len > n) continue; p = { date: d, s: ns, len: w.len }; }
      if (type === 'swap') { const d = pick(workDays); const mates = S.agents.filter(b => b.team === a.team && b.id !== a.id && b.shifts[d] && b.shifts[d].s !== a.shifts[d].s && b.shifts[d].len === a.shifts[d].len); if (!mates.length) continue; p = { date: d, with: pick(mates).id }; }
      if (type === 'dayoff') { const d = pick(workDays); const o = offDays.filter(x => E.weekStart(x) === E.weekStart(d)); if (!o.length) continue; p = { from: d, to: pick(o) }; }
      if (type === 'timeoff') { const k = Math.floor(r() * (days.length - 3)); p = { start: days[k], end: days[k + Math.floor(r() * 3)], kind: r() < 0.85 ? 'VAC' : 'PER' }; }
      if (type === 'overtime') { const d = pick(workDays), w = a.shifts[d]; if (w.s + w.len + 4 > n) continue; p = { date: d, before: 0, after: 4 }; }
      if (!p) continue;
      const req = { id: 'R' + (1001 + made.length), agent: a.id, type, p, created: ts(), status: 'pending', note: pick(['', '', 'Doctor appointment', 'Childcare', 'University exam', 'Family event', 'Can cover the late shift', 'Moving house']) };
      made.push(req);
    }
    S.requests = made.sort((x, y) => y.created - x.created);
    S.reqSeq = 1000 + made.length;
    // decide some historical ones
    made.slice(-10).forEach((q, i) => { if (i % 3 === 0) { q.status = 'denied'; q.decidedAt = q.created + 36e5; q.by = 'Supervisor'; q.note2 = 'Coverage too low on this day'; } else { A.decide(q, 'approved', '', 'Supervisor'); } });
  };

  /* ---------- request form (used by portal and supervisors) ---------- */
  A.requestForm = function (agentId, type, date) {
    const S = A.S, a = A.agent(agentId); if (!a) return;
    const U = A.UI; U.rf = { agent: agentId, type: type || 'change', date: date || S.days.find(d => a.shifts[d]) || S.days[0] };
    A.openModal('New request', () => formBody(), () => `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="rf-submit">Submit request</button>`, { after: () => rfPreview() });
  };
  function formBody() {
    const S = A.S, f = A.UI.rf, a = A.agent(f.agent), n = A.nI(), w = a.shifts[f.date];
    const dOpts = (sel, filter) => S.days.filter(filter || (() => true)).map(d => `<option value="${d}" ${d === sel ? 'selected' : ''}>${E.fmtDate(d)} · ${a.absence[d] ? E.ABS[a.absence[d]] : A.shiftText(a.shifts[d])}</option>`).join('');
    let fields = '';
    if (f.type === 'change') {
      const len = w ? w.len : E.shiftSpec(a, S.settings).len; let o = '';
      for (let st = 0; st + len <= n; st += 1) o += `<option value="${st}" ${f.s === st || (f.s == null && w && w.s === st) ? 'selected' : ''}>${A.tLabel(st)}–${A.tLabel(st + len)}</option>`;
      fields = `<div class="field"><label for="rf-date">Day</label><select id="rf-date">${dOpts(f.date, d => a.shifts[d])}</select></div><div class="field"><label for="rf-s">New shift time</label><select id="rf-s">${o}</select><span class="hint">Current: ${A.shiftText(w)}</span></div>`;
    } else if (f.type === 'swap') {
      const mates = S.agents.filter(b => b.id !== a.id && (b.queue === a.queue || (b.skills || []).includes(a.queue)) && b.team === a.team);
      const others = S.agents.filter(b => b.id !== a.id && b.queue === a.queue && b.team !== a.team).slice(0, 120);
      const opt = b => `<option value="${b.id}" ${f.with === b.id ? 'selected' : ''}>${esc(b.name)} · ${A.shiftText(b.shifts[f.date])}</option>`;
      fields = `<div class="field"><label for="rf-date">Day</label><select id="rf-date">${dOpts(f.date)}</select><span class="hint">Your shift: ${a.absence[f.date] ? E.ABS[a.absence[f.date]] : A.shiftText(w)}</span></div><div class="field"><label for="rf-with">Swap with</label><select id="rf-with"><option value="">Choose a colleague</option><optgroup label="Your team">${mates.map(opt).join('')}</optgroup><optgroup label="Same queue">${others.map(opt).join('')}</optgroup></select></div>`;
    } else if (f.type === 'dayoff') {
      fields = `<div class="field"><label for="rf-date">Day you want off</label><select id="rf-date">${dOpts(f.date, d => a.shifts[d])}</select></div><div class="field"><label for="rf-to">Work this day instead</label><select id="rf-to"><option value="">Choose a day</option>${dOpts(f.to, d => !a.shifts[d] && !a.absence[d])}</select></div>`;
    } else if (f.type === 'timeoff') {
      fields = `<div class="field"><label for="rf-date">From</label><select id="rf-date">${dOpts(f.date)}</select></div><div class="field"><label for="rf-end">To</label><select id="rf-end">${dOpts(f.end && f.end >= f.date ? f.end : f.date, d => d >= f.date)}</select></div><div class="field"><label for="rf-kind">Type</label><select id="rf-kind">${(A.selfAbs ? A.selfAbs() : ['VAC', 'PER', 'UNP']).map(k => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${esc(E.ABS[k])}</option>`).join('')}</select><span class="hint">Leave used ${a.leaveUsed || 0} of ${S.settings.annualLeaveDays} days</span></div>`;
    } else if (f.type === 'overtime') {
      const opt = (id, v) => `<select id="${id}">${[0, 1, 2, 3, 4, 6, 8].map(x => `<option value="${x}" ${v === x ? 'selected' : ''}>${x * 15} min</option>`).join('')}</select>`;
      fields = `<div class="field"><label for="rf-date">Day</label><select id="rf-date">${dOpts(f.date, d => a.shifts[d])}</select><span class="hint">Current: ${A.shiftText(w)}</span></div><div class="field"><label for="rf-before">Start earlier by</label>${opt('rf-before', f.before ?? 0)}</div><div class="field"><label for="rf-after">Finish later by</label>${opt('rf-after', f.after ?? 4)}</div>`;
    }
    return `<div class="seg" role="group">${Object.entries(TYPES).filter(([k]) => !A.reqOn || A.reqOn(k) || f.type === k).map(([k, l]) => `<button data-act="rf-type" data-val="${k}" aria-pressed="${f.type === k}">${l}</button>`).join('')}</div>
      <p class="muted" style="margin:0">For <b>${esc(a.name)}</b> · ${esc(a.id)} · ${esc(a.team)}</p>
      <div class="form">${fields}<div class="field" style="grid-column:1/-1"><label for="rf-note">Reason (optional)</label><input id="rf-note" type="text" maxlength="140" value="${esc(f.note || '')}"></div></div>
      <div id="rf-prev"></div>`;
  }
  function readForm() {
    const f = A.UI.rf, v = id => { const el = $('#' + id); return el ? el.value : undefined; };
    f.date = v('rf-date') || f.date; f.note = v('rf-note') || '';
    if (f.type === 'change') f.s = v('rf-s') != null ? +v('rf-s') : f.s;
    if (f.type === 'swap') f.with = v('rf-with') || '';
    if (f.type === 'dayoff') f.to = v('rf-to') || '';
    if (f.type === 'timeoff') { f.end = v('rf-end') || f.date; f.kind = v('rf-kind') || 'VAC'; if (f.end < f.date) f.end = f.date; }
    if (f.type === 'overtime') { f.before = +v('rf-before'); f.after = +v('rf-after'); }
  }
  function toReq() {
    const f = A.UI.rf, a = A.agent(f.agent), w = a.shifts[f.date];
    if (f.type === 'change') return w ? { agent: a.id, type: 'change', p: { date: f.date, s: f.s ?? w.s, len: w.len }, note: f.note } : null;
    if (f.type === 'swap') return f.with ? { agent: a.id, type: 'swap', p: { date: f.date, with: f.with }, note: f.note } : null;
    if (f.type === 'dayoff') return f.to ? { agent: a.id, type: 'dayoff', p: { from: f.date, to: f.to }, note: f.note } : null;
    if (f.type === 'timeoff') return { agent: a.id, type: 'timeoff', p: { start: f.date, end: f.end || f.date, kind: f.kind || 'VAC' }, note: f.note };
    if (f.type === 'overtime') return (f.before || f.after) ? { agent: a.id, type: 'overtime', p: { date: f.date, before: f.before || 0, after: f.after ?? 4 }, note: f.note } : null;
  }
  function rfPreview() {
    const el = $('#rf-prev'); if (!el) return;
    readForm(); const r = toReq();
    if (!r) { el.innerHTML = '<p class="muted" style="margin:0">Complete the fields to see the rule check and service-level impact.</p>'; return; }
    el.innerHTML = impactHTML(A.evaluate(r));
  }
  function impactHTML(ev) {
    if (ev.err) return `<div class="note crit">${esc(ev.err)}</div>`;
    const rules = ev.issues.length ? `<ul class="issues">${ev.issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="ok">Passes all scheduling rules.</p>';
    const imp = ev.impact.length ? `<table class="mini"><thead><tr><th>Queue</th><th>Day</th><th class="r">SL before</th><th class="r">SL after</th><th class="r">On-phone h</th></tr></thead><tbody>${ev.impact.map(x => `<tr><td>${esc(x.queue)}</td><td>${E.fmtDate(x.date)}</td><td class="r num">${pct(x.before)}</td><td class="r num" style="color:${x.after < x.before - 0.002 ? 'var(--crit-ink)' : x.after > x.before + 0.002 ? 'var(--good-ink)' : 'inherit'}">${pct(x.after)}</td><td class="r num">${x.dH >= 0 ? '+' : ''}${fmtN(x.dH, 2)}</td></tr>`).join('')}</tbody></table>` : '';
    return `<div class="impact"><div class="flabel">Rule check</div>${rules}${imp ? '<div class="flabel">Service-level impact</div>' + imp : ''}</div>`;
  }
  A.impactHTML = impactHTML;
  A.onFormInput = function (e) { if (e.target.id && e.target.id.startsWith('rf-')) { if (['rf-date'].includes(e.target.id)) { readForm(); A.UI.rf.s = null; A.renderOverlay(); } else rfPreview(); return true; } return false; };
  Object.assign(A.ACTS, {
    'rf-type': t => { readForm(); A.UI.rf.type = t.dataset.val; A.renderOverlay(); },
    'rf-submit': () => {
      readForm(); const r = toReq();
      if (!r) { A.toast('Complete the request fields first'); return; }
      const ev = A.evaluate(r); if (ev.err) { A.toast(ev.err); return; }
      const res = A.submitRequest(r); A.closeOverlay(); A.render();
      A.toast(res === 'auto' ? 'Approved automatically: it meets all the rules' : 'Request submitted for approval');
    },
    'new-request': () => { const id = A.UI.role === 'agent' ? A.UI.me : (A.UI.rqAgent || A.S.agents[0].id); A.requestForm(id, 'change'); },
    'portal-req': t => A.requestForm(A.UI.me, t.dataset.type, t.dataset.date),
    'req-cancel': t => { const r = A.S.requests.find(x => x.id === t.dataset.id); if (r && r.status === 'pending') { r.status = 'cancelled'; r.decidedAt = Date.now(); A.log('Request cancelled', r.id); A.save(); A.render(); A.toast('Request cancelled'); } },
    'req-open': t => openReview(t.dataset.id),
    'req-approve': t => { const r = A.S.requests.find(x => x.id === t.dataset.id); const note = $('#rv-note') ? $('#rv-note').value : ''; if (A.decide(r, 'approved', note)) { A.closeOverlay(); A.render(); A.toast(`${r.id} approved and applied to the schedule`); } },
    'req-deny': t => { const r = A.S.requests.find(x => x.id === t.dataset.id); const note = $('#rv-note') ? $('#rv-note').value : ''; A.decide(r, 'denied', note); A.closeOverlay(); A.render(); A.toast(`${r.id} denied`); },
    'req-bulk': () => {
      const list = filtered().filter(r => r.status === 'pending'); let ok = 0;
      A.withBusy('Checking requests…', () => {
        list.forEach(r => { const ev = A.evaluate(r); if (!ev.err && !ev.issues.length && ev.impact.every(x => x.after >= Math.min(x.before, A.S.settings.slTarget) - 0.001)) { A.decide(r, 'approved', 'Bulk approval: no rule or service-level issues'); ok++; } });
        A.toast(`Approved ${ok} of ${list.length} pending requests. The rest need a manual decision.`);
      });
    }
  });
  function openReview(id) {
    const r = A.S.requests.find(x => x.id === id); if (!r) return;
    const a = A.agent(r.agent), ev = r.status === 'pending' ? A.evaluate(r) : null;
    A.openModal(`${r.id} · ${TYPES[r.type]}`, `<div class="kv"><span>Agent</span><b>${esc(a ? a.name : r.agent)} · ${esc(r.agent)} · ${esc(a ? a.team : '')}</b><span>Request</span><b>${esc(A.reqSummary(r))}</b><span>Reason</span><b>${esc(r.note || '–')}</b><span>Submitted</span><b>${new Date(r.created).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</b><span>Status</span><b>${statusPill(r.status)}${r.by ? ' by ' + esc(r.by) : ''}${r.note2 ? ' · ' + esc(r.note2) : ''}</b></div>
      ${ev ? impactHTML(ev) + `<div class="field"><label for="rv-note">Note to agent (optional)</label><input id="rv-note" type="text" maxlength="140"></div>` : ''}`,
      r.status === 'pending' ? `<button class="btn" data-act="close">Close</button><button class="btn danger" data-act="req-deny" data-id="${r.id}">Deny</button><button class="btn primary" data-act="req-approve" data-id="${r.id}" ${ev && ev.err ? 'disabled' : ''}>Approve${ev && ev.issues.length ? ' anyway' : ''}</button>` : null);
  }
  const statusPill = s => `<span class="pill ${s === 'approved' ? 'good' : s === 'pending' ? 'warn' : s === 'denied' ? 'crit' : 'neutral'}">${s[0].toUpperCase() + s.slice(1)}</span>`;
  A.statusPill = statusPill;
  function filtered() {
    const f = A.UI.rq;
    return A.S.requests.filter(r => (f.tab === 'all' || r.status === f.tab) && (!f.type || r.type === f.type) && (!f.queue || (A.agent(r.agent) || {}).queue === f.queue));
  }

  /* ---------- Requests view ---------- */
  A.VIEWS.requests = {
    html() {
      const S = A.S, f = A.UI.rq, list = filtered(), counts = { pending: 0, approved: 0, denied: 0, cancelled: 0 };
      S.requests.forEach(r => counts[r.status] = (counts[r.status] || 0) + 1);
      const rows = list.slice(0, 200).map(r => { const a = A.agent(r.agent) || {}; return `<tr class="click" data-act="req-open" data-id="${r.id}"><td class="mono">${r.id}</td><td>${esc(a.name || r.agent)}<div class="sub2">${esc(a.team || '')}</div></td><td>${TYPES[r.type]}</td><td>${esc(A.reqSummary(r))}</td><td class="muted">${esc(r.note || '')}</td><td class="num">${new Date(r.created).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td><td>${statusPill(r.status)}</td></tr>`; }).join('');
      // allowance grid
      const qs = S.queues;
      const grid = `<div class="tbl-wrap"><table class="allow"><thead><tr><th>Queue</th>${S.days.map(d => `<th class="r">${E.fmtDate(d)}</th>`).join('')}</tr></thead><tbody>${qs.map((q, qi) => `<tr><td><b>${esc(q.name)}</b></td>${S.days.map((d, k) => { const v = A.allowance(qi, k); return `<td class="r num ${v === 0 ? 'zero' : v < 5 ? 'low' : ''}">${v}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
      return A.head('Self-service workflow', 'Requests & time off', 'Agents request shift changes, swaps, day-off swaps, overtime and time off. Each request is checked against the labour rules and its service-level impact before you decide. Approved requests update the schedule and lock the affected shifts.',
        `<button class="btn" data-act="export-requests">Export to Excel</button><button class="btn" data-act="req-bulk" ${counts.pending ? '' : 'disabled'}>Approve all safe requests</button><button class="btn primary" data-act="new-request">New request</button>`) +
        `<div class="toolbar"><div class="seg" role="group">${[['pending', 'Pending'], ['approved', 'Approved'], ['denied', 'Denied'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([k, l]) => `<button data-set="rq.tab" data-val="${k}" aria-pressed="${f.tab === k}">${l} <span class="cnt">${k === 'all' ? S.requests.length : counts[k] || 0}</span></button>`).join('')}</div>
          <select data-bind="rq.type" aria-label="Request type"><option value="">All types</option>${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <select data-bind="rq.queue" aria-label="Queue"><option value="">All queues</option>${qs.map(q => `<option value="${q.id}" ${f.queue === q.id ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select></div>
        <div class="tbl-wrap"><table><thead><tr><th>ID</th><th>Agent</th><th>Type</th><th>Request</th><th>Reason</th><th>Sent</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">No requests in this view.</td></tr>'}</tbody></table></div>
        <section class="panel mt"><div class="split"><div><h2>Time-off allowance</h2><p class="sub">Agents who can still be released per day without dropping below the requirement: surplus on-phone hours ÷ 7.5 h. Time-off requests inside the allowance ${S.settings.autoApproveTimeOff ? 'are approved automatically' : 'still need approval'} (change this in Settings).</p></div></div>${grid}</section>`;
    }
  };
  A.ACTS['export-requests'] = () => A.exportXLSX(`Peovala_requests_${A.fileStamp()}.xlsx`, [A.REPORTS.requests.sheet()]);

  /* ---------- Agent self-service portal ---------- */
  A.VIEWS.portal = {
    html() {
      const S = A.S, a = A.agent(A.UI.me) || S.agents[0]; A.UI.me = a.id;
      const tab = A.UI.portal.tab, mine = S.requests.filter(r => r.agent === a.id || (r.type === 'swap' && r.p.with === a.id));
      const paid = A.paidHours(a), weeks = S.days.length / 7;
      const cards = S.days.map(d => {
        const w = a.shifts[d], abs = a.absence[d], sp = A.special(d, a.queue);
        return `<div class="daycard ${w ? A.band(w) : abs ? 'abs' : 'off'}"><div class="dc-h"><b>${E.fmtDate(d)}</b>${sp ? `<span class="chip">${esc(sp.name)}</span>` : ''}${w && w.locked ? '<span class="chip">Confirmed</span>' : ''}</div>
          <div class="dc-t">${abs ? esc(E.ABS[abs]) : w ? A.shiftText(w) : 'Day off'}</div>
          ${w ? `<div class="dc-a">${w.acts.map(x => `${E.ACT[x.t].name} ${A.tLabel(w.s + x.at)}`).join(' · ')}</div>` : ''}
          <div class="dc-f">${w ? `<button class="btn sm ghost" data-act="portal-req" data-type="change" data-date="${d}">Change time</button><button class="btn sm ghost" data-act="portal-req" data-type="swap" data-date="${d}">Swap</button><button class="btn sm ghost" data-act="portal-req" data-type="timeoff" data-date="${d}">Time off</button>` : !abs ? `<button class="btn sm ghost" data-act="portal-req" data-type="swap" data-date="${d}">Pick up a shift</button>` : ''}</div></div>`;
      }).join('');
      const reqRows = mine.map(r => `<tr><td class="mono">${r.id}</td><td>${TYPES[r.type]}${r.agent !== a.id ? ' <span class="muted">(with you)</span>' : ''}</td><td>${esc(A.reqSummary(r))}</td><td>${statusPill(r.status)}${r.note2 ? `<div class="sub2">${esc(r.note2)}</div>` : ''}</td><td>${r.status === 'pending' && r.agent === a.id ? `<button class="btn sm" data-act="req-cancel" data-id="${r.id}">Cancel</button>` : ''}</td></tr>`).join('');
      return A.head(`${esc(a.id)} · ${esc(a.team)} · ${esc(S.queues[A.qIndex(a.queue)]?.name || a.queue)}`, `Hello, ${esc(a.name.split(' ')[0])}`,
        `Your schedule for ${E.fmtDateY(S.settings.periodStart)} – ${E.fmtDateY(S.settings.periodEnd)}${S.pub.version ? `, published version ${S.pub.version}` : ''}. Request changes here; your supervisor sees the rule check and decides.`,
        `<button class="btn primary" data-act="new-request">New request</button>`) +
        `<div class="kpis k4"><div class="kpi"><span class="l">Paid hours this period</span><span class="v">${fmtN(paid, 1)} h</span><span class="d">contract ${fmtN(a.hours * weeks, 0)} h</span></div>
          <div class="kpi"><span class="l">Shifts</span><span class="v">${S.days.filter(d => a.shifts[d]).length}</span><span class="d">of ${S.days.length} days</span></div>
          <div class="kpi"><span class="l">Annual leave</span><span class="v">${S.settings.annualLeaveDays - (a.leaveUsed || 0)} days</span><span class="d">left of ${S.settings.annualLeaveDays}</span></div>
          <div class="kpi"><span class="l">Open requests</span><span class="v">${mine.filter(r => r.status === 'pending').length}</span><span class="d">${mine.length} in total</span></div></div>
        <div class="toolbar"><div class="seg" role="group"><button data-set="portal.tab" data-val="time" aria-pressed="${tab === 'time'}">Time clock</button><button data-set="portal.tab" data-val="schedule" aria-pressed="${tab === 'schedule'}">My schedule</button><button data-set="portal.tab" data-val="requests" aria-pressed="${tab === 'requests'}">My requests</button></div></div>
        ${tab === 'time' ? A.TC.portalHTML(a) : tab === 'schedule' ? `<div class="daygrid">${cards}</div>` : `<div class="tbl-wrap"><table><thead><tr><th>ID</th><th>Type</th><th>Request</th><th>Status</th><th></th></tr></thead><tbody>${reqRows || '<tr><td colspan="5" class="muted">You have no requests yet.</td></tr>'}</tbody></table></div>`}`;
    }
  };
})();
