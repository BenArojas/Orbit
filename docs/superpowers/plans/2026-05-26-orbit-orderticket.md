# Orbit OrderTicket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared Orbit OrderTicket slide-over that can preview, confirm, place, cancel, and modify paper-account stock orders from MoonMarket and Parallax.

**Architecture:** Implement the backend order API first under `/moonmarket/orders` with strict Pydantic contracts and a server-side live-account guard. Then add a shared account store, a shared OrderTicket store/UI mounted once in `OrbitProviders`, and conid-only entry points from MoonMarket and Parallax.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, ibind-backed `IBKRService`, React 19, TypeScript, Zustand, TanStack Query v5, Tailwind/shadcn, Vitest, Testing Library, pytest, uv.

---

## Reference Inputs

- Design spec: `docs/superpowers/specs/2026-05-26-orbit-orderticket-design.md`
- Parent v1 spec: `docs/superpowers/specs/2026-05-25-orbit-v1-design.md`
- Proven reference backend: `reference/moonmarket/backend/api/orders.py`
- Proven reference frontend: `reference/moonmarket/frontend/StockItem/trading/OrderPanel.tsx`
- Current MoonMarket module: `src/modules/moonmarket/MoonMarketModule.tsx`
- Current MoonMarket portfolio page: `src/modules/moonmarket/PortfolioPage.tsx`
- Current Orbit provider mount: `src/orbit/OrbitProviders.tsx`
- Current Parallax analysis page: `src/pages/AnalysisPage.tsx`

## Branch Setup

Create the implementation branch from current `dev`.

- [ ] **Step 1: Start the feature branch**

Run:

```bash
git checkout dev
git pull --ff-only origin dev
git checkout -b feature/orbit-orderticket
```

Expected: `git branch --show-current` prints `feature/orbit-orderticket`.

- [ ] **Step 2: Confirm Plan #4 is present**

Run:

```bash
git log --oneline --decorate -5
test -f src/modules/moonmarket/TransactionsPage.tsx
test -f docs/superpowers/specs/2026-05-26-orbit-orderticket-design.md
```

Expected: the branch includes `src/modules/moonmarket/TransactionsPage.tsx` and the OrderTicket design spec. If the spec is not on `dev` yet, merge or cherry-pick the docs branch before coding so the implementation branch carries the spec.

---

## File Structure

Backend:

- Modify `backend/models/__init__.py`
  - Add `MoonMarketAccount.is_paper`.
  - Add order request/response models used by the orders router.
- Modify `backend/services/moonmarket.py`
  - Add account paper detection helpers.
  - Keep `/moonmarket/accounts` as the shared account source for MoonMarket and OrderTicket.
- Create `backend/services/orders.py`
  - Own order preview/place/reply/cancel/modify business logic.
  - Convert Orbit order models into IBKR Client Portal payloads.
  - Enforce paper-only mutations on the server.
- Create `backend/routers/orders.py`
  - Expose `/moonmarket/orders/*` endpoints.
  - Translate typed order errors into HTTP responses.
- Modify `backend/main.py`
  - Include the new orders router.
- Modify `backend/constants/ibkr_pacing.py`
  - Add explicit pacing keys for `/iserver/reply` and `/iserver/account/{accountId}/order/{orderId}` path prefixes if they are not covered by the existing longest-prefix rules.
- Modify `backend/tests/test_moonmarket_router.py`
  - Update account response expectations for `is_paper`.
- Create `backend/tests/test_orders_router.py`
  - Cover preview, place, reply, cancel, modify, bracket payload shape, and live-account 403s.

Frontend:

- Modify `src/lib/api.ts`
  - Add raw TypeScript order types.
  - Add raw `api.moonmarket*Order*` methods only.
- Modify `src/lib/api.moonmarket.test.ts`
  - Cover order endpoint paths and URL encoding.
- Create `src/orbit/OrderTicket/useAccountStore.ts`
  - Own selected/default MoonMarket account across module selector and ticket.
- Create `src/orbit/OrderTicket/useOrderTicketStore.ts`
  - Own ticket open/close target state.
- Create `src/orbit/OrderTicket/useOrderMutations.ts`
  - Own TanStack Query mutations for preview/place/reply/cancel/modify.
- Create `src/orbit/OrderTicket/OrderTicket.tsx`
  - Right-side fixed slide-over shell mounted once.
- Create `src/orbit/OrderTicket/OrderForm.tsx`
  - Form state and action buttons for single and bracket stock orders.
- Create `src/orbit/OrderTicket/OrderResult.tsx`
  - Preview/result/confirmation display.
- Create `src/orbit/OrderTicket/index.ts`
  - Re-export public OrderTicket pieces used by modules.
- Modify `src/orbit/OrbitProviders.tsx`
  - Mount `<OrderTicket />` beside `{children}`, before `<Toaster />`.
- Modify `src/modules/moonmarket/MoonMarketModule.tsx`
  - Hydrate `useAccountStore` from `/moonmarket/accounts`.
  - Remove local selected-account state.
- Modify `src/modules/moonmarket/MoonMarketLayout.tsx`
  - Keep the selector UI; use the shared store through props from `MoonMarketModule`.
- Modify `src/modules/moonmarket/PortfolioPage.tsx`
  - Add Trade and Analyze in Parallax actions to the selected-position inspector.
  - Do not reintroduce the duplicate holdings table.
- Modify `src/modules/moonmarket/TransactionsPage.tsx`
  - Pass the selected account id into the live orders table.
- Modify `src/modules/moonmarket/LiveOrdersTable.tsx`
  - Add Cancel and Modify row actions for working orders.
  - Keep the table compact; do not move live order actions into the portfolio page.
- Modify `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`
  - Cover account store hydration, MoonMarket entry buttons, and live order actions.
- Modify `src/pages/AnalysisPage.tsx`
  - Add Trade and View Portfolio toolbar buttons.
- Create or modify `src/pages/__tests__/AnalysisPage.test.tsx`
  - Cover Parallax entry buttons with mocked stores/router.
- Create `src/orbit/OrderTicket/__tests__/useAccountStore.test.ts`
- Create `src/orbit/OrderTicket/__tests__/useOrderTicketStore.test.ts`
- Create `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`

---

## Task 1: Add Paper Account Detection

**Files:**

- Modify: `backend/models/__init__.py`
- Modify: `backend/services/moonmarket.py`
- Modify: `backend/tests/test_moonmarket_router.py`

- [ ] **Step 1: Update the failing account tests**

In `backend/tests/test_moonmarket_router.py`, update `_FakeState.accounts` so it includes explicit and inferred paper/live examples:

```python
self.accounts = [
    {"id": "DU12345", "accountId": "DU12345", "accountTitle": "Paper Trading", "type": "DEMO"},
    {"id": "U12345", "accountId": "U12345", "accountTitle": "Live Trading", "isPaper": False},
    {"id": "DU99999", "accountId": "DU99999", "accountTitle": "Second Paper Account"},
]
```

Update `test_moonmarket_accounts_returns_available_accounts_and_selected_account` expected JSON:

```python
assert body["accounts"] == [
    {"account_id": "DU12345", "label": "Paper Trading", "selected": True, "is_paper": True},
    {"account_id": "U12345", "label": "Live Trading", "selected": False, "is_paper": False},
    {"account_id": "DU99999", "label": "Second Paper Account", "selected": False, "is_paper": True},
]
```

Add a direct helper behavior test near the account test:

```python
def test_moonmarket_accounts_prefers_explicit_paper_flag_over_prefix():
    fake = _FakeIbkr()
    fake.state.accounts = [
        {"id": "DU-LIVE", "accountId": "DU-LIVE", "accountTitle": "Explicit Live", "isPaper": False},
        {"id": "U-PAPER", "accountId": "U-PAPER", "accountTitle": "Explicit Paper", "isPaper": True},
    ]

    resp = _client(fake).get("/moonmarket/accounts")

    assert resp.status_code == 200
    body = resp.json()
    assert body["accounts"][0]["is_paper"] is False
    assert body["accounts"][1]["is_paper"] is True
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd backend
uv run python -m pytest tests/test_moonmarket_router.py::test_moonmarket_accounts_returns_available_accounts_and_selected_account tests/test_moonmarket_router.py::test_moonmarket_accounts_prefers_explicit_paper_flag_over_prefix -q
```

Expected: fails because `MoonMarketAccount` does not expose `is_paper`.

- [ ] **Step 3: Add `is_paper` to the response model**

In `backend/models/__init__.py`, change `MoonMarketAccount`:

```python
class MoonMarketAccount(BaseModel):
    """One IBKR account available to MoonMarket."""
    account_id: str
    label: str
    selected: bool = False
    is_paper: bool = False
```

- [ ] **Step 4: Add account paper detection**

In `backend/services/moonmarket.py`, add this helper near `_first_value`:

```python
def _bool_value(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "paper", "demo", "simulated"}:
            return True
        if normalized in {"false", "0", "no", "live"}:
            return False
    return None
```

Add a private method to `MoonMarketService`:

```python
def _account_is_paper(self, row: dict[str, Any], account_id: str) -> bool:
    for key in ("isPaper", "is_paper", "paper", "paperTrading", "isPaperTrading"):
        if key in row:
            explicit = _bool_value(row.get(key))
            if explicit is not None:
                return explicit

    account_type = _first_text(
        row,
        ("type", "accountType", "tradingType", "acctType", "category"),
    ).lower()
    if any(token in account_type for token in ("paper", "demo", "simulated")):
        return True
    if "live" in account_type:
        return False

    return account_id.upper().startswith("DU")
```

