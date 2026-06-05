# MoonMarket Options Chain + Single-Leg Option Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MoonMarket options-chain page that lazy-loads option contracts and routes selected call/put contracts into the shared Orbit OrderTicket as single-leg option orders.

**Architecture:** Build the backend read model first under `/moonmarket/options`, using IBKR secdef search/strikes/info plus existing snapshot normalization. Then add frontend option-chain types, API methods, hooks, page components, and route entry points. Finish by extending the shared OrderTicket with option metadata and explicit option-bracket guards while keeping stock bracket behavior unchanged.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, ibind-backed `IBKRService`, React 19, TypeScript, Zustand, TanStack Query v5, Tailwind/shadcn, lucide-react, Vitest, Testing Library, pytest, uv.

---

## Reference Inputs

- Design spec: `docs/superpowers/specs/2026-05-28-moonmarket-options-design.md`
- Parent v1 spec: `docs/superpowers/specs/2026-05-25-orbit-v1-design.md`
- OrderTicket spec: `docs/superpowers/specs/2026-05-26-orbit-orderticket-design.md`
- Existing backend order service: `backend/services/orders.py`
- Existing backend order router tests: `backend/tests/test_orders_router.py`
- Existing OrderTicket store/UI: `src/orbit/OrderTicket/`
- Current MoonMarket module: `src/modules/moonmarket/MoonMarketModule.tsx`
- Current MoonMarket layout: `src/modules/moonmarket/MoonMarketLayout.tsx`
- Current Parallax analysis toolbar: `src/pages/AnalysisPage.tsx`
- Proven reference options UI:
  - `reference/moonmarket/frontend/StockItem/options/OptionsChain.tsx`
  - `reference/moonmarket/frontend/StockItem/options/StrikeRow.tsx`
  - `reference/moonmarket/frontend/StockItem/options/OptionsChainHeader.tsx`
  - `reference/moonmarket/frontend/StockItem/options/ContractData.tsx`
  - `reference/moonmarket/frontend/types/options.ts`
- Proven reference IBKR calls: `reference/moonmarket/backend/api/market.py`

## Branch Setup

- [ ] **Step 1: Start from dev**

Run:

```bash
git checkout dev
git pull --ff-only origin dev
git checkout -b feature/moonmarket-options
```

Expected: `git branch --show-current` prints `feature/moonmarket-options`.

- [ ] **Step 2: Confirm Plan #5 is present**

Run:

```bash
test -f backend/routers/orders.py
test -f src/orbit/OrderTicket/OrderTicket.tsx
test -f docs/superpowers/specs/2026-05-26-orbit-orderticket-design.md
```

Expected: all three commands exit successfully.

---

## File Structure

Backend:

- Modify `backend/models/__init__.py`
  - Add option-chain response models.
  - Add `assetClass` metadata to `MoonMarketOrderDraft`.
- Modify `backend/services/ibkr.py`
  - Add small wrappers for option secdef calls:
    - `option_expirations(symbol: str, underlying_conid: int) -> list[str]`
    - `option_strikes(underlying_conid: int, month: str) -> dict[str, list[float]]`
    - `option_contract_info(underlying_conid: int, month: str, strike: float, right: str) -> list[dict[str, object]]`
- Create `backend/services/options.py`
  - Normalize secdef/search, strikes, secdef/info, and snapshot rows into MoonMarket option contracts.
- Create `backend/routers/options.py`
  - Expose `/moonmarket/options/*`.
  - Translate typed option lookup errors into 400/404 responses.
- Modify `backend/services/orders.py`
  - Reject option multi-order submissions before forwarding to IBKR.
  - Keep stock bracket payloads unchanged.
- Modify `backend/routers/orders.py`
  - Return HTTP 400 for `OptionBracketNotSupportedError`.
- Modify `backend/main.py`
  - Include the new options router.
- Create `backend/tests/test_options_router.py`
  - Cover expirations, chain strikes, per-strike contract loading, snapshot field normalization, and missing symbol/expiration errors.
- Modify `backend/tests/test_orders_router.py`
  - Cover single-leg option order passthrough and option bracket rejection.

Frontend:

- Modify `src/lib/api.ts`
  - Add option-chain TypeScript contracts and `api.moonmarketOption*` methods.
  - Add `assetClass?: "STK" | "OPT"` to `MoonMarketOrderDraft`.
- Modify `src/lib/api.moonmarket.test.ts`
  - Cover options endpoint URLs and query encoding.
- Modify `src/orbit/OrderTicket/useOrderTicketStore.ts`
  - Add `assetClass` and `description` to `OrderTicketTarget`.
- Modify `src/orbit/OrderTicket/OrderTicket.tsx`
  - Display option target metadata cleanly.
- Modify `src/orbit/OrderTicket/OrderForm.tsx`
  - Include `assetClass` in order drafts.
  - Disable/hide bracket controls when `target.assetClass === "OPT"`.
- Modify `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`
  - Cover option label rendering, hidden bracket controls for options, and unchanged stock bracket controls.
- Create `src/modules/moonmarket/options/useOptionsChain.ts`
  - TanStack Query hooks and mutation for lazy strike loading.
