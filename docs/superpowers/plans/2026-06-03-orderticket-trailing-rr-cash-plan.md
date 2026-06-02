# OrderTicket Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add IBKR-native trailing stops (`TRAIL`/`TRAILLMT`), an outside-RTH flag, plain-English labels, a risk/reward readout, and dollar-based cash sizing to the MoonMarket OrderTicket.

**Architecture:** Backend gains two new draft fields (`trailing_type`, `trailing_amt`), an `outside_rth` flag, the `TRAILLMT` order type, plus payload serialization and validation. Frontend mirrors the types, extracts two pure helper modules (`labels.ts`, `orderMath.ts`) for testability, and wires new controls into the existing `OrderForm.tsx`. Cash sizing and R/R are front-end only — IBKR still receives share quantities.

**Tech Stack:** Python 3 / FastAPI / Pydantic v2 / pytest (backend); React 19 / TypeScript / Zustand / TanStack Query / Vitest + Testing Library (frontend).

**Branch:** `feature/orderticket-trailing-rr-cash` (already created off `dev`). The design spec lives at `docs/superpowers/specs/2026-06-03-orderticket-trailing-rr-cash-design.md`.

**Buying power:** "% of buying power" sizing is included. Buying power (which exceeds cash for margin accounts) is fetched from IBKR `GET /portfolio/{accountId}/summary` via a new read-only `GET /moonmarket/accounts/{accountId}/funds` endpoint (Task 2b). The exact summary field shape (`{amount, currency}` under keys like `buyingpower`/`availablefunds`/`totalcashvalue`) is confirmed against a live paper response during Task 2b; the parser tries multiple key spellings like the existing ledger parser.

---

## Task 1: Backend — order model fields, types, and validation

**Files:**
- Modify: `backend/models/__init__.py:315-335`
- Test: `backend/tests/test_orders_model.py` (Create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_orders_model.py`:

```python
import pytest
from pydantic import ValidationError

from models import MoonMarketOrderDraft


def test_trail_requires_trailing_fields():
    with pytest.raises(ValidationError):
        MoonMarketOrderDraft(
            conid=265598, side="SELL", quantity=5, orderType="TRAIL", tif="GTC"
        )


def test_trail_accepts_trailing_fields():
    order = MoonMarketOrderDraft(
        conid=265598,
        side="SELL",
        quantity=5,
        orderType="TRAIL",
        tif="GTC",
        trailingType="%",
        trailingAmt=5,
    )
    assert order.trailing_type == "%"
    assert order.trailing_amt == 5
    assert order.outside_rth is False


def test_traillmt_requires_price():
    with pytest.raises(ValidationError):
        MoonMarketOrderDraft(
            conid=265598,
            side="SELL",
            quantity=5,
            orderType="TRAILLMT",
            tif="GTC",
            trailingType="amt",
            trailingAmt=2,
        )


def test_traillmt_accepts_price_and_outside_rth():
    order = MoonMarketOrderDraft(
        conid=265598,
        side="SELL",
        quantity=5,
        orderType="TRAILLMT",
        tif="GTC",
        trailingType="amt",
        trailingAmt=2,
        price=178.0,
        outsideRTH=True,
    )
    assert order.price == 178.0
    assert order.outside_rth is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_orders_model.py -v`
Expected: FAIL — `MoonMarketOrderDraft` rejects unknown kwargs `trailingType`/`trailingAmt`/`outsideRTH`, or `TRAILLMT` not a valid `orderType`.

- [ ] **Step 3: Write minimal implementation**

In `backend/models/__init__.py`, update the order type literal and the draft model. Replace lines 315-335:

```python
OrderSide = Literal["BUY", "SELL"]
OrderType = Literal["MKT", "LMT", "STP", "STP_LIMIT", "TRAIL", "TRAILLMT"]
TimeInForce = Literal["DAY", "GTC", "IOC"]
OrderAssetClass = Literal["STK", "OPT"]
TrailingType = Literal["amt", "%"]


class MoonMarketOrderDraft(BaseModel):
    """One normalized order request accepted by Orbit."""
    conid: int
    asset_class: OrderAssetClass = Field(default="STK", alias="assetClass")
    side: OrderSide
    quantity: float = Field(gt=0)
    order_type: OrderType = Field(alias="orderType")
    tif: TimeInForce = "DAY"
    price: Optional[float] = Field(default=None, gt=0)
    aux_price: Optional[float] = Field(default=None, alias="auxPrice", gt=0)
    trailing_type: Optional[TrailingType] = Field(default=None, alias="trailingType")
    trailing_amt: Optional[float] = Field(default=None, alias="trailingAmt", gt=0)
    outside_rth: bool = Field(default=False, alias="outsideRTH")
    client_order_id: Optional[str] = Field(default=None, alias="cOID")
    parent_id: Optional[str] = Field(default=None, alias="parentId")
    is_single_group: bool = Field(default=False, alias="isSingleGroup")

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _validate_trailing(self) -> "MoonMarketOrderDraft":
        if self.order_type in ("TRAIL", "TRAILLMT"):
            if self.trailing_amt is None or self.trailing_type is None:
                raise ValueError("Trailing orders require trailingAmt and trailingType")
            if self.order_type == "TRAILLMT" and self.price is None:
                raise ValueError("TRAILLMT orders require a limit price")
        return self
```

Ensure `model_validator` is imported. At the top of `backend/models/__init__.py` the pydantic import line should include it — add `model_validator` if absent:

```python
from pydantic import BaseModel, ConfigDict, Field, model_validator
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_orders_model.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/models/__init__.py backend/tests/test_orders_model.py
git commit -m "feat: add trailing-stop and outside-RTH fields to order draft model"
```

---

## Task 2: Backend — serialize trailing + RTH fields in the IBKR payload

**Files:**
- Modify: `backend/services/orders.py:93-111`
- Test: `backend/tests/test_orders_router.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_orders_router.py` (after the existing tests; reuses the module's `_FakeIbkr` and `_client`):

```python
def _trail_order(conid: int = 265598) -> dict:
    return {
        "conid": conid,
        "side": "SELL",
        "quantity": 5,
        "orderType": "TRAIL",
        "tif": "GTC",
        "trailingType": "%",
        "trailingAmt": 5,
        "outsideRTH": True,
    }


def _traillmt_order(conid: int = 265598) -> dict:
    return {
        "conid": conid,
        "side": "SELL",
        "quantity": 5,
        "orderType": "TRAILLMT",
        "tif": "GTC",
        "trailingType": "amt",
        "trailingAmt": 2,
        "price": 178.0,
    }


def test_place_trail_order_serializes_trailing_and_rth_fields():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": [_trail_order()]},
    )

    assert resp.status_code == 200
    sent = fake.requests[-1][2]["json"]["orders"][0]
    assert sent["orderType"] == "TRAIL"
    assert sent["trailingType"] == "%"
    assert sent["trailingAmt"] == 5
    assert sent["outsideRTH"] is True
    assert "price" not in sent