Update account model creation in `MoonMarketService.accounts`:

```python
MoonMarketAccount(
    account_id=account_id,
    label=self._account_label(row, account_id),
    selected=account_id == selected_id,
    is_paper=self._account_is_paper(row, account_id),
)
```

- [ ] **Step 5: Run the account tests**

Run:

```bash
cd backend
uv run python -m pytest tests/test_moonmarket_router.py::test_moonmarket_accounts_returns_available_accounts_and_selected_account tests/test_moonmarket_router.py::test_moonmarket_accounts_prefers_explicit_paper_flag_over_prefix -q
```

Expected: both tests pass.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add backend/models/__init__.py backend/services/moonmarket.py backend/tests/test_moonmarket_router.py
git commit -m "feat: expose MoonMarket paper account flag"
```

---

## Task 2: Add Backend Orders API

**Files:**

- Modify: `backend/models/__init__.py`
- Create: `backend/services/orders.py`
- Create: `backend/routers/orders.py`
- Modify: `backend/main.py`
- Modify: `backend/constants/ibkr_pacing.py`
- Create: `backend/tests/test_orders_router.py`

- [ ] **Step 1: Write the failing router tests**

Create `backend/tests/test_orders_router.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import require_ibkr_auth
from routers.orders import router as orders_router


class _FakeState:
    authenticated = True
    selected_account = "DU12345"

    def __init__(self) -> None:
        self.accounts = [
            {"id": "DU12345", "accountId": "DU12345", "accountTitle": "Paper", "isPaper": True},
            {"id": "U12345", "accountId": "U12345", "accountTitle": "Live", "isPaper": False},
        ]


class _FakeIbkr:
    def __init__(self) -> None:
        self.state = _FakeState()
        self.requests: list[tuple[str, str, dict]] = []

    async def ensure_accounts(self) -> list[dict]:
        return self.state.accounts

    async def _request(self, method: str, endpoint: str, **kwargs):
        self.requests.append((method, endpoint, dict(kwargs)))
        if endpoint.endswith("/orders/whatif"):
            return {"data": [{"amount": {"total": "925.60"}, "warning_message": "margin preview"}]}
        if endpoint.endswith("/orders"):
            return {"data": [{"id": "reply-1"}]}
        if endpoint.startswith("/iserver/reply/"):
            return {"data": [{"order_id": "order-1"}]}
        if endpoint == "/iserver/account/orders":
            if kwargs.get("params") == {"force": "true"}:
                return {"orders": []}
            return {
                "orders": [
                    {
                        "orderId": "order-1",
                        "conid": 265598,
                        "origOrderType": "LMT",
                        "side": "BUY",
                        "timeInForce": "DAY",
                        "totalSize": 5,
                        "price": 180.0,
                    }
                ]
            }
        if "/order/" in endpoint and method == "DELETE":
            return {"order_id": "order-1", "status": "cancelled"}
        if "/order/" in endpoint and method == "POST":
            return {"order_id": "order-1", "status": "modified"}
        raise AssertionError(f"Unexpected IBKR request: {method} {endpoint}")


def _client(fake_ibkr: _FakeIbkr) -> TestClient:
    app = FastAPI()
    app.include_router(orders_router)
    app.dependency_overrides[require_ibkr_auth] = lambda: fake_ibkr
    return TestClient(app)


def _single_order(conid: int = 265598) -> dict:
    return {
        "conid": conid,
        "side": "BUY",
        "quantity": 5,
        "orderType": "LMT",
        "tif": "DAY",
        "price": 180.0,
    }


def test_preview_order_posts_whatif_and_allows_live_accounts():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders/preview",
        json={"account_id": "U12345", "order": _single_order()},
    )

    assert resp.status_code == 200
    assert resp.json()["account_id"] == "U12345"
    assert fake.requests[-1] == (
        "POST",
        "/iserver/account/U12345/orders/whatif",
        {"json": {"orders": [_single_order()]}},
    )


def test_place_order_posts_single_order_for_paper_account():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": [_single_order()]},
    )

    assert resp.status_code == 200
    assert resp.json()["account_id"] == "DU12345"
    assert fake.requests[-1] == (
        "POST",
        "/iserver/account/DU12345/orders",
        {"json": {"orders": [_single_order()]}},
    )


def test_place_order_preserves_bracket_payload_for_paper_account():
    fake = _FakeIbkr()
    bracket = [
        {**_single_order(), "cOID": "brkt-1"},
        {
            "conid": 265598,
            "parentId": "brkt-1",
            "side": "SELL",
            "quantity": 5,
            "orderType": "LMT",
            "tif": "GTC",
            "price": 200.0,
            "isSingleGroup": True,
        },
        {
            "conid": 265598,
            "parentId": "brkt-1",
            "side": "SELL",
            "quantity": 5,
            "orderType": "STP",
            "tif": "GTC",
            "price": 165.0,
            "isSingleGroup": True,
        },
    ]

    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": bracket},
    )

    assert resp.status_code == 200
    assert fake.requests[-1][2] == {"json": {"orders": bracket}}


def test_reply_requires_account_id_for_paper_guard():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders/DU12345/reply/reply-1",
        json={"confirmed": True},
    )

    assert resp.status_code == 200
    assert fake.requests[-1] == (
        "POST",
        "/iserver/reply/reply-1",
        {"json": {"confirmed": True}},
    )


def test_cancel_and_modify_call_ibkr_for_paper_account():
    fake = _FakeIbkr()
    client = _client(fake)

    cancel = client.delete("/moonmarket/orders/DU12345/order-1")
    modify = client.patch(
        "/moonmarket/orders/DU12345/order-1",
        json={"conid": 265598, "side": "BUY", "quantity": 5, "orderType": "LMT", "tif": "DAY", "price": 181.0},
    )

    assert cancel.status_code == 200
    assert modify.status_code == 200
    assert ("DELETE", "/iserver/account/DU12345/order/order-1", {}) in fake.requests
    assert fake.requests[-1] == (
        "POST",
        "/iserver/account/DU12345/order/order-1",
        {"json": {"conid": 265598, "orderType": "LMT", "side": "BUY", "tif": "DAY", "quantity": 5.0, "price": 181.0}},
    )


def test_live_account_allows_all_order_mutations():
    fake = _FakeIbkr()
    client = _client(fake)

    responses = [
        client.post("/moonmarket/orders", json={"account_id": "U12345", "orders": [_single_order()]}),
        client.post("/moonmarket/orders/U12345/reply/reply-1", json={"confirmed": True}),
        client.delete("/moonmarket/orders/U12345/order-1"),
        client.patch("/moonmarket/orders/U12345/order-1", json=_single_order()),
    ]

    assert [resp.status_code for resp in responses] == [200, 200, 200, 200]
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd backend
uv run python -m pytest tests/test_orders_router.py -q
```

Expected: fails because `routers.orders` does not exist.

- [ ] **Step 3: Add order models**

In `backend/models/__init__.py`, add these models after `MoonMarketLiveOrdersResponse`:

```python
OrderSide = Literal["BUY", "SELL"]
OrderType = Literal["MKT", "LMT", "STP", "STP_LIMIT", "TRAIL"]
TimeInForce = Literal["DAY", "GTC", "IOC"]


class MoonMarketOrderDraft(BaseModel):
    """One normalized stock order request accepted by Orbit."""
    conid: int
    side: OrderSide
    quantity: float = Field(gt=0)
    order_type: OrderType = Field(alias="orderType")
    tif: TimeInForce = "DAY"
    price: Optional[float] = Field(default=None, gt=0)
    aux_price: Optional[float] = Field(default=None, alias="auxPrice", gt=0)
    client_order_id: Optional[str] = Field(default=None, alias="cOID")
    parent_id: Optional[str] = Field(default=None, alias="parentId")
    is_single_group: bool = Field(default=False, alias="isSingleGroup")

    model_config = ConfigDict(populate_by_name=True)


class MoonMarketOrderPreviewRequest(BaseModel):
    account_id: str
    order: MoonMarketOrderDraft


class MoonMarketOrdersRequest(BaseModel):
    account_id: str
    orders: list[MoonMarketOrderDraft] = Field(min_length=1, max_length=3)


class MoonMarketOrderReplyRequest(BaseModel):
    confirmed: bool


class MoonMarketOrderActionResponse(BaseModel):
    account_id: str
    result: dict[str, object] | list[dict[str, object]]
```

At the top of `backend/models/__init__.py`, add imports if missing:

```python
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal, Optional
```

Keep existing imports intact and avoid duplicate import lines.

- [ ] **Step 4: Create the orders service**

Create `backend/services/orders.py`:

```python
"""MoonMarket order service for stock and option order mutations."""

from __future__ import annotations

from typing import Any

from models import MoonMarketOrderDraft
from services.ibkr import IBKRService
from services.moonmarket import MoonMarketAccountNotFoundError, MoonMarketService


class MoonMarketOrderNotFoundError(LookupError):
    """Raised when a modify request targets an order not present in live orders."""


