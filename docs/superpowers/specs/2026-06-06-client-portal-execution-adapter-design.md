# Client Portal execution adapter - Design

> Date: 2026-06-06
> Status: Branch spec for the architecture finding.
> Parent finding: `docs/superpowers/specs/2026-06-06-v1-foundation-architecture-findings.md`

## Problem

Domain services still know too much about IBKR Client Portal transport details. `OrderService` builds endpoint paths, chooses HTTP verbs, and wraps payloads for order mutation calls. `MoonMarketService` does the same for live orders, trades, account funds, positions, rules, and performance.

That makes future execution adapters harder because a TWS execution path would need to duplicate or replace private `_request` call sites spread across domain services.

## Solution

Introduce a backend execution adapter module that owns Client Portal endpoint paths and wire payload quirks for execution and account behavior. `IBKRService` remains the only HTTP transport owner; the adapter is the Client Portal-specific interface over that transport. Domain services should call intent-level adapter methods instead of `ibkr._request(...)`.

## Public Interface

Start with `backend/services/client_portal_execution.py`.

- `ClientPortalExecutionAdapter.preview_order(account_id, order_payload)`
- `ClientPortalExecutionAdapter.place_orders(account_id, order_payloads)`
- `ClientPortalExecutionAdapter.reply_order(reply_id, confirmed)`
- `ClientPortalExecutionAdapter.cancel_order(account_id, order_id)`
- `ClientPortalExecutionAdapter.modify_order(account_id, order_id, order_payload)`
- `ClientPortalExecutionAdapter.live_orders()`
- `ClientPortalExecutionAdapter.order_rules(conid, is_buy)`
- `ClientPortalExecutionAdapter.account_summary(account_id)`
- `ClientPortalExecutionAdapter.revalidate_positions(account_id)`
- `ClientPortalExecutionAdapter.trades(days)`
- `ClientPortalExecutionAdapter.position_page(account_id, page)`
- `ClientPortalExecutionAdapter.ledger(account_id)`
- `ClientPortalExecutionAdapter.all_periods(account_id)`
- `ClientPortalExecutionAdapter.portfolio_positions(account_id)` — Inflect's aggregate current-position read (`/portfolio2/.../positions`), exposed through the `InflectExecutionAdapter` protocol (added 2026-06-10).

The interface hides Client Portal endpoint paths, HTTP verbs, order-list wrappers, reply payload shape, and future pacing or transport-specific rules.

`InflectService` reads current positions through the `InflectExecutionAdapter` protocol instead of calling `ibkr._request` directly; the default wiring uses `ClientPortalExecutionAdapter`.

`OrderService` keeps order-domain validation and payload normalization, but sends already-normalized payloads through the adapter.
`MoonMarketService` keeps account resolution and response normalization, but asks the adapter for live-order, contract-rule, account-summary, position-revalidation, trades, portfolio-page, ledger, and all-periods payloads instead of building Client Portal calls itself.

## Vertical Slices

- **Slice 1 - AFK:** Move order preview/place/reply/cancel/modify transport calls behind the Client Portal execution adapter. Prove the existing `/moonmarket/orders` routes still behave the same while `OrderService` no longer calls `_request` directly.
- **Slice 2 - AFK after slice 1 approval:** Move live-order refresh and order-rules reads from `MoonMarketService` behind the adapter. This widens the adapter from mutation behavior into execution-adjacent reads without changing frontend response contracts.
- **Slice 3 - AFK after slice 2 approval:** Move account funds and position revalidation behind the adapter. This starts the account-behavior side of the finding without changing router response shapes.
- **Slice 4 - AFK after user decision:** Move trade history and portfolio/performance reads into the same adapter after the user confirms that they should not split into a separate account-data adapter.

## Out Of Scope

- No frontend API shape changes.
- No trading safety policy changes.
- No autonomous trading behavior.
- No TWS implementation in this branch.
- No broad migration of all `ibkr._request` callers before the first order-mutation slice is verified.

## Testing

Slice 1 uses TDD through the adapter public interface and the existing `/moonmarket/orders` router public interface. The adapter tests should assert intent-level methods produce the existing Client Portal calls. Router tests should continue proving frontend-facing behavior without depending on private transport details beyond the fake adapter boundary.

Slice 2 extends that pattern: adapter tests prove live-order refresh and contract-rule requests, while `MoonMarketService` tests prove the service can normalize those responses through the adapter boundary with no direct `_request` use in those paths.

Slice 3 keeps the same rule for account behavior: adapter tests prove summary and position-invalidation requests, and `MoonMarketService` tests prove account-funds shaping and revalidation responses still work through the adapter boundary.

Slice 4 finishes the finding for MoonMarket reads: adapter tests prove trade-history, position-page, ledger, and all-periods requests, and `MoonMarketService` tests prove trades, portfolio shaping, and performance shaping still work through the adapter boundary.
