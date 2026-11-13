# Orbit plan agent: build spec

Status: approved by the user, including position sharing off by default; Phase 0 complete, Phase 1 in progress. Updated 2026-11-13. Inputs: [brief](brief.md),
[scenarios](scenarios.md), [decisions](decision.md), and the approved [prototype](mockups/prototype/README.md).
The prototype is a behavioral and visual reference only. Its JavaScript math, simulated prices, scripted agent text,
and unverified broker order shapes are not production contracts.

## 1. Product and architecture

Orbit replaces Parallax, MoonMarket, and TWS Assistant with one flow: **Ideas → Plans → Live → Review**, plus Settings
and an agent docked on every screen. It is a local desktop application for one trader and one IBKR account.

```text
Tauri + React UI ── authenticated local HTTP/WS ── FastAPI sidecar ── ib_async ── TWS / IB Gateway
      │                                             │
      │                                    deterministic engine + SQLite
      │                                             │
      └── agent bridge ── API-key provider first   └── MCP: read-only tools
                          (Keychain)
                          Codex / Antigravity only after sandbox gate
```

- **The Python sidecar owns every actionable number.** It computes sizing, risk, prices, indicators, posture,
  playbook matches, Compare results, and guardrail decisions. The UI renders these values. The agent explains or
  proposes; it is never an authority for calculations.
- **One TWS/IB Gateway connection.** `services/tws_broker_adapter.py` becomes the only broker transport. Client Portal
  code and exclusive broker-session modes are removed only after the migration and Phase 1 exit checks pass.
- **One persistent plan model.** Plans, immutable plan revisions, order references, guardrail state, and the Orbit
  trade log live in versioned SQLite tables. No safety-critical state may exist only in process memory.
- **One operator.** The sidecar owns a fixed Orbit client ID and account binding. The UI cannot choose the broker
  client ID or use a request to switch the account.
- **Provider boundary.** Ship the API-key provider first, storing credentials in macOS Keychain. Codex and Antigravity
  plan sign-in remain unavailable until the OS-sandbox acceptance test in Phase 7 passes. Claude is API-key only.
- **Tauri boundary.** Audit the packaged app's v2 capabilities: grant only the UI and sidecar permissions the app needs;
  do not expose generic shell, filesystem, or network access to an agent process. Test the packaged app, not only Vite.
- **MCP boundary.** Keep MCP read-only. It may expose reads and a narrow allowlist of non-order UI intents; it never
  exposes order, broker-session, guardrail, or credential tools. Run over stdio or a separately authenticated local
  endpoint, not mounted on the general FastAPI listener.

## 2. Safety, identity, and authorization

| Boundary | Contract |
|---|---|
| Paper gate | Before live trading is separately approved, require both an approved paper port and a connected account ID with the `DU` paper prefix. A port by itself is not proof. Unknown, stale, mismatched, or non-paper identity blocks risk-adding actions. |
| Local API | Bind the sidecar to loopback. Tauri generates one unpredictable per-launch secret and gives it only to the trusted webview. Require it on every HTTP mutation and authenticate WebSockets before accepting subscriptions or commands. Never put it in a URL, logs, agent context, or persistent browser storage. |
| Legacy endpoints | Phase 0 disables the existing live-order routes and any route that can mutate broker orders outside the new paper-only gate. Deny by default; test the complete route inventory, not just the new router. |
| Risk classification | The backend classifies arm/place/widen/remove-stop as risk-adding. They re-check all guardrails immediately before send and fail closed. Exit, tighten, stop-to-entry, cancel-entry, cancel-unfilled remainder, cancel-armed-order, and the approved Flatten all scope remain available while locked. |
| Flatten all | Closes Orbit-managed trades and cancels Orbit-armed entry orders only. It does not liquidate other holdings or unmanaged orders. Those holdings are closed individually. |
| Human confirmation | Risk-adding controls require the 400 ms hold. Only trusted pointer/key events can start it. Synthetic events, agent actions, and keyboard events while typing are ignored. Any plan edit, price change, or revision change cancels the hold. |
| Plan mutation | Every accepted plan edit creates an immutable revision. A proposed change shows an old/new diff and requires the user's explicit acceptance. A submit names the revision it was prepared from; the backend rejects stale revisions and recalculates risk before sending. The agent cannot mutate a live order or directly accept a plan revision. |
| Broker identity | The sidecar selects a fixed client ID; requests from the UI cannot override it. Every Orbit order carries a stable `orderRef` derived from Orbit plan ID, revision, and leg role so reconnect reconciliation can identify it. |
| Stop changes | Do not assume an OCA child can be modified. Paper-test the actual order graph and stop-change operation first. Do not ship cancel-and-replace or same-ID modification unless the tested broker behavior preserves protection and avoids duplicate exits. If no safe operation is proven, keep stop-change controls disabled pending a new decision. |
| Agent | The agent cannot place, change, or cancel orders, edit guardrails, send keys, or access the session secret. It may draft plan-field suggestions only; a human reviews and accepts the revision. Order controls use `data-agent-hidden`; secrets use `data-agent-secret`; the UI bridge defaults to deny. |
| Agent process | API-key provider runs with only the Orbit tools required. Before enabling Codex or Antigravity plan CLIs, prove with OS-level tests that the child process cannot reach IBKR API ports, Orbit's sidecar, Orbit files, or other programs. A prompt or tool allowlist alone is not a sandbox. |
| Position sharing | A visible, persisted runtime setting controls whether positions/P&L are sent to the selected model; it must not be a build-time environment switch. Default is off (approved), disclose provider terms, and omit holdings when off. |

