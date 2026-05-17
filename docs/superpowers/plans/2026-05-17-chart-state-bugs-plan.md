# Chart State Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two chart-rendering bugs: candles vanishing on rapid indicator toggles (Bug 2) and price scale sticking to the previous symbol's range on symbol switch (Bug 3).

**Architecture:** Split the single `useChartData` TanStack Query into two independent queries so candles are never invalidated by indicator changes. Add `conid`-change detection in `ChartContainer` to auto-fit the price scale, plus a store-driven reset-zoom button as an escape hatch.

**Tech Stack:** React 19, TanStack Query v5, Zustand, TradingView Lightweight Charts v5, TypeScript strict.

---

### Task 1: Split useChartData into two independent queries

Fixes Bug 2. Today `["chart-data", conid, timeframe, indicatorKey]` is a single query. Toggling an indicator changes `indicatorKey`, landing on an empty cache slot → `data` is briefly `undefined` → `candles: []` → chart blanks. The fix is to decouple the candles fetch from the indicator fetch.

**Files:**
- Modify: `src/hooks/useChartData.ts`

**Background — what already exists:**

`useChartData` runs one `useQuery` with key `["chart-data", conid, timeframe, indicatorKey]` calling `api.computeIndicators(...)` which POSTs to `/indicators/compute` and returns `{ candles, indicators, fibonacci }`. The hook already exposes `candles`, `indicators`, `fibonacci`, `isFetching`, etc.

`api.computeIndicators` accepts `{ conid, timeframe, indicators?: string[] }`. Passing `indicators: []` returns `{ candles: [...], indicators: [], fibonacci: null }` — a cheap candles-only response (no indicator computation on the backend).

- [ ] **Step 1: Replace the single query with two independent queries**

Replace:
```ts
const query = useQuery<IndicatorComputeResponse>({
  queryKey: ["chart-data", conid, timeframe, indicatorKey],
  queryFn: () =>
    api.computeIndicators({
      conid: conid!,
      timeframe,
      indicators: indicatorIdsToBackendNames(activeIndicators),
    }),
  enabled: ibkrReady && conid != null,
  staleTime: 60_000,
  gcTime: 5 * 60_000,
  placeholderData: keepPreviousData,
});
```

With:
```ts
const candlesQuery = useQuery<IndicatorComputeResponse>({
  queryKey: ["candles", conid, timeframe],
  queryFn: () =>
    api.computeIndicators({
      conid: conid!,
      timeframe,
      indicators: [],
    }),
  enabled: ibkrReady && conid != null,
  staleTime: 60_000,
  gcTime: 5 * 60_000,
  placeholderData: keepPreviousData,
});

const indicatorsQuery = useQuery<IndicatorComputeResponse>({
  queryKey: ["indicators", conid, timeframe, indicatorKey],
  queryFn: () =>
    api.computeIndicators({
      conid: conid!,
      timeframe,
      indicators: indicatorIdsToBackendNames(activeIndicators),
    }),
  enabled: ibkrReady && conid != null,
  staleTime: 60_000,
  gcTime: 5 * 60_000,
  placeholderData: keepPreviousData,
});
```

- [ ] **Step 2: Update the fibonacci memo and setPrimaryFib effect to read from indicatorsQuery**

Find all references to `query.data` in the file. They fall into two groups:

- `query.data?.fibonacci` (in the `fibonacci` useMemo) → change to `indicatorsQuery.data?.fibonacci`
- `query.data?.candles` (not present currently — candles are in the return) → will be handled in step 3

For the `setPrimaryFib` effect there are no direct `query.data` refs — it uses the `fibonacci` memo which we just updated.

- [ ] **Step 3: Update the return object**

Change:
```ts
return {
  candles: query.data?.candles ?? [],
  indicators: query.data?.indicators ?? [],
  fibonacci,
  fibSource,
  liveTick,
  wsStatus,
  isLoading: query.isLoading,
  isFetching: query.isFetching,
  error: query.error,
  refetch: query.refetch,
};
```

To:
```ts
return {
  candles: candlesQuery.data?.candles ?? [],
  indicators: indicatorsQuery.data?.indicators ?? [],
  fibonacci,
  fibSource,
  liveTick,
  wsStatus,
  // isLoading reflects candlesQuery only — we don't want the chart to
  // disappear while waiting for an indicator refetch.
  isLoading: candlesQuery.isLoading,
  isFetching: candlesQuery.isFetching,
  error: candlesQuery.error,
  refetch: candlesQuery.refetch,
};
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no new errors in `src/hooks/useChartData.ts`. The pre-existing errors in test files and unrelated components are fine.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useChartData.ts
git commit -m "fix(chart): split candles + indicators into independent queries (spec B bug 2)"
```

---

### Task 2: Remove the hasEverLoaded workaround from AnalysisPage

Now that candles are stable across indicator toggles, the `hasEverLoaded` guard is no longer needed. The spec calls it out explicitly as cleanup.

