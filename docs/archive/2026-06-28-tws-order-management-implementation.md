# TWS Order Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Batching:** Slice 1 is standalone and must be reviewed first. After Slice 1 is approved, Slices 2+3 may be implemented together. Slice 4 is standalone because advanced reject/override handling changes broker-error semantics.

**Goal:** Let the TWS Execution Assistant draft `MKT`, `LMT`, `STP`, and `STP LMT` orders, cancel any visible TWS open order, modify supported visible open orders, and handle advanced TWS rejects through an explicit override flow.

**Architecture:** Keep all broker mutations behind `TwsBrokerAdapter`; no `ib_async` types leave the adapter. Use one Orbit-owned order-type capability contract for draft, preview, submit, open-order display, and modify so allowed order types cannot drift. Keep everything process-local and paper-gated through one mutation guard; no DB persistence or live enablement.

**Tech Stack:** FastAPI/Python 3.12, Pydantic, `ib_async` behind `TwsBrokerAdapter`, React 19/TypeScript, TanStack Query, module-local `src/modules/tws-execution-assistant/api.ts`.

## Global Constraints

- Orbit is decision support, never an autonomous trading bot.
- No live trading enablement in this plan.
- No DB-backed execution plans, saved drafts, restart recovery, audit ledger, or kill-switch persistence.
- No global cancel.
- No bracket, OCA, trailing, GTD, MOC/LOC, conditions, or full order-workstation editor.
- Button labels stay clean: `Review order`, `Place order`, `Cancel`, `Modify`, `Review changes`, `Submit changes`, `Override and submit`.
- Paper/live context is shown once as environment/status context, not repeated on every button.
- `ib_async` types must stay inside `TwsBrokerAdapter`.
- Frontend must use `twsApi`; no direct `fetch`.
- Add tests only for critical promises per `docs/testing.md`.

---

## Current Baseline

- Current TWS draft models support only `LMT` and `MKT`.
- `ExecutionPlan` stores `limit_price` but not `stop_price`.
- `PaperOrderPreview` and `PaperOrderSubmission` expose `limit_price` only.
- `OrderSnapshot` exposes `lmt_price` only.
- `TwsBrokerAdapter.place_paper_order()` sets `order.lmtPrice` for `LMT` only.
- Open Orders table displays rows but has no `Cancel` or `Modify` action.
- Existing focused backend test file is `backend/tests/test_execution_plan.py`.
- Existing frontend contract is `src/modules/tws-execution-assistant/api.ts`.

## File Map

- `backend/models/tws_order_capabilities.py` — create a small shared backend order-type capability map.
- `backend/models/execution_plan.py` — extend draft/plan models to `MKT | LMT | STP | STP LMT` and add `stop_price`.
- `backend/models/tws_execution_assistant.py` — extend preview/submission/open-order/action models.
- `backend/services/execution_plan.py` — validate required fields from the capability map and include `stop_price` in previews.
- `backend/services/tws_broker_adapter.py` — build TWS orders, shared paper mutation guard, cancel, modify, advanced reject capture/override.
- `backend/routers/execution_assistant.py` — add cancel/modify/override endpoints and typed error mapping.
- `backend/tests/test_execution_plan.py` — focused public-boundary tests for validation and fail-closed mutation guards.
- `src/modules/tws-execution-assistant/orderCapabilities.ts` — frontend capability map matching backend names.
- `src/modules/tws-execution-assistant/api.ts` — TypeScript contracts and endpoint methods.
- `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx` — ticket fields, open-order actions, edit mode, advanced reject panel.

---

## Slice 1: Shared Order-Type Contract + STP/STP LMT Draft/Submit

**Behavior proven:** A user can create, review, and place `MKT`, `LMT`, `STP`, and `STP LMT` paper orders. Required fields are validated before preview/submit. No cancel/modify yet.

**AFK or HITL:** HITL after completion because this changes broker order payload shape.

**Critical promise:** Unsafe trades cannot happen; malformed stop/limit orders fail before broker submission.

**Files:**
- Create: `backend/models/tws_order_capabilities.py`
- Create: `src/modules/tws-execution-assistant/orderCapabilities.ts`
- Modify: `backend/models/execution_plan.py`
- Modify: `backend/models/tws_execution_assistant.py`
- Modify: `backend/services/execution_plan.py`
- Modify: `backend/services/tws_broker_adapter.py`
- Modify: `backend/tests/test_execution_plan.py`
- Modify: `src/modules/tws-execution-assistant/api.ts`
- Modify: `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`

**Interfaces:**
- Produces backend type: `TwsOrderType = Literal["MKT", "LMT", "STP", "STP LMT"]`
- Produces backend helper: `required_price_fields(order_type: TwsOrderType) -> tuple[str, ...]`
- Produces frontend constant: `TWS_ORDER_CAPABILITIES`
- Extends request/response fields with `stop_price: float | None`

