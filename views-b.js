/* Views: Schedule (drag & drop + roster), Activity planner, Employees (+ drawer), Reports, Settings, imports, boot */
(function () {
  const A = window.App, E = A.E, esc = A.esc, fmtN = A.fmtN, pct = A.pct, $ = A.$;
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ================= Activity planner ================= */
  function actPlan() {
    const S = A.S, U = A.UI.act, n = A.nI(), dur = Math.round(U.dur / 15);
    const teams = new Set(U.teams), people = S.agents.filter(a => teams.has(a.team));
    const days = S.days.filter(d => d >= U.from && d <= U.to);
    const lo = Math.max(0, Math.round((U.early - S.settings.openH * 60) / 15)), hi = Math.min(n, Math.round((U.late - S.settings.openH * 60) / 15));
    const net = S.net.map(q => q.map(d => Float64Array.from(d)));
    const fits = (w, st) => { if (st < w.s + 1 || st + dur > w.s + w.len - 1) return false; const p = st - w.s; return !w.acts.some(x => p < x.at + x.len && x.at < p + dur); };
    const placed = [], missed = [];
    if (U.mode === 'group') {
      let best = null;
      days.forEach(d => { const k = A.dayK(d); for (let st = lo; st + dur <= hi; st++) {
        let cnt = 0, score = 0; people.forEach(a => { const w = a.shifts[d]; if (w && fits(w, st)) { cnt++; const qi = A.qIndex(a.queue); for (let j = 0; j < dur; j++) score += net[qi][k][st + j] - S.R[qi].req[k][st + j]; } });
        const v = cnt * 1e6 + score; if (cnt && (!best || v > best.v)) best = { v, d, k, st, cnt };
      } });
      people.forEach(a => { const w = best && a.shifts[best.d]; if (w && fits(w, best.st)) placed.push({ a, d: best.d, k: best.k, st: best.st }); else missed.push(a); });
    } else {
      people.slice().sort((x, y) => x.id < y.id ? -1 : 1).forEach(a => {
        const qi = A.qIndex(a.queue); let best = null;
        days.forEach(d => { const w = a.shifts[d]; if (!w) return; const k = A.dayK(d);
          for (let st = Math.max(lo, w.s + 1); st + dur <= Math.min(hi, w.s + w.len - 1); st++) { if (!fits(w, st)) continue; let v = 0; for (let j = 0; j < dur; j++) v += net[qi][k][st + j] - S.R[qi].req[k][st + j]; if (!best || v > best.v) best = { v, d, k, st }; } });
        if (best) { placed.push({ a, d: best.d, k: best.k, st: best.st }); for (let j = 0; j < dur; j++) net[qi][best.k][best.st + j] -= 1; } else missed.push(a);
      });
    }
    // impact
    const net2 = S.net.map(q => q.map(d => Float64Array.from(d))), touched = {};
    placed.forEach(p => { const qi = A.qIndex(p.a.queue); for (let j = 0; j < dur; j++) net2[qi][p.k][p.st + j] -= 1; touched[qi + ':' + p.k] = [qi, p.k]; });
    const impact = Object.values(touched).map(([qi, k]) => { const R = S.R[qi]; return { queue: S.queues[qi].name, date: S.days[k], before: S.rep.queues[qi].days[k].sl, after: E.dayStats(R.calls[k], R.aht, R.req[k], net2[qi][k], S.settings).sl }; }).sort((a, b) => a.date < b.date ? -1 : 1);
    return { placed, missed, impact, dur, people };
  }
  A.VIEWS.activities = {
    html() {
      const S = A.S, U = A.UI.act;
      if (!U.from || !S.days.includes(U.from)) U.from = S.days[0];
      if (!U.to || !S.days.includes(U.to) || U.to < U.from) U.to = S.days[Math.min(S.days.length - 1, S.days.indexOf(U.from) + 4)];
      if (U.early == null) { U.early = Math.max(S.settings.openH * 60, 9 * 60); U.late = Math.min(S.settings.closeH * 60, 17 * 60); }
      const allTeams = [...new Set(S.agents.map(a => a.team))].sort().filter(t => !U.q || t.toLowerCase().includes(U.q.toLowerCase()));
      const tOpt = sel => { let h = ''; for (let m = S.settings.openH * 60; m <= S.settings.closeH * 60; m += 30) h += `<option value="${m}" ${m === sel ? 'selected' : ''}>${E.fmt(m)}</option>`; return h; };
      const plan = U.plan;
      const res = plan ? `<section class="panel mt"><div class="split"><div><h2>Proposed placement</h2><p class="sub">${plan.placed.length} of ${plan.people.length} attendees placed${plan.missed.length ? `, ${plan.missed.length} could not be placed (not working, or no free time in the window)` : ''}.</p></div><div class="actions"><button class="btn" data-act="act-clear">Discard</button><button class="btn primary" data-act="act-apply" ${plan.placed.length ? '' : 'disabled'}>Add to schedule</button></div></div>
        <div class="grid g2"><div class="tbl-wrap" style="max-height:340px"><table><thead><tr><th>Agent</th><th>Team</th><th>Day</th><th>Time</th></tr></thead><tbody>${plan.placed.slice(0, 300).map(p => `<tr><td>${esc(p.a.name)}</td><td class="mono">${esc(p.a.team)}</td><td>${E.fmtDate(p.d)}</td><td class="num">${A.tLabel(p.st)}–${A.tLabel(p.st + plan.dur)}</td></tr>`).join('')}${plan.missed.slice(0, 50).map(a => `<tr><td>${esc(a.name)}</td><td class="mono">${esc(a.team)}</td><td colspan="2"><span class="pill warn">Not placed</span></td></tr>`).join('')}</tbody></table></div>
        <div><div class="flabel">Service-level impact</div><table class="mini"><thead><tr><th>Queue</th><th>Day</th><th class="r">Before</th><th class="r">After</th></tr></thead><tbody>${plan.impact.map(x => `<tr><td>${esc(x.queue)}</td><td>${E.fmtDate(x.date)}</td><td class="r num">${pct(x.before)}</td><td class="r num">${pct(x.after)}</td></tr>`).join('')}</tbody></table></div></div></section>` : '';
      const planned = {}; S.agents.forEach(a => S.days.forEach(d => { const w = a.shifts[d]; if (w) w.acts.forEach(x => { if ('MTCO'.includes(x.t)) { const key = d + x.t; planned[key] = (planned[key] || 0) + x.len / 4; } }); }));
      return A.head('Scheduling', 'Activity planner',
        'Place meetings, training, coaching and offline work inside existing shifts where they cost the least service level. Choose one time for a whole group, or the best time for each person.', '') +
        `<div class="grid g-side"><section class="panel">
          <div class="form">
            <div class="field"><label for="ap-type">Activity</label><select id="ap-type">${['M', 'T', 'C', 'O'].map(t => `<option value="${t}" ${U.type === t ? 'selected' : ''}>${E.ACT[t].name}</option>`).join('')}</select></div>
            <div class="field"><label for="ap-dur">Duration</label><select id="ap-dur">${[15, 30, 45, 60, 90, 120, 180, 240].map(m => `<option value="${m}" ${U.dur === m ? 'selected' : ''}>${m < 60 ? m + ' min' : m / 60 + ' h'}</option>`).join('')}</select></div>
            <div class="field"><label for="ap-from">From</label><select id="ap-from">${S.days.map(d => `<option value="${d}" ${d === U.from ? 'selected' : ''}>${E.fmtDate(d)}</option>`).join('')}</select></div>
            <div class="field"><label for="ap-to">To</label><select id="ap-to">${S.days.filter(d => d >= U.from).map(d => `<option value="${d}" ${d === U.to ? 'selected' : ''}>${E.fmtDate(d)}</option>`).join('')}</select></div>
            <div class="field"><label for="ap-early">Not before</label><select id="ap-early">${tOpt(U.early)}</select></div>
            <div class="field"><label for="ap-late">Finish by</label><select id="ap-late">${tOpt(U.late)}</select></div>
          </div>
          <div class="field mt"><span class="flabel">Timing</span><div class="seg" role="group"><button data-act="ap-mode" data-val="group" aria-pressed="${U.mode === 'group'}">Same time for everyone</button><button data-act="ap-mode" data-val="individual" aria-pressed="${U.mode === 'individual'}">Best time for each person</button></div></div>
          <div class="field mt"><div class="split"><span class="flabel">Attendees: ${U.teams.length} teams, ${fmtN(S.agents.filter(a => U.teams.includes(a.team)).length)} agents</span><input id="ap-q" type="search" placeholder="Filter teams" value="${esc(U.q)}" style="max-width:180px"></div>
            <div class="teampick">${allTeams.map(t => `<label><input type="checkbox" class="ap-team" value="${esc(t)}" ${U.teams.includes(t) ? 'checked' : ''}>${esc(t)}</label>`).join('')}</div></div>
          <div class="actions mt"><button class="btn primary" data-act="act-find">Find best slots</button></div>
        </section>
        <section class="panel" style="align-self:start"><h2>Planned activities</h2><p class="sub">Hours already scheduled in this period</p>
          <table class="mini"><thead><tr><th>Day</th>${['Meet', 'Train', 'Coach', 'Offline'].map(t => `<th class="r">${t}</th>`).join('')}</tr></thead><tbody>${S.days.filter(d => 'MTCO'.split('').some(t => planned[d + t])).map(d => `<tr><td>${E.fmtDate(d)}</td>${['M', 'T', 'C', 'O'].map(t => `<td class="r num">${planned[d + t] ? fmtN(planned[d + t], 1) : '–'}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="5" class="muted">None yet</td></tr>'}</tbody></table></section></div>${res}`;
    }
  };
  function readAct() { const U = A.UI.act, v = id => $('#' + id) && $('#' + id).value; if (!$('#ap-type')) return; U.type = v('ap-type'); U.dur = +v('ap-dur'); U.from = v('ap-from'); U.to = v('ap-to'); U.early = +v('ap-early'); U.late = +v('ap-late'); }
  Object.assign(A.ACTS, {
    'ap-mode': t => { readAct(); A.UI.act.mode = t.dataset.val; A.UI.act.plan = null; A.render(); },
    'act-find': () => {
      readAct(); const U = A.UI.act;
      if (!U.teams.length) { A.toast('Choose at least one team'); return; }
      if (U.late - U.early < U.dur) { A.toast('The time window is shorter than the activity'); return; }
      A.withBusy('Finding the lowest-impact slots…', () => { U.plan = actPlan(); });
    },
    'act-clear': () => { A.UI.act.plan = null; A.render(); },
    'act-apply': () => {
      const U = A.UI.act, p = U.plan; if (!p) return;
      A.snapshot([...new Set(p.placed.map(x => x.a.id))], `${E.ACT[U.type].name} for ${p.placed.length} agents`);
      p.placed.forEach(x => { const w = x.a.shifts[x.d]; w.acts.push({ t: U.type, at: x.st - w.s, len: p.dur }); w.acts.sort((a, b) => a.at - b.at); w.locked = true; });
      A.log('Activity planned', `${E.ACT[U.type].name}, ${U.dur} min, ${p.placed.length} agents`, true);
      U.plan = null; A.S.demo = false; A.refresh(); A.render(); A.toast(`${E.ACT[U.type].name} added for ${p.placed.length} agents`);
    }
  });

  /* ================= Employees ================= */
  function empRows() {
    const f = A.UI.emp, q = f.q.trim().toLowerCase();
    const out = A.selFilter(A.S.agents.filter(a => (!f.queue || a.queue === f.queue) && (!f.hours || String(a.hours) === f.hours) && (!f.site || a.site === f.site) && (!f.skill || (a.skills || []).length > 0) && (!q || A.searchTerms(q).some(t => a.name.toLowerCase().includes(t) || a.id.toLowerCase().includes(t) || a.team.toLowerCase().includes(t)))));
    A._visibleAll = out.map(a => a.id);
    return out;
  }
  A.VIEWS.employees = {
    html() {
      const S = A.S, U = A.UI.emp, rows = empRows(), per = 50, pages = Math.max(1, Math.ceil(rows.length / per)); U.page = Math.min(U.page, pages - 1);
      const slice = rows.slice(U.page * per, U.page * per + per), hrs = [...new Set(S.agents.map(a => a.hours))].sort((a, b) => b - a), sites = [...new Set(S.agents.map(a => a.site).filter(Boolean))].sort();
      const weeks = S.days.length / 7;
      return A.head('People', 'Employees', `${fmtN(S.agents.length)} agents. Skills, contract hours, availability, fixed days off and absences all feed the scheduler.`,
        `<button class="btn" data-act="import-agents">Import</button><button class="btn" data-act="export-agents">Export to Excel</button>${A.UI.role === 'planner' ? '<button class="btn primary" data-act="add-agent">Add agent</button>' : ''}`) +
        `<div class="toolbar"><input id="emp-q" type="search" placeholder="Search name, ID or team" value="${esc(U.q)}" style="flex:1 1 200px;max-width:300px">
          <select data-bind="emp.queue" data-reset="emp.page" aria-label="Queue"><option value="">All queues</option>${S.queues.map(q => `<option value="${q.id}" ${U.queue === q.id ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select>
          <select data-bind="emp.site" data-reset="emp.page" aria-label="Site"><option value="">All sites</option>${sites.map(s => `<option ${U.site === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          <select data-bind="emp.hours" data-reset="emp.page" aria-label="Contract"><option value="">All contracts</option>${hrs.map(h => `<option value="${h}" ${U.hours === String(h) ? 'selected' : ''}>${h} h / week</option>`).join('')}</select>
          <select data-bind="emp.skill" data-reset="emp.page" aria-label="Skills"><option value="">All skill sets</option><option value="multi" ${U.skill ? 'selected' : ''}>Multi-skilled only</option></select>
          <span class="muted">${fmtN(rows.length)} shown</span></div>
        <div class="tbl-wrap"><table><thead><tr><th class="selcol">${A.selAllBox(A._visibleAll)}</th><th>ID</th><th>Name</th><th>Queue</th><th>Other skills</th><th>Team</th><th>Site</th><th class="r">Contract</th><th>Availability</th><th>Fixed off</th><th class="r">Absence days</th><th class="r">Leave left</th><th class="r">Scheduled</th></tr></thead><tbody>
        ${slice.map(a => { const ph = A.paidHours(a), abs = S.days.filter(d => a.absence[d]).length, exp = a.hours * weeks - abs * a.hours / S.settings.daysPerWeek; return `<tr class="click ${A.selRowCls(a.id)}" data-agent="${esc(a.id)}" tabindex="0"><td class="selcol">${A.selBox(a.id, a.name)}</td><td class="mono">${esc(a.id)}</td><td>${esc(a.name)}</td><td>${esc(a.queue)}</td><td>${(a.skills || []).join(', ') || '<span class="muted">–</span>'}</td><td class="mono">${esc(a.team)}</td><td>${esc(a.site || '')}</td><td class="r num">${a.hours} h</td><td class="num">${E.fmt(a.earliest)}–${E.fmt(a.latest)}</td><td>${(a.fixedOff || []).map(d => E.DAYS[d]).join(', ') || '<span class="muted">–</span>'}</td><td class="r num">${abs || '–'}</td><td class="r num">${S.settings.annualLeaveDays - (a.leaveUsed || 0)}</td><td class="r num" ${ph < exp - 0.5 ? 'style="color:var(--warn-ink)"' : ''}>${fmtN(ph, 1)} h</td></tr>`; }).join('') || '<tr><td colspan="13" class="muted">No agents match these filters.</td></tr>'}
        </tbody></table></div>
        <div class="pager"><span>Page ${U.page + 1} of ${pages}</span><span class="actions"><button class="btn sm" data-set="emp.page" data-val="${U.page - 1}" data-type="num" ${U.page === 0 ? 'disabled' : ''}>Previous</button><button class="btn sm" data-set="emp.page" data-val="${U.page + 1}" data-type="num" ${U.page >= pages - 1 ? 'disabled' : ''}>Next</button></span></div>`;
    },
    drawer() {
      const S = A.S, U = A.UI, isNew = U.drawer === '__new', canEdit = U.role !== 'agent';
      const a = isNew ? { id: '', name: '', team: '', site: 'Essen', queue: S.queues[0].id, skills: [], hours: 40, earliest: S.settings.openH * 60, latest: S.settings.closeH * 60, fixedOff: [], absence: {}, shifts: {} } : A.agent(U.drawer);
      if (!a) return '';
      const n = A.nI(), sp = E.shiftSpec(a, S.settings);
      const tOpt = (sel) => { let h = ''; for (let m = S.settings.openH * 60; m <= S.settings.closeH * 60; m += 30) h += `<option value="${m}" ${m === sel ? 'selected' : ''}>${E.fmt(m)}</option>`; return h; };
      const days = (name, arr) => `<div class="days-pick">${E.DAYS.map((d, i) => `<label><input type="checkbox" name="${name}" value="${i}" ${arr.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>`;
      const issues = isNew ? [] : E.checkAgent(a, S.settings, S.days);
      const focus = U.drawerDate;
      const shiftRows = isNew ? '' : S.days.map(d => {
        const w = a.shifts[d], abs = a.absence[d], len = w ? w.len : sp.len;
        let o = `<option value="off">${abs ? E.ABS[abs] : 'Off'}</option>`; for (let st = 0; st + len <= n; st++) o += `<option value="${st}" ${w && w.s === st ? 'selected' : ''}>${A.tLabel(st)}–${A.tLabel(st + len)}</option>`;
        return `<tr class="${d === focus ? 'focus' : ''}"><td class="num">${E.fmtDate(d)}</td><td><select data-shift="${d}" aria-label="Shift on ${E.fmtDate(d)}" ${canEdit ? '' : 'disabled'}>${o}</select></td><td>${w ? `<label class="check sm"><input type="checkbox" data-lock="${d}" ${w.locked ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>Locked</label>` : ''}</td><td class="acts">${w ? w.acts.map(x => `${E.ACT[x.t].name} ${A.tLabel(w.s + x.at)}`).join(' · ') : ''}</td></tr>`;
      }).join('');
      const absList = Object.keys(a.absence || {}).filter(d => S.days.includes(d)).sort();
      return `<aside class="drawer" role="dialog" aria-label="Agent details"><header><div><div class="eyebrow">${isNew ? 'New agent' : esc(a.id) + ' · ' + esc(a.team)}</div><h2>${isNew ? 'Add agent' : esc(a.name)}</h2></div><button class="x" data-act="close" aria-label="Close">×</button></header>
        <div class="body">
          ${issues.length ? `<div class="note crit"><b>${issues.length} rule issue${issues.length > 1 ? 's' : ''}</b><ul class="issues">${issues.slice(0, 6).map(x => `<li>${esc(x.text)}</li>`).join('')}</ul></div>` : ''}
          ${isNew ? '' : `<div><div class="split"><div class="flabel">Shifts in this period · ${fmtN(A.paidHours(a), 1)} paid h</div>${canEdit ? `<button class="btn sm" data-act="drawer-request">New request for ${esc(a.name.split(' ')[0])}</button>` : ''}</div><div class="tbl-wrap" style="max-height:300px;margin-top:6px"><table class="mini shifts">${shiftRows}</table></div><p class="muted" style="font-size:12px;margin:6px 0 0">${sp.len / 4} h shift incl. ${sp.lunchInt * 15} min lunch and ${sp.breaks} × ${S.settings.breakMin} min breaks. Changing a time locks the shift.</p></div>`}
          <div class="form" style="grid-template-columns:1fr 1fr">
            <div class="field"><label for="ag-id">Agent ID</label><input id="ag-id" type="text" value="${esc(a.id)}" ${isNew ? '' : 'disabled'}></div>
            <div class="field"><label for="ag-name">Name</label><input id="ag-name" type="text" value="${esc(a.name)}"></div>
            <div class="field"><label for="ag-queue">Primary queue</label><select id="ag-queue">${S.queues.map(q => `<option value="${q.id}" ${a.queue === q.id ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="ag-team">Team</label><input id="ag-team" type="text" value="${esc(a.team)}"></div>
            <div class="field"><label for="ag-site">Site</label><input id="ag-site" type="text" value="${esc(a.site || '')}"></div>
            <div class="field"><label for="ag-hours">Contract hours / week</label><input id="ag-hours" type="number" min="4" max="48" value="${a.hours}"></div>
            ${A.cfgAgentFields ? A.cfgAgentFields(a) : ''}
            <div class="field"><label for="ag-early">Earliest start</label><select id="ag-early">${tOpt(a.earliest)}</select></div>
            <div class="field"><label for="ag-late">Latest end</label><select id="ag-late">${tOpt(a.latest)}</select></div>
          </div>
          <div class="field"><span class="flabel">Secondary skills</span><div class="days-pick">${S.queues.map(q => `<label><input type="checkbox" name="ag-skill" value="${q.id}" ${(a.skills || []).includes(q.id) ? 'checked' : ''}>${esc(q.name)}</label>`).join('')}</div></div>
          <div class="field"><span class="flabel">Fixed days off</span>${days('ag-fixed', a.fixedOff || [])}</div>
          ${isNew ? '' : `<div class="field"><span class="flabel">Absences in this period</span>
            ${absList.length ? `<ul class="abslist">${absList.map(d => `<li><span>${E.fmtDate(d)}</span><span>${E.ABS[a.absence[d]]}</span>${canEdit ? `<button class="x" data-act="abs-del" data-date="${d}" aria-label="Remove absence">×</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted" style="margin:0">None</p>'}
            ${canEdit ? `<div class="form" style="grid-template-columns:1fr 1fr 1fr auto;align-items:end;margin-top:6px"><div class="field"><label for="ab-from">From</label><select id="ab-from">${S.days.map(d => `<option value="${d}">${E.fmtDate(d)}</option>`).join('')}</select></div><div class="field"><label for="ab-to">To</label><select id="ab-to">${S.days.map(d => `<option value="${d}">${E.fmtDate(d)}</option>`).join('')}</select></div><div class="field"><label for="ab-kind">Type</label><select id="ab-kind">${Object.entries(E.ABS).filter(([k]) => !(E.ABS_INFO[k] || {}).off).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div><button class="btn sm" data-act="abs-add">Add</button></div>` : ''}</div>`}
        </div>
        ${canEdit ? `<footer><button class="btn primary" data-act="save-agent">${isNew ? 'Add agent' : 'Save details'}</button>${isNew || A.UI.role !== 'planner' ? '' : '<button class="btn danger" data-act="delete-agent">Delete agent</button>'}</footer>` : ''}</aside>`;
    }
  };
  function drawerAgent() { return A.agent(A.UI.drawer); }
  Object.assign(A.ACTS, {
    'add-agent': () => { A.UI.modal = null; A.UI.drawer = '__new'; A.renderOverlay(); },
    'drawer-request': () => { const id = A.UI.drawer; A.UI.drawer = null; A.requestForm(id, 'change'); },
    'save-agent': () => {
      const S = A.S, isNew = A.UI.drawer === '__new', id = $('#ag-id').value.trim(), name = $('#ag-name').value.trim();
      if (!id || !name) { A.toast('Enter an agent ID and a name'); return; }
      if (isNew && S.idx[id] != null) { A.toast(`Agent ID ${id} is already in use`); return; }
      const early = +$('#ag-early').value, late = +$('#ag-late').value; if (late <= early) { A.toast('Latest end must be after earliest start'); return; }
      const fErr = A.cfgCheckAgent && A.cfgCheckAgent(); if (fErr) { A.toast(fErr); return; }
      const a = isNew ? { id, shifts: {}, absence: {}, leaveUsed: 0 } : drawerAgent();
      if (!isNew) A.snapshot([a.id], 'Edit ' + a.name);
      const q = $('#ag-queue').value;
      Object.assign(a, { name, queue: q, team: $('#ag-team').value.trim() || q + '-T01', site: $('#ag-site').value.trim(), hours: Math.max(4, Math.min(48, +$('#ag-hours').value || 40)), earliest: early, latest: late,
        skills: [...document.querySelectorAll('input[name="ag-skill"]:checked')].map(x => x.value).filter(x => x !== q), fixedOff: [...document.querySelectorAll('input[name="ag-fixed"]:checked')].map(x => +x.value) });
      if (A.cfgSaveAgent) A.cfgSaveAgent(a);
      if (isNew) { S.agents.push(a); S.idx[a.id] = S.agents.length - 1; }
      S.demo = false; A.log(isNew ? 'Agent added' : 'Agent updated', `${a.id} ${a.name}`, true); A.refresh(); A.closeOverlay(); A.render();
      A.toast(isNew ? `${name} added. Build the schedule to give them shifts.` : 'Agent saved');
    },
    'delete-agent': t => {
      if (!t.classList.contains('armed')) { t.classList.add('armed'); t.textContent = 'Click again to delete'; return; }
      const S = A.S, a = drawerAgent(); S.agents = S.agents.filter(x => x !== a); S.demo = false; A.log('Agent deleted', `${a.id} ${a.name}`, true); A.derive(); A.closeOverlay(); A.render(); A.toast('Agent deleted');
    },
    'abs-add': () => {
      const a = drawerAgent(), from = $('#ab-from').value, to = $('#ab-to').value, kind = $('#ab-kind').value;
      if (to < from) { A.toast('The end date must be on or after the start date'); return; }
      A.snapshot([a.id], 'Absence for ' + a.name);
      E.range(from, to).forEach(d => { a.absence[d] = kind; delete a.shifts[d]; });
      A.log('Absence added', `${a.name}: ${E.ABS[kind]} ${E.fmtDate(from)}–${E.fmtDate(to)}`, true); A.refresh(); A.render();
    },
    'abs-del': t => { const a = drawerAgent(); A.snapshot([a.id], 'Remove absence'); delete a.absence[t.dataset.date]; A.log('Absence removed', `${a.name} ${E.fmtDate(t.dataset.date)}`, true); A.refresh(); A.render(); },
    'export-agents': () => A.exportXLSX(`Peovala_agents.xlsx`, [A.REPORTS.agents.sheet()]),
    'import-agents': () => A.importModal('agents')
  });

  /* ================= Imports ================= */
  const IMPORT = {
    agents: { title: 'Import agents', help: () => `Columns: <span class="mono">${E.AGENT_HEADERS.join(', ')}</span>. Times as HH:MM, days as Mon Tue …, skills as queue IDs (${A.S.queues.map(q => q.id).join(', ')}). Excel (.xlsx) or CSV.`, sample: () => E.toCSV(E.agentRows(A.S.agents.slice(0, 3))) },
    forecast: { title: 'Import interval forecast', help: () => 'Columns: <span class="mono">queue_id, date, interval_start, calls</span>. Use a date (YYYY-MM-DD) for one day, or a weekday (Mon…Sun) in the date column to apply to every matching day. Excel (.xlsx) or CSV.', sample: () => 'queue_id,date,interval_start,calls\nBIL,' + A.S.days[0] + ',07:00,41\nBIL,' + A.S.days[0] + ',07:15,48\nTEC,Sat,10:00,90' },
    history: { title: 'Import call history', help: () => 'Columns: <span class="mono">queue_id, date, calls</span> with one row per queue per day. Replaces the history used by Forecast from history.', sample: () => 'queue_id,date,calls\nBIL,' + E.addDays(A.S.days[0], -7) + ',51200' }
  };
  A.importModal = function (kind) {
    const k = IMPORT[kind]; A.UI.impKind = kind; A.UI.impMode = 'replace';
    A.openModal(k.title, () => `<p class="muted" style="margin:0">${k.help()}</p><div class="actions"><input id="imp-file" type="file" accept=".csv,.xlsx,.xls,.txt,text/csv" aria-label="Choose a file"></div><textarea id="imp-text" placeholder="Or paste rows here">${esc(k.sample())}</textarea>${kind === 'agents' ? `<div class="seg" role="group"><button data-act="imp-mode" data-val="replace" aria-pressed="${A.UI.impMode === 'replace'}">Replace roster</button><button data-act="imp-mode" data-val="append" aria-pressed="${A.UI.impMode === 'append'}">Add to roster</button></div>` : ''}<div id="imp-err"></div>`,
      `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="do-import">Import</button>`);
  };
  function readFile(file) {
    const r = new FileReader();
    if (/\.xlsx?$/i.test(file.name)) {
      r.onload = () => { try { const wb = XLSX.read(r.result, { type: 'array' }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }); A.UI.impRows = rows; $('#imp-text').value = E.toCSV(rows.slice(0, 2000)); A.toast(`${rows.length - 1} rows read from ${file.name}`); } catch (e) { $('#imp-err').innerHTML = '<p class="errlist">Could not read that Excel file.</p>'; } };
      r.readAsArrayBuffer(file);
    } else { r.onload = () => { A.UI.impRows = null; $('#imp-text').value = r.result; }; r.readAsText(file); }
  }
  Object.assign(A.ACTS, {
    'imp-mode': t => { A.UI.impMode = t.dataset.val; t.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === t)); },
    'do-import': () => {
      const S = A.S, kind = A.UI.impKind, err = $('#imp-err');
      const text = $('#imp-text').value, rows = (A.UI.impRows && E.toCSV(A.UI.impRows.slice(0, 2000)) === text) ? A.UI.impRows : E.parseCSV(text);
      try {
        if (kind === 'agents') {
          const r = E.agentsFromRows(rows, S.queues, S.settings);
          if (!r.agents.length) throw new Error('No valid agent rows. ' + (r.errors[0] || ''));
          if (A.UI.impMode === 'append') { const dup = r.agents.filter(a => S.idx[a.id] != null); if (dup.length) throw new Error(`${dup.length} agent IDs already exist, e.g. ${dup[0].id}. Use Replace roster or change the IDs.`); S.agents = S.agents.concat(r.agents); }
          else S.agents = r.agents;
          S.demo = false; S.builtDays = []; A.closeOverlay(); A.log('Agents imported', `${r.agents.length} agents`, true);
          A.withBusy('Building the schedule for the imported roster…', () => { A.derive(); A.buildNow({ silent: true }); A.toast(`Imported ${fmtN(r.agents.length)} agents${r.errors.length ? `, skipped ${r.errors.length} rows` : ''}. Schedule built.`); });
        } else if (kind === 'forecast') {
          const h = rows[0].map(x => String(x).trim().toLowerCase()), ci = k => h.indexOf(k), dc = ci('date') >= 0 ? ci('date') : ci('day');
          if (ci('queue_id') < 0 || dc < 0 || ci('interval_start') < 0 || ci('calls') < 0) throw new Error('Missing columns. Expected queue_id, date, interval_start, calls.');
          const n = A.nI(), touched = new Set(), errs = [];
          rows.slice(1).forEach((r, k) => {
            const q = S.queues.find(x => x.id === String(r[ci('queue_id')]).trim().toUpperCase()); if (!q) { errs.push(`Row ${k + 2}: unknown queue`); return; }
            const m = E.parseTime(r[ci('interval_start')]), i = m == null ? -1 : Math.floor((m - S.settings.openH * 60) / 15); if (i < 0 || i >= n) { errs.push(`Row ${k + 2}: time outside opening hours`); return; }
            const dv = String(r[dc]).trim(), calls = Math.max(0, +r[ci('calls')] || 0);
            if (E.valid(dv)) { q.override = q.override || {}; if (!q.override[dv] || !touched.has(q.id + dv)) { q.override[dv] = new Array(n).fill(0); touched.add(q.id + dv); } q.override[dv][i] = calls; }
            else { const w = E.DAYS.findIndex(x => x.toLowerCase() === dv.slice(0, 3).toLowerCase()); if (w < 0) { errs.push(`Row ${k + 2}: date not recognised`); return; } q.overrideDow = q.overrideDow || {}; if (!touched.has(q.id + 'w' + w)) { q.overrideDow[w] = new Array(n).fill(0); touched.add(q.id + 'w' + w); } q.overrideDow[w][i] = calls; }
          });
          if (!touched.size) throw new Error('No valid rows. ' + (errs[0] || ''));
          A.closeOverlay(); A.log('Forecast imported', `${touched.size} queue-days`, true); A.reqChanged(`Imported ${touched.size} queue-days of forecast${errs.length ? `, skipped ${errs.length} rows` : ''}. Build the schedule to follow it.`);
        } else if (kind === 'history') {
          const h = rows[0].map(x => String(x).trim().toLowerCase()), ci = k => h.indexOf(k);
          if (ci('queue_id') < 0 || ci('date') < 0 || ci('calls') < 0) throw new Error('Missing columns. Expected queue_id, date, calls.');
          const byQ = {};
          rows.slice(1).forEach(r => { const q = String(r[ci('queue_id')]).trim().toUpperCase(), d = String(r[ci('date')]).trim(); if (!S.queues.some(x => x.id === q) || !E.valid(d)) return; (byQ[q] = byQ[q] || []).push({ date: d, calls: +r[ci('calls')] || 0 }); });
          const qs = Object.keys(byQ); if (!qs.length) throw new Error('No valid rows found.');
          qs.forEach(q => { S.history[q] = byQ[q].sort((a, b) => a.date < b.date ? -1 : 1); });
          A.closeOverlay(); A.log('History imported', qs.join(', ')); A.render(); A.toast(`History imported for ${qs.join(', ')}`);
        }
      } catch (ex) { err.innerHTML = `<p class="errlist">${esc(ex.message)}</p>`; }
    }
  });

  /* ================= Reports ================= */
  const R = A.REPORTS = {};
  const mk = (name, desc, build) => ({ name, desc, sheet: () => ({ name, rows: build() }) });
  const ah = (w, t) => w.acts.filter(x => x.t === t);
  R.daily = mk('Daily summary', 'Calls, required and scheduled hours, service level and occupancy per queue per day.', () => {
    const S = A.S, out = [['Date', 'Day', 'Queue', 'Calls', 'AHT (s)', 'Required h', 'Scheduled on-phone h', 'Gap h', 'Service level %', 'Occupancy %', 'Understaffed intervals', 'Special day']];
    S.days.forEach((d, k) => S.rep.queues.forEach((q, qi) => { const x = q.days[k], sp = A.special(d, q.id); out.push([d, E.DAYS[E.dow(d)], q.name, Math.round(x.calls), S.queues[qi].aht, +x.reqH.toFixed(1), +x.netH.toFixed(1), +(x.netH - x.reqH).toFixed(1), +(x.sl * 100).toFixed(1), +(x.occ * 100).toFixed(1), x.underInt, sp ? sp.name : '']); }));
    return out;
  });
  R.interval = mk('Interval staffing', 'Every 15-minute interval: forecast, Erlang C requirement, scheduled staff and projected service level.', () => {
    const S = A.S, out = [['Queue', 'Date', 'Interval', 'Calls', 'AHT (s)', 'Agents needed', 'Required incl. shrinkage', 'Scheduled on phone', 'Gap', 'Service level %']];
    S.queues.forEach((q, qi) => S.days.forEach((d, k) => { const Rq = S.R[qi]; for (let i = 0; i < A.nI(); i++) out.push([q.name, d, A.tLabel(i), +Rq.calls[k][i].toFixed(1), Rq.aht, Rq.N[k][i], +Rq.req[k][i].toFixed(2), S.net[qi][k][i], +(S.net[qi][k][i] - Rq.req[k][i]).toFixed(2), +(S.rep.queues[qi].days[k].slSeries[i] * 100).toFixed(1)]); }));
    return out;
  });
  R.roster = mk('Roster', 'One row per agent, one column per day: shift times or absence codes.', () => {
    const S = A.S, out = [['Agent ID', 'Name', 'Team', 'Queue', 'Contract h', ...S.days.map(d => E.DAYS[E.dow(d)] + ' ' + d), 'Paid h']];
    A.repAgents().forEach(a => out.push([a.id, a.name, a.team, a.queue, a.hours, ...S.days.map(d => a.shifts[d] ? A.shiftText(a.shifts[d]) : a.absence[d] ? E.ABS[a.absence[d]] : 'Off'), +A.paidHours(a).toFixed(2)]));
    return out;
  });
  R.shifts = mk('Shift details', 'Every shift with its breaks, lunch and planned activities.', () => {
    const S = A.S, out = [['Agent ID', 'Name', 'Queue', 'Team', 'Date', 'Day', 'Start', 'End', 'Paid h', 'Breaks', 'Lunch', 'Other activities', 'Locked', 'Overtime min']];
    A.repAgents().forEach(a => S.days.forEach(d => { const w = a.shifts[d]; if (!w) return; const f = x => `${A.tLabel(w.s + x.at)}-${A.tLabel(w.s + x.at + x.len)}`; out.push([a.id, a.name, a.queue, a.team, d, E.DAYS[E.dow(d)], A.tLabel(w.s), A.tLabel(w.s + w.len), +(E.paidInt(w) / 4).toFixed(2), ah(w, 'B').map(f).join(', '), ah(w, 'L').map(f).join(', '), w.acts.filter(x => 'MTCO'.includes(x.t)).map(x => E.ACT[x.t].name + ' ' + f(x)).join(', '), w.locked ? 'Yes' : 'No', (w.ot || 0) * 15]); }));
    return out;
  });
  R.hours = mk('Hours vs contract', 'Scheduled paid hours plus paid absence against contract hours, per agent per week.', () => {
    const S = A.S, out = [['Agent ID', 'Name', 'Team', 'Week starting', 'Days in period', 'Contract h (pro rata)', 'Scheduled paid h', 'Paid absence h', 'Total h', 'Difference h']];
    const weeks = {}; S.days.forEach(d => { const w = E.weekStart(d); (weeks[w] = weeks[w] || []).push(d); });
    A.repAgents().forEach(a => Object.entries(weeks).forEach(([ws, ds]) => { const sch = ds.reduce((t, d) => t + (a.shifts[d] ? E.paidInt(a.shifts[d]) / 4 : 0), 0), abs = ds.filter(d => a.absence[d] && a.absence[d] !== 'UNP').length * a.hours / S.settings.daysPerWeek, con = a.hours * ds.length / 7; out.push([a.id, a.name, a.team, ws, ds.length, +con.toFixed(1), +sch.toFixed(2), +abs.toFixed(1), +(sch + abs).toFixed(1), +(sch + abs - con).toFixed(1)]); }));
    return out;
  });
  R.shrinkage = mk('Planned shrinkage', 'Breaks, lunch, activities and absence as a share of paid time, per queue per day.', () => {
    const S = A.S, out = [['Date', 'Queue', 'Scheduled h', 'Break h', 'Lunch h', 'Meeting h', 'Training h', 'Coaching h', 'Offline h', 'Absence h', 'Planned shrinkage %']];
    S.days.forEach(d => S.queues.forEach(q => { const t = { sch: 0, B: 0, L: 0, M: 0, T: 0, C: 0, O: 0, abs: 0 }; S.agents.forEach(a => { if (a.queue !== q.id) return; const w = a.shifts[d]; if (w) { t.sch += w.len / 4; w.acts.forEach(x => (t[x.t] += x.len / 4)); } if (a.absence[d]) t.abs += a.hours / S.settings.daysPerWeek; }); const paid = t.sch - t.L + t.abs, sh = t.B + t.M + t.T + t.C + t.O + t.abs; out.push([d, q.name, +t.sch.toFixed(1), +t.B.toFixed(1), +t.L.toFixed(1), +t.M.toFixed(1), +t.T.toFixed(1), +t.C.toFixed(1), +t.O.toFixed(1), +t.abs.toFixed(1), paid ? +(sh / paid * 100).toFixed(1) : 0]); }));
    return out;
  });
  R.absence = mk('Absences', 'Vacation, sickness, training and other absence days in the period.', () => {
    const S = A.S, out = [['Agent ID', 'Name', 'Team', 'Queue', 'Date', 'Type', 'Category', 'Paid', 'Hours']], cat = { pto: 'PTO', npto: 'Non-PTO', work: 'Work away from phones', other: 'Other' };
    A.repAgents().forEach(a => Object.keys(a.absence).sort().forEach(d => { if (S.days.includes(d)) { const k = a.absence[d], i = E.ABS_INFO[k] || {}; out.push([a.id, a.name, a.team, a.queue, d, E.ABS[k] || k, cat[E.absCat(k)], i.paid ? 'Yes' : 'No', +(a.hours / S.settings.daysPerWeek).toFixed(2)]); } }));
    A.repAgents().forEach(a => S.days.forEach(d => { const w = a.shifts[d]; if (w) w.acts.filter(x => x.t === 'X').forEach(x => { const i = E.ABS_INFO[x.k] || {}; out.push([a.id, a.name, a.team, a.queue, d, (E.ABS[x.k] || 'Time off') + ` (${A.tLabel(w.s + x.at)}–${A.tLabel(w.s + x.at + x.len)})`, cat[E.absCat(x.k)], i.paid ? 'Yes' : 'No', x.len / 4]); }); }));
    return out;
  });
  R.requests = mk('Requests log', 'Every request with its status and decision.', () => {
    const out = [['Request ID', 'Agent ID', 'Name', 'Team', 'Type', 'Details', 'Reason', 'Submitted', 'Status', 'Decided by', 'Decided', 'Note']];
    A.S.requests.forEach(r => { const a = A.agent(r.agent) || {}; out.push([r.id, r.agent, a.name || '', a.team || '', A.REQ_TYPES[r.type], A.reqSummary(r), r.note || '', new Date(r.created).toISOString().slice(0, 16).replace('T', ' '), r.status, r.by || '', r.decidedAt ? new Date(r.decidedAt).toISOString().slice(0, 16).replace('T', ' ') : '', r.note2 || '']); });
    return out;
  });
  R.rules = mk('Rule compliance', 'Rest periods, consecutive days, availability, overlaps and contract hours that the current schedule breaks.', () => {
    const S = A.S, out = [['Agent ID', 'Name', 'Team', 'Date', 'Rule', 'Issue']];
    const names = { rest: 'Minimum rest', consec: 'Consecutive days', avail: 'Availability', hours: 'Opening hours', absence: 'Absence', overlap: 'Overlapping activities', act: 'Activity placement', hoursmax: 'Weekly hours' };
    A.repAgents().forEach(a => E.checkAgent(a, S.settings, S.days).forEach(x => out.push([a.id, a.name, a.team, x.date, names[x.rule] || x.rule, x.text])));
    return out;
  });
  R.starts = mk('Shift start distribution', 'How many agents start at each time, per queue per day.', () => {
    const S = A.S, out = [['Queue', 'Date', 'Start', 'Agents starting']];
    S.queues.forEach(q => S.days.forEach(d => { const c = {}; S.agents.forEach(a => { if (a.queue === q.id && a.shifts[d]) c[a.shifts[d].s] = (c[a.shifts[d].s] || 0) + 1; }); Object.keys(c).map(Number).sort((a, b) => a - b).forEach(s => out.push([q.name, d, A.tLabel(s), c[s]])); }));
    return out;
  });
  R.adherence = mk('Adherence snapshot', 'Scheduled state, actual state and adherence for the date and time chosen in Adherence.', () => {
    const { rows } = A.adhCalc(), out = [['Agent ID', 'Name', 'Team', 'Date', 'Time', 'Scheduled', 'Actual', 'Out of adherence', 'Minutes out', 'Adherence today %']];
    rows.forEach(r => out.push([r.a.id, r.a.name, r.a.team, A.UI.ad.date, A.tLabel(A.UI.ad.now), r.sched, r.actual, r.out ? 'Yes' : 'No', r.mins, +(r.adh * 100).toFixed(1)]));
    return out;
  });
  R.capacity = mk('Capacity plan', 'Weekly required against available FTE with attrition and hire classes.', () => {
    const out = [['Week', 'Week starting', 'Calls', 'Required FTE', 'Available FTE', 'Gap FTE', 'In training']];
    A.capacityModel().forEach(r => out.push([r.w + 1, r.date, Math.round(r.vol), +r.req.toFixed(1), +r.avail.toFixed(1), +r.gap.toFixed(1), r.train]));
    return out;
  });
  R.agents = mk('Agents', 'Master data in the import format, ready to edit and re-import.', () => E.agentRows(A.repAgents()));
  R.audit = mk('Audit log', 'Who changed what and when.', () => [['Time', 'User', 'Action', 'Detail'], ...A.S.audit.map(x => [new Date(x.ts).toISOString().slice(0, 19).replace('T', ' '), x.who, x.action, x.detail])]);
  A.REPORT_ALL = ['daily', 'interval', 'roster', 'shifts', 'hours', 'shrinkage', 'absence', 'requests', 'rules', 'starts', 'capacity', 'agents', 'audit'];
  A.VIEWS.reports = {
    html() {
      const key = A.UI.rep.key in R ? A.UI.rep.key : 'daily', rep = R[key], sh = rep.sheet();
      if (sh && sh.then) { sh.then(() => { if (A.UI.view === 'reports') A.render(); }).catch(e => A.toast(e.message)); }
      const rows = sh && sh.then ? [['Loading…']] : sh.rows;
      return A.head('Insights', 'Reports & exports', 'Every report exports to Excel with filters on the header row. Export the full workbook to get all of them in one file.',
        `<button class="btn primary" data-act="export-all">Export full workbook</button>`) +
        `${A.sel.size ? `<label class="check selrep"><input type="checkbox" data-bind="rep.selOnly" ${A.UI.rep.selOnly ? 'checked' : ''}> Only the ${fmtN(A.sel.size)} selected agent${A.sel.size > 1 ? 's' : ''} in agent reports and exports</label>` : ''}<div class="rep-layout"><nav class="replist">${Object.entries(R).map(([k, r]) => `<button data-set="rep.key" data-val="${k}" aria-pressed="${k === key}"><b>${esc(r.name)}</b><span>${esc(r.desc)}</span></button>`).join('')}</nav>
        <section class="panel"><div class="split"><div><h2>${esc(rep.name)}</h2><p class="sub">${fmtN(rows.length - 1)} rows${rows.length > 61 ? ' · showing the first 60' : ''}</p></div><button class="btn" data-act="export-one" data-k="${key}">Export to Excel</button></div>
          <div class="tbl-wrap" style="max-height:560px"><table><thead><tr>${(rows[0] || []).map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1, 61).map(r => `<tr>${r.map(v => `<td class="${typeof v === 'number' ? 'r num' : ''}">${esc(typeof v === 'number' ? fmtN(v, Number.isInteger(v) ? 0 : 1) : v)}</td>`).join('')}</tr>`).join('') || `<tr><td class="muted">No rows</td></tr>`}</tbody></table></div></section></div>`;
    }
  };
  Object.assign(A.ACTS, {
    'export-one': t => { const r = R[t.dataset.k]; A.withBusy('Preparing the Excel file…', async () => A.exportXLSX(`Peovala_${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${A.fileStamp()}.xlsx`, [await r.sheet()])); },
    'export-all': () => A.withBusy('Preparing the Excel workbook…', async () => { const sheets = []; for (const k of A.REPORT_ALL) sheets.push(await R[k].sheet()); A.exportXLSX(`Peovala_workbook_${A.fileStamp()}.xlsx`, sheets); })
  });

  /* ================= Settings ================= */
  A.VIEWS.settings = {
    html() {
      const S = A.S, s = S.settings, hOpt = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k).map(h => `<option value="${h}" ${h === sel ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
      const num = (id, label, val, hint, attrs = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" value="${val}" ${attrs}>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
      return A.head('Administration', 'Settings', 'Service targets, labour rules and calendars used by every forecast and schedule build.', `<button class="btn primary" data-act="save-settings">Save settings</button>`) +
        `<section class="panel">
          <div class="form-sec"><h3>Opening hours</h3><div class="form"><div class="field"><label for="st-open">Opens</label><select id="st-open">${hOpt(s.openH, 0, 12)}</select></div><div class="field"><label for="st-close">Closes</label><select id="st-close">${hOpt(s.closeH, 14, 24)}</select></div></div></div>
          <div class="form-sec"><h3>Service targets</h3><div class="form">${num('st-sl', 'Service level target (%)', Math.round(s.slTarget * 100), '', 'min="1" max="99"')}${num('st-t', 'Answered within (seconds)', s.slSeconds, '', 'min="1"')}${num('st-occ', 'Maximum occupancy (%)', Math.round(s.maxOcc * 100), 'Caps agent utilisation', 'min="50" max="100"')}${num('st-shr', 'Unplanned shrinkage (%)', Math.round(s.shrinkage * 1000) / 10, 'Sickness, meetings at short notice. Breaks and planned activities are scheduled.', 'min="0" max="60" step="0.5"')}</div></div>
          <div class="form-sec"><h3>Labour rules</h3><div class="form">${num('st-days', 'Working days per week', s.daysPerWeek, '', 'min="1" max="7"')}${num('st-consec', 'Max consecutive working days', s.maxConsec, '', 'min="1" max="14"')}${num('st-rest', 'Minimum rest between shifts (h)', s.minRestH, 'ArbZG default: 11 h', 'min="0" max="16"')}
            <div class="field"><label for="st-step">Shift start granularity</label><select id="st-step">${[[1, 'Every 15 min'], [2, 'Every 30 min'], [4, 'On the hour']].map(([v, l]) => `<option value="${v}" ${s.startStep === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="field"><label for="st-cons">Start-time consistency</label><select id="st-cons">${[[0.02, 'Flexible'], [0.15, 'Balanced'], [0.6, 'Same start every day']].map(([v, l]) => `<option value="${v}" ${s.consistency === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div></div>
          <div class="form-sec"><h3>Breaks & lunch</h3><div class="form">${num('st-lunch', 'Lunch length (min)', s.lunchMin, 'Unpaid', 'min="0" step="15"')}${num('st-lafter', 'Lunch for shifts over (paid h)', s.lunchAfterPaidH, 'ArbZG: 30 min over 6 h', 'min="0" step="0.5"')}${num('st-break', 'Break length (min)', s.breakMin, 'Paid', 'min="0" step="15"')}${num('st-bevery', 'One break per (paid h)', s.breakEveryPaidH, '', 'min="1" step="0.5"')}${num('st-gap', 'Min. gap between activities (min)', s.minGapMin, 'Also from shift start and end', 'min="0" step="15"')}</div></div>
          <div class="form-sec"><h3>Time off</h3><div class="form">${num('st-annual', 'Annual leave days', s.annualLeaveDays, '', 'min="0" max="60"')}<div class="field"><span class="flabel">Approval</span><label class="check"><input type="checkbox" id="st-auto" ${s.autoApproveTimeOff ? 'checked' : ''}> Auto-approve time off within the allowance</label></div></div></div>
        </section>
        <section class="panel mt"><div class="split"><div><h2>Holidays & special days</h2><p class="sub">Scale forecast volume on a date: 0 closes the centre, 1.3 means 30% more calls. Leave queue empty for all queues.</p></div></div>
          <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Name</th><th class="r">Volume factor</th><th>Queue</th><th></th></tr></thead><tbody>
          ${S.specials.map((sp, i) => `<tr><td class="num">${E.fmtDateY(sp.date)} <span class="muted">${E.DAYS[E.dow(sp.date)]}</span></td><td>${esc(sp.name)}</td><td class="r num">${sp.factor === 0 ? 'Closed' : '×' + sp.factor}</td><td>${sp.queue || 'All'}</td><td><button class="x" data-act="sp-del" data-i="${i}" aria-label="Remove">×</button></td></tr>`).join('')}
          <tr><td><input id="sp-date" type="date" value="${S.days[0]}"></td><td><input id="sp-name" type="text" placeholder="e.g. Product launch"></td><td class="r"><input id="sp-f" type="number" step="0.05" min="0" value="1.2" style="width:80px"></td><td><select id="sp-q"><option value="">All</option>${S.queues.map(q => `<option>${q.id}</option>`).join('')}</select></td><td><button class="btn sm" data-act="sp-add">Add</button></td></tr>
          </tbody></table></div></section>
        <section class="panel mt"><h2>Audit log</h2><p class="sub">Latest changes. The full log is in Reports & exports.</p><table class="mini"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Detail</th></tr></thead><tbody>${S.audit.slice(0, 25).map(x => `<tr><td class="num">${new Date(x.ts).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(x.who)}</td><td>${esc(x.action)}</td><td>${esc(x.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No changes yet</td></tr>'}</tbody></table></section>
        <section class="panel mt"><h2>Data</h2><p class="sub">Everything is stored in this browser only.</p><div class="actions"><button class="btn danger" data-act="reset-demo">Reset to demo data</button><button class="btn" data-act="clear-agents">Start with an empty roster</button></div></section>`;
    }
  };
  Object.assign(A.ACTS, {
    'save-settings': () => {
      const S = A.S, s = S.settings, v = id => +$('#' + id).value, open = v('st-open'), close = v('st-close');
      if (close - open < 4) { A.toast('Opening hours must span at least 4 hours'); return; }
      const hoursChanged = open !== s.openH || close !== s.closeH;
      Object.assign(s, { openH: open, closeH: close, slTarget: Math.min(.99, Math.max(.01, v('st-sl') / 100)), slSeconds: Math.max(1, v('st-t')), maxOcc: Math.min(1, Math.max(.5, v('st-occ') / 100)), shrinkage: Math.min(.6, Math.max(0, v('st-shr') / 100)),
        daysPerWeek: Math.min(7, Math.max(1, v('st-days'))), maxConsec: Math.min(14, Math.max(1, v('st-consec'))), startStep: v('st-step'), minRestH: Math.max(0, v('st-rest')), consistency: v('st-cons'),
        lunchMin: Math.max(0, v('st-lunch')), lunchAfterPaidH: v('st-lafter'), breakMin: Math.max(0, v('st-break')), breakEveryPaidH: Math.max(1, v('st-bevery')), minGapMin: Math.max(0, v('st-gap')), annualLeaveDays: Math.max(0, v('st-annual')), autoApproveTimeOff: $('#st-auto').checked });
      if (hoursChanged) { S.queues.forEach(q => { delete q.override; delete q.overrideDow; }); S.agents.forEach(a => { a.earliest = Math.max(a.earliest, open * 60); a.latest = Math.min(a.latest, close * 60); if (a.latest <= a.earliest) { a.earliest = open * 60; a.latest = close * 60; } a.shifts = {}; }); S.builtDays = []; A.UI.id.now = A.UI.ad.now = null; }
      S.demo = false; A.log('Settings changed', hoursChanged ? 'Opening hours changed; schedule rebuilt' : 'Targets and rules', true);
      A.withBusy('Applying settings and rebuilding the schedule…', () => { A.derive(); A.buildNow({ silent: !hoursChanged }); A.toast('Settings saved and schedule rebuilt'); });
    },
    'sp-add': () => { const S = A.S, d = $('#sp-date').value, name = $('#sp-name').value.trim(), f = +$('#sp-f').value; if (!E.valid(d) || !name) { A.toast('Enter a date and a name'); return; } S.specials.push({ date: d, name, factor: Math.max(0, f), queue: $('#sp-q').value || undefined }); S.specials.sort((a, b) => a.date < b.date ? -1 : 1); A.log('Special day added', `${d} ${name}`, true); A.reqChanged('Special day added. Requirement recalculated.'); },
    'sp-del': t => { const sp = A.S.specials.splice(+t.dataset.i, 1)[0]; A.log('Special day removed', sp.date + ' ' + sp.name, true); A.reqChanged('Special day removed'); },
    'reset-demo': t => { if (!t.classList.contains('armed')) { t.classList.add('armed'); t.textContent = 'Click again to reset'; return; } A.withBusy('Loading demo data…', () => { A.freshDemo(); A.UI.id.now = A.UI.ad.now = null; A.toast('Demo data restored'); }); },
    'clear-agents': () => { const S = A.S; S.agents = []; S.requests = []; S.demo = false; A.log('Roster cleared', '', true); A.derive(); A.UI.view = 'employees'; A.render(); A.toast('Roster cleared. Import or add agents.'); }
  });

  /* ================= wiring & boot ================= */
  A.onInput = function (e) {
    const id = e.target.id;
    if (A.onFormInput(e)) return;
    if (A.timeInput && A.timeInput(e)) return;
    if (A.schedInput && A.schedInput(e)) return;
    if (A.viewInputA(e)) return;
    if (id === 'emp-q') { A.UI.emp.q = e.target.value; A.UI.emp.page = 0; A.rerenderKeepFocus(id); }
    if (id === 'sc-q') { A.UI.sc.q = e.target.value; A.UI.sc.page = 0; A.rerenderKeepFocus(id); }
    if (id === 'ap-q') { readAct(); A.UI.act.q = e.target.value; A.rerenderKeepFocus(id); }
  };
  A.onChange = function (e) {
    const t = e.target;
    if (t.id && t.id.startsWith('rf-')) { A.onFormInput(e); return; }
    if (t.id === 'imp-file' && t.files[0]) { readFile(t.files[0]); return; }
    if (t.id === 'ap-from') { readAct(); A.render(); return; }
    if (t.classList.contains('ap-team')) { readAct(); const U = A.UI.act; if (t.checked) U.teams.push(t.value); else U.teams = U.teams.filter(x => x !== t.value); U.plan = null; A.render(); return; }
    if (t.dataset.shift) {
      const a = A.agent(A.UI.drawer), d = t.dataset.shift; if (!a) return;
      A.snapshot([a.id], `Edit ${a.name} on ${E.fmtDate(d)}`);
      if (t.value === 'off') delete a.shifts[d];
      else { const st = +t.value; if (a.shifts[d]) a.shifts[d].s = st; else { const len = E.shiftSpec(a, A.S.settings).len; a.shifts[d] = { s: st, len, acts: E.defaultActs(a, A.S.settings, len) }; delete a.absence[d]; } a.shifts[d].locked = true; }
      A.S.demo = false; A.log('Shift edited', `${a.name} ${E.fmtDate(d)}: ${A.shiftText(a.shifts[d])}`, true); A.refresh(); A.UI.drawerDate = d; A.render();
      return;
    }
    if (t.dataset.lock) { const a = A.agent(A.UI.drawer), w = a && a.shifts[t.dataset.lock]; if (w) { w.locked = t.checked; A.save(); } return; }
  };

  async function boot() {
    const ok = await A.load();
    if (!ok) A.freshDemo();
    try { const h = location.hash.slice(1); if (A.VIEWS[h]) A.UI.view = h; } catch (e) { }
    A.render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