- Create `src/modules/moonmarket/options/OptionsChainPage.tsx`
  - MoonMarket options route container.
- Create `src/modules/moonmarket/options/OptionsChainTable.tsx`
  - Expiration selector, header, and scrollable strike list.
- Create `src/modules/moonmarket/options/StrikeRow.tsx`
  - Lazy row loading and call/put selection.
- Create `src/modules/moonmarket/options/OptionContractCell.tsx`
  - Display bid/ask/last/delta/size fields.
- Create `src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx`
  - Cover empty state, expiration fetch, row lazy loading, and ticket open payload.
- Modify `src/modules/moonmarket/MoonMarketModule.tsx`
  - Add `options` active page detection and render `OptionsChainPage`.
- Modify `src/modules/moonmarket/MoonMarketLayout.tsx`
  - Add the Options nav tab.
- Modify `src/modules/moonmarket/PortfolioPage.tsx`
  - Add Options action for selected stock/ETF holdings.
- Modify `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`
  - Cover route selection and Options nav.
- Modify `src/pages/AnalysisPage.tsx`
  - Add Options toolbar action that navigates to MoonMarket options by `conid`.
- Modify `src/pages/__tests__/AnalysisPage.test.tsx`
  - Cover the Options toolbar navigation.

---

## Task 1: Backend Option Models and Router

**Files:**

- Modify: `backend/models/__init__.py`
- Modify: `backend/services/ibkr.py`
- Create: `backend/services/options.py`
- Create: `backend/routers/options.py`
- Modify: `backend/main.py`
- Create: `backend/tests/test_options_router.py`

- [ ] **Step 1: Write failing router tests**

Create `backend/tests/test_options_router.py` with a fake IBKR service that records calls:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import require_ibkr_auth
from routers.options import router as options_router


class _FakeIbkr:
    def __init__(self) -> None:
        self.requests: list[tuple[str, str, dict]] = []

    async def search(self, symbol: str, sec_type: str = ""):
        self.requests.append(("SEARCH", symbol, {"sec_type": sec_type}))
        return [
            {
                "conid": 265598,
                "symbol": symbol,
                "sections": [
                    {"secType": "STK", "exchange": "SMART"},
                    {"secType": "OPT", "months": "JUN24;JUL24", "exchange": "SMART"},
                ],
            }
        ]

    async def _request(self, method: str, endpoint: str, **kwargs):
        self.requests.append((method, endpoint, dict(kwargs)))
        params = kwargs.get("params") or {}
        if endpoint == "/iserver/secdef/strikes":
            assert params == {"conid": 265598, "secType": "OPT", "month": "JUN24"}
            return {"call": [175.0, 180.0], "put": [180.0, 185.0]}
        if endpoint == "/iserver/secdef/info":
            right = params["right"]
            return [{
                "conid": 7001 if right == "C" else 7002,
                "strike": params["strike"],
                "right": right,
                "symbol": "AAPL",
            }]
        if endpoint == "/iserver/marketdata/snapshot":
            return [
                {"conid": 7001, "31": "4.20", "84": "4.10", "86": "4.30", "85": "12", "88": "15", "7762": "150", "7308": "0.62"},
                {"conid": 7002, "31": "3.90", "84": "3.80", "86": "4.00", "85": "10", "88": "14", "7762": "110", "7308": "-0.38"},
            ]
        raise AssertionError(f"Unexpected request: {method} {endpoint}")


def _client(fake: _FakeIbkr) -> TestClient:
    app = FastAPI()
    app.include_router(options_router)
    app.dependency_overrides[require_ibkr_auth] = lambda: fake
    return TestClient(app)


def test_expirations_use_symbol_hint_but_underlying_conid_route_key():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/options/expirations/265598?symbol=AAPL")

    assert resp.status_code == 200
    assert resp.json() == {"underlying_conid": 265598, "symbol": "AAPL", "expirations": ["JUN24", "JUL24"]}


def test_chain_returns_sorted_union_of_call_and_put_strikes():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/options/chain/265598?expiration=JUN24")

    assert resp.status_code == 200
    assert resp.json() == {
        "underlying_conid": 265598,
        "expiration": "JUN24",
        "all_strikes": [175.0, 180.0, 185.0],
        "chain": {},
    }


def test_contract_loads_call_put_contracts_and_snapshots_quotes():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/options/contract/265598?expiration=JUN24&strike=180")

    assert resp.status_code == 200
    body = resp.json()
    assert body["strike"] == 180.0
    assert body["data"]["call"]["contractId"] == 7001
    assert body["data"]["call"]["bid"] == 4.10
    assert body["data"]["call"]["ask"] == 4.30
    assert body["data"]["call"]["delta"] == 0.62
    assert body["data"]["put"]["contractId"] == 7002
    assert body["data"]["put"]["delta"] == -0.38
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd backend
uv run python -m pytest tests/test_options_router.py -q
```

Expected: import failure because `routers.options` and option models do not exist.

- [ ] **Step 3: Add option response models**

In `backend/models/__init__.py`, add these models near the MoonMarket models:

```python
OptionRight = Literal["C", "P"]
OptionType = Literal["call", "put"]


