# TWS Execution Assistant Implementation Plan

## 1. Goal

Build the TWS Execution Assistant as a fourth Orbit module behind an exclusive broker-session mode. The first implementation proves the non-trading boundary only: `none | client_portal | tws`, launcher/module gating, a disabled TWS shell outside `tws`, and disabled Client Portal modules inside `tws`.

## 2. Non-goals

- No live-account trading implementation in this parent plan.
- No order placement, order modification, cancellation, arming, or monitor actions in the first slice.
- No `ib_async` or `ibapi` dependency in the first slice.
- No execution-plan persistence or migrations in the first slice.
- No reuse of MoonMarket Client Portal order submission code for TWS.
- No autonomous trading, AI arming, scanner-triggered orders, or background execution.

## 3. Current repo baseline

- `docs/superpowers/specs/2026-06-05-tws-execution-assistant-design.md` defines the fourth-module, exclusive-session, adapter-bounded design.
- `docs/research/tws-execution-assistant-research-packet.md` confirms the first slice should be non-trading boundary work.
- `src/orbit/moduleEntry/OrbitModuleEntry.tsx` currently registers only `parallax`, `moonmarket`, and `inflect`, gated only by Gateway authentication.
- `src/orbit/OrbitLauncher.tsx` renders all registered modules and enables them only by `isAuthenticated`.
- `src/orbit/OrbitShell.tsx` has routes for `/parallax/*`, `/moonmarket/*`, and `/inflect/*`; there is no TWS route.
- `src/orbit/OrbitProviders.tsx` always mounts `GatewayProvider`, `OrbitAccountProvider`, and `OrderTicket`; there is no broker-session provider.
- `src/lib/api.ts` owns shell-level health/auth/gateway contracts; product contracts live in module-local `api.ts` files.
- `backend/main.py` wires one Client Portal `IBKRService` and registers routers; no `BrokerSessionService`, `/orbit/session`, or `/execution-assistant` router exists.
- `backend/services/client_portal_execution.py` is the adapter pattern to mirror, but TWS must get its own Orbit-owned adapter boundary.
- `backend/routers/orders.py` still assumes Client Portal order routes are available when IBKR auth passes.
- `backend/pyproject.toml` has no TWS dependency today.

## 4. Architecture decision summary

- Add an Orbit-owned broker session contract with exactly `none`, `client_portal`, and `tws`.
- Keep first-slice mode state process-local. On backend restart, derive `none` or `client_portal` from current Gateway/auth state until persistence is approved.
- Add `BrokerSessionService` as the single owner of mode and module availability. It must not connect to TWS in the first slice.
- Add backend read/status endpoints under `/orbit/session` and `/execution-assistant` before any plan/order endpoints.
- Add `BrokerSessionProvider` or equivalent shared frontend hook above the router so launcher tiles and direct route entry share one mode decision.
- Register `TWS Execution Assistant` as the fourth module, but render only a disabled/read-only shell until `tws` mode is active.
- Keep TWS contracts in `src/modules/tws-execution-assistant/api.ts`; components do not call `sidecarRequest` directly.
- Later TWS library code may exist only behind a `TwsBrokerAdapter`; no third-party TWS types may leak into API models, DB rows, or frontend code.

## 5. Research conclusions that affect implementation

- TWS and Client Portal have different session/data assumptions, so Orbit must make the active broker mode exclusive before any TWS socket work.
- TWS order IDs, callback ordering, duplicate statuses, partial fills, and ambiguous submit outcomes make order placement unsafe to start with.
- `ib_async` is the leading paper-spike candidate, but adding it before the mode/session boundary is unnecessary.
- Paper behavior can differ from live behavior; paper proof is not live approval.
- Untransmitted TWS orders are not durable enough to anchor Orbit execution plans.
- NautilusTrader is useful as an architecture reference for reconciliation and event logs, not as an Orbit dependency.
- Manual or external TWS orders must eventually be visible as unmanaged, not silently claimed by Orbit.

## 6. Parent milestone list

1. Non-trading broker-session mode and module gating.
2. Fake/read-only TWS status shell and module-local API contract.
3. Backend fail-closed guards for Client Portal order mutation routes while mode is `tws`.
4. HITL dependency and connection-policy gate for a paper read-only TWS adapter spike.
5. Read-only paper TWS connection and reconciliation snapshot.
6. Execution plan draft/validation model with no arming or order placement.
7. Separate design review before paper order submission, arming, persistence-heavy audit, or live-mode work.

## 7. Tracer-bullet slices

Each slice must prove one reviewable behavior through a public surface: launcher
UI, module UI, or HTTP API. No slice is allowed to land scaffolding that is not
exercised by that behavior.

