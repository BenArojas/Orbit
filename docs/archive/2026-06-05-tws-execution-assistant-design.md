# TWS Execution Assistant Design

> Status: Draft for user review
> Branch: `feature/tws-execution-assistant-spec`
> Date: 2026-06-05

## Goal

Add a fourth Orbit module for a TWS-gated execution assistant for user-reviewed
stock trade plans. `TWS Execution Assistant` is the working label until the
product name is chosen. The assistant can execute a user-armed plan using
broker-native orders where possible and Orbit-managed monitoring where
broker-native behavior is not enough. It is a trade manager and
decision-support execution workflow, not autonomous trading.

## Key Dev Architecture Assumptions

This spec was drafted before the v1 foundation refactor (2026-06-06). The
following modules are now in place on `dev` and inform this design:

- **OrderTicket Lifecycle Module** (`src/orbit/OrderTicket/orderLifecycle.ts`):
  domain logic for draft construction, bracket rules, validation, and fill
  tracking. TWS plans may study but not reuse order submission code.
- **Orbit Account Context** (`src/orbit/accountContext/OrbitAccountProvider.tsx`):
  centralized account selection via `useOrbitAccountContext()`. When TWS mode is
  active, account switching is blocked without disconnecting TWS.
- **Client Portal Execution Adapter** (`backend/services/client_portal_execution.py`):
  hides Client Portal endpoint paths and payload quirks. An equivalent
  `TwsBrokerAdapter` is required for TWS mode behind the same intent-level
  interface style.
- **Instrument Identity Service** (`backend/services/instrument_identity.py`):
  owns conid-to-display metadata and cache-write rules. TWS contract details
  must route through this service for cache consistency.
- **Trading Safety Module** (`backend/services/trading_safety.py` plus the
  frontend live gate in `src/orbit/OrderTicket/`): owns live/paper mutation
  policy with typed decisions that fail closed on unknown accounts. TWS plan
  arming must use the same safety module for live gates.
- **Orbit Module Entry Seam** (`src/orbit/moduleEntry/` and the `orbitModules`
  registry): module registration, readiness, and gating. The TWS assistant must
  register here with mode-gating logic (available only when broker session mode
  is `tws`).
- **Sidecar Client Contract Split**: frontend API is split into core transport
  (`src/lib/sidecarClient.ts`), Orbit shell (`src/lib/api.ts`), and module-local
  API files. The TWS assistant must define its own contract file
  (`src/modules/tws-execution-assistant/api.ts`) and not call `sidecarRequest`
  directly outside it.

## Approved Policy

- No autonomous trading.
- AI, scanners, and triggers cannot place, arm, modify, or cancel orders.
- Every order must be created by, or execute within, a user-reviewed and
  user-armed plan.
- AI may draft trade ideas, trade-management ideas, and risk/reward variants.
- AI output is always draft-only until deterministic backend validation and user
  arming.
- TWS v1 starts with stocks only.
- TWS v1 is paper-first.
- Live mode comes later behind explicit settings enable, per-session arming, and
  per-plan arming.
- Live plans after restart load as `paused_requires_rearm`.
- Live arming gates are evaluated by the shared Trading Safety module
  (`backend/services/trading_safety.py`), which fails closed on unknown
  accounts. Policy changes go through the `policy-drift-check` gate before any
  merge to `dev`.

## Definitions

**Autonomous trading** means Orbit chooses or changes trade intent without user
approval. Forbidden examples:

- AI submits an order.
- Scanner finds a stock and opens a position.
- Trigger fires and places an order.
- Orbit increases size or averages down unless that exact rule was armed.
- Orbit changes symbol, account, size, stop, target, or thesis after arming.

**Automated execution** means Orbit executes inside a fixed user-approved
envelope. Allowed examples:

- User arms a stock `EntryPlan` with entry, stop, target, trim ladder, max risk,
  and expiration.
- User arms a stock `ManagementPlan` for an existing position with trim levels,
  stop movement, and trailing rules.
- Orbit submits broker-native bracket/OCA/trailing orders that match the plan.
- Orbit monitors price and submits a planned trim order only when the armed rule
  is hit and the action stays inside the approved envelope.