- [ ] **Step 1: Add the backend capability map**

Create `backend/models/tws_order_capabilities.py`:

```python
from __future__ import annotations

from typing import Literal, TypedDict

TwsOrderType = Literal["MKT", "LMT", "STP", "STP LMT"]
TwsPriceField = Literal["limit_price", "stop_price"]


class TwsOrderCapability(TypedDict):
    can_draft: bool
    can_modify: bool
    price_fields: tuple[TwsPriceField, ...]


TWS_ORDER_CAPABILITIES: dict[TwsOrderType, TwsOrderCapability] = {
    "MKT": {"can_draft": True, "can_modify": False, "price_fields": ()},
    "LMT": {"can_draft": True, "can_modify": True, "price_fields": ("limit_price",)},
    "STP": {"can_draft": True, "can_modify": True, "price_fields": ("stop_price",)},
    "STP LMT": {"can_draft": True, "can_modify": True, "price_fields": ("stop_price", "limit_price")},
}


def required_price_fields(order_type: TwsOrderType) -> tuple[TwsPriceField, ...]:
    return TWS_ORDER_CAPABILITIES[order_type]["price_fields"]


def can_modify_order_type(order_type: str) -> bool:
    return order_type in TWS_ORDER_CAPABILITIES and TWS_ORDER_CAPABILITIES[order_type]["can_modify"]
```

- [ ] **Step 2: Extend backend Pydantic contracts**

In `backend/models/execution_plan.py`, import `TwsOrderType` and update both models:

```python
from models.tws_order_capabilities import TwsOrderType


class ExecutionPlanDraftRequest(BaseModel):
    conid: int
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float
    order_type: TwsOrderType
    limit_price: float | None = None
    stop_price: float | None = None


class ExecutionPlan(BaseModel):
    plan_id: str
    conid: int
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float
    order_type: TwsOrderType
    limit_price: float | None
    stop_price: float | None
    status: ExecutionPlanStatus
    validation_errors: list[str]
    created_at: datetime
```

In `backend/models/tws_execution_assistant.py`, import `TwsOrderType` and add `stop_price`:

```python
from models.tws_order_capabilities import TwsOrderType


class OrderSnapshot(BaseModel):
    order_id: int
    conid: int
    symbol: str
    side: str
    quantity: float
    order_type: str
    lmt_price: float | None = None
    stop_price: float | None = None
    status: str
    is_unmanaged: bool


class PaperOrderPreview(BaseModel):
    plan_id: str
    conid: int
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float
    order_type: TwsOrderType
    limit_price: float | None
    stop_price: float | None
    tif: str
    transmit: bool
    paper_only: bool = True


class PaperOrderSubmission(BaseModel):
    order_id: int
    status: str
    plan_id: str
    conid: int
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float
    order_type: TwsOrderType
    limit_price: float | None
    stop_price: float | None
    submitted_at: datetime
```

- [ ] **Step 3: Validate order fields from the capability map**

In `backend/services/execution_plan.py`, copy `stop_price` on draft creation and validate required fields:

```python
from models.tws_order_capabilities import required_price_fields


def _positive(value: float | None) -> bool:
    return value is not None and value > 0
```

Inside `create_draft()` add:

```python
stop_price=req.stop_price,
```

Replace the LMT-only validation in `validate()` with:

```python
if plan.quantity <= 0:
    errors.append("Quantity must be positive.")

required = required_price_fields(plan.order_type)
if "limit_price" in required and not _positive(plan.limit_price):
    errors.append(f"{plan.order_type} orders require a positive limit price.")
if "stop_price" in required and not _positive(plan.stop_price):
    errors.append(f"{plan.order_type} orders require a positive stop price.")
```

In `preview_paper()`, add:

```python
stop_price=plan.stop_price,
```

- [ ] **Step 4: Build TWS orders for stop types**

In `backend/services/tws_broker_adapter.py`, add helpers near `_lmt_price`:

```python
def _order_limit_price(order: Order) -> float | None:
    return _lmt_price(order.lmtPrice)


def _order_stop_price(order: Order) -> float | None:
    return _lmt_price(getattr(order, "auxPrice", None))


def _apply_plan_prices(order: Order, plan: "ExecutionPlan") -> None:
    if plan.order_type in ("LMT", "STP LMT") and plan.limit_price is not None:
        order.lmtPrice = plan.limit_price
    if plan.order_type in ("STP", "STP LMT") and plan.stop_price is not None:
        order.auxPrice = plan.stop_price
```

In `get_reconciliation()`, set:

```python
lmt_price=_order_limit_price(t.order),
stop_price=_order_stop_price(t.order),
```

In `place_paper_order()`, replace the LMT-only price assignment with:

```python
_apply_plan_prices(order, plan)
```

Return `stop_price=plan.stop_price` in `PaperOrderSubmission`.

- [ ] **Step 5: Update backend tests for the new critical validation**

In `backend/tests/test_execution_plan.py`, update `_draft()` default to include:

```python
"stop_price": None,
```

Update `_AdapterStub.place_paper_order()` to return:

```python
stop_price=plan.stop_price,
```

Add these tests:

```python
def test_stp_without_stop_price_is_rejected():
    client = _client(sec_type="STK")
    plan_id = client.post(
        "/execution-assistant/plans/draft",
        json=_draft(order_type="STP", limit_price=None, stop_price=None),
    ).json()["plan_id"]
    body = client.post(f"/execution-assistant/plans/{plan_id}/validate").json()
    assert body["status"] == "invalid"
    assert "positive stop price" in body["validation_errors"][0]


def test_stp_lmt_requires_stop_and_limit_prices():
    client = _client(sec_type="STK")
    plan_id = client.post(
        "/execution-assistant/plans/draft",
        json=_draft(order_type="STP LMT", limit_price=None, stop_price=175.0),
    ).json()["plan_id"]
    body = client.post(f"/execution-assistant/plans/{plan_id}/validate").json()
    assert body["status"] == "invalid"
    assert any("positive limit price" in e for e in body["validation_errors"])


def test_stp_lmt_preview_contains_stop_and_limit_prices():
    client = _client(sec_type="STK", connected=True, paper_port=True)
    plan_id = client.post(
        "/execution-assistant/plans/draft",
        json=_draft(order_type="STP LMT", limit_price=181.0, stop_price=180.0),
    ).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    body = client.post(f"/execution-assistant/plans/{plan_id}/preview-paper").json()
    assert body["order_type"] == "STP LMT"
    assert body["stop_price"] == 180.0
    assert body["limit_price"] == 181.0
```

- [ ] **Step 6: Add the frontend capability map and contracts**

Create `src/modules/tws-execution-assistant/orderCapabilities.ts`:

```ts
export type TwsOrderType = "MKT" | "LMT" | "STP" | "STP LMT";
export type TwsPriceField = "limit_price" | "stop_price";

export const TWS_ORDER_CAPABILITIES: Record<TwsOrderType, {
  canDraft: boolean;
  canModify: boolean;
  priceFields: TwsPriceField[];
}> = {
  MKT: { canDraft: true, canModify: false, priceFields: [] },
  LMT: { canDraft: true, canModify: true, priceFields: ["limit_price"] },
  STP: { canDraft: true, canModify: true, priceFields: ["stop_price"] },
  "STP LMT": { canDraft: true, canModify: true, priceFields: ["stop_price", "limit_price"] },
};

export function priceFieldsFor(orderType: TwsOrderType): TwsPriceField[] {
  return TWS_ORDER_CAPABILITIES[orderType].priceFields;
}

export function canModifyOrderType(orderType: string): orderType is TwsOrderType {
  return orderType in TWS_ORDER_CAPABILITIES && TWS_ORDER_CAPABILITIES[orderType as TwsOrderType].canModify;
}
```

In `src/modules/tws-execution-assistant/api.ts`, import `TwsOrderType`, set:

```ts
export type ExecutionPlanOrderType = TwsOrderType;
```

Add `stop_price: number | null` to `ExecutionPlanDraftRequest`, `ExecutionPlan`, `PaperOrderPreview`, `PaperOrderSubmission`, and `OrderSnapshot`.

- [ ] **Step 7: Update the ticket UI for stop fields**

In `TwsExecutionAssistantModule.tsx`:

- Import `TWS_ORDER_CAPABILITIES`, `priceFieldsFor`.
- Add `stop_price: null` to `PLAN_DEFAULTS`.
- In order type select, render `Object.keys(TWS_ORDER_CAPABILITIES)`.
- On order-type change, reset both `limit_price` and `stop_price`.
- Show `Stop trigger` when `priceFieldsFor(planForm.order_type)` includes `stop_price`.
- Show `Limit price` when it includes `limit_price`.
- Update disabled reason:

```ts
const fields = priceFieldsFor(planForm.order_type);
if (fields.includes("stop_price") && !(planForm.stop_price && planForm.stop_price > 0)) {
  return "Enter a stop trigger.";
}
if (fields.includes("limit_price") && !(planForm.limit_price && planForm.limit_price > 0)) {
  return "Enter a limit price.";
}
```

- Update preview/submission hero and detail rows to show stop price when present.
- Change button labels to `Review order` and `Place order`.