### Slice 1: Broker Session Mode And Module Gating

- **Behavior proven:** Orbit exposes `none | client_portal | tws`; launcher shows four modules; Parallax, MoonMarket, and Inflect are disabled in `tws`; TWS shell is disabled outside `tws`; direct disabled routes do not mount their product module.
- **AFK or HITL:** HITL before coding because this introduces a public session contract and changes module ownership/gating.
- **Files likely touched:** `backend/services/broker_session.py`, `backend/models/broker_session.py`, `backend/routers/orbit_session.py`, `backend/main.py`, `backend/deps.py`, `src/orbit/OrbitProviders.tsx`, `src/orbit/OrbitLauncher.tsx`, `src/orbit/OrbitShell.tsx`, `src/orbit/moduleEntry/OrbitModuleEntry.tsx`, `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`, `src/modules/tws-execution-assistant/api.ts`.
- **Public interface:** `GET /orbit/session/mode`; minimal mode switch endpoint only if needed for the shell to enter `tws`; `BrokerSessionMode = "none" | "client_portal" | "tws"`; module availability includes disabled reasons.
- **Verification command:** `npm run typecheck`; add at most one public-boundary test for route/tile gating if no existing test covers it.
- **Critical promise covered, if any:** Main workflow and trading safety: incompatible broker modules fail closed before rendering.
- **Explicit stop condition:** Stop when the first shell/gating path is reviewable and no TWS socket, order route, plan storage, or TWS dependency exists.

### Slice 2: Read-Only TWS Status Shell

- **Behavior proven:** In `tws` mode, the fourth module renders a read-only assistant shell with connection/status copy from the backend; outside `tws`, it remains locked.
- **AFK or HITL:** AFK after Slice 1 approval if endpoint names and module label are approved.
- **Files likely touched:** `backend/models/tws_execution_assistant.py`, `backend/services/tws_status.py`, `backend/routers/execution_assistant.py`, `backend/main.py`, `src/modules/tws-execution-assistant/api.ts`, `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`.
- **Public interface:** `GET /execution-assistant/status` returns mode, `connected=false`, adapter state, kill-switch state, and an empty reconciliation summary.
- **Verification command:** `npm run typecheck`; `cd backend && uv run python -m pytest tests/test_execution_assistant_status.py -q` only if the status contract is otherwise uncovered.
- **Critical promise covered, if any:** External failures stop safely and visibly: TWS unavailable is visible and non-mutating.
- **Explicit stop condition:** Stop before connect/disconnect, credentials, client ID entry, order IDs, or dependency installation.

### Slice 3: Mode-Aware Client Portal Mutation Block

- **Behavior proven:** With broker session mode set to `tws`, a real Client Portal order mutation request is rejected at the public MoonMarket order API and never reaches `ClientPortalExecutionAdapter`; preview/read endpoints remain unchanged unless a later approved decision narrows them.
- **AFK or HITL:** HITL before coding because this changes trading-safety behavior at backend public boundaries.
- **Files likely touched:** `backend/deps.py`, `backend/routers/orders.py`, `backend/routers/trading_safety.py`, possibly `backend/routers/options.py`.
- **Public interface:** Typed `BrokerSessionModeError` response, likely HTTP `409`, for disallowed Client Portal mutations in `tws` mode.
- **Verification command:** `cd backend && uv run python -m pytest tests/test_orders_router.py -q` or one focused new public-boundary test if existing coverage cannot exercise mode rejection.
- **Critical promise covered, if any:** Unsafe trades cannot happen: Client Portal mutations fail closed while TWS mode owns execution.
- **Explicit stop condition:** Stop after mutation rejection is proven; do not add TWS order placement.

### Slice 4: Paper Read-Only TWS Adapter Spike

- **Behavior proven:** With human-approved dependency and local paper TWS or IB Gateway session, the TWS assistant status surface can connect, show accounts/positions/open orders, then disconnect through `TwsBrokerAdapter` without persisting or placing orders.
- **AFK or HITL:** HITL required before coding for dependency choice, TWS vs IB Gateway wording, host/port/client ID policy, and local paper-session availability.
- **Files likely touched:** `backend/pyproject.toml`, `backend/services/tws_broker_adapter.py`, `backend/services/tws_connection.py`, `backend/routers/execution_assistant.py`, `backend/models/tws_execution_assistant.py`, `src/modules/tws-execution-assistant/api.ts`, `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`.
- **Public interface:** `POST /execution-assistant/connect`, `POST /execution-assistant/disconnect`, `GET /execution-assistant/status`; Orbit-owned response models only.
- **Verification command:** Manual paper-session smoke plus `cd backend && uv run python -m pytest tests/test_execution_assistant_status.py -q` if a fake adapter test is added.
- **Critical promise covered, if any:** External failures stop safely and visibly: connection failure and client ID conflict produce typed visible status.
- **Explicit stop condition:** Stop before any `placeOrder`, cancel, modify, arming, plan storage, or order-link persistence.