## TWS Grounding

Reference docs checked for this spec:

- IBKR Campus TWS API page: https://ibkrcampus.com/campus/ibkr-api-page/trader-workstation-api/
- TWS API introduction: https://interactivebrokers.github.io/tws-api/introduction.html
- TWS API order submission: https://interactivebrokers.github.io/tws-api/order_submission.html
- TWS API bracket orders: https://interactivebrokers.github.io/tws-api/bracket_order.html
- TWS API basic orders: https://interactivebrokers.github.io/tws-api/basic_orders.html
- TWS API order conditions: https://interactivebrokers.github.io/tws-api/order_conditions.html
- `ib_async` docs: https://ib-api-reloaded.github.io/ib_async/readme.html
- NautilusTrader architecture: https://nautilustrader.io/docs/latest/concepts/architecture/
- NautilusTrader execution: https://nautilustrader.io/docs/latest/concepts/execution/
- NautilusTrader live reconciliation: https://nautilustrader.io/docs/latest/concepts/live/
- NautilusTrader orders: https://nautilustrader.io/docs/latest/concepts/orders/
- NautilusTrader Interactive Brokers integration:
  https://nautilustrader.io/docs/latest/integrations/ib/

Key constraints:

- TWS API requires a running TWS or IB Gateway session.
- Order placement uses `EClient.placeOrder` with a valid order id.
- Order status arrives asynchronously through callbacks such as `openOrder`,
  `orderStatus`, and executions.
- Brackets rely on parent/child order ids and transmit behavior.
- TWS API supports conditional orders, including price and percent-change
  conditions, but Orbit-managed plans must still use Orbit's own safety ledger.
- Paper trading is the first required proving ground.
- TWS is a different session/data contract from the Client Portal Web API. Orbit
  must not let Client Portal modules render as if their data assumptions still
  hold while TWS mode is active.

## Scope

TWS Execution Assistant v1 includes:

- A fourth Orbit launcher module/tile using the working label `TWS Execution
  Assistant`.
- Exclusive TWS session mode that disables Parallax, MoonMarket, and Inflect.
- Stocks only (`secType=STK`).
- Paper mode first.
- Existing open position management.
- New trade setup planning before entry.
- Broker-native orders where possible.
- Orbit-managed plan monitoring where broker-native orders are insufficient.
- AI draft ideas for risk/reward, entries, stops, targets, and trim ladders.
- Deterministic backend validation before arming.
- Audit log for every plan lifecycle event and order intent.
- Kill switch.
- Restart recovery that pauses live plans.

Out of scope for v1:

- Options, futures, forex, crypto, and multi-leg strategies.
- Fully autonomous entry.
- AI order placement.
- Trigger/scanner order placement.
- Live execution without separate approval and gating.
- Learning from trade outcomes. Parallax fib learning remains separate.
- System tray always-on execution.
- Embedding this workflow inside Parallax, MoonMarket, or Inflect.
- Mixing TWS and Client Portal session assumptions in the same active module.

## Orbit Module Boundary and Session Modes

The TWS assistant is its own Orbit module. It does not live inside MoonMarket,
Parallax, or Inflect. The launcher owns a single broker session mode:

- `none`: no broker session is active; all broker-backed modules are disabled.
- `client_portal`: Parallax, MoonMarket, and Inflect are enabled according to
  their normal auth/build state. TWS Execution Assistant is disabled.
- `tws`: only TWS Execution Assistant is enabled. Parallax, MoonMarket, and
  Inflect are disabled with a clear "Client Portal mode required" message.

Backend state uses the same single-mode contract. `BrokerSessionService` owns
mode transitions and prevents both broker adapters from being active at the same
time.

Rules:

- Switching from `client_portal` to `tws` requires explicit user confirmation.
- Switching from `tws` to `client_portal` requires disconnecting the TWS adapter,
  pausing active TWS plans, and clearing any live session arming.
- Direct navigation to disabled module routes redirects to the launcher with the
  disabled reason.
- Shared identifiers remain allowed: `conid`, symbol display names, and
  instrument metadata can be reused only through Orbit-owned models.