The sidecar must also reject expired/stale quotes, delayed or frozen market data, unhealthy Gateway state, and non-RTH
entry attempts. Read-only status and recovery actions remain available while trading is locked.

## 3. Persistent state and reconciliation

- Use forward-only, numbered SQLite migrations. Before applying a migration to the user's database, make a recoverable
  backup and verify the migration on a copy. Never use test cleanup that deletes app data or safety-anchor fixtures.
- Persist plans, revisions, guardrail settings, stop-out cooldown deadline, Orbit order references, executions,
  commissions, and plan events. Store timestamps in UTC and derive trading-day boundaries in `America/New_York`.
- On startup and every reconnect, reconcile `reqPositions`, open orders, executions (`reqExecutions`), and commission
  reports against the local log. Deduplicate executions by IBKR execution ID. Match orders by stable `orderRef` and
  broker IDs. Unknown fills or position changes are surfaced as unmatched; never silently attach them to an Orbit plan.
- The away/catch-up view reports events from the durable log and explicitly identifies changes made while Orbit was
  offline or not matched to its records. A restart must not reset plan state, cooldown, or order ownership.
- Preserve the existing database until validated migration and rollback checks pass. Port Orbit-local watchlists,
  alerts, drawings, and settings before removing their old backing services. Keep a temporary compatibility flag only
  for a bounded migration window; remove it after the new path is verified.

## 4. Data and engine contracts

### Data sources and truthfulness

| Need | Source and rule |
|---|---|
| Quotes/depth | TWS `reqMktData`; record market-data type and timestamp. Delayed/frozen or stale quotes may be displayed with a clear label but cannot authorize an order. |
| Bars | TWS `reqHistoricalData`; the current path has returned about 1 year of daily and 3 years of weekly bars. Test longer requests on representative symbols. Request indicator warm-up, at least 3× EMA length and full SMA length. Weekly EMA uses completed `1 week` bars, not resampled daily bars. |
| All-time high | Request sufficiently long history and compare with listing/history coverage. If coverage cannot be verified for a symbol, report ATH as unknown and disable ATH-specific conclusions; do not relabel a 1-year high as an ATH. |
| Positions/account | `reqPositions`, portfolio updates, `reqAccountSummary`, `reqPnL`/`reqPnLSingle`. Include account, currency, security type, multiplier, option strike/right/expiry, and market-data freshness. |
| Fills/P&L | `execDetailsEvent`, `commissionReportEvent`, and `reqExecutions` on reconnect. Daily loss uses the policy below, not an unverified UI estimate. |
| Contracts | `reqContractDetails` and `reqMatchingSymbols`; map industries/categories to sector ETFs. Explicitly include SMH for semiconductors and surface unknown mappings. |
| Options | `reqSecDefOptParams` and option `reqMktData` model Greeks. Verify market-data entitlements and non-null Greeks on the paper account; otherwise label unavailable and disable dependent screens/actions. |
| Relative strength | Port the existing Fred6725 source off Client Portal. Verify its actual coverage: the current implementation is top-30 only. Do not imply a full-universe ranking or classify an omitted symbol as lagging. Show coverage or hold the affected view until the source supports it. |
| Market posture | Port `market_assessment.py` to TWS bars and map outputs to the approved healthy/selective/defensive states. Do not expose the old `broad` state as though it were an approved posture. |
| Watchlists | Orbit-local after a one-time Client Portal import. Verify names, ordering, and alerts before retiring Client Portal; TWS watchlists are not the v1 editing source. |

