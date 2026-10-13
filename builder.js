/* Build schedule: scope, rotations, fairness, preferences and overtime options, a before/after preview, build profiles and history. */
(function () {
  const A = window.App, E = A.E, esc = A.esc, fmtN = A.fmtN, pct = A.pct, $ = A.$;
  const clone = o => JSON.parse(JSON.stringify(o));
  const BANDS = { E: 'Early', M: 'Mid', L: 'Late' };

  /* ---------- options ---------- */
  const DEF = () => ({ from: null, to: null, queues: [], scope: 'all', teams: [], sites: [], keepLocked: true, rotations: true, weekend: 'off', pairOff: false, maxLate: 0, prefs: 'low', consistency: '', ot: false, otMax: 60, otOnlyAllowed: true, variant: 'same' });
  A.UI.bo = DEF(); A.UI.bp = null; A.UI.btq = '';
  const BO = () => A.UI.bo;
  function fixDates(bo) { const S = A.S; if (!S.days.includes(bo.from)) bo.from = S.days[0]; if (!S.days.includes(bo.to) || bo.to < bo.from) bo.to = S.days[S.days.length - 1]; }

  A.rotOf = a => { const c = A.cfg && A.cfg(); return c && a.rot ? (c.rotations || []).find(r => r.id === a.rot.id) || null : null; };
  A.rotCell = (a, d) => { const ro = A.rotOf(a); if (!ro || !E.valid(ro.anchor)) return null; const i = ((E.diffDays(ro.anchor, d) + (a.rot.off || 0)) % ro.len + ro.len) % ro.len; return ro.cells[i]; };
  const bandIdx = (k, s) => { const c = A.cfg(), b = c && c.bands && c.bands[k]; if (!b) return null; return [Math.ceil((b.from - s.openH * 60) / 15), Math.floor((b.to - s.openH * 60) / 15)]; };

  function inScopeFn(bo) {
    const S = A.S, qs = bo.queues.length ? new Set(bo.queues) : null, teams = new Set(bo.teams), sites = new Set(bo.sites);
    return a => (!qs || qs.has(a.queue)) && (bo.scope === 'all' || (bo.scope === 'teams' && teams.has(a.team)) || (bo.scope === 'sites' && sites.has(a.site)) || (bo.scope === 'selected' && A.sel.has(a.id)));
  }
  function scopeLabel(bo) {
    const S = A.S, q = bo.queues.length ? bo.queues.join(', ') : 'all queues';
    const who = bo.scope === 'all' ? 'all agents' : bo.scope === 'teams' ? `${bo.teams.length} team${bo.teams.length === 1 ? '' : 's'}` : bo.scope === 'sites' ? bo.sites.join(', ') : `${A.sel.size} selected agents`;
    return `${E.fmtDate(bo.from)} – ${E.fmtDate(bo.to)} · ${q} · ${who}`;
  }

  /* ---------- run the engine ---------- */
  function runBuild(bo) {
    const S = A.S, s = S.settings, c = A.cfg ? A.cfg() : null, t0 = performance.now();
    fixDates(bo);
    const qIdx = S.queues.map((q, i) => i).filter(i => !bo.queues.length || bo.queues.includes(S.queues[i].id));
    const days = S.days.filter(d => d >= bo.from && d <= bo.to), kIdx = days.map(d => S.days.indexOf(d));
    const R = qIdx.map(i => ({ req: kIdx.map(k => S.R[i].req[k]) }));
    const inScope = inScopeFn(bo), dset = new Set(days);
    const scopeIdx = [], frozen = new Set();
    const agents = S.agents.map((a, i) => {
      if (!inScope(a)) { frozen.add(i); return a; }
      scopeIdx.push(i);
      if (bo.keepLocked) return a;
      const sh = {}; Object.entries(a.shifts).forEach(([d, w]) => { sh[d] = dset.has(d) && w.locked ? Object.assign({}, w, { locked: false }) : w; });
      return Object.assign({}, a, { shifts: sh });
    });
    if (!scopeIdx.length) return { err: 'No agents match this scope' };
    const s2 = bo.consistency !== '' ? Object.assign({}, s, { consistency: +bo.consistency }) : s;
    const opts = { frozen, weekend: bo.weekend, pairOff: bo.pairOff, maxLate: +bo.maxLate || 0 };
    let rotN = 0;
    if (bo.rotations && c) {
      const cache = new Map();
      opts.dayRule = (ai, k) => {
        const a = agents[ai], v = A.rotCell(a, days[k]); if (v == null) return null;
        if (k === 0) rotN++;
        if (v === 'off') return { off: true };
        if (v === 'any') return { work: true };
        if (BANDS[v]) { const b = cache.get(v) || bandIdx(v, s); cache.set(v, b); return b ? { work: true, lo: b[0], hi: b[1], label: BANDS[v] } : { work: true }; }
        if (v.startsWith('t:')) { const t = (c.templates || []).find(x => x.name === v.slice(2)); if (t && t.end > t.start) return { work: true, at: Math.round((t.start - s.openH * 60) / 15), len: Math.round((t.end - t.start) / 15), label: t.name }; return { work: true }; }
        return { work: true };
      };
    }
    if (bo.prefs !== 'off') {
      const w = bo.prefs === 'high' ? 10 : 1.5;
      opts.pref = ai => { const p = agents[ai].pref; if (!p || (!p.band && !(p.off || []).length)) return null; return { band: p.band ? bandIdx(p.band, s) : null, off: p.off || [], w }; };
    }
    if (bo.ot) {
      opts.ot = { maxInt: Math.round(bo.otMax / 15), min: 0.5 };
      if (bo.otOnlyAllowed && A.contractOf) opts.ot.allowed = ai => { const k = A.contractOf(agents[ai]); return !k || k.otAllowed !== false; };
      if (A.contractOf) opts.ot.maxLen = ai => { const k = A.contractOf(agents[ai]), sp = E.shiftSpec(agents[ai], s); return k && k.maxDayH ? Math.floor(k.maxDayH * 4) + (sp.len - Math.round(sp.paidMin / 15)) : Infinity; };
    }
    const seed = bo.variant === 'new' ? (S.seed || 7) + 1 : (S.seed || 7);
    const res = E.buildSchedule(agents, qIdx.map(i => S.queues[i]), s2, R, days, seed, opts);
    // what changes: for every agent in scope and day in range, unless the shift is locked and kept
    const changes = [];
    scopeIdx.forEach(ai => {
      const a = S.agents[ai], src = agents[ai];
      days.forEach(d => { const cur = src.shifts[d]; if (cur && cur.locked) return; const w = res.shifts[ai][d]; if (w || a.shifts[d]) changes.push({ ai, d, w: w || null }); });
    });
    return { bo: clone(bo), days, qIdx, scopeIdx, frozen, res, changes, seed, rotN, ms: performance.now() - t0 };
  }

  /* ---------- KPIs before / after ---------- */
  function kpis(scopeIdx, days) {
    const S = A.S, s = S.settings, cov = E.netCoverage(S.agents, S.queues, s, S.days), rep = E.report(S.queues, s, S.R, cov.net);
    const lateIdx = Math.round((12 * 60 - s.openH * 60) / 15), dset = new Set(days);
    let shifts = 0, paid = 0, ot = 0, issues = 0, weDays = 0, everyWE = 0, lateMax = 0, prefN = 0, prefOk = 0;
    const weeks = [...new Set(days.map(d => E.weekStart(d)))].filter(ws => days.includes(E.addDays(ws, 5)) || days.includes(E.addDays(ws, 6)));
    scopeIdx.forEach(ai => {
      const a = S.agents[ai]; let we = 0, weWeeks = new Set(), lateW = {};
      days.forEach(d => { const w = a.shifts[d]; if (!w) return; shifts++; paid += E.paidInt(w) / 4; ot += (w.ot || 0) / 4; if (E.dow(d) >= 5) { we++; weWeeks.add(E.weekStart(d)); } if (w.s >= lateIdx) { const ws = E.weekStart(d); lateW[ws] = (lateW[ws] || 0) + 1; }
        if (a.pref && a.pref.band) { prefN++; if (A.band(w) === { E: 'early', M: 'mid', L: 'late' }[a.pref.band]) prefOk++; }
        if (a.pref && (a.pref.off || []).includes(E.dow(d))) prefN++; });
      if (a.pref) days.forEach(d => { if (!a.shifts[d] && (a.pref.off || []).includes(E.dow(d))) { prefN++; prefOk++; } });
      weDays += we; if (weeks.length > 1 && weeks.every(ws => weWeeks.has(ws))) everyWE++;
      lateMax = Math.max(lateMax, ...Object.values(lateW), 0);
      issues += E.checkAgent(a, s, days.filter(d => dset.has(d))).length;
    });
    return { rep, shifts, paid, ot, issues, weAvg: scopeIdx.length ? weDays / scopeIdx.length : 0, everyWE, lateMax, pref: prefN ? prefOk / prefN : null, weeks: weeks.length };
  }
  function withChanges(changes, fn) {
    const S = A.S, saved = changes.map(x => ({ x, prev: S.agents[x.ai].shifts[x.d] }));
    changes.forEach(x => { const a = S.agents[x.ai]; if (x.w) a.shifts[x.d] = x.w; else delete a.shifts[x.d]; });
    try { return fn(); } finally { saved.forEach(({ x, prev }) => { const a = S.agents[x.ai]; if (prev) a.shifts[x.d] = prev; else delete a.shifts[x.d]; }); }
  }
  function preview(bo) {
    const r = runBuild(bo); if (r.err) return r;
    r.before = kpis(r.scopeIdx, r.days);
    r.after = withChanges(r.changes, () => kpis(r.scopeIdx, r.days));
    return r;
  }

  /* ---------- apply ---------- */
  function applyBuild(r, o = {}) {
    const S = A.S;
    if (!o.silent) A.snapshot(r.scopeIdx.map(ai => S.agents[ai].id), 'Build schedule');
    r.changes.forEach(x => { const a = S.agents[x.ai]; if (x.w) a.shifts[x.d] = x.w; else delete a.shifts[x.d]; });
    if (r.bo.variant === 'new') S.seed = r.seed;
    S.warnings = r.res.warnings;
    S.builtDays = Array.from(new Set(S.builtDays.concat(r.days))).sort();
    S.buildMs = r.ms; S.builtAt = Date.now(); S.stale = false;
    const slBefore = S.rep ? S.rep.total.sl : null;
    A.refresh();
    const otH = r.res.stats ? r.res.stats.otInt / 4 : 0;
    S.buildLog = S.buildLog || [];
    S.buildLog.unshift({ at: Date.now(), who: A.who(), scope: scopeLabel(r.bo), shifts: r.changes.filter(x => x.w).length, agents: r.scopeIdx.length, rot: r.rotN, otH, slBefore, slAfter: S.rep.total.sl, warnings: r.res.warnings.length, ms: Math.round(r.ms), opts: optsSummary(r.bo) });
    if (S.buildLog.length > 30) S.buildLog.length = 30;
    if (!o.silent) A.log('Schedule built', `${scopeLabel(r.bo)} · ${fmtN(r.changes.filter(x => x.w).length)} shifts${otH ? ' · ' + fmtN(otH, 1) + ' h overtime' : ''} · ${fmtN(r.ms)} ms`, true);
    A.persistDays && A.persistDays(r.changes.map(x => [S.agents[x.ai].id, x.d]), 'Build schedule', true);
  }
  function optsSummary(bo) {
    const o = [];
    if (bo.rotations) o.push('rotations');
    if (bo.weekend !== 'off') o.push(bo.weekend === 'fair' ? 'fair weekends' : 'alternate weekends');
    if (bo.pairOff) o.push('days off together');
    if (+bo.maxLate) o.push(`max ${bo.maxLate} late/week`);
    if (bo.prefs !== 'off') o.push(bo.prefs === 'high' ? 'preferences (strong)' : 'preferences');
    if (bo.ot) o.push(`overtime up to ${bo.otMax} min`);
    if (!bo.keepLocked) o.push('manual edits rebuilt');
    return o.join(', ') || 'standard';
  }

  // every other build in the app (settings changes, demo data) uses the same options as the last build from the dialog
  A.buildNow = function (opts = {}) {
    const S = A.S, bo = Object.assign(DEF(), S.lastBuild || {}, { from: S.days[0], to: S.days[S.days.length - 1], scope: 'all', teams: [], sites: [], variant: 'same' });
    bo.queues = opts.queue != null && opts.queue >= 0 ? [S.queues[opts.queue].id] : [];
    bo.keepLocked = !opts.unlock;
    const r = runBuild(bo); if (r.err) return;
    applyBuild(r, { silent: opts.silent });
  };

  /* ---------- dialog ---------- */
  const sel = (id, opts, cur, label) => `<div class="field"><label for="${id}">${label}</label><select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  function optionsBody() {
    const S = A.S, bo = BO(); fixDates(bo);
    const c = A.cfg ? A.cfg() : null, inScope = inScopeFn(bo), scoped = S.agents.filter(inScope);
    const teams = [...new Set(S.agents.filter(a => !bo.queues.length || bo.queues.includes(a.queue)).map(a => a.team))].sort(), sites = [...new Set(S.agents.map(a => a.site).filter(Boolean))].sort();
    const tq = A.UI.btq.trim().toLowerCase(), tShow = teams.filter(t => !tq || t.toLowerCase().includes(tq));
    const dOpt = (cur, min) => S.days.filter(d => !min || d >= min).map(d => [d, E.fmtDate(d)]);
    const days = S.days.filter(d => d >= bo.from && d <= bo.to), dset = new Set(days);
    const locked = scoped.reduce((t, a) => t + days.filter(d => a.shifts[d] && a.shifts[d].locked).length, 0);
    const rotCnt = {}; scoped.forEach(a => { const ro = A.rotOf(a); if (ro) rotCnt[ro.name] = (rotCnt[ro.name] || 0) + 1; });
    const rotTotal = Object.values(rotCnt).reduce((t, v) => t + v, 0), prefN = scoped.filter(a => a.pref).length;
    const profiles = S.buildProfiles || [];
    const log = (S.buildLog || []).slice(0, 4);
    return `<div class="bo-top"><div class="field"><label for="bo-profile">Build profile</label><select id="bo-profile"><option value="">Choose a saved profile…</option>${profiles.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')}</select></div><span class="actions"><input id="bo-pname" type="text" placeholder="Profile name (optional)" aria-label="Profile name" maxlength="80"><button class="btn sm" data-act="bo-save-profile">Save options as profile</button>${profiles.length ? '<button class="btn sm ghost" data-act="bo-del-profile">Delete profile</button>' : ''}</span></div>
      <div class="bo-grid">
      <section class="bo-sec"><h3>What to build</h3>
        <div class="form" style="grid-template-columns:1fr 1fr">${sel('bo-from', dOpt(), bo.from, 'From')}${sel('bo-to', dOpt(null, bo.from), bo.to, 'To')}</div>
        <div class="field"><span class="flabel">Queues</span><div class="days-pick">${S.queues.map(q => `<label><input type="checkbox" class="bo-q" value="${q.id}" ${!bo.queues.length || bo.queues.includes(q.id) ? 'checked' : ''}>${esc(q.name)}</label>`).join('')}</div></div>
        <div class="field"><span class="flabel">Agents</span><div class="seg" role="group">${[['all', 'Everyone'], ['teams', 'Teams'], ['sites', 'Sites'], ['selected', `Selected (${fmtN(A.sel.size)})`]].map(([k, l]) => `<button data-act="bo-scope" data-val="${k}" aria-pressed="${bo.scope === k}">${l}</button>`).join('')}</div></div>
        ${bo.scope === 'teams' ? `<div class="field"><input id="bo-tq" type="search" placeholder="Filter teams" value="${esc(A.UI.btq)}" aria-label="Filter teams"><div class="bo-list">${tShow.map(t => `<label class="check"><input type="checkbox" class="bo-team" value="${esc(t)}" ${bo.teams.includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('') || '<span class="muted">No teams match</span>'}</div><span class="hint">${bo.teams.length} chosen · <button class="linkbtn" data-act="bo-teams-all">choose all shown</button> · <button class="linkbtn" data-act="bo-teams-none">clear</button></span></div>` : ''}
        ${bo.scope === 'sites' ? `<div class="days-pick">${sites.map(x => `<label><input type="checkbox" class="bo-site" value="${esc(x)}" ${bo.sites.includes(x) ? 'checked' : ''}>${esc(x)}</label>`).join('')}</div>` : ''}
        <p class="bo-count"><b>${fmtN(scoped.length)}</b> agents · <b>${days.length}</b> days${scoped.length < S.agents.length ? '. Everyone else keeps their shifts and still counts towards coverage.' : ''}</p>
        <label class="check"><input type="checkbox" id="bo-keep" ${bo.keepLocked ? 'checked' : ''}> Keep ${fmtN(locked)} locked shifts (manual edits, approved requests, planned activities)</label>
      </section>
      <section class="bo-sec"><h3>Rotations</h3>
        <label class="check"><input type="checkbox" id="bo-rot" ${bo.rotations ? 'checked' : ''}> Follow rotation patterns</label>
        <p class="muted bo-note">${rotTotal ? `${fmtN(rotTotal)} agent${rotTotal > 1 ? 's' : ''} in scope ${rotTotal > 1 ? 'are' : 'is'} on a rotation: ${Object.entries(rotCnt).map(([k, v]) => `${esc(k)} (${fmtN(v)})`).join(', ')}. They work the pattern's days and shift bands; everyone else is planned freely.` : 'Nobody in scope is on a rotation yet.'} <button class="linkbtn" data-act="bo-rotations">Set up rotations</button></p>
        <h3 class="mt">Fairness & preferences</h3>
        <div class="form" style="grid-template-columns:1fr 1fr">
          ${sel('bo-we', [['off', 'No weekend rule'], ['fair', 'Share weekends fairly'], ['alternate', 'Alternate weekends where possible']], bo.weekend, 'Weekends')}
          ${sel('bo-late', [[0, 'No limit'], [1, '1 per week'], [2, '2 per week'], [3, '3 per week'], [4, '4 per week']], bo.maxLate, 'Late shifts (from 12:00)')}
          ${sel('bo-prefs', [['off', 'Ignore'], ['low', 'Consider'], ['high', 'Strongly prefer']], bo.prefs, `Agent preferences (${fmtN(prefN)} have some)`)}
          ${sel('bo-cons', [['', 'Use the Settings value'], [0.02, 'Flexible'], [0.15, 'Balanced'], [0.6, 'Same start every day']], bo.consistency, 'Start times across the week')}
        </div>
        <label class="check"><input type="checkbox" id="bo-pair" ${bo.pairOff ? 'checked' : ''}> Keep days off together</label>
      </section>
      <section class="bo-sec"><h3>Coverage</h3>
        <label class="check"><input type="checkbox" id="bo-ot" ${bo.ot ? 'checked' : ''}> Close remaining gaps with overtime</label>
        ${bo.ot ? `<div class="form" style="grid-template-columns:1fr 1fr">${sel('bo-otmax', [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']], bo.otMax, 'Up to per shift')}<div class="field"><span class="flabel">&nbsp;</span><label class="check"><input type="checkbox" id="bo-otok" ${bo.otOnlyAllowed ? 'checked' : ''}> Only contracts that allow overtime</label></div></div><p class="muted bo-note">Shifts are extended at the start or end into intervals that are still short, within availability, rest rules and the contract's daily maximum.</p>` : ''}
        ${sel('bo-var', [['same', 'Repeatable result'], ['new', 'Try a different solution']], bo.variant, 'Solution')}
      </section>
      ${log.length ? `<section class="bo-sec"><h3>Recent builds</h3><table class="mini"><tbody>${log.map(l => `<tr><td class="num">${new Date(l.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(l.scope)}<div class="sub2">${esc(l.opts)}</div></td><td class="r num">${l.slBefore != null ? pct(l.slBefore, 1) + ' → ' : ''}${pct(l.slAfter, 1)}</td></tr>`).join('')}</tbody></table></section>` : ''}
      </div>`;
  }
  function openOptions() {
    A.UI.bp = null;
    if (!BO().from) Object.assign(BO(), A.S.lastBuild || {}, { scope: 'all', teams: [], sites: [] });
    fixDates(BO());
    A.openModal('Build schedule', optionsBody, () => `<button class="btn" data-act="close">Cancel</button><button class="btn" data-act="bo-preview">Preview</button><button class="btn primary" data-act="bo-run">Build schedule</button>`, { wide: true });
  }
  function readBo() {
    const bo = BO(), v = id => document.getElementById(id); if (!v('bo-from')) return;
    bo.from = v('bo-from').value; bo.to = v('bo-to').value; if (bo.to < bo.from) bo.to = bo.from;
    const qs = [...document.querySelectorAll('.bo-q')]; bo.queues = qs.every(x => x.checked) ? [] : qs.filter(x => x.checked).map(x => x.value);
    document.querySelectorAll('.bo-team').forEach(x => { if (x.checked && !bo.teams.includes(x.value)) bo.teams.push(x.value); if (!x.checked) bo.teams = bo.teams.filter(t => t !== x.value); });
    if (document.querySelector('.bo-site')) bo.sites = [...document.querySelectorAll('.bo-site:checked')].map(x => x.value);
    bo.keepLocked = v('bo-keep').checked; bo.rotations = v('bo-rot').checked; bo.weekend = v('bo-we').value; bo.maxLate = +v('bo-late').value; bo.prefs = v('bo-prefs').value; bo.consistency = v('bo-cons').value; bo.pairOff = v('bo-pair').checked;
    bo.ot = v('bo-ot').checked; if (v('bo-otmax')) { bo.otMax = +v('bo-otmax').value; bo.otOnlyAllowed = v('bo-otok').checked; } bo.variant = v('bo-var').value;
  }
  function refresh(focusId) { const el = focusId && document.getElementById(focusId), pos = el && el.selectionStart; const b = document.querySelector('.modal .body'), top = b ? b.scrollTop : 0; A.renderOverlay(); const b2 = document.querySelector('.modal .body'); if (b2) b2.scrollTop = top; const n = focusId && document.getElementById(focusId); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { } } }
  function validate(bo) {
    if (bo.scope === 'teams' && !bo.teams.length) return 'Choose at least one team';
    if (bo.scope === 'sites' && !bo.sites.length) return 'Choose at least one site';
    if (bo.scope === 'selected' && !A.sel.size) return 'Select agents first: tick the boxes next to their names';
    if (!inScopeFn(bo) || !A.S.agents.some(inScopeFn(bo))) return 'No agents match this scope';
    return null;
  }

  /* ---------- preview ---------- */
  function previewBody() {
    const r = A.UI.bp, b = r.before, a = r.after, S = A.S;
    const row = (label, x, y, fmt, better) => { const d = y - x, good = better === 'up' ? d > 0.0005 : better === 'down' ? d < -0.0005 : null; return `<tr><td>${label}</td><td class="r num">${fmt(x)}</td><td class="r num"><b>${fmt(y)}</b></td><td class="r num ${good == null || Math.abs(d) < 0.0005 ? 'muted' : good ? 'good-ink' : 'crit-ink'}">${Math.abs(d) < 0.0005 ? '–' : (d > 0 ? '+' : '−') + fmt(Math.abs(d))}</td></tr>`; };
    const pf = v => v == null ? '–' : pct(v, 1), h = v => fmtN(v, 0) + ' h', n0 = v => fmtN(v), n1 = v => fmtN(v, 1);
    const qRows = r.qIdx.map(i => row(esc(S.queues[i].name) + ' service level', b.rep.queues[i].week.sl, a.rep.queues[i].week.sl, pf, 'up')).join('');
    const st = r.res.stats || {};
    return `<p style="margin:0">${esc(scopeLabel(r.bo))}. Options: ${esc(optsSummary(r.bo))}. Nothing is saved until you apply.</p>
      <div class="tbl-wrap mt"><table class="cmp"><thead><tr><th></th><th class="r">Now</th><th class="r">After build</th><th class="r">Change</th></tr></thead><tbody>
        <tr class="grp"><td colspan="4">Service</td></tr>
        ${row('Service level, all queues', b.rep.total.sl, a.rep.total.sl, pf, 'up')}${qRows}
        ${row('Understaffed hours', b.rep.total.under, a.rep.total.under, h, 'down')}${row('Overstaffed hours', b.rep.total.over, a.rep.total.over, h, 'down')}
        <tr class="grp"><td colspan="4">Agents in scope (${fmtN(r.scopeIdx.length)})</td></tr>
        ${row('Shifts', b.shifts, a.shifts, n0)}${row('Paid hours', b.paid, a.paid, h)}${row('Overtime hours', b.ot, a.ot, n1, 'down')}
        ${row('Rule warnings', b.issues, a.issues, n0, 'down')}
        <tr class="grp"><td colspan="4">Fairness</td></tr>
        ${row('Weekend days per agent', b.weAvg, a.weAvg, n1)}${b.weeks > 1 ? row(`Agents working every weekend (${b.weeks})`, b.everyWE, a.everyWE, n0, 'down') : ''}
        ${row('Most late shifts in a week (one agent)', b.lateMax, a.lateMax, n0, 'down')}
        ${a.pref != null ? row('Preferences met', b.pref ?? 0, a.pref, pf, 'up') : ''}
      </tbody></table></div>
      <ul class="bo-facts">${r.rotN ? `<li>${fmtN(r.rotN)} agents followed their rotation${st.bandFallback ? `; ${fmtN(st.bandFallback)} shifts couldn't fit the band inside the agent's availability` : ''}.</li>` : ''}${st.otInt ? `<li>${fmtN(st.otInt / 4, 1)} hours of overtime added to close gaps.</li>` : ''}<li>${fmtN(r.changes.filter(x => x.w).length)} shifts will be written, built in ${fmtN(r.ms)} ms.</li>${r.res.warnings.length ? `<li>${fmtN(r.res.warnings.length)} builder warnings, e.g. ${esc(r.res.warnings[0])}</li>` : ''}</ul>`;
  }

  Object.assign(A.ACTS, {
    'build-open': () => openOptions(),
    'bo-scope': t => { readBo(); BO().scope = t.dataset.val; refresh(); },
    'bo-teams-all': () => { readBo(); const q = A.UI.btq.trim().toLowerCase(); [...new Set(A.S.agents.filter(a => !BO().queues.length || BO().queues.includes(a.queue)).map(a => a.team))].filter(t => !q || t.toLowerCase().includes(q)).forEach(t => { if (!BO().teams.includes(t)) BO().teams.push(t); }); refresh(); },
    'bo-teams-none': () => { readBo(); BO().teams = []; refresh(); },
    'bo-rotations': () => { A.closeOverlay(); A.UI.view = 'settings'; if (A.UI.st) A.UI.st.tab = 'rotations'; A.render(); },
    'bo-save-profile': () => {
      const typed = (($('#bo-pname') || {}).value || '').trim(); readBo(); const S = A.S;
      const list = S.buildProfiles = S.buildProfiles || [];
      const base = BO().scope === 'all' ? 'Everyone' : BO().scope === 'teams' ? BO().teams.slice(0, 2).join(', ') + (BO().teams.length > 2 ? ' +' + (BO().teams.length - 2) : '') : BO().scope === 'sites' ? BO().sites.join(', ') : 'Selected agents';
      const p = { name: (typed || `${base}: ${optsSummary(BO())}`).slice(0, 80), opts: Object.assign(clone(BO()), { from: null, to: null }) };
      const i = list.findIndex(x => x.name === p.name); if (i >= 0) list[i] = p; else list.push(p);
      A.save(); refresh(); A.toast(`Profile saved: ${p.name}`);
    },
    'bo-del-profile': () => { const S = A.S, i = +($('#bo-profile') || {}).value; if (!(i >= 0) || !S.buildProfiles[i] || $('#bo-profile').value === '') { A.toast('Choose a profile to delete first'); return; } const p = S.buildProfiles.splice(i, 1)[0]; A.save(); refresh(); A.toast('Profile deleted: ' + p.name); },
    'bo-preview': () => {
      readBo(); const err = validate(BO()); if (err) { A.toast(err); return; }
      A.closeOverlay();
      A.withBusy('Building a preview…', () => {
        const r = preview(BO()); if (r.err) { A.toast(r.err); return; }
        A.UI.bp = r;
        setTimeout(() => A.openModal('Build preview', previewBody, () => `<button class="btn" data-act="bo-back">Back to options</button><button class="btn" data-act="close">Discard</button><button class="btn primary" data-act="bo-apply">Apply this build</button>`, { wide: true }), 0);
      });
    },
    'bo-back': () => openOptions(),
    'bo-apply': () => {
      const r = A.UI.bp; if (!r) return; A.closeOverlay();
      A.withBusy('Applying the schedule…', () => { applyBuild(r); A.S.lastBuild = Object.assign(clone(r.bo), { from: null, to: null }); A.UI.bp = null; A.toast(`Schedule built: ${fmtN(r.changes.filter(x => x.w).length)} shifts · service level ${pct(A.S.rep.total.sl, 1)}`); });
    },
    'bo-run': () => {
      readBo(); const err = validate(BO()); if (err) { A.toast(err); return; }
      const bo = clone(BO()); A.closeOverlay();
      A.withBusy(`Building the schedule for ${scopeLabel(bo)}…`, () => { const r = runBuild(bo); if (r.err) { A.toast(r.err); return; } applyBuild(r); A.S.lastBuild = Object.assign(clone(bo), { from: null, to: null }); A.toast(`Schedule built in ${fmtN(r.ms)} ms: ${fmtN(r.changes.filter(x => x.w).length)} shifts · service level ${pct(A.S.rep.total.sl, 1)}`); });
    }
  });
  ['build-open', 'bo-preview', 'bo-run', 'bo-apply'].forEach(n => { const f = A.ACTS[n]; A.ACTS[n] = function () { if (A.can && !A.can('build')) { A.toast(`${A.roleName ? A.roleName(A.UI.role) : 'This role'} can't build schedules. An administrator can allow it in Settings → Roles & permissions.`); return; } return f.apply(this, arguments); }; });
  document.addEventListener('change', e => {
    if (!A.UI.modal || A.UI.modal.title !== 'Build schedule') return;
    const t = e.target;
    if (t.id === 'bo-profile' && t.value !== '') { const p = (A.S.buildProfiles || [])[+t.value]; if (p) { const keep = { from: BO().from, to: BO().to }; Object.assign(BO(), DEF(), clone(p.opts), keep); refresh(); A.toast('Profile loaded: ' + p.name); } return; }
    if (t.id === 'bo-pname' || t.id === 'bo-tq') return;
    if (t.id && t.id.startsWith('bo-') || t.classList.contains('bo-q') || t.classList.contains('bo-team') || t.classList.contains('bo-site')) { readBo(); refresh(); }
  });
  document.addEventListener('input', e => { if (e.target.id === 'bo-tq') { readBo(); A.UI.btq = e.target.value; refresh('bo-tq'); } });
})();
