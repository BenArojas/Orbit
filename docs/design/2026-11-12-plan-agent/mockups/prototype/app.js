/* Orbit prototype core: state, deterministic risk engine (stand-in for the Python sidecar), shell, agent dock, Cmd-K. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const rm = () => document.body.classList.contains('rm');
const wait = ms => new Promise(r => setTimeout(r, rm() ? 0 : ms));
const money = (n, sign = false) => {
  const a = Math.abs(n), s = '$' + Math.round(a).toLocaleString('en-US');
  return sign ? (n < 0 ? '−' : '+') + s : (n < 0 ? '−' + s : s);
};
const px2 = n => n.toFixed(2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- state ---------------- */
const S = {
  route: 'ideas', theme: localStorage.getItem('orbit.theme') || 'light', pro: localStorage.getItem('orbit.pro') === '1',
  risk: 500, outlook: 'bull', planKind: 'intraday', thesis: null, plansReady: false,
  guard: { dailyLimit: 900, dailyUsed: 310, maxRisk: 600, cooldownMin: 15, cooldownLeft: 0, pdtUsed: 2, pdtMax: 3, chaseCents: 5 },
  gw: true, px: 18.62, open: 18.31, scenario: 'normal', live: null, memLevel: 1, sharePositions: false, clock: 10 * 60 + 41,
  seen: {}, aiProv: 'key', rtt: 4, armed: null, awayOpen: false
};

/* ---------------- risk engine ----------------
   In production this lives in the Python sidecar. The agent proposes shape; this computes every number. */
const ncdf = x => { const t = 1 / (1 + .2316419 * Math.abs(x)), d = .3989423 * Math.exp(-x * x / 2);
  const p = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const bs = (s, k, T, v, call) => { if (T <= 0) return Math.max(0, call ? s - k : k - s); const r = .04, sq = v * Math.sqrt(T);
  const d1 = (Math.log(s / k) + (r + v * v / 2) * T) / sq, d2 = d1 - sq;
  return call ? s * ncdf(d1) - k * Math.exp(-r * T) * ncdf(d2) : k * Math.exp(-r * T) * ncdf(-d2) - s * ncdf(-d1); };
const ivFor = (prem, s, k, T, call) => { let lo = .05, hi = 3; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; bs(s, k, T, m, call) > prem ? hi = m : lo = m; } return (lo + hi) / 2; };
const DTE = 37;