### Deterministic rules

- **Stock sizing:** `shares = floor(risk_budget / (worst_allowed_entry - stop))`. For the approved IREN breakout example,
  trigger is `$18.85`, limit is `$18.90`, stop is `$18.05`; risk/share is `$0.85`, so a `$500` budget sizes to 588
  shares and `$499.80` planned price-to-stop risk. A stop can gap and fees/slippage can increase realized loss; never
  describe the estimate as guaranteed maximum loss.
- **Options sizing:** `contracts = floor(risk_budget / (premium × 100))`; return zero when one contract exceeds the
  budget. The premium paid is the defined maximum loss for a long option, before fees. Black-Scholes and Greeks are
  display estimates only, never sizing inputs.
- **Options order scope:** v1 permits only long single-leg calls/puts. It does not send attached option brackets,
  automatic option stops, or automatic take-profit orders. A displayed option target is an alert/reference only; the
  trader closes manually. No multi-leg orders, short options, or spreads.
- **Slip/chase:** for an entry whose fill price can float, recompute size when slippage consumes risk headroom. For a
  stop-limit breakout, size at the worst executable limit from the first draft and keep that quantity for fills at or
  below the limit; if the limit changes, recompute. Beyond the limit, block. Never increase size for a better fill.
- **Daily loss:** count realized net losses from trades closed during the current `America/New_York` trading day,
  including each commission once. Do not reserve open or armed risk. This is the user's accepted stacking risk: several
  open trades can lose their full planned risk before realized-loss lockout activates. Lock new risk-adding actions
  when the configured limit is reached; keep risk-reducing actions enabled.
- **Cooldown:** persist a stop-out cooldown deadline across process restarts. A restart cannot clear the cooldown.
- **Day-trade rule:** none. FINRA retired day-trade counting and the $25,000 PDT minimum effective 2026-06-04
  (Rule 4210 amendment, Notice 26-10), superseding the original PDT guardrail (D55). Intraday risk is governed by
  the other guardrails here and the broker's real-time intraday margin checks. Account reads report the rule
  status, and any legacy `DayTradesRemaining` tag, without gating on it.
- **Other guardrails:** max risk per trade, regular-hours calendar (ET, including holidays/DST), live-data freshness,
  spread, Gateway health, buying power, and no chasing. Check again at send time. Exits remain available.
- **Indicators:** EMA seeded by SMA, SMA, session VWAP, RSI 14, ATR, weekly EMA 8/9. Return `null` until warmed up and
  report `needs N bars, has M`; do not draw a partial indicator as complete.
- **Playbooks:** evaluate the five approved rule sets on completed daily/weekly bars. Every match reports each rule,
  pass/fail, measured value, and data coverage.
- **Compare:** report 1M/3M/6M/1Y returns, point difference, benchmark/sector/peer RS line and 50-day average, RS-line
  and price highs, verdict (in line under 2 points), and a flag. This describes historical data, not a prediction.

## 5. Broker order lifecycle

The present adapter is stock-only, and the package builder must not be treated as proof that IBKR accepts a proposed
parent/child graph. The prototype's MOC, GTD, target, and stop examples are illustrative until validated.

At the time of review, `tws_order_packages.py` accepts only MKT/LMT package parents and defaults legs to DAY, while the
breakout requires a stop-limit parent and swing protection may need GTC/GTD. Extend those constraints only after the
paper spike confirms each order type and TIF; do not silently send a different order than the plan describes.

Before Phase 2, run a bounded order-shape spike against the IBKR paper account. Record the exact orders, status
transitions, error codes, partial-fill behavior, and cancellation behavior for:

