/* Orbit prototype, merged Parallax + MoonMarket surfaces: Ideas list, chart screen, watching plans, holdings, review tabs.
   Everything here is simulated. Prices are seeded random walks; drawings and lists live in memory. */
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hsh = str => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
const pct = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%';
const POOL = {
  IREN: { nm: 'Iris Energy', px: 18.62, ch: 15.2, sec: 'Bitcoin miners / AI hosting', rs: 96 },
  PLTR: { nm: 'Palantir', px: 74.10, ch: 6.8, sec: 'Software', rs: 98 },
  HOOD: { nm: 'Robinhood', px: 41.35, ch: 3.1, sec: 'Brokers', rs: 95 },
  NVDA: { nm: 'Nvidia', px: 182.40, ch: 1.4, sec: 'Semiconductors', rs: 99 },
  AMD: { nm: 'AMD', px: 151.02, ch: -2.1, sec: 'Semiconductors', rs: 81 },
  ANET: { nm: 'Arista Networks', px: 131.80, ch: 2.2, sec: 'Networking', rs: 97 },
  CRWD: { nm: 'CrowdStrike', px: 402.15, ch: 0.9, sec: 'Software', rs: 94 },
  AVGO: { nm: 'Broadcom', px: 241.60, ch: 1.1, sec: 'Semiconductors', rs: 93 },
  TSM: { nm: 'TSMC', px: 201.30, ch: 0.6, sec: 'Semiconductors', rs: 92 },
  COIN: { nm: 'Coinbase', px: 312.40, ch: 5.4, sec: 'Brokers', rs: 90 },
  MU: { nm: 'Micron', px: 118.25, ch: 2.9, sec: 'Semiconductors', rs: 88 },
  SMCI: { nm: 'Super Micro', px: 44.10, ch: 7.7, sec: 'Hardware', rs: 79 },
  MSFT: { nm: 'Microsoft', px: 438.75, ch: -0.3, sec: 'Software', rs: 72 },
  SPY: { nm: 'S&P 500 ETF', px: 588.20, ch: 0.4, sec: 'Index' }, QQQ: { nm: 'Nasdaq 100 ETF', px: 512.60, ch: 0.7, sec: 'Index' },
  IWM: { nm: 'Russell 2000 ETF', px: 221.40, ch: -0.6, sec: 'Index' }, VIX: { nm: 'Volatility index', px: 16.10, ch: -3.2, sec: 'Index' },
  SMH: { nm: 'Semiconductor ETF', px: 262.10, ch: 0.8, sec: 'Sector ETF' }
};
const sparkOf = tk => { const r = rng(hsh(tk)), p = POOL[tk]; let v = p.px / (1 + p.ch / 100); const a = []; for (let i = 0; i < 10; i++) { a.push(v); v += (p.px - v) / (10 - i) + (r() - .5) * p.px * .006; } a[9] = p.px; return a; };
const LEADERS = ['NVDA', 'PLTR', 'ANET', 'IREN', 'HOOD', 'CRWD', 'AVGO', 'TSM'];
const HOLD0 = [
  { tk: 'NVDA', ty: 'Stock', q: 40, avg: 121.30, px: 182.40, chg: 1.4 },
  { tk: 'MSFT', ty: 'Stock', q: 25, avg: 402.10, px: 438.75, chg: -0.3 },
  { tk: 'SMH', ty: 'ETF', q: 30, avg: 248.00, px: 262.10, chg: 0.8 },
  { tk: 'PLTR', label: 'PLTR $80 call', ty: 'Option', right: 'Call', strike: 80, exp: 'Nov 21', dte: 8, q: 2, mult: 100, avg: 3.10, px: 1.85, chg: -12.4 },
  { tk: 'AMD', ty: 'Stock', q: 15, avg: 160.20, px: 151.02, chg: -2.1 }
];
Object.assign(S, {
  lookTab: 'setups', list: 'Growth', lists: { Growth: ['NVDA', 'PLTR', 'CRWD', 'ANET', 'IREN'], Semis: ['NVDA', 'AMD', 'AVGO', 'TSM', 'MU', 'SMCI'], 'Earnings week': ['IREN', 'COIN', 'HOOD'] },
  hits: [{ id: 1, tk: 'HOOD', t: '25¢ from your retest plan at $41.60', tm: '10:38 AM', plan: true }, { id: 2, tk: 'NVDA', t: 'Crossed above its 50-day average', tm: '10:12 AM' }, { id: 3, tk: 'MU', t: 'Volume is 3× its 20-day average', tm: '10:05 AM' }],
  rules: ['NVDA crosses its 50-day average', 'MU volume over 3× average', 'HOOD within 30¢ of $41.60 (from your plan)', 'SPY closes below its 21-day average'],
  watch: [{ tk: 'HOOD', t: 'Breakout and retest', trig: 'Buys on a retest of $41.60', dist: '25¢ away', st: 'close', risk: 350 }, { tk: 'NVDA', t: 'Leader pullback', trig: 'Buys near the 9-week EMA $180.40 on a close above yesterday\u2019s high', dist: '$2.90 away', st: 'watching', risk: 400 }],
  chartTk: 'IREN', chartMode: 'chart', cmpP: '3m', cmpBench: null, tf: '5m', ind: { wema: false, vol: true, vwap: true, ema21: true, sma50: false, sma200: false, rsi: false }, tool: 'cursor', pend: null, draw: {}, alerts: {}, showPlan: false,
  hold: HOLD0.map(h => ({ ...h })), cash: 18400,
  orders: [{ id: 1, tk: 'SMH', what: 'Stop: sell 30 at $240.00', kind: 'protect', tif: 'GTC' }, { id: 2, tk: 'AMD', what: 'Stop: sell 15 at $150.00', kind: 'protect', tif: 'GTC' }, { id: 3, tk: 'MSFT', what: 'Buy 10 at $425.00 limit', kind: 'entry', tif: 'DAY' }],
  allocView: 'list', leadSort: 'pct', revTab: 'trades', perfP: '3m', txF: 'all', mktOpen: false
});
ROUTES.chart = 'ideas';
function openChart(tk, mode) { S.chartTk = tk; S.pend = null; S.tool = 'cursor'; S.showPlan = false; if (mode) S.chartMode = mode; go('chart'); }
const chip = (k, t) => `<span class="src ${k}">${t}</span>`;

/* ============================== IDEAS (merged) ============================== */
const Mkt = {
  html() {
    const t = ['SPY', 'QQQ', 'IWM', 'VIX'].map(tk => { const p = POOL[tk]; return `<span class="pt"><b>${tk}</b><span class="num">${px2(p.px)}</span><span class="num ${tk === 'VIX' ? 'mut' : p.ch >= 0 ? 'up' : 'down'}">${pct(p.ch)}</span></span>`; }).join('');
    const why = [['SPY', 'Above its 21-day and 50-day averages', 'ok'], ['QQQ', 'Above its 21-day, 50-day and 200-day averages', 'ok'], ['IWM', 'Below its 50-day average', 'bad'], ['Sectors', '6 of 11 above their 50-day average', 'mid']];
    return `<div class="card mkt" id="mkt"><div class="row sb" style="flex-wrap:wrap;gap:10px">
      <div class="row" style="gap:12px"><span class="bdg co">Market: selective</span><span style="font-size:13px"><b>Leaders are fine, small caps are weak.</b> <span class="mut">Normal size on strong names, skip weak ones.</span></span></div>
      <div class="row" style="gap:14px">${t}<button class="btn sm ghost" id="mktWhy">${S.mktOpen ? 'Hide' : 'Why?'}</button></div></div>
      <div class="faint mt6" style="font-size:11.5px">Your playbooks for a selective market: <b style="color:var(--ink2)">${PB.filter(p => pbOn(p)).map(p => p.name).join(' · ')}</b>. ${PB.filter(p => !pbOn(p)).map(p => p.name).join(', ')} is off. <a href="#playbooks">Change</a></div>
      ${S.mktOpen ? `<div class="mktw mt10">${why.map(w => `<div class="it"><i class="${w[2]}"></i><b>${w[0]}</b><span class="mut">${w[1]}</span></div>`).join('')}<div class="faint" style="font-size:11px">Daily bars as of yesterday\u2019s close, live prices on top.<span class="pro-i mono"> · SPY > EMA21 > SMA50 · breadth 6/11 > SMA50</span></div></div>` : ''}</div>`;
  }
};
const _ideas = SCREENS.ideas;
SCREENS.ideas = {
  ..._ideas,
  sees: () => `<b>Ideas</b> · market strip, worth-a-look list (${S.lookTab}), thesis box`,
  html() {
    return `
    <div class="ph"><div><h1>What\u2019s worth a look</h1><p>Today\u2019s setups from your playbooks, plus your leaders, watchlists and alerts. Open any name for the full chart, or describe your own idea.</p></div>
      <span class="bdg co mono">${clockTxt(S.clock)} ET · market open</span></div>
    ${Mkt.html()}
    <div class="grid2 mt14" style="grid-template-columns:1fr 1.35fr">
      <div class="card">
        <div class="h2">Start from a thesis</div>
        <textarea class="inp mt10" id="ideaTxt" rows="3" style="width:100%" placeholder="e.g. IREN reported yesterday, up 15% premarket. I\u2019m bullish and willing to risk $500.">${S.thesis ? S.thesis : ''}</textarea>
        <div class="drop mt10" id="drop">${S.att ? `${ICON.clip}&nbsp; <b>iren-5min-chart.png</b> attached · checked fresh` : 'Drop a chart screenshot here, or click to attach. Orbit checks it isn\u2019t stale before using it.'}</div>
        <div class="row mt14"><button class="btn pri" id="ideaGo">Build plans</button><button class="btn ghost" id="ideaEx">Use the IREN example</button></div>
        <div class="faint mt6" style="font-size:11.5px">Stocks + single-leg options · regular hours only</div>
        <div id="ctx" class="mt14">${this.ctxHtml()}</div>
      </div>
      <div class="card">
        <div class="row sb" style="flex-wrap:wrap;gap:8px"><div class="h2">Worth a look</div>${seg('lookSeg', [['setups', 'Setups'], ['leaders', 'Leaders'], ['watch', 'Watchlists'], ['alerts', `Alerts${S.hits.length ? ' · ' + S.hits.length : ''}`]], S.lookTab)}</div>
        <div id="lookBody" class="mt10">${this.body()}</div>
      </div>
    </div>`;
  },
  row(tk, reason, chips = [], extra = '') {
    const p = POOL[tk];
    return `<div class="idea look" data-tk="${tk}">
      <div style="width:64px;flex:none"><div class="tk">${tk}</div><div class="faint ell" style="font-size:10.5px">${p.nm}</div></div>
      ${spark(sparkOf(tk), p.ch >= 0 ? 'var(--up)' : 'var(--down)', 64, 24)}
      <div style="width:74px;flex:none;text-align:right"><div class="num" style="font-weight:600">$${px2(p.px)}</div><div class="num ${p.ch >= 0 ? 'up' : 'down'}" style="font-size:11px">${pct(p.ch)}</div></div>
      <div style="flex:1;min-width:0;padding-left:6px"><div class="row" style="gap:4px;flex-wrap:wrap">${chips.join('')}</div><div class="mut ell" style="font-size:11.5px;margin-top:3px">${reason}</div></div>
      ${extra}<div class="acts"><button class="btn sm" data-chart="${tk}">Chart</button><button class="btn sm ghost" data-plan="${tk}">Plan</button></div></div>`;
  },
  body() {
    const tab = S.lookTab;
    if (tab === 'leaders') return `<div class="col">${LEADERS.map((tk, i) => { const inL = S.lists[S.list].includes(tk);
      return this.row(tk, `RS ${POOL[tk].rs} · ${POOL[tk].sec}`, [chip('l', 'Leader #' + (i + 1))], `<button class="btn sm ghost" data-add="${tk}" ${inL ? 'disabled' : ''}>${inL ? '✓ ' + S.list : '+ ' + S.list}</button>`); }).join('')}</div>
      <div class="faint mt10" style="font-size:11px">Published relative-strength ranking, US stocks · updated 6:00 AM. Adding a name puts it in your Orbit list.</div>`;
    if (tab === 'watch') return `<div class="row sb" style="flex-wrap:wrap;gap:8px">${seg('wlSeg', Object.keys(S.lists).map(k => [k, `${k} · ${S.lists[k].length}`]), S.list)}
        <div class="row" style="gap:6px"><input class="inp" id="wlAdd" placeholder="Add a ticker" style="width:120px;height:30px"><button class="btn sm" id="wlAddBtn">Add</button></div></div>
      <div class="col mt10">${S.lists[S.list].map(tk => this.row(tk, POOL[tk].sec, [], `<button class="x" data-rm="${tk}" title="Remove from ${S.list}">×</button>`)).join('') || '<div class="empty">This list is empty.</div>'}</div>
      <div class="faint mt10" style="font-size:11px">Lists live in Orbit. Imported once from IBKR on Nov 12; IBKR\u2019s own watchlists aren\u2019t changed.</div>`;
    if (tab === 'alerts') return `<div class="col">${S.hits.map(h => this.row(h.tk, h.t, [chip('a', h.plan ? 'Your plan' : 'Alert'), `<span class="faint mono" style="font-size:10px">${h.tm}</span>`],
        `<button class="btn sm ghost" data-snooze="${h.id}">Snooze 1h</button><button class="btn sm ghost" data-dis="${h.id}">Dismiss</button>`)).join('') || '<div class="empty">No alerts right now.</div>'}</div>
      <div class="well mt14"><div class="row sb"><div class="lbl">Your alerts · checked every 5 min</div><button class="btn sm ghost" onclick="openChart('IREN')">New alert on a chart</button></div>
        <div class="col gap6 mt6" style="font-size:12px">${S.rules.map(r => `<div class="row" style="gap:8px"><span class="ci" style="width:6px;height:6px;border-radius:50%;background:var(--up)"></span>${r}</div>`).join('')}</div></div>`;
    return setupsBody();
  },
  paintBody() { $('#lookBody').innerHTML = this.body(); this.bindBody(); const s = $('#lookSeg [data-v="alerts"]'); if (s) s.textContent = `Alerts${S.hits.length ? ' · ' + S.hits.length : ''}`; },
  bindBody() {
    const B = $('#lookBody');
    $$('.look', B).forEach(el => el.onclick = e => { if (e.target.closest('button,input')) return; openChart(el.dataset.tk); });
    $$('[data-chart]', B).forEach(b => b.onclick = () => openChart(b.dataset.chart));
    $$('[data-plan]', B).forEach(b => b.onclick = () => this.planFor(b.dataset.plan));
    $$('[data-add]', B).forEach(b => b.onclick = () => { S.lists[S.list].push(b.dataset.add); toast(`Added ${b.dataset.add} to ${S.list}.`, 'ok', 1800); this.paintBody(); });
    $$('[data-rm]', B).forEach(b => b.onclick = () => { S.lists[S.list] = S.lists[S.list].filter(x => x !== b.dataset.rm); this.paintBody(); toast(`Removed ${b.dataset.rm} from ${S.list}.`, 'info', 1800); });
    $$('[data-dis]', B).forEach(b => b.onclick = () => { S.hits = S.hits.filter(h => h.id !== +b.dataset.dis); this.paintBody(); });
    $$('[data-snooze]', B).forEach(b => b.onclick = () => { S.hits = S.hits.filter(h => h.id !== +b.dataset.snooze); this.paintBody(); toast('Snoozed for an hour.', 'info', 1800); });
    $$('[data-vs]', B).forEach(b => b.onclick = e => { e.stopPropagation(); openChart(b.dataset.vs, 'compare'); });
    if ($('#pbOffBtn')) $('#pbOffBtn').onclick = () => { S.pbOffOpen = !S.pbOffOpen; this.paintBody(); };
    if ($('#wlSeg')) bindSeg('wlSeg', v => { S.list = v; this.paintBody(); });
    const add = () => { const v = ($('#wlAdd').value || '').trim().toUpperCase(); if (!v) return; if (!POOL[v]) return toast(`Couldn\u2019t find ${v} on IBKR.`, 'warn', 2000); if (!S.lists[S.list].includes(v)) S.lists[S.list].push(v); this.paintBody(); };
    if ($('#wlAddBtn')) { $('#wlAddBtn').onclick = add; $('#wlAdd').onkeydown = e => { if (e.key === 'Enter') add(); }; }
  },
  planFor(tk) {
    const t = tk === 'IREN' ? 'IREN reported yesterday, up 15% premarket. I\u2019m bullish and willing to risk $500.' : `${tk} looks interesting today. What would a plan look like?`;
    if (S.route !== 'ideas') { S.thesis = t; go('ideas'); return; }
    $('#ideaTxt').value = t; $('#ideaTxt').focus(); Dock.touch('#ideaTxt');
  },
  async agent(first) {
    if (!first) return;
    await Dock.say(`Morning. The market is <b>selective</b>: leaders are holding up, small caps aren\u2019t. Three things are worth a look: <b>HOOD</b> is 25¢ from your retest plan, <b>NVDA</b> crossed its 50-day, and <b>IREN</b> is gapping on earnings.`, 400);
    Dock.chips([{ t: 'Try the IREN example', silent: true, fn: () => this.example() }, { t: 'Open the IREN chart', fn: () => openChart('IREN') }]);
  }
};
SCREENS.ideas.mount = function () {
  _ideas.mount.call(this);
  bindSeg('lookSeg', v => { S.lookTab = v; Dock.setSees(this.sees()); this.paintBody(); });
  const why = () => { S.mktOpen = !S.mktOpen; $('#mkt').outerHTML = Mkt.html(); $('#mktWhy').onclick = why; };
  $('#mktWhy').onclick = why;
  this.bindBody();
};

