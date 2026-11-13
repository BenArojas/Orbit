# Orbit plan agent: decision log

Every entry was decided by the user in this design session (2026-11-12 to 2026-11-13) unless marked *proposed*.
Later changes go at the bottom with a date; don't rewrite history.

## Product shape

| # | Decision | Notes |
|---|---|---|
| D1 | One flow: Ideas → Plans → Live → Review, plus Settings, agent docked on every screen | Replaces Parallax, MoonMarket, TWS Assistant as separate areas |
| D2 | The deterministic Python engine owns all money math; the agent proposes trade shapes and explains | The prototype's JavaScript math is a stand-in only |
| D3 | The agent can never place, change, or cancel orders | Enforced in UI, MCP surface, and backend (see spec) |
| D4 | v1 instruments: long US stocks, long single-leg calls (bullish) and puts (bearish). No short stock, no averaging down | |
| D5 | Regular trading hours only | |
| D6 | No away notifications; a catch-up card on return | |
| D7 | Pro jargon behind a global *Pro details* switch; plain-English money first | |

## Broker and data

| # | Decision | Notes |
|---|---|---|
| D8 | TWS / IB Gateway (`ib_async`) is the only broker connection. Retire the Client Portal gateway and the exclusive session modes | |
| D9 | Paper account only until the user approves live trading | Approved 2026-11-13 |
| D10 | Watchlists become Orbit-local, with a one-time import from Client Portal before it is retired | TWS has no watchlist editing API |
| D11 | Review uses Orbit's own trade log; Flex only imports older trades, later | No Flex code exists today |
| D12 | Drop for now, no reliable data yet: scans, account performance curve, transactions ledger, news context | Revisit after the TWS scanner and Flex import are verified |

## Trading and safety

| # | Decision | Notes |
|---|---|---|
| D13 | The human sends the full package (entry, stop, targets, time exit) with one press; pre-flight checks price, spread, buying power from cached quotes | |
| D14 | Risk-adding actions (arm, place, widen a stop, remove a protective stop) take a 0.4-second hold. Reduced motion never shortens it | Was 1.2 s; changed for speed |
| D15 | Risk-reducing actions (exit, tighten, stop to entry, fork choices, cancel unfilled shares, cancel an armed order, cancel an entry order, flatten all) are one click or one key, no hold | |
| D16 | Breakout entries are pre-armed at IBKR as buy stop-limit brackets by default | Orbit cancels them if a guardrail trips |
| D17 | Guardrails: daily loss limit, stop-out cooldown, PDT warning and limit, max risk per trade, no chasing past N¢ (smaller slips trim size) | Exits always work |
| D18 | No pop-ups in the trade path: widen and catch-up are inline | |
| D19 | Keyboard shortcuts for trade actions; ignored while typing; the agent can't send keys | |
| D20 | This changes the Trading Safety rule in `docs/architecture/modules.md` that live place, cancel, and modify all need the real-money confirmation flow. The new rule is D14 + D15, enforced in the backend. Update that doc when the code changes, not before | |

## Live management