1. A breakout buy stop-limit parent with the `$18.90` limit and attached protective stop/targets.
2. Partial fills and cancellation of the unfilled remainder without losing protection on filled shares.
3. Target OCA quantities, fills, and remaining stop quantity.
4. Tighten, widen, stop-to-entry, and drag operations. In particular, test and document OCA modify error 10326.
5. DAY and GTD entry expiry, and prove an entry's expiry cannot cancel the protective stop for an already-filled position.
6. A time exit at 15:55 ET. MOC is not an acceptable substitute for “out by 3:55”; test a supported broker-side time
   condition or a connected-sidecar scheduled market order. If neither works with the expected outage behavior, disable
   the promise and return for a product decision rather than silently changing the semantics.
7. Disconnect/reconnect during pending, partial, and filled states; confirm no duplicate orders and correct recovery by
   `orderRef` and execution ID.

Do not enter Engine implementation until the paper spike produces a safe, reproducible stock order graph. If stop
modification cannot be made safely, do not substitute cancel-and-replace without proof that protection is never lost
and duplicate exits cannot occur. Keep the affected control disabled and raise the unresolved product decision.

For stock intraday time exits, never label an MOC as a 15:55 exit. For swing orders, entry expiry and position-protection
lifetime are separate: an unfilled entry may expire, but an open position's stop must remain valid. A GTC/GTD package
that removes the stop when the entry expires is not acceptable.

## 6. Testing and operational policy

- Use a deterministic fake broker at the public sidecar boundary for normal tests. It must model order status events,
  partial fills, reconnect snapshots, execution IDs, commission reports, paper/live identity, and relevant IBKR rejects.
  Use the real IBKR paper account only for the explicit order-shape spike and end-to-end paper acceptance.
- Test security at the API boundary: missing/wrong per-launch secret, rejected WebSocket before subscription, every
  disabled legacy mutation route, live port with `DU` prefix, paper port with non-`DU` account, stale identity, and
  allowed risk-reducing actions while locked.
- Use isolated temporary databases and versioned migrations. Test backups, restart persistence, and recovery; do not
  delete or weaken existing safety-anchor tests during cleanup.
- Prefer event-driven waits with bounded timeouts over fixed sleeps. Do not use 0.3-second sleeps as a proxy for a
  5-millisecond latency claim. Latency gates are measured separately against a fresh process in Phase 9.
- Run each scenario through its actual UI/API entry point and paper-data path. Important coverage includes repeated
  revisions, edits during a hold, partial fills, restarts, missed fills while Orbit is closed, stale quotes, and
  guarded exits.
- Follow [`docs/testing.md`](../../testing.md): protect each critical promise at its highest public boundary.

## 7. Phases and exit criteria

Each phase ends with its checks passing and the user's approval before the next phase. No live account is enabled before
Phase 10 approval.

