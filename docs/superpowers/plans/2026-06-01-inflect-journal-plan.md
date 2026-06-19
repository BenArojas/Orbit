# Inflect Journal — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Inflect v1 — a Tradezella-style monthly **P&L calendar** + a
**round-trip trade list/detail** view + **notes/tags journaling**, built on the
existing `fills` projection with a FIFO trade-matching engine and a background
fills-sync service.

**Architecture:** New `/inflect/*` backend routers over an `InflectService`
(FIFO matcher + calendar aggregation + journal CRUD), a new `InflectSyncService`
(asyncio background poll modeled on `ScannerService`), one new SQLite table
(`journal_entries`), and a new `src/modules/inflect/` frontend module mirroring
MoonMarket's module shape. Round-trip trades are **derived on demand** from
`fills` — not persisted in v1.

**Tech stack:** Python 3.12 · FastAPI · Polars · SQLite · ibind · uv · pytest —
React 19 · TypeScript · Zustand 5 · TanStack Query 5 · Tailwind v4 · shadcn/ui ·
Vitest + RTL.

**Spec:** [docs/superpowers/specs/2026-06-01-inflect-journal-design.md](../specs/2026-06-01-inflect-journal-design.md)

---

## Prerequisites

**Branch off `dev`, not main.** Per CLAUDE.md Rule 7, create a new feature
branch.

```bash
git fetch origin
git checkout dev
git pull origin dev
git checkout -b feature/inflect-journal
```

Confirm the worktree has the files this plan references:

```bash
test -f backend/services/moonmarket.py && \
test -f backend/services/scanner.py && \
test -f backend/services/db.py && \
test -f src/modules/moonmarket/MoonMarketModule.tsx && \
test -f src/orbit/OrbitShell.tsx && \
test -f src/orbit/OrbitLauncher.tsx && \
echo "OK — on dev"
```

Expected: `OK — on dev`.

### Confirm-before-coding (from spec §11)

Three of four are resolved. **Only C1 remains a blocker.**

- [ ] **C1** — Setup-dropdown vocabulary (affects Task B6 constant). STILL OPEN —
  get the real list from Ofek before Task B6.
- [x] **C2** — Market-hours gate = **extended hours (pre + post)**, not RTH-only (Task B7).
- [x] **C3** — Calendar P&L = **net of commissions** (Tasks B3/B4).
- [x] **C4** — Trading-day timezone = **US/Eastern** (Tasks B3/B4).

**Market-session source for the gate (spec §12):** use `GET /trsrv/secdef/schedule`
(`assetClass=STK`, US-equity proxy symbol), cached once/day, to derive today's
extended-hours window + holidays. Fallback to a hardcoded US/Eastern ≈04:00–20:00
window (skip weekends) if the call fails. No direct "is open now" endpoint exists.

---

## File map

### Backend — new files

| Path | Responsibility |
|---|---|
| `backend/services/inflect/__init__.py` | Package marker. |
| `backend/services/inflect/matcher.py` | FIFO round-trip matcher (pure functions over fills → trades). |
| `backend/services/inflect/service.py` | `InflectService`: calendar aggregation, trades query, journal CRUD, sync passthrough. |
| `backend/services/inflect_sync.py` | `InflectSyncService`: asyncio background fills poll (modeled on `ScannerService`). |
| `backend/constants/inflect.py` | Setup-dropdown vocabulary; trading-day TZ; sync interval. |
| `backend/routers/inflect.py` | `/inflect/*` thin routers. |
| `backend/models/inflect.py` *(or extend `models/__init__.py`)* | Pydantic models: `InflectTrade`, `InflectCalendarDay`, `InflectCalendarResponse`, `InflectTradesResponse`, `JournalEntry`, `JournalUpsertRequest`. |
| `backend/tests/test_inflect_matcher.py` | FIFO matcher unit tests. |
| `backend/tests/test_inflect_calendar.py` | Calendar aggregation tests. |
| `backend/tests/test_inflect_journal.py` | Journal upsert + retrieval tests. |
| `backend/tests/test_inflect_sync.py` | Sync-service start/stop/auth-wait tests. |
| `backend/tests/test_inflect_router.py` | Router/endpoint tests (TestClient + AsyncMock). |

### Backend — modified files

| Path | Change |
|---|---|
| `backend/services/db.py` | Add `journal_entries` table to schema; add `upsert_journal_entry`, `get_journal_entry`, `get_journal_entries_for_conids`, `list_fills_for_account_range`. All writes via `_run_write`; reads via `_run_read`. |
| `backend/main.py` | Construct `InflectService` + `InflectSyncService`; `inflect_sync.start()` in lifespan; `await inflect_sync.stop()` in shutdown; `include_router(inflect_router)`. |
| `backend/constants/ibkr_pacing.py` | *(verify only — `/iserver/account/trades` already 1/5s; no change expected.)* |

### Frontend — new files

