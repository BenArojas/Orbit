# TWS Execution Assistant Research Packet

> Date: 2026-06-26
> Branch: `feature/tws-execution-assistant-spec`
> Scope: research only. No implementation plan.

## 1. Executive Summary

- Verified: Orbit is decision support, never autonomous trading; all broker and persistence access must flow through FastAPI, and `conid` is the cross-module instrument key (`AGENTS.md:12`, `docs/architecture/backend.md:6`, `docs/architecture/modules.md:21`).
- Verified: Current Orbit execution is Client Portal only. TWS is documented as a separate gated subsystem, not a replacement for MoonMarket order endpoints (`docs/architecture/backend.md:26`).
- Verified: The current frontend has only three module IDs: `parallax`, `moonmarket`, and `inflect`; there is no TWS module or broker-session mode yet (`src/orbit/moduleEntry/OrbitModuleEntry.tsx:10`).
- Verified: Backend startup creates one Client Portal `IBKRService` singleton plus scanner/fill-sync services; no TWS lifecycle or exclusive `BrokerSessionService` exists (`backend/main.py:64`, `backend/main.py:84`, `backend/main.py:142`, `backend/main.py:173`).
- Verified: TWS API order placement is callback-driven: connect, receive `nextValidId`, call `placeOrder`, then reconcile `openOrder`, `orderStatus`, `execDetails`, and commission callbacks.
- Verified: TWS order IDs are persistent across sessions and must be greater than prior order IDs seen by the client when multiple clients/open-order requests are involved.
- Verified: Paper trading is required first, but IBKR warns paper behavior can differ from live behavior.
- Inference: the first parent plan should be a non-trading boundary spike: fake TWS adapter + Orbit-owned status/reconciliation contracts + route/module gating. It proves the shape without sending orders or adding `ib_async`.
- Inference: do not add `ib_async` yet. Treat it as the leading paper-spike candidate only after the exact paper-mode spike acceptance criteria are approved.
- Inference: the current draft spec is too broad for first execution; its testing list and implementation order should be reduced to one critical promise per slice before planning.

## 2. Repo Baseline

### Existing Constraints

- `AGENTS.md:14-20`: decision support only; FastAPI owns broker/AI/persistence access; `conid` is required across module boundaries; typed trust-boundary errors are required.
- `AGENTS.md:26-35`: resolve focused context, one smallest tracer bullet, ask before architecture/module/safety/persistence/public-contract changes, update `PROJECT_PLAN.md` only after plan approval.
- `docs/testing.md:3-35`: default zero new tests, but trading safety and external-failure behavior are critical promises; normal max is one new test per slice.
- `docs/architecture/backend.md:8-13`: FastAPI sidecar owns broker/SQLite; routers translate HTTP and typed errors; services own domain logic.
- `docs/architecture/backend.md:19-24`: `DatabaseService` owns SQLite and all connection access must go through `_run_read` / `_run_write`; `InstrumentIdentityService` owns display identity.
- `docs/architecture/backend.md:28-34`: `IBKRService` and `ClientPortalExecutionAdapter` own Client Portal execution; TWS is separate and gated.
- `docs/architecture/frontend.md:7-13`: React calls FastAPI only; `sidecarClient` owns transport; product API contracts live in module-local `api.ts` files.
- `docs/architecture/modules.md:28-37`: trading safety allows preview, paper mutation, and live confirmation; unknown/unreachable/incomplete safety state fails closed.

### What Exists