| # | Decision | Notes |
|---|---|---|
| D21 | Event-driven agent check-ins: fills, targets, near stop, volume, checkpoints, questions; 2–3 engine-validated choices; *Keep plan* is the default and applies after an expiry | |
| D22 | Holdings (everything Orbit didn't open) live under Live: list, treemap, and leaders. Donut, bubbles, and Sankey are dropped | |
| D23 | Options are tagged everywhere they appear: badge, expiry, days left, at-risk value, striped in the treemap | |
| D24 | Drop the free-form order ticket: every new trade goes through a plan | Holdings keep one-click close and *Protect it* |

## Ideas, charts, and playbooks

| # | Decision | Notes |
|---|---|---|
| D25 | Playbooks are named, editable rule sets: Leader pullback, Breakout, Breakout and retest, All-time-high retest, Opening high breakout | Draft numbers accepted; the user tunes them in the app |
| D26 | Market posture (healthy, selective, defensive) decides which playbooks are on | Defaults: Breakout only in healthy markets |
| D27 | The Fred6725 RS list plus Orbit watchlists are the candidate pool | Scans later |
| D28 | Compare is a main feature: stock vs market, sector, and peers, with an RS line and a Leading / Lagging / In line verdict | Describes what happened, not a prediction |
| D29 | Heavy chart library only on the chart screen; plain SVG elsewhere | |
| D30 | Charts fit their container, resize, zoom, and pan; text never covers price action; labels that don't fit are hidden and the data stays available elsewhere | |
| D31 | Indicators load warm-up history and aren't drawn until warmed up; weekly EMAs use real weekly bars; too-short history says so | |

## Agent and AI

| # | Decision | Notes |
|---|---|---|
| D32 | The UI moves to the Vercel UI SDK, including its agent bridge (`createAgent`, `allow`, `data-agent-hidden/secret/confirm`) | SDK is beta |
| D33 | AI providers: ChatGPT plan via Codex, Google AI Pro via Antigravity CLI, or an API key; the user picks in Settings | Claude only by API key (Anthropic restricts subscription sign-in to its own apps) |
| D34 | Visible switch for sharing positions with the model | |
| D35 | Agent memory default Level 1 (computed stats only). Level 2 (approved lessons) is later | |
| D36 | If the provider is unavailable or out of quota, Orbit works fully without the agent | |
| D37 | The README's "100% local, no cloud" promise must be revised before the agent ships | |

## Visual

| # | Decision | Notes |
|---|---|---|
| D38 | Concrete light (`#E9ECF0`) and Warm Graphite dark (`#161514`) themes, cobalt dock, sunburst yellow for rare primary actions | Tokens in `mockups/theme.css` |
| D39 | Schibsted Grotesk + Geist Mono | |
| D40 | Motion 140–200 ms, `cubic-bezier(.2,.8,.2,1)`, shimmer skeletons, reduced-motion support | |

## Process

| # | Decision | Notes |
|---|---|---|
| D41 | Straight to the phased build after the spec; no separate React prototype | |
| D42 | Design records live in `docs/design/<date>-<feature>/{brief.md, scenarios.md, decision.md, spec.md, mockups/}` | *proposed* convention, used here |
| D43 | After the mockups and features are built, run a latency optimization pass between Orbit and IB Gateway | |

## Changes after the independent review (2026-11-13)

Reviewed by Claude Fable 5.2 against the documents, prototype, and code. All 15 findings were accepted; the four
below were the user's choices.

| # | Decision | Notes |
|---|---|---|
| D44 | Roll out the agent with API keys first. Codex and Antigravity plan sign-in ship only after an OS-sandbox test proves the agent process can't reach the IBKR API ports, Orbit's sidecar, Orbit's files, or other programs | Replaces the "pick either" order of D33; D33 still holds as the end state |
| D45 | Flatten all (⇧F) sells Orbit trades and cancels armed orders only. Other holdings are closed one by one | |
| D46 | Keep ⇧E (exit) and ⇧F (flatten) as single chords, ignored while typing; accept only trusted key and pointer events | |
| D47 | The daily loss limit counts realized losses only, from trades closed today. Open and armed risk is not reserved | Accepted risk: several open trades can each lose their full risk the same day and together pass the limit. The guardrail locks new trades once realized losses reach it |
| D48 | Breakout entries are sized at the limit price, not the trigger: 588 shares, not 625, for the IREN example | Fixes a $531 worst case on a $500 risk |
| D49 | Day trades come from IBKR's own count over five rolling business days, not Orbit's log | Verify on a paper account in phase 1 |
| D50 | A paper-account order-shape test comes before the engine phase, and the spec records the order graph that actually works | IBKR rejects modifying orders in an OCA group (error 10326) |
| D51 | Phase 0 closes the open sidecar: a per-launch secret on every mutation and WebSocket, the old live-order routes disabled, and paper accounts checked by account prefix as well as port | |
| D52 | Revised spec approved; begin Phase 0. Position sharing with the AI provider defaults off, with a runtime Settings switch | Approved after explaining that sharing sends holdings and P&L, not account numbers or credentials |
| D53 | The paper account check accepts `DU`, an optional single letter, then digits. Paper port and exactly one connected account are still required; `U…` live accounts stay rejected | The owner's real IB Gateway 10.45 paper login uses a `DU` + letter + digits ID, which the Phase 0 `DU`+digits check wrongly rejected. Owner approved |
| D54 | Fresh live **and** streaming-delayed quotes may authorize paper entries; delayed data carries a visible "Delayed" label in the UI. Frozen, delayed-frozen, stale, unknown, and invalid bid/ask still block | Owner direction: the owner will subscribe to live data; until then delayed data should work with a label, not a block |
| D55 | The PDT guardrail is dropped. FINRA retired day-trade counting and the $25,000 minimum effective 2026-06-04 (Rule 4210 amendment, Notice 26-10, SEC approval 2026-04-14), so there is no broker count to gate on. The account read reports the rule status and any legacy tag instead of a count gate. Intraday risk is governed by Orbit's own guardrails and the broker's real-time intraday margin checks | Supersedes the PDT part of D17/D49 and the spec PDT bullet; explains why paper accounts no longer report `DayTradesRemaining` |
| D56 | An all-time high is reported only when the history window reaches IBKR's earliest available data (`reqHeadTimeStamp`, compared at day granularity). Otherwise coverage is `partial` or `unknown` and `ath` stays null | Derived from broker data, not guessed; the window high is always reported separately |