| Phase | Goal | Exit criteria |
|---|---|---|
| 0. Groundwork and sidecar closure | Add repo `AGENTS.md` rules for money math and design records; remove README references to missing skills; inventory all routes and packaged Tauri capabilities; generate and pass a per-launch secret for every mutation and WebSocket; disable legacy live-order routes; enforce paper port **and** `DU` account prefix; move client ID ownership to the sidecar. | Backend tests prove unauthenticated/wrong-secret mutations and WebSockets fail, old live routes are disabled, paper identity is accepted, and either live-port or non-`DU` identity fails closed. Packaged-app capability review confirms the trusted webview is the only holder of its secret and no agent can invoke generic shell/file/network capabilities. |
| 1. One connection and transition | TWS/IB Gateway supplies current product data; port watchlists/alerts/settings, market posture, RS, and holdings; versioned DB migration with backup/rollback; retire Client Portal only after parity checks. | With Client Portal stopped: watchlist import and alerts survive restart; posture has the three approved states; the day-trade rule status is reported on paper (D55); frozen/stale/unknown data cannot authorize an order and delayed data is labeled (D54); bar/ATH coverage (D56), RS universe limits, SMH mapping, option fields/Greeks, executions, and commissions have documented pass/fail results. Unknown data is explicitly marked unavailable. |
| 2. Paper order-shape spike, then engine | First verify the stock package and stop-change semantics described above. Then implement persistent plan/revision state, sizing, guardrails, order package, indicators, playbooks, and Compare. | Paper evidence approves an exact order graph; fixtures match hand calculations including 588-share sizing; guardrail, restart, reconciliation, PDT, cooldown, and commission tests pass. Unsupported broker behavior remains disabled, not simulated. |
| 3. UI foundation | UI SDK shell, approved theme, nav, dock, command palette, toasts, hold, shortcuts, agent bridge, and lazy loading. | Trusted-event and 400 ms hold behavior, revision invalidation, hidden controls, secret handling, and bridge refusal pass at the UI boundary. |
| 4. Ideas and charts | Market strip, playbook setups, Leaders, local watchlists, alerts, thesis, charts/drawings, Compare, and Playbooks. | Scenarios 1, 2, 4, and 18 work on TWS-derived data. Charts resize, zoom, and pan; labels never cover price action; text and controls do not overflow at 1024/1280/1440/1920px in both themes. Insufficient history and incomplete RS/sector data are visible and never fabricated. |
| 5. Plans and placing | Stock plan cards, risk slider, watch list, console, pre-arm, place, and slip handling. Options remain long single-leg, premium-risked, without automated brackets/targets. | Scenarios 5–9 work on the paper account with the proven order graph, exact revision, current quote, and all guards. Option UI does not imply an unshipped bracket. |
| 6. Live | Trade view, forks, one-click/keyboard actions, validated stop edits, partial fills, catch-up, holdings, and working orders. | Scenarios 11–16 pass, including interrupted/reconnected states and Orbit-only Flatten all scope. No unsupported stop edit is exposed. |
| 7. Agent | API-key adapter first, MCP read-only server, event check-ins, screenshot freshness, memory Level 0/1, Keychain, no-agent fallback, privacy copy. Add Codex/Antigravity only after the OS-sandbox test. | Scenarios 3, 10, and 19 pass; agent cannot reach broker/sidecar/files or issue order actions. Position sharing is controlled by the runtime setting. |
| 8. Review and cleanup | Review from the durable Orbit trade log; results by playbook; retire Client Portal, exclusive modes, obsolete pages, free-form ticket, and unused dependencies. Flex is not part of v1; older-trade import is a later feature. | Scenario 17 passes after restart/reconciliation; migration backup and rollback are verified; all retained data paths have a source and owner. |
| 9. Latency run | Measure and optimize UI action → sidecar, sidecar → `placeOrder`, and quote tick → screen against IB Gateway. Prefer streams over polling. | Report p50/p95/max from a fresh process on real supported paths, identify measurement conditions, and rerun after final optimization. Proposed budgets (under 10 ms, under 5 ms, under 100 ms respectively) are hypotheses to confirm, not reasons to weaken correctness or safety. |
| 10. Live trading | Only after paper results and separate explicit user approval, add a live-account gate and update `docs/architecture/modules.md` Trading Safety to match the implemented D14/D15 backend policy. | Live account is still rejected before approval; approval is an explicit backend setting/action and is covered by tests. |

Update `docs/architecture/modules.md` when the new safety behavior is implemented, not earlier than the code.

## 8. Known risks and non-goals

- `@ui-sdk/react` is beta; wrap it behind small adapters and pin the tested version.
- TWS historical depth, Greeks entitlements, day-trade fields, stop modification in OCA, and timed exits require paper
  verification. Do not display inferred values as confirmed broker behavior.
- The current RS service covers only a limited list, the current posture path uses Client Portal, and the current
  adapter does not support options. These are Phase 1 gaps, not production-ready features.
- A disconnected Orbit cannot cancel or modify orders already resting at IBKR. The UI must state what remains at the
  broker and must not claim a locally scheduled exit will run while the sidecar is unavailable.
- Consumer AI providers may receive position data only when the user enables sharing. Orbit must work fully without
  an agent.
- The prototype's timers, quotes, broker responses, and agent responses are simulated. Do not use prototype latency or
  output as validation evidence.
- Out of scope for v1: scans, account performance curve, transactions ledger, news, pre/after-hours, short selling,
  averaging down, spreads, multi-leg options, option brackets/automatic targets, multiple accounts, non-USD positions,
  memory Level 2, and away notifications.