const Engine = {
  intraday(risk) {
    const e = 18.85, limit = +(e + S.guard.chaseCents / 100).toFixed(2), s = 18.05, t1 = 19.85, t2 = 20.85, per = limit - s;
    const qty = Math.floor(risk / per + 1e-9), h = Math.floor(qty / 2);
    const loss = qty * per, win1 = h * (t1 - e), win = win1 + (qty - h) * (t2 - e);
    return { id: 'intraday', name: 'Intraday', title: 'Breakout above the opening high', horizon: 'Today only · out by 3:55 PM',
      entry: e, stop: s, targets: [{ p: t1, qty: h, label: 'T1' }, { p: t2, qty: qty - h, label: 'T2' }], qty, unit: 'shares',
      loss, win, win1, rr: win / loss, cost: qty * limit, min: 17.7, max: 21.2,
      plain: `Buy ${qty} shares if IREN breaks $${px2(e)}. Sell half at $${px2(t1)}, the rest at $${px2(t2)}. Out by 3:55 PM no matter what.`,
      conds: [['Opening high is set', '18.85', true], ['Price above opening average (VWAP)', '18.47', true], ['Breaks $18.85 with tight spread', '—', false]],
      pro: [['Entry', `BUY ${qty} STP LMT 18.85 / 18.90`], ['Stop', `SELL ${qty} STP 18.05`], ['Target 1', `SELL ${h} LMT 19.85`], ['Target 2', `SELL ${qty - h} LMT 20.85`], ['Time exit', 'Scheduled market exit at 15:55 ET'], ['Risk / share', '$0.85 · 1.1 × 5m ATR'], ['Transmit', 'Entry + exits; paper order shape must be verified']] };
  },
  swing(risk) {
    const e = 18.70, s = 16.90, t = 22.30, per = e - s, qty = Math.floor(risk / per + 1e-9);
    const loss = qty * per, win = qty * (t - e);
    return { id: 'swing', name: 'Swing', title: 'Hold the earnings gap for a few days', horizon: 'Up to 8 trading days',
      entry: e, stop: s, targets: [{ p: t, qty, label: 'Target' }], qty, unit: 'shares', loss, win, rr: win / loss, cost: qty * e, min: 16.4, max: 22.9,
      plain: `Buy ${qty} shares near $${px2(e)}. Exit if it closes below $${px2(s)} (the gap fills), or take profit at $${px2(t)}.`,
      conds: [['Gap holds above yesterday\u2019s high', '17.95', true], ['First pullback finds buyers', '—', false], ['Volume above 20-day average', '2.4×', true]],
      pro: [['Entry', `BUY ${qty} LMT 18.70 DAY`], ['Stop', `SELL ${qty} STP 16.90 GTC`], ['Target', `SELL ${qty} LMT 22.30 GTC`], ['Time exit', 'GTD +8 sessions, review on day 5'], ['Risk / share', '$1.80 · 1.3 × daily ATR'], ['Overnight', 'Gap risk: stop may fill worse']] };
  },
  options(risk, outlook = S.outlook) {
    const call = outlook === 'bull', k = call ? 20 : 17, prem = call ? 2.40 : 1.60;
    const iv = ivFor(prem, 18.62, k, DTE / 365, call);
    const n = Math.floor(risk / (prem * 100) + 1e-9), cost = n * prem * 100;
    const be = call ? k + prem : k - prem, tgtPrem = prem * 2;
    const dl = (bs(18.72, k, DTE / 365, iv, call) - bs(18.52, k, DTE / 365, iv, call)) / .2;
    const th = bs(18.62, k, (DTE - 1) / 365, iv, call) - prem;
    return { id: 'options', name: 'Options', call, k, prem, iv, n, cost, be, tgtPrem, delta: dl, theta: th, unit: 'contracts',
      title: call ? 'Buy calls: bet IREN goes up' : 'Buy puts: bet IREN goes down', horizon: `Expires Dec 19 · ${DTE} days`,
      loss: cost, win: n * (tgtPrem - prem) * 100, rr: (tgtPrem - prem) / prem, qty: n, entry: prem, stop: 0,
      plain: call ? `Bet: IREN above $${px2(be)} by Dec 19. Costs ${money(cost)}, and that\u2019s the most you can lose.`
                  : `Bet: IREN below $${px2(be)} by Dec 19. Costs ${money(cost)}, and that\u2019s the most you can lose.`,
      conds: [['Spread under 5% of price', '$0.08', true], ['Volatility already dropped after earnings', 'IV ' + Math.round(iv * 100) + '%', true], ['More than 21 days left', DTE + 'd', true]],
      pro: [['Contract', `IREN 19DEC26 ${k} ${call ? 'C' : 'P'}`], ['Entry', `BUY ${n} LMT ${px2(prem)} DAY`], ['Target alert', `Premium at $${px2(tgtPrem)} · close manually`], ['Delta', dl.toFixed(2)], ['Theta / day', '$' + (th * 100 * n).toFixed(0)], ['IV', Math.round(iv * 100) + '%']] };
  },
  all(risk) { return [this.intraday(risk), this.swing(risk), this.options(risk)]; }
};

/* ---------------- shell ---------------- */
const ROUTES = { ideas: 'ideas', plans: 'plans', options: 'plans', console: 'plans', live: 'live', review: 'review', settings: 'settings' };
let tickers = [];
const onTick = fn => tickers.push(fn);