def test_place_traillmt_order_includes_limit_price():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": [_traillmt_order()]},
    )

    assert resp.status_code == 200
    sent = fake.requests[-1][2]["json"]["orders"][0]
    assert sent["orderType"] == "TRAILLMT"
    assert sent["price"] == 178.0
    assert sent["trailingType"] == "amt"
    assert sent["trailingAmt"] == 2
    assert sent["outsideRTH"] is False or "outsideRTH" not in sent
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_orders_router.py -k "trail" -v`
Expected: FAIL — `trailingType`/`trailingAmt`/`outsideRTH` missing from the serialized payload (`KeyError`).

- [ ] **Step 3: Write minimal implementation**

In `backend/services/orders.py`, update `_order_payload` (replace lines 93-111):

```python
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
        if order.trailing_type is not None:
            payload["trailingType"] = order.trailing_type
        if order.trailing_amt is not None:
            payload["trailingAmt"] = order.trailing_amt
        if order.outside_rth:
            payload["outsideRTH"] = True
        if order.client_order_id is not None:
            payload["cOID"] = order.client_order_id
        if order.parent_id is not None:
            payload["parentId"] = order.parent_id
        if order.is_single_group:
            payload["isSingleGroup"] = True
        return payload
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_orders_router.py -v`
Expected: PASS (all existing tests + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add backend/services/orders.py backend/tests/test_orders_router.py
git commit -m "feat: serialize trailing-stop and outside-RTH fields in IBKR order payload"
```

---

## Task 2b: Backend — account funds endpoint (buying power)