- Module entry registry: `src/orbit/moduleEntry/OrbitModuleEntry.tsx:10-50` defines three modules and auth-only gating.
- Launcher: `src/orbit/OrbitLauncher.tsx:31-40` renders all registered modules and enables them only by Client Portal auth state.
- Providers: `src/orbit/OrbitProviders.tsx:28-36` wraps the app in `GatewayProvider`, `OrbitAccountProvider`, and always mounts shared `OrderTicket`.
- Account context: `src/orbit/accountContext/OrbitAccountProvider.tsx:39-54` hydrates accounts through MoonMarket Client Portal APIs; `src/orbit/accountContext/OrbitAccountProvider.tsx:62-66` derives paper/live mode from `MoonMarketAccount.is_paper`.
- Transport split: `src/lib/sidecarClient.ts:36-101` owns fetch/error/offline mechanics; `src/lib/api.ts:1-14` says new product endpoints should not be added there.
- Client Portal adapter pattern: `backend/services/client_portal_execution.py:11-31` defines intent-level order protocol; `backend/services/client_portal_execution.py:69-160` hides Client Portal endpoint paths.
- MoonMarket order safety: `backend/routers/orders.py:73-145` reevaluates `TradingSafetyPolicy` for place/reply/cancel/modify.
- Order payload compiler for Client Portal only: `backend/services/orders.py:68-95` maps `MoonMarketOrderDraft` to Client Portal payload fields.
- Trading safety fail-closed account lookup: `backend/services/trading_safety.py:21-27`.
- Instrument identity cache writer/reader: `backend/services/instrument_identity.py:15-119`.
- Backend deps: `backend/pyproject.toml:6-20` targets Python `>=3.12` and does not include `ib_async` or `ibapi`.

### What Does Not Exist

- No `src/modules/tws-execution-assistant/`.
- No fourth `OrbitModuleId`.
- No `BrokerSessionProvider` or `BrokerSessionService`.
- No backend `/orbit/session` router.
- No backend `/execution-assistant` router.
- No TWS adapter interface or fake adapter.
- No TWS-owned Pydantic models or SQLite tables.
- No exclusive mode enforcement that disables Client Portal modules while TWS is active.
- No policy hook that makes MoonMarket order routes unavailable in TWS mode.

## 3. TWS API Facts

Verified facts:

