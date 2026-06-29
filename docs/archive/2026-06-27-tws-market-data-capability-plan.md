# TWS Market Data Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use tracer-bullet slices for review checkpoints.

**Goal:** Make the TWS Execution Assistant explain and use read-only quote availability across users with no market-data subscription, delayed-only data, live Level 1 data, and future Level 2/depth needs without changing trading behavior.

**Architecture:** Treat TWS market data as a read-only capability layer owned by `TwsBrokerAdapter`. The backend classifies quote availability and returns Orbit-owned models; the frontend displays quote context and subscription guidance. Execution plans remain manual and non-autonomous.

**Tech Stack:** Tauri v2, React 19/TypeScript, TanStack Query, FastAPI/Python 3.12, Pydantic, `ib_async` behind `TwsBrokerAdapter`.

## Global Constraints

- Orbit is decision support, never an autonomous trading bot.
- No order placement, order modification, cancellation, transmit, arming, live-mode gate, or execution monitor in this plan.
- No new dependency.
- No Client Portal `/market/*` reuse for TWS quote behavior.
- No IBKR subscription purchase automation. Orbit may guide; the user must manage subscriptions in IBKR.
- `ib_async` types must stay inside `TwsBrokerAdapter`; API models and frontend contracts stay Orbit-owned.
- Quote availability must not block draft creation when the user can manually enter a limit price.
- Default to zero new tests unless a critical promise is uncovered; maximum one public-boundary test per slice.

---

## Current Repo Baseline

- TWS slices 1-6 exist: exclusive session mode, TWS module gating, read-only adapter, reconciliation, and in-memory draft validation.
- `backend/services/tws_broker_adapter.py` has `search_instruments()` and `get_quote()`.
- `backend/models/tws_execution_assistant.py` has `InstrumentResult` and `QuoteSnapshot`, but quote responses currently carry only nullable price fields.
- `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx` shows a quote strip only after a quote request; all-null quotes render generic `Market data unavailable.`
- A current WULF request produced IBKR error `10089`: API market data subscription required; delayed market data available.
- Existing TWS quote tests live in `backend/tests/test_execution_assistant_instruments.py`.

## Docs And Inputs Read

- `AGENTS.md`
- `docs/testing.md`
- `docs/architecture/modules.md`
- `docs/archive/2026-06-05-tws-execution-assistant-design.md`
- `docs/archive/2026-06-27-tws-broker-cockpit-ui-design.md`
- `docs/archive/2026-06-26-tws-execution-assistant-implementation.md`
- `PROJECT_PLAN.md`
- IBKR market data type docs: live, frozen, delayed, delayed frozen.
- IBKR market data subscription docs: API market data often needs Level 1 subscription and Market Data API acknowledgement.
- Reddit L2/API thread: TWS-visible data can still be unavailable through API until the correct API/off-platform subscription is enabled.

## Research Conclusions That Affect Implementation

- IBKR error `10089` is not just a weekend/closed-market condition. It means the API request lacks required market-data permissions or API-enabled subscription coverage.
- Closed markets can make live bid/ask unavailable. Frozen or delayed-frozen data is the correct read-only fallback for last available quote context.
- Level 1 top-of-book data is enough for this assistant's first limit-price context.
- Level 2/depth data is not needed for draft saving and should stay deferred.
- IBKR subscription setup is account-specific. Orbit should provide guidance and links, not attempt to infer or buy subscriptions.

## Parent Milestone List

1. Quote capability contract: classify live/frozen/delayed/unavailable outcomes.
2. UI quote status: show useful quote fields or a precise unavailable reason.
3. Subscription guidance: explain what no-subscription, delayed-only, Level 1, and future Level 2 users should do.
4. Session-health visibility: show last quote capability without noisy expected logs.
5. Deferred design gate for Level 2/depth panels or live order submission.

## Tracer-Bullet Slices

### Slice 1: Quote Capability Contract And Delayed-Frozen Fallback

- **Behavior proven:** Searching a symbol and requesting a quote returns a structured quote capability response. If live API data is unavailable but delayed data is available, the adapter requests delayed-frozen data before returning. If still unavailable, the response says why instead of returning an indistinguishable all-null quote.
- **AFK or HITL:** AFK after this plan is approved; scope is read-only and user-approved.
- **Files likely touched:** `backend/models/tws_execution_assistant.py`, `backend/services/tws_broker_adapter.py`, `backend/routers/execution_assistant.py`, `backend/tests/test_execution_assistant_instruments.py`.
- **Public interface:** Extend `QuoteSnapshot` with fields such as `market_data_type`, `is_delayed`, `unavailable_reason`, and `error_code`. Keep existing nullable price fields.
- **Verification command:** `cd backend && uv run python -m pytest tests/test_execution_assistant_instruments.py -q`.
- **Critical promise covered:** External failures stop safely and visibly. IBKR subscription failures must not become generic or silent failures.
- **Explicit stop condition:** Stop when the backend can classify quote availability. Do not add UI guidance, depth data, order behavior, or subscription settings in this slice.

### Slice 2: Quote Strip Shows Data Type Or Specific Failure