class MoonMarketOptionContract(BaseModel):
    """One option contract returned by MoonMarket's lazy chain loader."""
    contract_id: int = Field(alias="contractId")
    underlying_conid: int = Field(alias="underlyingConid")
    expiration: str
    strike: float
    right: OptionRight
    type: OptionType
    symbol: str = ""
    last_price: Optional[float] = Field(default=None, alias="lastPrice")
    bid: Optional[float] = None
    ask: Optional[float] = None
    volume: Optional[float] = None
    delta: Optional[float] = None
    bid_size: Optional[float] = Field(default=None, alias="bidSize")
    ask_size: Optional[float] = Field(default=None, alias="askSize")

    model_config = ConfigDict(populate_by_name=True)


class MoonMarketOptionExpirationsResponse(BaseModel):
    underlying_conid: int
    symbol: str
    expirations: list[str]


class MoonMarketOptionChainResponse(BaseModel):
    underlying_conid: int
    expiration: str
    all_strikes: list[float]
    chain: dict[str, dict[str, MoonMarketOptionContract]] = Field(default_factory=dict)


class MoonMarketSingleOptionStrikeResponse(BaseModel):
    strike: float
    data: dict[str, MoonMarketOptionContract]
```

- [ ] **Step 4: Add IBKR option wrappers**

In `backend/services/ibkr.py`, add methods on `IBKRService` near the existing `search` and secdef helpers:

```python
async def option_expirations(self, symbol: str, underlying_conid: int) -> list[str]:
    rows = await self.search(symbol=symbol, sec_type="STK")
    for row in rows:
        try:
            if int(row.get("conid")) != underlying_conid:
                continue
        except (TypeError, ValueError):
            continue
        for section in row.get("sections") or []:
            if not isinstance(section, dict):
                continue
            if str(section.get("secType", "")).upper() != "OPT":
                continue
            months = str(section.get("months") or "")
            return [month for month in months.split(";") if month]
    return []

async def option_strikes(self, underlying_conid: int, month: str) -> dict[str, list[float]]:
    return await self._request(
        "GET",
        "/iserver/secdef/strikes",
        params={"conid": underlying_conid, "secType": "OPT", "month": month},
    )

async def option_contract_info(
    self,
    underlying_conid: int,
    month: str,
    strike: float,
    right: str,
) -> list[dict[str, object]]:
    return await self._request(
        "GET",
        "/iserver/secdef/info",
        params={
            "conid": underlying_conid,
            "secType": "OPT",
            "month": month,
            "strike": strike,
            "right": right,
        },
    )
```

- [ ] **Step 5: Add option normalization service**

Create `backend/services/options.py`:

```python
"""MoonMarket options-chain read model."""

from __future__ import annotations

from models import MoonMarketOptionContract
from services.ibkr import IBKRService, _safe_float

OPTION_QUOTE_FIELDS = "31,84,86,85,88,7762,7308"


class OptionLookupError(LookupError):
    """Raised when IBKR cannot resolve option-chain data."""


class OptionService:
    def __init__(self, ibkr: IBKRService) -> None:
        self.ibkr = ibkr

    async def expirations(self, underlying_conid: int, symbol: str) -> list[str]:
        if not symbol.strip():
            raise OptionLookupError("symbol is required to load IBKR option expirations")
        expirations = await self.ibkr.option_expirations(symbol.strip().upper(), underlying_conid)
        if not expirations:
            raise OptionLookupError(f"No option expirations found for {symbol}")
        return expirations

    async def strikes(self, underlying_conid: int, expiration: str) -> list[float]:
        raw = await self.ibkr.option_strikes(underlying_conid, expiration)
        values: set[float] = set()
        for side in ("call", "put"):
            for strike in raw.get(side) or []:
                parsed = _safe_float(strike)
                if parsed is not None:
                    values.add(parsed)
        return sorted(values)

    async def contract_pair(
        self,
        underlying_conid: int,
        expiration: str,
        strike: float,
    ) -> dict[str, MoonMarketOptionContract]:
        call_rows = await self.ibkr.option_contract_info(underlying_conid, expiration, strike, "C")
        put_rows = await self.ibkr.option_contract_info(underlying_conid, expiration, strike, "P")
        raw_contracts = [row for row in [call_rows[0] if call_rows else None, put_rows[0] if put_rows else None] if row]
        conids = [int(row["conid"]) for row in raw_contracts if row.get("conid") is not None]
        quote_rows = await self.ibkr.snapshot(conids=conids, fields=OPTION_QUOTE_FIELDS) if conids else []
        quotes_by_conid = {
            int(row.get("conid")): row
            for row in quote_rows
            if row.get("conid") is not None
        }

        result: dict[str, MoonMarketOptionContract] = {}
        for row in raw_contracts:
            right = str(row.get("right") or "").upper()
            side = "call" if right == "C" else "put"
            contract_id = int(row["conid"])
            quote = quotes_by_conid.get(contract_id, {})
            result[side] = self._contract(row, quote, underlying_conid, expiration, strike, right)
        return result

    def _contract(
        self,
        row: dict[str, object],
        quote: dict[str, object],
        underlying_conid: int,
        expiration: str,
        strike: float,
        right: str,
    ) -> MoonMarketOptionContract:
        side = "call" if right == "C" else "put"
        contract_id = int(row["conid"])
        return MoonMarketOptionContract(
            contractId=contract_id,
            underlyingConid=underlying_conid,
            expiration=expiration,
            strike=strike,
            right=right,
            type=side,
            symbol=str(row.get("symbol") or quote.get("55") or ""),
            lastPrice=_safe_float(quote.get("31") or quote.get("lastPrice")),
            bid=_safe_float(quote.get("84") or quote.get("bid")),
            ask=_safe_float(quote.get("86") or quote.get("ask")),
            volume=_safe_float(quote.get("7762") or quote.get("volume")),
            delta=_safe_float(quote.get("7308") or quote.get("delta")),
            bidSize=_safe_float(quote.get("85") or quote.get("bidSize")),
            askSize=_safe_float(quote.get("88") or quote.get("askSize")),
        )