- TWS API requires a running TWS or IB Gateway instance. IBKR Campus says all customers must install one of them before using the TWS API, and both maintain the same usage/support level. Source: [IBKR Campus TWS API docs](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).
- API connections use a host, socket port, and client ID. Local connections use `localhost` or `127.0.0.1`; disconnecting one client ID does not affect other client IDs or ports. Source: [IBKR Campus TWS API docs](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).
- `nextValidId` is invoked automatically after successful connection or after `EClient.reqIds`; IBKR recommends requesting it once at session start and incrementing locally for each order. The sequence is persistent between TWS sessions. Source: [IBKR Campus nextValidId](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).
- `EClient.placeOrder` places or modifies an order. The order ID must be unique, and IDs less than or equal to a prior order ID cause an error. Source: [IBKR Campus placeOrder](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).
- After successful submission, TWS sends order activity via `EWrapper.openOrder` and `EWrapper.orderStatus`; fills/commissions arrive via `execDetails` and `commissionReport`. Source: [IBKR Campus order callbacks](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).
- `orderStatus` can duplicate messages and includes filled, remaining, average fill price, `permId`, `parentId`, last fill price, client ID, and held/capped info. Source: [IBKR Campus orderStatus](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).
- Active orders are bound to the API client ID that submitted them. `reqOpenOrders` returns this client's active orders; `reqAllOpenOrders` returns current open orders across associated accounts once; client ID `0` can bind manual TWS orders. Source: [IBKR Campus open orders](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).
- Individual cancel/modify is limited to the same client ID, or client ID `0` for bound manual/TWS orders. `reqGlobalCancel` cancels all open orders regardless of original client. Source: [IBKR Campus cancel/modify](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).
- Untransmitted orders (`Order.Transmit=False`) exist only inside the TWS session, are not visible to other usernames, and are cleared on restart. Source: [IBKR Campus placeOrder](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).
- Bracket orders can be manually built with parent/child order IDs. IBKR's bracket examples set parent and first child `Transmit=False`, then set the final child `Transmit=True` to transmit the whole group. Source: [IBKR deprecated bracket docs](https://interactivebrokers.github.io/tws-api/bracket_order.html).
- OCA groups assign orders to a group so completion of one cancels/rebalances remaining orders; IBKR's OCA examples use the same "last order transmits predecessors" pattern. Source: [IBKR deprecated OCA docs](https://interactivebrokers.github.io/tws-api/oca.html).
- TWS API supports order types relevant to v1 stocks, including market, limit, stop, stop-limit, trailing stop, trailing stop limit, market-on-close, limit-on-close, market-if-touched, and limit-if-touched. Source: [IBKR basic orders](https://interactivebrokers.github.io/tws-api/basic_orders.html).
- Paper accounts allow simulated testing with real market conditions, but paper execution behavior can differ from live. Source: [IBKR Campus paper trading](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).
- IBKR states it cannot provide coding assistance for `ib_insync`; it also says IBKR generally advises direct TWS API use where possible. Source: [IBKR Campus third-party packages](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/).

Inferences:

- Orbit must persist both TWS `orderId` and `permId`; `permId` is the stronger account-level reconciliation handle, but client-bound API operations still need current API order IDs.
- Orbit should treat untransmitted orders as unsafe for durable plans because they disappear on restart.
- Orbit must distinguish "our plan/order" from manual/external TWS orders before it can manage or cancel anything.
- A robust adapter needs explicit states for `pending_submit`, `accepted`, `partial`, `filled`, `cancel_pending`, `cancelled`, `rejected`, and `unknown/in_flight`.

## 4. Library Comparison

| Option | Maintenance | Async/Python fit | License | Callback model | Risk |
|---|---|---|---|---|---|
| `ib_async` | Active fork/replacement for `ib_insync`; PyPI latest checked: `2.1.0`, released 2025-12-08. | Requires Python `>=3.10`, classifiers include Python 3.12; provides sync and async APIs. | BSD per `pyproject.toml`; PyPI labels it `Other/Proprietary License (BSD)`. | Wraps TWS callbacks into `IB`, `Trade`, events, sync/async methods, and automatic synchronization. | Good fit for FastAPI only behind an adapter, but adds non-official protocol implementation. Open issues show edge-case drift risk. Do not add until paper spike requirements are approved. |
| Official `ibapi` | Official package, but PyPI latest checked: `9.81.1.post1`, released 2020-12-06. | Low-level threaded/queue callback model; PyPI classifiers stop at Python 3.9 even though Orbit is Python 3.12. | IB API non-commercial or commercial license. | Direct `EClient`/`EWrapper` callbacks, queue/reader loop. | Lowest third-party abstraction risk, highest Orbit adapter code burden. Python 3.12 packaging/typing fit needs a local spike. |
| `ib_insync` | Repository archived by owner on 2024-03-14; PyPI latest checked: `0.9.86`, released 2023-07-02. | Async-friendly historical reference; requires Python `>=3.6`. | BSD. | Similar linear sync/async wrapper pattern, `IB` object keeps state synchronized. | Do not choose for new code because the repo is archived/read-only. Useful only as historical context for API ergonomics and bracket examples. |
| No dependency / raw socket | No external package risk. | Would require implementing IBKR binary protocol, version negotiation, message decoding, callbacks, and order model. | Orbit-owned. | Orbit would own everything. | Not worth it for v1. More code and more broker-protocol risk than either `ibapi` or `ib_async`. |

Decision note: candidate ranking for a paper spike is `ib_async`, then official `ibapi`, then stop. The planner should not add a runtime dependency in the first repo slice unless the approved parent issue explicitly includes a live TWS paper spike.

Sources: [ib_async docs](https://ib-api-reloaded.github.io/ib_async/readme.html), [ib_async PyPI](https://pypi.org/project/ib_async/), [ib_async pyproject](https://github.com/ib-api-reloaded/ib_async/blob/main/pyproject.toml), [ibapi PyPI](https://pypi.org/project/ibapi/), [ib_insync GitHub](https://github.com/erdewit/ib_insync), [ib_insync PyPI](https://pypi.org/project/ib-insync/).

## 5. Adapter Boundary Requirements

Verified repo requirements:

- Frontend must never import broker libraries; product calls go through module API files and `sidecarRequest`.
- Backend routers expose Pydantic-owned request/response models.
- Services own domain logic and typed errors.
- Persistence goes through `DatabaseService`; no raw SQL outside it.
- `InstrumentIdentityService` owns `conid` display metadata.
- Trading safety must reevaluate before mutation and fail closed on unknown accounts.

Required TWS boundary:

- Only `backend/services/tws_broker_adapter.py` or an equivalent adapter package may import `ib_async` or `ibapi`.
- Adapter input/output must be Orbit-owned dataclasses/Pydantic models: `TwsConnectionStatus`, `TwsAccountRef`, `TwsContractRef`, `OrderIntent`, `OrderLink`, `ExecutionEvent`, `PositionSnapshot`.
- Pydantic models and DB rows store primitive Orbit fields only: `account_id`, `conid`, `symbol`, `sec_type`, `side`, `quantity`, `price`, `tws_order_id`, `perm_id`, `client_id`, `parent_tws_order_id`, `status`, `event_json`.
- UI contract file should be `src/modules/tws-execution-assistant/api.ts`; components should not call `sidecarRequest` directly.
- TWS models should not reuse `MoonMarketOrderDraft`; that type is coupled to Client Portal payload compilation.
- Error boundary should translate broker errors into typed Orbit errors such as `TwsNotConnectedError`, `TwsClientIdConflictError`, `TwsOrderIdError`, `TwsAmbiguousSubmitOutcomeError`, and `ExecutionPlanStateError`.

## 6. Execution/Reconciliation Risks

Verified risks:

- Order ID lifecycle: IDs are persistent and must be greater than prior IDs returned via callbacks/open-order requests; multi-client accounts make naive local incrementing unsafe.
- Client ID ownership: cancel/modify is restricted by client ID unless using client ID `0` binding semantics. Binding manual orders can change order IDs and may affect queue priority.
- Callback duplication: `orderStatus` duplicates are normal, so event handling must be idempotent.
- Partial fills: `orderStatus` and `execDetails` must be correlated; fills may arrive while cancel is pending.
- Paper/live mismatch: paper is required but not proof that live behavior is identical.
- Untransmitted orders: cleared on restart and session-local, so they are bad durable-plan anchors.
- Bracket transmit behavior: wrong transmit ordering can create accidental execution risk.
- External/unmanaged orders: `reqAllOpenOrders`, client ID `0`, and manual TWS orders can expose orders Orbit did not create.
- Client Portal collision: current Orbit modules assume Client Portal auth/session; TWS mode must not let those modules render as valid broker views.

NautilusTrader reference facts:

- Nautilus uses ports/adapters, event-driven architecture, risk gates before execution, cache/order/position tracking, and execution reconciliation.
- Its live reconciliation procedure generates order, fill, and position reports, then reconciles internal state against external reality.
- It treats external orders explicitly, detects missed fills, handles position mismatches, waits on ambiguous submit failures, and runs periodic open-order/position checks after startup reconciliation.
- It distinguishes local denial from venue rejection and has explicit overfill/duplicate-fill handling.

Orbit-specific inferences:

- The first real TWS adapter must reconcile before resuming any plan.
- Ambiguous submit should remain `in_flight` until reconciliation proves accepted/rejected/cancelled.
- Manual or external TWS orders should be visible as unmanaged, not silently claimed.
- Live restart should load as `paused_requires_rearm`; paper restart can resume only after validation and reconciliation.
- Kill switch must block new monitor actions, not just hide UI buttons.

Sources: [Nautilus architecture](https://nautilustrader.io/docs/latest/concepts/architecture/), [Nautilus execution](https://nautilustrader.io/docs/latest/concepts/execution/), [Nautilus live reconciliation](https://nautilustrader.io/docs/latest/concepts/live/), [Nautilus IB integration](https://nautilustrader.io/docs/latest/integrations/ib/), [Nautilus GitHub](https://github.com/nautechsystems/nautilus_trader).

## 7. First Tracer-Bullet Recommendation

Build only a non-trading boundary slice:

- Add Orbit-owned broker session status models for `none | client_portal | tws`.
- Add a fake in-memory TWS adapter that reports connection status and a canned reconciliation snapshot with no order placement methods.
- Add `/orbit/session/mode` and `/execution-assistant/status` read endpoints behind FastAPI.
- Add a fourth module registry entry and launcher/route gating that shows TWS only in `tws` mode and disables Client Portal modules in `tws` mode.
- Add a module-local frontend API file for those status endpoints.
- Add one focused public-boundary check only if needed: mode gating prevents MoonMarket from appearing enabled in `tws` mode.

This proves the adapter and session boundary without real trading, without DB migration, without `ib_async`, and without touching order placement.

## 8. Open Questions for Human Approval

- Should the first parent issue be limited to fake-adapter session/mode gating, or should it include the live paper-mode dependency spike?
- Is the working product name still `TWS Execution Assistant`, or should the fourth module use another label before UI work begins?
- Should TWS v1 connect to TWS only, or allow IB Gateway too? The existing product wording says TWS-gated, but IBKR and candidate libraries support both.
- Should client ID `0` be forbidden for v1 to avoid binding manual orders, or allowed only for read-only detection of external orders?
- Should unmanaged/manual TWS orders be shown in the assistant UI in the first real adapter slice, or only recorded as a reconciliation warning?
- Should the first paper spike use a tiny limit order that is immediately cancelled, or only read accounts/positions/open orders until a later approval gate?
- Should broker-session mode be persisted immediately, or kept in memory until the first execution/audit slice?
- Should live-mode settings exist as disabled placeholders, or be omitted until paper mode is proven?

## 9. Source Bibliography

Access date for all web sources: 2026-06-26.

- IBKR Campus, TWS API Documentation: https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/
- IBKR Campus, Python Placing Orders lesson: https://ibkrcampus.com/campus/trading-lessons/python-placing-orders/
- IBKR Campus, Python Complex Orders lesson: https://ibkrcampus.com/campus/trading-lessons/python-complex-orders/
- IBKR deprecated TWS connectivity docs: https://interactivebrokers.github.io/tws-api/connection.html
- IBKR deprecated order submission docs: https://interactivebrokers.github.io/tws-api/order_submission.html
- IBKR deprecated bracket order docs: https://interactivebrokers.github.io/tws-api/bracket_order.html
- IBKR deprecated OCA docs: https://interactivebrokers.github.io/tws-api/oca.html
- IBKR deprecated basic orders docs: https://interactivebrokers.github.io/tws-api/basic_orders.html
- IBKR deprecated order conditions docs: https://interactivebrokers.github.io/tws-api/order_conditions.html
- `ib_async` docs: https://ib-api-reloaded.github.io/ib_async/readme.html
- `ib_async` GitHub: https://github.com/ib-api-reloaded/ib_async
- `ib_async` PyPI: https://pypi.org/project/ib_async/
- `ib_async` pyproject: https://github.com/ib-api-reloaded/ib_async/blob/main/pyproject.toml
- Official `ibapi` PyPI: https://pypi.org/project/ibapi/
- `ib_insync` GitHub archive: https://github.com/erdewit/ib_insync
- `ib_insync` PyPI: https://pypi.org/project/ib-insync/
- NautilusTrader architecture: https://nautilustrader.io/docs/latest/concepts/architecture/
- NautilusTrader execution: https://nautilustrader.io/docs/latest/concepts/execution/
- NautilusTrader live reconciliation: https://nautilustrader.io/docs/latest/concepts/live/
- NautilusTrader Interactive Brokers integration: https://nautilustrader.io/docs/latest/integrations/ib/
- NautilusTrader GitHub: https://github.com/nautechsystems/nautilus_trader
- GitHub example/reference searches reviewed: https://github.com/ib-api-reloaded/ib_async/issues, https://github.com/nautechsystems/nautilus_trader/issues, https://github.com/laroche/tws-api-examples
