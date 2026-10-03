# Parallax: first market slice — locked coder handoff

Owner: Parallax. Status: scope and implementation decisions approved; ready for the separate coder. No application code has been changed by this planning work.
Source: [approved design and market rules](../specs/2026-10-03-parallax-redesign-design.md).
Next action: give this brief directly to the user's separate coder. No removed skills, issue-board workflow or additional routine product approval is required. Preserve the user's unrelated changes and use the AI/Inflect-removal product baseline.

## Plain English

Parallax opens with a simple market assessment based on the last completed daily session and streams current prices automatically. It shows SPY, QQQ, IWM and sector participation, explains which tactics deserve attention, and makes unavailable evidence visible. Existing analysis, watchlists and Compare remain accessible.

## User story

As a trader, I want to see market conditions before reviewing stocks, so I can select an appropriate tactic without mistaking index strength for broad participation.

## Smallest scope

- Make Market the authenticated Parallax landing view; preserve existing authentication and navigation behavior elsewhere.
- Produce real daily index trend evidence and 11-sector SMA50 participation through FastAPI, reusing existing IBKR resolution, history, cancellation and pacing; stream current prices through the existing WebSocket path.
- Apply only the approved broad/selective/defensive rules, with unavailable states for missing or stale evidence.
- Present the evidence in the approved Cool Mineral layout with a short tactic priority explanation and access to existing stock workflows.
- Verify the main success path and external-data failure behavior, then stop for orchestrator review.

## Technical scope and known mismatch

- Current entrypoints: `src/pages/MarketPage.tsx`, `src/store/navigation.ts`; locate the actual authenticated landing decision before changing it.
- Existing market data facade: `src/modules/parallax/api.ts`; sector HTTP boundary: `backend/routers/sectors.py`; sector computations: `backend/services/sectors.py`.
- Existing live path: `src/hooks/useLiveQuotes.ts`, singleton/ref-counted `src/hooks/useWebSocket.ts`, and `backend/routers/ws.py`. Preserve shared subscriptions used by charts and Compare; do not create a second socket per screen or instrument.
- Bootstrap historical evidence automatically, stream current prices, and reconcile missed data after reconnect. Quote ticks do not prove a daily bar has finalized; use the locked session rules below.
- Existing `/sectors/breadth` uses EMA50. It is not the approved SMA50 calculation. Do not relabel that result or silently change its public contract for existing consumers.
- Keep market posture calculations in a Parallax-owned backend implementation, not in pages or transport facades. Use Polars and existing typed boundary conventions.
- Add approved read-only `GET /market/assessment`, with no query parameters, owned by a Parallax market-assessment service and typed Pydantic/TypeScript models. Wire through the existing market router and `parallaxApi`/sidecar transport.
- Response fields: `status` (complete/partial/incomplete), `posture` (broad/selective/defensive/null), `expected_session`, `evidence_session`, `calculated_at`, `indices`, `sectors`, `participation`, `issues`, `previous_assessment` (nullable). Dates use ISO dates; timestamps use UTC ISO timestamps.
- Instrument evidence includes `symbol`, nullable resolved `conid`, `session_date`, nullable close/EMA21/SMA50/SMA200 as applicable, nullable trend/above_sma50, and unavailable reason. Unknown values stay null; SMA200 is indices-only context.
- Participation contains fixed `total=11`, available and missing counts, confirmed-above count and possible-above minimum/maximum. Label partial counts as a range or “at least”; never treat missing as below.
- `posture` is current only when all possible completions of unknown required evidence give the same outcome. Complete means all required evidence current; partial means a current conclusion is provable despite unknowns; incomplete means no current posture. Previous dated assessment is not returned as current posture. Store only the latest successful assessment in memory; no new persistence.
- Do not infer completed sessions from UTC midnight, use a partial daily bar, or call the last returned bar complete without checking provider/session semantics.
- Respect existing provider pacing and cancel abandoned work. The approved local calendar dependency and bounded Market-view reconciliation timer are in scope; no other scheduler, database migration, provider dependency or setup monitoring is approved.
- Use the current [frontend](../../architecture/frontend.md), [backend](../../architecture/backend.md) and [pacing](../../ibkr-pacing.md) boundaries. Use existing Zustand navigation; no new routing framework.
- Keep transport facades and pages focused. Make routine implementation choices independently; avoid unrelated refactors.