/* ============================== CHART ============================== */
const TFS = [['1m', 1], ['5m', 5], ['15m', 15], ['1h', 60], ['D', 1440]];
const IND = [['wema', '8/9-wk EMA', 'var(--c30)'], ['vol', 'Volume', 'var(--ink3)'], ['vwap', 'VWAP', '#0E8C8C'], ['ema21', 'EMA 21', 'var(--c30)'], ['sma50', 'SMA 50', '#9A6B00'], ['sma200', 'SMA 200', '#B4407A'], ['rsi', 'RSI', 'var(--ink2)']];
// Bars an indicator needs before its value is trusted. EMAs get 3x their length so the starting seed has washed out.
const WARM = { ema21: 63, sma50: 50, sma200: 200, rsi: 42, wema: 27 * 5 + 5 };
const HIST = 420;
const TOOLS = [['cursor', '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1v14M1 8h14"/></svg>', 'Crosshair'],
  ['hline', '<svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6"><path d="M1 8h14"/></svg>', 'Horizontal level · 1 click'],
  ['line', '<svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6"><path d="M2 13 14 3"/></svg>', 'Trend line · 2 clicks'],
  ['ray', '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 13 13 4"/><path d="m9.5 3.5 4-.5-.5 4"/></svg>', 'Ray · 2 clicks'],
  ['rect', '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="4" width="12" height="8" rx="1"/></svg>', 'Rectangle · 2 clicks'],
  ['fib', '<svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.4"><path d="M1 2h14M1 6h14M1 9h14M1 14h14"/></svg>', 'Fibonacci retracement · 2 clicks, low then high'],
  ['alert', '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11Z"/><path d="M6.5 14h3"/></svg>', 'Price alert · 1 click']];
const FIB = [0, .236, .382, .5, .618, .786, 1];
const barCache = {};
function barsFor(tk, tf) {
  const key = tk + tf + (S.histCap || ''); if (barCache[key]) return barCache[key];
  const p = POOL[tk], m = TFS.find(x => x[0] === tf)[1], n = S.histCap || HIST, r = rng(hsh(tk + tf));
  const vol = p.px * ({ D: .022, '1h': .008, '15m': .005, '5m': .0032, '1m': .0016 })[tf];
  const sess = m >= 1440 ? -1 : n - 1 - Math.floor(70 / m);
  const gapAt = tk === 'IREN' ? (m >= 1440 ? n - 1 : sess) : -1;
  const drift = p.px * p.ch / 100 / 90 * .5, out = []; let cl = p.px;
  for (let i = n - 1; i >= 0; i--) {
    const mv = (r() - .5) * vol * 2 + drift, o = cl - mv;
    const hi = Math.max(o, cl) + r() * vol * .8, lo = Math.min(o, cl) - r() * vol * .8;
    out.unshift({ o: +o.toFixed(2), h: +hi.toFixed(2), l: +Math.max(.01, lo).toFixed(2), c: +cl.toFixed(2), v: Math.round((.6 + r() * .8) * (i === gapAt ? 4 : 1) * 1e5) });
    cl = Math.max(.05, i === gapAt ? o / 1.1 : o);
  }
  if (gapAt >= 0) { for (let i = gapAt; i < n; i++) { const b = out[i]; b.h = Math.min(b.h, 18.85); b.o = Math.min(b.o, 18.84); b.c = Math.min(b.c, 18.84); b.l = Math.min(b.l, b.o, b.c); } out[Math.min(n - 1, gapAt + 2)].h = 18.85; out[n - 1].c = 18.62; }
  out.forEach((b, i) => { b.t = 1e6 - (n - 1 - i) * m; });
  return barCache[key] = { B: out, m, gapAt, sess };
}
const emaOf = (a, n) => { const k = 2 / (n + 1), out = new Array(a.length).fill(null); if (a.length < n) return out; let e = a.slice(0, n).reduce((x, y) => x + y) / n; out[n - 1] = e; for (let i = n; i < a.length; i++) { e = a[i] * k + e * (1 - k); out[i] = e; } return out; };
const smaOf = (a, n) => { const out = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) out[i] = s / n; } return out; };
const maskWarm = (a, w) => a.map((v, i) => i < w - 1 ? null : v);
const vwapOf = (B, from) => { let pv = 0, vv = 0; return B.map((b, i) => { if (from < 0 || i < from) return null; pv += (b.h + b.l + b.c) / 3 * b.v; vv += b.v; return pv / vv; }); };
const rsiOf = (a, n = 14) => { let g = 0, l = 0; return a.map((v, i) => { if (!i) return null; const d = v - a[i - 1];
  if (i <= n) { g += Math.max(d, 0) / n; l += Math.max(-d, 0) / n; return i < n ? null : 100 - 100 / (1 + g / (l || 1e-9)); }
  g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; return 100 - 100 / (1 + g / (l || 1e-9)); }); };