- Cross-mode feature reuse is UX/reference reuse only. Backend data contracts
  remain separate.

## TWS Adapter Boundary

Use `ib_async` only behind an Orbit-owned `TwsBrokerAdapter`. The spec is
library-neutral; `ib_async` is the first implementation candidate after a
paper-mode spike.

`TwsBrokerAdapter` responsibilities:

- Connect, disconnect, report health, and detect paper/live account mode.
- Allocate and track TWS order ids.
- Translate Orbit contracts/order intents into TWS contracts/orders.
- Translate TWS callbacks, trades, fills, order statuses, and positions into
  Orbit domain events.
- Reconcile current TWS open orders, positions, and executions into Orbit's
  execution ledger.
- Surface typed adapter errors, never raw third-party exceptions.

Hard boundary:

- No `ib_async` classes or enums in Pydantic API models.
- No `ib_async` classes or enums in SQLite rows or JSON blobs.
- No `ib_async` imports in frontend code.
- No `ib_async` imports in plan, risk, compiler, monitor, or audit services.
- Only the adapter module may import `ib_async`.

Required spike before locking the dependency:

1. Connect to a TWS paper session.
2. Read managed accounts, positions, open trades, and account mode.
3. Place and cancel a tiny paper stock order.
4. Place and cancel a tiny paper bracket order.
5. Disconnect, reconnect, and reconcile open orders/fills.
6. Verify that all outputs can be converted into Orbit-owned models.

If the spike fails, fall back to official `ibapi` or reassess selected
NautilusTrader adapter patterns without adopting NautilusTrader as a dependency.

## NautilusTrader Architecture Reference

NautilusTrader is a reference for execution architecture, not an Orbit runtime
dependency.

Patterns to adopt:

- Domain-driven execution objects: Orbit-owned `OrderIntent`, `OrderLink`,
  `ExecutionEvent`, `PositionSnapshot`, and `PlanState`.
- Event-driven commands and events: submit/modify/cancel commands produce
  persisted execution events.
- Risk gate before adapter submission, similar to a risk engine.
- Separate adapter boundary for venue-specific behavior.
- Durable event log as the source for replay, audit, and restart recovery.
- Startup reconciliation before plans resume.
- Explicit handling for external or unmanaged broker orders.
- Distinguish local denial from broker rejection.
- Treat ambiguous submit outcomes as `in_flight` until reconciliation resolves
  them.
- Fail fast on corrupt prices, invalid quantities, impossible state
  transitions, or invariant violations.
- Trading states: `active`, `halted`, and `reducing_only`.

Patterns not to adopt for v1:

- Full trading-engine dependency.
- Strategy/backtest/live parity as a product requirement.
- Autonomous strategies.
- Rust core or Nautilus runtime integration.
- Multi-venue or multi-asset abstraction beyond stocks in TWS v1.

## Relationship to Existing OrderTicket

Orbit already has a shared OrderTicket using the Client Portal Web API,
implemented in `src/orbit/OrderTicket/` with lifecycle logic extracted into
reusable modules:

- `orderLifecycle.ts` — domain logic for draft building, bracket rules,
  validation, result parsing, and fill tracking
- `useOrderTicketLifecycle.ts` — React hook orchestration, including the
  trading-safety live gate
- supporting state stores and UI components

Current OrderTicket capabilities:

- stock preview/place/cancel/modify
- paper/live guards through the Trading Safety decision endpoint
- brackets
- trailing stop and trailing stop limit
- outside RTH
- risk/reward readout
- cash and buying-power sizing
- single-leg option order support, with option brackets deferred

For the TWS assistant:

- **Do not reuse** order submission code; MoonMarket submits through
  `ClientPortalExecutionAdapter`, which TWS cannot share.
- **May study** bracket construction rules and fill-state derivation in
  `orderLifecycle.ts` to inform equivalent TWS plan compilation logic
  (parent/child order linking, state reconciliation after fills).
- Implement a **separate** `ExecutionCompiler` for TWS that produces
  broker-native contracts/orders instead of Client Portal payloads.

The TWS assistant does not replace the OrderTicket and is not implemented inside
MoonMarket. It adds:

