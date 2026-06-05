# TWS Execution Assistant Design

> Status: Draft for user review
> Branch: `feature/tws-execution-assistant-spec`
> Date: 2026-06-05

## Goal

Add a TWS-gated execution assistant for user-reviewed stock trade plans. The
assistant can execute a user-armed plan using broker-native orders where
possible and Orbit-managed monitoring where broker-native behavior is not
enough. It is a trade manager and decision-support execution workflow, not
autonomous trading.

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

Key constraints:

- TWS API requires a running TWS or IB Gateway session.
- Order placement uses `EClient.placeOrder` with a valid order id.
- Order status arrives asynchronously through callbacks such as `openOrder`,
  `orderStatus`, and executions.
- Brackets rely on parent/child order ids and transmit behavior.
- TWS API supports conditional orders, including price and percent-change
  conditions, but Orbit-managed plans must still use Orbit's own safety ledger.
- Paper trading is the first required proving ground.

## Scope

TWS Execution Assistant v1 includes:

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

## Relationship to Existing OrderTicket

Orbit already has a shared OrderTicket using the Client Portal Web API:

- stock preview/place/cancel/modify
- paper/live guards
- brackets
- trailing stop and trailing stop limit
- outside RTH
- risk/reward readout
- cash and buying-power sizing
- single-leg option order support, with option brackets deferred

The TWS assistant does not replace the OrderTicket. It adds:

- a TWS connection adapter
- durable trade-plan records
- plan arming and state transitions
- broker-native order compilation from plans
- Orbit-managed monitoring for user-armed rules
- execution audit/replay

The existing OrderTicket interaction pattern remains the reference for user
review, preview, confirmation, and live/paper labeling.

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

Backend services:

- `TwsConnectionService`
  - owns TWS socket lifecycle, client id, connection health, and account mode
  - exposes status to frontend
- `TwsOrderAdapter`
  - wraps TWS API calls and callbacks
  - owns order id allocation and reconciliation
  - converts Orbit order intents into TWS contracts/orders
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

New endpoints under `/execution-assistant`:

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

## Validation Rules

Plan validation must reject:

- non-stock instruments
- missing or stale account id
- missing conid
- zero or negative quantity
- entry plans without stop/risk definition
- trim ladders whose total trim percent exceeds 100%
- stop/target levels that contradict side
- planned sell quantity greater than held or planned quantity
- live mode without all live gates active
- risk over configured limits
- expired plans
- plans whose current position/order state diverges from their snapshot

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
- TWS adapter with fake callbacks
- audit log for all plan events
- frontend plan builder
- arming dialogs
- active plan table
- restart/rearm messaging

All TWS network interactions must be mocked in automated tests. Manual smoke
testing uses an IBKR paper account first.

## Implementation Order

1. Spec approval.
2. TWS connection spike with fake adapter and paper-only status UI.
3. Plan models, DB tables, and state machine.
4. Risk limits and validation service.
5. Broker-native compiler for stock brackets/trailing orders.
6. Paper-only TWS order adapter and audit log.
7. EntryPlan UI.
8. ManagementPlan UI for existing positions.
9. Orbit-managed trim monitor for paper plans.
10. Restart reconciliation for paper plans.
11. Kill switch.
12. Manual paper-account smoke test.
13. Live-mode design review before any live implementation.

## Deferred

- Options and multi-leg strategies.
- Short selling unless separately approved.
- Live implementation beyond spec-level gates.
- System tray/background execution while app is closed.
- AI tool access to execution APIs.
- Fully automatic strategy generation.
- Inflect analytics and R-multiple integration.