## Locked session, history and update rules

- Use local `exchange_calendars`, XNYS, to identify regular US sessions, holidays and early closes; calendar results are metadata, not market-data dataframe calculations. No guessed weekday fallback. Check unsupported/out-of-range calendar dates visibly.
- Use regular-session daily bars for this assessment. Extend the existing history helper with an assessment-specific regular-hours option while preserving all existing callers' defaults; include session mode in cache/coalescing keys. Do not change chart/Compare history behavior globally.
- Load one year of history. Validate dates and finite positive closes; require the latest 100 consecutive scheduled completed sessions for each instrument's required evidence. EMA21 uses the existing SMA-seeded engine over those 100 closes; SMA50 averages the latest 50. Index equality to either boundary is mixed; sector equality is not above.
- SMA200 averages the latest 200 consecutive completed sessions for SPY/QQQ/IWM only. Its absence does not block core evidence or alter posture.
- Expected evidence date is the latest completed regular session. Ignore unfinished sessions, including after-hours quote updates; all known evidence contributing to posture must match the expected date. Older evidence is unknown for current classification. During post-close delivery wait, show prior dated assessment and updating/incomplete state.
- Live prices use the shared WebSocket. Request assessment/history automatically on Market entry, authenticated feed recovery/reconnect, and session close plus five minutes. Retry incomplete evidence every five minutes while Market is mounted; clean up timers on exit, deduplicate concurrent requests, and pause provider work without authentication.
- Coalesce/cache assessment calculations by expected session; incomplete results expire within the five-minute retry window. Do not let cached unfinished history prevent eventual post-close reconciliation. Invalidate expected-session state at scheduled close; no tick-triggered history-fetch loop.
- Show actual connection/feed entitlement evidence, including delay when known. Unknown entitlement is not labelled Live. Quiet closed-market quotes alone do not indicate an outage. Snapshot bootstrap, session requests and reconnect recovery are automatic; no manual-refresh workflow.
- Leave the old EMA50 breadth contract unchanged. Update the applicable canonical public-contract docs with the additive assessment response; no other public-contract change is authorized.

## Acceptance and verification

- All three indices constructive plus 8–11 sectors above SMA50 yields Broad strength; at least two weak indices plus 0–3 sectors yields Defensive; every other complete/current combination yields Selective strength.
- Intraday changes do not change daily posture; evidence date and fetch time are clearly distinguished.
- Prices update without a refresh click. Disconnects show a visible feed state; reconnect restores subscriptions and reconciles missed data without changing posture from partial candles. Quiet/closed-market feeds are not automatically classified as stale solely because no new tick arrived.
- Partial evidence may produce a posture only if it cannot change under any missing-value completion; otherwise return null posture and show Current assessment incomplete with dated history when available. Connection failures remain visible and typed; never invent sector counts.
- Tactic emphasis does not hide or disable any tactic. Sector participation is labelled as a proxy.
- Cool Mineral styling is scoped to this redesign; no unintended MoonMarket/TWS changes. Existing Compare, chart drawings and saved settings survive.
- Reuse focused coverage where available; add meaningful workflow coverage for classification and fail-safe behavior when needed. Do not mirror the same calculation tests across every layer.
- Run appropriate typecheck/build and manual small-laptop navigation checks. Report live IBKR validation separately; do not claim it from fixtures.

## Stop conditions

The endpoint, regular-hours history option, local calendar dependency and reconciliation behavior above are approved. Stop only for a deviation, unresolved provider semantics preventing truthful regular-session evidence, or additional architecture, persistence/schema, broker execution or contract scope.
No scanner, RS ranking, entry detector, chart-tool redesign, broker execution or TWS handoff belongs in this slice.
Report the implemented behavior, relevant checks, known limitations and any live-provider verification still needed. Stop for orchestrator review before merging.