- [ ] **Step 8: Verify Slice 1**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_plan.py -q
npm run typecheck
```

Expected:

```text
backend focused tests pass
tsc --noEmit exits 0
```

Manual smoke:

- Create/review/place one `STP` paper order.
- Create/review/place one `STP LMT` paper order.
- Confirm Open Orders shows the order type and relevant prices.

**Stop condition:** Stop for review. Do not add cancel/modify/override in Slice 1.

---

## Slice 2: Paper-Gated Cancel For Every Visible Open Order

**Behavior proven:** Every visible TWS open order can be cancelled through Orbit. The backend fails closed before broker calls when disconnected, non-paper, or kill switch is active.

**AFK or HITL:** AFK after Slice 1 approval.

**Critical promise:** Unsafe trades cannot happen; cancel is a broker mutation and must be paper-gated in this plan.

**Files:**
- Modify: `backend/models/tws_execution_assistant.py`
- Modify: `backend/services/tws_broker_adapter.py`
- Modify: `backend/routers/execution_assistant.py`
- Modify: `backend/tests/test_execution_plan.py`
- Modify: `src/modules/tws-execution-assistant/api.ts`
- Modify: `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`

**Interfaces:**
- Produces model: `TwsOrderActionResult`
- Produces endpoint: `DELETE /execution-assistant/orders/{order_id}`
- Produces adapter method: `cancel_order(order_id: int) -> TwsOrderActionResult`

- [ ] **Step 1: Add action result and guard error names**

In `backend/models/tws_execution_assistant.py`:

```python
class TwsOrderActionResult(BaseModel):
    order_id: int
    status: str
    action: Literal["cancel", "modify", "override"]
    message: str | None = None
```

In `backend/services/tws_broker_adapter.py`, rename `TwsPlaceOrderGuardError` only if the coder wants a broader name. Minimal path: keep it and reuse the same class for cancel/modify guard errors.

Add helper:

```python
def _open_trade_by_order_id(self, order_id: int):
    for trade in self._ib.openTrades():
        if trade.order.orderId == order_id:
            return trade
    return None


def _ensure_paper_order_mutation_allowed(self) -> None:
    if self._kill_switch_active:
        raise TwsPlaceOrderGuardError("kill_switch_active")
    if not self.is_connected():
        raise TwsPlaceOrderGuardError("not_connected")
    if not self.is_paper_port():
        raise TwsPlaceOrderGuardError("not_paper_port")
```

- [ ] **Step 2: Implement adapter cancel**

In `TwsBrokerAdapter`:

```python
def cancel_order(self, order_id: int) -> TwsOrderActionResult:
    self._ensure_paper_order_mutation_allowed()
    trade = self._open_trade_by_order_id(order_id)
    if trade is None:
        raise TwsPlaceOrderGuardError("order_not_found")
    self._ib.cancelOrder(trade.order)
    status_text = trade.orderStatus.status or "cancel_requested"
    return TwsOrderActionResult(
        order_id=order_id,
        status=status_text,
        action="cancel",
        message="Cancel request sent to TWS.",
    )
```

Import `TwsOrderActionResult`.

- [ ] **Step 3: Add router endpoint with typed errors**

In `backend/routers/execution_assistant.py`, import `TwsOrderActionResult` and add:

```python
def _guard_http_error(exc: TwsPlaceOrderGuardError) -> HTTPException:
    guard_status = {
        "kill_switch_active": status.HTTP_409_CONFLICT,
        "not_connected": status.HTTP_409_CONFLICT,
        "not_paper_port": status.HTTP_403_FORBIDDEN,
        "plan_not_valid": status.HTTP_422_UNPROCESSABLE_ENTITY,
        "order_not_found": status.HTTP_404_NOT_FOUND,
        "unsupported_order_type": status.HTTP_422_UNPROCESSABLE_ENTITY,
    }
    return HTTPException(
        status_code=guard_status.get(exc.error_code, status.HTTP_409_CONFLICT),
        detail={"error": exc.error_code},
    )
```

Use `_guard_http_error()` in existing `place_paper_order()` guard handling.

Add:

```python
@router.delete("/orders/{order_id}", response_model=TwsOrderActionResult)
async def cancel_order(
    order_id: int,
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
) -> TwsOrderActionResult:
    try:
        return adapter.cancel_order(order_id)
    except TwsPlaceOrderGuardError as exc:
        raise _guard_http_error(exc)
    except (RuntimeError, OSError) as exc:
        log.error("TWS cancel failed for order %s: %s", order_id, exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "unknown_outcome",
                "message": "Cancel failed unexpectedly. Refresh Open Orders before retrying.",
            },
        )
