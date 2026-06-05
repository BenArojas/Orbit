# MoonMarket Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Plan #4 MoonMarket Transactions: route-aware MoonMarket navigation, read-only recent trades and live orders, and a local `fills` table that writes normalized IBKR executions for future Inflect.

**Architecture:** Extend the existing MoonMarket FastAPI router and `MoonMarketService`; add typed Pydantic contracts; add SQLite `fills` migration/upsert methods in `DatabaseService`; split the current MoonMarket frontend into shared layout, portfolio page, and transactions page; fetch data through `src/lib/api.ts` with TanStack Query.

**Tech Stack:** FastAPI, Pydantic, SQLite, `IBKRService`, React 19, TypeScript, Tailwind v4, TanStack Query v5, Vitest, Testing Library, uv/pytest.

---

## Boundaries

- [ ] Keep this branch read-only for trading operations.
- [ ] Do not add order preview/place/reply/confirm/modify/cancel UI.
- [ ] Do not add options-specific order behavior.
- [ ] Do not call IBKR directly from the frontend.
- [ ] Preserve the Plan #3 portfolio screen and `PerformanceCards`.
- [ ] Store local fills by `execution_id` and `conid`, not ticker.

---

## Task 1: Backend Models And Router Tests

Create the failing tests before implementation.

- [ ] Update `backend/tests/test_moonmarket_router.py` with `GET /moonmarket/trades`.

  Test setup:

  - Use the existing MoonMarket router fake patterns from the Plan #3 tests.
  - Fake `IBKRService._request` for `GET /iserver/account/trades` to return at least one buy and one sell execution.
  - Assert response status `200`.
  - Assert `response["account_id"]` matches the selected account.
  - Assert normalized `side` values are `BUY`/`SELL`.
  - Assert each trade includes `execution_id`, `account_id`, `conid`, `symbol`, `quantity`, `price`, `net_amount`, `commission`, `trade_time`, and `trade_time_ms`.
  - Assert `summary.total_trades`, `summary.total_volume`, `summary.total_commissions`, `summary.net_cash`, `summary.buy_count`, and `summary.sell_count`.

- [ ] Update `backend/tests/test_moonmarket_router.py` with `GET /moonmarket/live-orders`.

  Test setup:

  - Fake two calls to `/iserver/account/orders`: first with `force=true`, second returning orders.
  - Assert the returned order rows include `order_id`, `conid`, `symbol`, `description`, `side`, `order_type`, `quantity`, `remaining_quantity`, `limit_price`, and `status`.
  - Assert no cancel/modify link or action contract is returned.

- [ ] Add malformed payload coverage in `backend/tests/test_moonmarket_router.py`.

  Minimum assertions:

  - Missing optional numeric fields normalize to `None` or `0` according to the response model.
  - Missing `conid` on a trade does not create a valid fill row; the row is skipped or reported defensively.
  - Route does not raise an untyped server error for sparse IBKR rows.

- [ ] Run the focused test and confirm it fails for missing implementation:

```bash
uv run pytest tests/test_moonmarket_router.py
```

Expected result before implementation: tests fail because trades/live-orders models, service methods, and routes do not exist yet.

---

## Task 2: Pydantic Contracts

- [ ] Update `backend/models/__init__.py` with MoonMarket transaction contracts.

  Add:

  - `MoonMarketTrade`
  - `MoonMarketTradeSummary`
  - `MoonMarketTradesResponse`
  - `MoonMarketLiveOrder`
  - `MoonMarketLiveOrdersResponse`

- [ ] Use these exact field names for `MoonMarketTrade`:

```python
execution_id: str
account_id: str
conid: int
symbol: str | None = None
description: str | None = None
side: Literal["BUY", "SELL"]
quantity: float
price: float | None = None
net_amount: float | None = None
commission: float | None = None
sec_type: str | None = None
trade_time: str
trade_time_ms: int | None = None
```

- [ ] Use these exact field names for `MoonMarketTradeSummary`:

```python
total_trades: int
total_volume: float
total_commissions: float
net_cash: float
buy_count: int
sell_count: int
```

- [ ] Use these exact field names for `MoonMarketLiveOrder`:

```python
order_id: str
conid: int | None = None
symbol: str | None = None
description: str | None = None
side: str
order_type: str | None = None
quantity: float | None = None
remaining_quantity: float | None = None
limit_price: float | None = None
status: str | None = None
```

- [ ] Keep response models explicit and serializable with the existing FastAPI/Pydantic version.

---

## Task 3: SQLite Fills Table

- [ ] Update `backend/services/db.py` `_create_tables` with a `fills` table:

