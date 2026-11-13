/* Orbit prototype screens. Every number shown comes from Engine (app.js), never from the agent text. */
const spark = (v, c, w = 92, h = 26) => { const mn = Math.min(...v), mx = Math.max(...v);
  const pts = v.map((y, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 2 - (y - mn) / (mx - mn || 1) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`; };
const BASE_GUARD = () => ({ dailyLimit: 900, dailyUsed: 310, maxRisk: 600, cooldownMin: 15, cooldownLeft: 0, pdtUsed: 2, pdtMax: 3, chaseCents: 5 });

function simPanel(title, items, onPick, active) {
  $('#sim')?.remove();
  const el = document.createElement('div'); el.className = 'sim'; el.id = 'sim';
  el.innerHTML = `<span class="sh">${title} · prototype only</span>${items.map(i => `<button data-s="${i[0]}" class="${i[0] === active ? 'on' : ''}" style="--mc:${i[2] || 'var(--ink3)'}"><i></i>${i[1]}</button>`).join('')}`;
  $('#ws .ws-in').prepend(el);
  $$('button', el).forEach(b => b.onclick = () => { $$('button', el).forEach(x => x.classList.toggle('on', x === b)); onPick(b.dataset.s); });
}

const SCREENS = {};

/* ============================== IDEAS ============================== */
const MOVERS = [
  ['IREN', 'Iris Energy', 18.62, 15.2, 'Earnings beat yesterday', [15.9, 16.0, 16.2, 16.1, 17.4, 17.9, 18.2, 18.1, 18.5, 18.62]],
  ['PLTR', 'Palantir', 74.10, 6.8, 'Analyst upgrade', [69.4, 69.8, 70.1, 71.6, 72.0, 72.9, 73.4, 73.2, 73.9, 74.1]],
  ['HOOD', 'Robinhood', 41.35, 3.1, 'Volume 2× average', [40.1, 40.0, 40.4, 40.6, 40.5, 40.9, 41.0, 41.2, 41.1, 41.35]],
  ['NVDA', 'Nvidia', 182.40, 1.4, 'On your watchlist', [179.9, 180.3, 180.1, 180.9, 181.2, 181.0, 181.7, 182.1, 182.0, 182.4]],
  ['AMD', 'AMD', 151.02, -2.1, 'Stopped you out yesterday', [154.2, 153.8, 153.1, 152.9, 152.4, 152.0, 151.6, 151.4, 151.2, 151.0]]
];
SCREENS.ideas = {
  sees: () => '<b>Ideas</b> · movers list, thesis box',
  html() {
    return `
    <div class="ph"><div><h1>What\u2019s your idea?</h1><p>Describe a trade in your own words, or pick a mover. Orbit turns it into plans you can place with one press, and does all the math.</p></div>
      <span class="bdg co mono">${clockTxt(S.clock)} ET · market open</span></div>
    <div class="grid2" style="grid-template-columns:1.25fr 1fr">
      <div class="card">
        <div class="h2">Start from a thesis</div>
        <textarea class="inp mt10" id="ideaTxt" rows="3" style="width:100%" placeholder="e.g. IREN reported yesterday, up 15% premarket. I\u2019m bullish and willing to risk $500.">${S.thesis ? S.thesis : ''}</textarea>
        <div class="drop mt10" id="drop">${S.att ? `${ICON.clip}&nbsp; <b>iren-5min-chart.png</b> attached · checked fresh` : 'Drop a chart screenshot here, or click to attach. Orbit checks it isn\u2019t stale before using it.'}</div>
        <div class="row mt14">
          <button class="btn pri" id="ideaGo">Build plans</button>
          <button class="btn ghost" id="ideaEx">Use the IREN example</button>
        </div>
        <div class="faint mt6" style="font-size:11.5px">Stocks + single-leg options · regular hours only</div>
        <div id="ctx" class="mt14">${this.ctxHtml()}</div>
      </div>
      <div class="card">
        <div class="row sb"><div class="h2">Moving now</div><span class="faint" style="font-size:11.5px">From your watchlist + top gainers</span></div>
        <div class="col mt10 stg">${MOVERS.map(m => `
          <div class="idea" data-tk="${m[0]}">
            <div><div class="tk">${m[0]}</div><div class="faint" style="font-size:11px">${m[1]}</div></div>
            ${spark(m[5], m[3] >= 0 ? 'var(--up)' : 'var(--down)')}
            <div class="sp"><div class="num" style="font-weight:600">$${px2(m[2])}</div><div class="num ${m[3] >= 0 ? 'up' : 'down'}" style="font-size:11.5px">${m[3] >= 0 ? '+' : '−'}${Math.abs(m[3]).toFixed(1)}%</div></div>
            <div style="width:128px;font-size:11px" class="mut">${m[4]}</div>
          </div>`).join('')}</div>
      </div>
    </div>`;
  },
  ctxHtml() {
    if (S.ctxState === 'loading') return `<div class="lbl">Context Orbit is pulling</div><div class="grid2 mt10" style="gap:8px">${Array(6).fill('<div class="sk" style="height:46px"></div>').join('')}</div>`;
    if (S.ctxState !== 'done') return '';
    const r = [['Live price', '$18.62', 'IBKR'], ['Premarket range', '$17.10 – $18.40', 'IBKR'], ['Typical 5-min move', '$0.73', 'Orbit'], ['Volume vs average', '2.4×', 'IBKR'], ['Your budget today', money(S.guard.dailyLimit - S.guard.dailyUsed) + ' left', 'Orbit']];
    return `<div class="lbl">Context Orbit pulled</div><div class="grid2 mt10 stg" style="gap:8px">${r.map(x => `<div class="well"><div class="row sb"><span class="faint" style="font-size:11px">${x[0]}</span><span class="faint mono" style="font-size:9.5px">${x[2]}</span></div><div class="num" style="font-weight:600;margin-top:2px">${x[1]}</div></div>`).join('')}</div>`;
  },
  mount() {
    $('#ideaGo').onclick = () => { const t = $('#ideaTxt').value.trim(); if (!t) { $('#ideaTxt').focus(); return; } this.runThesis(t, S.att ? 'iren-5min-chart.png' : ''); };
    $('#ideaEx').onclick = () => this.example();
    $('#drop').onclick = () => { S.att = true; $('#drop').innerHTML = `${ICON.clip}&nbsp; <b>iren-5min-chart.png</b> attached`; };
    $$('.idea').forEach(el => el.onclick = () => { const tk = el.dataset.tk; $('#ideaTxt').value = tk === 'IREN' ? 'IREN reported yesterday, up 15% premarket. I\u2019m bullish and willing to risk $500.' : `${tk} looks interesting today. What would a plan look like?`; $('#ideaTxt').focus(); Dock.touch('#ideaTxt'); });
  },
  async agent(first) {
    if (!first) return;
    await Dock.say(`Morning. The market opened ${S.clock - 570} minutes ago. Tell me an idea in plain words, or pick a mover. I\u2019ll turn it into plans and Orbit\u2019s risk engine will do the math.`, 400);
    Dock.chips([{ t: 'Try the IREN example', silent: true, fn: () => this.example() }]);
  },
  example() {
    const t = 'IREN reported yesterday, up 15% premarket. I\u2019m bullish and willing to risk $500.';
    if ($('#ideaTxt')) { $('#ideaTxt').value = t; Dock.touch('#ideaTxt'); }
    S.att = true; if ($('#drop')) $('#drop').innerHTML = `${ICON.clip}&nbsp; <b>iren-5min-chart.png</b> attached`;
    setTimeout(() => this.runThesis(t, 'iren-5min-chart.png'), 350);
  },
  async runThesis(text, att) {
    if (this.running) return; this.running = true;
    S.thesis = text; S.risk = (+(text.match(/\$\s?(\d{2,4})/) || [])[1]) || 500;
    Dock.me(text, att || null);
    if (att) {
      await Dock.steps('Checking your screenshot', [['Reading the chart: IREN, 5-minute', 'vision'], ['Last candle 10:37 ET · 4 min old', 'fresh'], ['Matches the live price $18.62', 'IBKR']]);
      await Dock.say('Your screenshot is fresh and matches the live price, so I\u2019ll use it. I can see a tight flag forming just under <b>$18.85</b>, the opening high.', 300);
    }
    S.ctxState = 'loading'; if ($('#ctx')) $('#ctx').innerHTML = this.ctxHtml();
    await Dock.steps('Pulling context', [['Live quote + premarket range', 'IBKR'], ['How much IREN usually moves', 'Orbit'], ['Your loss budget + day trades left', 'Orbit']]);
    S.ctxState = 'done'; if ($('#ctx')) $('#ctx').innerHTML = this.ctxHtml();
    await Dock.say(`IREN opened up <b>15%</b> after reporting yesterday. You said <em>bullish, risk ${money(S.risk)}</em>. One question: how long do you want to hold it?`);
    this.running = false;
    const done = async (k) => { S.planKind = k; S.plansReady = true;
      await Dock.say(`Built three plans. The sizes and dollar amounts come from Orbit\u2019s risk engine, not from me, and every plan risks at most <em>${money(S.risk)}</em>.`, 450); go('plans'); };
    Dock.chips([{ t: 'Today only', fn: () => done('intraday') }, { t: 'A few days', fn: () => done('swing') }, { t: 'Show me all three', y: true, fn: () => done('intraday') }]);
  }
};

/* ============================== PLANS ============================== */
let prevVals = {};
SCREENS.plans = {
  sees: () => S.plansReady ? '<b>Plans</b> · 3 plan cards, risk slider' : '<b>Plans</b> · empty',
  html() {
    if (!S.plansReady) return `<div class="ph"><div><h1>Plans</h1><p>Plans you build show up here side by side.</p></div></div>
      <div class="empty">No plans yet.<div class="mt10"><button class="btn pri" id="plEx">Build the IREN example</button></div></div>`;
    const over = S.risk > S.guard.maxRisk;
    return `
    <div class="ph"><div><h1>Three ways to trade IREN</h1><p>${S.thesis || ''}</p></div>
      <button class="btn ghost" onclick="go('ideas')">Edit idea</button></div>
    <div class="card row gap14" style="padding:14px 16px">
      <div style="width:200px"><div class="h3">How much can you lose?</div><div class="faint" style="font-size:11.5px">Every plan resizes to fit</div></div>
      <input type="range" id="riskSl" min="100" max="900" step="25" value="${S.risk}" style="flex:1">
      <div class="num" style="font-size:20px;font-weight:600;width:80px;text-align:right" id="riskV">${money(S.risk)}</div>
      ${over ? `<span class="bdg err"><span class="ci"></span>Over your ${money(S.guard.maxRisk)} limit</span>` : `<span class="bdg">Limit ${money(S.guard.maxRisk)} / trade</span>`}
    </div>
    <div class="grid3 mt14 stg" id="cards">${this.cards()}</div>
    <p class="faint mt14" style="font-size:11.5px">Turn on <b>Pro details</b> in the header to see order types and raw levels for each plan.</p>`;
  },
  cards() { return Engine.all(S.risk).map(p => this.card(p)).join(''); },
  card(p) {
    const g = S.guard, sel = S.planKind === p.id, over = S.risk > g.maxRisk;
    const bad = p.id === 'intraday' && g.pdtUsed >= g.pdtMax;
    const badge = { intraday: bad ? '<span class="bdg err"><span class="ci"></span>Day trades used up</span>' : `<span class="bdg warn"><span class="dm"></span>Uses 1 day trade · ${g.pdtUsed}/${g.pdtMax}</span>`,
      swing: '<span class="bdg warn"><span class="dm"></span>Holds overnight</span>', options: '<span class="bdg ok"><span class="ci"></span>Can\u2019t lose more than cost</span>' }[p.id];
    const r = p.id === 'options'
      ? rail({ min: 15.5, max: 23.5, now: S.px, zones: false, marks: [{ p: p.k, l: 'Strike', k: 'entry' }, { p: p.be, l: 'Break-even', k: p.call ? 'tgt' : 'stop' }] })
      : rail({ min: p.min, max: p.max, now: S.px, marks: [{ p: p.stop, l: 'Stop', k: 'stop' }, { p: p.entry, l: 'Buy', k: 'entry' }, ...p.targets.map(t => ({ p: t.p, l: t.label, k: 'tgt' }))] });
    return `<div class="card hov ${sel ? 'sel' : ''}" data-id="${p.id}" style="display:flex;flex-direction:column">
      <div class="row sb"><span class="bdg co">${p.name}</span><span class="faint" style="font-size:11px">${p.horizon}</span></div>
      <div class="h2 mt10">${p.title}</div>
      <div class="row mt14" style="gap:22px;align-items:flex-start">
        <div><div class="lbl">You risk</div><div class="num down" style="font-size:24px;font-weight:600;letter-spacing:-.035em" data-m="loss" data-id="${p.id}">${money(-p.loss)}</div></div>
        <div><div class="lbl">You could make</div><div class="num up" style="font-size:24px;font-weight:600;letter-spacing:-.035em" data-m="win" data-id="${p.id}">${money(p.win, true)}</div></div>
      </div>
      <div class="rr mt10"><div class="r" style="flex-grow:${p.loss}">risk</div><div class="w" style="flex-grow:${p.win}">${p.rr.toFixed(1)}× reward</div></div>
      ${r}
      <p style="font-size:12.5px;line-height:1.5">${p.plain}</p>
      <div class="row mt10" style="flex-wrap:wrap;gap:6px">${badge}</div>
      <div class="prob">${p.pro.map(x => `<span>${x[0]}</span><span>${x[1]}</span>`).join('')}</div>
      <div style="flex:1"></div>
      <div class="row mt14">
        <button class="btn pri" data-load="${p.id}" ${over || bad ? 'disabled' : ''} style="flex:1">Load into console</button>
        ${p.id === 'options' ? '<button class="btn" onclick="go(\'options\')">Details</button>' : ''}
      </div>
    </div>`;
  },
  bindCards() {
    $$('[data-load]').forEach(b => b.onclick = e => { e.stopPropagation(); S.planKind = b.dataset.load; S.scenario = 'normal'; go('console'); });
    $$('#cards .card').forEach(c => c.onclick = () => { S.planKind = c.dataset.id; $$('#cards .card').forEach(x => x.classList.toggle('sel', x === c)); });
  },
  refresh() {
    const old = {}; $$('[data-m]').forEach(el => old[el.dataset.id + el.dataset.m] = +el.dataset.raw || 0);
    $('#cards').classList.remove('stg'); $('#cards').innerHTML = this.cards(); this.bindCards();
    Engine.all(S.risk).forEach(p => {
      const L = $(`[data-m="loss"][data-id="${p.id}"]`), W = $(`[data-m="win"][data-id="${p.id}"]`);
      L.dataset.v = prevVals[p.id + 'loss'] ?? p.loss; W.dataset.v = prevVals[p.id + 'win'] ?? p.win;
      countTo(L, p.loss, v => money(-v)); countTo(W, p.win, v => money(v, true));
      prevVals[p.id + 'loss'] = p.loss; prevVals[p.id + 'win'] = p.win;
    });
  },
  mount() {
    if (!S.plansReady) { $('#plEx').onclick = () => { go('ideas'); setTimeout(() => SCREENS.ideas.example(), 250); }; return; }
    Engine.all(S.risk).forEach(p => { prevVals[p.id + 'loss'] = p.loss; prevVals[p.id + 'win'] = p.win; });
    this.bindCards();
    const sl = $('#riskSl');
    sl.oninput = () => { S.risk = +sl.value; $('#riskV').textContent = money(S.risk); this.refresh(); };
    sl.onchange = () => render();
    onTick(() => $$('#cards .rail').forEach(r => moveRail(r, S.px)));
  },
  async agent(first) {
    if (!S.plansReady) return;
    if (first) await Dock.say(`Here\u2019s how I\u2019d think about it:<br><br><b>Intraday</b> has the cleanest setup. <b>Swing</b> has a wider stop because it has to survive overnight, so you get fewer shares. <b>Options</b> cap your loss at what you pay.<br><br>Drag the slider and everything resizes.`);
    Dock.chips([
      { t: 'Make it smaller: risk $350', fn: () => this.agentResize(350) },
      { t: 'Why fewer shares on Swing?', fn: () => Dock.say('Swing\u2019s stop is <b>$1.80</b> below entry, because it has to survive overnight swings. Intraday\u2019s is only <b>$0.85</b> from the maximum fill to its stop. Same dollar risk ÷ bigger distance = fewer shares.') },
      { t: 'Just place the intraday one', fn: () => agentTryPlace(), silent: true }
    ]);
  },
  async agentResize(v) {
    await Dock.say(`Lowering your risk to <em>${money(v)}</em>. Watch the slider.`, 350);
    const sl = $('#riskSl'); if (!sl) return; Dock.touch(sl.parentElement);
    const from = S.risk, steps = 8;
    for (let i = 1; i <= steps; i++) { await wait(40); S.risk = Math.round((from + (v - from) * i / steps) / 25) * 25; sl.value = S.risk; $('#riskV').textContent = money(S.risk); this.refresh(); }
    await Dock.say(`Done. Intraday is now <b>${Engine.intraday(v).qty} shares</b>. I changed the slider only; loading a plan and placing it is still up to you.`, 300);
  },
  reply(t) { if (/small|less|risk/i.test(t)) { const m = t.match(/\d{3}/); return this.agentResize(m ? +m[0] : 350); } return Dock.say('I can resize the plans, explain any number, or compare them. Placing is always your press.'); }
};

/* ============================== OPTIONS ============================== */
SCREENS.options = {
  sees: () => '<b>Options plan</b> · payoff, what-if sliders',
  html() {
    const p = Engine.options(S.risk);
    S.wiPx ??= 21; S.wiDay ??= 14;
    return `
    <div class="ph"><div><h1>IREN options plan</h1><p>Buy calls if you think it goes up, puts if you think it goes down. You can never lose more than you pay.</p></div>
      <button class="btn ghost" onclick="go('plans')">Back to plans</button></div>
      <div class="row" style="gap:12px">${seg('outSeg', [['bull', 'I think it goes up · calls'], ['bear', 'I think it goes down · puts']], S.outlook)}<span class="faint" style="font-size:11.5px">Long options only · no spreads or short options</span></div>
    <div class="grid2 mt14" style="grid-template-columns:1.35fr 1fr">
      <div class="card">
        <div class="lbl">The bet</div>
        <div style="font-size:21px;font-weight:700;letter-spacing:-.02em;margin-top:4px;line-height:1.3">${p.plain}</div>
        <div class="row mt14" style="gap:22px">
          <div><div class="lbl">Costs (max loss)</div><div class="num down" style="font-size:22px;font-weight:600">${money(-p.cost)}</div></div>
          <div><div class="lbl">Target alert at 2×</div><div class="num up" style="font-size:22px;font-weight:600">${money(p.win, true)}</div></div>
          <div><div class="lbl">You buy</div><div class="num" style="font-size:22px;font-weight:600">${p.n} ${p.call ? 'calls' : 'puts'}</div></div>
        </div>
        <div class="payoff mt14" id="payoff">${this.chart(p)}</div>
        <div class="faint" style="font-size:11px;margin-top:4px"><span style="color:var(--c30)">━</span> value on the date you pick · <span>┄</span> value at expiry</div>
      </div>
      <div class="col gap14">
        <div class="card">
          <div class="h3">What if…</div>
          <div class="field mt10"><label>IREN price <span class="num" id="wiPxV" style="float:right;color:var(--ink)">$${px2(S.wiPx)}</span></label><input type="range" id="wiPx" min="14" max="26" step="0.1" value="${S.wiPx}"></div>
          <div class="field mt10"><label>Date <span class="num" id="wiDayV" style="float:right;color:var(--ink)"></span></label><input type="range" id="wiDay" min="0" max="${DTE}" step="1" value="${S.wiDay}"></div>
          <div class="well mt14" id="wiOut"></div>
        </div>
        <div class="card">
          <div class="h3">In plain words</div>
          <div class="col gap10 mt10" style="font-size:12.5px">
            <div><b>Moves with the stock.</b> About <span class="num">${money(Math.abs(p.delta) * 100 * p.n)}</span> per $1 IREN moves ${p.call ? 'up' : 'down'}.<span class="pro-i faint mono"> (Δ ${p.delta.toFixed(2)})</span></div>
            <div><b>Costs time.</b> Loses about <span class="num">${money(Math.abs(p.theta) * 100 * p.n)}</span> a day if IREN stands still.<span class="pro-i faint mono"> (Θ ${(p.theta * 100).toFixed(1)}/contract)</span></div>
            <div><b>Volatility.</b> Earnings are behind us, so the post-earnings drop in option prices already happened.<span class="pro-i faint mono"> (IV ${Math.round(p.iv * 100)}%)</span></div>
          </div>
          <div class="col gap6 mt14">
            <span class="bdg ok"><span class="ci"></span>Spread is $0.08 (fine)</span>
            <span class="bdg ok"><span class="ci"></span>${DTE} days left, more than 21</span>
            <span class="bdg warn"><span class="dm"></span>Needs a ${Math.round(Math.abs(p.be / 18.62 - 1) * 100)}% move by Dec 19 to break even</span>
          </div>
        </div>
      </div>
    </div>
    <div class="row mt14"><button class="btn pri" id="optLoad">Load into console</button><div class="prob" style="margin:0;border:0;padding:0;flex:1">${p.pro.map(x => `<span>${x[0]}</span><span>${x[1]}</span>`).join('')}</div></div>`;
  },
  chart(p) {
    const W = 600, H = 210, x0 = 14, x1 = 26, T = (DTE - S.wiDay) / 365;
    const pnl = (s, t) => (bs(s, p.k, t, p.iv, p.call) - p.prem) * 100 * p.n;
    const xs = Array.from({ length: 61 }, (_, i) => x0 + (x1 - x0) * i / 60);
    const exp = xs.map(s => pnl(s, 0)), cur = xs.map(s => pnl(s, T));
    const ymax = Math.max(...exp, ...cur, p.cost), ymin = -p.cost * 1.15;
    const X = s => 36 + (s - x0) / (x1 - x0) * (W - 46), Y = v => 10 + (ymax - v) / (ymax - ymin) * (H - 34);
    const line = arr => arr.map((v, i) => `${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const wy = pnl(S.wiPx, T);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">
      <rect x="36" y="${Y(0)}" width="${W - 46}" height="${Y(ymin) - Y(0)}" fill="color-mix(in srgb,var(--down) 6%,transparent)"/>
      <line x1="36" x2="${W - 10}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--edge)" stroke-width="1.5"/>
      <text x="4" y="${Y(0) + 3}">$0</text><text x="4" y="${Y(-p.cost) + 3}">${money(-p.cost)}</text>
      <line x1="36" x2="${W - 10}" y1="${Y(-p.cost)}" y2="${Y(-p.cost)}" stroke="var(--down)" stroke-dasharray="2 4" opacity=".6"/>
      <line x1="${X(18.62)}" x2="${X(18.62)}" y1="8" y2="${H - 22}" stroke="var(--c10)" stroke-width="2"/>
      <text x="${X(18.62) - 14}" y="${H - 8}">now 18.62</text>
      <line x1="${X(p.be)}" x2="${X(p.be)}" y1="8" y2="${H - 22}" stroke="var(--ink3)" stroke-dasharray="3 3"/>
      <text x="${X(p.be) - 22}" y="${H - 8}">break-even ${px2(p.be)}</text>
      <polyline points="${line(exp)}" fill="none" stroke="var(--ink3)" stroke-width="1.5" stroke-dasharray="4 4"/>
      <polyline points="${line(cur)}" fill="none" stroke="var(--c30)" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="${X(S.wiPx)}" cy="${Y(wy)}" r="5.5" fill="var(--card)" stroke="${wy >= 0 ? 'var(--up)' : 'var(--down)'}" stroke-width="2.5"/>
    </svg>`;
  },
  out() {
    const p = Engine.options(S.risk), T = (DTE - S.wiDay) / 365, v = bs(S.wiPx, p.k, T, p.iv, p.call), pl = (v - p.prem) * 100 * p.n;
    const d = new Date(2026, 10, 12 + S.wiDay); const ds = S.wiDay >= DTE ? 'Dec 19 (expiry)' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    $('#wiDayV').textContent = ds; $('#wiPxV').textContent = '$' + px2(S.wiPx);
    $('#wiOut').innerHTML = `If IREN is <b class="num">$${px2(S.wiPx)}</b> on <b>${ds}</b>, your ${p.n} ${p.call ? 'calls' : 'puts'} are worth about <b class="num">${money(v * 100 * p.n)}</b>.
      <div class="num ${pl >= 0 ? 'up' : 'down'}" style="font-size:22px;font-weight:600;margin-top:4px">${money(pl, true)}</div>`;
    $('#payoff').innerHTML = this.chart(p);
  },
  mount() {
    bindSeg('outSeg', v => { S.outlook = v; S.wiPx = v === 'bull' ? 21 : 16; render(); });
    $('#wiPx').oninput = e => { S.wiPx = +e.target.value; this.out(); };
    $('#wiDay').oninput = e => { S.wiDay = +e.target.value; this.out(); };
    $('#optLoad').onclick = () => { S.planKind = 'options'; S.plansReady = true; S.scenario = 'normal'; go('console'); };
    this.out();
  },
  async agent(first) {
    if (!first) return;
    await Dock.say(`Options are a bet with a fixed price. If you\u2019re wrong, the most you lose is the <em>${money(Engine.options(S.risk).cost)}</em> you paid. Drag the price and date to see what it could be worth.`);
    Dock.chips([{ t: 'What does break-even mean?', fn: () => Dock.say('If you hold to Dec 19, IREN needs to finish above <b>$' + px2(Engine.options(S.risk).be) + '</b> for you to make money. Before then you can sell earlier, and the blue line shows what it\u2019d be worth on that day.') }]);
  }
};

/* ============================== CONSOLE ============================== */
const SCEN = [
  ['normal', 'Normal: conditions fill in', 'var(--up)'], ['slip', 'Price 4¢ above trigger (within limit)', 'var(--c30)'], ['chase', 'Price ran 12¢ past entry', 'var(--warn)'],
  ['spread', 'Spread too wide', 'var(--warn)'], ['partial', 'Only part of the order fills', 'var(--c30)'], ['daily', 'Daily loss limit hit', 'var(--down)'],
  ['cooldown', 'Cooldown after a stop-out', 'var(--down)'], ['pdt', 'Day trades used up (3/3)', 'var(--down)'], ['gateway', 'IB Gateway disconnects', 'var(--down)'], ['agent', 'Agent tries to press Place', 'var(--c10)']
];
const PX_FOR = { normal: 18.85, slip: 18.89, chase: 18.97, spread: 18.86, partial: 18.86 };
SCREENS.console = {
  armed: null,
  sees: () => '<b>Activation console</b> · plan + conditions. The arm and place buttons are hidden from me.',
  plan() { return Engine[S.planKind](S.risk); },
  limit(p) { return +(p.entry + S.guard.chaseCents / 100).toFixed(2); },
  eval(p) {
    const g = S.guard, sc = S.scenario, locks = guardState().filter(b => b.lock).map(b => b.t.replace(/\.$/, ''));
    if (p.id === 'intraday' && g.pdtUsed >= g.pdtMax) locks.push('IBKR day-trade limit reached');
    if (p.id === 'options' && p.n === 0) locks.push('One contract exceeds your risk budget');
    if (S.risk > g.maxRisk) locks.push(`Risk is above your ${money(g.maxRisk)} per-trade limit`);
    // Before the trigger trades, a breakout entry can wait on IBKR's servers as a stop-limit instead of on us.
    const armMode = p.id === 'intraday' && (S.px < p.entry || !!this.armed);
    let conds;
    if (p.id === 'intraday') {
      const sp = sc !== 'spread';
      conds = [{ t: 'Opening high is set', v: '$18.85', st: 'ok' }, { t: 'Above the opening average (VWAP)', v: '$18.47', st: S.px > 18.47 ? 'ok' : 'bad' },
        { t: 'Spread is tight (3¢ or less)', v: sp ? '$0.02' : '$0.07', st: sp ? 'ok' : 'bad' },
        { t: armMode ? 'Breaks $18.85 · IBKR watches this for you' : 'Breaks $18.85', v: '$' + px2(S.px), st: S.px >= p.entry ? 'ok' : 'wt', ibkr: true }];
    } else conds = p.conds.map(c => ({ t: c[0], v: c[1], st: 'ok' }));
    let pre = null;
    if (p.id === 'intraday' && S.px > p.entry && !this.armed) {
      const over = Math.round((S.px - p.entry) * 100);
      if (over > g.chaseCents) { pre = { block: true, txt: `Price is <b>${over}¢ past</b> your entry. Orbit won\u2019t chase. Wait for a dip under $${px2(p.entry + g.chaseCents / 100)}, or drop the plan.` }; locks.push('Price ran past your entry'); }
      else if (over > 1) { const q = Math.floor(S.risk / (S.px - p.stop)); if (q < p.qty) pre = { adj: q, txt: `Price is ${over}¢ above your entry. Size trimmed <b>${p.qty} → ${q} shares</b> so you still risk at most ${money(S.risk)}.` }; }
    }
    return { conds, locks, pre, armMode, ready: !locks.length && conds.every(c => c.st === 'ok' || (armMode && c.ibkr && c.st === 'wt')) };
  },
  sends(p, qty, arm) {
    if (p.id === 'options' && p.n === 0) return ['No whole contract fits this risk budget', 'No order will be sent'];
    if (p.id === 'options') return [`Buy ${p.n} IREN Dec 19 $${p.k} ${p.call ? 'calls' : 'puts'}, paying no more than $${px2(p.prem)} each`, `Alert if premium reaches $${px2(p.tgtPrem)}; close manually`, 'Most you can lose: what you paid'];
    if (p.id === 'swing') return [`Buy ${qty} shares at $${px2(p.entry)} or better`, `Safety stop: sell all if it drops to $${px2(p.stop)}`, `Take profit: sell all at $${px2(p.targets[0].p)}`, 'Review automatically after 5 trading days'];
    const h = Math.floor(qty / 2);
    return [arm ? `Buy ${qty} shares the moment IREN trades $18.85, paying no more than $18.90. The order waits at IBKR, so it fills without waiting on you.` : `Buy ${qty} shares when IREN trades $18.85 (won\u2019t pay over $18.90)`,
      `Safety stop: sell all at $${px2(p.stop)}`, `Sell ${h} at $${px2(p.targets[0].p)}`, `Sell ${qty - h} at $${px2(p.targets[1].p)}`, 'Sell anything left at 3:55 PM'];
  },
  html() {
    const p = this.plan();
    const marks = p.id === 'options' ? [{ p: p.k, l: 'Strike', k: 'entry' }, { p: p.be, l: 'Break-even', k: p.call ? 'tgt' : 'stop' }] : [{ p: p.stop, l: 'Stop', k: 'stop' }, { p: p.entry, l: 'Buy', k: 'entry' }, ...p.targets.map(t => ({ p: t.p, l: t.label, k: 'tgt' }))];
    return `
    <div class="ph"><div><div class="row"><span class="bdg co">${p.name}</span><span class="faint" style="font-size:11.5px">${p.horizon}</span></div><h1 style="margin-top:6px">IREN · ${p.title}</h1></div>
      <button class="btn ghost" onclick="go('plans')">Back to plans</button></div>
    <div class="grid2" style="grid-template-columns:1.3fr 1fr">
      <div class="col gap14">
        <div class="card">
          <div class="row sb"><div class="row" style="gap:22px">
            <div><div class="lbl">You risk</div><div class="num down" style="font-size:24px;font-weight:600" id="cLoss">${money(-Math.min(p.loss, S.risk))}</div></div>
            <div><div class="lbl">You could make</div><div class="num up" style="font-size:24px;font-weight:600">${money(p.win, true)}</div></div></div>
            <div style="text-align:right"><div class="lbl">IREN now</div><div class="num" style="font-size:24px;font-weight:600" id="cPx">$${px2(S.px)}</div></div></div>
          ${rail({ min: p.id === 'options' ? 15.5 : p.min, max: p.id === 'options' ? 23.5 : p.max, now: S.px, marks, zones: p.id !== 'options', id: 'cRail' })}
        </div>
        <div class="card">
          <div class="row sb"><div class="h2">Waiting for</div><span class="faint" style="font-size:11.5px" id="cLeft"></span></div>
          <div class="conds mt14" id="cConds"></div>
          <div id="cPre"></div>
        </div>
      </div>
      <div class="col gap14">
        <div class="card" data-agent-confirm>
          <div class="h2">${p.id === 'options' ? 'Option plan' : 'One press sends all of this'}</div>
          <div class="col gap6 mt10" id="cSends" style="font-size:12.5px"></div>
          <div class="prob">${p.pro.map(x => `<span>${x[0]}</span><span>${x[1]}</span>`).join('')}<span>Pre-flight</span><span>Local, cached quotes · under 1 ms</span></div>
        </div>
        <div class="card" style="padding:12px">
          <button class="fire locked" id="fire" data-agent-hidden><span class="fill"></span><div class="t">Locked</div><div class="s"></div></button>
          <div class="row mt10" id="cIdle"><button class="btn sm" style="flex:1" onclick="go('plans')">Adjust</button><button class="btn sm ghost" style="flex:1" id="dropPlan">Drop plan</button></div>
          <div class="row mt10" id="cArmed" hidden><button class="btn sm danger" style="flex:1" id="cancelArm" data-agent-hidden>Cancel armed order <span class="kbd">Esc</span></button></div>
          <p class="faint" style="font-size:11px;margin-top:10px;text-align:center">Price, spread and buying-power checks use quotes Orbit already has, so they add no wait. Holding <span class="kbd">Space</span> works too.</p>
        </div>
      </div>
    </div>`;
  },
  paint() {
    const p = this.plan(), e = this.eval(p), f = $('#fire'); if (!f || f.classList.contains('sending') || f.classList.contains('live')) return;
    $('#cPx').textContent = '$' + px2(S.px); moveRail($('#cRail'), S.px);
    if (this.armed && S.gw) {
      const bad = e.locks[0] || e.conds.find(c => c.st === 'bad')?.t;
      if (bad) return this.cancelArm(`<b>Orbit pulled the armed order.</b> ${bad}.`);
      if (S.px >= p.entry && S.px <= this.limit(p)) return this.send(true);
    }
    if (f.classList.contains('holding')) return;
    const over = S.px > this.limit(p);
    const key = JSON.stringify([e.conds.map(c => c.st + c.v), e.locks, e.pre?.txt, !!this.armed, S.gw, over]);
    if (key === this.last) return; this.last = key;
    $('#cConds').innerHTML = e.conds.map(c => `<div class="cond ${c.st}"><i>${c.st === 'ok' ? '✓' : c.st === 'bad' ? '×' : ''}</i>${c.t}<span class="v">${c.v}</span></div>`).join('');
    const waiting = e.conds.filter(c => c.st !== 'ok').length;
    $('#cLeft').textContent = this.armed ? 'IBKR is watching' : waiting ? `${waiting} not met yet` : 'All met';
    let pre = e.pre;
    if (this.armed && !S.gw) pre = { block: true, txt: 'IB Gateway is offline. Your armed order is still at IBKR with its stop attached, so it can still fill. Orbit can\u2019t cancel it until the connection is back.' };
    else if (this.armed && over) pre = { block: false, txt: `IREN jumped past $${px2(this.limit(p))}. The order triggered but won\u2019t pay more than your limit, so nothing has filled. It fills only if the price comes back.` };
    $('#cPre').innerHTML = pre ? `<div class="bn ${pre.block ? 'warn' : 'info'} mt14" style="border-radius:10px;border:0">${pre.block ? ICON.diamond : ''}<span>${pre.txt}</span></div>` : '';
    const qty = this.armed ? this.armed.qty : e.pre?.adj ?? (p.id === 'options' ? p.n : p.qty);
    $('#cSends').innerHTML = this.sends(p, qty, e.armMode).map((s, i) => `<div class="row" style="align-items:flex-start;gap:9px"><span class="num faint" style="width:14px">${i + 1}</span><span>${s}</span></div>`).join('');
    $('#cIdle').hidden = !!this.armed; $('#cArmed').hidden = !this.armed;
    const unit = p.id === 'options' ? 'contracts' : 'sh', T = f.querySelector('.t'), sub = f.querySelector('.s');
    if (this.armed) { f.className = 'fire armed'; T.innerHTML = '<span class="pulse"></span>Armed at IBKR'; sub.textContent = `${qty} sh fill the moment IREN trades $18.85`; }
    else if (e.ready) {
      const lab = e.armMode ? 'Hold to arm at IBKR' : 'Hold to place this trade';
      f.className = 'fire ready'; T.innerHTML = lab; T.dataset.orig = lab;
      sub.textContent = e.armMode ? `${qty} sh · fills at $18.85 without waiting on you` : p.id === 'options' ? `${qty} contracts · entry only · max loss ${money(p.loss)}` : `${qty} ${unit} · risking ${money(Math.min(S.risk, p.loss))} · all orders at once`;
    } else { f.className = 'fire locked'; T.innerHTML = `${ICON.lk} ${e.locks.length ? 'Locked' : 'Not ready yet'}`; sub.textContent = e.locks[0] || `${waiting} condition${waiting > 1 ? 's' : ''} still missing`; }
    this.qty = qty;
  },
  place() { const e = this.eval(this.plan()); if (e.armMode && !this.armed) this.arm(); else this.send(false); },
  arm() {
    this.armed = { qty: this.qty }; S.armed = { tk: 'IREN', qty: this.qty }; this.last = null; this.paint(); navIndicator();
    toast(`<b>Armed at IBKR.</b> ${this.qty} shares buy the moment IREN trades $18.85.`, 'ok', 2400);
    Dock.say('Armed. The order is waiting on IBKR\u2019s servers, so it fills without waiting on you or the connection. I\u2019ll have Orbit pull it if a guardrail trips or the spread blows out.', 260);
  },
  cancelArm(msg) {
    if (!this.armed) return; this.armed = null; S.armed = null; this.last = null; this.paint(); navIndicator();
    toast(msg || 'Armed order cancelled. Nothing was bought.', 'info');
  },
  async send(fromArm) {
    const f = $('#fire'), p = this.plan(), qty = this.armed?.qty ?? this.qty;
    this.armed = null; S.armed = null;
    if (f) { f.className = 'fire sending'; f.querySelector('.t').textContent = fromArm ? 'Triggered at IBKR · filling…' : 'Sending to IBKR…'; f.querySelector('.s').textContent = ''; }
    await new Promise(r => setTimeout(r, 60)); // stands in for one gateway round trip
    const partial = S.scenario === 'partial' && p.id === 'intraday', px = p.id === 'intraday' ? 18.86 : p.id === 'swing' ? p.entry : p.prem;
    S.live = { plan: p, qty, qtyOpen: partial ? 400 : qty, avg: px, realized: 0, stop: p.stop, t1done: false, closed: false,
      partial: partial ? { filled: 400, of: qty } : null, forks: null, events: [{ tm: clockTxt(S.clock), tx: partial ? `Filled 400 of ${qty} shares at $18.86` : `Filled ${qty} ${p.id === 'options' ? 'contracts' : 'shares'} at $${px2(px)}${fromArm ? ' (armed order triggered at IBKR)' : ''}`, mc: 'var(--c30)' }, { tm: clockTxt(S.clock), tx: p.id === 'options' ? 'Long option position opened; no automatic target or stop was sent' : 'Stop and targets are live at IBKR (simulated in this prototype)', mc: 'var(--ink3)' }] };
    toast(partial ? '<b>Partly filled.</b> 400 of ' + qty + ' shares bought.' : `<b>You\u2019re in.</b> ${qty} ${p.id === 'options' ? 'contracts' : 'shares'} of IREN.`, partial ? 'info' : 'ok');
    navIndicator(); go('live');
  },
  setScenario(sc) {
    clearTimeout(this.breakT); S.scenario = sc; S.guard = BASE_GUARD(); S.gw = true; this.last = null; this.broke = true;
    if (sc === 'daily') S.guard.dailyUsed = 900;
    if (sc === 'cooldown') S.guard.cooldownLeft = 14;
    if (sc === 'pdt') S.guard.pdtUsed = 3;
    if (sc === 'gateway') S.gw = false;
    S.px = PX_FOR[sc] ?? 18.85;
    renderHeader(); this.paint();
    if (sc === 'agent') agentTryPlace();
    if (sc === 'gateway') Dock.say('IB Gateway dropped. I can\u2019t see live prices, so the console is locked. Your stop and targets for any open trade stay at IBKR either way.', 300);
    if (sc === 'chase') Dock.say('IREN ran past your entry. Chasing is one of your guardrails, so I won\u2019t suggest buying higher. If it dips back under $18.90 the button wakes up again.', 300);
  },
  mount() {
    this.last = null;
    if (!SCEN.some(s => s[0] === S.scenario)) S.scenario = 'normal';
    clearTimeout(this.breakT);
    this.broke = !(S.scenario === 'normal' && S.planKind === 'intraday');
    if (!this.broke) { S.px = 18.78; this.breakT = setTimeout(() => { this.broke = true; if (S.route === 'console') { S.px = 18.85; this.paint(); } }, rm() ? 0 : 2600); }
    else S.px = PX_FOR[S.scenario] ?? 18.86;
    holdToPlace($('#fire'), { onDone: () => this.place() });
    $('#dropPlan').onclick = () => { S.plansReady = true; toast('Plan dropped. Nothing was sent.', 'info'); go('plans'); };
    $('#cancelArm').onclick = () => this.cancelArm();
    onTick(() => {
      if (!this.broke) S.px = +(18.76 + Math.random() * .06).toFixed(2);
      else S.px = +((PX_FOR[S.scenario] ?? 18.85) + (Math.random() < .5 ? 0 : .01)).toFixed(2);
      this.paint();
    });
    this.paint();
    simPanel('Scenario simulator', SCEN, sc => this.setScenario(sc), S.scenario);
  },
  key(e) {
    if (e.key === ' ') { if (!e.repeat) $('#fire')?._hold?.start(e); return true; }
    if (e.key === 'Escape' && this.armed) { this.cancelArm(); return true; }
  },
  keyup(e) { if (e.key === ' ') { e.preventDefault(); $('#fire')?._hold?.stop(); } },
  async agent() {
    const p = this.plan();
    await Dock.say(p.id === 'intraday'
      ? `Loaded your <b>${p.name}</b> plan. You can arm it now: IBKR holds the order and fills it the instant IREN trades $18.85, so nothing waits on you. <b>Only you</b> can arm or place it.`
      : `Loaded your <b>${p.name}</b> plan. When the conditions are green the button wakes up, and <b>only you</b> can hold it to place the trade.`, 380);
    Dock.chips([{ t: 'Place it for me', silent: true, fn: () => agentTryPlace() }, { t: 'What if it gaps past my entry?', fn: () => Dock.say(`Orbit won\u2019t chase. This plan is sized for the $18.90 limit; it will not pay more. If price moves beyond the limit, the order will not fill.`) }]);
  }
};

/* ============================== LIVE ============================== */
const live = () => S.live;
const livePnl = L => L.plan.id === 'options' ? L.realized + (bs(S.px, L.plan.k, DTE / 365, L.plan.iv, L.plan.call) - L.plan.prem) * 100 * L.qtyOpen : L.realized + (S.px - L.avg) * L.qtyOpen;
const worst = L => L.plan.id === 'options' ? L.realized - L.plan.prem * 100 * L.qtyOpen : L.realized + (L.stop - L.avg) * L.qtyOpen;
const REASONS = ['Support is just below', 'Stop sits inside normal noise', 'News is moving it'];
SCREENS.live = {
  sees: () => S.live ? '<b>Live trade</b> · P&L, events, suggestions. Every order control is hidden from me.' : '<b>Live</b> · no open trades',
  html() {
    const L = live();
    if (!L) return `<div class="ph"><div><h1>Live</h1><p>Open trades show up here.</p></div></div><div class="empty">Nothing live right now.<div class="mt10"><button class="btn pri" id="demoLive">Start a demo trade</button></div></div>`;
    const p = L.plan, mins = 15 * 60 + 55 - S.clock, opt = p.id === 'options';
    const canLock = !opt && L.stop < L.avg && S.px > L.avg + .05;
    const marks = opt ? [{ p: p.k, l: 'Strike', k: 'entry' }, { p: p.be, l: 'Break-even', k: 'tgt' }]
      : [{ p: L.stop, l: L.stop >= L.avg ? 'Stop (at entry)' : 'Stop', k: 'stop', id: 'stop' }, { p: L.avg, l: 'Filled', k: 'entry' }, ...p.targets.map((t, i) => { const done = i === 0 && L.t1done; return { p: t.p, l: t.label, k: 'tgt', done, id: done ? null : 't' + i }; })];
    return `
    <div class="ph"><div><div class="row"><span class="bdg ${L.closed ? '' : 'ok'}"><span class="ci"></span>${L.closed ? 'Closed' : 'Live'}</span><span class="bdg co">${p.name}</span>
      ${p.id === 'intraday' && !L.closed ? `<span class="bdg mono" id="lClock">Auto-exit 3:55 PM · in ${Math.floor(mins / 60)}h ${mins % 60}m</span>` : ''}</div>
      <h1 style="margin-top:6px">IREN · ${p.title}</h1></div>
      <div class="row"><button class="btn ghost" id="awayBtn">While you were away</button></div></div>
    <div id="awayBox"></div>
    ${L.partial ? `<div class="card" style="border-color:color-mix(in srgb,var(--c30) 50%,var(--edge));margin-bottom:14px"><div class="row sb"><div><div class="h3">Only part of your order filled</div>
      <div class="mut" style="font-size:12.5px;margin-top:2px">Bought <b>${L.partial.filled}</b> of ${L.partial.of} shares at $18.86. ${L.partial.of - L.partial.filled} are still waiting at $18.85–18.90. Your risk right now is <b class="num">${money(L.partial.filled * (L.avg - L.stop))}</b>, not ${money(S.risk)}.</div></div>
      <div class="row"><button class="btn sm" id="pWait">Keep waiting until 11:00</button><button class="btn sm pri" id="pCancel" data-agent-hidden>Cancel the rest <span class="kbd">C</span></button></div></div></div>` : ''}
    <div class="grid2" style="grid-template-columns:1.4fr 1fr">
      <div class="col gap14">
        <div class="card">
          <div class="row sb" style="align-items:flex-end">
            <div><div class="lbl">${L.closed ? 'Result' : 'Right now'}</div><div class="num" id="lPnl" style="font-size:34px;font-weight:600;letter-spacing:-.04em">—</div>
              <div class="mut" style="font-size:12px" id="lSub"></div></div>
            <div style="text-align:right"><div class="lbl">Worst case from here</div><div class="num" id="lWorst" style="font-size:18px;font-weight:600"></div><div class="faint" style="font-size:11px" id="lWorstSub"></div></div>
          </div>
          ${rail({ min: opt ? 15.5 : Math.min(p.min, L.stop - .2), max: opt ? 23.5 : p.max, now: S.px, marks, id: 'lRail' })}
          ${L.closed ? `<div class="row"><button class="btn pri" onclick="go('review')">Review this trade</button><button class="btn ghost" id="clearLive">Clear</button></div>` : `
          <div class="row" style="flex-wrap:wrap">
            <button class="btn" id="tighten" data-agent-hidden ${opt ? 'disabled' : ''}>Tighten stop <span class="kbd">T</span></button>
            ${canLock ? '<button class="btn" id="lockBtn" data-agent-hidden>Stop to entry <span class="kbd">L</span></button>' : ''}
            <button class="btn ghost" id="widen" data-agent-hidden ${opt ? 'disabled' : ''}>Widen stop… <span class="kbd">W</span></button>
            <div style="flex:1"></div>
            <button class="btn danger" id="exitNow" data-agent-hidden>Exit now <span class="kbd">⇧E</span></button>
          </div>
          <div id="widenBox"></div>
          ${opt ? '' : '<p class="faint" style="font-size:11px;margin-top:10px">Drag the stop or a target on the rail to move it. Dragging the stop down opens the widen check.</p><p class="pro faint" style="font-size:11px;margin-top:4px">Tighten, drag and lock send one modify to the live stop order (same order ID), never cancel-and-replace, so the position is never unprotected.</p>'}`}
        </div>
        <div id="forks"></div>
      </div>
      <div class="card"><div class="row sb"><div class="h2">What happened</div><span class="faint" style="font-size:11px">newest first</span></div>
        <div class="tl mt14" id="lEvents">${L.events.map(e => `<div class="e" style="--mc:${e.mc}"><div class="tm">${e.tm}</div><div class="tx">${e.tx}</div></div>`).join('')}</div></div>
    </div>`;
  },
  num() {
    const L = live(); if (!L || !$('#lPnl') || this.dragging) return;
    const v = livePnl(L), w = worst(L);
    const el = $('#lPnl'); el.textContent = (v >= 0 ? 'Up ' : 'Down ') + money(Math.abs(v)); el.className = 'num ' + (v >= 0 ? 'up' : 'down');
    $('#lSub').textContent = L.closed ? 'Trade closed' : `${L.qtyOpen} ${L.plan.id === 'options' ? 'contracts' : 'shares'} open · avg $${px2(L.avg)}${L.realized ? ` · ${money(L.realized, true)} locked in` : ''}`;
    $('#lWorst').textContent = L.closed ? '—' : money(w, true); $('#lWorst').className = 'num ' + (w >= 0 ? 'up' : 'down');
    $('#lWorstSub').textContent = L.closed ? '' : w >= 0 ? 'At/above entry by plan; gaps or slippage can still lose' : 'if the stop is hit; gaps can exceed the estimate';
    moveRail($('#lRail'), S.px);
    const mins = 15 * 60 + 55 - S.clock; if ($('#lClock')) $('#lClock').textContent = `Auto-exit 3:55 PM · in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  },
  event(tx, mc = 'var(--ink3)') { const L = live(); L.events.unshift({ tm: clockTxt(S.clock), tx, mc }); const box = $('#lEvents'); if (box) box.insertAdjacentHTML('afterbegin', `<div class="e" style="--mc:${mc}"><div class="tm">${clockTxt(S.clock)}</div><div class="tx">${tx}</div></div>`); },
  forks(title, why, opts) {
    const L = live(); L.forks = { title, why, opts, left: 45 }; this.paintForks();
  },
  paintForks() {
    const L = live(), F = L?.forks, box = $('#forks'); if (!box) return;
    if (!F) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="card" style="animation:stgIn var(--dur) var(--ease)">
      <div class="row sb"><div><div class="h2">${F.title}</div><div class="mut" style="font-size:12px;margin-top:2px">${F.why} One click applies.</div></div><span class="bdg mono" id="fLeft">Keeps plan in ${F.left}s</span></div>
      <div class="grid3 mt14" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${F.opts.map((o, i) => `
        <button class="fork ${o.id === 'keep' ? 'def' : ''}" data-f="${o.id}" ${o.id === 'keep' ? '' : 'data-agent-hidden'}>
          <span class="kbd">${i + 1}</span>
          <div>${o.id === 'keep' ? '<span class="bdg co">Default</span>' : o.rec ? '<span class="bdg">Agent pick</span>' : '<span class="bdg" style="visibility:hidden">·</span>'}</div>
          <b style="font-size:13px">${o.t}</b>
          <div class="mut" style="font-size:12px">${o.d}</div>
          <div class="num ${o.n >= 0 ? 'up' : 'down'}" style="font-size:12px;font-weight:600">${o.nt}</div>
          ${o.id === 'keep' ? `<span class="exp" style="width:${F.left / 45 * 100}%"></span>` : ''}
        </button>`).join('')}</div></div>`;
    $$('.fork', box).forEach(el => el.onclick = () => this.applyFork(el.dataset.f));
  },
  applyFork(id) {
    const L = live(); if (!L?.forks) return; const o = L.forks.opts.find(x => x.id === id); if (!o) return; L.forks = null; this.paintForks();
    o.fx && o.fx(); if (id === 'keep') this.event('Kept the plan', 'var(--ink3)'); render();
  },
  closeTrade(reason) {
    const L = live(); L.realized = livePnl(L); L.qtyOpen = 0; L.closed = true; L.forks = null; L.partial = null;
    if (L.realized < 0) { S.guard.dailyUsed = Math.min(S.guard.dailyLimit, S.guard.dailyUsed + Math.round(-L.realized)); }
    this.event(`${reason} · result ${money(L.realized, true)}`, L.realized >= 0 ? 'var(--up)' : 'var(--down)'); renderHeader();
  },
  open() { const L = live(); return L && !L.closed ? L : null; },
  tighten() {
    const L = this.open(); if (!L || L.plan.id === 'options') return;
    const ns = +(S.px - L.avg > .3 && L.stop < L.avg ? L.avg : L.stop + .2).toFixed(2);
    if (ns >= S.px - .05) return toast('Too close to the price to tighten further.', 'warn');
    L.stop = ns; this.event(`Stop tightened to $${px2(ns)}`, 'var(--c30)'); render(); toast(`Stop raised to $${px2(ns)}. Worst case now ${money(worst(L), true)}.`);
  },
  lockStop() {
    const L = this.open(); if (!L || L.plan.id === 'options') return;
    if (L.stop >= L.avg) return toast('Your stop is already at or above your entry.', 'info', 2000);
    if (S.px <= L.avg + .05) return toast('Price is too close to your entry to move the stop there.', 'warn');
    L.stop = L.avg; this.event(`Stop moved to entry $${px2(L.avg)}`, 'var(--c30)'); render(); toast('<b>Stop moved to entry.</b>');
  },
  exit() { if (!this.open()) return; this.closeTrade('Exited at market'); render(); toast('Exited at market. Working orders cancelled.', 'info'); },
  cancelRest() { const L = this.open(); if (!L?.partial) return; const n = L.partial.of - L.partial.filled; L.qty = L.qtyOpen; L.partial = null; this.event(`Cancelled the ${n} unfilled shares`, 'var(--ink3)'); render(); },
  t1() {
    const L = live(); if (!L || L.t1done || L.plan.id !== 'intraday') return;
    const t = L.plan.targets[0], q = Math.min(t.qty, L.qtyOpen), got = q * (t.p - L.avg);
    S.px = t.p; L.t1done = true; L.realized += got; L.qtyOpen -= q;
    this.event(`Target 1 hit · sold ${q} at $${px2(t.p)} · ${money(got, true)}`, 'var(--up)');
    toast(`<b>Target 1 hit · ${money(got, true)} locked in.</b>`, 'ok');
    render();
    this.forks('Target 1 hit. What now?', 'Half is sold. Pick what happens to the rest, or do nothing and the plan carries on.', [
      { id: 'keep', t: 'Keep plan', d: `Hold ${L.qtyOpen} shares for $${px2(L.plan.targets[1].p)}. Stop stays at $${px2(L.stop)}.`, n: worst(L), nt: `Worst case ${money(worst(L), true)}` },
      { id: 'lock', rec: true, t: 'Stop to entry', d: 'Move your stop to your entry price. A gap or slippage can still cause a loss.', n: L.realized, nt: `Planned stop result ${money(L.realized, true)}`, fx: () => { L.stop = L.avg; this.event(`Stop moved to entry $${px2(L.avg)}. A gap or slippage can still cause a loss.`, 'var(--c30)'); toast('<b>Stop moved to entry.</b> A gap or slippage can still cause a loss.'); } },
      { id: 'exit', t: 'Exit now', d: `Sell the remaining ${L.qtyOpen} shares at market (~$${px2(S.px)}).`, n: 1, nt: `Locks ${money(L.realized + (S.px - L.avg) * L.qtyOpen, true)}`, fx: () => this.closeTrade('Exited the rest at market') }
    ]);
    Dock.say(`<b>Target 1 hit.</b> Sold ${q} shares for <em>${money(got, true)}</em>. I put three options on screen, one click each. If you do nothing, Orbit keeps the plan.`, 300);
  },
  nearStop() {
    const L = live(); if (!L || L.closed) return; S.px = +(L.stop + .11).toFixed(2); this.num();
    this.event(`Price dropped to $${px2(S.px)}, 11¢ above your stop`, 'var(--warn)');
    this.forks('Getting close to your stop', 'Volume is light on the drop, so this could be noise. I won\u2019t suggest widening the stop.', [
      { id: 'keep', t: 'Keep plan', d: `Your stop at $${px2(L.stop)} handles it if it keeps falling.`, n: worst(L), nt: `Worst case ${money(worst(L), true)}` },
      { id: 'exit', t: 'Exit now', d: `Sell ${L.qtyOpen} shares at ~$${px2(S.px)} instead of waiting for the stop.`, n: L.realized + (S.px - L.avg) * L.qtyOpen, nt: `About ${money(L.realized + (S.px - L.avg) * L.qtyOpen, true)}`, fx: () => this.closeTrade('Exited early, before the stop') }
    ]);
    Dock.say('IREN is <b>11¢</b> above your stop. That\u2019s what the stop is for, so keeping the plan is fine. If you\u2019d rather be out, exiting now saves a little.', 300);
  },
  volume() {
    const L = live(); if (!L || L.closed) return; S.px = +(S.px + .25).toFixed(2); this.num();
    const q = Math.floor(L.qty / 4);
    this.event('Volume spike: 3× normal in one minute', 'var(--c30)');
    this.forks('Big volume just came in', 'Spikes like this often mark a short-term top or a push higher. Either way, protecting some gain is reasonable.', [
      { id: 'keep', t: 'Keep plan', d: 'Let the targets do the work.', n: 1, nt: 'No change' },
      { id: 'trail', rec: true, t: 'Trail the stop', d: `Raise the stop to 30¢ under the price ($${px2(S.px - .3)}) and keep raising it.`, n: 1, nt: `Worst case ${money(L.realized + (S.px - .3 - L.avg) * L.qtyOpen, true)}`, fx: () => { L.stop = Math.max(L.stop, +(S.px - .3).toFixed(2)); this.event(`Trailing stop on · now $${px2(L.stop)}`, 'var(--c30)'); } },
      { id: 'quarter', t: `Sell ${q} more`, d: 'Take another quarter off at market.', n: 1, nt: `Locks ${money(q * (S.px - L.avg), true)}`, fx: () => { L.realized += q * (S.px - L.avg); L.qtyOpen -= q; this.event(`Sold ${q} at $${px2(S.px)}`, 'var(--up)'); } }
    ]);
    Dock.say('Volume just tripled. I\u2019d trail the stop so a reversal can\u2019t take back much, but keeping the plan is the default.', 300);
  },
  checkpoint() {
    const L = live(); if (!L || L.closed) return; S.clock = 15 * 60 + 45; this.num();
    this.event('3:45 PM checkpoint · 10 minutes to the automatic exit', 'var(--ink3)');
    this.forks('10 minutes left in the day', 'Intraday plans never hold overnight. Orbit sells whatever\u2019s left at 3:55 PM.', [
      { id: 'keep', t: 'Keep plan', d: 'Hold until the 3:55 PM exit.', n: 1, nt: 'Auto-exit 3:55 PM' },
      { id: 'exit', t: 'Exit now', d: `Sell ${L.qtyOpen} shares now.`, n: 1, nt: `Locks ${money(livePnl(L), true)}`, fx: () => this.closeTrade('Exited at the 3:45 checkpoint') }
    ]);
  },
  stopOut() {
    const L = live(); if (!L || L.closed) return; S.px = L.stop; this.closeTrade(`Stopped out at $${px2(L.stop)}`);
    if (L.realized < 0) S.guard.cooldownLeft = S.guard.cooldownMin; renderHeader(); render();
    toast(`<b>Stopped out · ${money(L.realized, true)}.</b> Cooldown ${S.guard.cooldownMin} min.`, L.realized < 0 ? 'err' : 'ok');
    Dock.say(L.realized < 0 ? `Stopped out for <b>${money(L.realized, true)}</b>. That\u2019s the plan working: you lost what you planned, not more. New trades unlock after a ${S.guard.cooldownMin}-minute cooldown.` : 'Stopped out at your entry, so this one finished at about break-even plus what you locked in.', 300);
  },
  away() { S.awayOpen = true; if (S.route !== 'live') go('live'); else this.paintAway(); },
  paintAway() {
    const b = $('#awayBox'); if (!b) return;
    if (!S.awayOpen) { b.innerHTML = ''; return; }
    b.innerHTML = `<div class="card awayc"><div class="row sb" style="align-items:flex-start"><div><div class="lbl">While you were away · 38 min</div><div class="h2" style="font-size:16px;margin-top:3px">IREN is up <span class="up num">+$540</span> and the plan is on track</div></div>
      <button class="btn sm ghost" id="awayX">Got it <span class="kbd">Esc</span></button></div>
      <div class="away mt10">${[['10:03', 'Filled 588 shares at $18.86'], ['10:19', 'Target 1 hit · sold 294 at $19.85 · <span class="up num">+$291</span>'], ['10:20', 'I suggested moving the stop to entry. You didn\u2019t answer, so the original plan stayed in place.'], ['10:36', 'High of the day so far: $20.12'], ['10:41', 'Now $19.60 · stop still at $18.05 · 3:55 PM exit set']].map(x => `<div class="it"><span class="tm">${x[0]}</span><span>${x[1]}</span></div>`).join('')}</div></div>`;
    $('#awayX').onclick = () => { S.awayOpen = false; this.paintAway(); };
  },
  widen(pre) {
    const L = this.open(), g = S.guard, box = $('#widenBox'); if (!box || !L || L.plan.id === 'options') return;
    const v = +(pre ?? L.stop - .05).toFixed(2), lo = +Math.min(L.stop - .6, v - .1).toFixed(2);
    box.innerHTML = `<div class="widen mt14">
      <div class="row sb" style="align-items:flex-start"><div><div class="h3">Widen your stop</div><div class="mut" style="font-size:12px;margin-top:2px">You\u2019d be willing to lose more than you planned. It has to fit your limits and needs a reason.</div></div>
        <button class="btn sm ghost" id="wX">Cancel <span class="kbd">Esc</span></button></div>
      <div class="grid2 mt10" style="grid-template-columns:1fr 1fr;gap:14px;align-items:center">
        <div class="field"><label>New stop <span class="num" id="wV" style="float:right;color:var(--ink)"></span></label><input type="range" id="wS" min="${lo}" max="${px2(L.stop)}" step="0.01" value="${px2(v)}"></div>
        <div class="well" id="wOut" style="font-size:12.5px"></div></div>
      <div class="field mt10"><label>Why? (saved to your journal)</label>
        <div class="row" style="flex-wrap:wrap;gap:6px">${REASONS.map(r => `<button class="rchip" data-r="${r}">${r}</button>`).join('')}</div>
        <input class="inp" id="wR" placeholder="or type your own"></div>
      <button class="fire small locked" id="wGo" data-agent-hidden style="margin-top:10px"><span class="fill"></span><div class="t">Hold to widen</div></button></div>`;
    const upd = () => {
      const ns = +$('#wS').value, loss = L.qtyOpen * (L.avg - ns) - L.realized, over = loss > g.maxRisk + .5, ok = !over && $('#wR').value.trim().length >= 8;
      $('#wV').textContent = '$' + px2(ns);
      $('#wOut').innerHTML = `Max loss goes from <b class="num">${money(L.qtyOpen * (L.avg - L.stop) - L.realized)}</b> to <b class="num ${over ? 'down' : ''}">${money(loss)}</b>.` + (over ? `<div class="down" style="margin-top:4px;font-weight:600">Blocked: above your ${money(g.maxRisk)} per-trade limit.</div>` : '');
      $('#wGo').className = 'fire small ' + (ok ? 'ready' : 'locked');
    };
    $('#wS').oninput = upd; $('#wR').oninput = () => { $$('.rchip', box).forEach(x => x.classList.remove('on')); upd(); };
    $$('.rchip', box).forEach(b => b.onclick = () => { $('#wR').value = b.dataset.r; $$('.rchip', box).forEach(x => x.classList.toggle('on', x === b)); upd(); });
    $('#wX').onclick = () => this.closeWiden();
    holdToPlace($('#wGo'), { onDone: () => { const ns = +$('#wS').value; L.stop = ns; this.event(`Stop widened to $${px2(ns)} · “${$('#wR').value.trim()}”`, 'var(--warn)'); render(); toast(`Stop widened to $${px2(ns)}.`, 'warn'); } });
    upd();
  },
  closeWiden() { const b = $('#widenBox'); if (b) b.innerHTML = ''; },
  bindDrag() {
    const L = live(), r = $('#lRail'); if (!r || L.closed || L.plan.id === 'options') return;
    const min = +r.dataset.min, max = +r.dataset.max, track = $('.track', r), pct = v => clamp((v - min) / (max - min) * 100, 0, 100);
    $$('.mk[data-id]', r).forEach(mk => {
      const id = mk.dataset.id; mk.classList.add('drag'); mk.setAttribute('data-agent-hidden', '');
      mk.title = id === 'stop' ? 'Drag to move your stop' : 'Drag to move this target';
      mk.addEventListener('pointerdown', e => {
        e.preventDefault(); mk.setPointerCapture?.(e.pointerId); mk.classList.add('dragging'); this.dragging = true;
        const box = track.getBoundingClientRect(); let val = null, done = false;
        const mv = ev => {
          const raw = +(min + clamp((ev.clientX - box.left) / box.width, 0, 1) * (max - min)).toFixed(2);
          val = id === 'stop' ? Math.min(raw, +(S.px - .05).toFixed(2)) : Math.max(raw, +(S.px + .01).toFixed(2));
          mk.style.left = pct(val) + '%'; $('b', mk).textContent = px2(val);
          if (id === 'stop') { const w = L.realized + (val - L.avg) * L.qtyOpen; $('#lWorst').textContent = money(w, true); $('#lWorst').className = 'num ' + (w >= 0 ? 'up' : 'down'); }
        };
        const up = () => { if (done) return; done = true; mk.removeEventListener('pointermove', mv); mk.classList.remove('dragging'); this.dragging = false; if (val != null) this.dropMark(id, val); };
        mk.addEventListener('pointermove', mv); mk.addEventListener('pointerup', up, { once: true }); mk.addEventListener('pointercancel', up, { once: true });
      });
    });
  },
  dropMark(id, v) {
    const L = this.open(); if (!L) return;
    if (id === 'stop') {
      if (Math.abs(v - L.stop) < .005) return render();
      if (v > L.stop) { L.stop = v; this.event(`Stop raised to $${px2(v)}`, 'var(--c30)'); render(); return toast(`Stop raised to $${px2(v)}. Worst case now ${money(worst(L), true)}.`); }
      render(); return this.widen(v);
    }
    const i = +id.slice(1), t = L.plan.targets[i]; if (!t) return;
    t.p = v; this.event(`${t.label === 'Target' ? 'Target' : 'Target ' + (i + 1)} moved to $${px2(v)}`, 'var(--up)'); render(); toast(`Target moved to $${px2(v)}.`);
  },
  key(e) {
    const L = this.open(); if (!L) return; const k = e.key;
    if (k === 'Escape') {
      if ($('#widenBox')?.innerHTML) { this.closeWiden(); return true; }
      if (L.forks) { this.applyFork('keep'); return true; }
      if (S.awayOpen) { S.awayOpen = false; this.paintAway(); return true; }
      return;
    }
    if (e.shiftKey && k.toLowerCase() === 'e') { this.exit(); return true; }
    if (e.shiftKey) return;
    const a = { t: () => this.tighten(), l: () => this.lockStop(), w: () => this.widen(), c: () => this.cancelRest() }[k.toLowerCase()];
    if (a) { a(); return true; }
    if (L.forks && /^[1-9]$/.test(k)) { const o = L.forks.opts[+k - 1]; if (o) { this.applyFork(o.id); return true; } }
  },
  mount() {
    const L = live();
    if (!L) { $('#demoLive').onclick = () => { S.planKind = 'intraday'; S.plansReady = true; const p = Engine.intraday(S.risk); S.live = { plan: p, qty: p.qty, qtyOpen: p.qty, avg: 18.86, realized: 0, stop: p.stop, t1done: false, closed: false, partial: null, forks: null, events: [{ tm: clockTxt(S.clock), tx: `Filled ${p.qty} shares at $18.86`, mc: 'var(--c30)' }] }; S.px = 19.1; render(); }; $('#sim')?.remove(); return; }
    this.dragging = false;
    this.num(); this.paintForks(); this.paintAway(); this.bindDrag();
    $('#awayBtn').onclick = () => { S.awayOpen = !S.awayOpen; this.paintAway(); };
    if ($('#clearLive')) $('#clearLive').onclick = () => { S.live = null; render(); };
    if ($('#tighten')) $('#tighten').onclick = () => this.tighten();
    if ($('#lockBtn')) $('#lockBtn').onclick = () => this.lockStop();
    if ($('#widen')) $('#widen').onclick = () => this.widen();
    if ($('#exitNow')) $('#exitNow').onclick = () => this.exit();
    if ($('#pCancel')) $('#pCancel').onclick = () => this.cancelRest();
    if ($('#pWait')) $('#pWait').onclick = () => { L.partial = null; L.qtyOpen = L.qty; this.event(`The rest filled: ${L.qty} shares at $18.87`, 'var(--c30)'); render(); };
    onTick(() => {
      if (L.closed || this.dragging) return;
      if (L.plan.id === 'intraday' && !L.t1done && S.px >= L.plan.targets[0].p) return this.t1();
      if (L.plan.id !== 'options' && S.px <= L.stop) return this.stopOut();
      this.num();
      if (L.forks) { L.forks.left--; if ($('#fLeft')) $('#fLeft').textContent = `Keeps plan in ${Math.max(0, L.forks.left)}s`; const ex = $('.fork.def .exp'); if (ex) ex.style.width = Math.max(0, L.forks.left / 45 * 100) + '%';
        if (L.forks.left <= 0) { L.forks = null; this.event('No answer, so the plan carried on', 'var(--ink3)'); render(); } }
    });
    if (!L.closed) simPanel('Live events', [['t1', 'Target 1 hits', 'var(--up)'], ['near', 'Price nears the stop', 'var(--warn)'], ['vol', 'Volume spike', 'var(--c30)'], ['cp', '3:45 PM checkpoint', 'var(--ink3)'], ['stop', 'Stopped out', 'var(--down)'], ['away', 'While you were away', 'var(--c30)']],
      k => ({ t1: () => this.t1(), near: () => this.nearStop(), vol: () => this.volume(), cp: () => this.checkpoint(), stop: () => this.stopOut(), away: () => this.away() })[k]());
    else $('#sim')?.remove();
  },
  async agent(first) {
    const L = live(); if (!L || L.closed) return;
    if (first) await Dock.say(`You\u2019re in. I only speak up when something happens: a fill, a target, the price nearing your stop, a volume spike, or the 3:45 checkpoint. When I do, I\u2019ll give you two or three choices, one click each, and <b>Keep plan</b> is always the default.`, 400);
  },
  reply(t) { const L = live(); if (L && !L.closed && /stop|tight|protect/i.test(t)) { Dock.touch('#tighten'); return Dock.say('Tightening is one tap or the <b>T</b> key (highlighted). You can also drag the stop on the rail. Widening needs a reason and has to fit your limits.'); } return Dock.say('I\u2019m watching the trade. Ask me about the stop, the targets, or what the 3:55 PM exit does.'); }
};

/* ============================== REVIEW ============================== */
const TRADES = [
  { d: 'Today', tk: 'IREN', ty: 'Intraday', r: 612, plan: true }, { d: 'Nov 11', tk: 'AMD', ty: 'Intraday', r: -250, plan: true },
  { d: 'Nov 10', tk: 'NVDA', ty: 'Swing', r: 1140, plan: true }, { d: 'Nov 7', tk: 'PLTR', ty: 'Options', r: -480, plan: false },
  { d: 'Nov 6', tk: 'HOOD', ty: 'Intraday', r: 330, plan: true }, { d: 'Nov 5', tk: 'TSLA', ty: 'Intraday', r: -500, plan: false }
];
const STORY = {
  IREN: [['10:03', 'Bought 588 shares at $18.86 when it broke the opening high.', 'var(--c30)'], ['10:19', 'Target 1 hit. Sold 294 at $19.85 for +$291.', 'var(--up)'], ['10:20', 'You moved the stop to $18.86. A gap or slippage could still cause a loss.', 'var(--c30)'], ['11:52', 'Sold the last 294 at $19.83 when momentum faded, for +$285.', 'var(--up)']],
  AMD: [['09:48', 'Bought 400 shares at $153.40 on a breakout.', 'var(--c30)'], ['10:06', 'It reversed. The stop sold everything at $152.78 for −$250, exactly as planned.', 'var(--down)']],
  TSLA: [['10:41', 'Bought at $412.30, 18¢ above the planned entry.', 'var(--warn)'], ['10:44', 'You widened the stop once.', 'var(--warn)'], ['11:10', 'Stopped out for −$500, more than the $350 you planned.', 'var(--down)']]
};
const LESSONS = [['You lose more after 10:30 AM. 4 of your 5 late entries were losses.', true], ['When you widened a stop, you lost more than planned 3 times out of 3.', true], ['Your swing trades make 2.1× more per dollar risked than intraday.', false]];
SCREENS.review = {
  sees: () => '<b>Review</b> · your trade log, journal',
  sel: 'IREN',
  html() {
    return `
    <div class="ph"><div><h1>Review</h1><p>Every trade told as a story, so you can see what worked without digging through fills.</p></div>
      <div class="row"><span class="faint" style="font-size:11.5px" id="flexTxt">Review uses Orbit's own trade log · older-trade import is a later feature</span><button class="btn sm" id="syncBtn" disabled title="Not in v1">Flex import · later</button></div></div>
    ${this.tradesHtml()}`;
  },
  tradesHtml() {
    const t = TRADES.find(x => x.tk === this.sel), st = STORY[this.sel] || [['—', 'Orbit will show this trade\u2019s story once its fills are in Orbit\u2019s trade log.', 'var(--ink3)']];
    return `
    <div class="grid3">
      <div class="card"><div class="lbl">Last 20 trades</div><div class="strip mt10">${'wwlwwllwwlwwlwwwlwlw'.split('').map(c => `<i class="${c}"></i>`).join('')}</div><div class="mut mt10" style="font-size:12px"><b class="num" style="color:var(--ink)">13</b> wins · <b class="num" style="color:var(--ink)">7</b> losses</div></div>
      <div class="card"><div class="lbl">Average win vs loss</div><div class="row mt10" style="gap:16px"><span class="num up" style="font-size:22px;font-weight:600">+$612</span><span class="num down" style="font-size:22px;font-weight:600">−$274</span></div><div class="mut" style="font-size:12px">Your wins are 2.2× your losses</div></div>
      <div class="card"><div class="lbl">Followed the plan</div><div class="num mt10" style="font-size:22px;font-weight:600">17 / 20</div><div class="mut" style="font-size:12px">The 3 you didn\u2019t follow lost <b class="num down">−$1,230</b></div></div>
    </div>
    <div class="grid2 mt14" style="grid-template-columns:1fr 1.2fr">
      <div class="card" style="padding:8px 8px 4px"><table class="tbl" id="trTbl"><tr><th>Date</th><th>Ticker</th><th>Type</th><th style="text-align:right">Result</th><th>Plan</th></tr>
        ${TRADES.map(x => `<tr class="click ${x.tk === this.sel ? 'on' : ''}" data-tk="${x.tk}"><td class="mut">${x.d}</td><td><b>${x.tk}</b></td><td class="mut">${x.ty}</td><td class="num ${x.r >= 0 ? 'up' : 'down'}" style="text-align:right;font-weight:600">${money(x.r, true)}</td><td>${x.plan ? '<span class="bdg ok"><span class="ci"></span>Followed</span>' : '<span class="bdg warn"><span class="dm"></span>Broke it</span>'}</td></tr>`).join('')}</table></div>
      <div class="card">
        <div class="row sb"><div class="h2">${t.tk} · ${t.ty} · <span class="num ${t.r >= 0 ? 'up' : 'down'}">${money(t.r, true)}</span></div><span class="faint" style="font-size:11.5px">${t.d}</span></div>
        <div class="tl mt14">${st.map(e => `<div class="e" style="--mc:${e[2]}"><div class="tm">${e[0]}</div><div class="tx">${e[1]}</div></div>`).join('')}</div>
        <div class="well mt14" style="font-size:12.5px"><div class="lbl" style="margin-bottom:4px">Agent\u2019s take</div>${t.plan ? (t.r >= 0 ? 'Clean trade. You waited for the breakout instead of buying the gap, and moving the stop after target 1 reduced planned downside. Gaps and slippage can still change the result.' : 'This was a good loss: the setup failed, and the stop kept the loss near the plan estimate. Gaps, slippage, and fees can change the realized amount.') : 'You entered above the plan and widened the stop. Both made the loss bigger than planned. Orbit\u2019s chase and widen guardrails would have blocked both.'}</div>
      </div>
    </div>
    ${typeof PbStats !== 'undefined' ? PbStats.html() : ''}
    <div class="card mt14">
      <div class="row sb"><div><div class="h2">What Orbit knows about me</div><div class="mut" style="font-size:12px;margin-top:2px">Choose how much of your history the agent remembers between chats. You can change this any time.</div></div></div>
      <div class="grid3 mt14">${[[0, 'Nothing', 'Every chat starts fresh. The agent only sees the current plan and screen.'], [1, 'My stats', 'A profile Orbit computes from your trade log: win rate, typical size, results by playbook. Just numbers, no opinions.']].map(l => `<div class="lvl ${S.memLevel === l[0] ? 'on' : ''}" data-l="${l[0]}"><div class="row sb"><b>Level ${l[0]} · ${l[1]}</b>${S.memLevel === l[0] ? '<span class="bdg co">On</span>' : ''}</div><div class="mut" style="font-size:12px;margin-top:4px">${l[2]}</div></div>`).join('')}
        <div class="lvl off"><div class="row sb"><b>Level 2 · Stats + lessons</b><span class="bdg">Later</span></div><div class="mut" style="font-size:12px;margin-top:4px">Short rules drawn from your trades, kept only if you approve them. Not in the first version.</div></div></div>
      <div class="grid2 mt14">
        <div><div class="lbl" style="margin-bottom:6px">Exactly what the agent receives</div><div class="code">${this.ctx()}</div></div>
        <div class="empty" style="display:flex;align-items:center;justify-content:center">${S.memLevel === 0 ? 'Nothing is stored or sent beyond this chat.' : 'Orbit computes this from your trade log. The agent reads it but can\u2019t change it.'}</div>
      </div>
    </div>`;
  },
  ctx() {
    if (S.memLevel === 0) return 'current_screen: "review"\ncurrent_plan: null\nhistory: none';
    const s = 'trader_profile:\n  trades_90d: 46\n  win_rate: 0.57\n  avg_win: 612   avg_loss: -274\n  usual_risk: 400-500\n  plan_followed: 0.85\n  by_playbook:\n    leader_pullback: { trades: 14, win: 0.64, avg_r: 1.6 }\n    breakout_retest: { trades: 8, win: 0.62, avg_r: 1.3 }\n    opening_high_breakout: { trades: 17, win: 0.53, avg_r: 0.7 }';
    return S.memLevel === 1 ? s : s + '\napproved_lessons:\n' + LESSONS.filter(l => l[1]).map(l => '  - "' + l[0] + '"').join('\n');
  },
  mount() {
    $$('#trTbl tr.click').forEach(r => r.onclick = () => { this.sel = r.dataset.tk; render(); });
    $$('.lvl[data-l]').forEach(el => el.onclick = () => { S.memLevel = +el.dataset.l; const y = $('#ws').scrollTop; render(); $('#ws').scrollTop = y; });
    $$('[data-ok]').forEach(b => b.onclick = () => { LESSONS[+b.dataset.ok][1] = true; const y = $('#ws').scrollTop; render(); $('#ws').scrollTop = y; });
    // Flex import is intentionally not wired in v1; Review reads Orbit's persisted trade log.
  },
  async agent(first) {
    if (!first) return;
    await Dock.say('Good day so far. Over your last 20 trades, the three where you broke the plan cost <b>−$1,230</b>. The rest made money. That\u2019s the strongest pattern I see.', 400);
    Dock.chips([{ t: 'What should I do differently?', fn: () => Dock.say('Mostly: stop entering after 10:30 AM, and never widen a stop. Orbit already blocks widening past your limit. Want a softer rule, like a warning before 10:30-plus entries?') }]);
  }
};

/* ============================== SETTINGS ============================== */
SCREENS.settings = {
  sees: () => '<b>Settings</b> · tokens and account numbers are redacted for me',
  html() {
    const g = S.guard, num = (id, label, v, pre = '$', hint = '') => `<div class="field"><label>${label}</label><div class="inp-wrap">${pre ? `<span class="pre">${pre}</span>` : ''}<input class="inp mono" id="${id}" value="${v}" style="${pre ? '' : 'padding-left:11px'}"></div>${hint ? `<span class="faint" style="font-size:11px">${hint}</span>` : ''}</div>`;
    const tg = (id, on, lock) => `<span class="tog ${on ? 'on' : ''} ${lock ? 'lock' : ''}" ${id ? `id="${id}"` : ''} role="switch" aria-checked="${on}"></span>`;
    return `
    <div class="ph"><div><h1>Settings</h1><p>Your guardrails, the AI model, what the agent may do, and your IBKR connection.</p></div></div>
    <div class="grid2">
      <div class="col gap14">
        <div class="card"><div class="h2">Risk wallet + guardrails</div><div class="mut" style="font-size:12px;margin-top:2px">Orbit enforces these. The agent can\u2019t change them.</div>
          <div class="grid2 mt14" style="gap:12px">
            ${num('gDaily', 'Daily loss limit', g.dailyLimit, '$', 'Realized losses on trades closed today; open risk is not reserved')}
            ${num('gMax', 'Max risk per trade', g.maxRisk)}
            ${num('gCool', 'Cooldown after a stop-out', g.cooldownMin, '', 'minutes')}
            ${num('gChase', 'Don\u2019t chase past entry by more than', g.chaseCents, '', 'cents (smaller moves trim size)')}
          </div>
          <div class="setrow mt10"><div class="tx"><b>Pattern-day-trade warnings</b><span>Use IBKR's count over five rolling business days</span></div>${tg('', true)}</div>
          <div class="setrow"><div class="tx"><b>Regular hours only</b><span>No premarket or after-hours orders</span></div>${tg('', true, true)}</div>
        </div>
        <div class="card"><div class="h2">Agent permissions</div><div class="mut" style="font-size:12px;margin-top:2px">What the agent may do through the UI bridge.</div>
          <div class="setrow mt10"><div class="tx"><b>Read the screen</b><span>Plans, prices, conditions, your journal</span></div>${tg('', true)}</div>
          <div class="setrow"><div class="tx"><b>Suggest plan fields</b><span>Review the old/new diff and accept it yourself. You still load and place.</span></div>${tg('', true)}</div>
          <div class="setrow"><div class="tx"><b>Move between screens</b></div>${tg('', true)}</div>
          <div class="setrow"><div class="tx"><b>Change settings</b></div>${tg('', false)}</div>
          <div class="setrow" data-agent-hidden><div class="tx"><b>Place, change or cancel orders</b><span>Never. Only you, by holding the button.</span></div><span class="lockic">${ICON.lk}</span>${tg('', false, true)}</div>
        </div>
        <div class="card"><div class="h2">Watchlists, alerts and the market strip</div>
          <div class="setrow mt10"><div class="tx"><b>Watchlists</b><span>3 lists · 14 names · stored in Orbit. Imported once from IBKR on Nov 12; IBKR\u2019s own lists aren\u2019t changed.</span></div></div>
          <div class="grid2 mt10" style="gap:12px">${num('gAlert', 'Check alerts every', 5, '', 'minutes · on completed bars')}<div class="field"><label>Market strip</label><div class="row" style="gap:6px;flex-wrap:wrap">${['SPY', 'QQQ', 'IWM', 'VIX'].map(t => `<span class="bdg">${t}</span>`).join('')}<button class="btn sm ghost">Edit</button></div></div></div>
        </div>
      </div>
      <div class="col gap14">
        <div class="card"><div class="h2">AI model</div><div class="mut" style="font-size:12px;margin-top:2px">Use an API key first. Plan sign-in is later, after the OS sandbox test passes. The agent only gets Orbit\u2019s tools: no shell, no files, no orders.</div>
          <div class="col gap6 mt14" id="aiProv">${[['codex', 'ChatGPT plan, through Codex', 'Later · unavailable until the OS sandbox test passes', false], ['agy', 'Google AI Pro, through Antigravity CLI', 'Later · unavailable until the OS sandbox test passes', false], ['key', 'API key (Anthropic, OpenAI or Google)', 'Billed per use by the provider · stored in macOS Keychain', true]].map(p => `<label class="prov ${S.aiProv === p[0] ? 'on' : ''}" data-prov="${p[0]}"><span class="rad"></span><span><b>${p[1]}</b><span class="faint" style="display:block;font-size:11.5px">${p[2]}</span></span>${p[3] ? '<span class="bdg ok" style="margin-left:auto"><span class="ci"></span>Ready</span>' : ''}</label>`).join('')}</div>
          ${S.aiProv === 'key' ? '<div class="field mt10" data-agent-secret><label>API key</label><input class="inp mono" value="sk-ant-••••••••••••4f2a" readonly><span class="faint" style="font-size:11px">Stored in macOS Keychain</span></div>' : '<div class="faint mt10" style="font-size:11.5px">If your plan\u2019s limit runs out, Orbit keeps working without the agent: every number, guardrail and alert still comes from the engine.</div>'}
          <div class="setrow mt10"><div class="tx"><b>Share my positions and P&L with the model</b><span>Off means the agent plans without knowing what you hold</span></div>${tg('tShare', S.sharePositions)}</div>
        </div>
        <div class="card"><div class="row sb"><div class="h2">IB Gateway</div><span class="bdg ${S.gw ? 'ok' : 'err'}"><span class="ci"></span>${S.gw ? 'Connected' : 'Offline'}</span></div>
          <div class="grid3 mt14" style="gap:12px;grid-template-columns:1.4fr .8fr 1fr">
            ${num('', 'Host', '127.0.0.1', '')}${num('', 'Port', '4001', '')}
            <div class="field" data-agent-secret><label>Account</label><input class="inp mono" value="DU•••4821" readonly></div>
          </div>
          <div class="row mt14"><button class="btn sm" id="gwTest">Test connection</button><button class="btn sm ghost" id="gwToggle">${S.gw ? 'Simulate disconnect' : 'Reconnect'}</button></div>
        </div>
        <div class="card"><div class="h2">IBKR Flex (older trade import)</div>
          <div class="faint mt10" style="font-size:11.5px">Not connected in v1. Review uses Orbit's own trade log; importing older trades from Flex is a later feature.</div>
        </div>
        <div class="card"><div class="h2">Appearance</div>
          <div class="setrow mt10"><div class="tx"><b>Theme</b></div>${seg('thSeg', [['light', 'Light'], ['dark', 'Dark']], S.theme)}</div>
          <div class="setrow"><div class="tx"><b>Reduced motion</b><span>Removes animations, keeps every state</span></div>${tg('tRm', rm())}</div>
          <div class="setrow"><div class="tx"><b>Pro details</b><span>Order types, Greeks and raw levels everywhere</span></div>${tg('tPro', S.pro)}</div>
        </div>
      </div>
    </div>`;
  },
  mount() {
    const bindNum = (id, k) => { const el = $('#' + id); el.onchange = () => { const v = +el.value.replace(/[^\d.]/g, ''); if (v > 0) { S.guard[k] = v; renderHeader(); toast('Saved.', 'ok', 1400); } else el.value = S.guard[k]; }; };
    bindNum('gDaily', 'dailyLimit'); bindNum('gMax', 'maxRisk'); bindNum('gCool', 'cooldownMin'); bindNum('gChase', 'chaseCents');
    $$('.tog').forEach(t => { if (t.classList.contains('lock') || t.id) return; t.onclick = () => t.classList.toggle('on'); });
    $$('[data-prov]').forEach(el => el.onclick = () => { if (el.dataset.prov !== 'key') return toast('Available only after the OS sandbox test passes.'); S.aiProv = el.dataset.prov; const y = $('#ws').scrollTop; render(); $('#ws').scrollTop = y; $('.priv').innerHTML = `<span class="gwdot"></span>API key · <b>${S.sharePositions ? 'positions shared' : 'positions private'}</b>`; });    $('#tShare').onclick = e => { S.sharePositions = !S.sharePositions; e.target.classList.toggle('on', S.sharePositions); $('.priv b').textContent = S.sharePositions ? 'positions shared' : 'positions private'; };
    $('#tRm').onclick = e => { document.body.classList.toggle('rm'); e.target.classList.toggle('on', rm()); };
    $('#tPro').onclick = e => { S.pro = !S.pro; applyPro(); e.target.classList.toggle('on', S.pro); };
    bindSeg('thSeg', v => { S.theme = v; applyTheme(); });
    $('#gwTest').onclick = async () => { $('#gwTest').textContent = 'Testing…'; await wait(700); $('#gwTest').textContent = 'Test connection'; toast(S.gw ? 'Gateway OK · 42 ms · market data live' : 'Can\u2019t reach 127.0.0.1:4001', S.gw ? 'ok' : 'err'); };
    $('#gwToggle').onclick = () => { S.gw = !S.gw; renderHeader(); render(); };
  },
  async agent(first) { if (first) await Dock.say('I can read this page, but your API key and account number are redacted for me. Flex import is not connected in v1. Guardrails are yours to set. I can\u2019t change them.', 400); }
};