| Path | Responsibility |
|---|---|
| `src/modules/inflect/InflectModule.tsx` | Account wiring + on-open sync + sub-page routing. |
| `src/modules/inflect/InflectLayout.tsx` | Header (month nav + monthly-stats chips), account selector, sub-tab nav. |
| `src/modules/inflect/CalendarPage.tsx` | Calendar container. |
| `src/modules/inflect/CalendarGrid.tsx` | Monthly grid. |
| `src/modules/inflect/DayCell.tsx` | One day cell (P&L color, count dot). |
| `src/modules/inflect/WeekRail.tsx` | Weekly rollups column. |
| `src/modules/inflect/TradesPage.tsx` | Trades container. |
| `src/modules/inflect/TradesTable.tsx` | Round-trip table (sortable). |
| `src/modules/inflect/TradeDetail.tsx` | Fills breakdown + stats + journal editor host. |
| `src/modules/inflect/JournalEditor.tsx` | Setup dropdown + notes + tag input. |
| `src/modules/inflect/types.ts` | Frontend types mirroring backend models. |
| `src/modules/inflect/format.ts` | P&L/duration formatting helpers (reuse MoonMarket `format.ts` patterns). |
| `src/hooks/useInflectCalendar.ts` | TanStack Query: calendar. |
| `src/hooks/useInflectTrades.ts` | TanStack Query: trades list + single trade. |
| `src/hooks/useInflectSync.ts` | Mutation: force sync (on-open + manual). |
| `src/hooks/useTradeJournal.ts` | Mutation: upsert journal → invalidate calendar+trades. |
| `src/store/inflect.ts` | Zustand: selected month, selected sub-page, selected trade id. |
| Colocated `__tests__/` for the above (module, store, hooks, key components). |

### Frontend — modified files

| Path | Change |
|---|---|
| `src/lib/api.ts` | Add `inflectCalendar`, `inflectTrades`, `inflectTrade`, `inflectSaveJournal`, `inflectSync`, `inflectSetups` (AbortSignal-threaded). |
| `src/orbit/OrbitShell.tsx` | Add `{ path: "/inflect/*", element: <InflectModule /> }`. |
| `src/orbit/OrbitLauncher.tsx` | Flip Inflect tile: `enabled={isAuthenticated}`, remove `badge="Soon"`, add `onOpen={() => navigate("/inflect")}`. |

---

## Phase A — Schema + models

- [ ] **A1.** Add `journal_entries` table (spec §4.2) to the schema block in
  `services/db.py`. Include the two indexes.
- [ ] **A2.** Add DB methods: `upsert_journal_entry` (write-lock), reads
  `get_journal_entry` / `get_journal_entries_for_conids` (via `_run_read`), and
  `list_fills_for_account_range(account_id, start_ms, end_ms)` for the matcher.
- [ ] **A3.** Add Pydantic models (`models/inflect.py`): `InflectTrade`,
  `InflectCalendarDay`, `InflectWeekRollup`, `InflectCalendarResponse`,
  `InflectTradesResponse`, `JournalEntry`, `JournalUpsertRequest`,
  `InflectSetupsResponse`.
- [ ] **A4.** Tests: `journal_entries` round-trip (insert→update→get), concurrent
  write safety (extend the existing concurrent-writes pattern).

## Phase B — Backend engine + service + sync

- [ ] **B1.** `matcher.py`: FIFO lot-queue engine (spec §5.1) as pure functions
  `match_fills(fills) -> list[InflectTrade]`. Sign-aware (longs + shorts),
  proportional commission allocation, partial scale-in/out stays one trade until
  flat, still-open → `OPEN` trade.
- [ ] **B2.** `matcher.py`: stable `trade_id` (spec §5.2) + per-trade derived
  fields (avg entry/exit, gross/net P&L, return %, hold duration). `R-multiple`
  field present but `None` in v1.