function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  $('#themeBtn').innerHTML = S.theme === 'dark' ? ICON.sun : ICON.moon;
  localStorage.setItem('orbit.theme', S.theme);
}
function applyPro() {
  document.body.classList.toggle('pro-on', S.pro);
  $('#proBtn').classList.toggle('on', S.pro);
  localStorage.setItem('orbit.pro', S.pro ? '1' : '0');
}
function navIndicator() {
  const a = $(`.nav a[data-r="${ROUTES[S.route]}"]`), ind = $('.nav .ind');
  $$('.nav a').forEach(x => x.classList.toggle('on', x === a));
  if (a) { ind.style.width = a.offsetWidth + 'px'; ind.style.transform = `translateX(${a.offsetLeft}px)`; }
  $('.nav a[data-r="live"] .dot')?.remove();
  if (S.live) $('.nav a[data-r="live"]').insertAdjacentHTML('beforeend', '<span class="dot"></span>');
  renderFlat();
}
function renderHeader() {
  const g = S.guard, f = g.dailyUsed / g.dailyLimit;
  const m = $('#walletMeter'); m.className = 'hmeter' + (f >= 1 ? ' err' : f >= .7 ? ' warn' : '');
  m.firstElementChild.style.width = clamp(f * 100, 2, 100) + '%';
  $('#walletTxt').textContent = `${money(g.dailyUsed)} / ${money(g.dailyLimit)}`;
  $('#pdtTxt').textContent = `${g.pdtUsed}/${g.pdtMax}`;
  $('#gwDot').classList.toggle('off', !S.gw);
  $('#gwTxt').textContent = S.gw ? `IB Gateway · ${S.rtt} ms` : 'Gateway offline';
  renderBanners();
}
function guardState() {
  const g = S.guard, out = [];
  if (!S.gw) out.push({ k: 'err', lock: true, t: 'IB Gateway disconnected.', d: 'Orbit can\u2019t see live prices or place orders. Reconnecting every 5 s.', a: ['Open Settings', () => go('settings')] });
  if (g.dailyUsed >= g.dailyLimit) out.push({ k: 'err', lock: true, t: 'Daily loss limit reached.', d: `You\u2019ve lost ${money(g.dailyUsed)} today. Trading is locked until tomorrow. Exits still work.` });
  else if (g.dailyUsed / g.dailyLimit >= .7) out.push({ k: 'warn', t: `${Math.round(g.dailyUsed / g.dailyLimit * 100)}% of today\u2019s loss limit used.`, d: `${money(g.dailyLimit - g.dailyUsed)} left. One more full loss may lock trading.` });
  if (g.cooldownLeft > 0) out.push({ k: 'err', lock: true, t: `Cooldown · ${g.cooldownLeft} min left.`, d: 'You were just stopped out. New trades unlock after a short break.' });
  if (g.pdtUsed >= g.pdtMax) out.push({ k: 'warn', t: 'Pattern-day-trade limit: 3 of 3 used.', d: 'Intraday plans are blocked this week. Swing and options plans still work.' });
  return out;
}
function renderBanners() {
  $('#banners').innerHTML = guardState().map((b, i) => `<div class="bn ${b.k}">${b.k === 'warn' ? ICON.diamond : ICON.lock}<span><b>${b.t}</b> ${b.d}</span>${b.a ? `<button class="btn sm act" data-bi="${i}">${b.a[0]}</button>` : ''}</div>`).join('');
  guardState().forEach((b, i) => b.a && $(`[data-bi="${i}"]`)?.addEventListener('click', b.a[1]));
}

function go(r) { if (location.hash !== '#' + r) location.hash = r; else render(); }
function render() {
  const r = (location.hash.slice(1) || 'ideas');
  S.route = SCREENS[r] ? r : 'ideas';
  tickers = [];
  $('#sim')?.remove();
  $$('#dockLog .chips').forEach(c => c.remove());
  const v = SCREENS[S.route];
  $('#ws').innerHTML = `<div class="ws-in view">${v.html()}</div>`;
  $('#ws').scrollTop = 0;
  v.mount && v.mount();
  navIndicator();
  Dock.setSees(v.sees ? v.sees() : '');
  if (v.agent) { const first = !S.seen[S.route]; S.seen[S.route] = true; v.agent(first); }
}

