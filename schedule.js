/* Schedule: day timeline, week / month / date-range rosters, drag & drop (within a day, between days and agents), plot absence */
(function () {
  const A = window.App, E = A.E, esc = A.esc, fmtN = A.fmtN, pct = A.pct, $ = A.$;
  const clone = o => JSON.parse(JSON.stringify(o));
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthBounds = iso => { const d = new Date(E.parse(iso)); const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), b = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)]; };
  const absCls = k => 'abs-' + E.absCat(k);

  // Row order is frozen per view (day, queue, team, search) so an agent you edit stays where it is
  // Search accepts several agents at once: names or IDs separated by commas, semicolons or new lines (paste a column from Excel)
  A.searchTerms = q => String(q || '').split(/[,;\n\t]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  A.agentMatches = (a, terms) => !terms.length || terms.some(t => a.name.toLowerCase().includes(t) || a.id.toLowerCase().includes(t) || (a.team || '').toLowerCase() === t);
  function rows() {
    const S = A.S, U = A.UI.sc, q = U.queue >= 0 ? S.queues[U.queue] : null, terms = A.searchTerms(U.q), d = U.date;
    const list = A.selFilter(S.agents.filter(a => (!q || a.queue === q.id) && (!U.team || a.team === U.team) && A.agentMatches(a, terms)));
    const key = [U.mode, U.mode === 'day' ? d : '', U.queue, U.team, U.q, A.UI.selOnly, S.agents.length].join('|');
    if (U._key !== key || !U._order) {
      list.sort((a, b) => {
        if (U.mode !== 'day') return a.team.localeCompare(b.team) || a.name.localeCompare(b.name);
        const x = a.shifts[d], y = b.shifts[d]; if (!!x !== !!y) return x ? -1 : 1; if (x && y && x.s !== y.s) return x.s - y.s; return a.name.localeCompare(b.name);
      });
      U._order = new Map(list.map((a, i) => [a.id, i])); U._key = key;
    } else list.sort((a, b) => (U._order.has(a.id) ? U._order.get(a.id) : 1e9) - (U._order.has(b.id) ? U._order.get(b.id) : 1e9) || a.name.localeCompare(b.name));
    A._visibleAll = list.map(a => a.id);
    return list;
  }
  function shiftEl(a, w, n) {
    return `<div class="sh ${w.locked ? 'locked' : ''}" data-a="${esc(a.id)}" data-agent="${esc(a.id)}" style="left:${w.s / n * 100}%;width:${w.len / n * 100}%">
      <span class="hl" aria-hidden="true"></span>${w.acts.map((x, i) => `<span class="ac ${x.t}" data-i="${i}" style="left:${x.at / w.len * 100}%;width:${x.len / w.len * 100}%" title="${esc(x.t === 'X' ? (E.ABS[x.k] || 'Time off') : E.ACT[x.t].name)}"></span>`).join('')}<span class="hr" aria-hidden="true"></span></div>`;
  }
  function miniBar(w, n) {
    return `<span class="mb"><span class="mb-sh" style="left:${w.s / n * 100}%;width:${w.len / n * 100}%">${w.acts.map(x => `<span class="mb-ac ${x.t}" style="left:${x.at / w.len * 100}%;width:${x.len / w.len * 100}%"></span>`).join('')}</span></span>`;
  }
  // Expanded roster row: what the agent actually worked, from the time clock, against the scheduled paid hours
  function actualRow(a, days, wide) {
    const TC = A.TC; let actT = 0, schT = 0, any = false;
    const cells = days.map(x => {
      const w = a.shifts[x], end = TC ? TC.endMin(x) : -1;
      if (!TC || end < 0) return `<td class="acell fut"><span class="muted">${w ? 'Not yet' : ''}</span></td>`;
      const r = TC.day(a, x), sum = r.sum, sch = w ? E.paidInt(w) * 15 : 0;
      if (sum.login == null) {
        if (w) { schT += sch; any = true; return `<td class="acell miss"><b>No punches</b><span>${fmtN(sch / 60, 2)} h scheduled</span></td>`; }
        return `<td class="acell"><span class="muted">${a.absence[x] ? esc(a.absence[x]) : '–'}</span></td>`;
      }
      any = true; actT += sum.paid; schT += sch;
      const d = (sum.paid - sch) / 60, cls = !w ? 'extra' : Math.abs(d) < 0.25 ? 'ok' : d < 0 ? 'under' : 'over';
      return `<td class="acell ${cls}" title="${esc(a.name)} ${E.fmtDate(x)}: logged in ${E.fmt(sum.login)}, ${sum.open ? 'still logged in' : 'logged out ' + E.fmt(sum.logout)} · ${fmtN(sum.paid / 60, 2)} paid h worked, ${fmtN(sch / 60, 2)} h scheduled${sum.unpaid ? ' · ' + E.durLabel(sum.unpaid) + ' unpaid' : ''}">
        <span class="atime">${E.fmt(sum.login)}${wide ? '–' : '<br>'}${sum.open ? 'now' : E.fmt(sum.logout)}</span><b>${fmtN(sum.paid / 60, 2)} h</b>${w ? `<i class="adelta">${d >= 0 ? '+' : '−'}${fmtN(Math.abs(d), 2)}</i>` : '<i class="adelta">no shift</i>'}</td>`;
    }).join('');
    const tot = (actT - schT) / 60;
    return `<tr class="actrow ${A.selRowCls(a.id)}"><td class="stick"><div class="stickin actlab"><span>Actual worked</span><span class="sub2">from the time clock · paid hours</span></div></td>${cells}<td class="r num acell tot ${!any ? '' : Math.abs(tot) < 0.25 ? 'ok' : tot < 0 ? 'under' : 'over'}">${any ? `<b>${fmtN(actT / 60, 1)}</b><span class="muted">of ${fmtN(schT / 60, 1)}</span>` : '<span class="muted">–</span>'}</td></tr>`;
  }
  function navHTML() {
    const S = A.S, U = A.UI.sc, p0 = S.settings.periodStart, p1 = S.settings.periodEnd;
    if (U.mode === 'day') return A.dateStepper('sc.date', U.date);
    if (U.mode === 'week') return `<div class="dstep"><button class="btn sm" data-act="sc-nav" data-dir="-1" aria-label="Previous week">‹</button><span class="navlab">Week of ${E.fmtDate(p0, false)} – ${E.fmtDate(p1, false)}</span><button class="btn sm" data-act="sc-nav" data-dir="1" aria-label="Next week">›</button></div>`;
    if (U.mode === 'month') { const d = new Date(E.parse(p0)); return `<div class="dstep"><button class="btn sm" data-act="sc-nav" data-dir="-1" aria-label="Previous month">‹</button><span class="navlab">${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}</span><button class="btn sm" data-act="sc-nav" data-dir="1" aria-label="Next month">›</button></div>`; }
    return `<span class="navlab">${E.fmtDate(p0)} – ${E.fmtDate(p1)} · ${S.days.length} days</span><span class="muted" style="font-size:12px">Change the dates in the planning period at the top</span>`;
  }

  A.VIEWS.schedule = {
    html() {
      const S = A.S, U = A.UI.sc; U.queue = Math.min(U.queue, S.queues.length - 1);
      if (!U.date || !S.days.includes(U.date)) U.date = S.days[0];
      const qi = U.queue, q = qi >= 0 ? S.queues[qi] : null, d = U.date, k = A.dayK(d), n = A.nI(), hours = S.settings.closeH - S.settings.openH;
      const teams = [...new Set(S.agents.filter(a => !q || a.queue === q.id).map(a => a.team))].sort();
      const all = rows(), per = U.mode === 'day' ? 40 : U.mode === 'week' ? 30 : 25, pages = Math.max(1, Math.ceil(all.length / per)); U.page = Math.min(U.page, pages - 1);
      const slice = all.slice(U.page * per, U.page * per + per), canEdit = A.can ? A.can('editShifts') : A.UI.role !== 'agent';
      let body = '';
      if (U.mode === 'day') {
        const qd = q ? S.rep.queues[qi].days[k] : null, working = all.filter(a => a.shifts[d]).length;
        const axis = Array.from({ length: hours + 1 }, (_, h) => h).filter(h => h % (innerWidth < 700 ? 3 : 1) === 0).map(h => `<span style="left:${h / hours * 100}%">${String(S.settings.openH + h).padStart(2, '0')}</span>`).join('');
        body = `${q ? `<section class="panel" style="margin-bottom:14px"><div class="split"><div><h2>${esc(q.name)} coverage, ${E.fmtDate(d)}</h2><p class="sub">Projected SL ${pct(qd.sl)} · ${fmtN(qd.calls)} calls · ${fmtN(Math.abs(qd.netH - qd.reqH))} h ${qd.netH >= qd.reqH ? 'over' : 'short'}${A.special(d, q.id) ? ' · ' + esc(A.special(d, q.id).name) : ''}</p></div>${A.slPill(qd.sl)}</div><div class="chart" id="sc-cov"></div></section>` : ''}
          <div class="split" style="margin-bottom:8px"><span class="muted">${fmtN(working)} of ${fmtN(all.length)} agents working${canEdit ? ' · drag a shift to move it, drag its edges to change length, drag a break or lunch to move it' : ''}</span>
          <span class="legend" style="margin:0"><span><i class="box" style="background:var(--s1-soft);border:1px solid var(--s1)"></i>Shift</span><span><i class="box" style="background:var(--s2)"></i>Break</span><span><i class="box" style="background:var(--s3)"></i>Lunch</span><span><i class="box" style="background:var(--s7)"></i>Meeting / training</span><span><i class="box xbox"></i>Time off (part day)</span><span><i class="box lockbox"></i>Locked</span></span></div>
          <div class="gantt" style="--hours:${hours}">
            <div class="g-row hd"><div class="g-who"><label class="selhead">${A.selAllBox(A._visibleAll)}<span>Agent</span></label></div><div class="axis-row">${axis}</div><div class="g-hrs">Paid</div></div>
            ${slice.map(a => { const w = a.shifts[d], abs = a.absence[d]; return `<div class="g-row ${A.selRowCls(a.id)}"><div class="g-who-wrap">${A.selBox(a.id, a.name)}<div class="g-who" data-agent="${esc(a.id)}" data-date="${d}"><b>${esc(a.name)}${(a.skills || []).length ? ` <span class="skill">+${a.skills.join(' ')}</span>` : ''}</b><small>${esc(a.id)} · ${esc(a.team)}</small></div></div><div class="track ${canEdit ? 'editable' : ''}">${w ? shiftEl(a, w, n) : `<div class="off ${abs ? 'offabs ' + absCls(abs) : ''}">${abs ? esc(E.ABS[abs] || abs) : (a.fixedOff || []).includes(E.dow(d)) ? 'Fixed day off' : 'Day off'}</div>`}</div><div class="g-hrs">${w ? fmtN(E.paidInt(w) / 4, 2) : '–'}</div></div>`; }).join('') || '<div class="g-row"><div class="g-who muted">No agents match.</div></div>'}
          </div>`;
      } else {
        const days = S.days, wide = U.mode === 'week' || days.length <= 8, wk = U.mode === 'week';
        const dayStats = q ? days.map((x, j) => S.rep.queues[qi].days[j]) : null;
        const counts = days.map(x => all.filter(a => a.shifts[x]).length), absN = days.map(x => all.filter(a => a.absence[x]).length);
        const open = new Set(U.open || []), allOpen = slice.length && slice.every(a => open.has(a.id));
        body = `<div class="split" style="margin-bottom:8px"><span class="muted">${fmtN(all.length)} agents${canEdit ? ' · drag a shift to another day to move it, or onto a colleague to swap · click a cell to edit' : ''} · use the arrow next to a name to see actual hours worked</span><button class="btn sm ghost" data-act="sc-exp-all" data-val="${allOpen ? 0 : 1}">${allOpen ? 'Hide actual hours' : 'Show actual hours for this page'}</button>
          <span class="legend" style="margin:0"><span><i class="box band-early"></i>Early</span><span><i class="box band-mid"></i>Mid</span><span><i class="box band-late"></i>Late</span><span><i class="box abs-pto"></i>PTO</span><span><i class="box abs-npto"></i>Non-PTO</span><span><i class="box abs-work"></i>Away (training, trip)</span></span></div>
          <div class="tbl-wrap roster-wrap" id="roster-wrap"><table class="roster ${wide ? 'wide' : ''}"><thead><tr><th class="stick"><label class="selhead">${A.selAllBox(A._visibleAll)}<span>Agent</span></label></th>${days.map((x, j) => { const st = dayStats && dayStats[j]; return `<th class="${E.dow(x) >= 5 ? 'we' : ''} ${A.special(x) ? 'sp' : ''}" title="${A.special(x) ? esc(A.special(x).name) : ''}">${E.DAYS[E.dow(x)]}<br><span class="num">${E.fmtDate(x, false)}</span>${st && st.calls ? `<br><span class="slmini ${st.sl >= S.settings.slTarget ? 'ok' : st.sl >= S.settings.slTarget - 0.05 ? 'risk' : 'bad'}">${pct(st.sl, 0)}</span>` : ''}</th>`; }).join('')}<th class="r">Paid h</th></tr></thead><tbody>
          ${slice.map(a => { const isOpen = open.has(a.id); return `<tr class="${A.selRowCls(a.id)} ${isOpen ? 'expanded' : ''}"><td class="stick"><div class="stickin">${A.selBox(a.id, a.name)}<button class="exp" data-act="sc-exp" data-id="${esc(a.id)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Hide' : 'Show'} actual hours worked by ${esc(a.name)}" title="${isOpen ? 'Hide' : 'Show'} actual hours worked"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div><span class="lnk" data-agent="${esc(a.id)}">${esc(a.name)}</span><div class="sub2">${esc(a.id)} · ${esc(a.team)} · ${a.hours} h${A.rotOf && A.rotOf(a) ? ` · <span class="rotchip" title="Rotation: ${esc(A.rotOf(a).name)}">${esc(A.rotOf(a).name.split(' (')[0])}</span>` : ''}</div></div></div></td>${days.map(x => {
            const w = a.shifts[x], ab = a.absence[x], xs = w ? w.acts.filter(y => y.t === 'X') : [];
            if (w) return `<td class="cell band-${A.band(w)} ${w.locked ? 'lk' : ''} ${canEdit ? 'drag' : ''}" data-agent="${esc(a.id)}" data-date="${x}" data-has="1"><b>${A.tLabel(w.s)}${wide ? '–' + A.tLabel(w.s + w.len) : ''}</b>${wide ? miniBar(w, n) : `<span>${A.tLabel(w.s + w.len)}</span>`}${xs.length ? `<i class="xtag">${esc(xs[0].k)} ${fmtN(xs.reduce((t, y) => t + y.len, 0) / 4, 1)}h</i>` : ''}</td>`;
            if (ab) return `<td class="cell ${absCls(ab)}" data-agent="${esc(a.id)}" data-date="${x}" title="${esc(E.ABS[ab] || ab)}"><b>${esc(ab)}</b>${wide ? `<span>${esc((E.ABS[ab] || '').split(' (')[0])}</span>` : ''}</td>`;
            return `<td class="cell empty" data-agent="${esc(a.id)}" data-date="${x}"><span class="muted">${(a.fixedOff || []).includes(E.dow(x)) ? 'off' : '–'}</span></td>`;
          }).join('')}<td class="r num">${fmtN(A.paidHours(a), 1)}</td></tr>${isOpen ? actualRow(a, days, wide) : ''}`; }).join('') || `<tr><td class="muted" colspan="${days.length + 2}">No agents match.</td></tr>`}
          </tbody><tfoot><tr><td class="stick">Working / absent</td>${days.map((x, j) => `<td class="num foot">${counts[j]}<br><span class="muted">${absN[j] || ''}</span></td>`).join('')}<td></td></tr></tfoot></table></div>`;
      }
      return A.staleBanner() + A.head(`${E.fmtDateY(S.settings.periodStart)} – ${E.fmtDateY(S.settings.periodEnd)}`, 'Schedule',
        'Shifts, breaks and lunches generated to follow the requirement curve. Every edit re-checks the labour rules, updates coverage and locks the shift so the next build keeps it.',
        `<button class="btn" data-act="export-schedule">Export to Excel</button>${(A.can ? A.can('plot') : canEdit) ? '<button class="btn" data-act="ap-open">Plot absence</button>' : ''}${(A.can ? A.can('build') : A.UI.role === 'planner') ? '<button class="btn primary" data-act="build-open">Build schedule</button>' : ''}`) +
        `<div class="toolbar"><div class="seg" role="group">${[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['range', 'Date range']].map(([m, l]) => `<button data-act="sc-mode" data-val="${m}" aria-pressed="${U.mode === m}">${l}</button>`).join('')}</div>${navHTML()}</div>
        <div class="toolbar">${A.queueSeg('sc.queue', qi, true)}
          <select data-bind="sc.team" data-reset="sc.page" aria-label="Team"><option value="">All teams</option>${teams.map(t => `<option ${U.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <div class="msearch"><input id="sc-q" type="search" placeholder="Find agents: names, IDs or a team, separated by commas" value="${esc(U.q)}" autocomplete="off" aria-describedby="sc-q-hint">${A.searchTerms(U.q).length > 1 ? `<span class="msearch-n" id="sc-q-hint">${A.searchTerms(U.q).length} searches · ${fmtN(all.length)} found</span>` : `<span class="msearch-n sr" id="sc-q-hint">Separate several names or IDs with commas</span>`}</div></div>
        ${body}
        <div class="pager"><span>Page ${U.page + 1} of ${pages}</span><span class="actions"><button class="btn sm" data-set="sc.page" data-val="${U.page - 1}" data-type="num" ${U.page === 0 ? 'disabled' : ''}>Previous</button><button class="btn sm" data-set="sc.page" data-val="${U.page + 1}" data-type="num" ${U.page >= pages - 1 ? 'disabled' : ''}>Next</button></span></div>`;
    },
    after() {
      const S = A.S, U = A.UI.sc; if (U.mode !== 'day' || U.queue < 0) return;
      const qi = U.queue, k = A.dayK(U.date);
      A.drawChart('sc-cov', { n: A.nI(), height: 180, label: 'Coverage', series: [
        { name: 'Scheduled on phone', type: 'bar', values: Array.from(S.net[qi][k]), color: 'var(--s1)', opacity: .85, dp: 0 },
        { name: 'Required (incl. shrinkage)', type: 'step', values: S.R[qi].req[k], color: 'var(--s2)', dp: 1 }],
        extra: i => `<div class="row"><span>Projected SL</span><b>${pct(S.rep.queues[qi].days[k].slSeries[i], 0)}</b></div>` });
    }
  };
  document.addEventListener('paste', e => {
    const t = e.target; if (!t || !['sc-q', 'emp-q', 'tt-q', 'ad-q'].includes(t.id)) return;
    const txt = (e.clipboardData || window.clipboardData).getData('text'); if (!/[\n\t]/.test(txt)) return;
    e.preventDefault();
    const add = txt.split(/[\r\n\t]+/).map(x => x.trim()).filter(Boolean).join(', ');
    const v = t.value, a = t.selectionStart ?? v.length, b = t.selectionEnd ?? v.length;
    t.value = v.slice(0, a) + (a && !/[,;]\s*$/.test(v.slice(0, a)) ? ', ' : '') + add + v.slice(b);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
  A.schedInput = e => { if (e.target.id === 'sc-q') { A.UI.sc.q = e.target.value; A.UI.sc.page = 0; A.rerenderKeepFocus('sc-q'); return true; } if (e.target.id === 'ap-q') { A.UI.ap.q = e.target.value; refreshPlot('ap-q'); return true; } return false; };

  async function goPeriod(from, to) {
    const S = A.S;
    if (from === S.settings.periodStart && to === S.settings.periodEnd) { A.render(); return; }
    A.withBusy('Loading ' + E.fmtDate(from) + ' – ' + E.fmtDate(to) + '…', async () => {
      const ok = await A.setPeriod(from, to);
      if (ok !== false && !A.S.days.includes(A.UI.sc.date)) A.UI.sc.date = A.S.days[0];
    });
  }
  Object.assign(A.ACTS, {
    'sc-mode': t => {
      const U = A.UI.sc, m = t.dataset.val, ref = U.date || A.S.days[0]; U.mode = m; U.page = 0;
      if (m === 'week') { const ws = E.weekStart(ref); goPeriod(ws, E.addDays(ws, 6)); }
      else if (m === 'month') { const [a, b] = monthBounds(ref); goPeriod(a, b); }
      else A.render();
    },
    'sc-exp': t => { const U = A.UI.sc, id = t.dataset.id, o = new Set(U.open || []); o.has(id) ? o.delete(id) : o.add(id); U.open = [...o]; A.render(); },
    'sc-exp-all': t => { const U = A.UI.sc, per = U.mode === 'week' ? 30 : 25, ids = (A._visibleAll || []).slice(U.page * per, U.page * per + per), o = new Set(U.open || []); ids.forEach(id => (+t.dataset.val ? o.add(id) : o.delete(id))); U.open = [...o]; A.render(); },
    'sc-nav': t => {
      const U = A.UI.sc, dir = +t.dataset.dir, p0 = A.S.settings.periodStart;
      if (U.mode === 'week') { const ws = E.addDays(E.weekStart(p0), 7 * dir); U.date = ws; goPeriod(ws, E.addDays(ws, 6)); }
      if (U.mode === 'month') { const d = new Date(E.parse(p0)); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1)).toISOString().slice(0, 10); const [a, b] = monthBounds(m); U.date = a; goPeriod(a, b); }
    },
    'export-schedule': () => A.withBusy('Preparing the Excel file…', async () => A.exportXLSX(`Peovala_schedule_${A.fileStamp()}.xlsx`, [await A.REPORTS.roster.sheet(), await A.REPORTS.shifts.sheet(), await A.REPORTS.absence.sheet(), await A.REPORTS.daily.sheet()]))
  });

  /* ---------- day timeline drag & drop ---------- */
  function dragApply(D, d) {
    const n = A.nI(), w = clone(D.w0);
    const minLen = 8, actEnd = Math.max(0, ...w.acts.map(x => x.at + x.len)), actStart = Math.min(w.len, ...w.acts.map(x => x.at));
    if (D.part === 'move') w.s = Math.max(0, Math.min(n - w.len, D.w0.s + d));
    else if (D.part === 'l') { const ns = Math.max(0, Math.min(D.w0.s + Math.min(actStart, D.w0.len - minLen), D.w0.s + d)); const delta = D.w0.s - ns; w.s = ns; w.len = D.w0.len + delta; w.acts.forEach(x => (x.at += delta)); }
    else if (D.part === 'r') w.len = Math.max(Math.max(actEnd, minLen), Math.min(n - D.w0.s, D.w0.len + d));
    else if (D.part === 'act') { const x = w.acts[D.ai]; x.at = Math.max(0, Math.min(w.len - x.len, D.w0.acts[D.ai].at + d)); w.bad = w.acts.some((o, j) => j !== D.ai && x.at < o.at + o.len && o.at < x.at + x.len); }
    return w;
  }
  function issuesNear(ids, dates) {
    const lo = dates.slice().sort()[0], hi = dates.slice().sort().pop(), win = E.range(E.addDays(lo, -1), E.addDays(hi, 1)).filter(x => A.S.days.includes(x));
    const out = []; ids.forEach(id => { const a = A.agent(id); E.checkAgent(a, A.S.settings, win).forEach(x => out.push(a.name + ': ' + x.text)); });
    return out;
  }
  document.addEventListener('pointerdown', e => {
    if (!A.S || A.UI.role === 'agent' || (A.can && !A.can('editShifts')) || e.button > 0) return;
    const el = e.target.closest && e.target.closest('.track.editable .sh');
    if (el) {
      const id = el.dataset.a, date = A.UI.sc.date, a = A.agent(id), w = a && a.shifts[date]; if (!w) return;
      const part = e.target.classList.contains('hl') ? 'l' : e.target.classList.contains('hr') ? 'r' : e.target.closest('.ac') ? 'act' : 'move';
      A.drag = { kind: 'day', id, date, part, ai: part === 'act' ? +e.target.closest('.ac').dataset.i : -1, x0: e.clientX, px: el.parentElement.clientWidth / A.nI(), w0: clone(w), el, moved: false, d: 0 };
      try { el.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault(); return;
    }
    const cell = e.target.closest && e.target.closest('td.cell.drag[data-has]');
    if (cell) { A.drag = { kind: 'cell', id: cell.dataset.agent, date: cell.dataset.date, x0: e.clientX, y0: e.clientY, moved: false, src: cell }; e.preventDefault(); }
  });
  document.addEventListener('pointermove', e => {
    const D = A.drag; if (!D || D.done) return;
    if (D.kind === 'cell') {
      if (!D.moved && Math.hypot(e.clientX - D.x0, e.clientY - D.y0) < 6) return;
      if (!D.moved) { D.moved = true; D.ghost = document.createElement('div'); D.ghost.className = 'dragghost'; D.ghost.innerHTML = D.src.innerHTML; document.body.appendChild(D.ghost); D.src.classList.add('dragsrc'); document.body.classList.add('dragging-cell'); }
      D.ghost.style.left = (e.clientX + 8) + 'px'; D.ghost.style.top = (e.clientY + 8) + 'px';
      const tgt = document.elementFromPoint(e.clientX, e.clientY), cell = tgt && tgt.closest && tgt.closest('td.cell');
      document.querySelectorAll('td.cell.drop-ok, td.cell.drop-bad').forEach(c => c.classList.remove('drop-ok', 'drop-bad'));
      if (cell && cell !== D.src) { const b = A.agent(cell.dataset.agent); cell.classList.add(b && b.absence[cell.dataset.date] ? 'drop-bad' : 'drop-ok'); D.tgt = cell; } else D.tgt = null;
      const wrap = $('#roster-wrap'); if (wrap) { const r = wrap.getBoundingClientRect(); if (e.clientX > r.right - 40) wrap.scrollLeft += 18; else if (e.clientX < r.left + 200) wrap.scrollLeft -= 18; if (e.clientY > r.bottom - 30) wrap.scrollTop += 14; else if (e.clientY < r.top + 50) wrap.scrollTop -= 14; }
      const tip = $('#tip'); if (D.tgt) { const b = A.agent(D.tgt.dataset.agent), d2 = D.tgt.dataset.date; tip.innerHTML = `<div class="t">${b.id === D.id ? 'Move to ' + E.fmtDate(d2) : 'Swap with ' + esc(b.name)}</div>${b.absence[d2] ? `<div class="row"><span>${esc(E.ABS[b.absence[d2]] || 'Absent')}: not possible</span></div>` : b.shifts[d2] ? `<div class="row"><span>${b.id === D.id ? 'Swaps with the shift on that day' : esc(E.fmtDate(d2)) + ' ' + A.shiftText(b.shifts[d2])}</span></div>` : ''}`; A.placeTip(e); } else tip.hidden = true;
      return;
    }
    const dx = e.clientX - D.x0; if (Math.abs(dx) > 3) D.moved = true; if (!D.moved) return;
    D.d = Math.round(dx / D.px);
    const w = dragApply(D, D.d), n = A.nI();
    D.el.style.left = (w.s / n * 100) + '%'; D.el.style.width = (w.len / n * 100) + '%';
    D.el.querySelectorAll('.ac').forEach((ac, i) => { ac.style.left = (w.acts[i].at / w.len * 100) + '%'; ac.style.width = (w.acts[i].len / w.len * 100) + '%'; });
    D.el.classList.add('dragging'); D.el.classList.toggle('bad', !!w.bad);
    const tip = $('#tip'), x = w.acts[D.ai];
    tip.innerHTML = D.part === 'act' ? `<div class="t">${esc(x.t === 'X' ? 'Time off' : E.ACT[x.t].name)} ${A.tLabel(w.s + x.at)}–${A.tLabel(w.s + x.at + x.len)}</div>${w.bad ? '<div class="row"><span>Overlaps another activity</span></div>' : ''}`
      : `<div class="t">${A.tLabel(w.s)}–${A.tLabel(w.s + w.len)}</div><div class="row"><span>Paid</span><b>${fmtN(E.paidInt(w) / 4, 2)} h</b></div>${w.len !== D.w0.len ? `<div class="row"><span>Change</span><b>${w.len > D.w0.len ? '+' : ''}${(w.len - D.w0.len) * 15} min</b></div>` : ''}`;
    A.placeTip(e);
  });
  document.addEventListener('pointerup', () => {
    const D = A.drag; if (!D) return;
    D.done = true; $('#tip').hidden = true;
    setTimeout(() => { A.drag = null; }, 0);
    if (D.kind === 'cell') {
      if (D.ghost) D.ghost.remove(); document.body.classList.remove('dragging-cell');
      document.querySelectorAll('.dragsrc, .drop-ok, .drop-bad').forEach(c => c.classList.remove('dragsrc', 'drop-ok', 'drop-bad'));
      if (!D.moved || !D.tgt) return;
      moveCell(D.id, D.date, D.tgt.dataset.agent, D.tgt.dataset.date);
      return;
    }
    if (!D.moved || D.d === 0) { if (D.moved) A.render(); return; }
    const w = dragApply(D, D.d);
    if (w.bad) { A.toast('Activities cannot overlap. The change was not applied.'); A.render(); return; }
    delete w.bad;
    const a = A.agent(D.id), label = `${a.name} ${E.fmtDate(D.date)}: ${A.shiftText(D.w0)} → ${A.shiftText(w)}`;
    A.snapshot([D.id], `Edit ${a.name} on ${E.fmtDate(D.date)}`);
    w.locked = true; const spec = E.shiftSpec(a, A.S.settings); w.ot = Math.max(0, w.len - spec.len);
    a.shifts[D.date] = w;
    A.log('Shift edited', label, true); A.refresh(); A.render();
    const iss = issuesNear([D.id], [D.date]);
    A.toast(iss.length ? 'Saved with a rule warning: ' + iss[0] : `${a.name}: ${A.shiftText(w)} saved and locked`);
    A.persistDays([[D.id, D.date]], label);
  });
  function moveCell(idA, d1, idB, d2) {
    if (idA === idB && d1 === d2) return;
    const a = A.agent(idA), b = A.agent(idB), w1 = a.shifts[d1], w2 = b.shifts[d2];
    if (!w1) return;
    if (b.absence[d2]) { A.toast(`${b.name} is on ${E.ABS[b.absence[d2]] || 'leave'} on ${E.fmtDate(d2)}. Choose another day.`); return; }
    const ids = [...new Set([idA, idB])], same = idA === idB;
    const label = same ? `${a.name}: shift moved ${E.fmtDate(d1)} → ${E.fmtDate(d2)}${w2 ? ' (days swapped)' : ''}` : `${E.fmtDate(d1)} ${a.name} ⇄ ${E.fmtDate(d2)} ${b.name}`;
    A.snapshot(ids, label);
    const n1 = Object.assign(clone(w1), { locked: true }), n2 = w2 ? Object.assign(clone(w2), { locked: true }) : null;
    b.shifts[d2] = n1; if (n2) a.shifts[d1] = n2; else delete a.shifts[d1];
    A.log('Shift moved', label, true); A.refresh(); A.render();
    const iss = issuesNear(ids, [d1, d2]);
    const lenNote = !same && w2 && w1.len !== w2.len ? ' Paid hours change for both.' : '';
    A.toast(iss.length ? 'Moved with a rule warning: ' + iss[0] : label + '.' + lenNote);
    A.persistDays([[idA, d1], [idB, d2]], label);
  }

  /* ---------- plot absence ---------- */
  A.UI.ap = { ids: [], q: '', type: 'VAC', from: null, to: null, mode: 'full', tf: 600, tt: 720, skipOff: true, op: 'add' };
  const groups = [['Paid time off (PTO)', 'pto'], ['Not paid (non-PTO)', 'npto'], ['Working away from the phones', 'work']];
  function plan() {
    const S = A.S, P = A.UI.ap, items = [], warn = [];
    if (!E.valid(P.from) || !E.valid(P.to) || P.to < P.from) return { items, warn: ['Choose a valid date range.'] };
    const dates = E.range(P.from, P.to);
    if (dates.length > 366) return { items, warn: ['A range can cover up to one year.'] };
    const info = E.ABS_INFO[P.type] || {};
    P.ids.forEach(id => {
      const a = A.agent(id); if (!a) return;
      let leave = 0;
      dates.forEach(d => {
        if (P.skipOff && (a.fixedOff || []).includes(E.dow(d))) return;
        if (P.op === 'remove') {
          if (P.mode === 'full' && a.absence[d]) items.push({ a, d, act: 'unabs', kind: a.absence[d] });
          if (P.mode === 'part' && a.shifts[d] && a.shifts[d].acts.some(x => x.t === 'X')) items.push({ a, d, act: 'unpart' });
          return;
        }
        if (P.mode === 'full') { items.push({ a, d, act: 'abs', had: !!a.shifts[d], replace: a.absence[d] && a.absence[d] !== P.type ? a.absence[d] : null }); if (info.leave && a.absence[d] !== P.type) leave++; }
        else {
          const w = a.shifts[d]; if (!w) return;
          const st = S.settings.openH * 60 + w.s * 15, en = st + w.len * 15, f = Math.max(P.tf, st), t = Math.min(P.tt, en);
          if (t - f < 15) return;
          items.push({ a, d, act: 'part', at: Math.floor((f - st) / 15), len: Math.ceil((t - f) / 15), whole: f <= st && t >= en });
        }
      });
      if (leave && (a.leaveUsed || 0) + leave > S.settings.annualLeaveDays) warn.push(`${a.name}: ${a.leaveUsed + leave} of ${S.settings.annualLeaveDays} leave days`);
      if (leave) items.leave = Object.assign(items.leave || {}, { [a.id]: leave });
    });
    if (P.mode === 'part' && P.op === 'add' && dates.some(d => !S.days.includes(d))) warn.push('Part-day time off is only placed on days in the current planning period.');
    return { items, warn };
  }
  function plotBody() {
    const S = A.S, P = A.UI.ap, sel = P.ids.map(id => A.agent(id)).filter(Boolean);
    const q = P.q.trim().toLowerCase(), sugg = q ? S.agents.filter(a => !P.ids.includes(a.id) && (a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))).slice(0, 8) : [];
    const teams = [...new Set(S.agents.map(a => a.team))].sort();
    const tOpt = sel => { let h = ''; for (let m = S.settings.openH * 60; m <= S.settings.closeH * 60; m += 15) h += `<option value="${m}" ${m === sel ? 'selected' : ''}>${E.fmt(m)}</option>`; return h; };
    const { items, warn } = plan();
    const byDay = {}; items.forEach(x => { (byDay[x.d] = byDay[x.d] || []).push(x); });
    const dayRows = Object.keys(byDay).sort().slice(0, 40).map(d => {
      const k = A.dayK(d), list = byDay[d], qset = {};
      list.forEach(x => { if (x.act === 'abs' && x.had) qset[x.a.queue] = (qset[x.a.queue] || 0) + 1; });
      const allow = k >= 0 && A.UI.role !== 'agent' ? Object.entries(qset).map(([qid, c]) => { const qi = A.qIndex(qid), left = A.allowance(qi, k) - c; return `<span class="pill ${left >= 0 ? 'good' : 'crit'}">${esc(qid)} ${left >= 0 ? left + ' left' : Math.abs(left) + ' over'}</span>`; }).join(' ') : '<span class="muted">outside the loaded period</span>';
      return `<tr><td>${E.fmtDate(d)}</td><td class="r num">${list.length}</td><td class="r num">${list.filter(x => x.had).length || '–'}</td><td>${allow || '<span class="muted">no shifts removed</span>'}</td></tr>`;
    }).join('');
    return `<div class="field"><span class="flabel">Who</span>
        <div class="chips">${sel.map(a => `<span class="chipx">${esc(a.name)} <span class="mono">${esc(a.id)}</span><button class="x" data-act="ap-rm" data-id="${esc(a.id)}" aria-label="Remove ${esc(a.name)}">×</button></span>`).join('') || '<span class="muted">Nobody selected yet</span>'}${sel.length > 1 ? `<button class="linkbtn" data-act="ap-clear">Clear all</button>` : ''}</div>
        <div class="form" style="grid-template-columns:2fr 1fr;margin-top:6px"><div class="field"><input id="ap-q" type="search" placeholder="Search agent name or ID" value="${esc(P.q)}" autocomplete="off">${sugg.length ? `<div class="sugg">${sugg.map(a => `<button data-act="ap-add" data-id="${esc(a.id)}">${esc(a.name)} <span class="muted mono">${esc(a.id)} · ${esc(a.team)}</span></button>`).join('')}</div>` : ''}</div>
        <div class="field"><select id="ap-team" aria-label="Add a whole team"><option value="">Add a whole team…</option>${teams.map(t => `<option>${esc(t)}</option>`).join('')}</select></div></div></div>
      <div class="form" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
        <div class="field"><label for="ap-type">Type</label><select id="ap-type">${groups.map(([g, c]) => `<optgroup label="${g}">${Object.entries(E.ABS_INFO).filter(([k, v]) => E.absCat(k) === c && (!v.off || k === P.type)).map(([k, v]) => `<option value="${k}" ${P.type === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</optgroup>`).join('')}</select><span class="hint">${(E.ABS_INFO[P.type] || {}).pto ? 'PTO: paid' : (E.ABS_INFO[P.type] || {}).paid ? 'Paid, not PTO' : 'Not paid'}${(E.ABS_INFO[P.type] || {}).leave ? ' · deducts annual leave' : ''}</span></div>
        <div class="field"><label for="ap-from">From</label><input id="ap-from" type="date" value="${P.from || ''}"></div>
        <div class="field"><label for="ap-to">To</label><input id="ap-to" type="date" value="${P.to || ''}"></div>
      </div>
      <div class="toolbar" style="margin:0"><div class="seg" role="group"><button data-act="ap-set" data-k="op" data-val="add" aria-pressed="${P.op === 'add'}">Add absence</button><button data-act="ap-set" data-k="op" data-val="remove" aria-pressed="${P.op === 'remove'}">Remove absence</button></div>
        <div class="seg" role="group"><button data-act="ap-set" data-k="mode" data-val="full" aria-pressed="${P.mode === 'full'}">Full days</button><button data-act="ap-set" data-k="mode" data-val="part" aria-pressed="${P.mode === 'part'}">Part of the day</button></div>
        ${P.mode === 'part' && P.op === 'add' ? `<label class="flabel" for="ap-tf">From</label><select id="ap-tf">${tOpt(P.tf)}</select><label class="flabel" for="ap-tt">to</label><select id="ap-tt">${tOpt(P.tt)}</select>` : ''}
        <label class="check"><input type="checkbox" id="ap-skip" ${P.skipOff ? 'checked' : ''}> Skip fixed days off</label></div>
      <div class="impact"><div class="flabel">Preview</div>
        ${sel.length ? `<p style="margin:0">${P.op === 'add' ? `<b>${fmtN(items.length)}</b> ${P.mode === 'full' ? 'agent-days marked as ' + esc(E.ABS[P.type]) : 'part-day absences'}${items.filter(x => x.had).length ? `, <b>${items.filter(x => x.had).length}</b> scheduled shifts removed` : ''}${items.filter(x => x.replace).length ? `, ${items.filter(x => x.replace).length} existing absences replaced` : ''}.` : `<b>${fmtN(items.length)}</b> absences will be removed. Build the schedule afterwards to give those days shifts again.`}</p>` : '<p class="muted" style="margin:0">Add one or more agents to see the effect.</p>'}
        ${warn.length ? `<ul class="issues">${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${dayRows && P.op === 'add' && P.mode === 'full' ? `<div class="tbl-wrap" style="max-height:200px"><table class="mini"><thead><tr><th>Day</th><th class="r">Agents</th><th class="r">Shifts removed</th><th>Time-off allowance after</th></tr></thead><tbody>${dayRows}</tbody></table></div>` : ''}</div>`;
  }
  function refreshPlot(focusId) {
    const el = focusId && document.getElementById(focusId), pos = el && el.selectionStart;
    A.renderOverlay();
    const n = focusId && document.getElementById(focusId); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { } }
  }
  function readPlot() { const P = A.UI.ap, v = id => $('#' + id); if (!v('ap-type')) return; P.type = v('ap-type').value; P.from = v('ap-from').value; P.to = v('ap-to').value; P.skipOff = v('ap-skip').checked; if (v('ap-tf')) { P.tf = +v('ap-tf').value; P.tt = +v('ap-tt').value; } }
  A.openPlot = function (ids) {
    const P = A.UI.ap, S = A.S;
    if (ids) P.ids = ids.slice();
    if (!P.from || P.from < E.addDays(S.days[0], -400)) { P.from = A.UI.sc.date || S.days[0]; P.to = P.from; }
    A.openModal('Plot absence', plotBody, () => `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="ap-apply">${A.UI.ap.op === 'add' ? 'Save absence' : 'Remove absence'}</button>`, { wide: true });
  };
  Object.assign(A.ACTS, {
    'ap-open': () => A.openPlot(A.sel.size ? [...A.sel] : A.UI.drawer && A.UI.drawer !== '__new' ? [A.UI.drawer] : null),
    'ap-add': t => { readPlot(); if (!A.UI.ap.ids.includes(t.dataset.id)) A.UI.ap.ids.push(t.dataset.id); A.UI.ap.q = ''; refreshPlot('ap-q'); },
    'ap-rm': t => { readPlot(); A.UI.ap.ids = A.UI.ap.ids.filter(x => x !== t.dataset.id); refreshPlot(); },
    'ap-clear': () => { readPlot(); A.UI.ap.ids = []; refreshPlot(); },
    'ap-set': t => { readPlot(); A.UI.ap[t.dataset.k] = t.dataset.val; refreshPlot(); },
    'ap-apply': async () => {
      readPlot(); const P = A.UI.ap, S = A.S, { items, warn } = plan();
      if (!P.ids.length) { A.toast('Add at least one agent'); return; }
      if (!items.length) { A.toast(warn[0] || 'Nothing to change for these dates'); return; }
      const ids = [...new Set(items.map(x => x.a.id))];
      const label = P.op === 'add' ? `${E.ABS[P.type]} for ${ids.length === 1 ? items[0].a.name : ids.length + ' agents'}, ${E.fmtDate(P.from)}${P.to !== P.from ? ' – ' + E.fmtDate(P.to) : ''}${P.mode === 'part' ? ` ${E.fmt(P.tf)}–${E.fmt(P.tt)}` : ''}` : `Absence removed for ${ids.length} agent${ids.length > 1 ? 's' : ''}, ${E.fmtDate(P.from)} – ${E.fmtDate(P.to)}`;
      A.snapshot(ids, label, true);
      const leaveDelta = {};
      items.forEach(x => {
        const a = x.a;
        if (x.act === 'abs') { if (a.absence[x.d] === 'VAC' && P.type !== 'VAC') leaveDelta[a.id] = (leaveDelta[a.id] || 0) - 1; a.absence[x.d] = P.type; delete a.shifts[x.d]; }
        else if (x.act === 'unabs') { if (a.absence[x.d] === 'VAC') leaveDelta[a.id] = (leaveDelta[a.id] || 0) - 1; delete a.absence[x.d]; }
        else if (x.act === 'part') {
          if (x.whole) { a.absence[x.d] = P.type; delete a.shifts[x.d]; return; }
          const w = a.shifts[x.d]; w.acts = w.acts.filter(y => y.at + y.len <= x.at || y.at >= x.at + x.len); w.acts.push({ t: 'X', at: x.at, len: x.len, k: P.type }); w.acts.sort((p, q) => p.at - q.at); w.locked = true;
        } else if (x.act === 'unpart') { const w = a.shifts[x.d]; w.acts = w.acts.filter(y => y.t !== 'X'); w.locked = true; }
      });
      Object.entries(items.leave || {}).forEach(([id, n]) => (leaveDelta[id] = (leaveDelta[id] || 0) + n));
      Object.entries(leaveDelta).forEach(([id, n]) => { const a = A.agent(id); if (n) { a.leaveUsed = Math.max(0, (a.leaveUsed || 0) + n); A.saveAgentLeave(a); } });
      A.log(P.op === 'add' ? 'Absence plotted' : 'Absence removed', label, true);
      A.closeOverlay(); A.refresh(); A.render();
      A.toast(label + (warn.length ? ' · ' + warn[0] : ''));
      await A.persistDays(items.map(x => [x.a.id, x.d]), label, true);
    }
  });
  document.addEventListener('change', e => {
    if (!A.UI.modal || !A.UI.modal.title || A.UI.modal.title !== 'Plot absence') return;
    const t = e.target;
    if (t.id === 'ap-team' && t.value) { readPlot(); A.S.agents.filter(a => a.team === t.value).forEach(a => { if (!A.UI.ap.ids.includes(a.id)) A.UI.ap.ids.push(a.id); }); refreshPlot(); return; }
    if (['ap-type', 'ap-from', 'ap-to', 'ap-skip', 'ap-tf', 'ap-tt'].includes(t.id)) { readPlot(); if (A.UI.ap.to < A.UI.ap.from) A.UI.ap.to = A.UI.ap.from; refreshPlot(); }
  });
})();
