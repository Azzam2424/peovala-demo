/* Views: Overview, Forecast, Capacity plan, Intraday, Adherence */
(function () {
  const A = window.App, E = A.E, esc = A.esc, fmtN = A.fmtN, pct = A.pct, $ = A.$;
  const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
  const dayX = i => E.fmtDate(A.S.days[i], false);

  /* ---------- Overview ---------- */
  A.VIEWS.overview = {
    html() {
      const S = A.S, T = S.rep.total, qi = Math.min(A.UI.ov.queue, S.queues.length - 1), D = S.days.length;
      const diff = T.netH - T.reqH, nInts = S.queues.length * D * A.nI();
      const rows = S.rep.queues.map((q, i) => {
        const ag = S.agents.filter(a => a.queue === q.id).length, d = q.week.netH - q.week.reqH;
        return `<tr class="click" data-set="ov.queue" data-val="${i}" data-type="num"><td><b>${esc(q.name)}</b> <span class="muted mono">${esc(q.id)}</span></td><td class="r num">${fmtN(ag)}</td><td class="r num">${fmtN(q.week.calls)}</td><td class="r num">${fmtN(q.week.reqH)}</td><td class="r num">${fmtN(q.week.netH)}</td><td class="r num">${d >= 0 ? '+' : ''}${fmtN(d)}</td><td class="r num">${pct(q.week.sl)}</td><td class="r num">${pct(q.week.occ, 0)}</td><td>${A.slPill(q.week.sl)}</td></tr>`;
      }).join('');
      const pending = S.requests.filter(r => r.status === 'pending').length;
      const badDays = []; S.rep.queues.forEach((q, i) => q.days.forEach((d, k) => { if (d.sl < S.settings.slTarget && d.calls > 0) badDays.push({ q: q.name, k, sl: d.sl }); }));
      badDays.sort((a, b) => a.sl - b.sl);
      const specials = S.specials.filter(s => S.days.includes(s.date));
      const un = A.unbuiltDays().length;
      if (A._issuesAt !== S.changes + ':' + S.days.length + ':' + (S.builtAt || 0)) { A._issues = S.agents.reduce((t, a) => t + E.checkAgent(a, S.settings, S.days).length, 0); A._issuesAt = S.changes + ':' + S.days.length + ':' + (S.builtAt || 0); }
      const att = [];
      if (un) att.push(`<li><span class="pill warn">Not built</span> ${un} days have no schedule <button class="btn sm" data-act="build-open">Build</button></li>`);
      if (pending) att.push(`<li><span class="pill warn">${pending}</span> requests waiting for a decision <button class="btn sm" data-nav="requests">Review</button></li>`);
      if (A._issues) att.push(`<li><span class="pill crit">${A._issues}</span> labour-rule issues in the schedule <button class="btn sm" data-act="go-report" data-key="rules">Open report</button></li>`);
      badDays.slice(0, 5).forEach(b => att.push(`<li><span class="pill crit">${pct(b.sl, 0)}</span> ${esc(b.q)} on ${E.fmtDate(S.days[b.k])} is below target</li>`));
      if (S.changes) att.push(`<li><span class="pill neutral">${S.changes}</span> changes not yet published <button class="btn sm" data-act="publish-open">Publish</button></li>`);
      specials.forEach(sp => att.push(`<li><span class="pill neutral">${sp.factor === 0 ? 'Closed' : (sp.factor > 1 ? '+' : '') + fmtN((sp.factor - 1) * 100) + '%'}</span> ${E.fmtDate(sp.date)}: ${esc(sp.name)}${sp.queue ? ' (' + sp.queue + ')' : ''}</li>`));
      return A.staleBanner() + A.head(`${E.fmtDateY(S.settings.periodStart)} – ${E.fmtDateY(S.settings.periodEnd)}`, 'Staffing overview',
        `Erlang C requirement against the current schedule in 15-minute intervals, ${E.fmt(S.settings.openH * 60)}–${E.fmt(S.settings.closeH * 60)}. Target ${pct(S.settings.slTarget, 0)} of calls answered in ${S.settings.slSeconds} s.`,
        `<button class="btn" data-act="export-all">Export workbook</button><button class="btn primary" data-act="build-open">Build schedule</button>`) +
        `<div class="kpis">
          <div class="kpi"><span class="l">Agents with shifts</span><span class="v">${fmtN(S.agents.filter(a => S.days.some(d => a.shifts[d])).length)}</span><span class="d">of ${fmtN(S.agents.length)} on the roster</span></div>
          <div class="kpi"><span class="l">Forecast calls</span><span class="v">${fmtN(T.calls)}</span><span class="d">${D} days, ${S.queues.length} queues</span></div>
          <div class="kpi"><span class="l">Projected service level</span><span class="v">${pct(T.sl)}</span><span class="d">${A.slPill(T.sl)}</span></div>
          <div class="kpi"><span class="l">On-phone vs required</span><span class="v">${diff >= 0 ? '+' : ''}${fmtN(diff)} h</span><span class="d">${fmtN(T.netH)} / ${fmtN(T.reqH)} h</span></div>
          <div class="kpi"><span class="l">Understaffed intervals</span><span class="v">${fmtN(T.underInt)}</span><span class="d">${pct(T.underInt / nInts)} of ${fmtN(nInts)}</span></div>
        </div>
        <div class="grid g-side">
          <div class="grid" style="align-self:start"><div class="tbl-wrap"><table><thead><tr><th>Queue</th><th class="r">Agents</th><th class="r">Calls</th><th class="r">Req. h</th><th class="r">Sched. h</th><th class="r">Gap h</th><th class="r">SL</th><th class="r">Occ.</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
          <section class="panel"><h2>Daily service level by queue</h2><p class="sub">Projected from the current schedule against the forecast.</p><div class="chart" id="ov-sl"></div></section></div>
          <section class="panel" style="align-self:start"><h2>Needs attention</h2><p class="sub">Updated with every change</p><ul class="attn">${att.join('') || '<li class="muted">Nothing needs attention.</li>'}</ul></section>
        </div>
        <section class="panel mt">
          <div class="split"><div><h2>Coverage gap by interval</h2><p class="sub">Scheduled on-phone agents minus required: ${esc(S.queues[qi].name)}. Hover a cell for detail; click to open that day.</p></div><div class="ramp"><span>Short</span><span class="bar"></span><span>Over</span></div></div>
          <div class="toolbar">${A.queueSeg('ov.queue', qi)}</div><div id="heat"></div>
        </section>`;
    },
    after() {
      const S = A.S, D = S.days.length;
      A.drawChart('ov-sl', { n: D, height: 210, label: 'Daily service level', xl: dayX, every: Math.max(1, Math.ceil(D / 10)), tt: i => E.fmtDate(S.days[i]), ymin: 0.5, ymax: 1, target: S.settings.slTarget, yf: v => fmtN(v * 100) + '%',
        series: S.rep.queues.map((q, i) => ({ name: q.name, type: 'line', dots: D <= 21, values: q.days.map(d => d.calls ? d.sl : null), color: SERIES[i % SERIES.length], fmt: v => pct(v) })) });
      const qi = Math.min(A.UI.ov.queue, S.queues.length - 1), n = A.nI(), R = S.R[qi].req, N = S.net[qi];
      let mx = 1; for (let k = 0; k < D; k++) for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(N[k][i] - R[k][i]));
      let h = `<div class="heat" style="grid-template-columns:62px repeat(${n},minmax(0,1fr)); --ch:${D > 21 ? 12 : D > 14 ? 16 : 20}px">`;
      for (let k = 0; k < D; k++) {
        h += `<span class="lab">${E.fmtDate(S.days[k], true).replace(/ \w+$/, '')}</span>`;
        for (let i = 0; i < n; i++) {
          const g = N[k][i] - R[k][i], f = Math.min(1, Math.abs(g) / mx), p = Math.round(Math.sqrt(f) * 100);
          h += `<span class="c" data-k="${k}" data-i="${i}" data-q="${qi}" style="background:color-mix(in oklab, var(${g < 0 ? '--div-neg' : '--div-pos'}) ${p}%, var(--div-mid))"></span>`;
        }
      }
      h += `</div><div class="heat-x" style="margin-left:66px">${Array.from({ length: Math.floor(n / 8) + 1 }, (_, k) => `<span>${A.tLabel(k * 8)}</span>`).join('')}</div>`;
      $('#heat').innerHTML = h;
    }
  };
  A.heatTip = function (c) {
    const S = A.S, k = +c.dataset.k, i = +c.dataset.i, qi = +c.dataset.q, req = S.R[qi].req[k][i], net = S.net[qi][k][i];
    return `<div class="t">${E.fmtDate(S.days[k])} ${A.tLabel(i)}–${A.tLabel(i + 1)}</div><div class="row"><span>Required</span><b>${fmtN(req, 1)}</b></div><div class="row"><span>Scheduled on phone</span><b>${fmtN(net)}</b></div><div class="row"><span>Gap</span><b>${net - req >= 0 ? '+' : ''}${fmtN(net - req, 1)}</b></div><div class="row"><span>Projected SL</span><b>${pct(S.rep.queues[qi].days[k].slSeries[i], 0)}</b></div>`;
  };
  document.addEventListener('click', e => {
    const c = e.target.closest && e.target.closest('.heat .c'); if (!c) return;
    A.UI.sc.date = A.S.days[+c.dataset.k]; A.UI.sc.queue = +c.dataset.q; A.UI.sc.mode = 'day'; A.UI.view = 'schedule'; A.render(); window.scrollTo(0, 0);
  });
  A.ACTS['go-report'] = t => { if (t && t.dataset.key) A.UI.rep.key = t.dataset.key; A.UI.view = 'reports'; A.render(); window.scrollTo(0, 0); };

  /* ---------- Forecast ---------- */
  A.VIEWS.forecast = {
    html() {
      const S = A.S, U = A.UI.fc, qi = Math.min(U.queue, S.queues.length - 1), q = S.queues[qi], k = A.dayK(U.date), R = S.R[qi];
      const dayCalls = R.calls[k].reduce((a, b) => a + b, 0), share = q.dayShare.reduce((a, b) => a + b, 0) || 1, hasOv = q.override && Object.keys(q.override).length || q.overrideDow;
      const sp = A.special(U.date, q.id);
      const fit = E.fitForecast(S.history[q.id] || [], U.method, U.weeks);
      const mq = fit.mape == null ? '' : fit.mape < 0.07 ? 'good' : fit.mape < 0.12 ? 'warn' : 'crit';
      return A.staleBanner() + A.head('Demand planning', 'Forecast & requirement',
        'Volume per 15-minute interval drives the Erlang C requirement for every day in the planning period. Build the forecast from history, adjust the model, test what-if scenarios, or import an interval forecast.',
        `<button class="btn" data-act="import-forecast">Import forecast</button><button class="btn" data-act="export-forecast">Export to Excel</button><button class="btn" data-act="add-queue">Add queue</button>`) +
        `<div class="toolbar">${A.queueSeg('fc.queue', qi)}</div>
        <div class="grid g-side">
          <div class="grid">
            <section class="panel">
              <div class="split"><div><h2>${esc(q.name)}: ${E.fmtDate(U.date)}</h2><p class="sub">${fmtN(dayCalls)} calls · AHT ${fmtN(q.aht)} s · peak ${fmtN(Math.max(...R.N[k]))} agents on phone${sp ? ` · <b>${esc(sp.name)}</b> (×${sp.factor})` : ''}${hasOv ? ' · imported forecast' : ''}</p></div>${A.dateStepper('fc.date', U.date)}</div>
              <div class="chart" id="fc-calls"></div><div class="chart mt" id="fc-req"></div>
            </section>
            <section class="panel">
              <div class="split"><div><h2>Forecast from history</h2><p class="sub">Last 16 weeks of daily volume. Accuracy is a backtest on the two most recent weeks.</p></div>
                <div class="actions"><select data-bind="fc.method" aria-label="Method"><option value="avg" ${U.method === 'avg' ? 'selected' : ''}>Weekday average</option><option value="wma" ${U.method === 'wma' ? 'selected' : ''}>Weighted moving average</option><option value="trend" ${U.method === 'trend' ? 'selected' : ''}>Linear trend</option></select>
                <select data-bind="fc.weeks" data-type="num" aria-label="Weeks of history">${[4, 6, 8, 12].map(w => `<option value="${w}" ${U.weeks === w ? 'selected' : ''}>Last ${w} weeks</option>`).join('')}</select></div></div>
              <div class="chart" id="fc-hist"></div>
              <div class="split mt"><div class="kv inline"><span>Projected weekly calls</span><b>${fmtN(fit.weekly)}</b><span>Current model</span><b>${fmtN(q.weekly)}</b><span>Accuracy (MAPE)</span><b>${fit.mape == null ? '–' : `<span class="pill ${mq}">${pct(fit.mape)}</span>`}</b></div>
                <div class="actions"><button class="btn" data-act="import-history">Import history</button><button class="btn primary" data-act="apply-fit">Use this forecast</button></div></div>
            </section>
            <section class="panel">
              <h2>Volume model</h2><p class="sub">Weekly volume spread by weekday and intraday pattern, adjusted by special days.</p>
              <div class="form">
                <div class="field"><label for="q-weekly">Weekly calls</label><input id="q-weekly" type="number" min="0" step="100" value="${Math.round(q.weekly)}"></div>
                <div class="field"><label for="q-aht">Average handle time (s)</label><input id="q-aht" type="number" min="10" step="5" value="${q.aht}"></div>
                <div class="field"><label for="q-shape">Intraday pattern</label><select id="q-shape">${Object.keys(E.SHAPES).map(s => `<option ${q.shape === s ? 'selected' : ''} value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div>
                <div class="field"><label for="q-growth">Annual volume growth (%)</label><input id="q-growth" type="number" step="0.5" value="${fmtN((q.growth || 0) * 100, 1)}"></div>
              </div>
              <div class="form-sec"><h3>Weekday distribution (%)</h3><div class="form" style="grid-template-columns:repeat(auto-fill,minmax(78px,1fr))">${E.DAYS.map((dn, i) => `<div class="field"><label for="q-ds${i}">${dn}</label><input id="q-ds${i}" type="number" step="0.5" min="0" value="${(q.dayShare[i] / share * 100).toFixed(1)}"></div>`).join('')}</div></div>
              <div class="actions mt"><button class="btn primary" data-act="apply-queue">Apply changes</button>${hasOv ? '<button class="btn" data-act="clear-override">Remove imported forecast</button>' : ''}${S.agents.some(a => a.queue === q.id) ? '' : '<button class="btn danger" data-act="remove-queue">Remove queue</button>'}</div>
            </section>
          </div>
          <div class="grid" style="align-self:start">
            <section class="panel">
              <h2>What-if scenario</h2><p class="sub">Test the current schedule against a different volume or handle time for ${esc(q.name)}. Nothing is saved.</p>
              <div class="field"><label for="wi-vol">Volume change <b class="num" id="wi-vol-v">${U.vol >= 0 ? '+' : ''}${U.vol}%</b></label><input class="range" id="wi-vol" type="range" min="-30" max="50" step="1" value="${U.vol}"></div>
              <div class="field mt"><label for="wi-aht">AHT change <b class="num" id="wi-aht-v">${U.aht >= 0 ? '+' : ''}${U.aht}%</b></label><input class="range" id="wi-aht" type="range" min="-20" max="40" step="1" value="${U.aht}"></div>
              <div id="wi-out" class="calc-out"></div>
            </section>
            <section class="panel">
              <h2>Erlang C calculator</h2><p class="sub">One interval, using the service target from Settings.</p>
              <div class="form" style="grid-template-columns:1fr 1fr">
                <div class="field"><label for="ec-calls">Calls / 15 min</label><input id="ec-calls" type="number" min="0" value="${Math.round(Math.max(...R.calls[k]))}"></div>
                <div class="field"><label for="ec-aht">AHT (s)</label><input id="ec-aht" type="number" min="1" value="${q.aht}"></div>
                <div class="field"><label for="ec-sl">SL target (%)</label><input id="ec-sl" type="number" min="1" max="99" value="${Math.round(S.settings.slTarget * 100)}"></div>
                <div class="field"><label for="ec-t">Answer within (s)</label><input id="ec-t" type="number" min="1" value="${S.settings.slSeconds}"></div>
              </div><div id="ec-out"></div>
            </section>
            <section class="panel"><h2>Special days</h2><p class="sub">Holidays and events that scale volume. Edit them in Settings.</p>
              <ul class="attn">${S.specials.filter(s => !s.queue || s.queue === q.id).map(s => `<li><span class="pill neutral">${s.factor === 0 ? 'Closed' : '×' + s.factor}</span> ${E.fmtDate(s.date)} ${s.date.slice(0, 4)}: ${esc(s.name)}</li>`).join('') || '<li class="muted">None</li>'}</ul></section>
          </div>
        </div>`;
    },
    after() {
      const S = A.S, U = A.UI.fc, qi = Math.min(U.queue, S.queues.length - 1), R = S.R[qi], k = A.dayK(U.date), q = S.queues[qi];
      A.drawChart('fc-calls', { n: A.nI(), height: 170, label: 'Forecast calls', legend: true, series: [{ name: 'Forecast calls per interval', type: 'bar', values: R.calls[k], color: 'var(--s1)', dp: 0 }] });
      A.drawChart('fc-req', { n: A.nI(), height: 170, label: 'Agents required', series: [{ name: 'Agents on phone (Erlang C)', type: 'step', values: R.N[k], color: 'var(--s2)', dp: 0 }, { name: `To schedule incl. ${pct(S.settings.shrinkage, 0)} shrinkage`, type: 'step', values: R.req[k], color: 'var(--s3)', dp: 1 }] });
      const hist = (S.history[q.id] || []).slice(-56), fit = E.fitForecast(S.history[q.id] || [], U.method, U.weeks);
      const proj = []; for (let j = 0; j < 14; j++) { const d = E.addDays(S.settings.periodStart, j); proj.push({ date: d, v: fit.weekly * fit.dayShare[E.dow(d)] * E.dayFactor(q, d, S.specials) }); }
      const all = hist.map(h => h.date).concat(proj.map(p => p.date));
      A.drawChart('fc-hist', { n: all.length, height: 190, label: 'History and projection', xl: i => E.fmtDate(all[i], false), every: 14, tt: i => E.fmtDate(all[i]),
        series: [{ name: 'Actual daily calls', type: 'line', values: all.map((_, i) => i < hist.length ? hist[i].calls : null), color: 'var(--s1)', dp: 0 },
          { name: 'Projection', type: 'line', dash: true, values: all.map((_, i) => i >= hist.length - 1 ? (i < hist.length ? hist[i].calls : proj[i - hist.length].v) : null), color: 'var(--s2)', dp: 0 }] });
      calc(); whatIf();
    }
  };
  function calc() {
    const o = $('#ec-out'); if (!o) return;
    const S = A.S, calls = +$('#ec-calls').value, aht = +$('#ec-aht').value, sl = (+$('#ec-sl').value) / 100, T = +$('#ec-t').value;
    const N = E.agentsNeeded(calls, aht, { slTarget: sl, slSeconds: T, maxOcc: S.settings.maxOcc }), r = E.erlang(calls, aht, N, T);
    o.innerHTML = `<div class="calc-out"><div><b>${fmtN(N)}</b><span>agents on phone</span></div><div><b>${fmtN(N / (1 - S.settings.shrinkage), 1)}</b><span>to schedule</span></div><div><b>${pct(r.sl)}</b><span>service level</span></div><div><b>${isFinite(r.asa) ? fmtN(r.asa, 1) + ' s' : '–'}</b><span>avg. speed of answer</span></div><div><b>${pct(r.occ)}</b><span>occupancy</span></div><div><b>${fmtN(calls * aht / 900, 1)}</b><span>Erlangs</span></div></div>`;
  }
  function whatIf() {
    const o = $('#wi-out'); if (!o) return;
    const S = A.S, U = A.UI.fc, qi = Math.min(U.queue, S.queues.length - 1), q = S.queues[qi];
    const R2 = E.computeRequirements([q], S.settings, S.days, S.specials, { vol: 1 + U.vol / 100, aht: 1 + U.aht / 100 })[0];
    let calls = 0, slw = 0, reqH = 0; R2.calls.forEach((c, k) => { const st = E.dayStats(c, R2.aht, R2.req[k], S.net[qi][k], S.settings); calls += st.calls; slw += st.sl * st.calls; reqH += st.reqH; });
    const base = S.rep.queues[qi].week, sl = calls ? slw / calls : 1, dH = reqH - base.reqH, fte = dH / (S.days.length / 7) / 37.5;
    o.innerHTML = `<div><b>${pct(sl)}</b><span>projected SL (now ${pct(base.sl)})</span></div><div><b>${fmtN(calls)}</b><span>calls in period</span></div><div><b>${dH >= 0 ? '+' : ''}${fmtN(dH)} h</b><span>required hours</span></div><div><b>${fte >= 0 ? '+' : ''}${fmtN(fte, 1)}</b><span>FTE needed (37.5 h)</span></div>`;
  }
  A.forecastInput = function (e) {
    const id = e.target.id;
    if (id && id.startsWith('ec-')) { calc(); return true; }
    if (id === 'wi-vol' || id === 'wi-aht') { A.UI.fc[id === 'wi-vol' ? 'vol' : 'aht'] = +e.target.value; $('#' + id + '-v').textContent = (e.target.value >= 0 ? '+' : '') + e.target.value + '%'; clearTimeout(A._wt); A._wt = setTimeout(whatIf, 60); return true; }
    return false;
  };
  function reqChanged(msg) { A.S.demo = false; const S = A.S; S.R = E.computeRequirements(S.queues, S.settings, S.days, S.specials); A.refresh(); A.render(); A.toast(msg); }
  A.reqChanged = reqChanged;
  Object.assign(A.ACTS, {
    'apply-queue': () => {
      const q = A.S.queues[A.UI.fc.queue];
      q.aht = Math.max(10, +$('#q-aht').value || q.aht); q.weekly = Math.max(0, +$('#q-weekly').value || 0); q.shape = $('#q-shape').value; q.growth = (+$('#q-growth').value || 0) / 100;
      q.dayShare = E.DAYS.map((_, i) => Math.max(0, +$('#q-ds' + i).value || 0) / 100); if (q.dayShare.every(v => v === 0)) q.dayShare = [1, 1, 1, 1, 1, 1, 1];
      A.log('Forecast model changed', q.name, true); reqChanged('Forecast updated. Requirement recalculated; build the schedule to follow it.');
    },
    'apply-fit': () => {
      const S = A.S, U = A.UI.fc, q = S.queues[U.queue], f = E.fitForecast(S.history[q.id] || [], U.method, U.weeks);
      if (!f.weekly) { A.toast('Not enough history for this queue'); return; }
      q.weekly = f.weekly; q.dayShare = f.dayShare; delete q.override; delete q.overrideDow;
      A.log('Forecast from history applied', `${q.name}: ${fmtN(f.weekly)} calls/week (${U.method}, ${U.weeks} weeks)`, true); reqChanged(`${q.name} now uses the history forecast: ${fmtN(f.weekly)} calls a week`);
    },
    'clear-override': () => { const q = A.S.queues[A.UI.fc.queue]; delete q.override; delete q.overrideDow; A.log('Imported forecast removed', q.name, true); reqChanged('Imported forecast removed'); },
    'remove-queue': () => { const S = A.S, q = S.queues[A.UI.fc.queue]; S.queues.splice(A.UI.fc.queue, 1); delete S.history[q.id]; ['fc', 'ov', 'id'].forEach(k => (A.UI[k].queue = 0)); A.UI.sc.queue = 0; A.log('Queue removed', q.name, true); reqChanged(q.name + ' removed'); },
    'add-queue': () => A.openModal('Add queue', `<div class="form"><div class="field"><label for="nq-name">Name</label><input id="nq-name" type="text" placeholder="e.g. Retention"></div><div class="field"><label for="nq-id">Queue ID</label><input id="nq-id" type="text" maxlength="6" placeholder="RET"></div><div class="field"><label for="nq-aht">AHT (s)</label><input id="nq-aht" type="number" value="360"></div><div class="field"><label for="nq-vol">Weekly calls</label><input id="nq-vol" type="number" value="20000"></div><div class="field"><label for="nq-shape">Intraday pattern</label><select id="nq-shape">${Object.keys(E.SHAPES).map(s => `<option value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div></div><div id="nq-err"></div>`, `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="create-queue">Add queue</button>`),
    'create-queue': () => {
      const S = A.S, name = $('#nq-name').value.trim(), id = ($('#nq-id').value.trim() || name.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!name || !id) { $('#nq-err').innerHTML = '<p class="errlist">Enter a queue name.</p>'; return; }
      if (S.queues.some(q => q.id === id)) { $('#nq-err').innerHTML = `<p class="errlist">Queue ID ${esc(id)} already exists. Choose another.</p>`; return; }
      const q = { id, name, aht: +$('#nq-aht').value || 300, weekly: +$('#nq-vol').value || 0, shape: $('#nq-shape').value, dayShare: [0.17, 0.16, 0.155, 0.15, 0.15, 0.12, 0.095], mix: 0.1, growth: 0.03 };
      S.queues.push(q); S.history[id] = E.genHistory(q, S.settings, S.settings.periodStart, 16, 300 + S.queues.length, S.specials);
      A.UI.fc.queue = S.queues.length - 1; A.closeOverlay(); A.log('Queue added', name, true); reqChanged(`${name} added. Assign agents to ${id} in Employees.`);
    },
    'export-forecast': () => A.exportXLSX(`Peovala_forecast_${A.fileStamp()}.xlsx`, [A.REPORTS.interval.sheet(), A.REPORTS.daily.sheet()]),
    'import-forecast': () => A.importModal('forecast'),
    'import-history': () => A.importModal('history')
  });

  /* ---------- Capacity plan ---------- */
  function capacityModel() {
    const S = A.S, c = S.capacity, U = A.UI.cap, weeksInPeriod = S.days.length / 7, qs = U.queue >= 0 ? [U.queue] : S.queues.map((_, i) => i);
    const leave = (c.leave ?? 5) / 100, attr = c.attrition / 100 / 4.345;
    const rows = [];
    const per = qs.map(qi => {
      const q = S.queues[qi], ag = S.agents.filter(a => a.queue === q.id);
      const sp = E.shiftSpec({ hours: 40 }, S.settings), onPhone = sp.onPhoneInt / 4 * S.settings.daysPerWeek;
      return { q, reqH: S.rep.queues[qi].week.reqH / weeksInPeriod, fte: ag.reduce((t, a) => t + a.hours, 0) / 40, onPhone, calls: S.rep.queues[qi].week.calls / weeksInPeriod };
    });
    const pools = per.map(p => ({ fte: p.fte }));
    for (let w = 0; w < c.horizon; w++) {
      let req = 0, avail = 0, train = 0, vol = 0;
      per.forEach((p, j) => {
        const f = Math.pow(1 + (p.q.growth || 0), w / 52);
        req += p.reqH * f / p.onPhone / (1 - leave); vol += p.calls * f;
        pools[j].fte *= (1 - attr);
        let add = 0;
        c.classes.filter(cl => cl.queue === p.q.id).forEach(cl => {
          const s0 = cl.week, s1 = s0 + cl.train, s2 = s1 + cl.nest;
          if (w === s2) pools[j].fte += cl.heads;
          else if (w >= s1 && w < s2) add += cl.heads * 0.5;
          else if (w >= s0 && w < s1) train += cl.heads;
        });
        avail += pools[j].fte + add;
      });
      rows.push({ w, date: E.addDays(E.weekStart(S.settings.periodStart), w * 7), vol, req, avail, gap: avail - req, train });
    }
    return rows;
  }
  A.capacityModel = capacityModel;
  A.VIEWS.capacity = {
    html() {
      const S = A.S, c = S.capacity, U = A.UI.cap, rows = capacityModel();
      const worst = rows.reduce((m, r) => r.gap < m.gap ? r : m, rows[0]);
      const end = rows[rows.length - 1];
      const firstShort = rows.find(r => r.gap < -0.5);
      const hireNeed = firstShort ? Math.ceil(-worst.gap / (1 - c.attrition / 100 * 2)) : 0;
      return A.head('Long-term planning', 'Capacity plan',
        `Weekly FTE requirement for the next ${c.horizon} weeks from the current forecast, volume growth and planned leave, against headcount after attrition and new hire classes.`,
        `<button class="btn" data-act="export-capacity">Export to Excel</button>`) +
        `<div class="toolbar">${A.queueSeg('cap.queue', U.queue, true)}</div>
        <div class="kpis k4"><div class="kpi"><span class="l">FTE today</span><span class="v">${fmtN(rows[0].avail, 1)}</span><span class="d">required ${fmtN(rows[0].req, 1)}</span></div>
          <div class="kpi"><span class="l">FTE in week ${c.horizon}</span><span class="v">${fmtN(end.avail, 1)}</span><span class="d">required ${fmtN(end.req, 1)}</span></div>
          <div class="kpi"><span class="l">Largest gap</span><span class="v">${worst.gap >= 0 ? '+' : ''}${fmtN(worst.gap, 1)}</span><span class="d">week of ${E.fmtDate(worst.date, false)}</span></div>
          <div class="kpi"><span class="l">First week short</span><span class="v">${firstShort ? E.fmtDate(firstShort.date, false) : 'None'}</span><span class="d">${firstShort ? `hire about ${hireNeed} FTE, ${c.classes[0] ? c.classes[0].train : 4}+ weeks earlier` : 'covered for the whole horizon'}</span></div></div>
        <div class="grid g-side">
          <section class="panel"><h2>Required vs available FTE</h2><p class="sub">Weekly, 40-hour equivalents. Hires count at 50% while nesting and fully after.</p><div class="chart" id="cap-chart"></div></section>
          <section class="panel" style="align-self:start"><h2>Assumptions</h2>
            <div class="form" style="grid-template-columns:1fr 1fr">
              <div class="field"><label for="cp-h">Horizon</label><select id="cp-h">${[13, 26, 39, 52].map(h => `<option value="${h}" ${c.horizon === h ? 'selected' : ''}>${h} weeks</option>`).join('')}</select></div>
              <div class="field"><label for="cp-attr">Attrition / month (%)</label><input id="cp-attr" type="number" step="0.1" min="0" value="${c.attrition}"></div>
              <div class="field"><label for="cp-leave">Planned leave (%)</label><input id="cp-leave" type="number" step="0.5" min="0" value="${c.leave ?? 5}"></div>
            </div>
            <p class="muted" style="font-size:12px">Volume growth per queue is set in Forecast. Shrinkage and service targets come from Settings.</p>
            <div class="form-sec"><h3>Hire classes</h3>
              <div style="overflow-x:auto"><table class="mini cls"><thead><tr><th>Start wk</th><th>Queue</th><th class="r">Heads</th><th class="r">Train wk</th><th class="r">Nest wk</th><th></th></tr></thead><tbody>
              ${c.classes.map((cl, i) => `<tr><td><input class="cl" data-i="${i}" data-k="week" type="number" min="0" value="${cl.week}" style="width:50px"></td><td><select class="cl" data-i="${i}" data-k="queue">${S.queues.map(q => `<option ${cl.queue === q.id ? 'selected' : ''}>${q.id}</option>`).join('')}</select></td><td class="r"><input class="cl" data-i="${i}" data-k="heads" type="number" min="1" value="${cl.heads}" style="width:50px"></td><td class="r"><input class="cl" data-i="${i}" data-k="train" type="number" min="0" value="${cl.train}" style="width:50px"></td><td class="r"><input class="cl" data-i="${i}" data-k="nest" type="number" min="0" value="${cl.nest}" style="width:50px"></td><td><button class="x" data-act="cl-del" data-i="${i}" aria-label="Remove class">×</button></td></tr>`).join('')}
              </tbody></table></div>
              <div class="actions mt"><button class="btn sm" data-act="cl-add">Add hire class</button><button class="btn sm primary" data-act="cap-apply">Update plan</button></div></div>
          </section>
        </div>
        <div class="tbl-wrap mt"><table><thead><tr><th>Week</th><th>Starting</th><th class="r">Calls</th><th class="r">Required FTE</th><th class="r">Available FTE</th><th class="r">Gap</th><th class="r">In training</th><th>Status</th></tr></thead><tbody>
          ${rows.map(r => `<tr><td class="num">${r.w + 1}</td><td>${E.fmtDateY(r.date)}</td><td class="r num">${fmtN(r.vol)}</td><td class="r num">${fmtN(r.req, 1)}</td><td class="r num">${fmtN(r.avail, 1)}</td><td class="r num">${r.gap >= 0 ? '+' : ''}${fmtN(r.gap, 1)}</td><td class="r num">${r.train ? fmtN(r.train) : '–'}</td><td><span class="pill ${r.gap >= 0 ? 'good' : r.gap > -r.req * 0.03 ? 'warn' : 'crit'}">${r.gap >= 0 ? 'Covered' : r.gap > -r.req * 0.03 ? 'Tight' : 'Short'}</span></td></tr>`).join('')}
        </tbody></table></div>`;
    },
    after() {
      const rows = capacityModel();
      A.drawChart('cap-chart', { n: rows.length, height: 240, label: 'Capacity', xl: i => 'W' + (i + 1), every: Math.max(1, Math.ceil(rows.length / 13)), tt: i => 'Week ' + (i + 1) + ' · ' + E.fmtDate(rows[i].date, false), ymin: Math.floor(Math.min(...rows.map(r => Math.min(r.req, r.avail))) * 0.9 / 10) * 10,
        series: [{ name: 'Required FTE', type: 'line', values: rows.map(r => r.req), color: 'var(--s2)', dp: 1 }, { name: 'Available FTE', type: 'line', values: rows.map(r => r.avail), color: 'var(--s1)', dp: 1 }] });
    }
  };
  Object.assign(A.ACTS, {
    'cap-apply': () => {
      const c = A.S.capacity; c.horizon = +$('#cp-h').value; c.attrition = Math.max(0, +$('#cp-attr').value || 0); c.leave = Math.max(0, +$('#cp-leave').value || 0);
      document.querySelectorAll('.cl').forEach(el => { const cl = c.classes[+el.dataset.i]; cl[el.dataset.k] = el.dataset.k === 'queue' ? el.value : Math.max(0, +el.value || 0); });
      A.save(); A.render(); A.toast('Capacity plan updated');
    },
    'cl-add': () => { A.ACTS['cap-apply'](); A.S.capacity.classes.push({ week: 6, queue: A.S.queues[0].id, heads: 20, train: 4, nest: 2 }); A.render(); },
    'cl-del': t => { A.S.capacity.classes.splice(+t.dataset.i, 1); A.save(); A.render(); },
    'export-capacity': () => A.exportXLSX(`Peovala_capacity_plan.xlsx`, [A.REPORTS.capacity.sheet()])
  });

  /* ---------- Intraday ---------- */
  function intraCalc() {
    const S = A.S, U = A.UI.id, qi = Math.min(U.queue, S.queues.length - 1), q = S.queues[qi], k = A.dayK(U.date), n = A.nI();
    if (U.now == null) U.now = Math.min(n - 4, Math.max(4, (12 - S.settings.openH) * 4));
    const now = Math.min(U.now, n - 2), Rq = S.R[qi];
    const actual = E.simulateActuals(q, Rq, k, now, U.seed * 31 + qi * 7 + k);
    const rf = E.reforecast(q, Rq, k, actual, now, S.settings);
    const net = Array.from(S.net[qi][k]), keep = 1 - S.settings.shrinkage, sl = [];
    let cw = 0, slw = 0;
    for (let i = 0; i < n; i++) { sl[i] = E.slFor(rf.calls[i], i < now ? actual[i].aht : rf.aht, net[i] * keep, S.settings.slSeconds); if (i >= now) { cw += rf.calls[i]; slw += rf.calls[i] * sl[i]; } }
    const cls = j => { const g = net[j] - rf.req[j]; return g < -Math.max(1, rf.req[j] * 0.03) ? 'short' : g > Math.max(3, rf.req[j] * 0.06) ? 'over' : null; };
    const recos = []; let i = now;
    while (i < n) { const type = cls(i); if (!type) { i++; continue; } let j = i, sum = 0; while (j < n && cls(j) === type) { sum += net[j] - rf.req[j]; j++; } if (j - i >= 2) recos.push({ type, from: i, to: j, avg: sum / (j - i) }); i = j; }
    // cross-skill donors
    recos.forEach(r => {
      if (r.type !== 'short') return;
      r.donors = [];
      S.queues.forEach((oq, oj) => {
        if (oj === qi) return;
        let surplus = Infinity; for (let x = r.from; x < r.to; x++) surplus = Math.min(surplus, S.net[oj][k][x] - S.R[oj].req[k][x]);
        if (surplus < 1) return;
        const skilled = S.agents.filter(a => a.queue === oq.id && (a.skills || []).includes(q.id) && a.shifts[S.days[k]] && E.stateAt(a.shifts[S.days[k]], r.from) === 'PH').length;
        if (skilled) r.donors.push({ name: oq.name, n: Math.min(skilled, Math.floor(surplus)) });
      });
    });
    return { qi, q, k, n, now, Rq, actual, rf, net, sl, restSL: cw ? slw / cw : 1, recos };
  }
  A.VIEWS.intraday = {
    html() {
      const c = intraCalc(), { q, now, rf } = c, U = A.UI.id;
      const aCalls = c.actual.reduce((t, x) => t + x.calls, 0), fCalls = c.Rq.calls[c.k].slice(0, now).reduce((a, b) => a + b, 0), short = c.recos.filter(r => r.type === 'short');
      return A.head(`${E.fmtDate(U.date)} · ${esc(q.name)}`, 'Intraday management',
        'Compare arriving volume with the forecast, re-project the rest of the day, and act on gaps: move breaks, offer overtime or voluntary time off, or borrow cross-skilled agents. Actuals are simulated in this demo; production connects to your ACD.',
        `<button class="btn" data-act="new-actuals">Simulate new actuals</button>`) +
        `<div class="toolbar">${A.queueSeg('id.queue', c.qi)}${A.dateStepper('id.date', U.date)}</div>
        <section class="panel" style="margin-bottom:14px"><div class="split"><label class="flabel" for="id-now">Current time <span class="num" style="color:var(--ink)">${A.tLabel(now)}</span></label><span class="muted" style="font-size:12px">Drag to replay the day</span></div><input class="range" id="id-now" type="range" min="2" max="${c.n - 2}" value="${now}"></section>
        <div class="kpis">
          <div class="kpi"><span class="l">Volume vs forecast so far</span><span class="v">${rf.volRatio >= 1 ? '+' : ''}${pct(rf.volRatio - 1)}</span><span class="d">${fmtN(aCalls)} actual / ${fmtN(fCalls)} forecast</span></div>
          <div class="kpi"><span class="l">Actual AHT</span><span class="v">${fmtN(rf.aht)} s</span><span class="d">plan ${fmtN(c.Rq.aht)} s</span></div>
          <div class="kpi"><span class="l">Calls still to come</span><span class="v">${fmtN(rf.calls.slice(now).reduce((a, b) => a + b, 0))}</span><span class="d">from ${A.tLabel(now)}</span></div>
          <div class="kpi"><span class="l">Projected SL, rest of day</span><span class="v">${pct(c.restSL)}</span><span class="d">${A.slPill(c.restSL)}</span></div>
          <div class="kpi"><span class="l">Short windows ahead</span><span class="v">${short.length}</span><span class="d">${short.length ? fmtN(short.reduce((t, r) => t + (-r.avg) * (r.to - r.from) / 4, 0)) + ' agent-hours to find' : 'staffing holds'}</span></div>
        </div>
        <div class="grid g-side">
          <div class="grid">
            <section class="panel"><h2>Calls per interval</h2><p class="sub">Actuals up to now, then the forecast scaled by today's volume ratio.</p><div class="chart" id="id-calls"></div></section>
            <section class="panel"><h2>Staffing against re-forecast</h2><p class="sub">Requirement recalculated with actual AHT and volume.</p><div class="chart" id="id-staff"></div></section>
          </div>
          <section class="panel" style="align-self:start"><h2>Recommended actions</h2><p class="sub">Windows from ${A.tLabel(now)} with a sustained gap of at least 30 minutes.</p>
            <div class="reco">${c.recos.length ? c.recos.map(r => `<div class="it"><span class="pill ${r.type === 'short' ? 'crit' : 'good'}">${r.type === 'short' ? 'Short' : 'Over'}</span><b>${A.tLabel(r.from)}–${A.tLabel(r.to)} · ${r.type === 'short' ? '' : '+'}${fmtN(r.avg, 1)} agents</b><p>${r.type === 'short'
              ? `Move breaks and coaching out of this window, offer ${Math.max(1, Math.ceil(-r.avg))} agents overtime${r.donors && r.donors.length ? `, or borrow cross-skilled agents: ${r.donors.map(d => `up to ${d.n} from ${esc(d.name)}`).join(', ')}` : ''}.`
              : `Pull coaching, training or offline work into this window, or offer voluntary time off to up to ${Math.floor(r.avg)} agents.`}</p></div>`).join('') : '<p class="muted" style="margin:0">Scheduled staffing matches the re-forecast for the rest of the day.</p>'}</div>
          </section>
        </div>`;
    },
    after() {
      const c = intraCalc(), n = c.n;
      A.drawChart('id-calls', { n, now: c.now, height: 190, label: 'Calls', series: [
        { name: 'Forecast', type: 'line', values: c.Rq.calls[c.k], color: 'var(--muted)', dash: true, dp: 0 },
        { name: 'Actual', type: 'line', values: Array.from({ length: n }, (_, i) => i < c.now ? c.actual[i].calls : null), color: 'var(--s1)', dp: 0 },
        { name: 'Re-forecast', type: 'line', values: Array.from({ length: n }, (_, i) => i >= c.now - 1 ? c.rf.calls[i] : null), color: 'var(--s2)', dp: 0 }] });
      A.drawChart('id-staff', { n, now: c.now, height: 190, label: 'Staffing', series: [
        { name: 'Scheduled on phone', type: 'bar', values: c.net, color: 'var(--s1)', opacity: .8, dp: 0 },
        { name: 'Required (re-forecast)', type: 'step', values: c.rf.req, color: 'var(--s2)', dp: 1 }],
        extra: i => `<div class="row"><span>Projected SL</span><b>${pct(c.sl[i], 0)}</b></div>` });
    }
  };
  A.ACTS['new-actuals'] = () => { A.UI.id.seed++; A.render(); };

  /* ---------- Adherence ---------- */
  function adhCalc() {
    const S = A.S, U = A.UI.ad, n = A.nI();
    if (U.now == null) U.now = Math.min(n - 4, Math.max(4, (11 - S.settings.openH) * 4));
    const qid = U.queue >= 0 ? S.queues[U.queue].id : null;
    const list = S.agents.filter(a => (!qid || a.queue === qid) && (!U.team || a.team === U.team));
    const rows = E.simulateAdherence(list, U.date, U.now, S.settings, U.seed).map(r => Object.assign(r, { a: list[r.ai] }));
    return { rows, list };
  }
  const STATE_NAME = { PH: 'On phone', OFF: 'Not scheduled', B: 'Break', L: 'Lunch', M: 'Meeting', T: 'Training', C: 'Coaching', O: 'Offline work' };
  A.adhCalc = adhCalc;
  A.VIEWS.adherence = {
    html() {
      const S = A.S, U = A.UI.ad, { rows } = adhCalc(), n = A.nI();
      const inShift = rows.filter(r => r.sched !== 'OFF'), out = rows.filter(r => r.out), ackKey = r => U.date + ':' + U.now + ':' + r.a.id;
      const avgAdh = rows.length ? rows.reduce((t, r) => t + r.adh, 0) / rows.length : 1;
      const teams = {}; rows.forEach(r => { const t = teams[r.a.team] = teams[r.a.team] || { n: 0, out: 0, adh: 0 }; t.n++; if (r.out) t.out++; t.adh += r.adh; });
      const teamRows = Object.entries(teams).sort((a, b) => a[1].adh / a[1].n - b[1].adh / b[1].n).slice(0, 12);
      const show = (U.onlyOut === 'out' ? out : rows).slice(0, 150);
      const teamsAll = [...new Set(S.agents.filter(a => U.queue < 0 || a.queue === S.queues[U.queue].id).map(a => a.team))].sort();
      return A.head(`${E.fmtDate(U.date)} · ${A.tLabel(U.now)}`, 'Real-time adherence',
        'Scheduled activity against the live agent state. Exceptions show who is out of adherence and for how long. States are simulated in this demo; production reads them from your ACD.',
        `<button class="btn" data-act="adh-refresh">Refresh states</button><button class="btn" data-act="export-adherence">Export to Excel</button>`) +
        `<div class="toolbar">${A.queueSeg('ad.queue', U.queue, true)}<select data-bind="ad.team" aria-label="Team"><option value="">All teams</option>${teamsAll.map(t => `<option ${U.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${A.dateStepper('ad.date', U.date)}</div>
        <section class="panel" style="margin-bottom:14px"><div class="split"><label class="flabel" for="ad-now">Time <span class="num" style="color:var(--ink)">${A.tLabel(U.now)}</span></label></div><input class="range" id="ad-now" type="range" min="1" max="${n - 1}" value="${U.now}"></section>
        <div class="kpis">
          <div class="kpi"><span class="l">Scheduled now</span><span class="v">${fmtN(inShift.length)}</span><span class="d">${fmtN(inShift.filter(r => r.sched === 'PH').length)} on phone, ${fmtN(inShift.filter(r => r.sched !== 'PH').length)} in activities</span></div>
          <div class="kpi"><span class="l">Out of adherence</span><span class="v">${fmtN(out.length)}</span><span class="d">${pct(out.length / (inShift.length || 1))} of scheduled</span></div>
          <div class="kpi"><span class="l">Adherence today</span><span class="v">${pct(avgAdh)}</span><span class="d">${avgAdh >= 0.92 ? '<span class="pill good">On target</span>' : '<span class="pill warn">Below 92%</span>'}</span></div>
          <div class="kpi"><span class="l">Late logins</span><span class="v">${fmtN(rows.filter(r => r.actual === 'Logged out' && r.sched !== 'OFF').length)}</span><span class="d">scheduled but logged out</span></div>
          <div class="kpi"><span class="l">Acknowledged</span><span class="v">${fmtN(out.filter(r => S.acks[ackKey(r)]).length)}</span><span class="d">of ${fmtN(out.length)} exceptions</span></div>
        </div>
        <div class="grid g-side">
          <div><div class="toolbar"><div class="seg" role="group"><button data-set="ad.onlyOut" data-val="out" aria-pressed="${U.onlyOut === 'out'}">Exceptions</button><button data-set="ad.onlyOut" data-val="all" aria-pressed="${U.onlyOut === 'all'}">All agents</button></div><span class="muted">${fmtN(show.length)} shown</span></div>
          <div class="tbl-wrap"><table><thead><tr><th>Agent</th><th>Team</th><th>Scheduled</th><th>Actual state</th><th class="r">Out for</th><th class="r">Adherence today</th><th></th></tr></thead><tbody>
          ${show.map(r => `<tr><td><span class="lnk" data-agent="${esc(r.a.id)}">${esc(r.a.name)}</span></td><td class="mono">${esc(r.a.team)}</td><td>${STATE_NAME[r.sched]}</td><td>${r.out ? `<span class="pill crit">${esc(r.actual)}</span>` : esc(r.actual)}</td><td class="r num">${r.out ? r.mins + ' min' : '–'}</td><td class="r num">${pct(r.adh)}</td><td>${r.out ? (S.acks[ackKey(r)] ? '<span class="muted">Acknowledged</span>' : `<button class="btn sm" data-act="adh-ack" data-k="${esc(ackKey(r))}">Acknowledge</button>`) : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Everyone is in adherence.</td></tr>'}
          </tbody></table></div></div>
          <section class="panel" style="align-self:start"><h2>Teams to watch</h2><p class="sub">Lowest adherence today</p><table class="mini"><thead><tr><th>Team</th><th class="r">Agents</th><th class="r">Out now</th><th class="r">Adherence</th></tr></thead><tbody>${teamRows.map(([t, v]) => `<tr><td class="mono">${esc(t)}</td><td class="r num">${v.n}</td><td class="r num">${v.out}</td><td class="r num">${pct(v.adh / v.n)}</td></tr>`).join('')}</tbody></table></section>
        </div>`;
    }
  };
  Object.assign(A.ACTS, {
    'adh-ack': t => { A.S.acks[t.dataset.k] = Date.now(); A.save(); A.render(); },
    'adh-refresh': () => { A.UI.ad.seed++; A.render(); },
    'export-adherence': () => A.exportXLSX(`Peovala_adherence_${A.UI.ad.date}.xlsx`, [A.REPORTS.adherence.sheet()])
  });
  A.viewInputA = function (e) {
    const id = e.target.id;
    if (id === 'id-now') { A.UI.id.now = +e.target.value; A.rerenderKeepFocus(id); return true; }
    if (id === 'ad-now') { A.UI.ad.now = +e.target.value; clearTimeout(A._at); A._at = setTimeout(() => A.rerenderKeepFocus(id), 40); return true; }
    return A.forecastInput(e);
  };
})();
