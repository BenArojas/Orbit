# TWS Paper Order MVP Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this plan task-by-task. Slice 1 is
> a required standalone base. After Slice 1 is reviewed, execute Slices 2+3
> together, then Slices 4+5 together.

## Goal

Let a user create a stock execution draft in the TWS Execution Assistant, preview
the exact paper TWS order Orbit will send, explicitly confirm, submit that paper
order to TWS/IB Gateway, and see the submitted order appear in Open Orders.

## Non-goals

- No live trading path.
- No cancel, modify, bracket, OCA, scale-out, trailing, or conditional orders.
- No autonomous trading, AI arming, scanner-triggered orders, or background
  execution.
- No database persistence or audit ledger in this MVP.
- No Level 2/depth, streaming quotes, entitlement detection, or historical quote
  fallback.
- No Client Portal order submission reuse.

## Current repo baseline

- TWS module gating, exclusive `none | client_portal | tws` session mode, and
  TWS-only launcher behavior already exist.
- `TwsBrokerAdapter` owns the `ib_async` connection and exposes status,
  instrument search, quote snapshots, positions, and open orders.
- Execution drafts are process-local and validate stock-only plans through TWS
  contract details.
- The UI can resolve symbols to `conid`, show quote context, save a draft, and
  validate it.
- No order preview/submit endpoint exists.
- `TwsBrokerAdapter.connect()` still records the known gap that paper/live
  enforcement must be closed before any order-submission path exists.

## Architecture decision summary

- Add order submission only behind `TwsBrokerAdapter`; no `ib_async` types leak
  to routers, services, Pydantic models, or frontend contracts.
- Use Orbit-owned Pydantic models for paper order preview and submission results.
- Treat the current process-local `ExecutionPlanService` as the MVP source of
  order intent. Do not add plan storage yet.
- Enforce a fail-closed paper-only gate before preview and before submit. For
  this MVP, paper-submit eligibility is limited to default paper ports
  `4002` (IB Gateway paper) and `7497` (TWS paper). Unknown/custom/live ports are
  read-only only.
- Require a valid draft and explicit user confirmation before calling TWS
  `placeOrder`.
- Refresh existing reconciliation/open-orders state after submit instead of
  creating an Orbit-owned order table.

## Docs and inputs read

- `AGENTS.md`
- `docs/testing.md`
- `docs/architecture/backend.md`
- `docs/architecture/frontend.md`
- `docs/architecture/modules.md`
- `docs/archive/2026-06-05-tws-execution-assistant-design.md`
- `docs/archive/2026-06-26-tws-execution-assistant-implementation.md`
- `docs/archive/2026-06-27-tws-market-data-capability-plan.md`
- `PROJECT_PLAN.md`
- Current implementation files under `backend/routers/`,
  `backend/services/`, `backend/models/`, and
  `src/modules/tws-execution-assistant/`.

## Research conclusions that affect implementation

- TWS order status is asynchronous. The first submit path must return the
  broker order id/status Orbit can know immediately and then refresh Open Orders.
- TWS paper behavior is not live approval. Keep live mode deferred behind a
  separate safety design.
- Existing unmanaged order visibility is enough for the MVP. Do not add a DB
  distinction between Orbit-created and external orders until cancel/modify or
  restart recovery needs it.
- Level 1 live/delayed quote context is enough for manual limit entry. Depth,
  streaming, and historical fallback do not block a paper order MVP.

## Parent milestone list

1. Close the paper-only safety gate and add exact order preview.
2. Add backend paper submit through `TwsBrokerAdapter`.
3. Add frontend confirm/submit and refresh reconciliation.
4. Make failed or ambiguous submit outcomes visible and safe to retry.
5. Tighten post-submit UI state and track deferred market-data/order features.

## Tracer-bullet slices

### Slice 1: Paper Preview Base And Fail-Closed Gate

- **Behavior proven:** In TWS mode, a connected user with a valid stock draft can
  preview the exact paper order payload Orbit would send. Orbit does not submit
  anything. Preview is rejected unless the adapter is connected through paper
  port `4002` or `7497`; all unknown/custom/live ports remain read-only.
- **AFK or HITL:** HITL after completion because this closes the first
  order-safety gate.
- **Files likely touched:** `backend/models/tws_execution_assistant.py`,
  `backend/services/tws_broker_adapter.py`,
  `backend/routers/execution_assistant.py`,
  `backend/services/execution_plan.py`,
  `backend/tests/test_execution_plan.py`,
  `src/modules/tws-execution-assistant/api.ts`,
  `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`.
- **Public interface:** Add a paper preview endpoint such as
  `POST /execution-assistant/plans/{plan_id}/preview-paper` returning an
  Orbit-owned preview model with `plan_id`, `conid`, `symbol`, `side`,
  `quantity`, `order_type`, `limit_price`, `tif`, `transmit`, and
  `paper_only=true`.
- **Verification command:** `cd backend && uv run python -m pytest tests/test_execution_plan.py -q`
  plus `npm run typecheck`.
- **Critical promise covered:** Unsafe trades cannot happen. Preview/submit work
  must fail closed outside the paper-only gate.
- **Explicit stop condition:** Stop when preview works and cannot submit. Do not
  add `placeOrder`, confirm UI, DB persistence, cancel/modify, or live handling.

### Slice 2: Backend Paper Submit Endpoint

- **Behavior proven:** A valid previewed paper draft can be submitted through a
  backend endpoint that calls `TwsBrokerAdapter` exactly once and returns an
  Orbit-owned submission result. Invalid drafts, disconnected adapters, kill
  switch active states, and non-paper ports fail before any TWS order call.
- **AFK or HITL:** AFK after Slice 1 is approved; stop for human approval if the
  implementation needs any live-account policy or architecture change.