class OrderService:
    """Order preview and order mutations through IBKR Client Portal."""

    def __init__(self, ibkr: IBKRService) -> None:
        self.ibkr = ibkr
        self.moonmarket = MoonMarketService(ibkr)

    async def preview(self, account_id: str, order: MoonMarketOrderDraft) -> dict[str, object] | list[dict[str, object]]:
        await self.moonmarket._resolve_account_id(account_id)
        return await self.ibkr._request(
            "POST",
            f"/iserver/account/{account_id}/orders/whatif",
            json={"orders": [self._order_payload(order)]},
        )

    async def place(self, account_id: str, orders: list[MoonMarketOrderDraft]) -> dict[str, object] | list[dict[str, object]]:
        await self._assert_paper_account(account_id)
        return await self.ibkr._request(
            "POST",
            f"/iserver/account/{account_id}/orders",
            json={"orders": [self._order_payload(order) for order in orders]},
        )

    async def reply(self, account_id: str, reply_id: str, confirmed: bool) -> dict[str, object] | list[dict[str, object]]:
        await self._assert_paper_account(account_id)
        return await self.ibkr._request(
            "POST",
            f"/iserver/reply/{reply_id}",
            json={"confirmed": confirmed},
        )

    async def cancel(self, account_id: str, order_id: str) -> dict[str, object] | list[dict[str, object]]:
        await self._assert_paper_account(account_id)
        return await self.ibkr._request(
            "DELETE",
            f"/iserver/account/{account_id}/order/{order_id}",
        )

    async def modify(
        self,
        account_id: str,
        order_id: str,
        order: MoonMarketOrderDraft,
    ) -> dict[str, object] | list[dict[str, object]]:
        await self._assert_paper_account(account_id)
        return await self.ibkr._request(
            "POST",
            f"/iserver/account/{account_id}/order/{order_id}",
            json=self._order_payload(order),
        )

    async def _assert_paper_account(self, account_id: str) -> None:
        raw_accounts = await self.ibkr.ensure_accounts()
        for row in raw_accounts:
            resolved = self.moonmarket._account_id(row)
            if resolved == account_id:
                if self.moonmarket._account_is_paper(row, account_id):
                    return
                raise LiveTradingBlockedError(account_id)
        raise MoonMarketAccountNotFoundError(f"Unknown account_id: {account_id}")

    def _order_payload(self, order: MoonMarketOrderDraft) -> dict[str, object]:
        payload: dict[str, object] = {
            "conid": order.conid,
            "orderType": order.order_type,
            "side": order.side,
            "tif": order.tif,
            "quantity": order.quantity,
        }
        if order.price is not None:
            payload["price"] = order.price
        if order.aux_price is not None:
            payload["auxPrice"] = order.aux_price
        if order.client_order_id is not None:
            payload["cOID"] = order.client_order_id
        if order.parent_id is not None:
            payload["parentId"] = order.parent_id
        if order.is_single_group:
            payload["isSingleGroup"] = True
        return payload
```

- [ ] **Step 5: Create the orders router**

Create `backend/routers/orders.py`:

```python
"""MoonMarket order router."""

from fastapi import APIRouter, Depends, HTTPException, status

from deps import require_ibkr_auth
from models import (
    MoonMarketOrderActionResponse,
    MoonMarketOrderDraft,
    MoonMarketOrderPreviewRequest,
    MoonMarketOrderReplyRequest,
    MoonMarketOrdersRequest,
)
from services.ibkr import IBKRService
from services.moonmarket import MoonMarketAccountNotFoundError
from services.orders import LiveTradingBlockedError, OrderService

router = APIRouter(prefix="/moonmarket/orders", tags=["moonmarket-orders"])


def _service(ibkr: IBKRService) -> OrderService:
    return OrderService(ibkr)


def _result(account_id: str, result: dict[str, object] | list[dict[str, object]]) -> MoonMarketOrderActionResponse:
    return MoonMarketOrderActionResponse(account_id=account_id, result=result)


def _account_not_found(exc: MoonMarketAccountNotFoundError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": "moonmarket_account_not_found", "message": str(exc)},
    )


def _trading_safety_rejected(message: str | None) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error": "trading_safety_rejected",
            "message": message or "Trading Safety rejected this order action.",
        },
    )