// Weekly EMA from real weekly closes. The last four daily bars are this week, still forming, so they show last Friday's value.
function weeklyEma(B, len) {
  const n = B.length, ends = []; for (let e = n - 5; e >= 4; e -= 5) ends.unshift(e); // only full weeks
  const k = 2 / (len + 1), w = ends.map(e => B[e].c), ew = [];
  w.forEach((c, j) => ew.push(j < len - 1 ? null : j === len - 1 ? w.slice(0, len).reduce((a, b) => a + b) / len : c * k + ew[j - 1] * (1 - k)));
  const out = new Array(n).fill(null);
  ends.forEach((e, j) => { if (j < 26 || ew[j] == null) return; const to = j + 1 < ends.length ? ends[j + 1] : n - 1; for (let i = e + 1; i <= to; i++) out[i] = ew[j]; });
  return out;
}
const niceStep = (range, count) => { const raw = range / Math.max(1, count), p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };
function timeLabel(i, n, m) {
  const back = (n - 1 - i) * m;
  if (m >= 1440) { const d = new Date(2026, 10, 12 - Math.round(back / 1440 * 7 / 5)); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  let tod = 640 - back, d = 0; while (tod < 570) { tod += 390; d++; }
  const hh = Math.floor(tod / 60), mm = String(tod % 60).padStart(2, '0'), t = `${hh > 12 ? hh - 12 : hh}:${mm}`;
  return d === 0 ? t : d === 1 ? 'Yest ' + t : new Date(2026, 10, 12 - d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + t;
}
S.vis = 90; S.off = 0; S.chH = clamp(Math.round(innerHeight * .42), 300, 520);
SCREENS.chart = {
  sees: () => S.chartMode === 'compare' ? `<b>Compare</b> · ${S.chartTk} against ${cmpRefs(S.chartTk).join(', ')}, ${S.cmpP}` : `<b>Chart</b> · ${S.chartTk} ${S.tf}, indicators, your drawings`,
  hint() {
    const t = TOOLS.find(x => x[0] === S.tool), g = this.g;
    if (S.tool !== 'cursor') return S.pend ? `${t[2].split(' · ')[0]}: click the second point · Esc cancels` : t[2];
    return `Scroll to zoom, drag to go back in time, double-click to reset${g ? ` · showing ${g.n} of ${g.N} bars` : ''}. Drawings stay with ${S.chartTk} on every timeframe.`;
  },
  html() {
    const tk = S.chartTk, p = POOL[tk];
    return `
    <div class="ph"><div><div class="row"><button class="btn sm ghost" onclick="go('ideas')">← Ideas</button><span class="faint" style="font-size:11.5px">${p.sec}</span></div>
      <h1 style="margin-top:6px">${tk} · ${p.nm} <span class="num ${p.ch >= 0 ? 'up' : 'down'}" style="font-size:16px;font-weight:600">$${px2(p.px)} ${pct(p.ch)}</span></h1></div>
      <div class="row"><button class="btn" id="chAlert">Set a price alert</button><button class="btn pri" id="chPlan">Plan this</button></div></div>
    <div class="row" style="margin-bottom:12px">${seg('modeSeg', [['chart', 'Price chart'], ['compare', 'Compare: is it diverging?']], S.chartMode)}</div>
    ${S.chartMode === 'compare' ? Compare.html() : `<div class="card" style="padding:12px 14px">
      <div class="row" style="gap:8px;flex-wrap:wrap">${seg('tfSeg', TFS.map(t => [t[0], t[0]]), S.tf)}<span class="vsep"></span>${IND.map(i => `<button class="tgl ${S.ind[i[0]] ? 'on' : ''}" data-ind="${i[0]}" style="--ic:${i[2]}"><i></i>${i[1]}</button>`).join('')}</div>
      <div class="chhead mono" id="chRead"></div>
      <div class="chwrap">
        <div class="tools">${TOOLS.map(t => `<button class="tool ${S.tool === t[0] ? 'on' : ''}" data-tool="${t[0]}" title="${t[2]}">${t[1]}</button>`).join('')}<span class="hsep"></span>
          <button class="tool" id="tUndo" title="Undo last drawing">↶</button><button class="tool" id="tClear" title="Clear drawings on ${tk}">⌫</button></div>
        <div class="chmain"><div id="chartBox" class="${S.tool !== 'cursor' ? 'drawing' : ''}"></div><div class="chgrip" id="chGrip" title="Drag to make the chart taller or shorter"><i></i></div></div>
      </div>
      <div class="row sb mt10" style="gap:10px;flex-wrap:wrap"><span class="faint" style="font-size:11px;flex:1;min-width:220px" id="chHint">${this.hint()}</span>
        ${tk === 'IREN' ? `<span class="row" style="gap:8px;font-size:12px;cursor:pointer" id="planLv"><span class="tog ${S.showPlan ? 'on' : ''}"></span>Show plan levels</span>` : ''}</div>
      <div id="chNote"></div>
    </div>
    <div class="grid3 mt14" id="chSide">${this.side()}</div>`}`;
  },
  side() {
    const tk = S.chartTk, { B, gapAt, sess } = barsFor(tk, '5m'), today = B.slice(sess), pc = B[sess - 1].c;
    const lv = tk === 'IREN' ? [['Opening high', 18.85], ['Premarket high', 18.40], ['Yesterday\u2019s close', pc], ['Today\u2019s low', Math.min(...today.map(b => b.l))]]
      : [['Today\u2019s high', Math.max(...today.map(b => b.h))], ['Today\u2019s low', Math.min(...today.map(b => b.l))], ['Yesterday\u2019s close', pc]];
    const al = S.alerts[tk] || [], dr = (S.draw[tk] || []).filter(d => d.type !== 'alert');
    return `<div class="card"><div class="h3">Key levels</div><div class="col gap6 mt10" style="font-size:12.5px">${lv.map(l => `<div class="row sb"><span class="mut">${l[0]}</span><span class="num">$${px2(l[1])}</span></div>`).join('')}</div></div>
      <div class="card"><div class="h3">Alerts on ${tk}</div><div class="col gap6 mt10" style="font-size:12.5px">${al.map((a, i) => `<div class="row sb"><span>Tell me if it ${a.up ? 'rises' : 'falls'} to <b class="num">$${px2(a.p)}</b></span><button class="x" data-ral="${i}">×</button></div>`).join('') || '<span class="faint">None yet. Use the bell tool or the button above.</span>'}</div></div>
      <div class="card"><div class="h3">Your drawings</div><div class="mut mt10" style="font-size:12.5px">${dr.length ? `${dr.length} saved on ${tk}: ${[...new Set(dr.map(d => ({ hline: 'level', line: 'trend line', ray: 'ray', rect: 'box', fib: 'Fibonacci' })[d.type]))].join(', ')}.` : 'Nothing drawn yet.'} They stay with ${tk} on every timeframe.</div></div>`;
  },
  paint() {
    if (S.chartMode === 'compare') return Compare.paint();
    const box = $('#chartBox'); if (!box) return;
    const tk = S.chartTk, all = barsFor(tk, S.tf), Ball = all.B, m = all.m, N = Ball.length;
    S.vis = clamp(Math.round(S.vis), Math.min(30, N), N); S.off = clamp(Math.round(S.off), 0, N - S.vis);
    const end = N - S.off, start = end - S.vis, B = Ball.slice(start, end), n = B.length, cl = Ball.map(b => b.c);
    const W = Math.max(320, Math.floor(box.clientWidth)), PR = 72, PL = 8, MH = S.chH, GAP = 12, TA = 24, plotR = W - PR;
    const VH = S.ind.vol ? Math.round(clamp(MH * .22, 56, 110)) : 0, RH = S.ind.rsi ? 96 : 0;
    const H = MH + (VH ? VH + GAP : 0) + (RH ? RH + GAP : 0) + TA, step = (plotR - PL) / n, X = i => PL + step * (i + .5);
    const ind = {}, notes = [];
    const enough = (label, bars) => { if (N >= bars) return true; notes.push(`${label} needs ${bars} ${m >= 1440 ? 'days' : 'bars'} of history and ${tk} has ${N}, so it isn\u2019t drawn.`); return false; };
    if (S.ind.ema21 && enough('EMA 21', WARM.ema21)) ind.ema21 = maskWarm(emaOf(cl, 21), WARM.ema21);
    if (S.ind.sma50 && enough('SMA 50', WARM.sma50)) ind.sma50 = smaOf(cl, 50);
    if (S.ind.sma200 && enough('SMA 200', WARM.sma200)) ind.sma200 = smaOf(cl, 200);
    if (S.ind.vwap && m < 1440) ind.vwap = vwapOf(Ball, all.sess);
    if (S.ind.wema) { if (m < 1440) notes.push('The 8/9-week EMA is built from weekly bars. Switch to D to see it.'); else if (enough('The 8/9-week EMA', WARM.wema)) { ind.wema8 = weeklyEma(Ball, 8); ind.wema = weeklyEma(Ball, 9); } }
    if (S.ind.rsi && enough('RSI 14', WARM.rsi)) ind.rsi = maskWarm(rsiOf(cl), WARM.rsi);
    const plan = S.showPlan && tk === 'IREN' ? Engine.intraday(S.risk) : null;
    const lineVals = ['ema21', 'sma50', 'sma200', 'vwap', 'wema', 'wema8'].flatMap(k => ind[k] ? ind[k].slice(start, end).filter(v => v != null) : []);
    const prices = B.flatMap(b => [b.h, b.l]).concat(lineVals, plan ? [plan.stop, plan.entry, ...plan.targets.map(t => t.p)] : []);
    let hi = Math.max(...prices), lo = Math.min(...prices); const pad = (hi - lo) * .06 || .1; hi += pad; lo -= pad;
    const Y = p => 10 + (hi - p) / (hi - lo) * (MH - 20);
    this.g = { W, PL, MH, step, n, N, hi, lo, B, m, start, plotR };
    const xt = t => X((t - B[0].t) / m), plot = [], gut = [], pills = [];
    const pl = (arr, yf, color, extra = '') => { const pts = arr.map((v, i) => v == null ? null : `${X(i).toFixed(1)},${yf(v).toFixed(1)}`).filter(Boolean).join(' '); return pts ? `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" ${extra}/>` : ''; };
    const stepLine = arr => arr.flatMap((v, i) => v == null ? [] : [`${(X(i) - step / 2).toFixed(1)},${Y(v).toFixed(1)}`, `${(X(i) + step / 2).toFixed(1)},${Y(v).toFixed(1)}`]);
    if (all.sess > start && m < 1440) plot.push(`<rect x="${PL}" y="0" width="${Math.max(0, X(all.sess - start) - step / 2 - PL)}" height="${MH}" class="prev"/>`);
    const bw = Math.max(1.2, Math.min(14, step * .64));
    if (ind.wema) { const a = stepLine(ind.wema8.slice(start, end)), b = stepLine(ind.wema.slice(start, end)); if (a.length && a.length === b.length) plot.push(`<polygon points="${a.join(' ')} ${b.reverse().join(' ')}" fill="color-mix(in srgb,var(--c30) 15%,transparent)"/>`); plot.push(`<polyline points="${stepLine(ind.wema.slice(start, end)).join(' ')}" fill="none" stroke="var(--c30)" stroke-width="1.6" stroke-dasharray="5 3"/>`); }
    B.forEach((b, i) => { const c = b.c >= b.o ? 'var(--up)' : 'var(--down)', y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c));
      plot.push(`<line x1="${X(i)}" x2="${X(i)}" y1="${Y(b.h)}" y2="${Y(b.l)}" stroke="${c}" stroke-width="1"/><rect x="${X(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(1, y2 - y1)}" fill="${c}" rx=".5"/>`); });
    [['ema21', 'var(--c30)', ''], ['sma50', '#9A6B00', ''], ['sma200', '#B4407A', ''], ['vwap', '#0E8C8C', 'stroke-dasharray="5 3"']].forEach(([k, c, x]) => { if (ind[k]) plot.push(pl(ind[k].slice(start, end), Y, c, x)); });
    if (plan) [[plan.stop, 'Stop', 'var(--down)'], [plan.entry, 'Buy', 'var(--c30)'], ...plan.targets.map(t => [t.p, t.label, 'var(--up)'])].forEach(([p, l, c]) => { plot.push(`<line x1="${PL}" x2="${plotR}" y1="${Y(p)}" y2="${Y(p)}" stroke="${c}" stroke-dasharray="6 4" stroke-width="1.4"/>`); pills.push({ y: Y(p), txt: `${l} ${px2(p)}`, col: c }); });
    const drs = [...(S.draw[tk] || [])]; if (S.pend && this.hover?.main && S.tool !== 'cursor') drs.push({ type: S.tool, a: S.pend, b: { t: B[this.hover.i].t, p: this.hover.p }, ghost: true });
    drs.forEach(d => plot.push(this.drawing(d, xt, Y, plotR, PL, pills)));
    pills.sort((a, b) => a.y - b.y); for (let i = 1; i < pills.length; i++) pills[i].y = Math.max(pills[i].y, pills[i - 1].y + 18);
    const over = pills.length ? pills.at(-1).y - (MH - 9) : 0; if (over > 0) pills.forEach(p => p.y -= over);
    const st = niceStep(hi - lo, Math.max(3, Math.round(MH / 64))), dp = st < .1 ? 2 : st < 1 ? 2 : st < 10 ? 1 : 0;
    for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) { const y = Y(v); if (y < 8 || y > MH - 6) continue;
      plot.push(`<line x1="${PL}" x2="${plotR}" y1="${y}" y2="${y}" class="gl"/>`); if (!pills.some(p => Math.abs(p.y - y) < 14)) gut.push(`<text x="${plotR + 8}" y="${y + 3.5}" class="ax">${v.toFixed(dp)}</text>`); }
    const k = Math.max(1, Math.ceil(110 / step));
    for (let i = 0; i < n; i++) { if ((start + i) % k) continue; const x = X(i); if (x < PL + 34 || x > plotR - 34) continue;
      plot.push(`<line x1="${x}" x2="${x}" y1="0" y2="${H - TA}" class="gl"/>`); gut.push(`<text x="${x}" y="${H - 8}" class="ax" text-anchor="middle">${timeLabel(start + i, N, m)}</text>`); }
    let y0 = MH + GAP;
    if (VH) { const vm = Math.max(...B.map(b => b.v)); gut.push(`<line x1="${PL}" x2="${plotR}" y1="${y0 - GAP / 2}" y2="${y0 - GAP / 2}" class="gl"/>`);
      B.forEach((b, i) => { const h = b.v / vm * (VH - 16); plot.push(`<rect x="${X(i) - bw / 2}" y="${y0 + VH - h}" width="${bw}" height="${h}" fill="${b.c >= b.o ? 'var(--up)' : 'var(--down)'}" opacity=".38"/>`); });
      gut.push(`<text x="${PL + 4}" y="${y0 + 11}" class="ax axh">Volume</text><text x="${plotR + 8}" y="${y0 + 11}" class="ax">${(vm / 1000).toFixed(0)}k</text>`); y0 += VH + GAP; }
    if (RH) { const rs = ind.rsi ? ind.rsi.slice(start, end) : [], Yr = v => y0 + 8 + (100 - v) / 100 * (RH - 16);
      gut.push(`<line x1="${PL}" x2="${plotR}" y1="${y0 - GAP / 2}" y2="${y0 - GAP / 2}" class="gl"/>`, ...[30, 70].map(v => `<line x1="${PL}" x2="${plotR}" y1="${Yr(v)}" y2="${Yr(v)}" stroke="var(--edge)" stroke-dasharray="3 3"/><text x="${plotR + 8}" y="${Yr(v) + 3.5}" class="ax">${v}</text>`));
      if (rs.length) plot.push(pl(rs, Yr, 'var(--ink2)')); gut.push(`<text x="${PL + 4}" y="${y0 + 11}" class="ax axh">RSI 14</text>`); }
    const hv = this.hover;
    if (hv) { plot.push(`<line x1="${X(hv.i)}" x2="${X(hv.i)}" y1="0" y2="${H - TA}" class="xh"/>`); if (hv.main) { plot.push(`<line x1="${PL}" x2="${plotR}" y1="${hv.y}" y2="${hv.y}" class="xh"/>`); pills.push({ y: hv.y, txt: px2(hv.p), col: 'var(--s30)' }); } }
    const pillSvg = pills.map(p => `<rect x="${plotR + 3}" y="${p.y - 8}" width="${PR - 6}" height="16" rx="4" fill="${p.col}"/><text x="${plotR + 8}" y="${p.y + 3.5}" class="axw">${p.txt}</text>`).join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chsvg"><defs><clipPath id="chClip"><rect x="${PL}" y="0" width="${plotR - PL}" height="${H - TA}"/></clipPath></defs>
      <g clip-path="url(#chClip)">${plot.join('')}</g>${gut.join('')}${pillSvg}</svg>`;
    const iv = hv ? start + hv.i : N - 1, b = Ball[iv];
    $('#chRead').innerHTML = [`<span><b>${tk}</b> ${S.tf} · ${timeLabel(iv, N, m)}</span>`, `<span>O ${px2(b.o)} H ${px2(b.h)} L ${px2(b.l)} C <b>${px2(b.c)}</b></span>`, `<span>Vol ${(b.v / 1000).toFixed(0)}k</span>`,
      ...IND.filter(i => ind[i[0]] && ind[i[0]][iv] != null).map(i => `<span style="color:${i[2]}">${i[1]} ${i[0] === 'rsi' ? ind[i[0]][iv].toFixed(0) : px2(ind[i[0]][iv])}</span>`)].join('');
    $('#chHint').textContent = this.hint();
    $('#chNote').innerHTML = notes.map(t => `<div class="bn info mt10" style="border-radius:10px;border:0"><span>${t}</span></div>`).join('');
  },
  drawing(d, xt, Y, xr, xl, pills) {
    const op = d.ghost ? ' opacity=".55"' : '', c = 'var(--c30)';
    if (d.type === 'hline') { const y = Y(d.a.p); pills.push({ y, txt: px2(d.a.p), col: c }); return `<line x1="${xl}" x2="${xr}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="1.4"${op}/>`; }
    if (d.type === 'alert') { const y = Y(d.a.p); pills.push({ y, txt: '◷ ' + px2(d.a.p), col: 'var(--ink2)' }); return `<line x1="${xl}" x2="${xr}" y1="${y}" y2="${y}" stroke="var(--ink2)" stroke-width="1.2" stroke-dasharray="2 3"${op}/>`; }
    const x1 = xt(d.a.t), y1 = Y(d.a.p), x2 = xt(d.b.t), y2 = Y(d.b.p);
    if (d.type === 'line') return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="1.8"${op}/><circle cx="${x1}" cy="${y1}" r="3" fill="${c}"${op}/><circle cx="${x2}" cy="${y2}" r="3" fill="${c}"${op}/>`;
    if (d.type === 'ray') { const k = (y2 - y1) / ((x2 - x1) || 1e-6), xe = x2 >= x1 ? xr : xl; return `<line x1="${x1}" y1="${y1}" x2="${xe}" y2="${y1 + k * (xe - x1)}" stroke="${c}" stroke-width="1.8"${op}/><circle cx="${x1}" cy="${y1}" r="3" fill="${c}"${op}/>`; }
    if (d.type === 'rect') return `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" fill="color-mix(in srgb,var(--c30) 10%,transparent)" stroke="${c}" stroke-width="1.2"${op}/>`;
    if (d.type === 'fib') { const xs = Math.max(xl, Math.min(x1, x2)), span = Math.abs(y1 - y2), each = span * .118;
      return FIB.map(l => { const p = d.b.p - (d.b.p - d.a.p) * l, y = Y(p), key = l === .618 || (span >= 40 && (l === 0 || l === 1)), lab = each >= 13 || key;
        return `<line x1="${xs}" x2="${xr}" y1="${y}" y2="${y}" stroke="${l === .618 || l === .5 ? c : 'var(--ink3)'}" stroke-width="${l === .618 ? 1.6 : 1}"${op}/>${lab ? `<text x="${xs + 4}" y="${y - 4}" class="ax axh">${(l * 100).toFixed(1)}% · ${px2(p)}</text>` : ''}`; }).join('') +
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--ink3)" stroke-dasharray="3 3"${op}/>`; }
    return '';
  },
  pt(e) {
    const svg = $('#chartBox svg'); if (!svg || !this.g) return null;
    const { W, PL, MH, step, n, hi, lo, B } = this.g, r = svg.getBoundingClientRect(), k = W / r.width, x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const i = clamp(Math.round((x - PL) / step - .5), 0, n - 1);
    return { i, x, y, main: y <= MH, p: +(hi - (y - 10) / (MH - 20) * (hi - lo)).toFixed(2), t: B[i].t };
  },
  addDrawing(d) {
    const tk = S.chartTk; (S.draw[tk] ||= []).push(d);
    if (d.type === 'alert') { (S.alerts[tk] ||= []).push({ p: d.a.p, up: d.a.p > POOL[tk].px }); toast(`Alert set: Orbit tells you if ${tk} ${d.a.p > POOL[tk].px ? 'rises' : 'falls'} to $${px2(d.a.p)}.`, 'ok', 2400); }
    S.tool = 'cursor'; S.pend = null; this.refreshChrome();
  },
  clickAt(pt) {
    if (!pt || !pt.main || S.tool === 'cursor') return;
    if (S.tool === 'hline' || S.tool === 'alert') return this.addDrawing({ type: S.tool, a: { t: pt.t, p: pt.p } });
    if (!S.pend) { S.pend = { t: pt.t, p: pt.p }; this.paint(); return; }
    this.addDrawing({ type: S.tool, a: S.pend, b: { t: pt.t, p: pt.p } });
  },
  refreshChrome() { $$('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool)); $('#chartBox')?.classList.toggle('drawing', S.tool !== 'cursor'); $('#chSide').innerHTML = this.side(); this.bindSide(); this.paint(); },
  bindSide() { $$('[data-ral]').forEach(b => b.onclick = () => { const tk = S.chartTk, a = S.alerts[tk].splice(+b.dataset.ral, 1)[0]; S.draw[tk] = (S.draw[tk] || []).filter(d => !(d.type === 'alert' && d.a.p === a.p)); this.refreshChrome(); }); },
  resetView() { S.vis = S.tf === 'D' ? 126 : 90; S.off = 0; },
  mount() {
    bindSeg('modeSeg', v => { S.chartMode = v; render(); Dock.setSees(this.sees()); });
    this.ro?.disconnect();
    if (S.chartMode === 'compare') return Compare.mount();
    this.hover = null;
    const box = $('#chartBox'); let drag = null;
    box.addEventListener('pointerdown', e => { if (S.tool !== 'cursor' || e.button !== 0) return; drag = { x: e.clientX, off: S.off, moved: false }; box.setPointerCapture(e.pointerId); });
    box.addEventListener('pointermove', e => {
      if (drag) { const dx = e.clientX - drag.x; if (Math.abs(dx) > 3) drag.moved = true; if (drag.moved) { S.off = drag.off + Math.round(dx / this.g.step); this.hover = null; this.paint(); return; } }
      this.hover = this.pt(e); this.paint(); });
    box.addEventListener('pointerup', () => { drag = null; });
    box.onmouseleave = () => { if (!drag) { this.hover = null; this.paint(); } };
    box.onclick = e => this.clickAt(this.pt(e));
    box.ondblclick = () => { this.resetView(); this.paint(); };
    box.addEventListener('wheel', e => { e.preventDefault(); const g = this.g; if (!g) return;
      const f = clamp((this.pt(e)?.x - g.PL) / (g.plotR - g.PL), 0, 1), anchor = g.start + f * g.n, nv = clamp(Math.round(S.vis * (e.deltaY > 0 ? 1.15 : .87)), 30, g.N);
      S.vis = nv; S.off = Math.round(g.N - (anchor - f * nv) - nv); this.paint(); }, { passive: false });
    const grip = $('#chGrip'); grip.onpointerdown = e => { const y0 = e.clientY, h0 = S.chH; grip.setPointerCapture(e.pointerId);
      grip.onpointermove = ev => { S.chH = clamp(h0 + ev.clientY - y0, 240, 760); this.paint(); };
      grip.onpointerup = () => { grip.onpointermove = null; }; };
    this.ro = new ResizeObserver(() => requestAnimationFrame(() => this.paint())); this.ro.observe(box);
    bindSeg('tfSeg', v => { S.tf = v; S.pend = null; this.resetView(); this.paint(); Dock.setSees(this.sees()); });
    $$('[data-ind]').forEach(b => b.onclick = () => { S.ind[b.dataset.ind] = !S.ind[b.dataset.ind]; b.classList.toggle('on'); this.paint(); });
    $$('.tool[data-tool]').forEach(b => b.onclick = () => { S.tool = b.dataset.tool; S.pend = null; this.refreshChrome(); });
    $('#tUndo').onclick = () => { const d = (S.draw[S.chartTk] || []).pop(); if (d?.type === 'alert') S.alerts[S.chartTk].pop(); this.refreshChrome(); };
    $('#tClear').onclick = () => { S.draw[S.chartTk] = []; S.alerts[S.chartTk] = []; this.refreshChrome(); toast(`Cleared drawings on ${S.chartTk}.`, 'info', 1600); };
    $('#chAlert').onclick = () => { S.tool = 'alert'; this.refreshChrome(); };
    $('#chPlan').onclick = () => SCREENS.ideas.planFor(S.chartTk);
    if ($('#planLv')) $('#planLv').onclick = () => { S.showPlan = !S.showPlan; $('#planLv .tog').classList.toggle('on', S.showPlan); this.paint(); };
    this.bindSide(); this.paint();
  },
  key(e) { if (e.key === 'Escape' && (S.pend || S.tool !== 'cursor')) { S.pend = null; S.tool = 'cursor'; this.refreshChrome(); return true; } },
  async agent(first) {
    if (!first && S.chartTk === this.lastTk) return; this.lastTk = S.chartTk;
    await Dock.say(S.chartTk === 'IREN' ? 'IREN on 5-minute bars. The gap is the jump at the open, and <b>$18.85</b> is the opening high your breakout plan uses. It\u2019s been flagging just under it.' : `${S.chartTk} on ${S.tf === 'D' ? 'daily' : S.tf} bars. Ask me about a level, or draw on it and I\u2019ll take your drawings into account.`, 320);
    Dock.chips([...(S.chartTk === 'IREN' ? [{ t: 'Show plan levels', fn: () => { S.showPlan = true; render(); Dock.say('Plan levels are on: buy at $18.85, stop $18.05, targets $19.85 and $20.85.'); } }] : []),
      { t: 'Is it diverging from its sector?', fn: () => { S.chartMode = 'compare'; render(); const r = cmpRefs(S.chartTk), sc = r.find(x => roleOf(S.chartTk, x) === 'Sector') || r[0], d = divergence(S.chartTk, sc, S.cmpP); Dock.say(`Over ${CPN[S.cmpP]}, ${S.chartTk} is ${pct(d.ra)} and ${sc} is ${pct(d.rb)}, a gap of <b>${Math.abs(d.diff).toFixed(0)} points</b>. ${d.flag}. These numbers come from Orbit\u2019s engine.`); } }]);
  }
};
/* ============================== PLANS: watching ============================== */
const Watching = {
  rows() {
    const out = [...S.watch], L = S.live;
    const iren = S.armed ? 'armed' : L && !L.closed ? 'live' : S.watchIren ? 'watching' : null;
    if (iren && !out.some(w => w.tk === 'IREN')) out.unshift({ tk: 'IREN', t: 'Opening high breakout', trig: iren === 'live' ? 'In the trade' : 'Buys when it trades $18.85', dist: iren === 'live' ? '—' : `${Math.max(0, Math.round((18.85 - S.px) * 100))}¢ away`, st: iren, risk: S.risk });
    return out;
  },
  pill(st) { return { watching: '<span class="bdg">Watching</span>', close: '<span class="bdg co">Getting close</span>', armed: '<span class="bdg armed"><span class="ci"></span>Armed at IBKR</span>', live: '<span class="bdg ok"><span class="ci"></span>Live</span>' }[st]; },
  html() {
    const r = this.rows();
    return `<div class="card mt14" id="watchCard"><div class="row sb"><div><div class="h2">Plans you\u2019re watching</div><div class="mut" style="font-size:12px;margin-top:2px">Orbit checks these on every price update and tells you when one gets close. Nothing is sent until you arm or place it.</div></div><span class="faint" style="font-size:11px">${r.length} plans</span></div>
      <table class="tbl mt10"><tr><th>Ticker</th><th>Playbook</th><th>Trigger</th><th>Distance</th><th style="text-align:right">Risk</th><th>Status</th><th></th></tr>
      ${r.map(w => `<tr><td><b>${w.tk}</b></td><td>${w.t}</td><td class="mut">${w.trig}</td><td class="num">${w.dist}</td><td class="num" style="text-align:right">${money(w.risk)}</td><td>${this.pill(w.st)}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn sm ghost" data-wchart="${w.tk}">Chart</button>${w.tk === 'IREN' ? `<button class="btn sm" data-wopen>${w.st === 'live' ? 'Open trade' : 'Open'}</button>` : `<button class="x" data-wrm="${w.tk}" title="Stop watching">×</button>`}</td></tr>`).join('')}</table></div>`;
  },
  bind() {
    $$('[data-wchart]').forEach(b => b.onclick = () => openChart(b.dataset.wchart));
    $$('[data-wopen]').forEach(b => b.onclick = () => go(S.live && !S.live.closed ? 'live' : 'console'));
    $$('[data-wrm]').forEach(b => b.onclick = () => { S.watch = S.watch.filter(w => w.tk !== b.dataset.wrm); toast(`Stopped watching ${b.dataset.wrm}.`, 'info', 1600); $('#watchCard').outerHTML = this.html(); this.bind(); });
  }
};
const _plHtml = SCREENS.plans.html, _plMount = SCREENS.plans.mount, _plBind = SCREENS.plans.bindCards;
SCREENS.plans.html = function () { return _plHtml.call(this) + Watching.html(); };
SCREENS.plans.mount = function () { _plMount.call(this); Watching.bind(); };
SCREENS.plans.bindCards = function () {
  _plBind.call(this);
  const ic = $('#cards .card[data-id="intraday"] .h2'); if (ic && !$('#cards .pbb')) ic.insertAdjacentHTML('beforebegin', '<div class="mt10"><span class="bdg pbb">Playbook: Opening high breakout</span></div>');
  $$('[data-load]').forEach(b => { if (b.nextElementSibling?.dataset.watch) return; b.insertAdjacentHTML('afterend', `<button class="btn" data-watch="${b.dataset.load}">Watch it</button>`); });
  $$('[data-watch]').forEach(b => b.onclick = e => { e.stopPropagation(); S.planKind = b.dataset.watch; S.watchIren = true; toast('<b>Watching.</b> Orbit tells you when IREN gets close to $18.85.', 'ok', 2200); $('#watchCard').outerHTML = Watching.html(); Watching.bind(); });
};

/* ============================== LIVE: holdings ============================== */
const hv = h => h.q * h.px * (h.mult || 1), hu = h => (h.px - h.avg) * h.q * (h.mult || 1), hd = h => hv(h) * h.chg / (100 + h.chg), hp = h => (h.px / h.avg - 1) * 100;
const Holdings = {
  stopOf(tk) { return S.orders.find(o => o.tk === tk && o.kind === 'protect'); },
  items() {
    const it = S.hold.map(h => ({ ...h, v: hv(h), u: hu(h), d: hd(h), pc: hp(h) })), L = S.live;
    if (L && !L.closed && L.plan.id !== 'options') it.push({ tk: 'IREN', label: 'IREN · Orbit trade', ty: 'Stock', q: L.qtyOpen, avg: L.avg, px: S.px, v: L.qtyOpen * S.px, u: (S.px - L.avg) * L.qtyOpen, d: (S.px - L.avg) * L.qtyOpen, pc: (S.px / L.avg - 1) * 100, orbit: true });
    return it;
  },
  html() {
    const it = this.items(), others = it.filter(x => !x.orbit), mv = it.reduce((a, b) => a + b.v, 0), day = it.reduce((a, b) => a + b.d, 0);
    return `<div class="card mt14" id="holdCard">
      <div class="row sb" style="flex-wrap:wrap;gap:10px"><div><div class="h2">Everything else you hold</div><div class="mut" style="font-size:12px;margin-top:2px">Positions Orbit didn\u2019t open, live from IB Gateway.</div></div>${seg('allocSeg', [['list', 'List'], ['tree', 'Treemap'], ['lead', 'Leaders']], S.allocView)}</div>
      <div class="acct mt14">${[['Account value', money(mv + S.cash)], ['Invested', money(mv)], ['Cash', money(S.cash)], ['Buying power', money(S.cash * 2)], ['Today', money(day, true), day >= 0 ? 'up' : 'down']].map(k => `<div><div class="lbl">${k[0]}</div><div class="num ${k[2] || ''}" style="font-size:17px;font-weight:600;margin-top:2px">${k[1]}</div></div>`).join('')}</div>
      <div id="allocBody" class="mt14">${S.allocView === 'tree' ? this.tree() : S.allocView === 'lead' ? this.lead(it) : this.list(others)}</div></div>
      ${this.orders()}`;
  },
  list(it) {
    if (!it.length) return '<div class="empty">Nothing else held.</div>';
    return `<table class="tbl"><tr><th>Holding</th><th style="text-align:right">Qty</th><th style="text-align:right" class="hs">Avg cost</th><th style="text-align:right">Price</th><th style="text-align:right">Value</th><th style="text-align:right">Gain</th><th style="text-align:right" class="hs">Today</th><th style="text-align:right">vs S&P · 3M</th><th>Protection</th><th></th></tr>
      ${it.map(h => { const st = this.stopOf(h.tk); return `<tr><td><b>${h.label || h.tk}</b>${h.ty === 'Option' ? ' <span class="bdg opt">Option</span>' : ''}<div class="faint" style="font-size:10.5px">${h.ty === 'Option' ? `<span class="${h.dte <= 10 ? 'warnt' : ''}">Expires ${h.exp} · ${h.dte} days left</span> · each covers 100 shares` : h.ty}</div></td><td class="num" style="text-align:right">${h.q}</td><td class="num hs" style="text-align:right">$${px2(h.avg)}</td><td class="num" style="text-align:right">$${px2(h.px)}</td><td class="num" style="text-align:right">${money(h.v)}</td>
        <td class="num ${h.u >= 0 ? 'up' : 'down'}" style="text-align:right;font-weight:600">${money(h.u, true)}<div style="font-size:10.5px;font-weight:500">${pct(h.pc)}</div></td><td class="num hs ${h.d >= 0 ? 'up' : 'down'}" style="text-align:right">${money(h.d, true)}</td>
        ${(() => { const r = relVs(h.tk, 'SPY'); return `<td style="text-align:right"><button class="vs ${r >= 2 ? 'up' : r <= -2 ? 'down' : ''}" data-hvs="${h.tk}" title="${h.ty === 'Option' ? 'The option\u2019s stock, ' + h.tk + ', against the S&P 500' : 'Open Compare'}">${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(0)} pts${h.ty === 'Option' ? ' · ' + h.tk : ''}</button></td>`; })()}
        <td>${st ? `<span class="mut" style="font-size:12px">${st.what.replace(/^Stop: sell \d+ at /, 'Stop at ')}</span>` : h.ty === 'Option' ? `<span class="faint" style="font-size:12px">At risk: ${money(h.v)}, its value</span>` : '<span class="bdg warn"><span class="dm"></span>No stop</span>'}</td>
        <td><div class="tacts"><button class="btn sm" data-hplan="${h.tk}">${st || h.ty === 'Option' ? 'Make a plan' : 'Protect it'}</button><button class="btn sm danger" data-hclose="${h.tk}" data-agent-hidden>Close</button></div></td></tr>`; }).join('')}</table>`;
  },
  tree() {
    return `<div id="tmBox" class="tmbox"></div><div class="tminfo" id="tmInfo">Point at a box for details. Size is market value, color is gain since you bought it, stripes mark options.</div><div class="tmleg" id="tmLeg"></div>`;
  },
  name(z) { return z.orbit ? 'IREN · Orbit trade' : z.label || z.tk; },
  info(z) { return `<b>${this.name(z)}</b> · ${z.ty}${z.ty === 'Option' ? ` · expires ${z.exp} (${z.dte} days)` : ''} · ${money(z.v)} · <span class="${z.pc >= 0 ? 'up' : 'down'}">${pct(z.pc)}</span> · ${money(z.u, true)}`; },
  paintTree() {
    const box = $('#tmBox'); if (!box) return;
    const it = this.items().filter(x => x.v > 0).sort((a, b) => b.v - a.v), W = Math.max(300, Math.floor(box.clientWidth)), H = clamp(Math.round(W * .42), 260, 440), G = 3, out = [];
    let rest = it.map(z => ({ ...z, val: z.v })), x = 0, y = 0, w = W, h = H;
    while (rest.length) {
      const total = rest.reduce((a, b) => a + b.val, 0), horiz = w >= h, side = horiz ? h : w; let row = [], best = Infinity;
      for (const q of rest) { const rr = [...row, q], s = rr.reduce((a, b) => a + b.val, 0), len = s / total * (horiz ? w : h), worst = Math.max(...rr.map(z => { const l2 = z.val / s * side; return Math.max(len / l2, l2 / len); })); if (worst > best) break; best = worst; row = rr; }
      const s = row.reduce((a, b) => a + b.val, 0), len = s / total * (horiz ? w : h); let off = 0;
      row.forEach(z => { const l2 = z.val / s * side; out.push(horiz ? { ...z, x, y: y + off, w: len, h: l2 } : { ...z, x: x + off, y, w: l2, h: len }); off += l2; });
      if (horiz) { x += len; w -= len; } else { y += len; h -= len; } rest = rest.slice(row.length);
    }
    const col = z => `color-mix(in srgb,${z.pc >= 0 ? 'var(--up)' : 'var(--down)'} ${Math.round(16 + Math.min(1, Math.abs(z.pc) / 40) * 46)}%,var(--card))`;
    const fits = (txt, px, room) => txt.length * px + 20 <= room;
    box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="tmap"><defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="var(--ink)" stroke-opacity=".16" stroke-width="2.5"/></pattern></defs>
      ${out.map((z, i) => { const rw = Math.max(0, z.w - G), rh = Math.max(0, z.h - G), nm = this.name(z), sub = `${money(z.v)} · ${pct(z.pc)}`;
        const showN = rh >= 28 && fits(nm, 7.6, rw), showS = showN && rh >= 50 && fits(sub, 6.4, rw), showT = !showN && rh >= 22 && fits(z.tk, 7.6, rw);
        return `<g data-ti="${i}"><rect x="${z.x + G / 2}" y="${z.y + G / 2}" width="${rw}" height="${rh}" rx="7" fill="${col(z)}"/>${z.ty === 'Option' ? `<rect x="${z.x + G / 2}" y="${z.y + G / 2}" width="${rw}" height="${rh}" rx="7" fill="url(#hatch)"/>` : ''}
          ${showN ? `<text x="${z.x + 12}" y="${z.y + 22}" class="tt">${nm}</text>` : showT ? `<text x="${z.x + 10}" y="${z.y + 19}" class="tt">${z.tk}</text>` : ''}${showS ? `<text x="${z.x + 12}" y="${z.y + 40}" class="ts">${sub}</text>` : ''}</g>`; }).join('')}</svg>`;
    $$('#tmBox g[data-ti]').forEach(g => { g.onmouseenter = () => { $('#tmInfo').innerHTML = this.info(out[+g.dataset.ti]); }; });
    box.onmouseleave = () => { $('#tmInfo').textContent = 'Point at a box for details. Size is market value, color is gain since you bought it, stripes mark options.'; };
    const tot = it.reduce((a, b) => a + b.v, 0);
    $('#tmLeg').innerHTML = it.map(z => `<div class="li"><i style="background:${col(z)}" class="${z.ty === 'Option' ? 'opt' : ''}"></i><b class="ell">${this.name(z)}</b>${z.ty === 'Option' ? '<span class="bdg opt">Option</span>' : ''}<span class="num">${money(z.v)}</span><span class="num faint">${(z.v / tot * 100).toFixed(0)}%</span><span class="num ${z.pc >= 0 ? 'up' : 'down'}">${pct(z.pc)}</span></div>`).join('');
  },  lead(it) {
    const key = { pct: z => z.pc, gain: z => z.u, size: z => z.v }[S.leadSort], s = [...it].sort((a, b) => key(b) - key(a)), top = s.slice(0, 3), rest = s.slice(3);
    const shown = z => S.leadSort === 'pct' ? pct(z.pc) : S.leadSort === 'gain' ? money(z.u, true) : money(z.v);
    return `<div class="row sb"><span class="faint" style="font-size:11.5px">Ranked by</span>${seg('leadSeg', [['pct', '% gain'], ['gain', '$ gain'], ['size', 'Size']], S.leadSort)}</div>
      <div class="pod mt10">${[1, 0, 2].filter(i => top[i]).map(i => { const z = top[i]; return `<div class="pd p${i + 1}"><div class="rk">#${i + 1}</div><b>${this.name(z)}</b>${z.ty === 'Option' ? '<div><span class="bdg opt">Option</span></div>' : ''}<div class="num ${z.u >= 0 ? 'up' : 'down'}" style="font-size:18px;font-weight:600">${shown(z)}</div><div class="faint num" style="font-size:11px">${money(z.v)}</div></div>`; }).join('')}</div>
      <table class="tbl mt10"><tr><th>Holding</th><th>Type</th><th style="text-align:right">Value</th><th style="text-align:right">${{ pct: '% gain', gain: '$ gain', size: 'Size' }[S.leadSort]}</th></tr>${rest.map(z => `<tr><td><b>${this.name(z)}</b>${z.ty === 'Option' ? ' <span class="bdg opt">Option</span>' : ''}</td><td class="mut">${z.ty}${z.ty === 'Option' ? ` · ${z.dte} days left` : ''}</td><td class="num" style="text-align:right">${money(z.v)}</td><td class="num" style="text-align:right">${shown(z)}</td></tr>`).join('')}</table>`;
  },
  orders() {
    return `<div class="card mt14" id="ordCard"><div class="row sb"><div><div class="h2">Working orders</div><div class="mut" style="font-size:12px;margin-top:2px">Placed outside Orbit, in TWS. You can cancel them here; editing stays in TWS.</div></div></div>
      <table class="tbl mt10">${S.orders.map(o => `<tr><td><b>${o.tk}</b></td><td>${o.what}</td><td class="mut mono" style="font-size:11px">${o.tif}</td>
        <td style="text-align:right;width:210px">${o.kind === 'entry' ? `<button class="btn sm" data-ocancel="${o.id}" data-agent-hidden>Cancel <span class="faint" style="font-size:10.5px">(cuts risk)</span></button>` : `<button class="fire small ready" data-oprot="${o.id}" data-agent-hidden style="width:auto;padding:7px 12px;background:var(--raise);color:var(--ink);box-shadow:none"><span class="fill" style="background:color-mix(in srgb,var(--warn) 30%,transparent)"></span><div class="t" style="font-size:12px">Hold to remove stop</div></button>`}</td></tr>`).join('') || '<tr><td class="faint">No working orders.</td></tr>'}</table></div>`;
  },
  repaint() { const y = $('#ws').scrollTop; $('#holdCard').outerHTML = ''; $('#ordCard')?.remove(); $('#holdSlot').innerHTML = this.html(); this.mount(); $('#ws').scrollTop = y; },
  mount() {
    this.ro?.disconnect(); if ($('#tmBox')) { this.paintTree(); this.ro = new ResizeObserver(() => requestAnimationFrame(() => this.paintTree())); this.ro.observe($('#tmBox')); }
    bindSeg('allocSeg', v => { S.allocView = v; this.repaint(); });
    if ($('#leadSeg')) bindSeg('leadSeg', v => { S.leadSort = v; this.repaint(); });
    $$('[data-hvs]').forEach(b => b.onclick = () => openChart(b.dataset.hvs, 'compare'));
    $$('[data-hclose]').forEach(b => b.onclick = () => { const h = S.hold.find(x => x.tk === b.dataset.hclose); S.hold = S.hold.filter(x => x !== h); S.orders = S.orders.filter(o => o.tk !== h.tk); S.cash += hv(h);
      toast(`Sold ${h.q} ${h.label || h.tk} at market · ${money(hu(h), true)}.`, 'info'); this.repaint(); });
    $$('[data-hplan]').forEach(b => b.onclick = () => { const h = S.hold.find(x => x.tk === b.dataset.hplan); S.thesis = `I hold ${h.q} ${h.label || h.tk} bought at $${px2(h.avg)}, now $${px2(h.px)}. Help me protect it with a stop and a target.`; go('ideas'); });
    $$('[data-ocancel]').forEach(b => b.onclick = () => { const o = S.orders.find(x => x.id === +b.dataset.ocancel); S.orders = S.orders.filter(x => x !== o); toast(`Cancelled: ${o.tk} ${o.what.toLowerCase()}.`, 'info'); this.repaint(); });
    $$('[data-oprot]').forEach(b => holdToPlace(b, { onDone: () => { const o = S.orders.find(x => x.id === +b.dataset.oprot); S.orders = S.orders.filter(x => x !== o); toast(`Removed the ${o.tk} stop. ${o.tk} has no protection now.`, 'warn'); this.repaint(); } }));
  }
};
const _lvHtml = SCREENS.live.html, _lvMount = SCREENS.live.mount;
SCREENS.live.html = function () { return _lvHtml.call(this) + `<div id="holdSlot">${Holdings.html()}</div>`; };
SCREENS.live.mount = function () { _lvMount.call(this); Holdings.mount(); };

/* ============================== shell hooks ============================== */
const _commands = commands;
commands = function () { return [..._commands(), ['Go to', 'Playbooks', () => go('playbooks')], ...['IREN', 'NVDA', 'MSFT'].map(tk => ['Compare', `${tk} against market, sector and peers`, () => openChart(tk, 'compare')]), ...Object.keys(POOL).filter(k => !['VIX'].includes(k)).map(tk => ['Chart', `${tk} · ${POOL[tk].nm}`, () => openChart(tk)])]; };
const _runDemo = runDemo;
runDemo = function (d) {
  const startLive = () => { S.plansReady = true; S.thesis = 'IREN reported yesterday, up 15% premarket. I\u2019m bullish and willing to risk $500.'; const p = Engine.intraday(S.risk); S.live = { plan: p, qty: p.qty, qtyOpen: p.qty, avg: 18.86, realized: 0, stop: p.stop, t1done: false, closed: false, partial: null, forks: null, events: [{ tm: '10:03 AM', tx: `Filled ${p.qty} shares at $18.86`, mc: 'var(--c30)' }] }; S.px = 19.4; };
  const X = {
    look: () => { S.lookTab = 'all'; go('ideas'); },
    leaders: () => { S.lookTab = 'leaders'; go('ideas'); },
    chart: () => { S.chartTk = 'IREN'; S.tf = '5m'; S.chartMode = 'chart'; S.showPlan = false; const { B, sess } = barsFor('IREN', '5m'); S.draw.IREN = [{ type: 'hline', a: { t: B[sess + 4].t, p: 18.85 } }]; go('chart'); },
    planlevels: () => { S.chartTk = 'IREN'; S.tf = '5m'; S.chartMode = 'chart'; S.showPlan = true; S.ind.rsi = true; go('chart'); },
    compare: () => { S.chartTk = 'IREN'; S.chartMode = 'compare'; go('chart'); },
    lagging: () => { S.chartTk = 'MSFT'; S.chartMode = 'compare'; go('chart'); },
    watching: () => { S.plansReady = true; S.thesis = 'IREN reported yesterday, up 15% premarket. I\u2019m bullish and willing to risk $500.'; S.watchIren = true; go('plans'); setTimeout(() => $('#watchCard')?.scrollIntoView({ block: 'center' }), 300); },
    holdings: () => { startLive(); go('live'); setTimeout(() => $('#holdSlot')?.scrollIntoView({ block: 'start' }), 300); },
    treemap: () => { startLive(); S.allocView = 'tree'; go('live'); setTimeout(() => $('#holdSlot')?.scrollIntoView({ block: 'start' }), 300); },
    podium: () => { startLive(); S.allocView = 'lead'; go('live'); setTimeout(() => $('#holdSlot')?.scrollIntoView({ block: 'start' }), 300); },
    setups: () => { S.lookTab = 'setups'; go('ideas'); },
    playbooks: () => go('playbooks'),
    pullback: () => { S.chartTk = 'NVDA'; S.tf = 'D'; S.vis = 126; S.off = 0; S.chartMode = 'chart'; S.ind.wema = true; S.ind.sma50 = true; S.ind.sma200 = true; S.ind.vwap = false; S.ind.ema21 = false; go('chart'); },
    shorthist: () => { S.histCap = 120; S.chartTk = 'CRWD'; S.tf = 'D'; S.vis = 126; S.off = 0; S.chartMode = 'chart'; S.ind.sma200 = true; S.ind.wema = true; go('chart'); },
  };
  (X[d] || (() => _runDemo(d)))();
};

/* ============================== PLAYBOOKS ============================== */
/* Draft rules from the user's description. Numbers in {braces} are editable on the Playbooks page. In the real app the
   Python engine evaluates these on completed daily and weekly bars; the agent can explain them but never edits them. */
const PB = [
  { id: 'lpb', name: 'Leader pullback', short: 'Strong leader pulls back to the 8–9 week EMA', when: ['healthy', 'selective'], hold: 'Swing · days to weeks',
    params: { rs: 90, zone: 2, atr: 1 },
    who: ['RS rating at least {rs}', 'Above its 50-day and 200-day averages', '50-day average above the 200-day'],
    entry: 'Price comes within {zone}% of the 8–9 week EMA', confirm: 'A daily close back above the prior day\u2019s high', stop: '{atr} ATR below the 9-week EMA', target: 'The prior high, then trail along the 9-week EMA' },
  { id: 'bo', name: 'Breakout', short: 'Clears a base high on volume', when: ['healthy'], hold: 'Intraday or swing',
    params: { base: 15, vol: 1.5, maxStop: 8 },
    who: ['Base of at least {base} days', 'Above its 50-day average'],
    entry: 'Buy-stop just above the base high, armed at IBKR', confirm: 'Volume at least {vol}× average on the break', stop: 'Below the base low, at most {maxStop}% away', target: '2R, then 3R' },
  { id: 'bor', name: 'Breakout and retest', short: 'Comes back to the breakout level and holds', when: ['healthy', 'selective'], hold: 'Swing',
    params: { days: 10, near: 1, atr: 0.5 },
    who: ['Broke out in the last {days} days', 'Above its 50-day average'],
    entry: 'Limit at the old base high, within {near}%', confirm: 'Holds the level on a daily close', stop: '{atr} ATR below the level', target: 'The breakout high, then 2R' },
  { id: 'ath', name: 'All-time-high retest', short: 'Comes back to the old all-time high', when: ['healthy', 'selective'], hold: 'Swing · weeks',
    params: { weeks: 8, near: 2, stopPct: 3 },
    who: ['Made a new all-time high in the last {weeks} weeks', 'RS rating at least 80'],
    entry: 'Pulls back within {near}% of the previous all-time high', confirm: 'A daily close back above it', stop: '{stopPct}% below the old high', target: 'The new high, then trail' },
  { id: 'orb', name: 'Opening high breakout', short: 'Day trade on a gap, through the opening high', when: ['healthy', 'selective'], hold: 'Intraday · out by 3:55 PM',
    params: { spread: 3 },
    who: ['Gapped on news or earnings', 'Above VWAP'],
    entry: 'Buy-stop at the opening high, armed at IBKR', confirm: 'Spread {spread}¢ or less', stop: 'Below the flag low', target: 'Half at target 1, the rest at target 2' }
];
S.posture = 'selective'; S.pbPost = 'selective'; S.pbOffOpen = false;
const POSTURE = { healthy: 'Healthy', selective: 'Selective', defensive: 'Defensive' };
const pbOn = (pb, post = S.posture) => pb.when.includes(post);
const pbName = id => PB.find(p => p.id === id).name;
const SETUPS = {
  lpb: [{ tk: 'NVDA', st: 'zone', ck: ['RS 99', 'Above 50/200'], at: '1.1% above the 9-wk EMA ($180.40)', plan: true }, { tk: 'CRWD', st: 'zone', ck: ['RS 94', 'Above 50/200'], at: '1.8% above the 9-wk EMA ($395.10)' }, { tk: 'ANET', st: 'setting', ck: ['RS 97', 'Above 50/200'], at: '6.4% above the 9-wk EMA, still extended' }],
  bo: [{ tk: 'PLTR', st: 'setting', ck: ['22-day base', 'Above 50-day'], at: '1.5% under the base high $75.20' }, { tk: 'SMCI', st: 'setting', ck: ['17-day base'], at: '3.0% under the base high $45.40' }],
  bor: [{ tk: 'HOOD', st: 'zone', ck: ['Broke out 4 days ago', 'Above 50-day'], at: '25¢ above the old high $41.60', plan: true }],
  ath: [{ tk: 'AVGO', st: 'zone', ck: ['New high 3 wks ago', 'RS 93'], at: '1.5% above the old high $238.10' }, { tk: 'TSM', st: 'setting', ck: ['New high 5 wks ago', 'RS 92'], at: '4.2% above the old high $193.20' }],
  orb: [{ tk: 'IREN', st: 'zone', ck: ['Earnings gap +15%', 'Above VWAP'], at: `${Math.max(0, Math.round((18.85 - S.px) * 100))}¢ under the opening high $18.85` }]
};
const PBSTATS = { lpb: [14, .64, 1.6, 'Healthy'], bo: [11, .45, .9, 'Healthy'], bor: [8, .62, 1.3, 'Selective'], ath: [6, .67, 1.8, 'Selective'], orb: [17, .53, .7, 'Healthy'] };
const ruleTxt = (pb, s, edit) => s.replace(/\{(\w+)\}/g, (_, k) => edit ? `<input class="inp mini mono" data-pb="${pb.id}" data-k="${k}" value="${pb.params[k]}">` : `<b class="num">${pb.params[k]}</b>`);
const setupsBody = () => {
  const on = PB.filter(p => pbOn(p)), off = PB.filter(p => !pbOn(p));
  const sec = pb => `<div class="pbsec"><div class="row sb"><div><b>${pb.name}</b> <span class="faint" style="font-size:11.5px">· ${pb.short}</span></div><span class="faint" style="font-size:11px">${SETUPS[pb.id].length} name${SETUPS[pb.id].length === 1 ? '' : 's'}</span></div>
    ${SETUPS[pb.id].map(s => SCREENS.ideas.row(s.tk, s.at, [s.st === 'zone' ? chip('z', 'In the zone') : chip('', 'Setting up'), ...(s.plan ? [chip('a', 'You have a plan')] : []), ...s.ck.map(c => `<span class="ck">✓ ${c}</span>`), (() => { const sc = SECT[POOL[s.tk].sec], d = sc ? relVs(s.tk, sc) : 0; return sc ? `<button class="vs ${d >= 2 ? 'up' : d <= -2 ? 'down' : ''}" data-vs="${s.tk}">${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)} pts vs ${sc} · 3M</button>` : ''; })()])).join('')}</div>`;
  return `<div class="pbbar"><span>Today\u2019s market is <b>${POSTURE[S.posture].toLowerCase()}</b>, so ${on.length} of your ${PB.length} playbooks are on.</span><button class="btn sm ghost" onclick="go('playbooks')">Edit playbooks</button></div>
    ${on.length ? on.map(sec).join('') : '<div class="empty">No playbooks are on in this market. Orbit keeps watching your open plans.</div>'}
    ${off.length ? `<div class="pboff"><button class="btn sm ghost" id="pbOffBtn">${S.pbOffOpen ? 'Hide' : 'Show'} what\u2019s off today: ${off.map(p => p.name).join(', ')}</button>${S.pbOffOpen ? `<div class="dim">${off.map(sec).join('')}</div>` : ''}</div>` : ''}
    <div class="faint mt10" style="font-size:11px">Checked across the RS leaders list and your watchlists, on completed daily and weekly bars.</div>`;
};
SCREENS.playbooks = {
  sees: () => '<b>Playbooks</b> · your setup rules. I can read and explain them, not change them.',
  html() {
    const post = S.pbPost;
    return `<div class="ph"><div><h1>Your playbooks</h1><p>Each playbook is one way you trade: who qualifies, where you get in, where you\u2019re wrong, and which markets it\u2019s for. Orbit\u2019s engine checks the rules. The agent only explains them.</p></div>
      <div class="row"><button class="btn ghost" onclick="go('plans')">Back to plans</button><button class="btn pri" onclick="SCREENS.ideas && (S.lookTab='setups', go('ideas'))">See today\u2019s setups</button></div></div>
    <div class="card row sb" style="flex-wrap:wrap;gap:10px"><div><div class="h3">Which playbooks run in each market</div><div class="mut" style="font-size:12px;margin-top:2px">Today\u2019s market is <b>${POSTURE[S.posture].toLowerCase()}</b>. Pick a market to see or change what runs in it.</div></div>${seg('postSeg', Object.entries(POSTURE), post)}</div>
    ${post === 'defensive' && !PB.some(p => pbOn(p, post)) ? '<div class="bn info mt14" style="border-radius:10px;border:0"><span>Nothing runs in a defensive market right now. Orbit still lists setups as \u201coff today\u201d and keeps watching your open plans.</span></div>' : ''}
    <div class="grid2 mt14">${PB.map(pb => { const st = PBSTATS[pb.id], on = pbOn(pb, post); return `<div class="card pbc ${on ? '' : 'offc'}">
      <div class="row sb"><div><div class="h2">${pb.name}</div><div class="mut" style="font-size:12px;margin-top:2px">${pb.short} · ${pb.hold}</div></div>
        <span class="row" style="gap:8px;font-size:12px;cursor:pointer" data-pbt="${pb.id}"><span class="tog ${on ? 'on' : ''}"></span>${on ? 'On' : 'Off'} in ${POSTURE[post].toLowerCase()}</span></div>
      <div class="rules mt10">
        <div><span class="lbl">Who qualifies</span><ul>${pb.who.map(w => `<li>${ruleTxt(pb, w, true)}</li>`).join('')}</ul></div>
        <div><span class="lbl">Entry</span><p>${ruleTxt(pb, pb.entry, true)}</p></div>
        <div><span class="lbl">Confirmation</span><p>${ruleTxt(pb, pb.confirm, true)}</p></div>
        <div><span class="lbl">Stop</span><p>${ruleTxt(pb, pb.stop, true)}</p></div>
        <div><span class="lbl">Target</span><p>${ruleTxt(pb, pb.target, true)}</p></div>
      </div>
      <div class="well mt10 row sb" style="font-size:12px"><span>Your last 90 days: <b class="num">${st[0]}</b> trades · <b class="num">${Math.round(st[1] * 100)}%</b> wins · <b class="num ${st[2] >= 1 ? 'up' : ''}">${st[2].toFixed(1)}R</b> average</span><span class="faint">Best in ${st[3].toLowerCase()} markets</span></div>
    </div>`; }).join('')}
    <div class="card empty" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px"><b style="color:var(--ink)">Add a playbook</b><span style="font-size:12px">Describe the setup in your words. The agent drafts the rules; nothing runs until you approve them.</span><button class="btn sm" id="pbNew">Describe a setup</button></div></div>`;
  },
  mount() {
    bindSeg('postSeg', v => { S.pbPost = v; render(); });
    $$('[data-pbt]').forEach(el => el.onclick = () => { const pb = PB.find(p => p.id === el.dataset.pbt), post = S.pbPost; pb.when = pbOn(pb, post) ? pb.when.filter(x => x !== post) : [...pb.when, post]; render(); toast(`${pb.name} is ${pbOn(pb, post) ? 'on' : 'off'} in ${POSTURE[post].toLowerCase()} markets.`, 'ok', 1800); });
    $$('input[data-pb]').forEach(i => i.onchange = () => { const pb = PB.find(p => p.id === i.dataset.pb), v = +i.value; if (!(v > 0)) { i.value = pb.params[i.dataset.k]; return; } pb.params[i.dataset.k] = v; toast(`Saved. Orbit re-checks today\u2019s ${pb.name.toLowerCase()} setups.`, 'ok', 1800); });
    $('#pbNew').onclick = () => { $('#composer').value = 'New playbook: '; $('#composer').focus(); Dock.say('Tell me the setup the way you\u2019d explain it to a friend: what the stock looks like, where you get in, and where you\u2019re wrong. I\u2019ll draft the rules for you to check.', 250); };
  },
  async agent(first) { if (first) await Dock.say('These are your playbooks. I drafted the numbers from how you described your styles, so check them. The engine checks the rules on completed daily and weekly bars, and I can\u2019t change them.', 350); }
};
ROUTES.playbooks = 'plans';
const PbStats = {
  html() { return `<div class="card mt14"><div class="row sb"><div><div class="h2">By playbook</div><div class="mut" style="font-size:12px;margin-top:2px">Which of your styles works, and in which market. From trades placed through Orbit, last 90 days.</div></div><button class="btn sm ghost" onclick="go('playbooks')">Playbooks</button></div>
    <table class="tbl mt10"><tr><th>Playbook</th><th style="text-align:right">Trades</th><th style="text-align:right">Win rate</th><th style="text-align:right">Average</th><th>Works best in</th></tr>
    ${PB.map(pb => { const s = PBSTATS[pb.id]; return `<tr><td><b>${pb.name}</b></td><td class="num" style="text-align:right">${s[0]}</td><td class="num" style="text-align:right">${Math.round(s[1] * 100)}%</td><td class="num ${s[2] >= 1 ? 'up' : ''}" style="text-align:right;font-weight:600">${s[2].toFixed(1)}R</td><td class="mut">${s[3]} markets</td></tr>`; }).join('')}</table>
    <div class="faint mt6" style="font-size:11px">R is the result divided by what the plan risked. 1R means you made what you risked.</div></div>`; }
};

/* ============================== COMPARE (divergence) ============================== */
Object.assign(POOL, {
  IGV: { nm: 'Software ETF', px: 98.40, ch: 0.5, sec: 'Sector ETF' }, XLF: { nm: 'Financials ETF', px: 51.20, ch: 0.3, sec: 'Sector ETF' },
  WGMI: { nm: 'Bitcoin miners ETF', px: 31.70, ch: 6.1, sec: 'Sector ETF' }, MARA: { nm: 'MARA Holdings', px: 21.30, ch: 4.2, sec: 'Bitcoin miners / AI hosting', rs: 70 },
  CORZ: { nm: 'Core Scientific', px: 16.85, ch: 8.9, sec: 'Bitcoin miners / AI hosting', rs: 91 }
});
const SECT = { Semiconductors: 'SMH', Software: 'IGV', Brokers: 'XLF', 'Bitcoin miners / AI hosting': 'WGMI', Networking: 'SMH', Hardware: 'SMH' };
const PEERS = { IREN: ['CORZ', 'MARA'], NVDA: ['AMD', 'AVGO'], AMD: ['NVDA'], PLTR: ['CRWD'], HOOD: ['COIN'], CRWD: ['PLTR'], AVGO: ['NVDA'], TSM: ['NVDA'], ANET: ['AVGO'], COIN: ['HOOD'], MU: ['AMD'], SMCI: ['NVDA'], MSFT: ['CRWD'] };
const YR = { IREN: 180, NVDA: 75, PLTR: 150, HOOD: 120, AMD: -15, ANET: 80, CRWD: 65, AVGO: 85, TSM: 60, COIN: 60, MU: 20, SMCI: -30, MSFT: 2, SPY: 14, QQQ: 18, IWM: 6, SMH: 30, IGV: 22, XLF: 16, WGMI: 70, MARA: 15, CORZ: 110, VIX: -10 };
const CPAL = ['var(--ink3)', '#0E8C8C', '#9A6B00', '#B4407A', '#5B6BD6'];
const dCache = {};
function dailyFor(tk) {
  if (dCache[tk]) return dCache[tk];
  const n = 253, r = rng(hsh(tk + 'daily')), p = POOL[tk];
  const sig = ['SPY', 'QQQ', 'IWM'].includes(tk) ? .009 : p.sec === 'Sector ETF' ? .009 : tk === 'IREN' || tk === 'CORZ' ? .026 : .012;
  const lr = Array.from({ length: n - 1 }, () => (r() - .5) * sig * 3.4);
  lr[n - 2] = Math.log(1 + p.ch / 100);
  const want = Math.log(1 + (YR[tk] ?? 10) / 100), have = lr.reduce((a, b) => a + b, 0), adj = (want - have) / (n - 2);
  for (let i = 0; i < n - 2; i++) lr[i] += adj;
  const c = new Array(n); c[n - 1] = p.px; for (let i = n - 2; i >= 0; i--) c[i] = c[i + 1] / Math.exp(lr[i]);
  return dCache[tk] = c;
}
const CP = { '1m': 21, '3m': 63, '6m': 126, '1y': 252 };
const CPN = { '1m': '1 month', '3m': '3 months', '6m': '6 months', '1y': '1 year' };
const dLabel = (i, n) => new Date(2026, 10, 12 - Math.round((n - 1 - i) * 7 / 5)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const retOver = (tk, per) => { const c = dailyFor(tk), s = c.length - 1 - CP[per]; return (c.at(-1) / c[s] - 1) * 100; };
const relVs = (tk, ref, per = '3m') => retOver(tk, per) - retOver(ref, per);
function cmpRefs(tk) { S.cmpRefs ||= {}; return S.cmpRefs[tk] ||= ['SPY', SECT[POOL[tk].sec], ...(PEERS[tk] || [])].filter((x, i, a) => x && x !== tk && a.indexOf(x) === i); }
const roleOf = (tk, ref) => ref === 'SPY' || ref === 'QQQ' || ref === 'IWM' ? 'Market' : ref === SECT[POOL[tk].sec] ? 'Sector' : 'Peer';
function divergence(tk, ref, per) {
  const a = dailyFor(tk), b = dailyFor(ref), n = a.length, s = n - 1 - CP[per];
  const rs = a.map((v, i) => v / b[i]), win = rs.slice(s), pw = a.slice(s);
  const rsHigh = rs.at(-1) >= Math.max(...win) * .995, pxHigh = a.at(-1) >= Math.max(...pw) * .995;
  const ma = smaOf(rs, 50), rising = rs.at(-1) > ma.at(-1) && ma.at(-1) > ma.at(-11);
  const diff = retOver(tk, per) - retOver(ref, per), verdict = Math.abs(diff) < 2 ? 'In line' : diff > 0 ? 'Leading' : 'Lagging';
  const flag = rsHigh && !pxHigh ? 'RS line at a new high before price: early strength'
    : pxHigh && !rsHigh ? 'Price at a high, but the RS line isn\u2019t: the move is mostly the group'
    : rsHigh && pxHigh ? 'Price and RS line both at highs' : !rising && diff < -5 ? 'Lagging and getting weaker' : rising ? 'RS line rising' : 'RS line flat or falling';
  return { rs, diff, verdict, rising, rsHigh, pxHigh, flag, ra: retOver(tk, per), rb: retOver(ref, per) };
}
const Compare = {
  ci: null,
  html() {
    const tk = S.chartTk, refs = cmpRefs(tk), per = S.cmpP, bench = refs.includes(S.cmpBench) ? S.cmpBench : refs[1] || refs[0];
    S.cmpBench = bench;
    return `<div class="card" style="padding:12px 14px">
      <div class="row sb" style="flex-wrap:wrap;gap:8px"><div class="row" style="gap:6px;flex-wrap:wrap"><span class="cref me"><i style="background:var(--c30)"></i>${tk}</span>
        ${refs.map((r, i) => `<span class="cref"><i style="background:${CPAL[i % CPAL.length]}"></i>${r}<span class="faint">${roleOf(tk, r)}</span><button class="x" data-cx="${r}" title="Remove">×</button></span>`).join('')}
        ${refs.length < 5 ? `<input class="inp" id="cAdd" placeholder="Add a stock or ETF" style="width:150px;height:28px">` : ''}</div>
        ${seg('cpSeg', Object.keys(CP).map(k => [k, k.toUpperCase()]), per)}</div>
      <div class="well mt10" id="cSum" style="font-size:13px">${this.summary(tk, refs, per)}</div>
      <div class="lbl mt14">Change since ${dLabel(dailyFor(tk).length - 1 - CP[per], dailyFor(tk).length)} · all lines start at 0%</div>
      <div id="cA" class="mt6"></div>
      <div class="row sb mt10"><div class="lbl">RS line: ${tk} divided by ${bench} · rising means ${tk} is beating it</div>${seg('cbSeg', refs.map(r => [r, r]), bench)}</div>
      <div id="cB" class="mt6"></div>
      <div class="chread mono" id="cRead" style="position:static;margin-top:6px"></div>
    </div>
    <div class="card mt14"><table class="tbl"><tr><th>Against</th><th>Role</th><th style="text-align:right">${tk}</th><th style="text-align:right">Them</th><th style="text-align:right">Difference</th><th>Verdict</th><th>RS line</th></tr>
      ${refs.map(r => { const d = divergence(tk, r, per); return `<tr><td><b>${r}</b><div class="faint" style="font-size:10.5px">${POOL[r].nm}</div></td><td class="mut">${roleOf(tk, r)}</td><td class="num" style="text-align:right">${pct(d.ra)}</td><td class="num" style="text-align:right">${pct(d.rb)}</td>
        <td class="num ${d.diff >= 2 ? 'up' : d.diff <= -2 ? 'down' : ''}" style="text-align:right;font-weight:600">${d.diff >= 0 ? '+' : '−'}${Math.abs(d.diff).toFixed(1)} pts</td>
        <td>${d.verdict === 'Leading' ? '<span class="bdg ok">Leading</span>' : d.verdict === 'Lagging' ? '<span class="bdg err">Lagging</span>' : '<span class="bdg">In line</span>'}</td><td class="mut" style="font-size:12px">${d.flag}</td></tr>`; }).join('')}</table>
      <div class="faint mt6" style="font-size:11px">Daily closes from IB Gateway. Orbit\u2019s engine computes every number here; the agent only explains them. These describe what happened, not what happens next.</div></div>`;
  },
  summary(tk, refs, per) {
    const m = refs.find(r => roleOf(tk, r) === 'Market'), sct = refs.find(r => roleOf(tk, r) === 'Sector');
    const dm = m && divergence(tk, m, per), ds = sct && divergence(tk, sct, per);
    let s = `Over ${CPN[per]}, <b>${tk}</b> is <b class="num ${retOver(tk, per) >= 0 ? 'up' : 'down'}">${pct(retOver(tk, per))}</b>` + refs.slice(0, 3).map(r => `, ${r} <span class="num">${pct(retOver(r, per))}</span>`).join('') + '. ';
    if (dm) s += `It\u2019s <b>${dm.verdict.toLowerCase()}</b> the market`; if (ds) s += `${dm ? ' and ' : 'It\u2019s '}<b>${ds.verdict.toLowerCase()}</b> its sector`; if (dm || ds) s += '. ';
    const lead = dm?.verdict === 'Leading' && (!ds || ds.verdict !== 'Lagging') && (ds || dm).rising;
    const fading = dm?.verdict === 'Leading' && !lead;
    s += `<div class="mut" style="margin-top:4px;font-size:12px">${lead ? `Fits your <b>Leader pullback</b> playbook if it also clears the RS and moving-average rules. Wait for a pullback to the 8/9-week EMA.` : fading ? `Leading over ${CPN[per]}, but its RS line against ${sct || m} has been falling lately, so the lead is fading. Watch for the RS line to turn back up.` : dm?.verdict === 'Lagging' ? `Lagging the market, so it won\u2019t show in your leader setups. If you hold it, compare it against your other holdings in Live.` : 'Moving with the group. A divergence would show up first in the RS line.'}</div>`;
    return s;
  },
  paint() {
    const A = $('#cA'), Bx = $('#cB'); if (!A) return;
    const tk = S.chartTk, refs = cmpRefs(tk), per = S.cmpP, N = dailyFor(tk).length, s = N - 1 - CP[per], n = N - s;
    const W = Math.max(320, Math.floor(A.clientWidth)), H1 = clamp(Math.round(W * .3), 220, 360), H2 = clamp(Math.round(W * .16), 120, 180), PR = 84, PL = 8, X = i => PL + i / (n - 1) * (W - PR - PL), ci = this.ci;
    const series = [[tk, 'var(--c30)', 2.6], ...refs.map((r, i) => [r, CPAL[i % CPAL.length], 1.6])].map(([t, c, w]) => { const d = dailyFor(t).slice(s); return { t, c, w, v: d.map(x => (x / d[0] - 1) * 100) }; });
    const all = series.flatMap(x => x.v), hi = Math.max(...all, 1), lo = Math.min(...all, -1), Y = v => 10 + (hi - v) / (hi - lo) * (H1 - 28);
    const line = (v, yf) => v.map((y, i) => `${X(i).toFixed(1)},${yf(y).toFixed(1)}`).join(' ');
    const grid = (yf, ticks, fmt, H) => ticks.map(t => `<line x1="${PL}" x2="${W - PR}" y1="${yf(t)}" y2="${yf(t)}" class="gl"/><text x="${W - PR + 6}" y="${yf(t) + 3}" class="ax">${fmt(t)}</text>`).join('') +
      [.04, .27, .5, .73, .96].map(f => { const i = Math.round(f * (n - 1)); return `<text x="${X(i)}" y="${H - 4}" class="ax" text-anchor="middle">${dLabel(s + i, N)}</text>`; }).join('');
    const ends = series.map(x => ({ ...x, y: Y(x.v.at(-1)) })).sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
    const ov = ends.length ? ends.at(-1).y - (H1 - 26) : 0; if (ov > 0) ends.forEach(e => e.y -= ov);
    const tks = [lo, (lo + hi) / 2, hi].filter(t => !ends.some(e => Math.abs(e.y - Y(t)) < 13));
    let svg = grid(Y, tks, v => pct(v, 0), H1) + `<line x1="${PL}" x2="${W - PR}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--ink3)" stroke-width="1"/>`;
    series.slice().reverse().forEach(x => { svg += `<polyline points="${line(x.v, Y)}" fill="none" stroke="${x.c}" stroke-width="${x.w}" stroke-linejoin="round"/>`; });
    ends.forEach(x => svg += `<text x="${W - PR + 6}" y="${x.y + 3}" class="ax" fill="${x.c}" font-weight="700">${x.t} ${pct(x.v.at(-1), 0)}</text>`);
    if (ci != null) svg += `<line x1="${X(ci)}" x2="${X(ci)}" y1="6" y2="${H1 - 18}" class="xh"/>` + series.map(x => `<circle cx="${X(ci)}" cy="${Y(x.v[ci])}" r="3.5" fill="${x.c}"/>`).join('');
    A.innerHTML = `<svg viewBox="0 0 ${W} ${H1}" width="${W}" height="${H1}" class="chsvg">${svg}</svg>`;
    const d = divergence(tk, S.cmpBench, per), rs = d.rs.slice(s).map(v => v / d.rs[s] * 100), ma = smaOf(d.rs, 50).slice(s).map(v => v == null ? null : v / d.rs[s] * 100);
    const h2 = Math.max(...rs, ...ma.filter(v => v != null)), l2 = Math.min(...rs, ...ma.filter(v => v != null)), Y2 = v => 8 + (h2 - v) / (h2 - l2 || 1) * (H2 - 26);
    let s2 = grid(Y2, [l2, (l2 + h2) / 2, h2], v => v.toFixed(0), H2);
    let mx = -Infinity; rs.forEach((v, i) => { if (v > mx) { mx = v; if (i > n * .1) s2 += `<circle cx="${X(i)}" cy="${Y2(v)}" r="2.4" fill="var(--up)"/>`; } });
    s2 += `<polyline points="${ma.map((v, i) => v == null ? null : `${X(i).toFixed(1)},${Y2(v).toFixed(1)}`).filter(Boolean).join(' ')}" fill="none" stroke="var(--ink3)" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    s2 += `<polyline points="${line(rs, Y2)}" fill="none" stroke="var(--c30)" stroke-width="2" stroke-linejoin="round"/>`;
    if (ci != null) s2 += `<line x1="${X(ci)}" x2="${X(ci)}" y1="4" y2="${H2 - 18}" class="xh"/>`;
    Bx.innerHTML = `<svg viewBox="0 0 ${W} ${H2}" width="${W}" height="${H2}" class="chsvg">${s2}</svg>`;
    const i = ci ?? n - 1;
    $('#cRead').innerHTML = `${dLabel(s + i, N)} · ` + series.map(x => `<span style="color:${x.c}">${x.t} ${pct(x.v[i])}</span>`).join(' · ') + ` · RS vs ${S.cmpBench} ${rs[i].toFixed(1)} <span class="faint">(green dots: RS line new highs · dashed: its 50-day average)</span>`;
    this.n = n; this.W = W; this.PL = PL; this.PR = PR;
  },
  mount() {
    const tk = S.chartTk;
    bindSeg('cpSeg', v => { S.cmpP = v; render(); });
    bindSeg('cbSeg', v => { S.cmpBench = v; this.paint(); });
    $$('[data-cx]').forEach(b => b.onclick = () => { S.cmpRefs[tk] = cmpRefs(tk).filter(r => r !== b.dataset.cx); render(); });
    const add = $('#cAdd'); if (add) add.onkeydown = e => { if (e.key !== 'Enter') return; const v = add.value.trim().toUpperCase(); if (!POOL[v] || v === tk) return toast(`Couldn\u2019t find ${v} on IBKR.`, 'warn', 1800); if (!cmpRefs(tk).includes(v)) S.cmpRefs[tk].push(v); render(); };
    ['#cA', '#cB'].forEach(id => { const el = $(id);
      el.onmousemove = e => { const svg = $('svg', el), r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * this.W / r.width; this.ci = clamp(Math.round((x - this.PL) / (this.W - this.PR - this.PL) * (this.n - 1)), 0, this.n - 1); this.paint(); };
      el.onmouseleave = () => { this.ci = null; this.paint(); }; });
    this.ci = null; this.paint();
    SCREENS.chart.ro?.disconnect(); SCREENS.chart.ro = new ResizeObserver(() => requestAnimationFrame(() => this.paint())); SCREENS.chart.ro.observe($('#cA'));
  }
};