```

- [ ] **Step 4: Add focused cancel tests**

In `_AdapterStub`, add fields:

```python
self.cancel_order_calls: int = 0
```

Add method:

```python
def cancel_order(self, order_id: int):
    self.cancel_order_calls += 1
    if self._guard_error_code:
        raise TwsPlaceOrderGuardError(self._guard_error_code)
    return {"order_id": order_id, "status": "cancel_requested", "action": "cancel", "message": "Cancel request sent to TWS."}
```

If returning dict is rejected by FastAPI response model, import and return `TwsOrderActionResult`.

Add tests:

```python
def test_cancel_order_calls_broker_once_on_paper_port():
    stub, client = _setup(sec_type="STK", connected=True, paper_port=True)
    r = client.delete("/execution-assistant/orders/9001")
    assert r.status_code == 200
    assert r.json()["action"] == "cancel"
    assert stub.cancel_order_calls == 1


def test_cancel_order_blocked_on_non_paper_port():
    stub, client = _setup(sec_type="STK", connected=True, paper_port=False)
    r = client.delete("/execution-assistant/orders/9001")
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "not_paper_port"
    assert stub.cancel_order_calls == 0
```

- [ ] **Step 5: Add frontend API and Open Orders action**

In `api.ts`:

```ts
export interface TwsOrderActionResult {
  order_id: number;
  status: string;
  action: "cancel" | "modify" | "override";
  message: string | null;
}
```

Add:

```ts
cancelOrder: (order_id: number) =>
  sidecarRequest<TwsOrderActionResult>("DELETE", `/execution-assistant/orders/${order_id}`),
```

In `TwsExecutionAssistantModule.tsx`, add a `cancelOrderMutation` that invalidates `RECON_KEY` and `STATUS_KEY` on success and on `unknown_outcome`.

Update `OrderRow` to accept `onCancel` and render:

```tsx
<button
  type="button"
  className="rounded border border-[var(--clr-orange)]/50 px-2 py-1 text-[11px] text-[var(--clr-orange)] hover:bg-[var(--glow-orange)]"
  onClick={() => onCancel(order.order_id)}
>
  Cancel
</button>
```

- [ ] **Step 6: Verify Slice 2**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_plan.py -q
npm run typecheck
```

Manual smoke:

- Place a small paper `LMT` order away from market.
- Click `Cancel`.
- Confirm Open Orders refreshes and the order is no longer active or shows cancel status.

**Stop condition:** Cancel works for all visible rows. Do not add modify or advanced override unless batching with Slice 3 after Slice 1 approval.

---

## Slice 3: Modify Supported Visible Open Orders

**Behavior proven:** Supported visible open orders can be modified by quantity and the order type's active price fields. Unsupported open-order types remain cancel-only.

**AFK or HITL:** AFK after Slice 1 approval; may batch with Slice 2.

**Critical promise:** Unsafe trades cannot happen; modify is a broker mutation and must fail closed before broker calls.

**Files:**
- Modify: `backend/models/tws_execution_assistant.py`
- Modify: `backend/services/tws_broker_adapter.py`
- Modify: `backend/routers/execution_assistant.py`
- Modify: `backend/tests/test_execution_plan.py`
- Modify: `src/modules/tws-execution-assistant/api.ts`
- Modify: `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`

**Interfaces:**
- Produces model: `TwsModifyOrderRequest`
- Produces endpoint: `PATCH /execution-assistant/orders/{order_id}`
- Produces adapter method: `modify_order(order_id: int, request: TwsModifyOrderRequest) -> TwsOrderActionResult`

- [ ] **Step 1: Add modify request model**

In `backend/models/tws_execution_assistant.py`:

```python
class TwsModifyOrderRequest(BaseModel):
    quantity: float
    limit_price: float | None = None
    stop_price: float | None = None
```

- [ ] **Step 2: Implement adapter modify validation and call**

In `backend/services/tws_broker_adapter.py`, import `can_modify_order_type` and `TwsModifyOrderRequest`.

Add:

```python
def modify_order(self, order_id: int, request: TwsModifyOrderRequest) -> TwsOrderActionResult:
    self._ensure_paper_order_mutation_allowed()
    trade = self._open_trade_by_order_id(order_id)
    if trade is None:
        raise TwsPlaceOrderGuardError("order_not_found")
    if not can_modify_order_type(trade.order.orderType):
        raise TwsPlaceOrderGuardError("unsupported_order_type")
    if request.quantity <= 0:
        raise TwsPlaceOrderGuardError("invalid_quantity")

    updated = copy.copy(trade.order)
    updated.totalQuantity = request.quantity
    if trade.order.orderType in ("LMT", "STP LMT"):
        if request.limit_price is None or request.limit_price <= 0:
            raise TwsPlaceOrderGuardError("invalid_limit_price")
        updated.lmtPrice = request.limit_price
    if trade.order.orderType in ("STP", "STP LMT"):
        if request.stop_price is None or request.stop_price <= 0:
            raise TwsPlaceOrderGuardError("invalid_stop_price")
        updated.auxPrice = request.stop_price

    result = self._ib.placeOrder(trade.contract, updated)
    status_text = result.orderStatus.status or "modify_requested"
    return TwsOrderActionResult(
        order_id=order_id,
        status=status_text,
        action="modify",
        message="Modify request sent to TWS.",
    )
```

