# MoonMarket Transactions - Design (Plan #4)

> Date: 2026-05-26
> Status: Draft for implementation.
> Parent spec: `docs/superpowers/specs/2026-05-25-orbit-v1-design.md`.
> Previous plan: `docs/superpowers/specs/2026-05-26-moonmarket-portfolio-design.md`.

---

## Purpose

Add the MoonMarket Transactions page to Orbit after the portfolio command deck. This page restores the useful transaction surface from the original MoonMarket reference app while keeping the consolidated Orbit architecture:

- React frontend talks only to the FastAPI sidecar.
- FastAPI sidecar talks to IBKR Client Portal through `IBKRService`.
- SQLite stores normalized fills locally for future Inflect journaling.
- `conid` remains the cross-module instrument key.

This plan intentionally does **not** add trading actions yet. The page should display recent executions and live orders, but it should not place, modify, or cancel orders. Those mutations belong with the shared `OrderTicket` plan after the read model is stable.

---

## Scope

**In scope:**

- MoonMarket local navigation between Portfolio and Transactions.
- `GET /moonmarket/trades?account_id=<id>&days=<n>` backend endpoint.
- `GET /moonmarket/live-orders?account_id=<id>` backend endpoint.
- Normalized recent trades/fills response keyed by `execution_id` and `conid`.
- Local `fills` SQLite table and idempotent upsert when trades are fetched.
- Transactions UI with:
  - Recent trades summary strip.
  - Recent trades table with side and symbol filters.
  - Symbol activity chart.
  - Volume-by-symbol chart.
  - Read-only live orders table.
- Tests for backend endpoints, DB migration/upsert, frontend API client, and UI.

**Out of scope for Plan #4:**

- Shared `OrderTicket`.
- Order preview, place, reply/confirm, modify, or cancel.
- Options orders.
- Full historical statements/imports.
- Inflect journal UI.
- Export/download workflow.
- Direct frontend calls to IBKR.

---

## Product Boundary

Plan #4 should answer: "What recently happened in the account, and what orders are currently working?"

It should not answer: "How do I create or edit a trade?" That is Plan #5.

This boundary matters because trading mutations need a separate safety pass, confirmation UX, typed backend errors, and tests around IBKR reply flows. The Transactions page can be valuable immediately as a read-only operational page and as the source of normalized fills for Inflect.

---

## Backend Shape

All endpoints live under the existing MoonMarket router:

- `GET /moonmarket/trades`
- `GET /moonmarket/live-orders`

Both endpoints require IBKR authentication via the same dependency used by the Plan #3 MoonMarket endpoints.

### Trades Endpoint

Request:

```text
GET /moonmarket/trades?account_id=U1234567&days=7
```

Rules:

- `account_id` is optional if IBKR has a selected/default account, but the frontend should pass it explicitly.
- `days` is bounded to `1..7` for the v1 endpoint.
- The sidecar fetches recent trades from IBKR.
- The sidecar normalizes trade rows into an Orbit-owned response shape.
- The sidecar upserts normalized rows into SQLite `fills`.
- The HTTP response returns the normalized rows and derived summary.

Response shape:

```json
{
  "account_id": "U1234567",
  "days": 7,
  "trades": [
    {
      "execution_id": "0000e1",
      "account_id": "U1234567",
      "conid": 265598,
      "symbol": "AAPL",
      "description": "BOT 5 AAPL",
      "side": "BUY",
      "quantity": 5,
      "price": 185.12,
      "net_amount": -925.6,
      "commission": 1.0,
      "sec_type": "STK",
      "trade_time": "2026-05-26T14:32:00Z",
      "trade_time_ms": 1779805920000
    }
  ],
  "summary": {
    "total_trades": 1,
    "total_volume": 5,
    "total_commissions": 1.0,
    "net_cash": -925.6,
    "buy_count": 1,
    "sell_count": 0
  }
}
```

### Live Orders Endpoint

Request:

```text
GET /moonmarket/live-orders?account_id=U1234567
```

Rules:

- The sidecar warms IBKR orders with `force=true` before reading orders.
- The response is read-only for this plan.
- Order rows are normalized for display but are not persisted.
- `conid` should be preserved whenever IBKR provides it.

Response shape:

```json
{
  "account_id": "U1234567",
  "orders": [
    {
      "order_id": "123456789",
      "conid": 265598,
      "symbol": "AAPL",
      "description": "BUY 5 AAPL LIMIT 180.00",
      "side": "BUY",
      "order_type": "LMT",
      "quantity": 5,
      "remaining_quantity": 5,
      "limit_price": 180.0,
      "status": "Submitted"
    }
  ]
}
```