@router.post("/preview", response_model=MoonMarketOrderActionResponse)
async def preview_order(
    request: MoonMarketOrderPreviewRequest,
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOrderActionResponse:
    try:
        result = await _service(ibkr).preview(request.account_id, request.order)
        return _result(request.account_id, result)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc


@router.post("", response_model=MoonMarketOrderActionResponse)
async def place_orders(
    request: MoonMarketOrdersRequest,
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOrderActionResponse:
    try:
        result = await _service(ibkr).place(request.account_id, request.orders)
        return _result(request.account_id, result)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    except LiveTradingBlockedError as exc:
        raise _live_blocked(exc) from exc


@router.post("/{account_id}/reply/{reply_id}", response_model=MoonMarketOrderActionResponse)
async def reply_to_order(
    account_id: str,
    reply_id: str,
    request: MoonMarketOrderReplyRequest,
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOrderActionResponse:
    try:
        result = await _service(ibkr).reply(account_id, reply_id, request.confirmed)
        return _result(account_id, result)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    except LiveTradingBlockedError as exc:
        raise _live_blocked(exc) from exc


@router.delete("/{account_id}/{order_id}", response_model=MoonMarketOrderActionResponse)
async def cancel_order(
    account_id: str,
    order_id: str,
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOrderActionResponse:
    try:
        result = await _service(ibkr).cancel(account_id, order_id)
        return _result(account_id, result)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    except LiveTradingBlockedError as exc:
        raise _live_blocked(exc) from exc


@router.patch("/{account_id}/{order_id}", response_model=MoonMarketOrderActionResponse)
async def modify_order(
    account_id: str,
    order_id: str,
    order: MoonMarketOrderDraft,
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOrderActionResponse:
    try:
        result = await _service(ibkr).modify(account_id, order_id, order)
        return _result(account_id, result)
    except MoonMarketAccountNotFoundError as exc:
        raise _account_not_found(exc) from exc
    except LiveTradingBlockedError as exc:
        raise _live_blocked(exc) from exc
```

- [ ] **Step 6: Register router and pacing keys**

In `backend/main.py`, after the MoonMarket router import/include:

```python
from routers.orders import router as orders_router
app.include_router(orders_router)
```

In `backend/constants/ibkr_pacing.py`, add explicit entries:

```python
"/iserver/account/": EndpointLimit("per_sec", 1, 5),
"/iserver/reply": EndpointLimit("per_sec", 1, 5),
```

Then run the existing pacing tests. If `"/iserver/account/"` makes a broader read path too slow in tests, remove it and add a focused normalizer test documenting that order mutations currently fall back to the global cap. Do not hardcode rate sleeps inside `OrderService`.

- [ ] **Step 7: Run backend order tests**

Run:

```bash
cd backend
uv run python -m pytest tests/test_orders_router.py tests/test_moonmarket_router.py::test_moonmarket_accounts_returns_available_accounts_and_selected_account tests/test_ibkr_pacing.py -q
```

Expected: tests pass.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add backend/models/__init__.py backend/services/orders.py backend/routers/orders.py backend/main.py backend/constants/ibkr_pacing.py backend/tests/test_orders_router.py backend/tests/test_moonmarket_router.py
git commit -m "feat: add paper-only MoonMarket order API"
```

---

## Task 3: Add Frontend Raw API Methods

**Files:**

- Modify: `src/lib/api.ts`
- Modify: `src/lib/api.moonmarket.test.ts`

- [ ] **Step 1: Add failing API client tests**

Append to `src/lib/api.moonmarket.test.ts`:

```ts
it("calls MoonMarket order preview and placement endpoints", async () => {
  const order = { conid: 265598, side: "BUY" as const, quantity: 5, orderType: "LMT" as const, tif: "DAY" as const, price: 180 };

  await api.moonmarketPreviewOrder({ account_id: "DU 123", order });
  await api.moonmarketPlaceOrders({ account_id: "DU 123", orders: [order] });

  const previewUrl = String(vi.mocked(fetch).mock.calls[0][0]);
  const previewOptions = vi.mocked(fetch).mock.calls[0][1];
  const placeUrl = String(vi.mocked(fetch).mock.calls[1][0]);
  const placeOptions = vi.mocked(fetch).mock.calls[1][1];

  expect(previewUrl).toContain("/moonmarket/orders/preview");
  expect(previewOptions).toMatchObject({ method: "POST" });
  expect(JSON.parse(String(previewOptions?.body))).toEqual({ account_id: "DU 123", order });
  expect(placeUrl).toContain("/moonmarket/orders");
  expect(placeOptions).toMatchObject({ method: "POST" });
});

it("encodes MoonMarket order reply, cancel, and modify endpoints", async () => {
  const order = { conid: 265598, side: "BUY" as const, quantity: 5, orderType: "LMT" as const, tif: "DAY" as const, price: 181 };

  await api.moonmarketReplyOrder("DU 123", "reply/1", true);
  await api.moonmarketCancelOrder("DU 123", "order/1");
  await api.moonmarketModifyOrder("DU 123", "order/1", order);

  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/moonmarket/orders/DU%20123/reply/reply%2F1");
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ confirmed: true });
  expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("/moonmarket/orders/DU%20123/order%2F1");
  expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  expect(vi.mocked(fetch).mock.calls[2][1]).toMatchObject({ method: "PATCH" });
});
```

- [ ] **Step 2: Run the API test and verify it fails**

Run:

```bash
npm run test -- src/lib/api.moonmarket.test.ts
```

Expected: fails because the order client methods do not exist.

- [ ] **Step 3: Add TypeScript order types and raw methods**

In `src/lib/api.ts`, near the MoonMarket types, add:

```ts
export type MoonMarketOrderSide = "BUY" | "SELL";
export type MoonMarketOrderType = "MKT" | "LMT" | "STP" | "STP_LIMIT" | "TRAIL";
export type MoonMarketTimeInForce = "DAY" | "GTC" | "IOC";

export interface MoonMarketOrderDraft {
  conid: number;
  side: MoonMarketOrderSide;
  quantity: number;
  orderType: MoonMarketOrderType;
  tif: MoonMarketTimeInForce;
  price?: number;
  auxPrice?: number;
  cOID?: string;
  parentId?: string;
  isSingleGroup?: boolean;
}

export interface MoonMarketOrderPreviewRequest {
  account_id: string;
  order: MoonMarketOrderDraft;
}

export interface MoonMarketOrdersRequest {
  account_id: string;
  orders: MoonMarketOrderDraft[];
}

export interface MoonMarketOrderActionResponse {
  account_id: string;
  result: Record<string, unknown> | Array<Record<string, unknown>>;
}
```

Inside the exported `api` object, after `moonmarketLiveOrders`, add:

```ts
moonmarketPreviewOrder: (body: MoonMarketOrderPreviewRequest, signal?: AbortSignal) =>
  request<MoonMarketOrderActionResponse>("POST", "/moonmarket/orders/preview", body, signal),

moonmarketPlaceOrders: (body: MoonMarketOrdersRequest, signal?: AbortSignal) =>
  request<MoonMarketOrderActionResponse>("POST", "/moonmarket/orders", body, signal),

moonmarketReplyOrder: (accountId: string, replyId: string, confirmed: boolean, signal?: AbortSignal) =>
  request<MoonMarketOrderActionResponse>(
    "POST",
    `/moonmarket/orders/${encodeURIComponent(accountId)}/reply/${encodeURIComponent(replyId)}`,
    { confirmed },
    signal,
  ),

moonmarketCancelOrder: (accountId: string, orderId: string, signal?: AbortSignal) =>
  request<MoonMarketOrderActionResponse>(
    "DELETE",
    `/moonmarket/orders/${encodeURIComponent(accountId)}/${encodeURIComponent(orderId)}`,
    undefined,
    signal,
  ),

moonmarketModifyOrder: (accountId: string, orderId: string, order: MoonMarketOrderDraft, signal?: AbortSignal) =>
  request<MoonMarketOrderActionResponse>(
    "PATCH",
    `/moonmarket/orders/${encodeURIComponent(accountId)}/${encodeURIComponent(orderId)}`,
    order,
    signal,
  ),
```

- [ ] **Step 4: Run the API test**

Run:

```bash
npm run test -- src/lib/api.moonmarket.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/lib/api.ts src/lib/api.moonmarket.test.ts
git commit -m "feat: add MoonMarket order API client"
```

---

## Task 4: Add Shared Account Store and Migrate MoonMarket

**Files:**

- Create: `src/orbit/OrderTicket/useAccountStore.ts`
- Create: `src/orbit/OrderTicket/__tests__/useAccountStore.test.ts`
- Modify: `src/modules/moonmarket/MoonMarketModule.tsx`
- Modify: `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`

- [ ] **Step 1: Write store tests**

Create `src/orbit/OrderTicket/__tests__/useAccountStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "../useAccountStore";

describe("useAccountStore", () => {
  beforeEach(() => {
    useAccountStore.setState({ accounts: [], selectedAccountId: null });
  });

  it("hydrates accounts and selects the backend default", () => {
    useAccountStore.getState().setAccounts(
      [
        { account_id: "DU12345", label: "Paper", selected: true, is_paper: true },
        { account_id: "U12345", label: "Live", selected: false, is_paper: false },
      ],
      "U12345",
    );

    expect(useAccountStore.getState().selectedAccountId).toBe("U12345");
    expect(useAccountStore.getState().selectedAccount()?.account_id).toBe("U12345");
    expect(useAccountStore.getState().selectedAccount()?.is_paper).toBe(false);
  });

  it("keeps a user-selected account when it still exists after hydration", () => {
    useAccountStore.getState().setSelectedAccountId("DU12345");
    useAccountStore.getState().setAccounts(
      [
        { account_id: "DU12345", label: "Paper", selected: true, is_paper: true },
        { account_id: "U12345", label: "Live", selected: false, is_paper: false },
      ],
      "U12345",
    );

    expect(useAccountStore.getState().selectedAccountId).toBe("DU12345");
  });
});
```

- [ ] **Step 2: Run the store test and verify it fails**

Run:

```bash
npm run test -- src/orbit/OrderTicket/__tests__/useAccountStore.test.ts
```

Expected: fails because `useAccountStore` does not exist.

- [ ] **Step 3: Implement the account store**

Create `src/orbit/OrderTicket/useAccountStore.ts`:

```ts
import { create } from "zustand";
import type { MoonMarketAccount } from "@/modules/moonmarket/types";

type AccountState = {
  accounts: MoonMarketAccount[];
  selectedAccountId: string | null;
  setAccounts: (accounts: MoonMarketAccount[], defaultAccountId?: string | null) => void;
  setSelectedAccountId: (accountId: string | null) => void;
  selectedAccount: () => MoonMarketAccount | null;
};

export const useAccountStore = create<AccountState>()((set, get) => ({
  accounts: [],
  selectedAccountId: null,

  setAccounts: (accounts, defaultAccountId = null) => {
    set((state) => {
      const currentStillExists = state.selectedAccountId
        ? accounts.some((account) => account.account_id === state.selectedAccountId)
        : false;
      return {
        accounts,
        selectedAccountId: currentStillExists
          ? state.selectedAccountId
          : defaultAccountId ?? accounts[0]?.account_id ?? null,
      };
    });
  },

  setSelectedAccountId: (accountId) => set({ selectedAccountId: accountId }),

  selectedAccount: () => {
    const { accounts, selectedAccountId } = get();
    return accounts.find((account) => account.account_id === selectedAccountId) ?? null;
  },
}));
```

- [ ] **Step 4: Migrate MoonMarketModule to the shared store**

In `src/modules/moonmarket/MoonMarketModule.tsx`:

- Remove `useMemo`, `useState`, and `useEffect` imports that are no longer needed.
- Import `useAccountStore`:

```ts
import { useEffect } from "react";
import { useAccountStore } from "@/orbit/OrderTicket/useAccountStore";
```

Inside `MoonMarketModule`, replace local state/default account logic with:

```ts
const selectedAccountId = useAccountStore((state) => state.selectedAccountId);
const setAccounts = useAccountStore((state) => state.setAccounts);
const setSelectedAccountId = useAccountStore((state) => state.setSelectedAccountId);

useEffect(() => {
  if (accountsQuery.data) {
    setAccounts(accountsQuery.data.accounts, accountsQuery.data.selected_account_id);
  }
}, [accountsQuery.data, setAccounts]);

const accountId = selectedAccountId;
const accounts = accountsQuery.data?.accounts ?? [];
```

Keep the existing `MoonMarketLayout` props:

```tsx
<MoonMarketLayout
  activePage={activePage}
  accounts={accounts}
  accountId={accountId}
  onAccountChange={setSelectedAccountId}
>
```

- [ ] **Step 5: Update MoonMarket account test data**

In `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`, update mocked accounts:

```ts
accounts: [{ account_id: "DU12345", label: "Paper Trading", selected: true, is_paper: true }],
```

Add a `beforeEach` reset after importing `useAccountStore`:

```ts
import { useAccountStore } from "@/orbit/OrderTicket/useAccountStore";

beforeEach(() => {
  useAccountStore.setState({ accounts: [], selectedAccountId: null });
});
```

Keep the existing mock setup in the same `beforeEach` block.

- [ ] **Step 6: Run MoonMarket and account store tests**

Run:

```bash
npm run test -- src/orbit/OrderTicket/__tests__/useAccountStore.test.ts src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
```

Expected: pass.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add src/orbit/OrderTicket/useAccountStore.ts src/orbit/OrderTicket/__tests__/useAccountStore.test.ts src/modules/moonmarket/MoonMarketModule.tsx src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
git commit -m "feat: share MoonMarket selected account"
```

---

## Task 5: Add OrderTicket Store and Mutations

**Files:**

- Create: `src/orbit/OrderTicket/useOrderTicketStore.ts`
- Create: `src/orbit/OrderTicket/useOrderMutations.ts`
- Create: `src/orbit/OrderTicket/__tests__/useOrderTicketStore.test.ts`

- [ ] **Step 1: Write the order ticket store test**

Create `src/orbit/OrderTicket/__tests__/useOrderTicketStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useOrderTicketStore } from "../useOrderTicketStore";

describe("useOrderTicketStore", () => {
  beforeEach(() => {
    useOrderTicketStore.setState({ isOpen: false, target: null });
  });

  it("opens and closes around a conid target", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });

    expect(useOrderTicketStore.getState().isOpen).toBe(true);
    expect(useOrderTicketStore.getState().target).toEqual({ conid: 265598, symbol: "AAPL", side: "SELL" });

    useOrderTicketStore.getState().close();

    expect(useOrderTicketStore.getState().isOpen).toBe(false);
    expect(useOrderTicketStore.getState().target).toBeNull();
  });
});
```

- [ ] **Step 2: Run the store test and verify it fails**

Run:

```bash
npm run test -- src/orbit/OrderTicket/__tests__/useOrderTicketStore.test.ts
```

Expected: fails because `useOrderTicketStore` does not exist.

- [ ] **Step 3: Implement the ticket store**

Create `src/orbit/OrderTicket/useOrderTicketStore.ts`:

```ts
import { create } from "zustand";
import type { MoonMarketOrderDraft, MoonMarketOrderSide } from "@/lib/api";

export type OrderTicketTarget = {
  mode?: "create" | "modify";
  conid: number;
  symbol?: string;
  side?: MoonMarketOrderSide;
  orderId?: string;
  draft?: Partial<MoonMarketOrderDraft>;
};

type OrderTicketState = {
  isOpen: boolean;
  target: OrderTicketTarget | null;
  open: (target: OrderTicketTarget) => void;
  close: () => void;
};

export const useOrderTicketStore = create<OrderTicketState>()((set) => ({
  isOpen: false,
  target: null,
  open: (target) => set({ isOpen: true, target }),
  close: () => set({ isOpen: false, target: null }),
}));
```

- [ ] **Step 4: Add mutation hooks**

Create `src/orbit/OrderTicket/useOrderMutations.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type MoonMarketOrderDraft } from "@/lib/api";