Add `import copy`.

Update `_guard_http_error()` status map with:

```python
"invalid_quantity": status.HTTP_422_UNPROCESSABLE_ENTITY,
"invalid_limit_price": status.HTTP_422_UNPROCESSABLE_ENTITY,
"invalid_stop_price": status.HTTP_422_UNPROCESSABLE_ENTITY,
```

- [ ] **Step 3: Add router endpoint**

In `backend/routers/execution_assistant.py`:

```python
@router.patch("/orders/{order_id}", response_model=TwsOrderActionResult)
async def modify_order(
    order_id: int,
    request: TwsModifyOrderRequest,
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
) -> TwsOrderActionResult:
    try:
        return adapter.modify_order(order_id, request)
    except TwsPlaceOrderGuardError as exc:
        raise _guard_http_error(exc)
    except (RuntimeError, OSError) as exc:
        log.error("TWS modify failed for order %s: %s", order_id, exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "unknown_outcome",
                "message": "Modify failed unexpectedly. Refresh Open Orders before retrying.",
            },
        )
```

- [ ] **Step 4: Add focused modify tests**

In `_AdapterStub`, add:

```python
self.modify_order_calls: int = 0
```

Add method:

```python
def modify_order(self, order_id: int, request):
    self.modify_order_calls += 1
    if self._guard_error_code:
        raise TwsPlaceOrderGuardError(self._guard_error_code)
    return TwsOrderActionResult(
        order_id=order_id,
        status="modify_requested",
        action="modify",
        message="Modify request sent to TWS.",
    )
```

Add tests:

```python
def test_modify_order_calls_broker_once_on_paper_port():
    stub, client = _setup(sec_type="STK", connected=True, paper_port=True)
    r = client.patch(
        "/execution-assistant/orders/9001",
        json={"quantity": 5, "limit_price": 181.25, "stop_price": None},
    )
    assert r.status_code == 200
    assert r.json()["action"] == "modify"
    assert stub.modify_order_calls == 1


def test_modify_order_blocked_on_non_paper_port():
    stub, client = _setup(sec_type="STK", connected=True, paper_port=False)
    r = client.patch(
        "/execution-assistant/orders/9001",
        json={"quantity": 5, "limit_price": 181.25, "stop_price": None},
    )
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "not_paper_port"
    assert stub.modify_order_calls == 0
```

- [ ] **Step 5: Add frontend modify mode**

In `api.ts`:

```ts
export interface TwsModifyOrderRequest {
  quantity: number;
  limit_price: number | null;
  stop_price: number | null;
}
```

Add:

```ts
modifyOrder: (order_id: number, req: TwsModifyOrderRequest) =>
  sidecarRequest<TwsOrderActionResult>("PATCH", `/execution-assistant/orders/${order_id}`, req),
```

In `TwsExecutionAssistantModule.tsx`:

- Add state `editingOrder: OrderSnapshot | null`.
- Add `modifyForm` with `quantity`, `limit_price`, `stop_price`.
- `Modify` on a supported order sets `editingOrder` and preloads `modifyForm`.
- Ticket panel switches to edit mode when `editingOrder` is set.
- Edit mode disables symbol, conid, side, and order type.
- Editable fields are quantity plus capability price fields.
- Primary action text is `Review changes`.
- Review state shows before/after.
- Submit text is `Submit changes`.
- On success, clear edit mode and invalidate reconciliation/status.
- Unsupported order type rows show disabled/hidden modify and copy `Modify not supported for this order type yet.`