**Files:**
- Modify: `backend/models/__init__.py` (add `MoonMarketAccountFunds`, near the other MoonMarket account models ~line 137-148 of types is frontend; backend account models live alongside `MoonMarketAccountsResponse`)
- Modify: `backend/services/moonmarket.py` (add `account_funds` method + a `_summary_amount` helper)
- Modify: `backend/routers/moonmarket.py:25-29` (add the route after `/accounts`)
- Test: `backend/tests/test_moonmarket_funds.py` (Create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_moonmarket_funds.py`:

```python
import pytest

from services.moonmarket import MoonMarketService


class _FakeIbkr:
    def __init__(self, summary: dict) -> None:
        self._summary = summary
        self.calls: list[str] = []

    async def ensure_accounts(self) -> None:
        return None

    async def brokerage_accounts(self) -> list[dict]:
        return [{"id": "DU123", "accountId": "DU123", "isPaper": True, "selected": True}]

    async def _request(self, method: str, endpoint: str, **kwargs):
        self.calls.append(endpoint)
        return self._summary


@pytest.mark.asyncio
async def test_account_funds_parses_buying_power_from_summary():
    summary = {
        "buyingpower": {"amount": 40000.0, "currency": "USD"},
        "availablefunds": {"amount": 10000.0, "currency": "USD"},
        "totalcashvalue": {"amount": 10000.0, "currency": "USD"},
    }
    service = MoonMarketService(_FakeIbkr(summary))

    funds = await service.account_funds("DU123")

    assert funds.account_id == "DU123"
    assert funds.buying_power == 40000.0
    assert funds.available_funds == 10000.0
    assert funds.cash == 10000.0
    assert funds.currency == "USD"


@pytest.mark.asyncio
async def test_account_funds_handles_flat_numeric_values():
    summary = {"buyingpower": 25000.0, "availablefunds": 5000.0, "totalcashvalue": 5000.0}
    service = MoonMarketService(_FakeIbkr(summary))

    funds = await service.account_funds("DU123")

    assert funds.buying_power == 25000.0
    assert funds.available_funds == 5000.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_moonmarket_funds.py -v`
Expected: FAIL — `MoonMarketService` has no `account_funds`, and `MoonMarketAccountFunds` is undefined.

- [ ] **Step 3: Add the model**

In `backend/models/__init__.py`, after `MoonMarketAccountsResponse` (search for `class MoonMarketAccountsResponse`) add:

```python
class MoonMarketAccountFunds(BaseModel):
    """Normalized buying-power / cash snapshot for one account."""
    account_id: str
    buying_power: Optional[float] = None
    available_funds: Optional[float] = None
    cash: Optional[float] = None
    currency: str = "USD"
```

- [ ] **Step 4: Add the service method**

In `backend/services/moonmarket.py`, add the import to the models import block (the `from models import (...)` group):

```python
    MoonMarketAccountFunds,
```

Then add this method to `MoonMarketService` (near `_fetch_cash_position`, ~line 238):

```python
    async def account_funds(self, account_id: str) -> MoonMarketAccountFunds:
        resolved = await self._resolve_account_id(account_id)
        payload = await self.ibkr._request("GET", f"/portfolio/{resolved}/summary")
        summary = payload if isinstance(payload, dict) else {}
        return MoonMarketAccountFunds(
            account_id=resolved,
            buying_power=self._summary_amount(summary, ("buyingpower", "buyingPower")),
            available_funds=self._summary_amount(summary, ("availablefunds", "availableFunds")),
            cash=self._summary_amount(summary, ("totalcashvalue", "totalCashValue", "cashbalance")),
            currency=self._summary_currency(summary),
        )

    @staticmethod
    def _summary_amount(summary: dict[str, Any], keys: tuple[str, ...]) -> Optional[float]:
        for key in keys:
            value = summary.get(key)
            if isinstance(value, dict):
                value = value.get("amount")
            if isinstance(value, (int, float)):
                return float(value)
        return None

    @staticmethod
    def _summary_currency(summary: dict[str, Any]) -> str:
        for key in ("buyingpower", "availablefunds", "totalcashvalue"):
            value = summary.get(key)
            if isinstance(value, dict) and isinstance(value.get("currency"), str):
                return value["currency"]
        return "USD"
```

Note: if `Optional` / `Any` are not already imported in `moonmarket.py`, add them to its `typing` import. (`_optional_float` already uses Optional-style returns; confirm the import line includes `Any` and `Optional`.)

- [ ] **Step 5: Add the route**

In `backend/routers/moonmarket.py`, add the import to the models import line:

```python
from models import MoonMarketAccountFunds  # add alongside existing model imports
```

And add the endpoint after the `/accounts` route (line 29):

```python
@router.get("/accounts/{account_id}/funds", response_model=MoonMarketAccountFunds)
async def moonmarket_account_funds(
    account_id: str,
    ibkr=Depends(require_ibkr_auth),
) -> MoonMarketAccountFunds:
    try:
        return await MoonMarketService(ibkr).account_funds(account_id)
    except MoonMarketAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
```

(Match the exact `Depends`/`HTTPException` import style already used in this router — reuse the existing imports; do not add duplicates.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_moonmarket_funds.py -v`
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**

```bash
git add backend/models/__init__.py backend/services/moonmarket.py backend/routers/moonmarket.py backend/tests/test_moonmarket_funds.py
git commit -m "feat: add account funds endpoint exposing IBKR buying power"
```

---

## Task 3: Frontend — mirror order types, draft fields, and funds client

**Files:**
- Modify: `src/lib/api.ts:252-268` (types) and `src/lib/api.ts:1242-1244` (api client, near `moonmarketAccounts`)

- [ ] **Step 1: Update the types**

In `src/lib/api.ts`, replace lines 252 and the `MoonMarketOrderDraft` interface (252-268):

```typescript
export type MoonMarketOrderType = "MKT" | "LMT" | "STP" | "STP_LIMIT" | "TRAIL" | "TRAILLMT";
export type MoonMarketTimeInForce = "DAY" | "GTC" | "IOC";
export type MoonMarketTrailingType = "amt" | "%";
export type MoonMarketOrderAssetClass = "STK" | "OPT";

export interface MoonMarketOrderDraft {
  conid: number;
  assetClass?: MoonMarketOrderAssetClass;
  side: MoonMarketOrderSide;
  quantity: number;
  orderType: MoonMarketOrderType;
  tif: MoonMarketTimeInForce;
  price?: number;
  auxPrice?: number;
  trailingType?: MoonMarketTrailingType;
  trailingAmt?: number;
  outsideRTH?: boolean;
  cOID?: string;
  parentId?: string;
  isSingleGroup?: boolean;
}

export interface MoonMarketAccountFunds {
  account_id: string;
  buying_power: number | null;
  available_funds: number | null;
  cash: number | null;
  currency: string;
}
```

(Note: `MoonMarketOrderSide` on line 251 is unchanged; keep it.)

- [ ] **Step 2: Add the api client method**

In `src/lib/api.ts`, in the `api` object's MoonMarket section (after `moonmarketAccounts`, ~line 1244):

```typescript
  moonmarketAccountFunds: (accountId: string, signal?: AbortSignal) =>
    request<MoonMarketAccountFunds>(
      "GET",
      `/moonmarket/accounts/${encodeURIComponent(accountId)}/funds`,
      undefined,
      signal,
    ),
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors (new optional fields don't break existing call sites).

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add TRAILLMT, trailing/RTH fields, and account-funds client"
```

---

## Task 4: Frontend — pure helpers for labels, R/R, and cash sizing

**Files:**
- Create: `src/orbit/OrderTicket/labels.ts`
- Create: `src/orbit/OrderTicket/orderMath.ts`
- Test: `src/orbit/OrderTicket/__tests__/orderMath.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `src/orbit/OrderTicket/__tests__/orderMath.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeRiskReward, sharesForCash, cashForBuyingPowerPct } from "../orderMath";
import { ORDER_TYPE_LABELS, TIF_LABELS } from "../labels";