export function usePreviewOrder() {
  return useMutation({
    mutationFn: (body: { account_id: string; order: MoonMarketOrderDraft }) =>
      api.moonmarketPreviewOrder(body),
  });
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { account_id: string; orders: MoonMarketOrderDraft[] }) =>
      api.moonmarketPlaceOrders(body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", variables.account_id] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "portfolio", variables.account_id] });
    },
  });
}

export function useReplyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { accountId: string; replyId: string; confirmed: boolean }) =>
      api.moonmarketReplyOrder(body.accountId, body.replyId, body.confirmed),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", variables.accountId] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "portfolio", variables.accountId] });
    },
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { accountId: string; orderId: string }) =>
      api.moonmarketCancelOrder(body.accountId, body.orderId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", variables.accountId] });
    },
  });
}

export function useModifyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { accountId: string; orderId: string; order: MoonMarketOrderDraft }) =>
      api.moonmarketModifyOrder(body.accountId, body.orderId, body.order),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", variables.accountId] });
    },
  });
}
```

- [ ] **Step 5: Run store test**

Run:

```bash
npm run test -- src/orbit/OrderTicket/__tests__/useOrderTicketStore.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add src/orbit/OrderTicket/useOrderTicketStore.ts src/orbit/OrderTicket/useOrderMutations.ts src/orbit/OrderTicket/__tests__/useOrderTicketStore.test.ts
git commit -m "feat: add shared order ticket state"
```

---

## Task 6: Build the Shared OrderTicket UI

**Files:**

- Create: `src/orbit/OrderTicket/OrderTicket.tsx`
- Create: `src/orbit/OrderTicket/OrderForm.tsx`
- Create: `src/orbit/OrderTicket/OrderResult.tsx`
- Create: `src/orbit/OrderTicket/index.ts`
- Create: `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`
- Modify: `src/orbit/OrbitProviders.tsx`

- [ ] **Step 1: Write the UI tests**

Create `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderTicket } from "../OrderTicket";
import { useAccountStore } from "../useAccountStore";
import { useOrderTicketStore } from "../useOrderTicketStore";

const mockApi = vi.hoisted(() => ({
  moonmarketPreviewOrder: vi.fn(),
  moonmarketPlaceOrders: vi.fn(),
  moonmarketReplyOrder: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mockApi,
}));

function renderTicket() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrderTicket />
    </QueryClientProvider>,
  );
}