---

## SQLite Fills Table

The `fills` table is the local source that Inflect will read later. Plan #4 only writes it from MoonMarket trade fetches.

Columns:

- `execution_id TEXT PRIMARY KEY`
- `account_id TEXT NOT NULL`
- `conid INTEGER NOT NULL`
- `symbol TEXT`
- `description TEXT`
- `side TEXT NOT NULL`
- `quantity REAL NOT NULL`
- `price REAL`
- `net_amount REAL`
- `commission REAL`
- `sec_type TEXT`
- `trade_time TEXT NOT NULL`
- `trade_time_ms INTEGER`
- `raw_json TEXT`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

The upsert key is `execution_id`. If IBKR returns an amended fill row, the local row updates rather than duplicating.

Future Inflect can join on `conid`, `account_id`, and `trade_time` without needing MoonMarket-specific tables.

---

## Frontend Shape

Plan #4 should split MoonMarket into route-aware page pieces:

```text
src/modules/moonmarket/
  MoonMarketModule.tsx       # route switch / query boundary
  MoonMarketLayout.tsx       # header, account selector, local nav
  PortfolioPage.tsx          # existing Plan #3 command deck
  TransactionsPage.tsx       # new Plan #4 screen
  TransactionCharts.tsx      # symbol activity + volume views
  TransactionsTable.tsx      # recent trades table
  LiveOrdersTable.tsx        # read-only live orders table
```

Routes:

- `/moonmarket` renders Portfolio.
- `/moonmarket/portfolio` renders Portfolio.
- `/moonmarket/transactions` renders Transactions.

Local navigation should feel like part of MoonMarket, not like a marketing nav. Use compact segmented controls or icon+label buttons in the existing dark operational style.

---

## Transactions UI

The page should keep the same density and visual language as the portfolio command deck:

```text
+--------------------------------------------------------------------+
| MoonMarket                 Portfolio | Transactions    Account     |
+--------------------------------------------------------------------+
| Summary strip: trades, volume, commissions, net cash, buy/sell mix |
+-----------------------------------------------+--------------------+
| Symbol activity chart                         | Volume by symbol   |
+-----------------------------------------------+--------------------+
| Recent Trades / Live Orders tabs                                   |
| Recent Trades: filterable fills table                              |
| Live Orders: read-only working orders table                        |
+--------------------------------------------------------------------+
```

Recent Trades tab:

- Shows latest normalized fills.
- Has side filter: All, Buys, Sells.
- Has symbol filter/search.
- Uses color carefully: green/teal for buy, rose/amber for sell, not a one-hue palette.
- Empty state explains that no recent executions were returned for the selected account/range.

Live Orders tab:

- Shows currently working orders.
- No action buttons in Plan #4.
- Status is visually scannable.
- Empty state says there are no live orders.

---

## Reference App Mapping

Use `reference/moonmarket/` as a behavioral reference, not as code to copy wholesale.

Useful references:

- `reference/moonmarket/frontend/Transactions/Transactions.tsx`
  - Summary cards.
  - Recent Trades / Live Orders tabs.
  - Symbol filters.
- `reference/moonmarket/frontend/Transactions/LiveOrdersTable.tsx`
  - Column choices for working orders.
- `reference/moonmarket/frontend/api/transaction.ts`
  - Legacy endpoint names and normalization expectations.
- `reference/moonmarket/frontend/types/transaction.ts`
  - Legacy trade/order fields.
- `reference/moonmarket/backend/api/orders.py`
  - IBKR live-orders endpoint pattern.

Do not copy the legacy styling stack, axios client, MUI components, or broad exception handling.

---

## Error Handling

Backend must preserve typed failure paths:

- Authentication/session failures return the existing auth error behavior.
- IBKR/network failures should be surfaced as gateway/service errors.
- Bad or malformed IBKR payloads should produce defensive normalization, not route crashes.
- No bare `except Exception` blocks.

Frontend should show:

- Account/auth prompts from existing MoonMarket patterns.
- A concise retryable error panel when trades or live orders fail.
- Loading states that do not shift the layout.

---

## Success Criteria

- `/moonmarket/transactions` is reachable from the MoonMarket header.
- `/moonmarket` still renders the Plan #3 portfolio command deck.
- Recent trades load through FastAPI and are normalized server-side.
- Fetched trades are idempotently upserted into the local `fills` table.
- Live orders load through FastAPI and render read-only.
- No trading mutation endpoint is exposed in the frontend.
- No direct frontend IBKR access.
- No `HistoricalDataCard` regression.
- Focused backend/frontend tests pass.
- Vite build passes.
