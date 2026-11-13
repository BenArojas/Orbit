/* Prototype self-test: load index.html?test=1. Results are written to #testout. */
(async () => {
  const out = [], ok = (name, cond, info = '') => out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${info ? ' · ' + info : ''}`);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pd = (el, type) => el.dispatchEvent(new PointerEvent(type, { bubbles: true }));
  const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
  const fresh = () => { const p = Engine.intraday(500); S.live = { plan: p, qty: p.qty, qtyOpen: p.qty, avg: 18.86, realized: 0, stop: p.stop, t1done: false, closed: false, partial: null, forks: null, events: [] }; S.px = 19.4; render(); };
  try {
    const i = Engine.intraday(500), s = Engine.swing(500), o = Engine.options(500);
    ok('intraday size uses the limit price', i.qty === 588 && Math.round(i.loss) === 500, `${i.qty} sh, loss ${i.loss.toFixed(2)}`);
    ok('intraday planned risk is $499.80', Math.abs(i.loss - 499.8) < 1e-9 && Math.abs(i.cost - 11113.2) < 1e-9, `risk $${i.loss.toFixed(2)}, notional $${i.cost.toFixed(2)}`);
    ok('intraday never risks more than budget', [100, 275, 350, 600, 900].every(r => Engine.intraday(r).loss <= r + 1e-6));
    ok('swing never risks more than budget', [100, 275, 350, 600, 900].every(r => Engine.swing(r).loss <= r + 1e-6), `${s.qty} sh`);
    ok('options cost within budget, or zero contracts', [100, 250, 480, 500, 900].every(r => Engine.options(r).cost <= r) && Engine.options(100).n === 0, `${o.n} calls $${o.cost}`);
    ok('zero-contract option plan is blocked', SCREENS.console.eval(Engine.options(100)).locks.includes('One contract exceeds your risk budget'));
    ok('option model reprices to premium', Math.abs(bs(18.62, 20, DTE / 365, o.iv, true) - 2.40) < .01, 'IV ' + (o.iv * 100).toFixed(0) + '%');
    const pu = Engine.options(500, 'bear'); ok('puts break-even', Math.abs(pu.be - 15.40) < 1e-9 && pu.n === 3);
    ok('confirm hold is 0.4 s', HOLD_MS === 400);

    /* console: pre-arm at IBKR */
    S.plansReady = true; S.planKind = 'intraday'; S.scenario = 'normal'; go('console'); await sleep(300);
    const C = SCREENS.console, f0 = $('#fire');
    ok('breakout can be armed before it breaks', f0.classList.contains('ready') && /arm/i.test($('.t', f0).textContent), $('.t', f0).textContent);
    ok('arm button hidden from agent', f0.hasAttribute('data-agent-hidden'));
    pd(f0, 'pointerdown'); await sleep(150); pd(f0, 'pointerup');
    ok('early release cancels', f0.classList.contains('ready') && !C.armed);
    document.body.classList.add('rm'); pd(f0, 'pointerdown'); await sleep(150); const rmHeld = !C.armed; pd(f0, 'pointerup'); document.body.classList.remove('rm');
    ok('reduced motion keeps the hold', rmHeld);
    pd(f0, 'pointerdown'); await sleep(480);
    ok('0.4 s hold arms at IBKR', !!C.armed && f0.classList.contains('armed') && !S.live, `${C.armed?.qty} sh`);
    ok('flatten-all visible while armed', !$('#flatBtn').hidden);
    await sleep(2800);
    ok('armed order fills on the breakout', S.route === 'live' && !!S.live && S.live.qty === 588, `qty ${S.live?.qty}`);

    /* live: one-click forks */
    SCREENS.live.t1(); await sleep(200);
    ok('T1 realizes half', S.live.t1done && S.live.qtyOpen === 294 && Math.round(S.live.realized) === 291, `realized ${S.live.realized.toFixed(2)}`);
    ok('three forks, keep is default', !!$('.fork.def[data-f="keep"]') && $$('.fork').length === 3);
    const lk = $('.fork[data-f="lock"]'); ok('order-changing fork hidden from agent', lk.hasAttribute('data-agent-hidden'));
    lk.click(); await sleep(50);
    ok('lock in profit applies in one click', S.live.stop === S.live.avg && !S.live.forks, `stop ${S.live.stop}`);
    ok('worst case not negative after lock', worst(S.live) >= 0);

    /* widen: inline, guarded */
    fresh(); S.guard.maxRisk = 600; SCREENS.live.widen(); await sleep(50);
    ok('widen opens inline, no pop-up', !!$('#widenBox #wS') && !$('.scrim'));
    const sl = $('#wS'); sl.value = (18.05 - .6).toFixed(2); sl.dispatchEvent(new Event('input'));
    $('#wR').value = 'support on the daily chart'; $('#wR').dispatchEvent(new Event('input'));
    ok('widen past max-risk blocked', $('#wGo').classList.contains('locked'), $('#wOut').textContent.trim().slice(-46));
    sl.value = (18.05 - .1).toFixed(2); sl.dispatchEvent(new Event('input'));
    ok('small widen with a reason allowed', $('#wGo').classList.contains('ready'));
    $('#wR').value = ''; $('#wR').dispatchEvent(new Event('input'));
    ok('widen needs a reason', $('#wGo').classList.contains('locked'));
    $('.rchip').click(); ok('one-tap reason chip counts', $('#wGo').classList.contains('ready'), $('#wR').value);
    const wg = $('#wGo'); pd(wg, 'pointerdown'); await sleep(480);
    ok('hold widens the stop', Math.abs(S.live.stop - 17.95) < 1e-9, `stop ${S.live.stop}`);
    SCREENS.live.widen(); key('Escape'); ok('Esc closes the widen panel', !$('#wS'));

    /* drag on the rail */
    fresh();
    ok('stop and both targets draggable', $$('#lRail .mk.drag').length === 3);
    SCREENS.live.dropMark('stop', 18.40); ok('drag stop up tightens at once', S.live.stop === 18.40);
    SCREENS.live.dropMark('stop', 18.20); ok('drag stop down opens the widen check', S.live.stop === 18.40 && !!$('#wS') && +$('#wS').value === 18.2);
    SCREENS.live.closeWiden(); SCREENS.live.dropMark('t1', 21.10); ok('drag a target moves it', S.live.plan.targets[1].p === 21.10);

    /* one-click and keyboard exits */
    fresh(); const s0 = S.live.stop; key('t'); ok('T tightens', S.live.stop > s0, `${s0} → ${S.live.stop}`);
    key('l'); ok('L with stop already at entry is a no-op', S.live.stop === 18.86);
    fresh(); ok('exit is a plain one-click button', !$('#exitNow').classList.contains('fire')); $('#exitNow').click(); ok('Exit now closes in one click', S.live.closed);
    fresh(); key('E', { shiftKey: true }); ok('⇧E exits', S.live.closed);
    fresh(); key('F', { shiftKey: true }); ok('⇧F flattens and hides the button', S.live.closed && $('#flatBtn').hidden);
    fresh(); $('#composer').focus(); $('#composer').dispatchEvent(new KeyboardEvent('keydown', { key: 'E', shiftKey: true, bubbles: true })); ok('shortcuts ignored while typing', !S.live.closed); $('#composer').blur();
    fresh(); S.awayOpen = false; SCREENS.live.away(); await sleep(30); ok('catch-up is inline, not a pop-up', !!$('#awayBox .awayc') && !$('.scrim'));
    SCREENS.live.stopOut(); await sleep(100); ok('stop-out closes trade', S.live.closed);

    /* armed order gets pulled when a guardrail trips */
    S.guard = BASE_GUARD(); S.scenario = 'normal'; S.live = null; go('console'); await sleep(300);
    pd($('#fire'), 'pointerdown'); await sleep(480); const armedOk = !!C.armed;
    C.setScenario('daily'); await sleep(50);
    ok('guardrail trip pulls the armed order', armedOk && !C.armed && $('#fire').classList.contains('locked'));

    C.setScenario('chase'); await sleep(300);
    ok('chase blocks', $('#fire').classList.contains('locked') && /past/.test($('#cPre').textContent));
    C.setScenario('slip'); await sleep(300);
    const pl = C.plan(), ev = C.eval(pl);
    ok('size already assumes the maximum limit fill', ev.pre === null && pl.qty === 588 && ev.ready, `${pl.qty} sh at $${S.px}, limit $18.90`);
    ok('worst allowed fill stays within risk budget', pl.qty * (18.90 - pl.stop) <= S.risk + 1e-6);
    ok('past the trigger it places now', /place/i.test($('#fire .t').textContent));
    for (const sc of ['daily', 'cooldown', 'pdt', 'gateway', 'spread']) { C.setScenario(sc); await sleep(250); ok('locked: ' + sc, $('#fire').classList.contains('locked'), $('#fire .s').textContent); }
    C.setScenario('normal');

    /* merged Ideas: playbooks drive the default view */
    S.live = null; S.lookTab = 'setups'; go('ideas'); await sleep(300);
    const on = PB.filter(p => pbOn(p)).length;
    ok('setups is the default Ideas view', $$('#lookBody .pbsec').length === on && on === 4, `${on} playbooks on`);
    ok('breakout is off in a selective market', !pbOn(PB.find(p => p.id === 'bo')) && /Breakout/.test($('#pbOffBtn').textContent));
    ok('no scans tab', !$('#lookSeg [data-v="scan"]'));
    ok('vs-sector chip on setup rows', $$('#lookBody .vs').length >= 5);
    S.lookTab = 'watch'; SCREENS.ideas.paintBody(); const n0 = S.lists[S.list].length;
    $('#wlAdd').value = 'mu'; $('#wlAddBtn').click(); ok('watchlist add', S.lists[S.list].length === n0 + 1 && S.lists[S.list].includes('MU'));
    $('#lookBody [data-rm="MU"]').click(); ok('watchlist remove', S.lists[S.list].length === n0);
    S.lookTab = 'alerts'; SCREENS.ideas.paintBody(); const h0 = S.hits.length; $('#lookBody [data-dis]').click(); ok('dismiss an alert', S.hits.length === h0 - 1);

    /* playbooks */
    go('playbooks'); await sleep(250);
    ok('five playbooks with editable numbers', $$('.pbc').length === 5 && $$('input[data-pb]').length >= 10);
    const inp = $('input[data-pb="lpb"][data-k="rs"]'); inp.value = '85'; inp.dispatchEvent(new Event('change')); ok('edit a rule number', PB[0].params.rs === 85);
    $('[data-pbt="bo"]').click(); await sleep(50); ok('turn a playbook on for this market', pbOn(PB.find(p => p.id === 'bo')));
    $('[data-pbt="bo"]').click(); await sleep(50); ok('and off again', !pbOn(PB.find(p => p.id === 'bo')));

    /* indicator math and warm-up */
    const ramp = Array.from({ length: 30 }, (_, i) => i + 1);
    ok('EMA starts from the simple average of its first 21 bars', emaOf(ramp, 21)[19] === null && Math.abs(emaOf(ramp, 21)[20] - 11) < 1e-12);
    ok('SMA matches a hand-computed value', Math.abs(smaOf(ramp, 5)[9] - 8) < 1e-12 && smaOf(ramp, 5)[3] === null);
    const DB = barsFor('NVDA', 'D').B, wk = [], n9 = DB.length; for (let e = n9 - 5; e >= 0; e -= 5) wk.unshift(DB[e].c);
    while (wk.length && n9 - 5 - (wk.length - 1) * 5 < 4) wk.shift(); let e9 = wk.slice(0, 9).reduce((a, b) => a + b) / 9; for (let j = 9; j < wk.length; j++) e9 = wk[j] * .2 + e9 * .8;
    ok('9-week EMA uses completed weekly closes', Math.abs(weeklyEma(DB, 9).at(-1) - e9) < 1e-9, `${e9.toFixed(2)}`);
    ok('9-week EMA waits 27 weeks to warm up', weeklyEma(DB, 9).findIndex(v => v != null) >= 27 * 5);
    ok('charts load more history than they show', barsFor('IREN', '5m').B.length >= 90 + WARM.sma200);
    S.histCap = 120; S.ind.sma200 = true; S.ind.wema = true; S.tf = 'D'; S.vis = 126; S.off = 0; openChart('CRWD', 'chart'); await sleep(300);
    ok('short history: SMA 200 is not drawn and says why', /SMA 200 needs 200 days/.test($('#chNote').textContent) && !$('#chartBox polyline[stroke="#B4407A"]'));
    ok('short history: weekly EMA says why', /8\/9-week EMA needs/.test($('#chNote').textContent));
    S.histCap = 0; S.ind.sma200 = false; S.ind.wema = false; S.tf = '5m'; S.vis = 90;
    openChart('IREN', 'chart'); await sleep(300);
    const svgC = $('#chartBox svg');
    ok('chart is drawn at its container width', Math.abs(+svgC.getAttribute('width') - Math.floor($('#chartBox').clientWidth)) <= 1, `${svgC.getAttribute('width')}px`);
    S.chH = 420; SCREENS.chart.paint(); ok('chart height follows the resize handle setting', +$('#chartBox svg').getAttribute('height') > 420);
    const r0 = $('#chartBox').getBoundingClientRect();
    $('#chartBox').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: r0.left + r0.width / 2, clientY: r0.top + 50, bubbles: true, cancelable: true }));
    ok('scroll zooms out', S.vis > 90, `${S.vis} bars`);
    $('#chartBox').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); ok('double-click resets the view', S.vis === 90 && S.off === 0);
    ok('readout sits above the plot, not on it', !$('#chartBox #chRead') && !!$('.chhead'));
    /* chart + drawings */
    openChart('IREN', 'chart'); await sleep(300);
    const CHT = SCREENS.chart, B5 = barsFor('IREN', '5m').B, ss = barsFor('IREN', '5m').sess;
    ok('opening high is 18.85 on the IREN chart', Math.max(...B5.slice(ss).map(b => b.h)) === 18.85);
    S.draw.IREN = []; S.alerts.IREN = [];
    S.tool = 'hline'; CHT.clickAt({ main: true, t: B5[ss + 4].t, p: 18.85, i: 0 }); ok('one-click level', S.draw.IREN.length === 1 && S.tool === 'cursor');
    S.tool = 'fib'; CHT.clickAt({ main: true, t: B5[ss].t, p: 17.9, i: 0 }); ok('fib waits for a second point', S.draw.IREN.length === 1 && !!S.pend);
    CHT.clickAt({ main: true, t: B5[ss + 10].t, p: 18.85, i: 0 }); ok('fib saved', S.draw.IREN.length === 2 && S.draw.IREN[1].type === 'fib');
    S.tool = 'alert'; CHT.clickAt({ main: true, t: B5[ss + 10].t, p: 19.2, i: 0 }); ok('alert tool sets a price alert', S.alerts.IREN.length === 1 && S.alerts.IREN[0].up);
    S.tf = '15m'; render(); await sleep(150); ok('drawings stay on another timeframe', $$('#chartBox line').length > 0 && S.draw.IREN.length === 3);
    $('#tUndo').click(); ok('undo removes the alert too', S.draw.IREN.length === 2 && S.alerts.IREN.length === 0);
    S.tf = '5m';

    /* compare */
    openChart('NVDA', 'compare'); await sleep(300);
    const dN = divergence('NVDA', 'SPY', '3m'), dM = divergence('MSFT', 'SPY', '3m');
    ok('compare shows market, sector and peers', cmpRefs('NVDA').join() === 'SPY,SMH,AMD,AVGO', cmpRefs('NVDA').join());
    ok('leader reads as leading the market', dN.verdict === 'Leading' && /leading/.test($('#cSum').textContent), `${dN.diff.toFixed(1)} pts`);
    ok('laggard reads as lagging', dM.verdict === 'Lagging', `${dM.diff.toFixed(1)} pts`);
    ok('difference equals the two returns', Math.abs(dN.diff - (retOver('NVDA', '3m') - retOver('SPY', '3m'))) < 1e-9);
    ok('RS line equals price ratio', Math.abs(dN.rs.at(-1) - dailyFor('NVDA').at(-1) / dailyFor('SPY').at(-1)) < 1e-12);
    $('#cAdd').value = 'tsm'; $('#cAdd').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await sleep(50);
    ok('add a reference', cmpRefs('NVDA').includes('TSM') && $$('.cref').length === 6);
    S.chartMode = 'chart';

    /* plans: watch it */
    S.plansReady = true; S.watchIren = false; go('plans'); await sleep(250);
    $('[data-watch="intraday"]').click(); ok('watch a plan instead of placing it', $$('#watchCard tr').length === 4 && /IREN/.test($('#watchCard').textContent));
    ok('plan card shows its playbook', /Opening high breakout/.test($('#cards [data-id="intraday"]').textContent));

    /* live: holdings */
    S.live = null; S.hold = HOLD0.map(h => ({ ...h })); S.orders = [{ id: 1, tk: 'SMH', what: 'Stop: sell 30 at $240.00', kind: 'protect', tif: 'GTC' }, { id: 3, tk: 'MSFT', what: 'Buy 10 at $425.00 limit', kind: 'entry', tif: 'DAY' }];
    S.allocView = 'list'; go('live'); await sleep(250);
    ok('holdings list shows every position', $$('#holdCard [data-hclose]').length === 5);
    ok('unprotected holdings are flagged', $$('#holdCard .bdg.warn').length === 3);
    ok('vs S&P column links to compare', $$('#holdCard [data-hvs]').length === 5);
    $('[data-ocancel="3"]').click(); ok('cancel an entry order in one click', !S.orders.some(o => o.id === 3));
    const rp = $('[data-oprot="1"]'); ok('removing a stop needs a hold', rp.classList.contains('fire'));
    pd(rp, 'pointerdown'); await sleep(150); pd(rp, 'pointerup'); ok('short press keeps the stop', S.orders.some(o => o.id === 1));
    $('[data-hclose="MSFT"]').click(); ok('close a holding in one click', !S.hold.some(h => h.tk === 'MSFT') && S.cash > 18400);
    S.allocView = 'tree'; render(); await sleep(200);
    const tr = $$('#tmBox g[data-ti]');
    ok('treemap shows every holding', tr.length === Holdings.items().length && $$('#tmLeg .li').length === tr.length);
    ok('every treemap label fits inside its box', tr.every(g => { const r = g.querySelector('rect').getBBox(); return [...g.querySelectorAll('text')].every(t => { const b = t.getBBox(); return b.x >= r.x && b.x + b.width <= r.x + r.width && b.y >= r.y && b.y + b.height <= r.y + r.height; }); }));
    ok('options are striped in the treemap', $$('#tmBox rect[fill="url(#hatch)"]').length === 1);
    S.allocView = 'list'; render(); await sleep(150);
    ok('options are tagged in the holdings list', /Option/.test($('[data-hclose="PLTR"]').closest('tr').textContent) && /days left/.test($('[data-hclose="PLTR"]').closest('tr').textContent));
    S.allocView = 'lead'; S.leadSort = 'pct'; render(); await sleep(150);
    ok('leaders podium ranks by % gain', /NVDA/.test($('.pd.p1').textContent));

    /* review */
    go('review'); await sleep(200);
    ok('review has no performance or transactions tabs', !$('#revSeg'));
    ok('memory level 2 is not selectable', !$('.lvl[data-l="2"]') && !!$('.lvl.off'));
    ok('results by playbook', $$('tr', $$('.card').find(c => /By playbook/.test(c.textContent))).length === 6);    for (const r of ['ideas', 'plans', 'options', 'review', 'settings', 'playbooks', 'chart']) { go(r); await sleep(250); ok('renders ' + r, $('#ws .view').children.length > 0); }
    go('settings'); await sleep(200); ok('API-key provider is selected first; API key and account are hidden', S.aiProv === 'key' && $$('[data-agent-secret]').length === 2);
    $('[data-prov="codex"]').click(); await sleep(100); ok('plan CLI stays unavailable before sandbox approval', S.aiProv === 'key');
    S.theme = 'dark'; applyTheme(); ok('dark theme applies', getComputedStyle(document.documentElement).getPropertyValue('--c60').trim().toUpperCase() === '#161514');
  } catch (e) { out.push('FAIL exception · ' + e.message + ' ' + (e.stack || '').split('\n')[1]); }
  const pre = document.createElement('pre'); pre.id = 'testout'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
})();
