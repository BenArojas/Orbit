# Phase 8 — Task 8.9: Dashboard Polish & E2E Fixes

**Branch:** `feat/dashboard-phase8-task8.9` (from `dev`)
**Date:** 2026-04-18
**Status:** ✅ Code-complete · pending code review + merge to `dev`

## Problems identified (in original order)

| # | Problem | Resolution |
|---|---------|------------|
| 1 | No loading feedback during IBKR data fetch | Per-component pulse skeletons |
| 2 | Components pop in random order, unprofessional | Enforced tier-based order (general → specific) |
| 3a | Market Pulls wrong order + not centered | Reorder + center row |
| 3b | WS may disconnect on route change | 10s grace period global WS |
| 3c | Sparklines unclear what they show | Documented (see below, no code change) |
| 4a | Market Strength + Sector Rotation gauges stuck on PENDING | Implement both (real data) |
| 4b | VIX card not clickable | Wire click → Analysis (VIX, 1D) |
| 5 | Sector performance shows too many rows | Single scrollable list, 3 visible |
| 6 | RRG height too small | Expand to flex-1 min-h 280px |
| 7 | Watchlist 500 (`'str' object has no attribute 'get'`) | Fix IBKR response unwrapping |
| 9 | Alert log always 160px even empty | Collapse to min when empty, page scrolls when populated |

_Note: original list skipped problem 8._

## Decisions (locked)

- **Data flow ordering:** staggered requests, async receive (components render as data arrives)
- **Stagger delay:** 250ms between tiers (~2s total for 9 tiers)
- **Skeleton style:** `animate-pulse` gentle fade
- **Failure UX:** auto-retry silently 1–2 times, then error state in that slot
- **WS disconnect delay on route change:** 10 seconds
- **Sector performance layout:** single scrollable list with ~3 sectors visible
- **Alert log:** collapses to min when no alerts; dashboard becomes scrollable when alerts present
- **VIX click destination:** Analysis screen, VIX conid, 1D timeframe, no indicators
- **DXY + USD/ILS:** two separate slots
- **Market Strength formula:** ~~% of S&P 500 stocks above 50-day EMA~~ →
  **% of 11 SPDR sector ETFs above 50-day EMA** (user chose ETF proxy for
  speed over full-constituent accuracy — rate-limit-friendly, re-assessed for
  v2). Threshold bands: ≥75 STRONG · ≥55 BULLISH · ≥45 MIXED · ≥25 BEARISH · <25 WEAK.
- **Sector Rotation formula:** offensive (XLK, XLY, XLC, XLF) avg perf vs
  defensive (XLP, XLU, XLV) avg perf over **1 month (21 trading days)**.
  Gauge mapping: delta from −5% to +5% → 0–100 (clamped). Badges: ≥70
  OFFENSIVE · ≥55 RISK-ON · >45 NEUTRAL · >30 RISK-OFF · ≤30 DEFENSIVE.
- **Arc gauges stubs:** implement both now

## Tier ordering (9 tiers, 250ms each)

| Tier | Delay | Component | Notes |
|------|-------|-----------|-------|
| 1 | 0ms | MarketPulse (12 tickers) | Inner left-to-right stagger ~80ms per ticker |
| 2 | 250ms | ArcGaugeRow (4 gauges) | VIX clickable |
| 3 | 500ms | SectorPerformancePanel | Scrollable, 3 visible |
| 4 | 750ms | RRGPanel | Expanded height |
| 5 | 1000ms | WatchlistSidebar | Fix 500 first |
| 6 | 1250ms | TriggerWatchlist | |
| 7 | 1500ms | TriggerRules | |
| 8 | 1750ms | WatchlistConfigSection | |
| 9 | 2000ms | AlertLog | Collapsible empty state |

## Market Pulls — new order (12 slots, centered)

```
SPX → SPY → QQQ → DIA → IWM → BTC → ETH → GLD → SLV → USO → TLT → DXY → USD/ILS
```