- a TWS connection adapter
- durable trade-plan records
- plan arming and state transitions
- broker-native order compilation from plans
- Orbit-managed monitoring for user-armed rules
- execution audit/replay

The existing OrderTicket interaction pattern remains the reference for user
review, preview, confirmation, and live/paper labeling.

Implementation boundary:

- MoonMarket order endpoints remain Client Portal only.
- TWS assistant endpoints use their own route namespace and services.
- Shared UI language is allowed, but order submission code is not shared across
  broker modes unless it operates only on Orbit-owned domain models.

## Plan Types

### EntryPlan

For new stock setup planning before entry.

Required fields:

- `plan_id`
- `account_id`
- `conid`
- `symbol`
- `side` (`BUY` first; short support deferred unless explicitly enabled)
- `entry_type` (`market`, `limit`, `stop_limit`, `entry_zone`)
- `entry_price` or `entry_zone`
- `quantity` or sizing rule
- `max_position_value`
- `max_risk_amount`
- `stop_loss`
- `targets`
- `trim_ladder`
- `time_in_force`
- `expiration`
- `mode` (`paper` or `live`)
- `status`

### ManagementPlan

For current stock positions.

Required fields:

- `plan_id`
- `account_id`
- `conid`
- `symbol`
- `position_quantity_snapshot`
- `average_cost_snapshot`
- `remaining_managed_quantity`
- `stop_rule`
- `trim_ladder`
- `trailing_rule`
- `max_risk_amount`
- `expiration`
- `mode`
- `status`

Both plan types support notes, AI draft provenance, validation results, and audit
references.

## AI Role

AI can draft:

- entry thesis
- entry zone
- stop
- targets
- trim ladder
- risk/reward alternatives
- "move stop to breakeven after target 1" ideas
- trailing-after-target ideas
- management suggestions for existing positions

AI cannot:

- arm a plan
- submit orders
- modify orders
- cancel orders
- increase plan risk
- choose account or live mode
- bypass validation

All AI drafts must be converted into structured plan drafts. The backend must
validate all prices, quantities, account constraints, max risk, and allowed
instrument type before the user can arm the plan.

## Execution Modes

### Paper Mode

Paper mode is the first implementation target.

- Available once TWS paper connection is healthy.
- Plans can be armed per plan.
- Paper plans may resume after restart if validation passes against current
  position/order state.
- Paper execution events still write the full audit log.

### Live Mode

Live mode is deferred until paper mode is proven.

Required gates:

- global setting: `enable_live_execution_assistant`
- account-level live enable
- per-session live arming
- per-plan arming
- max order value
- max position value
- max daily loss
- max daily order value
- kill switch visible anywhere execution state is active

Restart behavior:

- Live session arming never survives restart.
- Active live plans load as `paused_requires_rearm`.
- User must review current account, open orders, current position, and latest
  validation before re-arming.

## Broker-Native vs Orbit-Managed

Use broker-native orders first when the desired behavior maps cleanly to IBKR:

- bracket orders
- OCA groups
- stops
- stop limits
- trailing stops
- trailing stop limits
- TWS conditional orders when they safely match the plan

Use Orbit-managed monitoring when broker-native orders are insufficient:

- multi-step trim ladder that depends on filled quantity state
- "after target 1 fills, move remaining stop to breakeven"
- staged trailing behavior after a target
- percent-change trim logic not expressible safely as one native order group
- plan state reconciliation after partial fills

Orbit-managed actions must be idempotent and bounded by the armed plan. If the
current state no longer matches the plan snapshot, the next action pauses with
`requires_review`.

## Plan State Machine

Statuses:

- `draft`
- `validated`
- `armed`
- `active`
- `partially_executed`
- `paused_requires_review`
- `paused_requires_rearm`
- `completed`
- `cancelled`
- `expired`
- `failed`

Transitions:

- `draft -> validated`: backend validation passes.
- `validated -> armed`: user arms the plan.
- `armed -> active`: first broker-native order is accepted or monitor starts.
- `active -> partially_executed`: at least one planned action fills.
- `active -> paused_requires_review`: account, position, order, price, or TWS
  state diverges from the plan envelope.