describe("OrderTicket", () => {
  beforeEach(() => {
    mockApi.moonmarketPreviewOrder.mockReset();
    mockApi.moonmarketPlaceOrders.mockReset();
    mockApi.moonmarketReplyOrder.mockReset();
    mockApi.moonmarketPreviewOrder.mockResolvedValue({ account_id: "DU12345", result: { data: [{ amount: { total: "925.60" } }] } });
    mockApi.moonmarketPlaceOrders.mockResolvedValue({ account_id: "DU12345", result: { data: [{ id: "reply-1" }] } });
    mockApi.moonmarketReplyOrder.mockResolvedValue({ account_id: "DU12345", result: { data: [{ order_id: "order-1" }] } });
    useAccountStore.setState({
      accounts: [{ account_id: "DU12345", label: "Paper", selected: true, is_paper: true }],
      selectedAccountId: "DU12345",
    });
    useOrderTicketStore.setState({ isOpen: false, target: null });
  });

  it("renders nothing while closed", () => {
    renderTicket();
    expect(screen.queryByRole("dialog", { name: /order ticket/i })).not.toBeInTheDocument();
  });

  it("renders active symbol, paper badge, and bracket fields", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
    renderTicket();

    expect(screen.getByRole("dialog", { name: /order ticket/i })).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText(/paper/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/bracket order/i));
    expect(screen.getByLabelText(/profit taker price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/stop loss price/i)).toBeInTheDocument();
  });

  it("disables order mutations on a live account but leaves preview available", () => {
    useAccountStore.setState({
      accounts: [{ account_id: "U12345", label: "Live", selected: true, is_paper: false }],
      selectedAccountId: "U12345",
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL" });

    renderTicket();

    expect(screen.getByText(/live/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /place/i })).toBeDisabled();
  });

  it("previews and places an order for a paper account", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => expect(mockApi.moonmarketPreviewOrder).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run:

```bash
npm run test -- src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
```

Expected: fails because the UI components do not exist.

- [ ] **Step 3: Implement result display**

Create `src/orbit/OrderTicket/OrderResult.tsx`:

```tsx
type OrderResultProps = {
  previewResult: unknown;
  actionResult: unknown;
  replyId: string | null;
  onConfirm: (confirmed: boolean) => void;
  confirming: boolean;
  liveBlocked: boolean;
};

function stringifyResult(value: unknown): string {
  if (!value) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function OrderResult({ previewResult, actionResult, replyId, onConfirm, confirming, liveBlocked }: OrderResultProps) {
  return (
    <div className="space-y-3 border-t border-border p-4">
      {previewResult ? (
        <div className="rounded-md border border-border bg-[var(--bg-1)] p-3">
          <div className="text-[11px] font-semibold uppercase text-[var(--text-3)]">Preview</div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--text-2)]">
            {stringifyResult(previewResult)}
          </pre>
        </div>
      ) : null}
      {actionResult ? (
        <div className="rounded-md border border-border bg-[var(--bg-1)] p-3">
          <div className="text-[11px] font-semibold uppercase text-[var(--text-3)]">Result</div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--text-2)]">
            {stringifyResult(actionResult)}
          </pre>
        </div>
      ) : null}
      {replyId ? (
        <div className="flex gap-2 rounded-md border border-[var(--clr-orange)]/50 bg-[var(--clr-orange)]/10 p-3">
          <button
            type="button"
            onClick={() => onConfirm(true)}
            disabled={confirming || liveBlocked}
            className="rounded-md border border-[var(--clr-green)]/60 px-3 py-1 text-[11px] text-[var(--clr-green)] disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => onConfirm(false)}
            disabled={confirming}
            className="rounded-md border border-border px-3 py-1 text-[11px] text-[var(--text-2)] disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Implement form and bracket payload creation**

Create `src/orbit/OrderTicket/OrderForm.tsx` with these responsibilities:

```tsx
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { MoonMarketOrderDraft, MoonMarketOrderSide, MoonMarketOrderType, MoonMarketTimeInForce } from "@/lib/api";
import { useAccountStore } from "./useAccountStore";
import { useModifyOrder, usePlaceOrder, usePreviewOrder, useReplyOrder } from "./useOrderMutations";
import type { OrderTicketTarget } from "./useOrderTicketStore";
import { OrderResult } from "./OrderResult";

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resultData(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("result" in result)) return result;
  return (result as { result: unknown }).result;
}

function firstReplyId(result: unknown): string | null {
  const payload = resultData(result);
  const data = typeof payload === "object" && payload !== null && "data" in payload
    ? (payload as { data?: unknown }).data
    : null;
  if (!Array.isArray(data)) return null;
  const first = data[0];
  if (first && typeof first === "object" && "id" in first && typeof first.id === "string") {
    return first.id;
  }
  return null;
}

function newClientOrderId(): string {
  return `brkt-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

type OrderFormProps = {
  target: OrderTicketTarget;
};

export function OrderForm({ target }: OrderFormProps) {
  const selectedAccountId = useAccountStore((state) => state.selectedAccountId);
  const selectedAccount = useAccountStore((state) => state.selectedAccount());
  const [side, setSide] = useState<MoonMarketOrderSide>(target.side ?? "BUY");
  const [quantity, setQuantity] = useState("1");
  const [orderType, setOrderType] = useState<MoonMarketOrderType>("LMT");
  const [tif, setTif] = useState<MoonMarketTimeInForce>("DAY");
  const [price, setPrice] = useState("");
  const [auxPrice, setAuxPrice] = useState("");
  const [bracket, setBracket] = useState(false);
  const [profitTakerPrice, setProfitTakerPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [previewResult, setPreviewResult] = useState<unknown>(null);
  const [actionResult, setActionResult] = useState<unknown>(null);
  const [replyId, setReplyId] = useState<string | null>(null);

  const previewMutation = usePreviewOrder();
  const placeMutation = usePlaceOrder();
  const modifyMutation = useModifyOrder();
  const replyMutation = useReplyOrder();
  const liveBlocked = selectedAccount ? !selectedAccount.is_paper : true;

  useEffect(() => {
    setSide(target.side ?? "BUY");
    setQuantity(target.draft?.quantity ? String(target.draft.quantity) : "1");
    setOrderType(target.draft?.orderType ?? "LMT");
    setTif(target.draft?.tif ?? "DAY");
    setPrice(target.draft?.price ? String(target.draft.price) : "");
    setAuxPrice(target.draft?.auxPrice ? String(target.draft.auxPrice) : "");
    setPreviewResult(null);
    setActionResult(null);
    setReplyId(null);
  }, [target]);

  const baseOrder = useMemo<MoonMarketOrderDraft>(() => ({
    conid: target.conid,
    side,
    quantity: Number(quantity) || 0,
    orderType,
    tif,
    price: numberOrUndefined(price),
    auxPrice: numberOrUndefined(auxPrice),
  }), [auxPrice, orderType, price, quantity, side, target.conid, tif]);

  const buildOrders = (): MoonMarketOrderDraft[] => {
    if (!bracket) return [baseOrder];
    const profitPrice = numberOrUndefined(profitTakerPrice);
    const stopPrice = numberOrUndefined(stopLossPrice);
    if (!profitPrice || !stopPrice) {
      toast.error("Both bracket prices are required.");
      return [];
    }
    const parentId = newClientOrderId();
    const oppositeSide: MoonMarketOrderSide = side === "BUY" ? "SELL" : "BUY";
    return [
      { ...baseOrder, cOID: parentId },
      { conid: target.conid, parentId, side: oppositeSide, quantity: baseOrder.quantity, orderType: "LMT", tif: "GTC", price: profitPrice, isSingleGroup: true },
      { conid: target.conid, parentId, side: oppositeSide, quantity: baseOrder.quantity, orderType: "STP", tif: "GTC", price: stopPrice, isSingleGroup: true },
    ];
  };

  const handlePreview = () => {
    if (!selectedAccountId) return;
    previewMutation.mutate(
      { account_id: selectedAccountId, order: baseOrder },
      { onSuccess: (result) => setPreviewResult(result), onError: () => toast.error("Order preview failed.") },
    );
  };

  const handlePlace = () => {
    if (!selectedAccountId || liveBlocked) return;
    const orders = buildOrders();
    if (!orders.length) return;
    if (target.mode === "modify" && target.orderId) {
      modifyMutation.mutate(
        { accountId: selectedAccountId, orderId: target.orderId, order: orders[0] },
        {
          onSuccess: (result) => setActionResult(result),
          onError: () => toast.error("Order modification failed."),
        },
      );
      return;
    }
    placeMutation.mutate(
      { account_id: selectedAccountId, orders },
      {
        onSuccess: (result) => {
          setActionResult(result);
          setReplyId(firstReplyId(result));
        },
        onError: () => toast.error("Order placement failed."),
      },
    );
  };

  const handleConfirm = (confirmed: boolean) => {
    if (!selectedAccountId || !replyId) return;
    if (!confirmed) {
      setReplyId(null);
      return;
    }
    replyMutation.mutate(
      { accountId: selectedAccountId, replyId, confirmed },
      {
        onSuccess: (result) => {
          setActionResult(result);
          setReplyId(firstReplyId(result));
        },
        onError: () => toast.error("Order confirmation failed."),
      },
    );
  };

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => event.preventDefault()}>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-pressed={side === "BUY"} onClick={() => setSide("BUY")} className="rounded-md border border-border px-3 py-2 text-[12px]">BUY</button>
          <button type="button" aria-pressed={side === "SELL"} onClick={() => setSide("SELL")} className="rounded-md border border-border px-3 py-2 text-[12px]">SELL</button>
        </div>
        <label className="block text-[11px] text-[var(--text-3)]">
          Quantity
          <input aria-label="Quantity" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
        </label>
        <label className="block text-[11px] text-[var(--text-3)]">
          Order Type
          <select aria-label="Order Type" value={orderType} onChange={(event) => setOrderType(event.target.value as MoonMarketOrderType)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]">
            <option value="MKT">Market</option>
            <option value="LMT">Limit</option>
            <option value="STP">Stop</option>
            <option value="STP_LIMIT">Stop Limit</option>
          </select>
        </label>
        <label className="block text-[11px] text-[var(--text-3)]">
          TIF
          <select aria-label="TIF" value={tif} onChange={(event) => setTif(event.target.value as MoonMarketTimeInForce)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]">
            <option value="DAY">DAY</option>
            <option value="GTC">GTC</option>
            <option value="IOC">IOC</option>
          </select>
        </label>
        <label className="block text-[11px] text-[var(--text-3)]">
          Limit Price
          <input aria-label="Limit Price" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
        </label>
        <label className="block text-[11px] text-[var(--text-3)]">
          Aux Price
          <input aria-label="Aux Price" value={auxPrice} onChange={(event) => setAuxPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input aria-label="Bracket Order" type="checkbox" checked={bracket} onChange={(event) => setBracket(event.target.checked)} />
          Bracket order
        </label>
        {bracket ? (
          <div className="grid gap-3">
            <label className="block text-[11px] text-[var(--text-3)]">
              Profit Taker Price
              <input aria-label="Profit Taker Price" value={profitTakerPrice} onChange={(event) => setProfitTakerPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
            </label>
            <label className="block text-[11px] text-[var(--text-3)]">
              Stop Loss Price
              <input aria-label="Stop Loss Price" value={stopLossPrice} onChange={(event) => setStopLossPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
            </label>
          </div>
        ) : null}
      </div>
      {isLiveAccount ? <div className="border-t border-border px-4 py-2 text-[11px] text-[var(--clr-red)]">Live account — orders are sent with real money after confirmation.</div> : null}
      <div className="flex gap-2 border-t border-border p-4">
        <button type="button" onClick={handlePreview} disabled={!selectedAccountId || previewMutation.isPending} className="rounded-md border border-border px-3 py-2 text-[12px] disabled:opacity-50">Preview</button>
        <button type="button" onClick={handlePlace} disabled={!selectedAccountId || placeMutation.isPending || modifyMutation.isPending} className="rounded-md border border-[var(--clr-cyan)] px-3 py-2 text-[12px] text-[var(--clr-cyan)] disabled:opacity-50">
          {target.mode === "modify" ? "Modify" : "Place"}
        </button>
      </div>
      <OrderResult previewResult={previewResult} actionResult={actionResult} replyId={replyId} onConfirm={handleConfirm} confirming={replyMutation.isPending} liveBlocked={liveBlocked} />
    </form>
  );
}
```

- [ ] **Step 5: Implement the slide-over shell**

Create `src/orbit/OrderTicket/OrderTicket.tsx`:

```tsx
import { X } from "lucide-react";
import { useAccountStore } from "./useAccountStore";
import { OrderForm } from "./OrderForm";
import { useOrderTicketStore } from "./useOrderTicketStore";

export function OrderTicket() {
  const isOpen = useOrderTicketStore((state) => state.isOpen);
  const target = useOrderTicketStore((state) => state.target);
  const close = useOrderTicketStore((state) => state.close);
  const selectedAccount = useAccountStore((state) => state.selectedAccount());

  if (!isOpen || !target) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Order Ticket"
        className="flex h-full w-full max-w-[420px] flex-col border-l border-border bg-[var(--bg-2)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">Order Ticket</div>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="truncate text-[18px] font-semibold">{target.symbol ?? `#${target.conid}`}</h2>
              <span className="font-data text-[11px] text-[var(--text-3)]">#{target.conid}</span>
            </div>
            <span className={selectedAccount?.is_paper ? "mt-2 inline-flex rounded border border-[var(--clr-green)]/50 px-2 py-0.5 text-[10px] text-[var(--clr-green)]" : "mt-2 inline-flex rounded border border-[var(--clr-red)]/50 px-2 py-0.5 text-[10px] text-[var(--clr-red)]"}>
              {selectedAccount?.is_paper ? "PAPER" : "LIVE"}
            </span>
          </div>
          <button type="button" onClick={close} aria-label="Close order ticket" className="rounded-md border border-border p-1.5 text-[var(--text-3)] hover:text-[var(--text-1)]">
            <X className="h-4 w-4" />
          </button>
        </header>
        <OrderForm target={target} />
      </aside>
    </div>
  );
}
```

Create `src/orbit/OrderTicket/index.ts`:

```ts
export { OrderTicket } from "./OrderTicket";
export { useAccountStore } from "./useAccountStore";
export { useOrderTicketStore } from "./useOrderTicketStore";
export type { OrderTicketTarget } from "./useOrderTicketStore";
```

- [ ] **Step 6: Mount the ticket globally**

In `src/orbit/OrbitProviders.tsx`, import and render:

```tsx
import { OrderTicket } from "@/orbit/OrderTicket";
```

Inside `TooltipProvider`:

```tsx
{children}
<OrderTicket />
<Toaster />
```

- [ ] **Step 7: Run OrderTicket tests**

Run:

```bash
npm run test -- src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx src/orbit/OrderTicket/__tests__/useAccountStore.test.ts src/orbit/OrderTicket/__tests__/useOrderTicketStore.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit Task 6**