```

- [ ] **Step 6: Add options router and main wiring**

Create `backend/routers/options.py`:

```python
"""MoonMarket options-chain router."""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from deps import require_ibkr_auth
from models import (
    MoonMarketOptionChainResponse,
    MoonMarketOptionExpirationsResponse,
    MoonMarketSingleOptionStrikeResponse,
)
from services.ibkr import IBKRService
from services.options import OptionLookupError, OptionService

router = APIRouter(prefix="/moonmarket/options", tags=["moonmarket-options"])


def _service(ibkr: IBKRService) -> OptionService:
    return OptionService(ibkr)


def _lookup_error(exc: OptionLookupError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": "option_lookup_failed", "message": str(exc)},
    )


@router.get("/expirations/{underlying_conid}", response_model=MoonMarketOptionExpirationsResponse)
async def option_expirations(
    underlying_conid: int,
    symbol: str = Query(..., min_length=1),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOptionExpirationsResponse:
    try:
        expirations = await _service(ibkr).expirations(underlying_conid, symbol)
        return MoonMarketOptionExpirationsResponse(
            underlying_conid=underlying_conid,
            symbol=symbol.upper(),
            expirations=expirations,
        )
    except OptionLookupError as exc:
        raise _lookup_error(exc) from exc


@router.get("/chain/{underlying_conid}", response_model=MoonMarketOptionChainResponse)
async def option_chain(
    underlying_conid: int,
    expiration: str = Query(..., min_length=1),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketOptionChainResponse:
    strikes = await _service(ibkr).strikes(underlying_conid, expiration)
    return MoonMarketOptionChainResponse(
        underlying_conid=underlying_conid,
        expiration=expiration,
        all_strikes=strikes,
        chain={},
    )


@router.get("/contract/{underlying_conid}", response_model=MoonMarketSingleOptionStrikeResponse)
async def option_contract(
    underlying_conid: int,
    expiration: str = Query(..., min_length=1),
    strike: float = Query(..., gt=0),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketSingleOptionStrikeResponse:
    pair = await _service(ibkr).contract_pair(underlying_conid, expiration, strike)
    return MoonMarketSingleOptionStrikeResponse(strike=strike, data=pair)
```

In `backend/main.py`, include the router beside MoonMarket/order routers:

```python
from routers import options

app.include_router(options.router)
```

- [ ] **Step 7: Run backend option tests**

Run:

```bash
cd backend
uv run python -m pytest tests/test_options_router.py -q
```

Expected: all option router tests pass.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add backend/models/__init__.py backend/services/ibkr.py backend/services/options.py backend/routers/options.py backend/main.py backend/tests/test_options_router.py
git commit -m "feat: add MoonMarket options chain API"
```

---

## Task 2: Guard Option Brackets in the Shared Order API

**Files:**

- Modify: `backend/models/__init__.py`
- Modify: `backend/services/orders.py`
- Modify: `backend/routers/orders.py`
- Modify: `backend/tests/test_orders_router.py`

- [ ] **Step 1: Write failing order tests**

Add to `backend/tests/test_orders_router.py`:

```python
def _option_order(conid: int = 7001) -> dict:
    return {
        "conid": conid,
        "assetClass": "OPT",
        "side": "BUY",
        "quantity": 1,
        "orderType": "LMT",
        "tif": "DAY",
        "price": 4.2,
    }


def test_place_single_option_order_posts_one_order_for_paper_account():
    fake = _FakeIbkr()
    resp = _client(fake).post(
        "/moonmarket/orders",
        json={"account_id": "DU12345", "orders": [_option_order()]},
    )

    assert resp.status_code == 200
    assert fake.requests[-1] == (
        "POST",
        "/iserver/account/DU12345/orders",
        {"json": {"orders": [{k: v for k, v in _option_order().items() if k != "assetClass"}]}},
    )


def test_option_bracket_payload_is_rejected_before_ibkr_call():
    fake = _FakeIbkr()
    orders = [
        {**_option_order(), "cOID": "opt-brkt-1"},
        {**_option_order(), "parentId": "opt-brkt-1", "side": "SELL", "orderType": "LMT", "price": 6.0},
        {**_option_order(), "parentId": "opt-brkt-1", "side": "SELL", "orderType": "STP", "price": 3.0},
    ]

    resp = _client(fake).post("/moonmarket/orders", json={"account_id": "DU12345", "orders": orders})

    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "option_bracket_not_supported"
    assert not any(endpoint.endswith("/orders") for _, endpoint, _ in fake.requests)
```

- [ ] **Step 2: Run the failing order tests**

Run:

```bash
cd backend
uv run python -m pytest tests/test_orders_router.py::test_place_single_option_order_posts_one_order_for_paper_account tests/test_orders_router.py::test_option_bracket_payload_is_rejected_before_ibkr_call -q
```

Expected: validation fails because `assetClass` is not modeled, or the option bracket is not rejected.

- [ ] **Step 3: Add order asset class metadata**

In `backend/models/__init__.py`, add:

```python
OrderAssetClass = Literal["STK", "OPT"]
```

Then extend `MoonMarketOrderDraft`:

```python
asset_class: OrderAssetClass = Field(default="STK", alias="assetClass")
```

- [ ] **Step 4: Add service/router guard**

In `backend/services/orders.py`, add:

```python
class OptionBracketNotSupportedError(ValueError):
    """Raised when an option order tries to submit a bracket group."""
```

At the start of `OrderService.place` after `_assert_paper_account`:

```python
if len(orders) > 1 and any(order.asset_class == "OPT" for order in orders):
    raise OptionBracketNotSupportedError("Option bracket orders are deferred until after single-leg paper validation")
```

In `_order_payload`, do not add `asset_class` to the payload.

In `backend/routers/orders.py`, catch the new error:

```python
def _option_bracket_not_supported(exc: OptionBracketNotSupportedError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"error": "option_bracket_not_supported", "message": str(exc)},
    )
```

Add `except OptionBracketNotSupportedError as exc` in `place_orders`.

- [ ] **Step 5: Run focused order tests**

Run:

```bash
cd backend
uv run python -m pytest tests/test_orders_router.py -q
```

Expected: all order router tests pass, including existing stock bracket coverage.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add backend/models/__init__.py backend/services/orders.py backend/routers/orders.py backend/tests/test_orders_router.py
git commit -m "feat: guard option orders as single-leg only"
```

---

## Task 3: Frontend Option API Contracts and Hooks

**Files:**

- Modify: `src/lib/api.ts`
- Modify: `src/lib/api.moonmarket.test.ts`
- Create: `src/modules/moonmarket/options/useOptionsChain.ts`

- [ ] **Step 1: Add failing API tests**

In `src/lib/api.moonmarket.test.ts`, add tests that assert these calls:

```ts
await api.moonmarketOptionExpirations(265598, "AAPL");
expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/moonmarket/options/expirations/265598?symbol=AAPL"), expect.anything());

await api.moonmarketOptionChain(265598, "JUN24");
expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/moonmarket/options/chain/265598?expiration=JUN24"), expect.anything());

await api.moonmarketOptionContract(265598, "JUN24", 180);
expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/moonmarket/options/contract/265598?expiration=JUN24&strike=180"), expect.anything());
```

- [ ] **Step 2: Run the failing API tests**

Run:

```bash
npm test -- src/lib/api.moonmarket.test.ts --run
```

Expected: the new `api.moonmarketOption*` functions do not exist.

- [ ] **Step 3: Add TypeScript contracts and API methods**

In `src/lib/api.ts`, add:

```ts
export type MoonMarketOrderAssetClass = "STK" | "OPT";

export interface MoonMarketOptionContract {
  contractId: number;
  underlyingConid: number;
  expiration: string;
  strike: number;
  right: "C" | "P";
  type: "call" | "put";
  symbol: string;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  delta: number | null;
  bidSize: number | null;
  askSize: number | null;
}

export type MoonMarketOptionsChainData = Record<
  string,
  { call?: MoonMarketOptionContract; put?: MoonMarketOptionContract }
>;

export interface MoonMarketOptionExpirationsResponse {
  underlying_conid: number;
  symbol: string;
  expirations: string[];
}

export interface MoonMarketOptionChainResponse {
  underlying_conid: number;
  expiration: string;
  all_strikes: number[];
  chain: MoonMarketOptionsChainData;
}

export interface MoonMarketSingleOptionStrikeResponse {
  strike: number;
  data: { call?: MoonMarketOptionContract; put?: MoonMarketOptionContract };
}
```

Extend `MoonMarketOrderDraft`:

```ts
assetClass?: MoonMarketOrderAssetClass;
```

Add API methods:

```ts
moonmarketOptionExpirations: (underlyingConid: number, symbol: string, signal?: AbortSignal) =>
  request<MoonMarketOptionExpirationsResponse>(
    "GET",
    `/moonmarket/options/expirations/${underlyingConid}?symbol=${encodeURIComponent(symbol)}`,
    undefined,
    signal,
  ),

moonmarketOptionChain: (underlyingConid: number, expiration: string, signal?: AbortSignal) =>
  request<MoonMarketOptionChainResponse>(
    "GET",
    `/moonmarket/options/chain/${underlyingConid}?expiration=${encodeURIComponent(expiration)}`,
    undefined,
    signal,
  ),

moonmarketOptionContract: (underlyingConid: number, expiration: string, strike: number, signal?: AbortSignal) =>
  request<MoonMarketSingleOptionStrikeResponse>(
    "GET",
    `/moonmarket/options/contract/${underlyingConid}?expiration=${encodeURIComponent(expiration)}&strike=${encodeURIComponent(String(strike))}`,
    undefined,
    signal,
  ),
```

- [ ] **Step 4: Add chain hooks**

Create `src/modules/moonmarket/options/useOptionsChain.ts`:

```ts
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type MoonMarketOptionsChainData } from "@/lib/api";

export function useOptionExpirations(underlyingConid: number | null, symbol: string | null) {
  return useQuery({
    queryKey: ["moonmarket", "options", "expirations", underlyingConid, symbol],
    enabled: Boolean(underlyingConid && symbol),
    queryFn: ({ signal }) => api.moonmarketOptionExpirations(underlyingConid as number, symbol as string, signal),
  });
}

export function useOptionChain(underlyingConid: number | null, expiration: string | null) {
  return useQuery({
    queryKey: ["moonmarket", "options", "chain", underlyingConid, expiration],
    enabled: Boolean(underlyingConid && expiration),
    queryFn: ({ signal }) => api.moonmarketOptionChain(underlyingConid as number, expiration as string, signal),
  });
}

export function useLazyOptionStrike(onLoaded: (chain: MoonMarketOptionsChainData, strike: number) => void) {
  return useMutation({
    mutationFn: ({ underlyingConid, expiration, strike }: { underlyingConid: number; expiration: string; strike: number }) =>
      api.moonmarketOptionContract(underlyingConid, expiration, strike),
    onSuccess: (response) => {
      onLoaded({ [response.strike.toFixed(2)]: response.data }, response.strike);
    },
  });
}
```

- [ ] **Step 5: Run API tests**

Run:

```bash
npm test -- src/lib/api.moonmarket.test.ts --run
```

Expected: API tests pass.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/lib/api.ts src/lib/api.moonmarket.test.ts src/modules/moonmarket/options/useOptionsChain.ts
git commit -m "feat: add MoonMarket option chain client"
```

---

## Task 4: Options Chain Page and Route

**Files:**

- Create: `src/modules/moonmarket/options/OptionsChainPage.tsx`
- Create: `src/modules/moonmarket/options/OptionsChainTable.tsx`
- Create: `src/modules/moonmarket/options/StrikeRow.tsx`
- Create: `src/modules/moonmarket/options/OptionContractCell.tsx`
- Create: `src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx`
- Modify: `src/modules/moonmarket/MoonMarketModule.tsx`
- Modify: `src/modules/moonmarket/MoonMarketLayout.tsx`
- Modify: `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`

- [ ] **Step 1: Write page behavior tests**

Create `src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx` covering:

```ts
it("shows an empty state when opened without an underlying conid");
it("loads expirations and strikes for the query-string underlying");
it("lazy-loads one strike row when the row is clicked");
it("opens the shared OrderTicket with assetClass OPT when a call is selected");
```

Mock `api.moonmarketOptionExpirations`, `api.moonmarketOptionChain`, `api.moonmarketOptionContract`, and `useOrderTicketStore`.

- [ ] **Step 2: Run the failing page tests**

Run:

```bash
npm test -- src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx --run
```

Expected: import failure because the options page does not exist.

- [ ] **Step 3: Add route parsing container**

Create `OptionsChainPage.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { MoonMarketOptionsChainData, MoonMarketOptionContract } from "@/lib/api";
import { useOrderTicketStore } from "@/orbit/OrderTicket";
import { OptionsChainTable } from "./OptionsChainTable";
import { useOptionChain, useOptionExpirations } from "./useOptionsChain";

export function OptionsChainPage() {
  const [params] = useSearchParams();
  const underlyingConid = Number(params.get("conid"));
  const symbol = params.get("symbol")?.toUpperCase() ?? "";
  const openOrderTicket = useOrderTicketStore((state) => state.open);
  const expirationsQuery = useOptionExpirations(Number.isFinite(underlyingConid) ? underlyingConid : null, symbol || null);
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const expiration = selectedExpiration ?? expirationsQuery.data?.expirations[0] ?? null;
  const chainQuery = useOptionChain(Number.isFinite(underlyingConid) ? underlyingConid : null, expiration);
  const [chainData, setChainData] = useState<MoonMarketOptionsChainData>({});

  const allStrikes = chainQuery.data?.all_strikes ?? [];
  const title = useMemo(() => symbol || "Options", [symbol]);

  if (!Number.isFinite(underlyingConid) || !symbol) {
    return (
      <main className="p-4">
        <section className="rounded-md border border-dashed border-border bg-[var(--bg-2)] p-4 text-[12px] text-[var(--text-3)]">
          Open Options from Parallax Analysis or a MoonMarket portfolio holding.
        </section>
      </main>
    );
  }

  const handleSelect = (option: MoonMarketOptionContract) => {
    const description = `${symbol} ${option.expiration} ${option.strike} ${option.type.toUpperCase()}`;
    openOrderTicket({
      conid: option.contractId,
      symbol: description,
      description,
      assetClass: "OPT",
      side: "BUY",
    });
  };

  return (
    <main className="min-h-0 p-4">
      <OptionsChainTable
        title={title}
        underlyingConid={underlyingConid}
        expirations={expirationsQuery.data?.expirations ?? []}
        selectedExpiration={expiration}
        onExpirationChange={(next) => {
          setSelectedExpiration(next);
          setChainData({});
        }}
        allStrikes={allStrikes}
        chainData={chainData}
        setChainData={setChainData}
        loading={expirationsQuery.isLoading || chainQuery.isLoading}
        error={expirationsQuery.error || chainQuery.error}
        onSelect={handleSelect}
      />
    </main>
  );
}
```

- [ ] **Step 4: Add table and row components**

Implement `OptionsChainTable`, `StrikeRow`, and `OptionContractCell` as shadcn/Tailwind ports of the reference files. Preserve these behaviors:

- Expiration selector is disabled when no expirations exist.
- Strike list is scrollable.
- Clicking an unloaded row calls `api.moonmarketOptionContract` through `useLazyOptionStrike`.
- Merged chain data uses `strike.toFixed(2)` as the row key.
- Call/put cells are clickable only when contract data exists.
- Cell fields display Delta, Bid Size, Ask Size, Last, Ask, Bid.

- [ ] **Step 5: Wire MoonMarket route and nav**

In `MoonMarketModule.tsx`, change page detection to include options:

```ts
type MoonMarketPage = "portfolio" | "transactions" | "options";

function activePageFromPath(pathname: string): MoonMarketPage {
  if (pathname.startsWith("/moonmarket/transactions")) return "transactions";
  if (pathname.startsWith("/moonmarket/options")) return "options";
  return "portfolio";
}
```

Render:

```tsx
{activePage === "options" ? (
  <OptionsChainPage />
) : activePage === "transactions" ? (
  <TransactionsPage accountId={accountId} />
) : (
  <PortfolioPage accountId={accountId} accountsLoading={accountsQuery.isLoading} />
)}
```

In `MoonMarketLayout.tsx`, add an Options nav item with a chart/list icon:

```ts
{ page: "options", label: "Options", path: "/moonmarket/options", icon: ListTree }
```

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
npm test -- src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx --run
```

Expected: focused options/MoonMarket tests pass.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add src/modules/moonmarket/MoonMarketModule.tsx src/modules/moonmarket/MoonMarketLayout.tsx src/modules/moonmarket/options src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
git commit -m "feat: add MoonMarket options chain page"
```

---

## Task 5: Entry Points From Parallax and Portfolio

**Files:**

- Modify: `src/pages/AnalysisPage.tsx`
- Modify: `src/pages/__tests__/AnalysisPage.test.tsx`
- Modify: `src/modules/moonmarket/PortfolioPage.tsx`
- Modify: `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`

- [ ] **Step 1: Add failing entry-point tests**

Cover:

```ts
it("navigates from Analysis to MoonMarket options with active conid and symbol");
it("navigates from a selected MoonMarket holding to options with position conid and symbol");
```

Expected URL:

```ts
`/moonmarket/options?conid=${conid}&symbol=${encodeURIComponent(symbol)}`
```

- [ ] **Step 2: Add Parallax Options action**

In `src/pages/AnalysisPage.tsx`, add a handler:

```ts
const handleOptions = () => {
  if (!activeConid || !activeSymbol) return;
  navigate(`/moonmarket/options?conid=${activeConid}&symbol=${encodeURIComponent(activeSymbol)}`);
};
```

Add a toolbar button next to Trade:

```tsx
<button
  type="button"
  onClick={handleOptions}
  disabled={!activeConid || !activeSymbol}
  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-40"
>
  <ListTree className="h-3.5 w-3.5" strokeWidth={1.7} />
  Options
</button>
```

- [ ] **Step 3: Add portfolio Options action**

In `PositionInspector`, add `onOptions`. Render the Options action beside Trade/Analyze for selected positions:

```tsx
<button
  type="button"
  aria-label={`Options ${position.symbol}`}
  onClick={() => onOptions(position)}
  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
>
  <ListTree className="h-3.5 w-3.5" />
  Options
</button>
```

Add handler:

```ts
const handleOptions = (position: MoonMarketPosition) => {
  navigate(`/moonmarket/options?conid=${position.conid}&symbol=${encodeURIComponent(position.symbol)}`);
};
```

- [ ] **Step 4: Run entry tests**

Run:

```bash
npm test -- src/pages/__tests__/AnalysisPage.test.tsx src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx --run
```

Expected: entry-point tests pass.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add src/pages/AnalysisPage.tsx src/pages/__tests__/AnalysisPage.test.tsx src/modules/moonmarket/PortfolioPage.tsx src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
git commit -m "feat: add options chain entry points"
```

---

## Task 6: OrderTicket Option Metadata and Bracket Disablement

**Files:**

- Modify: `src/orbit/OrderTicket/useOrderTicketStore.ts`
- Modify: `src/orbit/OrderTicket/OrderTicket.tsx`
- Modify: `src/orbit/OrderTicket/OrderForm.tsx`
- Modify: `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`

- [ ] **Step 1: Add failing OrderTicket option tests**

In `OrderTicket.test.tsx`, add:

```ts
it("renders option metadata and hides bracket controls for option targets", () => {
  useOrderTicketStore.getState().open({
    conid: 7001,
    symbol: "AAPL JUN24 180 CALL",
    description: "AAPL JUN24 180 CALL",
    assetClass: "OPT",
  });
  renderTicket();

  expect(screen.getByText("OPTION")).toBeInTheDocument();
  expect(screen.getByText("AAPL JUN24 180 CALL")).toBeInTheDocument();
  expect(screen.queryByLabelText(/bracket order/i)).not.toBeInTheDocument();
});

it("keeps bracket controls for stock targets", () => {
  useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", assetClass: "STK" });
  renderTicket();

  expect(screen.getByLabelText(/bracket order/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Extend target type**

In `useOrderTicketStore.ts`:

```ts
export type OrderTicketAssetClass = "STK" | "OPT";

export type OrderTicketTarget = {
  mode?: "create" | "modify";
  conid: number;
  symbol?: string;
  description?: string;
  assetClass?: OrderTicketAssetClass;
  side?: MoonMarketOrderSide;
  orderId?: string;
  draft?: Partial<MoonMarketOrderDraft>;
};
```

- [ ] **Step 3: Update form draft and bracket behavior**

In `OrderForm.tsx`, add:

```ts
const assetClass = target.assetClass ?? "STK";
const optionTarget = assetClass === "OPT";
```

Include `assetClass` in `baseOrder`:

```ts
assetClass,
```

Change bracket rendering:

```tsx
{optionTarget ? (
  <div className="rounded-md border border-border bg-[var(--bg-1)] px-3 py-2 text-[11px] text-[var(--text-3)]">
    Option bracket orders are deferred until after single-leg paper validation.
  </div>
) : (
  <label className="flex items-center gap-2 text-[12px]">
    <input aria-label="Bracket Order" type="checkbox" checked={bracket} onChange={(event) => setBracket(event.target.checked)} />
    Bracket order
  </label>
)}
```

Force single-leg options:

```ts
const buildOrders = (): MoonMarketOrderDraft[] => {
  if (optionTarget || !bracket) return [baseOrder];

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
    {
      conid: target.conid,
      assetClass: "STK",
      parentId,
      side: oppositeSide,
      quantity: baseOrder.quantity,
      orderType: "LMT",
      tif: "GTC",
      price: profitPrice,
      isSingleGroup: true,
    },
    {
      conid: target.conid,
      assetClass: "STK",
      parentId,
      side: oppositeSide,
      quantity: baseOrder.quantity,
      orderType: "STP",
      tif: "GTC",
      price: stopPrice,
      isSingleGroup: true,
    },
  ];
};
```

- [ ] **Step 4: Update ticket shell metadata**

In `OrderTicket.tsx`, show an `OPTION` badge when `target.assetClass === "OPT"` and prefer `target.description` for the title if present.

- [ ] **Step 5: Run OrderTicket tests**

Run:

```bash
npm test -- src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx --run
```

Expected: all OrderTicket tests pass.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add src/orbit/OrderTicket/useOrderTicketStore.ts src/orbit/OrderTicket/OrderTicket.tsx src/orbit/OrderTicket/OrderForm.tsx src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx
git commit -m "feat: route option contracts through OrderTicket"
```

---

## Task 7: Final Verification

**Files:**

- No new source files.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
cd backend
uv run python -m pytest tests/test_options_router.py tests/test_orders_router.py -q
```

Expected: all focused backend tests pass.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
npm test -- src/modules/moonmarket/options/__tests__/OptionsChainPage.test.tsx src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx --run
```

Expected: all focused frontend tests pass.

- [ ] **Step 3: Run build verification**

Run:

```bash
npx vite build
```

Expected: production frontend build passes.

- [ ] **Step 4: Manual smoke test with dev server**

Run:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173/moonmarket/options?conid=265598&symbol=AAPL
```

Expected:

- Options page renders.
- Expiration selector populates on a mocked/dev-authenticated backend.
- Clicking a strike lazy-loads call/put cells.
- Selecting a call or put opens OrderTicket with `OPTION`.
- Bracket controls are absent for the option target.
- Existing stock Trade still shows bracket controls.

- [ ] **Step 5: Commit verification fixes**

If Step 1, Step 2, Step 3, or Step 4 exposed a defect, fix the defect and commit the focused source/test files:

```bash
git add <changed-files>
git commit -m "fix: polish MoonMarket options flow"
```

---

## Self-Review Checklist

- Plan #6 keeps option orders single-leg only.
- Option bracket follow-up is recorded in `PROJECT_PLAN.md`.
- No ticker-string persistence crosses module boundaries; routes are keyed by underlying `conid`.
- Existing stock bracket behavior remains in scope and tested.
- Backend has a server-side option bracket guard, not only a hidden UI control.
- The options chain is lazy-loaded per strike to respect IBKR pacing.
- The options page does not add standalone symbol-search-to-trade.