describe("computeRiskReward", () => {
  it("computes ratio for a long position", () => {
    const rr = computeRiskReward({ side: "BUY", entry: 100, takeProfit: 130, stopLoss: 90 });
    expect(rr).not.toBeNull();
    expect(rr!.risk).toBeCloseTo(10);
    expect(rr!.reward).toBeCloseTo(30);
    expect(rr!.ratio).toBeCloseTo(3);
  });

  it("computes ratio for a short position", () => {
    const rr = computeRiskReward({ side: "SELL", entry: 100, takeProfit: 80, stopLoss: 110 });
    expect(rr).not.toBeNull();
    expect(rr!.risk).toBeCloseTo(10);
    expect(rr!.reward).toBeCloseTo(20);
    expect(rr!.ratio).toBeCloseTo(2);
  });

  it("returns null when inputs are incomplete", () => {
    expect(computeRiskReward({ side: "BUY", entry: undefined, takeProfit: 130, stopLoss: 90 })).toBeNull();
  });

  it("returns null when risk is non-positive (stop on wrong side)", () => {
    expect(computeRiskReward({ side: "BUY", entry: 100, takeProfit: 130, stopLoss: 110 })).toBeNull();
  });
});

describe("sharesForCash", () => {
  it("floors cash divided by reference price", () => {
    expect(sharesForCash(1000, 180)).toBe(5);
  });

  it("returns null when reference price is missing or non-positive", () => {
    expect(sharesForCash(1000, undefined)).toBeNull();
    expect(sharesForCash(1000, 0)).toBeNull();
  });

  it("returns null when cash is missing", () => {
    expect(sharesForCash(undefined, 180)).toBeNull();
  });
});

describe("cashForBuyingPowerPct", () => {
  it("computes cash as a percent of buying power", () => {
    expect(cashForBuyingPowerPct(25, 40000)).toBe(10000);
  });

  it("returns null when percent or buying power is missing or non-positive", () => {
    expect(cashForBuyingPowerPct(undefined, 40000)).toBeNull();
    expect(cashForBuyingPowerPct(25, null)).toBeNull();
    expect(cashForBuyingPowerPct(0, 40000)).toBeNull();
  });
});