Run:

```bash
git add src/orbit/OrderTicket src/orbit/OrbitProviders.tsx
git commit -m "feat: add shared Orbit order ticket"
```

---

## Task 7: Add MoonMarket Portfolio Entry Points

**Files:**

- Modify: `src/modules/moonmarket/PortfolioPage.tsx`
- Modify: `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`

- [ ] **Step 1: Add failing MoonMarket entry tests**

In `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`, add mocks before importing `MoonMarketModule`:

```ts
const orderTicketState = vi.hoisted(() => ({ open: vi.fn() }));
const navigationState = vi.hoisted(() => ({ navigateToAnalysis: vi.fn() }));

vi.mock("@/orbit/OrderTicket", () => ({
  useOrderTicketStore: (selector: (state: typeof orderTicketState) => unknown) => selector(orderTicketState),
}));

vi.mock("@/store/navigation", () => ({
  useNavigationStore: (selector: (state: typeof navigationState) => unknown) => selector(navigationState),
}));
```

Add a test:

```tsx
it("opens the ticket and Parallax analysis from the selected position inspector", async () => {
  renderMoonMarket();

  await screen.findByTestId("moonmarket-chart-treemap");
  fireEvent.click(screen.getByRole("button", { name: /select apple/i }));
  fireEvent.click(screen.getByRole("button", { name: /trade apple/i }));

  expect(orderTicketState.open).toHaveBeenCalledWith({ conid: 265598, symbol: "AAPL", side: "SELL" });

  fireEvent.click(screen.getByRole("button", { name: /analyze apple/i }));
  expect(navigationState.navigateToAnalysis).toHaveBeenCalledWith(265598, "AAPL");
  expect(routerState.navigate).toHaveBeenCalledWith("/parallax");
});
```

Reset the two new mocks in `beforeEach`.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run test -- src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
```

Expected: fails because the buttons do not exist.

- [ ] **Step 3: Add PortfolioPage entry actions**

In `src/modules/moonmarket/PortfolioPage.tsx`:

- Import `useNavigate`, `useOrderTicketStore`, `useNavigationStore`, and lucide icons:

```ts
import { BarChart3, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useOrderTicketStore } from "@/orbit/OrderTicket";
import { useNavigationStore } from "@/store/navigation";
```

- Extend `PositionInspector` props:

```ts
function PositionInspector({
  position,
  allocation,
  onTrade,
  onAnalyze,
}: {
  position?: MoonMarketPosition;
  allocation?: MoonMarketAllocationItem;
  onTrade: (position: MoonMarketPosition) => void;
  onAnalyze: (position: MoonMarketPosition) => void;
}) {
```

- Add buttons in the selected-position header:

```tsx
<div className="flex flex-wrap gap-2">
  <button
    type="button"
    aria-label={`Trade ${position.symbol}`}
    onClick={() => onTrade(position)}
    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--clr-cyan)]/60 px-2.5 text-[11px] text-[var(--clr-cyan)] hover:bg-[var(--clr-cyan)]/10"
  >
    <ShoppingCart className="h-3.5 w-3.5" />
    Trade
  </button>
  <button
    type="button"
    aria-label={`Analyze ${position.symbol}`}
    onClick={() => onAnalyze(position)}
    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-[var(--text-2)] hover:border-[var(--clr-green)] hover:text-[var(--clr-green)]"
  >
    <BarChart3 className="h-3.5 w-3.5" />
    Analyze
  </button>
</div>
```

- Inside `PortfolioPage`, add handlers:

```ts
const navigate = useNavigate();
const openOrderTicket = useOrderTicketStore((state) => state.open);
const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);

const handleTrade = (position: MoonMarketPosition) => {
  openOrderTicket({ conid: position.conid, symbol: position.symbol, side: "SELL" });
};

const handleAnalyze = (position: MoonMarketPosition) => {
  navigateToAnalysis(position.conid, position.symbol);
  navigate("/parallax");
};
```

- Pass handlers into `PositionInspector`:

```tsx
<PositionInspector
  position={selectedPosition}
  allocation={selectedAllocation}
  onTrade={handleTrade}
  onAnalyze={handleAnalyze}
/>
```

- [ ] **Step 4: Run MoonMarket tests**

Run:

```bash
npm run test -- src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit Task 7**

Run:

```bash
git add src/modules/moonmarket/PortfolioPage.tsx src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
git commit -m "feat: add MoonMarket order entry points"
```

---

## Task 8: Add Live Order Cancel and Modify Actions

**Files:**

- Modify: `src/modules/moonmarket/TransactionsPage.tsx`
- Modify: `src/modules/moonmarket/LiveOrdersTable.tsx`
- Modify: `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`

- [ ] **Step 1: Add failing live-order action tests**

In `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`, extend `mockApi`:

```ts
moonmarketCancelOrder: vi.fn(),
moonmarketModifyOrder: vi.fn(),
```

In `beforeEach`, add:

```ts
mockApi.moonmarketCancelOrder.mockResolvedValue({ account_id: "DU12345", result: { status: "cancelled" } });
mockApi.moonmarketModifyOrder.mockResolvedValue({ account_id: "DU12345", result: { status: "modified" } });
```

Replace the old assertions that cancel/modify buttons are absent with:

```tsx
expect(screen.getByRole("button", { name: /modify aapl order/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /cancel aapl order/i })).toBeInTheDocument();
```

Add this test:

```tsx
it("cancels and opens modify mode from the live orders table", async () => {
  renderMoonMarket("/moonmarket/transactions");

  fireEvent.click(await screen.findByRole("button", { name: /live orders/i }));
  fireEvent.click(await screen.findByRole("button", { name: /modify aapl order/i }));

  expect(orderTicketState.open).toHaveBeenCalledWith({
    mode: "modify",
    orderId: "123456789",
    conid: 265598,
    symbol: "AAPL",
    side: "BUY",
    draft: { conid: 265598, side: "BUY", quantity: 5, orderType: "LMT", tif: "DAY", price: 180 },
  });

  fireEvent.click(screen.getByRole("button", { name: /cancel aapl order/i }));
  await waitFor(() => expect(mockApi.moonmarketCancelOrder).toHaveBeenCalledWith("DU12345", "123456789"));
});
```