- `active -> paused_requires_rearm`: live plan after restart or lost session
  arming.
- `active -> completed`: all planned actions are done.
- `active -> expired`: expiration reached.
- any non-terminal state -> `cancelled`: user cancels.
- any active state -> `failed`: unrecoverable typed execution error.

## Architecture

Frontend module:

- `src/modules/tws-execution-assistant/`
  - own module route, layout, status panels, plan builders, active-plan views,
    and audit drawers
  - reachable only in `tws` broker session mode

Orbit shell:

- `BrokerSessionProvider`
  - owns `none | client_portal | tws`
  - drives launcher tile enable/disable state
  - blocks direct module route access when the active mode is incompatible
- Orbit module entry seam (`src/orbit/moduleEntry/` + `orbitModules` registry)
  - already owns module registration, readiness, and route gating on `dev`
  - the TWS assistant registers here with mode-gating logic: available only
    when broker session mode is `tws`; Parallax, MoonMarket, and Inflect stay
    gated to `client_portal`
- `OrbitAccountProvider` (`src/orbit/accountContext/`)
  - already owns account selection on `dev` via `useOrbitAccountContext()`
  - the TWS assistant consumes the same context; account switching is read-only
    while a TWS session is active
- `OrbitLauncher`
  - shows Parallax, MoonMarket, Inflect, and the working-label TWS assistant tile
  - explains why disabled modules are unavailable in the current mode

Backend services:

- `BrokerSessionService`
  - owns exclusive broker session mode and mode transitions
  - prevents Client Portal and TWS adapters from being active together
- `ClientPortalExecutionAdapter` (`backend/services/client_portal_execution.py`, already on `dev`)
  - Client Portal-specific implementation of the execution interface
  - owns endpoint paths, HTTP verbs, payload quirks, and pacing rules
  - called by MoonMarket order routes/services and Inflect position reads
  - `TwsBrokerAdapter` is the TWS-mode equivalent behind the same intent-level
    interface style; no broker-specific types leak into services, API models,
    or UI in either mode
- `InstrumentIdentityService` (`backend/services/instrument_identity.py`, already on `dev`)
  - owns conid-to-display metadata, cache-write rules, and IBKR payload
    normalization
  - TWS contract details must route through this service so cache rules remain
    consistent across broker modes
- Trading Safety module (`backend/services/trading_safety.py`, already on `dev`)
  - owns live/paper mutation policy, typed approval/rejection decisions, and
    confirmation metadata; fails closed on unknown accounts
  - TWS plan arming and live execution gates evaluate through the same module
- `TwsConnectionService`
  - owns TWS socket lifecycle, client id, connection health, and account mode
  - exposes status to frontend
- `TwsBrokerAdapter`
  - wraps TWS API calls and callbacks
  - first implementation candidate is `ib_async`
  - owns order id allocation and reconciliation
  - converts Orbit order intents into TWS contracts/orders
  - converts raw TWS updates into Orbit-owned domain events
- `ExecutionPlanService`
  - validates, stores, arms, pauses, resumes, cancels, and expires plans
  - owns state machine transitions
- `ExecutionCompiler`
  - compiles `EntryPlan` and `ManagementPlan` into broker-native order groups or
    Orbit-managed monitor actions
- `ExecutionMonitor`
  - watches quotes, open orders, fills, and positions
  - triggers only approved actions inside armed plans
- `ExecutionRiskService`
  - checks max order value, max position value, max daily order value, max daily
    loss, buying power, and risk per plan
- `ExecutionAuditService`
  - writes immutable plan events, order intents, order ids, state changes, and
    errors
- `ExecutionKillSwitch`
  - globally pauses monitors and blocks new order submissions

Frontend surfaces:

- fourth Orbit tile/module for the working-label TWS assistant
- TWS connection/status panel
- execution-assistant settings
- plan builder for `EntryPlan`
- plan builder for `ManagementPlan`
- AI draft review panel
- plan validation summary
- arming dialog
- active plans table
- audit detail drawer
- kill switch

## Storage

All tables are additive.

- `broker_session_state`
  - `id`
  - `mode` (`none`, `client_portal`, `tws`)
  - `status`
  - `last_transition_at`
  - `transition_reason`