- [ ] **B3.** `service.py`: `calendar(account_id, year, month)` — pull fills for
  account in `[month-start − lookback, month-end]`, run matcher, bucket CLOSED
  trades by close date (TZ per C4), sum net P&L per day + counts, compute weekly
  rollups + month totals (matches mock's "$214K / 7 days").
- [ ] **B4.** `service.py`: `trades(account_id, from, to, status)` — matcher over
  range, filter by status, join `journal_entries` by `trade_id`, newest first.
- [ ] **B5.** `service.py`: `trade(trade_id)` (with fills + journal),
  `save_journal(trade_id, payload)` (upsert), `setups()` (constant), `sync()`
  (delegate to the shared `ibkr → trades → upsert_fills` path).
- [ ] **B6.** `constants/inflect.py`: setup vocabulary (C1 — **confirm list with
  Ofek first**), `TRADING_DAY_TZ = "US/Eastern"` (C4), `SYNC_INTERVAL_SEC = 60`,
  and the hardcoded extended-hours fallback window (≈04:00–20:00 ET).
- [ ] **B7.** `inflect_sync.py`: `InflectSyncService` modeled on
  `ScannerService` — `start()`/`stop()`/`_stop_event`, auth-wait, 60s loop,
  **extended-hours gate** (C2/D10): fetch `/trsrv/secdef/schedule` once/day for a
  US-equity proxy (cache it), derive today's pre→post window in US/Eastern, poll
  only inside it; fall back to the hardcoded ET window on schedule-fetch failure.
  Each in-window tick upserts fills. Relies on the existing pacing limiter — no
  new pacing literals (`/trsrv/*` uses the global 10 req/s cap).
- [ ] **B8.** `routers/inflect.py`: thin async handlers for the six endpoints
  (spec §6). Typed exceptions only — no bare `except Exception`.
- [ ] **B9.** `main.py` wiring: build services, `inflect_sync.start()` in
  lifespan, `await inflect_sync.stop()` in shutdown, `include_router`.
- [ ] **B10.** Tests: `test_inflect_matcher.py` (longs, shorts, scale-in/out,
  partial closes, multi-day, commission split, still-open, single-leg option),
  `test_inflect_calendar.py` (day bucketing, weekly rollups, month totals, TZ
  edge at midnight), `test_inflect_journal.py`, `test_inflect_sync.py`
  (start/stop, auth-wait, market-hours skip), `test_inflect_router.py`.
- [ ] **B11.** `cd backend && uv run pytest -v` green; `ruff` clean.

## Phase C — Frontend module

- [ ] **C1.** `src/lib/api.ts`: add the six Inflect methods (AbortSignal-threaded,
  mirror `moonmarket*` method style) + TS response types in `types.ts`.
- [ ] **C2.** `store/inflect.ts`: Zustand store (selected month, sub-page,
  selected trade id) + tests.
- [ ] **C3.** Hooks: `useInflectCalendar`, `useInflectTrades`, `useInflectSync`,
  `useTradeJournal` (journal mutation invalidates calendar + trades) + tests.
- [ ] **C4.** `InflectModule.tsx` + `InflectLayout.tsx`: account from
  `useAccountStore`, fire on-open `useInflectSync` once on mount, sub-tab nav
  (Calendar | Trades), header month nav + monthly-stats chips.
- [ ] **C5.** Calendar: `CalendarPage` + `CalendarGrid` + `DayCell` + `WeekRail`
  — green/red P&L coloring via trading-color tokens, count dot, weekly rollups,
  click day → filter Trades to that day.
- [ ] **C6.** Trades: `TradesPage` + `TradesTable` (sortable; click row → detail)
  + `TradeDetail` (fills breakdown, stats, R-multiple shown as `—`).
- [ ] **C7.** `JournalEditor.tsx`: shadcn select (setup, from `/inflect/setups`)
  + textarea (notes) + tag input (freeform chips) → `useTradeJournal` save.
- [ ] **C8.** Routing: add `/inflect/*` to `OrbitShell.tsx`; flip the launcher
  tile in `OrbitLauncher.tsx` to enabled + navigate.
- [ ] **C9.** Tests: module render, store, hooks, calendar coloring/rollups,
  trades sort, journal save → invalidation. `npm test` green; `tsc` clean.

## Phase D — Integration + verification

- [ ] **D1.** Manual: against the IBKR **paper** account, place a few round-trips
  (incl. a short and a single-leg option), confirm fills land in `fills`, the
  calendar colors the right days, totals match, and a journal note/tag persists
  across app restart.
- [ ] **D2.** Cross-check a day's calendar P&L against IBKR's own realized-P&L
  for that day (FIFO parity sanity check).
- [ ] **D3.** Confirm background sync respects pacing (no 429s) under
  background-poll + on-open + manual-refresh firing together; check logs.
- [ ] **D4.** Full suites green: `uv run pytest -v` and `npm test`; `ruff` + `tsc`
  clean. Generate a diff and self-review against CLAUDE.md Rules 1–7.
- [ ] **D5.** Update `PROJECT_PLAN.md`: add an Inflect section recording v1 scope,
  locked decisions D1–D9, and what shipped; note v2 follow-ups (Flex/CSV import,
  R-multiple/risk entry, screenshots/ratings, multi-leg options, avg-cost
  matcher, materialized trades cache).

---

## Risks & known limitations (carry into PR description)

1. **>7-day app downtime loses fills** — durable projection only covers windows
   when the app runs. v2 Flex/CSV import is the fix; schema is import-ready.
2. **`trade_id` re-key on late earlier fills** (spec §5.2) — acceptable for v1;
   document.
3. **R-multiple unavailable** — no risk/stop captured in v1; detail view leaves a
   slot.
4. **Matcher recomputes per request** — fine for v1 history sizes; v2 can
   materialize a `trades` cache without changing the API.
5. **Pre-existing backend test failures** (Phase 10 note, ~58) are unrelated;
   don't let them mask new Inflect failures — run Inflect test files explicitly
   too.

## Definition of done

- All Phase A–D checkboxes complete; C1–C4 confirmations recorded.
- Verification follows `docs/testing.md`.
- Polars-only, typed exceptions, conid-keyed, all data through the sidecar,
  no Parallax/MoonMarket journal hooks (`docs/architecture/modules.md`).
- Inflect reachable from the launcher; calendar + trades + journaling work
  against the paper account.