- [ ] **Step 6: Verify Slice 3**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_plan.py -q
npm run typecheck
```

Manual smoke:

- Place a paper `LMT` order away from market.
- Modify limit price and quantity.
- Confirm Open Orders refreshes with changed values.
- Place or load a `MKT` row if visible; confirm modify is unavailable and cancel remains available.

**Stop condition:** Modify works only for supported visible order types and cannot change symbol/conid/side/order type.

---

## Slice 4: Advanced Reject / Override Flow

**Behavior proven:** If TWS returns advanced reject JSON, Orbit shows a blocking override panel with clean summary, override codes, expandable raw details, and an explicit `Override and submit` action. Orbit never auto-overrides.

**AFK or HITL:** HITL after completion because this changes how Orbit handles broker rejects.

**Critical promise:** External failures stop safely and visibly; user must explicitly authorize override before any resubmit.

**Files:**
- Modify: `backend/models/tws_execution_assistant.py`
- Modify: `backend/services/tws_broker_adapter.py`
- Modify: `backend/routers/execution_assistant.py`
- Modify: `backend/tests/test_execution_plan.py`
- Modify: `src/modules/tws-execution-assistant/api.ts`
- Modify: `src/modules/tws-execution-assistant/TwsExecutionAssistantModule.tsx`

**Interfaces:**
- Produces model: `TwsAdvancedReject`
- Produces model: `TwsOverrideRequest`
- Produces endpoint: `POST /execution-assistant/orders/override`
- Extends adapter methods with optional `advanced_override: list[str] | None`

- [ ] **Step 1: Add advanced reject models**

In `backend/models/tws_execution_assistant.py`:

```python
class TwsAdvancedReject(BaseModel):
    order_id: int | None = None
    reason: str
    override_codes: list[str] = []
    raw: dict[str, object] | str


class TwsOverrideRequest(BaseModel):
    intent: Literal["place", "modify"]
    order_id: int | None = None
    plan_id: str | None = None
    modify: TwsModifyOrderRequest | None = None
    override_codes: list[str]
```

- [ ] **Step 2: Capture advanced reject JSON inside adapter**

In `backend/services/tws_broker_adapter.py`, add explicit parsing helpers:

```python
def _advanced_reject_from_raw(order_id: int | None, raw: str) -> TwsAdvancedReject:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return TwsAdvancedReject(order_id=order_id, reason="TWS rejected the order.", override_codes=[], raw=raw)

    codes: list[str] = []
    if isinstance(parsed, dict):
        for key in ("8229", "errorCode", "code", "override", "overrideCode"):
            value = parsed.get(key)
            if isinstance(value, str) and value:
                codes.extend([part.strip() for part in value.split(",") if part.strip()])
        reason = str(parsed.get("message") or parsed.get("errorMsg") or parsed.get("reason") or "TWS rejected the order.")
        return TwsAdvancedReject(order_id=order_id, reason=reason, override_codes=sorted(set(codes)), raw=parsed)
    return TwsAdvancedReject(order_id=order_id, reason="TWS rejected the order.", override_codes=[], raw=raw)
```

Add `import json`.

Add a small exception:

```python
class TwsAdvancedRejectError(Exception):
    def __init__(self, reject: TwsAdvancedReject) -> None:
        super().__init__(reject.reason)
        self.reject = reject
```

When implementing capture, use `self._ib.errorEvent` around `placeOrder()` calls. The coder must inspect the local `ib_async` event arguments and only catch expected parse/type failures; do not add bare `except Exception`.

- [ ] **Step 3: Return advanced rejects as typed HTTP errors**

In router place/modify handlers, catch `TwsAdvancedRejectError` before ambiguous exceptions:

```python
except TwsAdvancedRejectError as exc:
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"error": "advanced_reject", "reject": exc.reject.model_dump()},
    )
```

Keep unknown outcome only for failures at/after broker call that are not typed advanced rejects.

- [ ] **Step 4: Add override endpoint**

Extend the existing adapter mutation methods so the same order-building path is
used for the original request and the override request:

```python
def place_paper_order(
    self,
    plan: "ExecutionPlan",
    advanced_override: list[str] | None = None,
) -> PaperOrderSubmission:
    ...
    if advanced_override:
        order.advancedErrorOverride = ",".join(advanced_override)
    trade = self._ib.placeOrder(contract, order)
    ...


def modify_order(
    self,
    order_id: int,
    request: TwsModifyOrderRequest,
    advanced_override: list[str] | None = None,
) -> TwsOrderActionResult:
    ...
    if advanced_override:
        updated.advancedErrorOverride = ",".join(advanced_override)
    result = self._ib.placeOrder(trade.contract, updated)
    ...
```

In router, add a small override-code helper:

```python
def _override_codes(request: TwsOverrideRequest) -> list[str]:
    codes = [code.strip() for code in request.override_codes if code.strip()]
    if not codes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "override_codes_required"},
        )
    return codes