**Files:**
- Modify: `src/pages/AnalysisPage.tsx`

**Background — what exists:**

`AnalysisPage.tsx:96-176` contains:
- `const [hasEverLoaded, setHasEverLoaded] = useState(false);` (line ~102)
- A `useEffect` that calls `setHasEverLoaded(false)` on conid change and `setHasEverLoaded(true)` when `candles.length > 0` (lines ~103-176)
- The `ChartContainer` is conditionally rendered: `activeConid && (candles.length > 0 || hasEverLoaded)` (line ~358)

- [ ] **Step 1: Remove hasEverLoaded state and the two effects that manage it**

Remove:
1. The `useState` declaration at line ~102:
   ```ts
   const [hasEverLoaded, setHasEverLoaded] = useState(false);
   ```
2. The `setHasEverLoaded(false)` call inside the conid-change effect at line ~106:
   ```ts
   setHasEverLoaded(false);
   ```
   (Keep the rest of that effect — it still clears the AI chat.)
3. The entire `useEffect` that sets `hasEverLoaded(true)` at lines ~172-176:
   ```ts
   useEffect(() => {
     if (!hasEverLoaded && candles.length > 0) {
       setHasEverLoaded(true);
     }
   }, [candles.length, hasEverLoaded]);
   ```

- [ ] **Step 2: Simplify the ChartContainer render condition**

Change:
```tsx
{activeConid && (candles.length > 0 || hasEverLoaded) ? (
  <ChartContainer ... />
) : (
```

To:
```tsx
{activeConid && candles.length > 0 ? (
  <ChartContainer ... />
) : (
```

Also remove the comment block above it that references "Bug-3 fix" since that's now stale.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AnalysisPage.tsx
git commit -m "refactor(analysis): remove hasEverLoaded workaround — candles stable after query split"
```

---

### Task 3: Add resetZoomRequestId + requestResetZoom to chart store

Spec B calls for a reset-zoom button that triggers `ChartContainer` to run `priceScale("right").applyOptions({ autoScale: true })` + `timeScale().fitContent()`. The pattern used throughout this codebase is to increment a counter in the store — the effect in `ChartContainer` watches the counter and fires when it changes.

**Files:**
- Modify: `src/store/chart.ts`

**Background — what exists:**

`ChartState` interface starts at line ~183. The store is created at line ~290 with `create<ChartState>()`. There is no `resetZoomRequestId` yet.

- [ ] **Step 1: Add resetZoomRequestId to the ChartState interface**

After the `activeFibs` field and before the "Actions" comment in the interface (around line ~231):

```ts
/**
 * Incremented by requestResetZoom(). ChartContainer watches this and calls
 * priceScale("right").applyOptions({ autoScale: true }) + timeScale().fitContent()
 * when it changes.
 */
