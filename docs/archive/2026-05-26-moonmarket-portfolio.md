# MoonMarket Portfolio Implementation Plan

> **For agentic workers:** implement task-by-task with red-green verification. Keep the slice narrow: portfolio page only.

**Goal:** Replace the MoonMarket placeholder with the approved Plan #3 portfolio dashboard: left chart workspace with graph switcher, right stacked performance cards, no `HistoricalDataCard`.

**Architecture:** Add a thin MoonMarket router backed by a `MoonMarketService` that normalizes IBKR accounts, paged positions, allocation totals, and performance series. Add frontend API methods and an Orbit-native React portfolio screen using Tailwind, lucide icons, TanStack Query, and dependency-free SVG/CSS charts.

**Tech Stack:** FastAPI, Pydantic, `IBKRService`, React 19, TypeScript, Tailwind v4, TanStack Query, Vitest, Testing Library.

---

## Task 1: Backend contracts and endpoints

- [x] Add failing tests in `backend/tests/test_moonmarket_router.py` for:
  - `GET /moonmarket/accounts`
  - `GET /moonmarket/portfolio`
  - `GET /moonmarket/performance`
- [x] Add MoonMarket Pydantic models in `backend/models/__init__.py`.
- [x] Add `backend/services/moonmarket.py`.
- [x] Update `backend/routers/moonmarket.py` to expose accounts, portfolio, and performance endpoints through `require_ibkr_auth`.
- [x] Run `cd backend && uv run pytest tests/test_moonmarket_router.py`.

## Task 2: Frontend API and pure chart helpers

- [x] Add MoonMarket response types and methods to `src/lib/api.ts`.
- [x] Add `src/modules/moonmarket/types.ts`.
- [x] Add pure helpers for formatting/chart display.
- [x] Add tests for client methods/helpers where practical.

## Task 3: Portfolio UI

- [x] Replace the MoonMarket placeholder in `src/modules/moonmarket/MoonMarketModule.tsx`.
- [x] Add graph switcher and chart views under `src/modules/moonmarket/`.
- [x] Add stacked `PerformanceCards`.
- [x] Keep the Back to Orbit affordance.
- [x] Ensure `HistoricalDataCard` is not present.
- [x] Add/update `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`.

## Task 4: Verification and commit

- [x] Run focused backend tests.
- [x] Run focused MoonMarket frontend tests.
- [x] Run `./node_modules/.bin/vite build`.
- [x] Run `npm run typecheck` and separate known baseline failures from any new failures.
- [x] Commit the completed Plan #3 work on `feature/moonmarket-portfolio`.