Add `waitFor` to the Testing Library import if it is not present.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run test -- src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
```

Expected: fails because the live orders table still has no cancel/modify actions.

- [ ] **Step 3: Pass account id into LiveOrdersTable**

In `src/modules/moonmarket/TransactionsPage.tsx`, change the live orders render:

```tsx
{tab === "trades" ? (
  <TransactionsTable trades={trades} />
) : (
  <LiveOrdersTable accountId={accountId} orders={orders} />
)}
```

Update the subheading text:

```tsx
Recent executions and working orders for the selected account.
```

- [ ] **Step 4: Add actions to LiveOrdersTable**

In `src/modules/moonmarket/LiveOrdersTable.tsx`, update imports:

```ts
import { Pencil, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { MoonMarketOrderDraft, MoonMarketOrderSide, MoonMarketOrderType } from "@/lib/api";
import { useAccountStore, useOrderTicketStore } from "@/orbit/OrderTicket";
import { useCancelOrder } from "@/orbit/OrderTicket/useOrderMutations";
```

Add helpers above the component:

```ts
function normalizeSide(side: string): MoonMarketOrderSide {
  return side.toUpperCase().includes("SELL") || side.toUpperCase() === "SLD" ? "SELL" : "BUY";
}

function normalizeOrderType(orderType: string | null): MoonMarketOrderType {
  const normalized = orderType?.toUpperCase();
  if (normalized === "MKT" || normalized === "LMT" || normalized === "STP" || normalized === "STP_LIMIT" || normalized === "TRAIL") {
    return normalized;
  }
  return "LMT";
}

function orderDraft(order: MoonMarketLiveOrder): MoonMarketOrderDraft | null {
  if (!order.conid || !order.quantity) return null;
  return {
    conid: order.conid,
    side: normalizeSide(order.side),
    quantity: order.quantity,
    orderType: normalizeOrderType(order.order_type),
    tif: "DAY",
    price: order.limit_price ?? undefined,
  };
}
```

Change the component signature and add hooks:

```tsx
export function LiveOrdersTable({ accountId, orders }: { accountId: string | null; orders: MoonMarketLiveOrder[] }) {
  const selectedAccount = useAccountStore((state) => state.selectedAccount());
  const openOrderTicket = useOrderTicketStore((state) => state.open);
  const cancelMutation = useCancelOrder();
  const liveBlocked = selectedAccount ? !selectedAccount.is_paper : true;

  const cancelOrder = (order: MoonMarketLiveOrder) => {
    if (!accountId || liveBlocked) return;
    cancelMutation.mutate(
      { accountId, orderId: order.order_id },
      { onSuccess: () => toast.success("Order cancelled."), onError: () => toast.error("Cancel failed.") },
    );
  };

  const modifyOrder = (order: MoonMarketLiveOrder) => {
    const draft = orderDraft(order);
    if (!draft || !order.conid) return;
    openOrderTicket({
      mode: "modify",
      orderId: order.order_id,
      conid: order.conid,
      symbol: order.symbol ?? undefined,
      side: draft.side,
      draft,
    });
  };
```

Add an actions header cell after Status:

```tsx
<th className="px-3 py-2 text-right font-medium">Actions</th>
```

Add an actions cell in each row:

```tsx
<td className="px-3 py-2">
  <div className="flex justify-end gap-2">
    <button
      type="button"
      aria-label={`Modify ${order.symbol ?? order.order_id} order`}
      onClick={() => modifyOrder(order)}
      disabled={liveBlocked || !orderDraft(order)}
      className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[10px] text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-40"
    >
      <Pencil className="h-3 w-3" />
      Modify
    </button>
    <button
      type="button"
      aria-label={`Cancel ${order.symbol ?? order.order_id} order`}
      onClick={() => cancelOrder(order)}
      disabled={liveBlocked || !accountId || cancelMutation.isPending}
      className="inline-flex h-7 items-center gap-1 rounded border border-[var(--clr-red)]/50 px-2 text-[10px] text-[var(--clr-red)] hover:bg-[var(--clr-red)]/10 disabled:opacity-40"
    >
      <XCircle className="h-3 w-3" />
      Cancel
    </button>
  </div>
</td>
```

- [ ] **Step 5: Run MoonMarket tests**

Run:

```bash
npm run test -- src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit Task 8**

Run:

```bash
git add src/modules/moonmarket/TransactionsPage.tsx src/modules/moonmarket/LiveOrdersTable.tsx src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
git commit -m "feat: add live order actions"
```

---

## Task 9: Add Parallax Analysis Entry Points

**Files:**

- Modify: `src/pages/AnalysisPage.tsx`
- Create or modify: `src/pages/__tests__/AnalysisPage.test.tsx`

- [ ] **Step 1: Write AnalysisPage entry tests**

If `src/pages/__tests__/AnalysisPage.test.tsx` does not exist, create it with existing page mocks from nearby AnalysisPage tests. Add this assertion:

```tsx
it("opens the shared order ticket and navigates to MoonMarket portfolio", async () => {
  render(<AnalysisPage />);

  fireEvent.click(screen.getByRole("button", { name: /trade/i }));
  expect(orderTicketState.open).toHaveBeenCalledWith({ conid: 265598, symbol: "AAPL" });

  fireEvent.click(screen.getByRole("button", { name: /view portfolio/i }));
  expect(routerState.navigate).toHaveBeenCalledWith("/moonmarket/portfolio");
});
```

Use these mocks in that test file:

```ts
const orderTicketState = vi.hoisted(() => ({ open: vi.fn() }));
const routerState = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@/orbit/OrderTicket", () => ({
  useOrderTicketStore: (selector: (state: typeof orderTicketState) => unknown) => selector(orderTicketState),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => routerState.navigate,
}));
```

Mock `useChartStore` so `activeConid` is `265598`, `activeSymbol` is `AAPL`, and the rest of the page has the minimum state it needs to render. If the existing page test already has this harness, extend it instead of creating a second harness.

- [ ] **Step 2: Run the AnalysisPage test and verify it fails**

Run:

```bash
npm run test -- src/pages/__tests__/AnalysisPage.test.tsx
```

Expected: fails because the toolbar buttons do not exist.

- [ ] **Step 3: Add Parallax toolbar buttons**

In `src/pages/AnalysisPage.tsx`:

- Import `useNavigate`, `BriefcaseBusiness`, and `ShoppingCart`:

```ts
import { useNavigate } from "react-router-dom";
import { RotateCcw, ChevronLeft, GitCompare, BriefcaseBusiness, ShoppingCart } from "lucide-react";
import { useOrderTicketStore } from "@/orbit/OrderTicket";
```

- Inside `AnalysisPage`, add:

```ts
const navigate = useNavigate();
const openOrderTicket = useOrderTicketStore((state) => state.open);

const handleTrade = () => {
  if (!activeConid) return;
  openOrderTicket({ conid: activeConid, symbol: activeSymbol || undefined });
};

const handleViewPortfolio = () => {
  navigate("/moonmarket/portfolio");
};
```

- Add buttons in the toolbar after the company name badge and before `IndicatorToolbar`:

```tsx
<div className="mx-1 h-5 w-px bg-[var(--border)]" />
<button
  type="button"
  onClick={handleTrade}
  disabled={!activeConid}
  className="flex items-center gap-1 rounded-full border border-[var(--clr-cyan)]/60 px-2.5 py-1 font-data text-[10px] font-medium text-[var(--clr-cyan)] transition-all hover:bg-[var(--clr-cyan)]/10 disabled:opacity-40"
>
  <ShoppingCart size={12} /> Trade
</button>
<button
  type="button"
  onClick={handleViewPortfolio}
  className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 font-data text-[10px] font-medium text-[var(--text-3)] transition-all hover:border-[var(--clr-green)] hover:text-[var(--clr-green)]"
>
  <BriefcaseBusiness size={12} /> View Portfolio
</button>
```

- [ ] **Step 4: Run AnalysisPage tests**

Run:

```bash
npm run test -- src/pages/__tests__/AnalysisPage.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit Task 9**

Run:

```bash
git add src/pages/AnalysisPage.tsx src/pages/__tests__/AnalysisPage.test.tsx
git commit -m "feat: add Parallax order entry points"
```

---

## Task 10: End-to-End Verification and Cleanup

**Files:**

- Verify all files changed in Tasks 1 through 8.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
cd backend
uv run python -m pytest tests/test_orders_router.py tests/test_moonmarket_router.py tests/test_ibkr_pacing.py -q
```

Expected: pass.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
npm run test -- src/lib/api.moonmarket.test.ts src/orbit/OrderTicket/__tests__/useAccountStore.test.ts src/orbit/OrderTicket/__tests__/useOrderTicketStore.test.ts src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx src/pages/__tests__/AnalysisPage.test.tsx
```

Expected: pass.

- [ ] **Step 3: Run build checks**

Run:

```bash
npx vite build
npm run typecheck
```

Expected:

- `npx vite build` passes.
- `npm run typecheck` either passes or reports only pre-existing unrelated baseline errors. No new errors may mention `OrderTicket`, `MoonMarketModule`, `PortfolioPage`, `AnalysisPage`, or `src/lib/api.ts`.

- [ ] **Step 4: Run backend full tests when time permits**

Run:

```bash
cd backend
uv run python -m pytest -q
```

Expected: pass. If an unrelated baseline failure appears, capture the failing test names and confirm `tests/test_orders_router.py` still passes.

- [ ] **Step 5: Manual UI smoke test**

Run the app:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173/moonmarket
```

Smoke path:

1. Select a holding in the allocation chart.
2. Confirm the selected-position inspector still appears and no duplicate holdings table returns.
3. Click Trade.
4. Confirm the OrderTicket slides in from the right with the selected symbol/conid.
5. Switch the shared account selector to a paper account and confirm the ticket shows PAPER.
6. Switch to a live account and confirm the ticket shows LIVE and opens the real-money confirmation before mutation calls.
7. Click Analyze from the inspector and confirm the app navigates to `/parallax` with the same conid in analysis.
8. From Parallax Analysis, click Trade and confirm the same shared ticket opens.
9. From Parallax Analysis, click View Portfolio and confirm the app navigates to `/moonmarket/portfolio`.
10. Open MoonMarket Transactions, switch to Live Orders, and confirm paper accounts show enabled Cancel/Modify controls while live accounts disable those controls.

- [ ] **Step 6: Review the implementation against the spec**

Check:

- Reply endpoint is `POST /moonmarket/orders/{accountId}/reply/{replyId}`.
- Preview is allowed for live and paper accounts.
- Place, reply, cancel, and modify evaluate Trading Safety before the server forwards to IBKR.
- MoonMarket uses `useAccountStore`; no local selected-account state remains in `MoonMarketModule`.
- `src/lib/api.ts` contains raw methods only; TanStack Query mutations live in `src/orbit/OrderTicket/useOrderMutations.ts`.
- The OrderTicket is mounted once in `OrbitProviders`.
- MoonMarket keeps the inspector pattern and does not reintroduce `HistoricalDataCard` or a duplicate holdings table.

- [ ] **Step 7: Commit final cleanup if needed**

If verification required small fixes, commit them:

```bash
git add backend src docs
git commit -m "fix: polish Orbit order ticket integration"
```

- [ ] **Step 8: Prepare for review**

Run:

```bash
git status --short
git log --oneline --decorate -8
```

Expected: working tree is clean and the branch contains the task commits above.

---

## Completion Criteria

- Backend tests prove paper/live account detection, live mutation allowance, and Trading Safety rejection paths.
- Frontend tests prove account store hydration, ticket open/close, live badge behavior, bracket field display, and module entry buttons.
- MoonMarket and OrderTicket share one selected account.
- The ticket is global, right-side, and mounted once.
- MoonMarket to Parallax navigation passes only conid and symbol.
- Parallax to MoonMarket navigation lands on the portfolio.
- Live accounts can place, confirm, cancel, and modify orders through the API after Trading Safety policy evaluation.
- Live Orders rows provide the cancel/modify surface for working orders; Portfolio keeps the approved chart plus inspector layout.