- **Behavior proven:** The TWS execution plan panel shows bid/ask/last/close/open/high/low when available and labels the quote as live, frozen, delayed, or delayed frozen. If unavailable, the user sees the specific reason, for example `API market data subscription required; delayed data available`.
- **AFK or HITL:** AFK after Slice 1 review.
- **Files likely touched:** `src/modules/tws-execution-assistant/api.ts`, `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`.
- **Public interface:** TypeScript `QuoteSnapshot` mirrors the backend fields from Slice 1.
- **Verification command:** `npm run typecheck`; manual smoke with one symbol that has data and one symbol that returns `10089`.
- **Critical promise covered:** Main user workflow works end to end: user gets price context or a truthful reason before manually entering a limit price.
- **Explicit stop condition:** Stop when the quote strip is truthful. Do not add a full help modal or subscription walkthrough yet.

### Slice 3: Subscription Guidance For User Types

- **Behavior proven:** From the quote strip, a user can open compact guidance that explains what to do for their situation:
  - No market-data subscription: use delayed data or add Level 1.
  - Delayed-only user: quotes may be delayed/frozen; manual price entry remains available.
  - Level 1 user: live top-of-book should show bid/ask/last if API market data is enabled.
  - TWS-visible but API-blocked user: enable Market Data API acknowledgement and confirm the subscription applies to API/off-platform access.
  - Level 2/depth user: depth is deferred and requires separate subscriptions; not needed for draft saving.
- **AFK or HITL:** HITL for final user-facing copy before coding, because this is broker guidance.
- **Files likely touched:** `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`; optionally a small local component if the file is becoming too large.
- **Public interface:** No backend change. UI consumes Slice 1 `unavailable_reason` and `market_data_type`.
- **Verification command:** `npm run typecheck`; manual UI smoke for each mocked/observed status.
- **Critical promise covered:** External failures are visible and actionable.
- **Explicit stop condition:** Stop after guidance is readable and linked. Do not implement subscription purchasing, account entitlement introspection, or Level 2 data.

### Slice 4: Market Data Health In The Right Rail

- **Behavior proven:** The right-side Session Health `Market data` row reflects the last selected quote state, such as `delayed frozen`, `live`, or `subscription required`.
- **AFK or HITL:** AFK after Slice 3 approval.
- **Files likely touched:** `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`; maybe `src/modules/tws-execution-assistant/api.ts` if display labels are typed.
- **Public interface:** No new API. Consume the already-returned quote state.
- **Verification command:** `npm run typecheck`; manual smoke through search and quote request.
- **Critical promise covered:** None beyond user visibility; no new test by default.
- **Explicit stop condition:** Stop after the rail reflects the selected quote status. Do not add global health polling or persistent diagnostics.

### Slice 5: Expected Market-Data Errors Are Logged As Diagnostics

- **Behavior proven:** Expected IBKR quote failures such as `10089` are captured into `QuoteSnapshot.error_code`/`unavailable_reason` and are not printed as scary generic backend failures. Unexpected exceptions still log as warnings/errors.
- **AFK or HITL:** AFK after Slice 1 and 2 prove the contract.
- **Files likely touched:** `backend/services/tws_broker_adapter.py`, `backend/tests/test_execution_assistant_instruments.py`.
- **Public interface:** Same as Slice 1; this only sharpens classification and logging.
- **Verification command:** `cd backend && uv run python -m pytest tests/test_execution_assistant_instruments.py -q`.
- **Critical promise covered:** External failures stop safely and visibly without noisy false alarms.
- **Explicit stop condition:** Stop after expected market-data permission failures are classified. Do not suppress unrelated `ib_async` errors globally.

## Deferred Work

- Level 2/depth panel and market-depth subscriptions.
- Automatic entitlement detection beyond observed quote responses.
- Subscription purchase or account-management automation.
- Per-exchange subscription recommendation engine.
- Streaming quote subscriptions inside the TWS assistant.
- Historical OHLC fallback for unavailable snapshots.
- Any order placement, arming, cancellation, modification, live mode, or execution monitoring.

## Human Approval Questions

1. Approve `delayed frozen` as the default fallback for quote snapshots when live data is unavailable?
2. Approve user-facing subscription guidance copy before Slice 3?
3. Confirm Level 2/depth remains deferred until the assistant actually needs depth, not just limit-price context.
4. Confirm quote availability must not block draft save when the user manually enters a valid limit price.

## PROJECT_PLAN.md Impact

Update `PROJECT_PLAN.md` before coding to add this as the next TWS follow-up mission on `feature/tws-broker-cockpit-ui` or its successor branch. Update again after completion with shipped slices and verification.

## Planner Self-Review

- Kept small: first slice changes only read-only quote capability and failure classification.
- Kept vertical: every slice reaches from adapter/API data to a user-visible behavior or reviewable backend response.
- Deliberately not planned: Level 2 data, subscription automation, streaming quotes, and any trading behavior.
- Test budget: Slice 1/Slice 5 can share one focused backend public/adapter regression file; UI slices use typecheck and manual smoke unless a critical promise is uncovered.