- `broker_session_events`
  - `id`
  - `from_mode`
  - `to_mode`
  - `event_type`
  - `event_json`
  - `created_at`
- `execution_plans`
  - `plan_id`
  - `plan_type`
  - `account_id`
  - `conid`
  - `symbol`
  - `mode`
  - `status`
  - `version`
  - `plan_json`
  - `validation_json`
  - `created_at`
  - `updated_at`
  - `armed_at`
  - `expires_at`
- `execution_plan_events`
  - `id`
  - `plan_id`
  - `event_type`
  - `event_json`
  - `created_at`
- `execution_order_intents`
  - `id`
  - `plan_id`
  - `intent_type`
  - `conid`
  - `side`
  - `quantity`
  - `order_json`
  - `status`
  - `created_at`
- `execution_order_links`
  - `id`
  - `plan_id`
  - `intent_id`
  - `tws_order_id`
  - `perm_id`
  - `parent_tws_order_id`
  - `status`
  - `created_at`
  - `updated_at`
- `execution_broker_events`
  - `id`
  - `plan_id`
  - `source` (`tws`)
  - `event_type`
  - `orbit_event_json`
  - `external_ids_json`
  - `created_at`
- `execution_session_arms`
  - `id`
  - `mode`
  - `account_id`
  - `armed_at`
  - `expires_at`
  - `revoked_at`
- `execution_risk_limits`
  - `id`
  - `account_id`
  - `mode`
  - `max_order_value`
  - `max_position_value`
  - `max_daily_order_value`
  - `max_daily_loss`
  - `updated_at`

Writes must use the existing `DatabaseService._run_write` invariant.

## Backend API

New Orbit-level endpoints under `/orbit/session`:

- `GET /mode`: current broker session mode and module availability.
- `POST /mode/client-portal`: switch to Client Portal mode.
- `POST /mode/tws`: switch to TWS mode.
- `POST /mode/none`: disconnect active broker adapters and disable broker
  modules.

New execution endpoints under `/execution-assistant`:

- `GET /status`: TWS connection, mode, kill-switch, session-arm state.
- `POST /connect`: request TWS connection.
- `POST /disconnect`: disconnect TWS adapter.
- `GET /settings`: read execution settings and risk limits.
- `PUT /settings`: update settings and risk limits.
- `POST /session-arm`: arm paper/live session, live only when enabled.
- `DELETE /session-arm`: revoke session arming.
- `POST /plans/draft`: create plan draft.
- `POST /plans/{plan_id}/validate`: validate against account/position/market.
- `POST /plans/{plan_id}/arm`: arm a validated plan.
- `POST /plans/{plan_id}/pause`: pause a plan.
- `POST /plans/{plan_id}/resume`: resume paper plan or re-arm live plan after
  validation.
- `POST /plans/{plan_id}/cancel`: cancel plan and optionally cancel linked
  working orders.
- `GET /plans`: list plans.
- `GET /plans/{plan_id}`: plan detail with validation, events, and linked orders.
- `GET /plans/{plan_id}/events`: audit timeline.
- `POST /kill-switch`: pause all plans and block new execution actions.
- `DELETE /kill-switch`: clear kill switch after user confirmation.

Existing MoonMarket order endpoints remain for Client Portal order ticket flows.
They must reject or stay unreachable when broker session mode is `tws`.

## Sidecar API Contract Organization

Frontend API contracts are split by responsibility (already on `dev`):

- `src/lib/sidecarClient.ts` — core transport: base URL, fetch, `ApiError`,
  offline handling
- `src/lib/api.ts` — Orbit-level shell seam: health, auth, gateway lifecycle
- `src/modules/moonmarket/api.ts` — MoonMarket product contract
- `src/modules/parallax/api.ts` — Parallax product contract
- `src/modules/inflect/api.ts` — Inflect product contract
- **`src/modules/tws-execution-assistant/api.ts`** — TWS assistant contract (to
  be created with the module)

The TWS assistant API file must:

- define intent-level methods for the `/execution-assistant/*` and
  `/orbit/session/*` endpoints above, not raw `sidecarRequest` calls at call
  sites