### Slice 5: Reconciliation Snapshot And Unmanaged Order Visibility

- **Behavior proven:** The TWS status surface can show open orders/positions as read-only snapshots and mark external/manual orders as unmanaged.
- **AFK or HITL:** HITL before coding because client ID `0`, manual order binding, and unmanaged-order display policy need approval.
- **Files likely touched:** `backend/models/tws_execution_assistant.py`, `backend/services/tws_broker_adapter.py`, `backend/services/tws_reconciliation.py`, `backend/routers/execution_assistant.py`, `src/modules/tws-execution-assistant/api.ts`, TWS module UI files.
- **Public interface:** `GET /execution-assistant/status` or `GET /execution-assistant/reconciliation` returns Orbit-owned `PositionSnapshot`, `OrderLink`, and unmanaged-order warning data.
- **Verification command:** Manual paper-session smoke; add one fake-adapter public-boundary test only if unmanaged/external classification is otherwise uncovered.
- **Critical promise covered, if any:** Main workflow and external-failure visibility: Orbit does not silently claim orders it did not create.
- **Explicit stop condition:** Stop before creating execution plans or linking orders to plans.

### Slice 6: Plan Draft And Validation Without Arming

- **Behavior proven:** User can create or review a stock-only execution plan draft and receive deterministic validation results; no arming, submission, monitoring, or live mode exists.
- **AFK or HITL:** HITL required before coding because this introduces persistence and execution-plan public contracts.
- **Files likely touched:** `backend/models/execution_plan.py`, `backend/services/execution_plan.py`, `backend/services/execution_risk.py`, `backend/services/execution_audit.py`, `backend/services/db.py`, `backend/routers/execution_assistant.py`, TWS module plan UI files.
- **Public interface:** `POST /execution-assistant/plans/draft`, `POST /execution-assistant/plans/{plan_id}/validate`, `GET /execution-assistant/plans/{plan_id}`.
- **Verification command:** One public-boundary backend test for rejecting unsupported/non-stock or unsafe plan drafts; `npm run typecheck`.
- **Critical promise covered, if any:** Unsafe trades cannot happen and stored data is not lost or corrupted.
- **Explicit stop condition:** Stop with validated drafts only; no session arming, no broker submission, no monitor, no live gates.

## 8. Deferred work

- Paper order placement, tiny order/cancel spike, bracket spike, order ID allocation, and ambiguous-submit handling.
- Live execution mode and all live-mode gates.
- Durable broker-session persistence.
- Full execution audit/event-log schema.
- Kill switch behavior beyond read-only status.
- AI draft generation and AI provenance.
- Options, futures, forex, crypto, shorts, and multi-leg strategies.
- Always-on/system-tray execution.
- Packaging, installer, and production TWS settings.

## 9. Human approval questions

1. Approve Slice 1 as process-local session mode plus frontend/backend gating, with no DB persistence?
2. Approve the public mode contract shape: `GET /orbit/session/mode`, optional minimal switch endpoint, and `none | client_portal | tws`?
3. Confirm the fourth module label stays `TWS Execution Assistant` for first UI work.
4. Should Slice 1 add one public-boundary gating test, or use typecheck/manual smoke only?
5. Before Slice 4, choose `ib_async` or official `ibapi`, and confirm whether v1 wording allows IB Gateway as well as TWS.
6. Before reconciliation work, decide whether client ID `0` is forbidden in v1 or allowed only for read-only external-order detection.
7. Before plan draft work, approve the first persistence schema and whether `PROJECT_PLAN.md` should track the mission as active.

## 10. Planner self-review: what was kept small, what was deliberately not planned yet

- Kept small: the first slice proves only the shared broker-session mode and module gating behavior the rest of the assistant depends on.
- Kept small: no first-slice dependency, socket, order ID, DB migration, order route, AI feature, or execution monitor.
- Kept small: tests stay at zero by default, with at most one public-boundary check when a critical promise is uncovered.
- Not planned yet: paper order placement, bracket/OCA behavior, live mode, arming, durable audit, kill-switch enforcement, and AI draft workflows. Those need separate approval after the boundary and read-only adapter slices prove the shape.
