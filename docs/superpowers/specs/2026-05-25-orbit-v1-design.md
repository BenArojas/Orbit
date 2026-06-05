# Orbit v1 — Design

> Product name: **Orbit** (the parent launcher). Not affiliated with IBKR — "IBKR Hub" was an earlier working title.

> Date: 2026-05-25
> Status: Approved design — ready for implementation plan.
> Supersedes the relevant open questions in `PLAN.md` (the Orbit master plan; formerly the IBKR Hub master plan). This doc records the v1 decisions; `PLAN.md` remains the long-form roadmap.

---

## Purpose

Unify **Parallax** (technical analysis) and **MoonMarket** (portfolio + trading) under a single Tauri desktop binary called **Orbit**, with **Inflect** (trading journal) as a future module. Orbit authenticates with IBKR once and exposes the apps from a single launcher. This document defines the v1 scope and the key design decisions; it does not re-derive the full roadmap in `PLAN.md`.

---

## Decisions (locked for v1)

| Topic | Decision |
|---|---|
| Repo / architecture | Monorepo, **one React app**, one FastAPI sidecar, one Tauri binary, one SQLite DB. Route groups `/parallax/*` and `/moonmarket/*`; launcher at `/`. |
| Auth + launcher | **Combined into one screen** (route `/`). No separate launcher step. |
| App gating | App icons are grayed/unclickable until IBKR gateway is authenticated, then colorize and become clickable. |
| Order ticket | **Right-side slide-over drawer**, shared across both apps. Reuses the existing `OrderPanel` + trading-target engine. |
| Cross-app navigation | Stateless deep-link by `conid`. No shared trade state. |
| Options | Keep the existing chain; route orders through the shared ticket. **Phase 2** (live-data testing is hard; defer). |
| MoonMarket charts | Keep all portfolio charts as-is (look unchanged). Everything non-chart is re-themed to match Parallax. |
| Stack | Drop MUI / axios / Bootstrap → shadcn + Tailwind v4 + TanStack Query (match Parallax). Charts keep their current rendering. |

---

## 1. Architecture

```
orbit/                     ← Tauri shell + single React app
  src/
    routes/
      /                    ← combined Auth + Launcher screen
      /parallax/*          ← Parallax module (lifted in as-is)
      /moonmarket/*        ← MoonMarket module (re-stacked to shadcn)
    shared/
      OrderTicket/         ← slide-over order ticket (used by both apps)
      session store        ← useSessionStore: IBKR auth, selected account, health
      WS hook              ← single WebSocket connection, modules register handlers
      ui/                  ← shared shadcn components, symbol search, status pills
  backend/                 ← consolidated FastAPI sidecar (localhost)
    routers (shared):  /auth   /market   /ws
    routers (split):   /parallax/*        /moonmarket/*
    SQLite (shared):
      instruments          ← conid cache, owned by Parallax, read by all
      fills                ← written by MoonMarket on fills (future Inflect hook)
      watchlists, trigger_rules, trigger_hits, settings   ← Parallax
```

`conid` is the universal instrument key across all modules. Never link instruments by ticker string across module boundaries.

Merging both frontends into one React app is real upfront work, but it is the foundation that makes shared auth, a single WebSocket, shared components, and cross-app navigation possible.

---

## 2. Combined Auth + Launcher screen (route `/`)

One screen, two stacked regions:

- **Top:** IBKR gateway status + login prompt (lifted from Parallax's existing auth flow).
- **Below:** three app icons —
  - **Parallax** and **MoonMarket** — grayed and unclickable until `useSessionStore.authenticated === true`; on auth they colorize and become clickable.
  - **Inflect** — grayed with a "Coming soon" tag. The icon exists in v1 so the full vision is visible, but the module is not built until Phase 4.

Gating is driven entirely by the shared `useSessionStore` IBKR auth status. There is no separate post-auth launcher screen.

---

## 3. Shared OrderTicket (right-side slide-over)

Promote the existing `OrderPanel` + `tradingTarget` concept out of `StockItem` into `shared/OrderTicket/`. It is summoned from anywhere by conid:

```ts
openOrderTicket({ conid, type: 'STOCK' | 'OPTION', preset?: { side, price } })
```

- **Reuses the proven backend flow unchanged** (`backend/api/orders.py`): `whatif` preview → place → reply/confirm, plus bracket orders (profit-taker + stop), modify, cancel.
- Slides in over the current page in **either** app; preserves on-screen context (no navigation).
- In Parallax, clicking a chart price level can pre-fill the limit price via `preset`.
- Stocks and options flow through the **same** ticket via the trading-target mechanism (already how StockItem works today).

> **Alternative considered — centered modal dialog (Robinhood / Public style):**
> A global "Trade" button opening a centered overlay dialog. It is the cleanest and most
> focused form factor, but it covers the chart/portfolio behind it, so the user loses
> context while deciding. We chose the right-side slide-over instead because it is the only
> option that simultaneously satisfies "reusable in both apps," "keep each page tight," and
> "trade without leaving the chart." If the slide-over proves cramped in practice, the modal
> remains a viable fallback since both consume the same `OrderTicket` component and engine.

---

## 4. Cross-app navigation bridge

Stateless, keyed by `conid`:

- MoonMarket detail/positions → **"Analyze in Parallax →"** (deep-links the Parallax chart pre-loaded with that conid).
- Parallax analysis → **"View in Portfolio →"** (jumps to MoonMarket's position view for that conid).

No shared trade state — only the conid is passed.

---

## 5. Options (Phase 2)

Keep the existing chain (`frontend/src/pages/StockItem/options/OptionsChain.tsx`) — lazy per-strike fetch, auto-scroll to ATM, contract-select sets the trading target. Re-stack to shadcn and route option orders through the shared ticket.

**Deferred to Phase 2** because live chain data (greeks, bid/ask across strikes) is heavy on IBKR's pacing limits and hard to test reliably. When implemented: verify on the paper account first; if live data is flaky, ship with snapshot/delayed data rather than cutting the feature.

**Plan #6 decision (2026-05-28):** options ship as **single-leg orders only** first. Option bracket orders are explicitly deferred until after single-leg option orders are validated on an IBKR paper account. Keep the follow-up visible in `PROJECT_PLAN.md` before any options trading-depth pass.

---

## 6. MoonMarket v1 scope

**In scope (v1):**
- **Portfolio page** — keep all charts (the main allocation visualization: Treemap / `DataGraph` with `GraphMenu` view switching). Right column: keep the **stacked performance cards** (`PerformanceCards`) and their design. **Remove** the bottom-right selectedStock chart (`HistoricalDataCard`).
- **Transactions page** — kept for v1 (includes the live-orders table).
- **Shared OrderTicket** — stocks.
- **Account selection.**
- `fills` table written when fills arrive (the future Inflect hook). Inflect itself is not built.

**Re-theming:** Everything that is not a chart is restyled to the Parallax theme (shadcn + Tailwind v4). Charts keep their current rendering and look.

**Deferred:** Options through the ticket (Phase 2).

---

## 7. Phasing

- **Phase 1 — Vertical slice (usable end-to-end):**
  Orbit frame (combined auth + launcher, gray-until-connected icons) · one-React-app skeleton · consolidated FastAPI sidecar · MoonMarket Portfolio (all charts kept, selectedStock chart removed, performance cards kept) · Transactions page · shared OrderTicket (stocks) · cross-app navigation bridge.
- **Phase 2 — Options + trading depth:**
  Options chain re-stacked and routed through the shared ticket · any remaining order-management polish.
- **Phase 3 — Integration polish:**
  Shared component library, visual-consistency pass, Orbit settings, build + distribution.
- **Phase 4 — Inflect:**
  Trading journal module (reads `fills` + Parallax `/indicators`). Built last.

---

## Out of scope (v1)

- Inflect (Phase 4).
- Options trading (Phase 2).
- Cloud LLM, multi-account beyond IBKR's native selection, mobile companion.
