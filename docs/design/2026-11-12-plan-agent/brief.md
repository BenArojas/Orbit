# Orbit plan agent: brief

Status: approved direction, 2026-11-13. Mockups approved the same day.
Prototype: [`mockups/prototype/index.html`](mockups/prototype/index.html) ([how to use it](mockups/prototype/README.md)).

## What Orbit becomes

Orbit is a personal desktop app for one trader. It turns a trading idea into a sized plan, places the whole order
package at IBKR with one deliberate press, manages the trade with one-click choices, and explains what happened
afterwards. It replaces the three separate parts in the repo today (Parallax, MoonMarket, TWS Assistant) with one flow:

**Ideas → Plans → Live → Review**, plus **Settings**, with an AI agent docked on every screen.

## Who it is for

The repo owner, trading his own IBKR account. He trades several styles depending on the market: leader pullbacks to
the 8/9-week EMA, breakouts, breakout retests, all-time-high retests, and opening-high breakouts on gap days. He wants
pro-level control without pro-level clutter, and plain-English money outcomes first.

## Principles

1. **The engine owns every number.** A deterministic Python engine computes sizes, risk, prices, indicators, guardrails,
   and divergence. The agent proposes and explains; it never produces a number the trader acts on.
2. **Only the human trades.** The agent can never place, change, or cancel an order. Orbit never trades on its own.
3. **Speed where it protects you, friction where it adds risk.** Anything that cuts risk is one click or one key.
   Anything that adds risk takes a 0.4-second hold. No pop-up sits in the trade path.
4. **Build only what has real data behind it.** If the data isn't there or the feature isn't solid, it waits.
5. **Clean, readable charts.** Text never covers price action, nothing overflows its card, and every chart resizes.

## In scope for v1

- US stocks long, and single-leg long calls and puts. Regular hours only. No short stock, no averaging down.
- Intraday and swing plans, each with entry, stop, targets, and a time exit, sent as one order package.
- Breakout entries pre-armed at IBKR as stop-limit orders.
- Guardrails: daily loss limit, cooldown after a stop-out, pattern-day-trade limit, max risk per trade, no chasing.
- Five playbooks with editable rules, switched on per market posture.
- Ideas from the RS leaders list, Orbit-local watchlists, and alerts, grouped by playbook.
- A full price chart with drawings and alerts, and Compare (divergence against market, sector, and peers).
- Live trade management with event-driven agent check-ins, holdings (list, treemap, leaders), and working orders.
- Review from Orbit's own trade log, results by playbook, and agent memory Level 0 or 1.
- The agent runs on the user's ChatGPT plan (Codex), Google AI Pro plan (Antigravity CLI), or an API key.
- IBKR through TWS or IB Gateway only. The Client Portal gateway is retired.
- Paper account only until the user approves live trading.

## Out of scope for v1

Scans, the account performance curve, the transactions ledger, news, premarket and after-hours trading, short selling,
spreads, option brackets, multiple accounts, non-USD positions, a local model, memory Level 2 (approved lessons),
and away notifications.

## Constraints

- Tauri v2, React 19 + TypeScript + Vite, Python FastAPI sidecar, `ib_async`, SQLite, FastMCP.
- The UI moves to the Vercel UI SDK (`@ui-sdk/react`), which is in beta.
- Testing follows [`docs/testing.md`](../../testing.md): protect critical promises at the highest public boundary.
- After the features ship, a dedicated run cuts latency between Orbit and IB Gateway.
