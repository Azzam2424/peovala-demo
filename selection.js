/* Agent selection (checkboxes kept across screens and edits), bulk shift edits, status-change confirmation, light/dark mode */
(function () {
  const A = window.App, E = A.E, esc = A.esc, fmtN = A.fmtN, $ = A.$;
  const SKEY = 'peovala.selection', TKEY = 'peovala.theme';

  /* ---------- selection state ---------- */
  let saved = []; try { saved = JSON.parse(localStorage.getItem(SKEY) || '[]'); } catch (e) { }
  A.sel = new Set(Array.isArray(saved) ? saved : []);
  A.UI.selOnly = false;
  A._visibleAll = [];
  const store = () => { try { localStorage.setItem(SKEY, JSON.stringify([...A.sel])); } catch (e) { } };
  A.isSel = id => A.sel.has(id);
  A.selBox = (id, name) => `<input type="checkbox" class="selbox" data-act="sel" data-id="${esc(id)}" ${A.sel.has(id) ? 'checked' : ''} aria-label="Select ${esc(name || id)}">`;
  A.selAllBox = ids => { const n = ids.filter(id => A.sel.has(id)).length; return `<input type="checkbox" class="selbox" data-act="sel-all" ${n && n === ids.length ? 'checked' : ''} aria-label="Select all ${ids.length} agents in this list" title="Select all ${ids.length} in this list">`; };
  A.selFilter = list => A.UI.selOnly && A.sel.size ? list.filter(a => A.sel.has(a.id || a)) : list;
  A.selRowCls = id => A.sel.has(id) ? 'selrow' : '';
  // agents for reports: everyone, or only the selection when that option is on
  A.repAgents = () => (A.UI.rep && A.UI.rep.selOnly && A.sel.size) ? A.S.agents.filter(a => A.sel.has(a.id)) : A.S.agents;

  let lastClicked = null;
  function toggle(id, on) { if (on) A.sel.add(id); else A.sel.delete(id); }
  Object.assign(A.ACTS, {
    sel: (t, e) => {
      const id = t.dataset.id, on = t.checked;
      if (e && e.shiftKey && lastClicked && A._visibleAll.includes(lastClicked) && A._visibleAll.includes(id)) {
        const i = A._visibleAll.indexOf(lastClicked), j = A._visibleAll.indexOf(id);
        A._visibleAll.slice(Math.min(i, j), Math.max(i, j) + 1).forEach(x => toggle(x, on));
      } else toggle(id, on);
      lastClicked = id; store(); A.render();
    },
    'sel-all': t => { const on = t.checked; A._visibleAll.forEach(id => toggle(id, on)); store(); A.render(); },
    'sel-clear': () => { A.sel.clear(); A.UI.selOnly = false; store(); A.render(); },
    'sel-only': () => { A.UI.selOnly = !A.UI.selOnly; ['sc', 'emp', 'tt'].forEach(k => { if (A.UI[k]) A.UI[k].page = 0; }); A.render(); },
    'sel-plot': () => A.openPlot([...A.sel]),
    'sel-export': () => {
      const ids = [...A.sel]; if (!ids.length) return;
      A.withBusy(`Preparing the Excel file for ${ids.length} agents…`, async () => {
        const prev = A.UI.rep.selOnly; A.UI.rep.selOnly = true;
        try {
          const R = A.REPORTS, sheets = [await R.roster.sheet(), await R.shifts.sheet(), await R.absence.sheet(), await R.hours.sheet()];
          if (R.timesheets) sheets.push(await R.timesheets.sheet(), await R.payroll.sheet());
          A.exportXLSX(`Peovala_selected_${ids.length}_agents_${A.fileStamp()}.xlsx`, sheets);
        } finally { A.UI.rep.selOnly = prev; }
      });
    },
    'sel-edit': () => openBulk()
  });

  /* ---------- floating selection bar ---------- */
  const BAR_VIEWS = ['schedule', 'employees', 'time', 'adherence', 'reports', 'requests', 'activities'];
  function renderBar() {
    let bar = document.getElementById('selbar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'selbar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Selected agents'); document.body.appendChild(bar); }
    const show = A.S && A.UI.role !== 'agent' && A.sel.size > 0 && BAR_VIEWS.includes(A.UI.view);
    bar.hidden = !show; document.body.classList.toggle('has-selbar', show);
    if (!show) return;
    const names = [...A.sel].slice(0, 3).map(id => (A.agent(id) || {}).name).filter(Boolean);
    bar.innerHTML = `<span class="sb-count"><b>${fmtN(A.sel.size)}</b> selected</span><span class="sb-names">${esc(names.join(', '))}${A.sel.size > 3 ? ' …' : ''}</span>
      <button class="btn sm ${A.UI.selOnly ? 'primary' : ''}" data-act="sel-only" aria-pressed="${A.UI.selOnly}">${A.UI.selOnly ? 'Showing selected only' : 'Show selected only'}</button>
      <button class="btn sm" data-act="sel-edit">Edit shifts</button><button class="btn sm" data-act="sel-plot">Plot absence</button><button class="btn sm" data-act="sel-export">Export to Excel</button>
      <button class="btn sm ghost" data-act="sel-clear">Clear</button>`;
  }
  const baseRender = A.render;
  A.render = function () { baseRender.apply(this, arguments); renderBar(); applyThemeButton(); };

  /* ---------- bulk shift edit for the selection ---------- */
  A.UI.be = { from: null, to: null, action: 'start', start: null, addOff: false, tpl: 0 };
  function bulkPlan() {
    const S = A.S, B = A.UI.be, n = A.nI(), out = [];
    if (!B.from || !B.to || B.to < B.from) return out;
    const days = S.days.filter(d => d >= B.from && d <= B.to);
    [...A.sel].forEach(id => {
      const a = A.agent(id); if (!a) return;
      days.forEach(d => {
        const w = a.shifts[d];
        if (B.action === 'tpl') {
          const T = tplList()[B.tpl]; if (!T) return;
          const st = Math.round((T.start - S.settings.openH * 60) / 15), len = Math.round((T.end - T.start) / 15);
          if (st < 0 || st + len > n) return;
          if (w) { if (w.s !== st || w.len !== len) out.push({ a, d, kind: 'tpl', s: st, len }); }
          else if (B.addOff && !a.absence[d] && !(a.fixedOff || []).includes(E.dow(d))) out.push({ a, d, kind: 'tpl', s: st, len });
        } else if (B.action === 'start') {
          const st = Math.round((B.start - S.settings.openH * 60) / 15);
          if (w) { const s2 = Math.max(0, Math.min(n - w.len, st)); if (s2 !== w.s || !w.locked) out.push({ a, d, kind: 'move', s: s2 }); }
          else if (B.addOff && !a.absence[d] && !(a.fixedOff || []).includes(E.dow(d))) out.push({ a, d, kind: 'add', s: st });
        } else if (B.action === 'off') { if (w) out.push({ a, d, kind: 'off' }); }
        else if (B.action === 'lock') { if (w && !w.locked) out.push({ a, d, kind: 'lock' }); }
        else if (B.action === 'unlock') { if (w && w.locked) out.push({ a, d, kind: 'unlock' }); }
      });
    });
    return out;
  }
  const tplList = () => (A.cfg && A.cfg() ? A.cfg().templates : []) || [];
  function bulkBody() {
    const S = A.S, B = A.UI.be, items = bulkPlan();
    const dOpt = sel => S.days.map(d => `<option value="${d}" ${d === sel ? 'selected' : ''}>${E.fmtDate(d)}</option>`).join('');
    let tOpt = ''; for (let m = S.settings.openH * 60; m < S.settings.closeH * 60; m += 15) tOpt += `<option value="${m}" ${m === B.start ? 'selected' : ''}>${E.fmt(m)}</option>`;
    const names = [...A.sel].map(id => (A.agent(id) || {}).name).filter(Boolean);
    return `<p style="margin:0">For <b>${names.length}</b> selected agent${names.length > 1 ? 's' : ''}: ${esc(names.slice(0, 6).join(', '))}${names.length > 6 ? ` and ${names.length - 6} more` : ''}.</p>
      <div class="form" style="grid-template-columns:1fr 1fr"><div class="field"><label for="be-from">From</label><select id="be-from">${dOpt(B.from)}</select></div><div class="field"><label for="be-to">To</label><select id="be-to">${dOpt(B.to)}</select></div></div>
      <div class="seg" role="group">${[['start', 'Set start time'], ...(tplList().length ? [['tpl', 'Apply shift template']] : []), ['off', 'Make day off'], ['lock', 'Lock shifts'], ['unlock', 'Unlock shifts']].map(([k, l]) => `<button data-act="be-set" data-val="${k}" aria-pressed="${B.action === k}">${l}</button>`).join('')}</div>
      ${B.action === 'start' ? `<div class="form" style="grid-template-columns:1fr 2fr;align-items:end"><div class="field"><label for="be-start">New start time</label><select id="be-start">${tOpt}</select><span class="hint">Shift length, breaks and lunch keep their places</span></div><label class="check"><input type="checkbox" id="be-add" ${B.addOff ? 'checked' : ''}> Also add a shift on their free working days</label></div>` : ''}
      ${B.action === 'tpl' ? `<div class="form" style="grid-template-columns:1fr 2fr;align-items:end"><div class="field"><label for="be-tpl">Template</label><select id="be-tpl">${tplList().map((t, i) => `<option value="${i}" ${i === B.tpl ? 'selected' : ''}>${esc(t.name)} · ${E.fmt(t.start)}–${E.fmt(t.end)}</option>`).join('')}</select><span class="hint">Sets start and length; breaks and lunch are placed again. Edit templates in Settings.</span></div><label class="check"><input type="checkbox" id="be-add" ${B.addOff ? 'checked' : ''}> Also add the shift on their free working days</label></div>` : ''}
      <div class="impact"><div class="flabel">Preview</div><p style="margin:0">${items.length ? `<b>${items.length}</b> shift${items.length > 1 ? 's' : ''} will change.` : 'Nothing to change for these days.'} Changed shifts are locked so the next build keeps them.</p></div>`;
  }
  function readBulk() { const B = A.UI.be, v = id => $('#' + id); if (!v('be-from')) return; B.from = v('be-from').value; B.to = v('be-to').value; if (B.to < B.from) B.to = B.from; if (v('be-start')) { B.start = +v('be-start').value; B.addOff = v('be-add').checked; } if (v('be-tpl')) { B.tpl = +v('be-tpl').value; B.addOff = v('be-add').checked; } }
  function openBulk() {
    const S = A.S, B = A.UI.be;
    if (!A.sel.size) { A.toast('Select one or more agents first'); return; }
    if (!B.from || !S.days.includes(B.from)) { B.from = A.UI.sc.date && S.days.includes(A.UI.sc.date) ? A.UI.sc.date : S.days[0]; B.to = B.from; }
    if (!S.days.includes(B.to) || B.to < B.from) B.to = B.from;
    if (B.start == null) B.start = 9 * 60;
    A.openModal('Edit shifts for selected agents', bulkBody, () => `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="be-apply">Apply</button>`, { wide: true });
  }
  Object.assign(A.ACTS, {
    'be-set': t => { readBulk(); A.UI.be.action = t.dataset.val; A.renderOverlay(); },
    'be-apply': async () => {
      readBulk(); const S = A.S, B = A.UI.be, items = bulkPlan();
      if (!items.length) { A.toast('Nothing to change for these days'); return; }
      const ids = [...new Set(items.map(x => x.a.id))];
      const T = tplList()[B.tpl], what = { start: `start ${E.fmt(B.start)}`, tpl: T ? `${T.name} ${E.fmt(T.start)}–${E.fmt(T.end)}` : 'template', off: 'day off', lock: 'locked', unlock: 'unlocked' }[B.action];
      const label = `${items.length} shift${items.length > 1 ? 's' : ''} → ${what} (${ids.length} agent${ids.length > 1 ? 's' : ''}, ${E.fmtDate(B.from)}${B.to !== B.from ? ' – ' + E.fmtDate(B.to) : ''})`;
      A.snapshot(ids, label);
      items.forEach(x => {
        const a = x.a, w = a.shifts[x.d];
        if (x.kind === 'move') { w.s = x.s; w.locked = true; }
        else if (x.kind === 'add') { const len = E.shiftSpec(a, S.settings).len, s0 = Math.max(0, Math.min(A.nI() - len, x.s)); a.shifts[x.d] = { s: s0, len, acts: E.defaultActs(a, S.settings, len), locked: true }; }
        else if (x.kind === 'tpl') { const sp = E.shiftSpec(a, S.settings); a.shifts[x.d] = { s: x.s, len: x.len, acts: E.defaultActs(a, S.settings, x.len), locked: true, ot: Math.max(0, x.len - sp.len) }; delete a.absence[x.d]; }
        else if (x.kind === 'off') delete a.shifts[x.d];
        else if (x.kind === 'lock') w.locked = true;
        else if (x.kind === 'unlock') w.locked = false;
      });
      A.log('Shifts edited for selection', label, true);
      A.closeOverlay(); A.refresh(); A.render();
      const iss = []; ids.forEach(id => E.checkAgent(A.agent(id), S.settings, S.days.filter(d => d >= E.addDays(B.from, -1) && d <= E.addDays(B.to, 1))).forEach(x => iss.push(A.agent(id).name + ': ' + x.text)));
      A.toast(iss.length ? `Saved. ${iss.length} rule warning${iss.length > 1 ? 's' : ''}, e.g. ${iss[0]}` : 'Saved: ' + label);
      await A.persistDays(items.map(x => [x.a.id, x.d]), label);
    }
  });
  document.addEventListener('change', e => {
    if (!A.UI.modal || A.UI.modal.title !== 'Edit shifts for selected agents') return;
    if (['be-from', 'be-to', 'be-start', 'be-add', 'be-tpl'].includes(e.target.id)) { readBulk(); A.renderOverlay(); }
  });

  /* ---------- confirm before an agent changes status ---------- */
  if (A.TC) {
    const doPunch = A.TC.punch;
    A.ACTS['tc-punch'] = t => {
      const code = t.dataset.code, a = A.agent(A.UI.me); if (!a) return;
      const n = A.TC.now(), ev = A.TC.events(a, n.date), sum = E.daySummary(ev, n.min), err = A.TC.check(ev, code, n.min);
      if (err) { A.toast(err); return; }
      const cur = sum.open, nm = A.TC.codeName;
      const title = code === 'LOGIN' ? 'Log in now?' : code === 'LOGOUT' ? 'Log out now?' : `Switch to ${nm(code)}?`;
      const body = `<div class="confirm">
          ${code === 'LOGIN' ? `<p>You will be logged in at <b>${E.fmt(n.min)}</b> and start in ${A.TC.pill('PROD')}.</p>`
          : code === 'LOGOUT' ? `<p>You are in ${A.TC.pill(cur)} since ${E.fmt(sum.openFrom)}. Logging out at <b>${E.fmt(n.min)}</b> ends your working time for today.</p><p class="muted">Paid time today so far: ${E.durLabel(sum.paid)}.</p>`
          : `<div class="confirm-flow">${A.TC.pill(cur)}<span class="arrow" aria-hidden="true">→</span>${A.TC.pill(code)}</div><p>You are in ${esc(nm(cur))} since ${E.fmt(sum.openFrom)} (${E.durLabel(n.min - sum.openFrom)}). The change is recorded at <b>${E.fmt(n.min)}</b>.</p>`}
          ${a.shifts[n.date] && code !== 'LOGIN' && code !== 'LOGOUT' && !E.matches(E.expectedAt(a.shifts[n.date], n.min, A.S.settings), code) ? `<p class="warnink">Your schedule says ${esc(nm(E.expectedAt(a.shifts[n.date], n.min, A.S.settings)))} right now. This change will show as out of adherence.</p>` : ''}
        </div>`;
      A.openModal(title, body, `<button class="btn" data-act="close">Cancel</button><button class="btn ${code === 'LOGOUT' ? 'danger-solid' : 'primary'}" data-act="tc-confirm" data-code="${code}" id="tc-yes">${code === 'LOGIN' ? 'Log in' : code === 'LOGOUT' ? 'Log out' : 'Yes, switch to ' + esc(nm(code))}</button>`);
      const yes = document.getElementById('tc-yes'); if (yes) yes.focus();
    };
    A.ACTS['tc-confirm'] = t => { const code = t.dataset.code; A.closeOverlay(); doPunch(code); };
  }

  /* ---------- light / dark mode ---------- */
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function storedTheme() { try { return localStorage.getItem(TKEY); } catch (e) { return null; } }
  function effective() { const t = document.documentElement.getAttribute('data-theme'); return t === 'dark' || t === 'light' ? t : (mq && mq.matches ? 'dark' : 'light'); }
  function applyStored() { const t = storedTheme(); if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); }
  applyStored();
  const ICON = {
    dark: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g></svg>'
  };
  function applyThemeButton() {
    const top = document.querySelector('#top .top-r'); if (!top) return;
    let b = document.getElementById('theme-btn');
    if (!b) { b = document.createElement('button'); b.id = 'theme-btn'; b.className = 'btn sm themebtn'; b.dataset.act = 'theme'; top.insertBefore(b, top.firstChild); }
    const cur = effective(), next = cur === 'dark' ? 'light' : 'dark';
    b.innerHTML = ICON[next] + `<span>${next === 'dark' ? 'Dark mode' : 'Light mode'}</span>`;
    b.title = `Switch to ${next} mode`; b.setAttribute('aria-label', `Switch to ${next} mode`);
  }
  A.ACTS.theme = () => {
    const next = effective() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(TKEY, next); } catch (e) { }
    A.render();
  };
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (A.S) applyThemeButton(); });
})();