describe("labels", () => {
  it("maps order-type codes to plain English", () => {
    expect(ORDER_TYPE_LABELS.TRAIL).toBe("Trailing Stop");
    expect(ORDER_TYPE_LABELS.TRAILLMT).toBe("Trailing Stop Limit");
    expect(TIF_LABELS.GTC).toBe("Good Till Cancel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/orbit/OrderTicket/__tests__/orderMath.test.ts`
Expected: FAIL — modules `../orderMath` and `../labels` do not exist.

- [ ] **Step 3: Write the label map**

Create `src/orbit/OrderTicket/labels.ts`:

```typescript
import type {
  MoonMarketOrderType,
  MoonMarketTimeInForce,
  MoonMarketTrailingType,
} from "@/lib/api";

export const ORDER_TYPE_LABELS: Record<MoonMarketOrderType, string> = {
  MKT: "Market",
  LMT: "Limit",
  STP: "Stop",
  STP_LIMIT: "Stop Limit",
  TRAIL: "Trailing Stop",
  TRAILLMT: "Trailing Stop Limit",
};

export const TIF_LABELS: Record<MoonMarketTimeInForce, string> = {
  DAY: "Day",
  GTC: "Good Till Cancel",
  IOC: "Immediate or Cancel",
};

export const TRAILING_TYPE_LABELS: Record<MoonMarketTrailingType, string> = {
  amt: "Amount ($)",
  "%": "Percent (%)",
};
```

- [ ] **Step 4: Write the math helpers**

Create `src/orbit/OrderTicket/orderMath.ts`:

```typescript
import type { MoonMarketOrderSide } from "@/lib/api";

export interface RiskReward {
  risk: number;
  reward: number;
  ratio: number;
}

export function computeRiskReward(params: {
  side: MoonMarketOrderSide;
  entry: number | undefined;
  takeProfit: number | undefined;
  stopLoss: number | undefined;
}): RiskReward | null {
  const { side, entry, takeProfit, stopLoss } = params;
  if (entry == null || takeProfit == null || stopLoss == null) return null;
  const risk = side === "BUY" ? entry - stopLoss : stopLoss - entry;
  const reward = side === "BUY" ? takeProfit - entry : entry - takeProfit;
  if (risk <= 0 || reward <= 0) return null;
  return { risk, reward, ratio: reward / risk };
}

export function sharesForCash(
  cash: number | undefined,
  referencePrice: number | undefined,
): number | null {
  if (cash == null || cash <= 0) return null;
  if (referencePrice == null || referencePrice <= 0) return null;
  return Math.floor(cash / referencePrice);
}

export function cashForBuyingPowerPct(
  pct: number | undefined,
  buyingPower: number | null | undefined,
): number | null {
  if (pct == null || pct <= 0) return null;
  if (buyingPower == null || buyingPower <= 0) return null;
  return (buyingPower * pct) / 100;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/orbit/OrderTicket/__tests__/orderMath.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/orbit/OrderTicket/labels.ts src/orbit/OrderTicket/orderMath.ts src/orbit/OrderTicket/__tests__/orderMath.test.ts
git commit -m "feat: add label maps and risk-reward/cash/buying-power helpers for order ticket"
```

---

## Task 5: Frontend — wire trailing fields, RTH, labels, R/R, and cash sizing into OrderForm

**Files:**
- Modify: `src/orbit/OrderTicket/OrderForm.tsx`
- Test: `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx` (append)

This task is split into TDD sub-cycles for each control. Run the full file's tests after each implementation step: `npx vitest run src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`.

### 5a — Trailing stop fields + plain-English order-type labels

- [ ] **Step 1: Write the failing test**

Append to `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx` inside the `describe("OrderTicket", ...)` block:

```typescript
it("shows plain-English order type labels", () => {
  useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
  renderTicket();

  const select = screen.getByLabelText(/order type/i);
  expect(select).toHaveTextContent("Trailing Stop");
  expect(select).toHaveTextContent("Trailing Stop Limit");
  expect(select).toHaveTextContent("Market");
});

it("reveals trailing fields and places a TRAIL order", async () => {
  useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
  renderTicket();

  fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "TRAIL" } });
  expect(screen.getByLabelText(/trail by/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/trail by/i), { target: { value: "%" } });
  fireEvent.change(screen.getByLabelText(/trail distance/i), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: /place/i }));

  await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
  const order = mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0];
  expect(order).toMatchObject({ orderType: "TRAIL", trailingType: "%", trailingAmt: 5 });
});

it("requires a limit offset for TRAILLMT", () => {
  useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
  renderTicket();

  fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "TRAILLMT" } });
  expect(screen.getByLabelText(/limit offset/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx -t "trailing"`
Expected: FAIL — no "Trail by" / "Trail distance" / "Limit offset" controls; TRAIL not an option.

- [ ] **Step 3: Implement trailing state, options, fields, and payload**

In `src/orbit/OrderTicket/OrderForm.tsx`:

a. Add imports near the top (after existing imports, line 15):

```typescript
import type { MoonMarketTrailingType } from "@/lib/api";
import { ORDER_TYPE_LABELS, TIF_LABELS, TRAILING_TYPE_LABELS } from "./labels";
import { computeRiskReward, sharesForCash } from "./orderMath";
```

b. Add state next to the other `useState` calls (after line 78):

```typescript
  const [trailingType, setTrailingType] = useState<MoonMarketTrailingType>("%");
  const [trailingAmt, setTrailingAmt] = useState("");
  const [outsideRth, setOutsideRth] = useState(false);
```

c. Reset them in the `useEffect` that resets on `target` change (after line 118 `setAuxPrice(...)`):

```typescript
    setTrailingType("%");
    setTrailingAmt("");
    setOutsideRth(false);
```

d. Add a derived flag after the state block (e.g. after line 96 mutations or near `optionTarget`):

```typescript
  const isTrailing = orderType === "TRAIL" || orderType === "TRAILLMT";
```

e. Extend `baseOrder` (lines 147-156) to include trailing + RTH fields:

```typescript
  const baseOrder = useMemo<MoonMarketOrderDraft>(() => ({
    conid: target.conid,
    assetClass,
    side,
    quantity: Number(quantity) || 0,
    orderType,
    tif,
    price: numberOrUndefined(price),
    auxPrice: numberOrUndefined(auxPrice),
    trailingType: isTrailing ? trailingType : undefined,
    trailingAmt: isTrailing ? numberOrUndefined(trailingAmt) : undefined,
    outsideRTH: outsideRth || undefined,
  }), [assetClass, auxPrice, isTrailing, orderType, outsideRth, price, quantity, side, target.conid, tif, trailingAmt, trailingType]);
```

f. Replace the hard-coded order-type `<option>`s (lines 294-297) with label-mapped options:

```typescript
            {(Object.keys(ORDER_TYPE_LABELS) as Array<keyof typeof ORDER_TYPE_LABELS>).map((code) => (
              <option key={code} value={code}>{ORDER_TYPE_LABELS[code]}</option>
            ))}
```

g. Replace the hard-coded TIF `<option>`s (lines 303-305) with label-mapped options:

```typescript
            {(Object.keys(TIF_LABELS) as Array<keyof typeof TIF_LABELS>).map((code) => (
              <option key={code} value={code}>{TIF_LABELS[code]}</option>
            ))}
```

h. Add the trailing controls block immediately after the Aux Price label (after line 315), before the option/bracket section:

```typescript
        {isTrailing ? (
          <div className="grid gap-3 rounded-md border border-border bg-[var(--bg-1)] p-3">
            <label className="block text-[11px] text-[var(--text-3)]">
              Trail By
              <select aria-label="Trail by" value={trailingType} onChange={(event) => setTrailingType(event.target.value as MoonMarketTrailingType)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]">
                {(Object.keys(TRAILING_TYPE_LABELS) as Array<keyof typeof TRAILING_TYPE_LABELS>).map((code) => (
                  <option key={code} value={code}>{TRAILING_TYPE_LABELS[code]}</option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] text-[var(--text-3)]">
              Trail Distance
              <input aria-label="Trail distance" value={trailingAmt} onChange={(event) => setTrailingAmt(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
            </label>
            {orderType === "TRAILLMT" ? (
              <label className="block text-[11px] text-[var(--text-3)]">
                Limit Offset
                <input aria-label="Limit offset" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
              </label>
            ) : null}
          </div>
        ) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`
Expected: PASS — trailing tests pass and existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/orbit/OrderTicket/OrderForm.tsx src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
git commit -m "feat: add trailing-stop controls and plain-English labels to order form"
```

### 5b — Outside RTH checkbox

- [ ] **Step 1: Write the failing test**

Append inside the describe block:

```typescript
it("passes the outside-RTH flag on placement when checked", async () => {
  useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
  renderTicket();

  fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
  fireEvent.click(screen.getByLabelText(/outside regular trading hours/i));
  fireEvent.click(screen.getByRole("button", { name: /place/i }));

  await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
  expect(mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0]).toMatchObject({ outsideRTH: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx -t "outside-RTH"`
Expected: FAIL — no "outside regular trading hours" control.

- [ ] **Step 3: Implement the checkbox**

In `OrderForm.tsx`, add after the Aux Price label (line 315), before the trailing block:

```typescript
        <label className="flex items-center gap-2 text-[12px] text-[var(--text-3)]">
          <input aria-label="Outside regular trading hours" type="checkbox" checked={outsideRth} onChange={(event) => setOutsideRth(event.target.checked)} />
          Allow execution outside regular trading hours
        </label>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orbit/OrderTicket/OrderForm.tsx src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
git commit -m "feat: add outside-RTH flag to order form"
```

### 5c — Risk/Reward readout

- [ ] **Step 1: Write the failing test**

Append inside the describe block:

```typescript
it("shows a risk/reward readout when take profit and stop loss are set", () => {
  useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
  renderTicket();

  fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "100" } });
  fireEvent.click(screen.getByLabelText(/take profit/i));
  fireEvent.change(screen.getByLabelText(/profit taker price/i), { target: { value: "130" } });
  fireEvent.click(screen.getByLabelText(/stop loss/i));
  fireEvent.change(screen.getByLabelText(/stop loss price/i), { target: { value: "90" } });

  expect(screen.getByText(/risk \/ reward/i)).toHaveTextContent("1 : 3.0");
  expect(screen.getByText(/for every \$1 you risk/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx -t "risk/reward"`
Expected: FAIL — no R/R readout.

- [ ] **Step 3: Implement the readout**

In `OrderForm.tsx`, add a derived value after `baseOrder` (after line 156):

```typescript
  const entryReference = numberOrUndefined(price) ?? book.ask ?? quote?.lastPrice ?? undefined;
  const riskReward = computeRiskReward({
    side,
    entry: entryReference ?? undefined,
    takeProfit: takeProfitEnabled ? numberOrUndefined(profitTakerPrice) : undefined,
    stopLoss: stopLossEnabled ? numberOrUndefined(stopLossPrice) : undefined,
  });
```

Then add the readout inside the protective-orders price block — after the closing of the `{takeProfitEnabled || stopLossEnabled ? (...)}` section (after line 348), add a sibling:

```typescript
        {riskReward ? (
          <div className="rounded-md border border-border bg-[var(--bg-1)] p-3 text-[11px]">
            <div className="font-semibold text-[var(--text-1)]">
              Risk / Reward&nbsp;&nbsp;1 : {riskReward.ratio.toFixed(1)}
            </div>
            <p className="mt-1 text-[var(--text-3)]">
              For every $1 you risk down to your stop, you stand to make about ${riskReward.ratio.toFixed(2)} at your target. A ratio of 1:3 or higher is generally considered favorable.
            </p>
          </div>
        ) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orbit/OrderTicket/OrderForm.tsx src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
git commit -m "feat: add risk-reward readout to order form bracket"
```

### 5d — Cash & % of Buying Power sizing

- [ ] **Step 1: Add the funds mock to the test harness**

In `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`, add `moonmarketAccountFunds` to the hoisted `mockApi` object (line 8-14):

```typescript
const mockApi = vi.hoisted(() => ({
  quote: vi.fn(),
  moonmarketPreviewOrder: vi.fn(),
  moonmarketPlaceOrders: vi.fn(),
  moonmarketReplyOrder: vi.fn(),
  moonmarketModifyOrder: vi.fn(),
  moonmarketAccountFunds: vi.fn(),
}));
```

In `beforeEach`, reset and give it a default (alongside the other `mockReset()` calls and resolved values, ~line 60-78):

```typescript
    mockApi.moonmarketAccountFunds.mockReset();
    mockApi.moonmarketAccountFunds.mockResolvedValue({
      account_id: "DU12345",
      buying_power: 40000,
      available_funds: 10000,
      cash: 10000,
      currency: "USD",
    });
```

- [ ] **Step 2: Write the failing tests**

Append inside the describe block:

```typescript
it("computes share quantity from a cash amount", async () => {
  useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
  renderTicket();

  fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
  fireEvent.change(screen.getByLabelText(/size by/i), { target: { value: "cash" } });
  fireEvent.change(screen.getByLabelText(/cash amount/i), { target: { value: "900" } });

  expect(screen.getByText(/≈ 5 shares/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /place/i }));
  await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
  expect(mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0]).toMatchObject({ quantity: 5 });
});

it("computes share quantity from a percent of buying power", async () => {
  useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
  renderTicket();

  // buying_power 40000 → 10% = 4000 cash ; at 200/share → 20 shares
  fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "200" } });
  fireEvent.change(screen.getByLabelText(/size by/i), { target: { value: "bp" } });
  await screen.findByText(/buying power/i);
  fireEvent.change(screen.getByLabelText(/percent of buying power/i), { target: { value: "10" } });

  expect(screen.getByText(/≈ 20 shares/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /place/i }));
  await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
  expect(mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0]).toMatchObject({ quantity: 20 });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx -t "cash amount"`
Expected: FAIL — no "Size by" / "Cash amount" / buying-power controls.

- [ ] **Step 4: Implement cash + buying-power sizing**

In `OrderForm.tsx`:

a. Add state (after line 78, with the other inputs):

```typescript
  const [sizeMode, setSizeMode] = useState<"shares" | "cash" | "bp">("shares");
  const [cashAmount, setCashAmount] = useState("");
  const [bpPercent, setBpPercent] = useState("");
```

b. Reset them in the target `useEffect` (after the trailing resets added in 5a):

```typescript
    setSizeMode("shares");
    setCashAmount("");
    setBpPercent("");
```

c. Add a funds query (after the existing `quoteQuery`, ~line 103). It only runs when an account is selected:

```typescript
  const fundsQuery = useQuery({
    queryKey: ["moonmarket", "funds", selectedAccountId],
    queryFn: ({ signal }) => api.moonmarketAccountFunds(selectedAccountId as string, signal),
    enabled: !!selectedAccountId,
    staleTime: 30_000,
  });
  const buyingPower = fundsQuery.data?.buying_power ?? null;
```

d. Compute effective cash and quantity after `entryReference` is defined (from 5c):

```typescript
  const effectiveCash =
    sizeMode === "cash"
      ? numberOrUndefined(cashAmount)
      : sizeMode === "bp"
        ? cashForBuyingPowerPct(numberOrUndefined(bpPercent), buyingPower) ?? undefined
        : undefined;
  const cashShares = sharesForCash(effectiveCash, entryReference ?? undefined);
  const effectiveQuantity = sizeMode === "shares" ? Number(quantity) || 0 : cashShares ?? 0;
```

e. Change `baseOrder.quantity` (in the `useMemo` from 5a) from `Number(quantity) || 0` to `effectiveQuantity`, and update the dependency array (replace `quantity` with `effectiveQuantity`):

```typescript
    quantity: effectiveQuantity,
```
```typescript
  }), [assetClass, auxPrice, effectiveQuantity, isTrailing, orderType, outsideRth, price, side, target.conid, tif, trailingAmt, trailingType]);
```

f. Add the Size-by toggle and inputs. Replace the existing Quantity `<label>` (lines 287-290) with:

```typescript
        <label className="block text-[11px] text-[var(--text-3)]">
          Size By
          <select aria-label="Size by" value={sizeMode} onChange={(event) => setSizeMode(event.target.value as "shares" | "cash" | "bp")} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]">
            <option value="shares">Shares</option>
            <option value="cash">Cash ($)</option>
            <option value="bp">% of Buying Power</option>
          </select>
        </label>
        {sizeMode === "shares" ? (
          <label className="block text-[11px] text-[var(--text-3)]">
            Quantity
            <input aria-label="Quantity" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
          </label>
        ) : sizeMode === "cash" ? (
          <label className="block text-[11px] text-[var(--text-3)]">
            Cash Amount
            <input aria-label="Cash amount" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
            <span className="mt-1 block text-[var(--text-3)]">{cashShares != null ? `≈ ${cashShares} shares` : "≈ — shares"}</span>
          </label>
        ) : (
          <label className="block text-[11px] text-[var(--text-3)]">
            Percent of Buying Power
            <input aria-label="Percent of buying power" value={bpPercent} onChange={(event) => setBpPercent(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
            <span className="mt-1 block text-[var(--text-3)]">
              Buying power {buyingPower != null ? `$${formatQuoteNumber(buyingPower)}` : "—"}
              {" · "}
              {cashShares != null ? `≈ ${cashShares} shares` : "≈ — shares"}
            </span>
          </label>
        )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`
Expected: PASS — all OrderTicket tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/orbit/OrderTicket/OrderForm.tsx src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
git commit -m "feat: add cash and percent-of-buying-power sizing to order form"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the backend suite**

Run: `cd backend && python -m pytest tests/test_orders_router.py tests/test_orders_model.py tests/test_moonmarket_funds.py -v`
Expected: PASS (all order + funds tests green).

- [ ] **Step 2: Run the frontend suite + typecheck**

Run: `npx vitest run src/orbit/OrderTicket && npx tsc --noEmit`
Expected: PASS — all OrderTicket tests green, no type errors.

- [ ] **Step 3: Lint the changed files**

Run: `npx eslint src/orbit/OrderTicket/OrderForm.tsx src/orbit/OrderTicket/labels.ts src/orbit/OrderTicket/orderMath.ts`
Expected: no errors.

- [ ] **Step 4: Final commit (if lint/format changed anything)**

```bash
git add -A
git commit -m "chore: lint and format order ticket enhancements"
```

---

## Self-Review Notes

- **Spec coverage:** TRAIL+TRAILLMT (Tasks 1,2,3,5a) ✓; outside RTH (1,2,3,5b) ✓; plain labels (4,5a) ✓; R/R readout (4,5c) ✓; cash + % of buying power sizing (2b,3,4,5d) ✓; buying power from IBKR `/portfolio/{accountId}/summary` (2b) ✓.
- **Type consistency:** `trailingType`/`trailingAmt`/`outsideRTH` (camelCase wire) ↔ `trailing_type`/`trailing_amt`/`outside_rth` (snake) via Pydantic aliases; `MoonMarketAccountFunds` fields (`buying_power`/`available_funds`/`cash`/`currency`) match between backend model (Task 2b) and frontend interface (Task 3); helper names `computeRiskReward`, `sharesForCash`, `cashForBuyingPowerPct`, `ORDER_TYPE_LABELS`, `TIF_LABELS`, `TRAILING_TYPE_LABELS` used identically across Tasks 4 and 5.
- **Confirm at implementation:** the live paper `/portfolio/{accountId}/summary` response shape (Task 2b) — adjust the key list in `_summary_amount` if IBKR returns different spellings.
- **Out of scope (unchanged):** bracket stop-loss leg stays `STP`; GTD/MOC/LOC; option brackets; the v2 tiered scale-out engine.