resetZoomRequestId: number;
```

After the existing action declarations, add:
```ts
requestResetZoom: () => void;
```

- [ ] **Step 2: Add the field initializer and action implementation**

In the `create<ChartState>()((set, get) => ({` block, add initial value:
```ts
resetZoomRequestId: 0,
```

Add the action (place it after the `clearAllActiveFibs` action, before the closing `})`):
```ts
requestResetZoom: () => set((s) => ({ resetZoomRequestId: s.resetZoomRequestId + 1 })),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no new errors in `src/store/chart.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/store/chart.ts
git commit -m "feat(chart-store): add resetZoomRequestId + requestResetZoom for reset-zoom button"
```

---

### Task 4: Auto-fit price scale on symbol change in ChartContainer

Fixes Bug 3. When the user switches from MSFT (~$400) to GFS (~$70) the price axis stays locked at $400. Lightweight Charts locks the price scale once the user has ever scrolled or dragged; switching symbols inherits the lock. The fix: detect a conid change after `setData` and re-enable autoscale just for that transition.

**Files:**
- Modify: `src/components/charts/ChartContainer.tsx`

**Background — what exists:**

- `ChartContainer` receives `conid: number | null` as a prop (line ~66).
- The candles effect runs at line ~215: `useEffect(() => { ...; candleSeries.setData(candleData); chartRef.current?.timeScale().fitContent(); }, [candles])`.
- There is no `prevConidRef` tracking in `ChartContainer` — the `prevConidRef` in `useChartData.ts` is separate and is about WebSocket subscription, not about chart rendering.
- The `resetZoomRequestId` subscription will go in a new effect (separate from the candles effect).

- [ ] **Step 1: Add prevConidRef to ChartContainer**

After the existing refs at line ~88-93, add:
```ts
const prevConidRef = useRef<number | null>(null);
```

- [ ] **Step 2: Modify the candles effect to auto-fit price on conid change**

The current candles effect (line ~215-229):
```ts
useEffect(() => {
  const candleSeries = candleSeriesRef.current;
  if (!candleSeries || candles.length === 0) return;

  const candleData: CandlestickData<Time>[] = candles.map((c) => ({
    time: c.time as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  candleSeries.setData(candleData);
  chartRef.current?.timeScale().fitContent();
}, [candles]);
```

Change to:
```ts
useEffect(() => {
  const candleSeries = candleSeriesRef.current;
  const chart = chartRef.current;
  if (!candleSeries || !chart || candles.length === 0) return;

  const candleData: CandlestickData<Time>[] = candles.map((c) => ({
    time: c.time as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  candleSeries.setData(candleData);

  if (conid !== prevConidRef.current) {
    // New symbol — re-enable autoscale so the price axis fits the new range.
    chart.priceScale("right").applyOptions({ autoScale: true });
    chart.timeScale().fitContent();
  } else {
    // Same symbol (timeframe/indicator change) — don't refit, preserve zoom.
    chart.timeScale().fitContent();
  }

  prevConidRef.current = conid;
}, [candles, conid]);
```

Note: `conid` is now added to the dependency array because we use it in the effect body.

- [ ] **Step 3: Add the resetZoomRequestId subscriber effect**

After the candles effect, add a new effect. First, read `resetZoomRequestId` from the store at the top of the component (alongside `fibCleared` and `activeFibs`):
```ts
const resetZoomRequestId = useChartStore((s) => s.resetZoomRequestId);
```

Then add the effect:
```ts
useEffect(() => {
  const chart = chartRef.current;
  if (!chart || resetZoomRequestId === 0) return;
  chart.priceScale("right").applyOptions({ autoScale: true });
  chart.timeScale().fitContent();
}, [resetZoomRequestId]);
```

The `resetZoomRequestId === 0` guard prevents the effect from firing on mount (before the user has ever pressed reset).

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no new errors in `src/components/charts/ChartContainer.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/ChartContainer.tsx
git commit -m "fix(chart): auto-fit price scale on symbol change + subscribe to reset-zoom (spec B bug 3)"
```

---

### Task 5: Add reset-zoom button to AnalysisPage toolbar

Spec B calls for a small icon button near the indicator pills. Clicking it dispatches `requestResetZoom()` to the store, which `ChartContainer` picks up and runs the auto-scale.

**Files:**
- Modify: `src/pages/AnalysisPage.tsx`

**Background — what exists:**

The toolbar div starts at line ~267. It currently contains (in order): symbol input → timeframe bar → company name badge → `IndicatorToolbar` → ATR badge → separator + fib draw buttons. The reset button goes between the ATR badge and the fib draw separator, or after `IndicatorToolbar`.

Lucide React is used throughout the project for icons. The right icon for "reset zoom" is `ZoomIn` or `Maximize2` from `lucide-react`.

- [ ] **Step 1: Import requestResetZoom from chart store**

Add `requestResetZoom` to the destructured values from `useChartStore()`:
```ts
const {
  ...
  requestResetZoom,
} = useChartStore();
```

- [ ] **Step 2: Import the icon**

Add to existing `lucide-react` import:
```ts
import { Maximize2 } from "lucide-react";
```

(If `lucide-react` is not yet imported in the file, add the import. If it is, just add `Maximize2` to the existing import.)

- [ ] **Step 3: Add the reset button to the toolbar**

In the toolbar div, after the `IndicatorToolbar` line and before the `{activeIndicators.has("atr") && ...}` line, add:

```tsx
{/* Reset zoom — re-fits the price axis and time scale to all loaded data */}
<button
  onClick={requestResetZoom}
  title="Reset zoom"
  className="flex items-center justify-center rounded border border-border p-1.5 text-[var(--text-3)] transition-all hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
>
  <Maximize2 size={12} />
</button>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AnalysisPage.tsx
git commit -m "feat(analysis): add reset-zoom button to toolbar (spec B bug 3)"
```

---

## Manual Testing Checklist

**Bug 2 — rapid indicator toggles:**
- Load a symbol (e.g. AAPL). Rapidly toggle the RSI pill ~10 times in succession. Candles remain visible the whole time.
- Toggle different indicators back and forth quickly. Candles never disappear.
- Switch symbol mid-toggle spam. New symbol's candles arrive without a blank flash.

**Bug 3 — price scale stuck on previous symbol:**
- Load MSFT (~$400 range). Then type GFS and press Enter. GFS candles appear in view without manual dragging.
- Same symbol: zoom in on a region, then toggle RSI on. Zoom is preserved.
- Same symbol: zoom in, then change timeframe to 1h. Zoom is preserved.

**Reset zoom button:**
- Load any symbol and zoom in. Click the `Maximize2` icon button. Chart returns to full data view — price axis and time scale both fit all loaded candles.

---

## Files Touched

- `src/hooks/useChartData.ts` — split into two queries
- `src/pages/AnalysisPage.tsx` — remove `hasEverLoaded`; add reset-zoom button
- `src/store/chart.ts` — add `resetZoomRequestId` + `requestResetZoom`
- `src/components/charts/ChartContainer.tsx` — `prevConidRef`; auto-fit on conid change; `resetZoomRequestId` effect

No backend changes.
