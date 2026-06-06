# MoonMarket Options Chain + Single-Leg Option Orders - Design (Plan #6)

> Date: 2026-05-28
> Status: Approved design - ready for implementation plan.
> Parent specs: `docs/superpowers/specs/2026-05-25-orbit-v1-design.md` and `docs/superpowers/specs/2026-05-26-orbit-orderticket-design.md`.

---

## Purpose

Bring the proven MoonMarket options-chain workflow into Orbit without expanding the trading surface too far at once. The first pass lets a user open an options chain for a stock or ETF, lazy-load one strike at a time, select a call or put contract, and route that option contract into the shared Orbit OrderTicket.

This plan keeps option trading intentionally narrow: **single-leg option orders only**. Stock brackets remain supported exactly as they are today. Option bracket orders are deferred until single-leg options are validated on an IBKR paper account.

---

## Locked Decisions

| Topic | Decision |
|---|---|
| Scope | Options chain + single-leg option orders only. No spreads and no option brackets in Plan #6. |
| Product location | MoonMarket owns the options chain. Parallax and MoonMarket holdings can deep-link into it by underlying `conid`. |
| Keying | `conid` remains the universal key. The underlying stock/ETF `conid` identifies the chain, and the selected option contract `conid` identifies the order target. Ticker is only an IBKR secdef search/display hint. |
| Chain loading | Fetch expirations, fetch strike list for an expiration, then lazy-load call/put contract details for individual strikes. Do not snapshot every strike on initial load. |
| OrderTicket | Reuse the global right-side OrderTicket. Add `assetClass: "STK" | "OPT"` and display metadata so the ticket can label option orders and disable bracket controls for options. |
| Live policy | Keep Plan #5 behavior: preview and single-leg option mutations are allowed on paper and live accounts. Live-account frontend mutations require explicit real-money confirmation, and backend mutation routes evaluate Trading Safety before forwarding to IBKR. |
| Option brackets | Deferred. Disable in the UI for `assetClass === "OPT"` and reject multi-order option submissions server-side. Track the follow-up in `PROJECT_PLAN.md`. |

---

## User Flow

1. User is on Parallax Analysis or a MoonMarket portfolio holding.
2. User clicks **Options** for the active stock/ETF.
3. Orbit opens `/moonmarket/options?conid=<underlyingConid>&symbol=<symbol>`.
4. MoonMarket loads expirations for the underlying.
5. User selects an expiration.
6. MoonMarket loads the available strikes for that expiration.
7. User clicks a strike row to lazy-load call/put contracts for that strike.
8. User selects either the call or the put side.
9. Orbit opens the shared OrderTicket with the option contract `conid`, `assetClass: "OPT"`, and a readable option description.
10. The ticket allows preview/place/modify/cancel for a single option order on paper accounts, and keeps stock bracket behavior unchanged.

---

## Backend Design

Add a MoonMarket options read API under `/moonmarket/options`.

| Endpoint | Behavior |
|---|---|
| `GET /moonmarket/options/expirations/{underlying_conid}?symbol=AAPL` | Calls `/iserver/secdef/search` with the symbol hint, finds the `OPT` section, and returns option months/expirations. |
| `GET /moonmarket/options/chain/{underlying_conid}?expiration=JUN24` | Calls `/iserver/secdef/strikes` with `{conid, secType: "OPT", month}` and returns the sorted union of call/put strikes plus an empty chain map. |
| `GET /moonmarket/options/contract/{underlying_conid}?expiration=JUN24&strike=180` | Calls `/iserver/secdef/info` once for call and once for put, snapshots the returned option conids, and returns one lazy strike payload. |

The backend must not use ticker as a persistent key. It may require the symbol query parameter for the IBKR search call, but the route is still keyed by underlying `conid`.

Add order-surface metadata:

- `MoonMarketOrderDraft.asset_class` with alias `assetClass`, default `"STK"`.
- Server rejection for option multi-order submissions:
  - If any order has `assetClass === "OPT"` and `len(orders) > 1`, return HTTP 400 with `{"error": "option_bracket_not_supported"}`.
  - Do not forward `assetClass` to IBKR. IBKR receives the same conid/order payload as stock orders.

---

## Frontend Design

Add a MoonMarket options page at `/moonmarket/options`.

Primary layout:

- Header row: underlying symbol, current price if available, expiration selector, paper/live account badge.
- Chain table: call side left, strike column center, put side right.
- Rows start lightweight. Clicking a row lazy-loads that strike's call/put contracts.
- In-the-money shading follows the reference behavior:
  - calls with `strike < currentPrice` get the green tint.
  - puts with `strike > currentPrice` get the red tint.
- Selecting a call/put opens the shared OrderTicket:

```ts
openOrderTicket({
  conid: option.contractId,
  symbol: `${underlyingSymbol} ${expiration} ${option.strike} ${option.type.toUpperCase()}`,
  assetClass: "OPT",
  side: "BUY",
  description: `${underlyingSymbol} ${expiration} ${option.strike} ${option.type.toUpperCase()}`,
});
```

Navigation entry points:

- Parallax Analysis toolbar: add **Options** next to Trade, enabled only when `activeConid` exists.
- MoonMarket Portfolio inspector: add **Options** next to Trade/Analyze for selected positions with a stock/ETF-like asset class.
- MoonMarket layout nav: add an **Options** tab. If the route is opened without `conid`, show an empty state that points the user back to Analysis or Portfolio; do not add standalone global symbol search in Plan #6.

---

## Out of Scope

- Option bracket orders.
- Multi-leg spreads.
- Full-chain real-time greeks refresh.
- Standalone symbol search to open an options chain.
- Chart price-level order prefill.
- Autonomous option trading behavior.

---

## Success Criteria

- From Parallax or a MoonMarket holding, the user can open an options chain by underlying `conid`.
- Expiration loading, strike loading, and per-strike lazy contract loading are tested with mocked IBKR payloads.
- Selecting a call/put opens the shared OrderTicket with the option contract `conid`.
- Option orders are single-leg only:
  - UI hides/disables bracket controls for options.
  - Backend rejects multi-order option submissions.
- Existing stock bracket order behavior continues to pass.
- Focused backend pytest tests, focused frontend Vitest tests, and `npx vite build` pass.
