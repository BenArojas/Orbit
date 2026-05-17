# Spec B — Chart State Bugs

**Date:** 2026-05-17
**Scope:** Two chart-rendering bugs on the Analysis page.

---

## Problem

### Bug 2 — Candles disappear on rapid indicator clicks

Clicking the same indicator pill four or so times in rapid succession causes the candlestick series to vanish. The chart area itself (axis, grid, watermark) remains. Clicking another indicator brings the candles back.

### Bug 3 — Price scale stuck on previous symbol

After viewing MSFT (price range ~$400) then switching to GFS (price range ~$70), the candles load but the chart's price scale is still ~$400. The user has to manually drag the price axis to find the new candles.

---

## Approach — Bug 2 (split queries)

**Root cause.** `useChartData` uses a single TanStack Query key `["chart-data", conid, timeframe, indicatorKey]`. Toggling an indicator changes `indicatorKey`, which lands the hook on a new cache slot. Under rapid clicks, `query.data` is intermittently `undefined`, which collapses to `candles: []`. The candle series gets cleared. `placeholderData: keepPreviousData` doesn't fully save us because rapidly cycling between query keys leaves windows where no previous data carries forward.

**Change.** In `src/hooks/useChartData.ts`, split into two independent `useQuery` calls:

- `candlesQuery` — key `["candles", conid, timeframe]`. Refetches only when symbol or timeframe changes. Indicator toggles do not invalidate it.
- `indicatorsQuery` — key `["indicators", conid, timeframe, indicatorKey]`. Refetches when active indicators change.

Both keep `placeholderData: keepPreviousData` and the existing 60s `staleTime`. The hook's public return shape stays the same: `candles` from `candlesQuery`, `indicators` and `fibonacci` from `indicatorsQuery`. `isLoading` reflects `candlesQuery.isLoading` only — we don't want the chart to disappear waiting for an indicator refetch.

**Backend.** Check whether `backend/routers/market.py` already exposes a candles-only endpoint. If yes, use it. If not, either add a thin endpoint or call the existing `/indicators/compute` with an empty indicator list (cheaper than re-fetching with full indicator computation). Investigation step in the plan will pick.

**Downstream cleanup.** The existing `hasEverLoaded` workaround in `src/pages/AnalysisPage.tsx:99-104` was a previous attempt at this same bug class. Once the split lands, remove it — candles are stable across indicator toggles by construction. The indicator-overlay `useEffect` at `ChartContainer.tsx:289` will also stop churning on every candle refetch since its deps no longer co-fire.

## Approach — Bug 3 (auto-fit price on symbol change + reset button)

**Root cause.** `ChartContainer.tsx:228` calls `chart.timeScale().fitContent()` after `setData` — that fits the time axis only, never the price axis. Lightweight Charts auto-scales price by default until the user scrolls or drags, then locks. Switching symbols inherits the locked range.

**Decision (from brainstorming):** auto-fit on symbol change only; preserve zoom across timeframe and indicator changes; provide a manual reset-zoom button as the user's escape hatch.

**Change in `src/components/charts/ChartContainer.tsx`:**
- Track `prevConidRef` inside the component.
- In the candles effect (currently `:215`), after `setData`:
  - If `conid !== prevConidRef.current`: call `chart.priceScale("right").applyOptions({ autoScale: true })` then `chart.timeScale().fitContent()`.
  - Otherwise: keep current behavior — no price refit, preserving zoom/pan within the same symbol.
  - Update `prevConidRef.current = conid` after.
- This logic must not trigger on timeframe change.

**Reset-zoom button:**
- Add `resetZoomRequestId: number` and `requestResetZoom()` action to the chart store (`src/store/chart.ts`).
- `ChartContainer` subscribes to `resetZoomRequestId`. When it increments, run `priceScale("right").applyOptions({ autoScale: true })` and `timeScale().fitContent()`.
- Add a small icon button to the toolbar at `AnalysisPage.tsx:209` (near the indicator pills). On click, call `requestResetZoom()`.

This pattern avoids `useImperativeHandle` and fits the existing chart-store convention (already holds transient chart state like `fibDrawMode`, `fibCleared`).

---

## Testing

Manual:

**Bug 2:**
- Rapidly toggle the same indicator pill (e.g. RSI) ~10 times. Candles remain visible the whole time.
- Toggle different indicators in rapid sequence. Candles remain visible.
- Switch symbol mid-toggle-spam. New symbol's candles arrive without flicker.

**Bug 3:**
- Load MSFT, then switch to GFS. GFS candles appear in view — no manual drag.
- Same symbol: zoom in on a region, toggle an indicator on. Zoom is preserved.
- Same symbol: zoom in, change timeframe. Zoom is preserved.

**Reset button:**
- From a zoomed-in state on any symbol, click reset. Chart returns to full data view (autoscale price + fitContent time).

No new unit tests — these are integration-level bugs. Optionally a small unit test for the new `requestResetZoom` action.

---

## Files Touched

- `src/hooks/useChartData.ts` — split into two `useQuery` calls.
- `src/store/chart.ts` — add `resetZoomRequestId` + `requestResetZoom` action.
- `src/components/charts/ChartContainer.tsx` — auto-fit on conid change; subscribe to `resetZoomRequestId`.
- `src/pages/AnalysisPage.tsx` — remove `hasEverLoaded` workaround; add reset-zoom button to the toolbar.
- `src/lib/api.ts` and possibly `backend/routers/market.py` — only if a candles-only API call is needed (investigation step).

---

## Out of Scope

- Backend indicator computation caching or memoization.
- Live-tick (WebSocket) handling changes.
- Drawing-layer interactions.
- Any change to the chart's appearance, theme, or overlays beyond what's required to land the two fixes.