- **Files likely touched:** `backend/models/tws_execution_assistant.py`,
  `backend/services/tws_broker_adapter.py`,
  `backend/routers/execution_assistant.py`,
  `backend/services/execution_plan.py`,
  `backend/tests/test_execution_plan.py`.
- **Public interface:** Add a submit endpoint such as
  `POST /execution-assistant/plans/{plan_id}/place-paper` returning
  `PaperOrderSubmission` with `order_id`, `status`, `conid`, `symbol`, `side`,
  `quantity`, `order_type`, `limit_price`, and `submitted_at`.
- **Verification command:** `cd backend && uv run python -m pytest tests/test_execution_plan.py -q`.
- **Critical promise covered:** Unsafe trades cannot happen; external failures
  stop safely and visibly.
- **Explicit stop condition:** Stop when the backend can submit one stock paper
  order from one valid draft. Do not add UI, cancel, modify, DB state, live
  confirmation, or advanced order types.

### Slice 3: Frontend Confirm And Submit Loop

- **Behavior proven:** After validation, the TWS module shows the paper preview,
  requires an explicit user click to submit, disables duplicate submits while
  pending, shows the submission result, and refreshes status/reconciliation.
- **AFK or HITL:** AFK when paired with Slice 2 after Slice 1 approval.
- **Files likely touched:** `src/modules/tws-execution-assistant/api.ts`,
  `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`.
- **Public interface:** TypeScript mirrors the Slice 1 preview and Slice 2
  submission models; components call only `twsApi`.
- **Verification command:** `npm run typecheck`; manual smoke in paper IB
  Gateway/TWS with a tiny paper order.
- **Critical promise covered:** Main user workflow works from draft to submitted
  Open Order.
- **Explicit stop condition:** Stop when the UI can preview, confirm, submit,
  and refresh. Do not add cancel/modify or persistent order history.

### Slice 4: Safe Failure And Ambiguous Outcome Handling

- **Behavior proven:** If submit fails or times out, Orbit shows a typed,
  actionable state. If the outcome is ambiguous, the UI tells the user to check
  TWS/Open Orders before retrying and automatically refreshes reconciliation.
- **AFK or HITL:** HITL if a failure requires changing trading-safety policy;
  otherwise AFK after Slices 2+3 review.
- **Files likely touched:** `backend/models/tws_execution_assistant.py`,
  `backend/services/tws_broker_adapter.py`,
  `backend/routers/execution_assistant.py`,
  `src/modules/tws-execution-assistant/api.ts`,
  `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`,
  `backend/tests/test_execution_plan.py`.
- **Public interface:** Submission errors remain typed at the FastAPI boundary;
  response/body distinguishes `rejected`, `not_connected`, `not_paper`,
  `invalid_plan`, and `unknown_outcome` where practical.
- **Verification command:** `cd backend && uv run python -m pytest tests/test_execution_plan.py -q`
  plus `npm run typecheck`.
- **Critical promise covered:** External failures stop safely and visibly.
- **Explicit stop condition:** Stop when failures are understandable and do not
  encourage blind repeat submission. Do not build a retry engine.

### Slice 5: Post-submit State And Deferred Tracking

- **Behavior proven:** After submit, Open Orders displays the broker-reported
  order through the existing reconciliation table. The submitted plan stays
  visible as submitted/accepted in local UI state, but Orbit still does not own
  long-term order lifecycle state. `PROJECT_PLAN.md` records Level 2/depth,
  streaming quotes, cancel/modify, live mode, DB persistence, and audit ledger
  as deferred follow-ups.
- **AFK or HITL:** AFK after Slices 2+3 review; HITL before merging because this
  completes the paper order MVP path.
- **Files likely touched:** `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`,
  `src/modules/tws-execution-assistant/api.ts`, `PROJECT_PLAN.md`; backend only
  if reconciliation needs a small response-field adjustment.
- **Public interface:** Prefer no new API. Use existing reconciliation whenever
  possible.
- **Verification command:** `npm run typecheck`; manual paper smoke verifying
  the submitted order appears in Open Orders.
- **Critical promise covered:** Main user workflow works from end to end.
- **Explicit stop condition:** Stop when the paper MVP is reviewable end to end.
  Do not add cancellation, modification, restart recovery, or Orbit-owned order
  storage.

## Deferred work

- Level 2/depth panels and market-depth subscriptions.
- Streaming quote subscriptions.
- Historical bars for charts.
- Automatic entitlement detection beyond quote responses.
- Cancel/modify/reply workflows.
- Brackets, scale-outs, stops, trailing orders, GTD, MOC/LOC, and conditions.
- DB-backed execution plans, audit log, restart recovery, and kill-switch
  persistence.
- Live trading path and Trading Safety live confirmation integration.

## Human approval questions

1. Confirm the MVP paper-submit gate may reject all non-default paper ports
   (`4002`, `7497`) rather than trying to infer paper/live account type.
2. Confirm the first order path is stocks only with `MKT` and `LMT` only.
3. Confirm no cancel/modify is exposed until a separate order-management plan.
4. Confirm `PROJECT_PLAN.md` should be updated before Slice 1 coding starts and
   again after Slice 5 completes.

## Planner self-review

- Kept small: Slice 1 proves preview and the paper-only gate without any submit
  call.
- Kept vertical: each slice reaches a user-reviewable behavior, not a backend
  layer in isolation.
- Deliberately not planned: live trading, persistence, audit, cancel/modify,
  advanced orders, streaming quotes, depth, and historical fallback.
- Test budget: only the safety and failure boundaries need focused public tests;
  UI slices rely on typecheck plus paper manual smoke unless a critical promise
  is uncovered.