/* ---------------- toasts ---------------- */
function toast(html, kind = 'ok', ms = 3400) {
  const ic = { ok: ['✓', ''], warn: ['!', 'w'], err: ['×', 'e'], info: ['i', 'i'] }[kind];
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = `<span class="ic ${ic[1]}">${ic[0]}</span><span>${html}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, ms);
}

/* ---------------- hold to confirm ----------------
   The only path that sends or arms orders. It carries data-agent-hidden so the UI bridge can never see or press it. */
const HOLD_MS = 400;
function holdToPlace(el, { onDone, ms = HOLD_MS }) {
  let t = null;
  el.style.setProperty('--hold', ms + 'ms');
  const start = e => {
    if (t || !el.classList.contains('ready')) return;
    e?.preventDefault(); el.classList.add('holding');
    const lab = el.querySelector('.t'); lab.dataset.orig ??= lab.innerHTML; lab.innerHTML = 'Keep holding…';
    // Reduced motion only shortens animation. The hold is a safety step, so it keeps its full length.
    t = setTimeout(() => { t = null; el.classList.remove('holding'); onDone(); }, ms);
  };
  const stop = () => {
    if (!t) return; clearTimeout(t); t = null; el.classList.remove('holding');
    el.querySelector('.t').innerHTML = el.querySelector('.t').dataset.orig;
  };
  el.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, stop));
  el.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(e); });
  el.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') stop(); });
  el._hold = { start, stop };
}

/* ---------------- flatten all ---------------- */
function flattenAll() {
  const C = SCREENS.console, L = S.live, did = [];
  if (C.armed) { C.armed = null; S.armed = null; C.last = null; did.push('armed order cancelled'); }
  if (L && !L.closed) { const n = L.qtyOpen, u = L.plan.id === 'options' ? 'contracts' : 'shares'; SCREENS.live.closeTrade('Flattened: sold everything at market, all orders cancelled'); did.push(`${n} ${u} sold at market`); }
  if (!did.length) return toast('Nothing open to flatten.', 'info', 1800);
  render(); toast(`<b>Flattened.</b> ${did.join(', ')}.`, 'info');
}
function renderFlat() { const b = $('#flatBtn'); if (b) b.hidden = !(S.armed || (S.live && !S.live.closed)); }
function showKeys() {
  const rows = [['Space', 'Hold to arm or place the trade on the console'], ['Esc', 'Cancel an armed order · keep plan · close a panel'], ['T', 'Tighten stop'], ['L', 'Move stop to entry'],
    ['W', 'Widen stop (opens the check)'], ['1  2  3', 'Pick a plan fork'], ['C', 'Cancel unfilled shares'], ['⇧E', 'Exit this trade at market'], ['⇧F', 'Flatten all: close Orbit trades, cancel Orbit-armed entries'], ['⌘K', 'Command bar'], ['?', 'This list']];
  modal(`<div class="mh"><div class="h2" style="font-size:17px">Keyboard shortcuts</div><p class="mut" style="font-size:12.5px;margin-top:4px">They work anywhere except while you\u2019re typing. The agent can\u2019t send key presses.</p></div>
    <div class="mb"><div class="keys">${rows.map(r => `<span class="kbd">${r[0]}</span><span>${r[1]}</span>`).join('')}</div><div class="row mt14"><button class="btn" data-close style="flex:1">Close</button></div></div>`);
}
/* ---------------- agent dock ---------------- */
const Dock = {
  get log() { return $('#dockLog'); },
  scroll() { const l = this.log; requestAnimationFrame(() => l.scrollTo({ top: l.scrollHeight, behavior: rm() ? 'auto' : 'smooth' })); },
  add(html, cls = 'msg ai') { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; this.log.appendChild(d); this.scroll(); return d; },
  me(text, att) { return this.add(text + (att ? `<div class="att"><span class="th"></span>${att}</div>` : ''), 'msg me'); },
  busy(b) { $('#dockDot').classList.toggle('busy', b); },
  async say(html, ms = 520) {
    this.busy(true); const t = this.add('<span class="typing"><i></i><i></i><i></i></span>', 'msg ai'); t.style.padding = '0';
    await wait(ms); t.remove(); this.busy(false); return this.add(html);
  },
  chips(list) {
    $$('.chips', this.log).forEach(c => c.remove());
    const d = this.add('', 'chips');
    list.forEach(c => { const b = document.createElement('button'); b.className = 'chip' + (c.y ? ' y' : ''); b.textContent = c.t;
      b.onclick = () => { d.remove(); c.silent || this.me(c.t); c.fn(); }; d.appendChild(b); });
    return d;
  },
  async steps(title, list) {
    const m = this.add(`<div>${title}</div><div class="steps">${list.map(s => `<div class="step"><i></i><span>${s[0]}</span><span class="src">${s[1]}</span></div>`).join('')}</div>`);
    this.busy(true);
    for (const el of $$('.step', m)) { el.classList.add('run'); this.scroll(); await wait(380); el.classList.remove('run'); el.classList.add('ok'); el.querySelector('i').textContent = '✓'; }
    this.busy(false); return m;
  },
  divider(t) { this.add(`<span>${t}</span>`, 'msg').setAttribute('style', 'align-self:center;font-size:10.5px;color:var(--on30muted);max-width:100%'); },
  setSees(t) { $('#seesTxt').innerHTML = t || 'this screen'; },
  touch(sel) { const el = typeof sel === 'string' ? $(sel) : sel; if (!el) return; el.classList.remove('agent-touch'); void el.offsetWidth; el.classList.add('agent-touch'); el.scrollIntoView({ block: 'nearest', behavior: rm() ? 'auto' : 'smooth' }); setTimeout(() => el.classList.remove('agent-touch'), 1150); }
};

async function agentTryPlace() {
  Dock.me('Just place it for me.');
  await Dock.say(`I can\u2019t. The place-trade button is hidden from me, so I can\u2019t see it or press it. Only you can place a trade, by holding the button.
    <div class="att" style="font-family:'Geist Mono',monospace;font-size:10.5px;display:block;line-height:1.55">act({ target: "place-trade" })<br>→ <span style="color:#FF9AA5">blocked: element is agent-hidden</span></div>`, 650);
}

async function onSend(text) {
  const att = $('#attachRow').textContent.trim();
  if (!text && !att) return;
  $('#composer').value = ''; $('#attachRow').innerHTML = '';
  if (/\b(place|buy it|execute|send it|submit)\b/i.test(text)) return agentTryPlace();
  if (S.route === 'ideas' && (/[A-Z]{2,5}/.test(text) || att)) return SCREENS.ideas.runThesis(text || 'IREN looks strong after earnings.', att);
  Dock.me(text, att || null);
  const v = SCREENS[S.route];
  if (v.reply) return v.reply(text);
  await Dock.say('In this prototype my replies are scripted per screen. In Orbit I\u2019d answer from what\u2019s on screen plus your plan and trade history.');
}

/* ---------------- Cmd-K ---------------- */
function commands() {
  return [
    ['Go to', 'Ideas', () => go('ideas')], ['Go to', 'Plans', () => go('plans')], ['Go to', 'Options detail', () => go('options')],
    ['Go to', 'Activation console', () => go('console')], ['Go to', 'Live trade', () => go('live')], ['Go to', 'Review', () => go('review')], ['Go to', 'Settings', () => go('settings')],
    ['Actions', 'New idea from a thesis', () => { go('ideas'); setTimeout(() => $('#composer').focus(), 250); }],
    ['Actions', 'Use example thesis (IREN earnings gap)', () => { go('ideas'); setTimeout(() => SCREENS.ideas.example(), 250); }],
    ['Trade', 'Flatten all: close Orbit trades, cancel Orbit-armed entries', flattenAll, '⇧F'],
    ['Trade', 'Exit this trade at market', () => SCREENS.live.exit(), '⇧E'],
    ['Trade', 'Tighten stop', () => { go('live'); SCREENS.live.tighten(); }, 'T'],
    ['Trade', 'Cancel armed order', () => SCREENS.console.cancelArm(), 'Esc'],
    ['Actions', 'Show what the agent sees', () => toggleAgentView()],
    ['Actions', 'Keyboard shortcuts', showKeys, '?'],
    ['Actions', 'While you were away (catch-up)', () => SCREENS.live.away()],
    ['View', S.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; applyTheme(); }, '⌘⇧D'],
    ['View', S.pro ? 'Hide Pro details' : 'Show Pro details', () => { S.pro = !S.pro; applyPro(); }],
    ['View', 'Toggle reduced motion', () => { document.body.classList.toggle('rm'); toast('Reduced motion ' + (rm() ? 'on' : 'off'), 'info', 1800); }]
  ];
}
function openPalette() {
  if ($('#pal')) return;
  const sc = document.createElement('div'); sc.className = 'scrim'; sc.id = 'pal';
  sc.innerHTML = `<div class="modal"><input class="pal-in" placeholder="Type a command or a ticker…" autofocus><div class="pal-list"></div></div>`;
  document.body.appendChild(sc);
  const inp = $('.pal-in', sc), list = $('.pal-list', sc); let idx = 0, items = [];
  const draw = () => {
    const q = inp.value.toLowerCase(); items = commands().filter(c => (c[0] + ' ' + c[1]).toLowerCase().includes(q));
    if (/^[a-z]{2,5}$/i.test(inp.value)) items.unshift(['Ticker', `Plan a trade on ${inp.value.toUpperCase()}`, () => { go('ideas'); setTimeout(() => { $('#composer').value = inp.value.toUpperCase() + ' '; $('#composer').focus(); }, 250); }]);
    idx = clamp(idx, 0, Math.max(0, items.length - 1)); let sec = '';
    list.innerHTML = items.map((c, i) => `${c[0] !== sec ? `<div class="pal-sec">${sec = c[0]}</div>` : ''}<div class="pal-item ${i === idx ? 'on' : ''}" data-i="${i}">${c[1]}${c[3] ? `<span class="kbd k">${c[3]}</span>` : ''}</div>`).join('') || '<div class="pal-item">No matches</div>';
    $$('.pal-item[data-i]', list).forEach(el => { el.onmouseenter = () => { idx = +el.dataset.i; draw(); }; el.onclick = () => run(); });
  };
  const close = () => sc.remove();
  const run = () => { const c = items[idx]; close(); c && c[2](); };
  inp.addEventListener('input', () => { idx = 0; draw(); });
  inp.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { idx++; draw(); e.preventDefault(); } if (e.key === 'ArrowUp') { idx--; draw(); e.preventDefault(); } if (e.key === 'Enter') run(); if (e.key === 'Escape') close(); });
  sc.addEventListener('mousedown', e => { if (e.target === sc) close(); });
  draw(); inp.focus();
}
function modal(html, { onMount } = {}) {
  const sc = document.createElement('div'); sc.className = 'scrim';
  sc.innerHTML = `<div class="modal">${html}</div>`; document.body.appendChild(sc);
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { sc.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  sc.addEventListener('mousedown', e => { if (e.target === sc) close(); });
  $$('[data-close]', sc).forEach(b => b.onclick = close);
  onMount && onMount(sc, close);
  return close;
}
function toggleAgentView() {
  const on = document.body.classList.toggle('agentview'); $('#seeBtn').classList.toggle('on', on);
  if (on) {
    const h = $$('#ws [data-agent-hidden]').length, s = $$('#ws [data-agent-secret]').length, c = $$('#ws [data-agent-confirm]').length;
    const parts = [h && `<b>${h}</b> hidden (red)`, s && `<b>${s}</b> redacted (orange)`, c && `<b>${c}</b> needing your confirmation (blue)`].filter(Boolean);
    Dock.say(`Outlined what\u2019s off-limits to me on this screen: ${parts.join(', ') || 'nothing'}. Everything else I can read, and I can only fill fields you\u2019ve allowed in Settings.`, 300);
  }
}

/* ---------------- icons ---------------- */
const ICON = {
  moon: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  sun: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/></svg>',
  diamond: '<svg class="ic" width="16" height="16" viewBox="0 0 16 16"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="currentColor"/><path d="M8 5v3.6M8 10.6v.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>',
  lock: '<svg class="ic" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="7" width="10" height="7" rx="2" fill="currentColor"/><path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7"/></svg>',
  eye: '<svg class="eye" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>',
  clip: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m13 7.5-5.3 5.3a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3L6.2 11.3a1.1 1.1 0 0 1-1.5-1.5L9.8 4.7"/></svg>',
  lk: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7"/></svg>'
};

/* ---------------- shared widgets ---------------- */
function rail({ min, max, now, marks, zones = true, id = '' }) {
  const pos = p => clamp((p - min) / (max - min) * 100, 0, 100);
  const stop = marks.find(m => m.k === 'stop'), entry = marks.find(m => m.k === 'entry'), last = marks[marks.length - 1];
  const z = zones && stop && entry ? `<div class="zl" style="left:${pos(stop.p)}%;width:${pos(entry.p) - pos(stop.p)}%"></div><div class="zw" style="left:${pos(entry.p)}%;width:${pos(last.p) - pos(entry.p)}%"></div>` : '';
  const c = { stop: 'var(--down)', entry: 'var(--c30)', tgt: 'var(--up)', fill: 'var(--c30)', be: 'var(--ink3)' };
  return `<div class="rail" ${id ? `id="${id}"` : ''} data-min="${min}" data-max="${max}"><div class="track">${z}
    ${now != null ? `<div class="now" style="left:${pos(now)}%"><span>${px2(now)}</span><i></i></div>` : ''}
    ${marks.map(m => `<div class="mk ${m.done ? 'done' : ''}" data-k="${m.k}"${m.id ? ` data-id="${m.id}"` : ''} style="left:${pos(m.p)}%;--mc:${c[m.k]}"><i></i><em>${m.l}</em><b>${px2(m.p)}</b></div>`).join('')}
  </div></div>`;
}
function moveRail(el, p) {
  if (!el) return; const min = +el.dataset.min, max = +el.dataset.max, n = $('.now', el);
  if (!n) return; n.style.left = clamp((p - min) / (max - min) * 100, 0, 100) + '%'; $('span', n).textContent = px2(p);
}
function seg(id, opts, on) {
  return `<div class="seg" id="${id}">${opts.map(o => `<button data-v="${o[0]}" class="${o[0] === on ? 'on' : ''}">${o[1]}</button>`).join('')}<span class="ind"></span></div>`;
}
function bindSeg(id, fn) {
  const s = $('#' + id); if (!s) return;
  const place = () => { const b = $('button.on', s), ind = $('.ind', s); ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft - 3}px)`; ind.style.left = '3px'; };
  place();
  $$('button', s).forEach(b => b.onclick = () => { $$('button', s).forEach(x => x.classList.toggle('on', x === b)); place(); fn(b.dataset.v); });
}
function countTo(el, to, fmt, ms = 260) {
  const from = +(el.dataset.v || 0); el.dataset.v = to; const t0 = performance.now(), D = rm() ? 0 : ms;
  const step = n => { const k = D ? Math.min(1, (n - t0) / D) : 1, e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const clockTxt = m => { const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0'); return `${h > 12 ? h - 12 : h}:${mm} ${h >= 12 ? 'PM' : 'AM'}`; };

/* ---------------- boot ---------------- */
function boot() {
  applyTheme(); applyPro(); renderHeader();
  $('#themeBtn').onclick = () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; applyTheme(); };
  $('#proBtn').onclick = () => { S.pro = !S.pro; applyPro(); toast(S.pro ? 'Pro details on: order types, Greeks and raw levels are shown.' : 'Pro details hidden.', 'info', 2200); };
  $('#cmdBtn').onclick = openPalette;
  $('#seeBtn').onclick = toggleAgentView;
  $('#flatBtn').onclick = flattenAll;
  $('#attachBtn').onclick = () => { $('#attachRow').innerHTML = `<span class="att-chip">${ICON.clip} iren-5min-chart.png</span>`; };
  $('#sendBtn').onclick = () => onSend($('#composer').value.trim());
  $('#composer').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend($('#composer').value.trim()); } });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); S.theme = S.theme === 'dark' ? 'light' : 'dark'; applyTheme(); }
    if (e.metaKey || e.ctrlKey || e.altKey || $('.scrim')) return;
    const tg = e.target;
    if (tg.closest?.('input,textarea,select,[contenteditable]')) {
      if (e.key !== 'Escape') return;
      tg.blur(); if (tg.id === 'composer') return;
    }
    if (e.key === '?') { e.preventDefault(); return showKeys(); }
    if (e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); return flattenAll(); }
    const v = SCREENS[S.route]; if (v.key && v.key(e)) e.preventDefault();
  });
  document.addEventListener('keyup', e => { const v = SCREENS[S.route]; v.keyup && v.keyup(e); });  window.addEventListener('hashchange', render);
  window.addEventListener('resize', navIndicator);
  setInterval(() => {
    const drift = S.live ? .012 : .004, d = +(Math.random() * .14 - .07 + drift).toFixed(2);
    S.px = +clamp(S.px + d, 17.9, 21.4).toFixed(2); tickers.forEach(f => f(d));
    S.rtt = 2 + Math.floor(Math.random() * 4); if (S.gw) $('#gwTxt').textContent = `IB Gateway · ${S.rtt} ms`;
  }, 1100);
  setInterval(() => { S.clock++; if (S.guard.cooldownLeft > 0) { S.guard.cooldownLeft--; renderHeader(); } }, 6000);
  const q = new URLSearchParams(location.search);
  if (q.get('theme')) { S.theme = q.get('theme'); applyTheme(); }
  if (q.get('pro') === '1') { S.pro = true; applyPro(); }
  if (q.get('rm') === '1') document.body.classList.add('rm');
  render();
  document.fonts?.ready.then(navIndicator);
  if (q.get('demo')) runDemo(q.get('demo'));
  if (q.get('test') === '1') { const s = document.createElement('script'); s.src = 'selftest.js'; document.body.appendChild(s); }
  if (q.get('audit') === '1') { const s = document.createElement('script'); s.src = 'audit.js'; document.body.appendChild(s); }
}
/* Deep links into prototype states, e.g. index.html?demo=live&theme=dark */
function runDemo(d) {
  const thesis = () => { S.plansReady = true; S.ctxState = 'done'; S.thesis = 'IREN reported yesterday, up 15% premarket. I\u2019m bullish and willing to risk $500.'; };
  const startLive = () => { thesis(); const p = Engine.intraday(S.risk); S.live = { plan: p, qty: p.qty, qtyOpen: p.qty, avg: 18.86, realized: 0, stop: p.stop, t1done: false, closed: false, partial: null, forks: null, events: [{ tm: '10:03 AM', tx: `Filled ${p.qty} shares at $18.86`, mc: 'var(--c30)' }, { tm: '10:03 AM', tx: 'Stop and targets are live at IBKR', mc: 'var(--ink3)' }] }; S.px = 19.4; };
  const D = {
    ideas: () => setTimeout(() => SCREENS.ideas.example(), 300),
    plans: () => { thesis(); go('plans'); },
    console: () => { thesis(); S.planKind = 'intraday'; S.scenario = 'normal'; go('console'); },
    chase: () => { thesis(); S.planKind = 'intraday'; S.scenario = 'chase'; go('console'); setTimeout(() => SCREENS.console.setScenario('chase'), 200); },
    daily: () => { thesis(); S.planKind = 'intraday'; go('console'); setTimeout(() => SCREENS.console.setScenario('daily'), 200); },
    agent: () => { thesis(); S.planKind = 'intraday'; go('console'); setTimeout(() => { SCREENS.console.setScenario('agent'); toggleAgentView(); }, 3000); },
    options: () => { thesis(); go('options'); },
    live: () => { startLive(); go('live'); setTimeout(() => SCREENS.live.t1(), 600); },
    partial: () => { startLive(); S.live.partial = { filled: 400, of: S.live.qty }; S.live.qtyOpen = 400; S.live.events[0].tx = `Filled 400 of ${S.live.qty} shares at $18.86`; go('live'); },
    widen: () => { startLive(); go('live'); setTimeout(() => SCREENS.live.widen(), 400); },
    away: () => { startLive(); go('live'); setTimeout(() => SCREENS.live.away(), 400); },
    armed: () => { thesis(); S.planKind = 'intraday'; S.scenario = 'normal'; go('console'); setTimeout(() => { clearTimeout(SCREENS.console.breakT); SCREENS.console.arm(); }, 500); },
    keys: () => { startLive(); go('live'); setTimeout(showKeys, 400); },
    review: () => { S.memLevel = 1; S.revTab = 'trades'; go('review'); },
    settings: () => { go('settings'); setTimeout(toggleAgentView, 300); },
    palette: () => { thesis(); go('plans'); setTimeout(openPalette, 300); }
  };
  (D[d] || (() => {}))();
}
document.addEventListener('DOMContentLoaded', boot);
