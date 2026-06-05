# MoonMarket Portfolio — Design (Plan #3)

> Date: 2026-05-26
> Status: Approved direction — implement option A, "Command Deck".
> Parent spec: `docs/superpowers/specs/2026-05-25-orbit-v1-design.md`.

---

## Purpose

Replace the MoonMarket placeholder route with the first real portfolio page in Orbit. This ports the useful MoonMarket portfolio surface into the consolidated app without bringing over its legacy MUI/axios stack.

The approved layout is **option A: Command Deck**:

- Left: chart workspace with a compact graph switcher.
- Right: stacked `PerformanceCards`.
- Removed: `HistoricalDataCard` / selected-stock historical card.

---

## Scope

**In scope:**
- Backend MoonMarket endpoints for accounts, positions/allocation, and performance series.
- A real `/moonmarket` portfolio screen in the Orbit app.
- Chart switcher for allocation views.
- Stacked performance cards on the right.
- Tests for the new endpoints, API client methods, and portfolio screen.

**Out of scope for Plan #3:**
- Transactions page.
- Shared `OrderTicket`.
- Options chain.
- Cross-app deep links.
- New charting dependencies.

---

## Backend shape

All MoonMarket data flows through the existing FastAPI sidecar and `IBKRService`. The frontend never calls IBKR directly.

Endpoints:

- `GET /moonmarket/accounts`
  - Ensures IBKR accounts are loaded.
  - Returns available accounts and the selected account id.
- `GET /moonmarket/portfolio?account_id=<id>`
  - Reads paged IBKR positions from `/portfolio/{account_id}/positions/{page}`.
  - Normalizes positions by `conid`.
  - Computes allocation rows and totals server-side.
- `GET /moonmarket/performance?account_id=<id>&period=1Y`
  - Calls IBKR `/pa/performance`.
  - Normalizes `nav`, cumulative return, and time-period return series for the UI.

`conid` remains the universal instrument key. Symbols are display labels only.

---

## Frontend layout

```
┌────────────────────────────────────────────────────────────────────┐
│ MoonMarket                                   account selector/back │
├───────────────────────────────────────────────┬────────────────────┤
│ Chart header + graph switcher                 │ Performance Cards  │
│                                               │ ┌────────────────┐ │
│ Allocation chart area                         │ │ NAV            │ │
│                                               │ ├────────────────┤ │
│ Treemap / Donut / Bubbles / Leaders / Flow    │ │ Cumulative     │ │
│                                               │ ├────────────────┤ │
│ Position table/list below chart if useful     │ │ Period return  │ │
│                                               │ └────────────────┘ │
└───────────────────────────────────────────────┴────────────────────┘
```

Design notes:

- Use Orbit/Parallax visual language: dark compact workspace, thin borders, restrained glow.
- The graph switcher is icon-led and compact; it should not dominate the page.
- The left chart area owns exploration. The right column is a stable performance stack.
- The page must be useful at desktop sizes and collapse cleanly on smaller widths.
- No nested cards inside cards. The two main columns are page regions; cards are only individual metric panels.

---

## Chart views

Plan #3 keeps the MoonMarket concept of switchable allocation graphs, but implements Orbit-native, dependency-free views:

- **Treemap:** weighted allocation tiles.
- **Donut:** portfolio share by position.
- **Bubbles:** circular packing-style allocation bubbles.
- **Leaders:** ranked allocation/P&L bars.
- **Flow:** simple account-to-holdings flow view.

This intentionally avoids copying the old MUI components or importing missing MoonMarket chart dependencies.

---

## Performance cards

The right rail keeps the `PerformanceCards` idea:

- NAV trend.
- Cumulative return.
- Time-period return.
- Compact summary metrics.
- Period selector.

Charts are simple inline SVG/sparkline components for this plan. A richer charting pass can happen later if the preserved behavior needs more fidelity.

---

## Success criteria

- `/moonmarket` is a real portfolio dashboard, not a placeholder.
- Authenticated users can see accounts, positions/allocation, and performance data from the sidecar.
- The main chart area has a working graph switcher.
- The right rail contains stacked performance cards.
- `HistoricalDataCard` is not present.
- No direct frontend IBKR access, no MUI/axios import, no new chart dependency.
