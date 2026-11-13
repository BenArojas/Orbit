# Orbit clickable prototype

Plain HTML, CSS and JavaScript. No build step, no dependencies. Open `index.html` in a browser.

Theme tokens come from `../theme.css` (Concrete light + Warm Graphite dark). `app.css` is layout and motion,
`app.js` is the shell plus the risk engine, `screens.js` is the original seven screens, and `screens2.js`
adds the merged Parallax and MoonMarket pieces: the Setups list, playbooks, the chart screen with Compare, the
watching list, and holdings.

## Try it

Start at **Ideas** and click *Use the IREN example*. The agent asks one question, then builds plans.
From a plan card, *Load into console*, then **hold** the yellow button (or Space) for 0.4 seconds. For the
breakout plan this *arms* the order at IBKR before the breakout, so it fills without waiting on you. That takes you into the live trade, where a toolbar at the top lets you fire events
(target hit, nears the stop, volume spike, stopped out).

Header controls: **Pro details** shows order types, Greeks and raw levels everywhere. The moon or sun icon
switches light and dark. **⌘K** opens the command bar. In the agent dock, **What I can't see** outlines
every element the agent is blocked from.

## Speed rules

- Anything that adds risk takes a 0.4-second hold: arming, placing, widening a stop. Reduced motion does not shorten it.
- Anything that cuts risk is one click or one key: exit, tighten, stop to entry, fork choices, cancel unfilled shares, cancel an armed order, flatten all.
- No pop-up sits in the trade path. Widening and the catch-up open inline, so the price stays visible.
- Drag the stop or a target on the Live rail. Dragging the stop down opens the widen check instead of moving it.
- Shortcuts (press `?`): Space hold, Esc, T, L, W, 1–3, C, ⇧E exit, ⇧F flatten all. They are ignored while typing.

## Deep links

Append `?demo=<name>`, and optionally `&theme=dark`, `&pro=1`, `&rm=1` (reduced motion).

| demo | what it shows |
|---|---|
| `ideas` | thesis + screenshot freshness check, context pulls, clarifying question |
| `setups` | Ideas grouped by your playbooks for today's market, with vs-sector numbers |
| `leaders` | the RS leaders list, add to a watchlist |
| `playbooks` | your setup rules, editable, switched on per market |
| `chart` | full price chart with indicators and drawings |
| `pullback` | NVDA daily with the 8/9-week EMA band |
| `compare` | IREN against market, sector and peers: returns, RS line, verdict |
| `lagging` | MSFT in Compare, lagging the market |
| `watching` | plans Orbit is watching, with their playbook |
| `holdings` / `treemap` / `podium` | everything else you hold: list, treemap, leaders |
| `plans` | three plan alternatives, risk slider resizes everything |
| `options` | payoff curve, what-if price and date, plain-language Greeks |
| `console` | conditions filling in, hold to arm at IBKR |
| `armed` | entry armed at IBKR, waiting for the breakout |
| `keys` | keyboard shortcut list |
| `chase` | price ran past the entry, so placing is blocked |
| `daily` | daily loss limit reached, trading locked |
| `agent` | the agent tries to place a trade and is blocked |
| `live` | live trade, target 1 hit, three plan forks |
| `partial` | only part of the order filled |
| `widen` | widening a stop needs a reason and must fit your limits |
| `away` | while you were away catch-up |
| `review` | trade stories, agent post-mortem, memory levels 0/1/2 |
| `settings` | guardrails, agent permissions, keys, IBKR connection |
| `palette` | the ⌘K command bar |

More deep links: `planlevels` (IREN with plan levels and RSI), `shorthist` (a stock without enough history for the SMA 200 and weekly EMA).

`?audit=1&demo=<name>` runs `audit.js`, which flags text spilling out of a card, chart labels past the edge or on top of each other, and sideways scrolling. Run it at several window widths.

`?test=1` runs `selftest.js`, which checks the risk math and every guardrail, and appends the results to the page.

## What is real and what is faked

Real: all money math (position size, max loss, reward and risk, break-even, option pricing with
Black-Scholes and implied volatility solved from the premium), every guardrail decision, the hold-to-place
state machine, and the agent's blocked-action path.

Order-path timing is not real: the 60 ms send and the gateway round-trip readout in the header are stand-ins.

Dropped for now because the data isn't there yet: scans (the TWS scanner isn't verified), the account
performance curve and the transactions ledger (no Flex import exists yet), and news.

Faked: prices (a random walk seeded per scenario, and seeded daily histories for Compare), the agent's words (scripted per screen), and the
IBKR connection. In the real app the math moves to the Python sidecar and the words come from the model, with the
sidecar still computing every number. Flex import is shown as a later feature, not a v1 connection.

The order graph, stop edits, and 3:55 PM exit are illustrative only. Validate them against the IBKR paper account before
shipping. Options show a long single-leg entry and a target alert; they do not place an automatic target or bracket.
