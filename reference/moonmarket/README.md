# MoonMarket reference source

Legacy MoonMarket code, copied here as **reference for porting** into Orbit. It is
**not part of the build** — `tsconfig.json` only includes `src` and `vendor`, so nothing
here is typechecked, bundled, or imported by the app.

## Why it's here

MoonMarket's trading logic is sound but its stack is being dropped (MUI, axios, Bootstrap,
Syncfusion, etc.). During the porting plans we re-stack these files to Orbit's conventions
(shadcn + Tailwind v4, TanStack Query, fetch, Parallax's `IBKRService`/ibind). Keeping the
originals here means we don't have to switch repos while porting.

## Highest-value pieces

- `backend/api/orders.py` — full IBKR Client Portal order flow (whatif preview → place →
  reply/confirm, bracket orders, modify, cancel). The crown jewel; port to a `/moonmarket`
  router backed by Orbit's `IBKRService`.
- `frontend/StockItem/trading/*` — the `OrderPanel` that becomes the shared slide-over
  OrderTicket.
- `frontend/StockItem/options/*` — the options chain (lazy per-strike fetch, ATM scroll).
- `frontend/Portfolio/*` — portfolio page (keep charts; drop `HistoricalDataCard`).
- `frontend/Transactions/*` — transactions + live-orders table.
- `frontend/types/*`, `frontend/hooks/useOrderMutations.ts`, `frontend/stores/stockStore.ts`.

## Lifecycle

Delete this directory once Phase 1–2 porting is complete. Until then it is a read-only
crib, not code to edit in place.