```sql
CREATE TABLE IF NOT EXISTS fills (
    execution_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    conid INTEGER NOT NULL,
    symbol TEXT,
    description TEXT,
    side TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL,
    net_amount REAL,
    commission REAL,
    sec_type TEXT,
    trade_time TEXT NOT NULL,
    trade_time_ms INTEGER,
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

- [ ] Add an index for future Inflect reads:

```sql
CREATE INDEX IF NOT EXISTS idx_fills_account_time
ON fills(account_id, trade_time_ms DESC)
```

- [ ] Add an index for cross-module instrument lookups:

```sql
CREATE INDEX IF NOT EXISTS idx_fills_conid_time
ON fills(conid, trade_time_ms DESC)
```

- [ ] Add `DatabaseService.upsert_fills(rows: list[dict[str, Any]]) -> int`.

  Requirements:

  - Use `await self._run_write(fn)` for the write.
  - Upsert by `execution_id`.
  - Update `updated_at = CURRENT_TIMESTAMP` on conflict.
  - Return the number of rows accepted for upsert.
  - Skip rows without `execution_id`, `account_id`, `conid`, `side`, `quantity`, or `trade_time`.
  - Store original source row as JSON in `raw_json` when provided.

- [ ] Add `DatabaseService.list_fills(account_id: str, days: int = 7) -> list[dict[str, Any]]`.

  Requirements:

  - Read from the local table for tests and future Inflect.
  - Bound `days` to `1..7`.
  - Sort newest first.

- [ ] Update `backend/tests/test_db_migrations.py`.

  Assertions:

  - New databases contain `fills`.
  - Re-running migrations is idempotent.
  - `upsert_fills` inserts a fill.
  - Re-upserting the same `execution_id` updates the row instead of duplicating.
  - `list_fills` returns newest first for the selected account.

- [ ] Run DB tests:

```bash
uv run pytest tests/test_db_migrations.py
```

Expected result after implementation: DB migration/upsert tests pass.

---

## Task 4: MoonMarket Service Methods

- [ ] Update `backend/services/moonmarket.py`.

  Add:

  - `async def trades(self, account_id: str | None, days: int, db: DatabaseService | None = None) -> MoonMarketTradesResponse`
  - `async def live_orders(self, account_id: str | None) -> MoonMarketLiveOrdersResponse`

- [ ] Implement account selection consistently with Plan #3.

  Requirements:

  - Use existing account/default account helpers where possible.
  - Return the resolved `account_id` in both responses.
  - Do not require the frontend to infer the selected account from another endpoint.

- [ ] Implement trades fetch.

  Expected IBKR call:

```python
await self.ibkr._request("GET", "/iserver/account/trades")
```

  Requirements:

  - Bound `days` to `1..7`.
  - Normalize both reference-style keys and plausible IBKR variants:
    - `execution_id`, `executionId`, `execId`
    - `trade_time_r`, `tradeTimeR`, `time`
    - `order_description`, `orderDescription`, `description`
    - `net_amount`, `netAmount`
    - `sec_type`, `secType`
  - Convert side values:
    - `B`, `BOT`, `BUY` -> `BUY`
    - `S`, `SLD`, `SELL` -> `SELL`
  - Preserve `conid` as integer.
  - Skip invalid rows that cannot produce a safe `MoonMarketTrade`.
  - Compute summary server-side.
  - Upsert valid rows into `fills` when `db` is provided.

- [ ] Implement live orders fetch.

  Expected IBKR calls:

```python
await self.ibkr._request("GET", "/iserver/account/orders", params={"force": "true"})
await self.ibkr._request("GET", "/iserver/account/orders")
```

  Requirements:

  - Normalize response bodies that are either lists or objects containing `orders`.
  - Preserve `orderId`/`order_id` as string `order_id`.
  - Normalize `ticker`/`symbol` into `symbol`.
  - Normalize `remainingQuantity`/`remaining_quantity`.
  - Normalize `price`/`limitPrice`/`limit_price` into `limit_price`.
  - No mutation action metadata in response.

- [ ] Keep typed error behavior.

  Requirements:

  - Do not add bare `except Exception`.
  - Reuse existing service/router exception patterns.
  - Sparse rows should be skipped or normalized; actual auth/network failures should remain visible.

---

## Task 5: Router Wiring

- [ ] Update `backend/routers/moonmarket.py`.

  Add:

```python
@router.get("/trades", response_model=MoonMarketTradesResponse)
async def moonmarket_trades(
    account_id: str | None = Query(default=None),
    days: int = Query(default=7, ge=1, le=7),
    ibkr: IBKRService = Depends(require_ibkr_auth),
    db: DatabaseService = Depends(get_db),
) -> MoonMarketTradesResponse:
    try:
        return await MoonMarketService(ibkr).trades(
            account_id=account_id,
            days=days,
            db=db,
        )
    except MoonMarketAccountNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "moonmarket_account_not_found", "message": str(exc)},
        ) from exc