- own its endpoint paths and request/response types
- provide tests proving contract behavior with a mocked transport

## Validation Rules

Plan validation must reject:

- non-stock instruments (instrument class checked through the Instrument
  Identity service)
- missing or stale account id (checked against the Orbit account context)
- missing conid (verified through the Instrument Identity service)
- zero or negative quantity
- entry plans without stop/risk definition
- trim ladders whose total trim percent exceeds 100%
- stop/target levels that contradict side
- planned sell quantity greater than held or planned quantity
- live mode without all live gates active (evaluated through the Trading Safety
  module, which fails closed on unknown accounts)
- active broker session mode other than `tws` (checked through
  `BrokerSessionService`)
- risk over configured limits (checked through `ExecutionRiskService`)
- expired plans
- plans whose current position/order state diverges from their snapshot
  (reconciled through `ExecutionMonitor`)

Validation must warn, but not always reject:

- stale market quote
- wide bid/ask spread
- outside RTH
- earnings/news date not checked
- margin/buying-power uncertainty

## Error Handling

Typed errors:

- `TwsNotConnectedError`
- `TwsAuthError`
- `TwsClientIdConflictError`
- `TwsOrderIdError`
- `TwsOrderRejectedError`
- `TwsOrderStateMismatchError`
- `TwsAmbiguousSubmitOutcomeError`
- `BrokerSessionModeError`
- `ExecutionPlanValidationError`
- `ExecutionPlanStateError`
- `ExecutionRiskLimitError`
- `ExecutionLiveGateError`
- `ExecutionKillSwitchActiveError`
- `ExecutionRearmRequiredError`
- `ExecutionInstrumentUnsupportedError`

Every error that affects a plan writes an audit event.

## Restart and Reconciliation

On backend startup:

1. Load active plans.
2. Reconnect to TWS only if user settings allow auto-connect; never auto-arm live.
3. Fetch current positions and open orders.
4. Reconcile `execution_order_links`.
5. Resume eligible paper plans only if validation passes.
6. Mark live plans `paused_requires_rearm`.
7. Mark mismatched plans `paused_requires_review`.

## Testing

Required coverage:

- broker session mode transitions
- launcher tile gating for `none`, `client_portal`, and `tws`
- disabled-route redirects for incompatible session modes
- `TwsBrokerAdapter` boundary tests proving third-party types do not leak
- plan model validation
- state machine transitions
- live gate enforcement
- restart behavior for paper vs live plans
- kill switch blocks monitor actions and new order submissions
- AI draft cannot arm or submit
- compiler output for broker-native bracket/OCA/trailing groups
- Orbit-managed trim ladder idempotency
- partial fill reconciliation
- stale state pauses with `requires_review`
- TWS broker adapter with fake callbacks
- ambiguous submit outcome stays `in_flight` until reconciliation resolves it
- unmanaged/external TWS orders are detected without being claimed by a plan
- audit log for all plan events
- frontend plan builder
- arming dialogs
- active plan table
- restart/rearm messaging

All TWS network interactions must be mocked in automated tests. Manual smoke
testing uses an IBKR paper account first.

## Implementation Order

1. Spec approval.
2. Orbit broker session mode contract and launcher gating.
3. TWS module shell using the working label `TWS Execution Assistant`.
4. `TwsBrokerAdapter` interface and fake adapter.
5. `ib_async` paper-mode spike behind the adapter boundary.
6. Plan models, DB tables, and state machine.
7. Risk limits and validation service.
8. Broker-native compiler for stock brackets/trailing orders.
9. Paper-only TWS broker adapter integration and audit log.
10. EntryPlan UI.
11. ManagementPlan UI for existing positions.
12. Orbit-managed trim monitor for paper plans.
13. Restart reconciliation for paper plans.
14. Kill switch.
15. Manual paper-account smoke test.
16. Live-mode design review before any live implementation.

## Deferred

- Options and multi-leg strategies.
- Short selling unless separately approved.
- Live implementation beyond spec-level gates.
- System tray/background execution while app is closed.
- AI tool access to execution APIs.
- Fully automatic strategy generation.
- Inflect analytics and R-multiple integration.