```

Add the endpoint:

```python
@router.post("/orders/override", response_model=TwsOrderActionResult)
async def override_order(
    request: TwsOverrideRequest,
    svc: ExecutionPlanService = Depends(get_execution_plan_service),
    adapter: TwsBrokerAdapter = Depends(get_tws_adapter),
) -> TwsOrderActionResult:
    try:
        codes = _override_codes(request)
        if request.intent == "place":
            if request.plan_id is None:
                raise HTTPException(status_code=422, detail={"error": "plan_id_required"})
            plan = svc.get(request.plan_id)
            if plan is None:
                raise HTTPException(
                    status_code=404,
                    detail={"error": "plan_not_found", "plan_id": request.plan_id},
                )
            submission = adapter.place_paper_order(plan, advanced_override=codes)
            return TwsOrderActionResult(
                order_id=submission.order_id,
                status=submission.status,
                action="override",
                message="Override order sent to TWS.",
            )
        if request.order_id is None or request.modify is None:
            raise HTTPException(
                status_code=422,
                detail={"error": "modify_override_requires_order_id_and_modify"},
            )
        return adapter.modify_order(request.order_id, request.modify, advanced_override=codes)
    except TwsPlaceOrderGuardError as exc:
        raise _guard_http_error(exc)
    except TwsAdvancedRejectError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "advanced_reject", "reject": exc.reject.model_dump()},
        )
    except (RuntimeError, OSError) as exc:
        log.error("TWS override failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "unknown_outcome", "message": "Override failed unexpectedly. Refresh Open Orders before retrying."},
        )
```

Do not add DB persistence. `plan_id` works only while the process-local plan is
still present; if Orbit restarts, the user recreates the intraday ticket.

- [ ] **Step 5: Add frontend advanced reject panel**

In `api.ts`:

```ts
export interface TwsAdvancedReject {
  order_id: number | null;
  reason: string;
  override_codes: string[];
  raw: unknown;
}

export interface TwsOverrideRequest {
  intent: "place" | "modify";
  order_id: number | null;
  plan_id: string | null;
  modify: TwsModifyOrderRequest | null;
  override_codes: string[];
}
```

Add:

```ts
overrideOrder: (req: TwsOverrideRequest) =>
  sidecarRequest<TwsOrderActionResult>("POST", "/execution-assistant/orders/override", req),
```

In `TwsExecutionAssistantModule.tsx`:

- Extract `advanced_reject` from `ApiError.body.detail`.
- Store it as `advancedReject`.
- Show a blocking panel in the execution panel with:
  - `advancedReject.reason`
  - override code chips
  - `<details>` with raw JSON via `JSON.stringify(advancedReject.raw, null, 2)`
  - `Override and submit`
  - `Cancel`
- Override button calls `twsApi.overrideOrder(...)`.
  - place override payload: `{ intent: "place", plan_id, order_id: null, modify: null, override_codes }`
  - modify override payload: `{ intent: "modify", plan_id: null, order_id, modify: modifyForm, override_codes }`
- Cancel button clears `advancedReject` and refreshes Open Orders.
- Never call override automatically.

- [ ] **Step 6: Add focused advanced reject test**

Use adapter stub to raise `TwsAdvancedRejectError` from submit or modify. Add one public-boundary test:

```python
def test_advanced_reject_returns_override_payload_without_resubmitting():
    stub, client = _setup(sec_type="STK", connected=True, paper_port=True)
    stub.raise_advanced_reject = True
    plan_id = client.post("/execution-assistant/plans/draft", json=_draft()).json()["plan_id"]
    client.post(f"/execution-assistant/plans/{plan_id}/validate")
    r = client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "advanced_reject"
    assert "reject" in r.json()["detail"]
    assert stub.place_paper_order_calls == 1
```

If `_AdapterStub` shape needs changing, keep the test at the router boundary and prove no automatic second broker call happens.

- [ ] **Step 7: Verify Slice 4**

Run:

```bash
cd backend && uv run python -m pytest tests/test_execution_plan.py -q
npm run typecheck
```

Manual smoke:

- Try to capture one real TWS advanced reject in paper mode.
- If no reliable reject can be triggered, report: `Advanced reject UI was tested through mocked/defensive path; real TWS reject payload not smoke-proven.`

**Stop condition:** Advanced rejects never auto-resubmit; override requires explicit user action.

---

## PROJECT_PLAN.md Impact

Update `PROJECT_PLAN.md` before coding to add this as the next TWS follow-up mission and note:

- no persistence in this batch
- no live enablement in this batch
- Slice 1 standalone; Slices 2+3 may batch; Slice 4 standalone

Update it again after execution with shipped behavior and verification.

## Reviewer Checklist

- No `ib_async` types leak beyond `TwsBrokerAdapter`.
- No direct frontend `fetch`; all calls go through `twsApi`.
- No DB persistence or schema changes.
- No live trading enablement.
- No global cancel.
- Cancel/modify/override all recheck paper mutation guard inside adapter.
- Unsupported order types remain cancel-only.
- Advanced rejects never auto-override.
- Unknown outcome still refreshes Open Orders/status before retry.