Wait, that's 13. Original list was 12 with "DXY/ILS" = 2 separate = 13 total. Confirmed with user: both DXY and USD/ILS are separate slots.

**Final:** 13 slots, centered in row.

## Sparkline behavior (P3 — documentation only, no code change)

- Data source: `/market/candles/{conid}?period=5D` (5-day daily candles)
- Rendering: last 12 closes → scaled bar heights
- Refresh: TanStack Query `staleTime: 60_000` (refetches if stale when visible)
- Color: green if quote change % ≥ 0, red otherwise
- **Not websocket-driven** — polls on query mount/focus

## WebSocket route-change behavior

- Problem: going Dashboard → Settings → Dashboard quickly may disconnect WS
- **Implementation:** refactored `useWebSocket` into a **module-level singleton**
  (single shared connection, subscriptions, handlers, status) with reference
  counting. When the last consumer unmounts, the socket schedules a teardown
  after 10 s; a new consumer mounting inside that window cancels the timer
  and reuses the live connection.
- On remount within 10s: teardown cancelled, no reconnect flicker
- On remount after 10s: full reconnect; panels show skeletons during refetch
- Includes `__resetWebSocketSingletonForTests` for future WS test coverage.

## Execution order (one at a time, commits per step)

1. ✅ **Fix watchlist 500** (P7) — backend, unblocks UI
2. ✅ **Expand tier system** (P2) — core infra for ordering
3. ✅ **Skeletons per component** (P1) — UX foundation
4. ✅ **Market Pulls reorder + center + sparkline doc** (P3a, 3c)
5. ✅ **WS 10s grace period + skeletons on reconnect** (P3b)
6. ✅ **Arc gauges: implement Market Strength + Sector Rotation** (P4a)
7. ✅ **VIX click → Analysis** (P4b)
8. ✅ **Sector Performance scrollable** (P5)
9. ✅ **RRG height expand** (P6)
10. ✅ **Alert Log collapsible + dashboard scroll** (P9)

Each step: branch commit + tests. Integration tests at the end.

## Open minor defaults (pre-decided, confirm if wrong)

- Retry count: **2 retries**, exponential backoff `min(1s · 2^attempt, 5s)`
- Per-ticker stagger in Market Pulls: **80ms**
- RRG new min-height: **280px container, 240px inner graph, flex-1 to grow**
- Alert log empty state: header-only (~32px) via conditional render
- Alert log populated state: **max-height 160px** with internal scroll;
  dashboard row 3 is `auto`, so row 2's `minmax(0,1fr)` shrinks and its
  existing `overflow-y-auto` scrolls as alerts fill the log.

## Tests added (per project rule 1)

- ✅ `backend/tests/test_watchlist_unwrap.py` — 9 tests, IBKR `data.user_lists`
  parsing + all fallback shapes + router defence-in-depth.
- ✅ `backend/tests/test_sectors_gauges.py` — 8 tests:
  - breadth all-above / all-below / mixed-split / skips-too-few-bars
  - rotation neutral / fully-offensive-clamps-to-100 /
    fully-defensive-clamps-to-0 / missing-groups-returns-neutral
- ✅ `src/__tests__/useIbkrReadyTier.test.ts` — 12 tests: constants,
  per-tier delay behaviour, ascending order at t=1000ms, reset-on-disconnect.
- ⏭ `test_skeleton_visibility` — deferred. Current skeletons are trivially
  swapped by the `!tier || (isLoading && !data)` guard; coverage lives in
  the tier-hook tests and the manual E2E verification below.
- ⏭ E2E dashboard load-sequence test — to be validated manually during
  code review per Phase 8's "run the real app" gating.

## Test results snapshot (at hand-off)

- **Frontend:** 31/31 passing across 3 suites
  (`useIbkrReadyTier`, `toast`, `network`).