```

```python
@router.get("/live-orders", response_model=MoonMarketLiveOrdersResponse)
async def moonmarket_live_orders(
    account_id: str | None = Query(default=None),
    ibkr: IBKRService = Depends(require_ibkr_auth),
) -> MoonMarketLiveOrdersResponse:
    try:
        return await MoonMarketService(ibkr).live_orders(account_id=account_id)
    except MoonMarketAccountNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "moonmarket_account_not_found", "message": str(exc)},
        ) from exc
```

- [ ] Keep route handlers thin: instantiate/use `MoonMarketService`, call service method, return response.

- [ ] Run focused backend verification:

```bash
uv run pytest tests/test_moonmarket_router.py tests/test_db_migrations.py
```

Expected result: all focused backend tests pass.

---

## Task 6: Frontend API Contracts

- [ ] Update `src/lib/api.ts`.

  Add TypeScript types:

  - `MoonMarketTrade`
  - `MoonMarketTradeSummary`
  - `MoonMarketTradesResponse`
  - `MoonMarketLiveOrder`
  - `MoonMarketLiveOrdersResponse`

- [ ] Add API methods:

```ts
moonmarketTrades(accountId: string, days?: number, signal?: AbortSignal): Promise<MoonMarketTradesResponse>
moonmarketLiveOrders(accountId: string, signal?: AbortSignal): Promise<MoonMarketLiveOrdersResponse>
```

- [ ] Method path requirements:

  - `moonmarketTrades("U123", 7)` calls `/moonmarket/trades?account_id=U123&days=7`.
  - `moonmarketLiveOrders("U123")` calls `/moonmarket/live-orders?account_id=U123`.
  - Use the existing request helper and AbortSignal pattern.

- [ ] Update `src/lib/api.moonmarket.test.ts`.

  Add assertions for:

  - Trades endpoint path and query params.
  - Live orders endpoint path and query params.
  - Response typing does not require frontend-side IBKR normalization.

- [ ] Run API tests:

```bash
npm run test -- src/lib/api.moonmarket.test.ts
```

Expected result: API tests pass.

---

## Task 7: Split MoonMarket Layout

- [ ] Create `src/modules/moonmarket/MoonMarketLayout.tsx`.

  Responsibilities:

  - Header.
  - Back to Orbit button.
  - Account selector.
  - Local nav for Portfolio and Transactions.
  - Shared loading/auth shell for missing accounts.

- [ ] Move current Plan #3 portfolio content from `src/modules/moonmarket/MoonMarketModule.tsx` into `src/modules/moonmarket/PortfolioPage.tsx`.

  Requirements:

  - Preserve the left chart workspace.
  - Preserve graph switcher behavior.
  - Preserve stacked `PerformanceCards`.
  - Preserve the replaced position inspector under the chart.
  - Keep existing test selectors/text stable where practical.

- [ ] Update `src/modules/moonmarket/MoonMarketModule.tsx`.

  Routing rules:

  - `/moonmarket` -> Portfolio.
  - `/moonmarket/portfolio` -> Portfolio.
  - `/moonmarket/transactions` -> Transactions.

  Implementation options:

  - Prefer `useLocation`/`useNavigate` and a small route switch because `OrbitShell` already delegates `/moonmarket/*` to this module.
  - Avoid adding a second top-level router provider.

- [ ] Update `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`.

  Assertions:

  - `/moonmarket` renders portfolio.
  - The Transactions nav item navigates to `/moonmarket/transactions`.
  - Portfolio still has graph switcher and performance cards.

---

## Task 8: Transactions Page UI

- [ ] Create `src/modules/moonmarket/TransactionsPage.tsx`.

  Data:

  - Query accounts are still owned by `MoonMarketModule`/layout.
  - Fetch trades with TanStack Query after an account is selected.
  - Fetch live orders with TanStack Query after an account is selected.
  - Default `days` to `7`.

- [ ] Create `src/modules/moonmarket/TransactionCharts.tsx`.

  Include:

  - Symbol activity chart: net cash or trade count by symbol.
  - Volume-by-symbol chart: quantity by symbol.

  Requirements:

  - Dependency-free SVG/CSS, consistent with Plan #3.
  - Stable dimensions with responsive constraints.
  - Empty state for no trades.

- [ ] Create `src/modules/moonmarket/TransactionsTable.tsx`.

  Requirements:

  - Columns: Time, Symbol, Description, Side, Quantity, Price, Net Amount, Commission.
  - Side filter: All, Buys, Sells.
  - Symbol search/filter.
  - Newest first.
  - Use `conid` only for row identity/future linking; show symbol as display label.

- [ ] Create `src/modules/moonmarket/LiveOrdersTable.tsx`.

  Requirements:

  - Columns: Symbol, Description, Side, Type, Quantity, Remaining, Limit, Status.
  - Read-only: no cancel, modify, or place buttons.
  - Status pill/indicator.
  - Empty state for no live orders.

- [ ] Keep the page visually compatible with Plan #3.

  Requirements:

  - Dark dense operational workspace.
  - No nested cards inside cards.
  - No marketing hero.
  - No single-hue purple/blue-only palette.
  - Text must fit on mobile and desktop.

---

## Task 9: Transactions UI Tests

- [ ] Add `src/modules/moonmarket/__tests__/TransactionsPage.test.tsx`.

  Test cases:

  - Renders summary metrics from mocked trades.
  - Filters recent trades by side.
  - Filters recent trades by symbol.
  - Shows live orders in read-only table.
  - Does not render cancel/modify/place controls.
  - Shows empty state when trades and live orders are empty.

- [ ] Update shared test setup only if necessary.

  Constraints:

  - Do not rewrite unrelated MoonMarket tests.
  - Mock API methods at the same boundary used by Plan #3 tests.

- [ ] Run focused frontend tests:

```bash
npm run test -- src/lib/api.moonmarket.test.ts src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx src/modules/moonmarket/__tests__/TransactionsPage.test.tsx
```

Expected result: focused MoonMarket frontend tests pass.

---

## Task 10: Browser Verification

- [ ] Start or reuse the Vite dev server.

```bash
npm run dev
```

- [ ] Open:

```text
http://127.0.0.1:5173/moonmarket/transactions
```

- [ ] Verify in the in-app browser:

  - Portfolio nav still works.
  - Transactions nav works.
  - Summary strip renders without layout shifts.
  - Recent Trades and Live Orders tabs/views are usable.
  - No action buttons appear in Live Orders.
  - Mobile-width layout does not overlap text.

---

## Task 11: Full Verification

- [ ] Run backend focused tests:

```bash
uv run pytest tests/test_moonmarket_router.py tests/test_db_migrations.py
```

- [ ] Run frontend focused tests:

```bash
npm run test -- src/lib/api.moonmarket.test.ts src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx src/modules/moonmarket/__tests__/TransactionsPage.test.tsx
```

- [ ] Run Vite build:

```bash
./node_modules/.bin/vite build
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected result:

- Focused backend tests pass.
- Focused frontend tests pass.
- Vite build passes.
- If `npm run typecheck` still fails, failures must be the known unrelated baseline only:
  - `src/__tests__/MarketPulse.test.tsx`
  - `src/__tests__/useGateway.test.ts`
  - `src/components/charts/__tests__/DrawingsLayer.test.tsx`
  - `src/store/screener.test.ts`

---

## Task 12: Self-Review And Commit

- [ ] Review diff for scope creep:

```bash
git diff --stat
git diff --check
```

- [ ] Confirm no trading mutation UI or frontend API methods were added.

- [ ] Confirm no direct frontend IBKR calls were added.

- [ ] Confirm no bare `except Exception` blocks were introduced.

- [ ] Confirm `fills` writes use `DatabaseService._run_write`.

- [ ] Commit on `feature/moonmarket-transactions`:

```bash
git add docs/superpowers/specs/2026-05-26-moonmarket-transactions-design.md \
  docs/superpowers/plans/2026-05-26-moonmarket-transactions.md \
  backend/models/__init__.py \
  backend/routers/moonmarket.py \
  backend/services/db.py \
  backend/services/moonmarket.py \
  backend/tests/test_db_migrations.py \
  backend/tests/test_moonmarket_router.py \
  src/lib/api.ts \
  src/lib/api.moonmarket.test.ts \
  src/modules/moonmarket/MoonMarketModule.tsx \
  src/modules/moonmarket/MoonMarketLayout.tsx \
  src/modules/moonmarket/PortfolioPage.tsx \
  src/modules/moonmarket/TransactionsPage.tsx \
  src/modules/moonmarket/TransactionCharts.tsx \
  src/modules/moonmarket/TransactionsTable.tsx \
  src/modules/moonmarket/LiveOrdersTable.tsx \
  src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx \
  src/modules/moonmarket/__tests__/TransactionsPage.test.tsx
git commit -m "feat: add MoonMarket transactions"
```

For the planning-only commit, stage and commit only the two new docs with:

```bash
git add docs/superpowers/specs/2026-05-26-moonmarket-transactions-design.md \
  docs/superpowers/plans/2026-05-26-moonmarket-transactions.md
git commit -m "docs: plan MoonMarket transactions"
```