- **Backend new tests:** 17/17 passing (9 unwrap + 8 gauges).
- **Backend pre-existing failures:** 28 failures in
  `test_scanner.py`/`test_screener.py`/`test_watchlist_config.py`/
  `test_watchlist_moves.py`/`test_gateway_reset.py` — all `MagicMock`/`AsyncMock`
  infrastructure bugs unrelated to 8.9. Flagged for a separate sweep.
- **Typecheck:** no new `tsc --noEmit` errors. One pre-existing error in
  `TriggerRules.tsx` (`asChild` on shadcn `DialogClose`) predates this branch.

## Files touched

### Backend
- `backend/constants.py` — `SECTORS_OFFENSIVE`, `SECTORS_DEFENSIVE`,
  `BREADTH_EMA_PERIOD`, `ROTATION_LOOKBACK_DAYS`, `ROTATION_RANGE_PCT`.
- `backend/services/sectors.py` — `get_market_breadth()`, `get_sector_rotation()`.
- `backend/routers/sectors.py` — `GET /sectors/breadth`, `GET /sectors/rotation`.
- `backend/services/ibkr.py` — root-cause unwrap fix for watchlist 500.
- `backend/routers/watchlist.py` — defence-in-depth non-dict filter.
- `backend/tests/test_watchlist_unwrap.py` — new.
- `backend/tests/test_sectors_gauges.py` — new.
- `backend/tests/conftest.py` — conditional `pandas_ta` stub for Python <3.12.

### Frontend
- `src/hooks/useIbkrReadyTier.ts` — 9-tier hook (was 3-tier).
- `src/hooks/useWebSocket.ts` — module-level singleton + 10s teardown grace.
- `src/__tests__/useIbkrReadyTier.test.ts` — expanded for 9 tiers.
- `src/components/dashboard/skeletons.tsx` — new skeleton library (8 variants).
- `src/components/dashboard/MarketPulse.tsx` — 13 tickers, centred, 80ms
  inner stagger, per-ticker pulse skeletons, sparkline tooltip.
- `src/components/dashboard/ArcGauge.tsx` — real breadth + rotation data,
  VIX click → Analysis(1D), per-gauge badges & subtitles.
- `src/components/dashboard/SectorPerformancePanel.tsx` — single scroll
  list (max-height 118px ≈ 3 rows) + bottom fade indicator + "scroll" hint.
- `src/components/dashboard/RRGPanel.tsx` — `flex-1 min-h-[280px]`; dots
  and trails converted to percentage coords (resize-safe) with
  `viewBox="0 0 100 100"` + `vector-effect="non-scaling-stroke"`.
- `src/components/dashboard/AlertLog.tsx` — tier 9 gate + `retry: 2`;
  collapse-to-header when empty; capped 160px scroll when populated.
- `src/components/dashboard/WatchlistConfigSection.tsx` — `retry: 2` on both queries.
- `src/components/dashboard/TriggerWatchlist.tsx` — tier 6 gate + skeleton.
- `src/components/dashboard/TriggerRules.tsx` — tier 7 gate + skeleton.
- `src/pages/DashboardPage.tsx` — grid rows → `[54px, minmax(0,1fr), auto]`;
  `min-h-0` on both row-2 columns so AlertLog can drive row 3 height.
- `src/lib/api.ts` — `MarketBreadthResponse`, `SectorRotationResponse`;
  `api.marketBreadth()`, `api.sectorRotation()`.
- `src/components/watchlist/WatchlistSidebar.tsx` — consolidated tier 5 +
  `retry: 2` on both queries + skeleton swap for inline "Loading…".

## Known follow-ups / tech debt

- Pre-existing 28 backend test failures (MagicMock vs AsyncMock) — separate PR.
- Pre-existing TS error on `TriggerRules.tsx` `DialogClose asChild` — separate PR.
- Manual E2E pass of dashboard load sequence required before merging to `dev`.
- Market Strength is an ETF-based proxy — revisit in v2 if full S&P 500
  breadth is wanted (needs constituent list + cached daily snapshot job).
