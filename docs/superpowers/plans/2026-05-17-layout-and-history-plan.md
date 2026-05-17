# Layout & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three related features on the Analysis page: (1) collapsible right panel via 32px rail + `\` shortcut, (2) wire the existing "Default Period" setting to actually control how much history loads, (3) auto-escalate to longer history periods when the user pans to the left edge of the chart.

**Architecture:** Collapsible panel state lives in `src/store/chart.ts` (transient, in-memory only). Period override flows from `useSettingsStore.defaultPeriod` → `useChartData` → `api.computeIndicators` → Python backend (new `history_period` field). Auto-load uses a period ladder escalation pattern keyed on a `loadedPeriod` state in `useChartData`; `ChartContainer` subscribes to visible-time-range changes and calls `loadMore()`.

**Tech Stack:** React 19, Zustand, TanStack Query v5, Lightweight Charts v5, TypeScript strict, FastAPI + Python 3.12.

---

### Task 1: Add rightPanelCollapsed + toggleRightPanel to chart store

The collapsible-panel state is transient (in-memory only — no persistence across sessions). The chart store (`src/store/chart.ts`) already holds transient chart-page state (`fibDrawMode`, `resetZoomRequestId`), so this fits naturally.

**Files:**
- Modify: `src/store/chart.ts`

**Background — what exists:**

`ChartState` interface at line ~183. The store initializer in `create<ChartState>()` at line ~290. Actions are declared in the interface and implemented in the initializer.

- [ ] **Step 1: Add to ChartState interface**

In the `ChartState` interface, after `resetZoomRequestId: number` and `requestResetZoom: () => void`, add:

```ts
/** True when the right sidebar is collapsed to a 32px icon rail. In-memory only — resets on reload. */
rightPanelCollapsed: boolean;
/** Toggle the right panel between expanded (340px) and collapsed (32px rail). */
toggleRightPanel: () => void;
```

- [ ] **Step 2: Add initial value + action to the create() call**

In the `create<ChartState>()((set, get) => ({` block, add initial value:
```ts
rightPanelCollapsed: false,
```

Add the action (near the other actions):
```ts
toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no new errors in `src/store/chart.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/store/chart.ts
git commit -m "feat(chart-store): add rightPanelCollapsed + toggleRightPanel (spec C collapsible panel)"
```

---

### Task 2: Collapsible right panel in AnalysisPage

Wire the new store state to the layout: dynamic grid template, collapsed rail, `\` keyboard shortcut.

**Files:**
- Modify: `src/pages/AnalysisPage.tsx`

**Background — what exists:**

- Grid layout at line ~243: `<div className="grid h-full min-h-0 grid-cols-[32px_1fr_340px]">`
- Keyboard shortcut handler `handleDrawingShortcut` at line ~120. It guards `HTMLInputElement` / `HTMLTextAreaElement` targets and handles `Escape` + drawing tool keys. The handler is added to `window` via a `useEffect` at line ~142.
- `RightSidebar` is rendered at line ~400. It receives `activeConid`, `activeSymbol`, `fibonacci`, `chartIndicators` props.
- Imports at the top include `ChevronLeft` and `ChevronRight` from `lucide-react` (or they may not be there yet — check and add if missing).

- [ ] **Step 1: Destructure rightPanelCollapsed + toggleRightPanel from useChartStore**

In the existing `useChartStore()` destructure block, add:
```ts
rightPanelCollapsed,
toggleRightPanel,
```

- [ ] **Step 2: Add ChevronLeft + ChevronRight to lucide-react import**

Add `ChevronLeft, ChevronRight` to the lucide-react import. If lucide-react is not yet imported in this file, add:
```ts
import { Maximize2, ChevronLeft, ChevronRight } from "lucide-react";
```
(Replace the existing Maximize2-only import if it's there, adding the new icons.)

- [ ] **Step 3: Add `\` shortcut to handleDrawingShortcut**

In `handleDrawingShortcut`, after the `Escape` block and before the `SHORTCUT_MAP` lookup:
```ts
if (e.key === "\\") {
  toggleRightPanel();
  return;
}
```

The full handler should look like:
```ts
const handleDrawingShortcut = useCallback(
  (e: globalThis.KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (e.key === "Escape") {
      setDrawingTool(null);
      return;
    }
    if (e.key === "\\") {
      toggleRightPanel();
      return;
    }
    const toolId = SHORTCUT_MAP[e.key.toUpperCase()];
    if (toolId) {
      setDrawingTool(activeDrawingTool === toolId ? null : toolId);
    }
  },
  [setDrawingTool, activeDrawingTool, toggleRightPanel],
);
```

- [ ] **Step 4: Change the grid to a dynamic template**

Change:
```tsx
<div className="grid h-full min-h-0 grid-cols-[32px_1fr_340px]">
```

To:
```tsx
<div className={`grid h-full min-h-0 ${rightPanelCollapsed ? "grid-cols-[32px_1fr_32px]" : "grid-cols-[32px_1fr_340px]"}`}>
```

- [ ] **Step 5: Replace RightSidebar with conditional render**

Find the `<RightSidebar .../>` render and replace it with:
```tsx
{rightPanelCollapsed ? (
  /* Collapsed: 32px rail — symmetric with the left drawing toolbar */
  <div className="flex flex-col items-center border-l border-[var(--border)] bg-[var(--bg-1)] pt-2">
    <button
      onClick={toggleRightPanel}
      title="Expand panel (\)"
      className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-3)] transition-colors hover:text-[var(--clr-cyan)]"
    >
      <ChevronLeft size={14} />
    </button>
  </div>
) : (
  <RightSidebar
    activeConid={activeConid}
    activeSymbol={activeSymbol}
    fibonacci={fibonacci}
    chartIndicators={activeIndicators}
    onCollapse={toggleRightPanel}
  />
)}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

TypeScript will complain that `RightSidebar` doesn't accept `onCollapse`. That's expected — we'll fix it in Task 3. For now the compile is expected to show one error on the `onCollapse` prop.

- [ ] **Step 7: Commit (pre-Task-3 placeholder)**

Skip this commit — commit together with Task 3 once `RightSidebar` accepts `onCollapse`.

---

### Task 3: Add collapse chevron to RightSidebar header

Add an `onCollapse` prop and a small chevron-right button in the sidebar's tab bar.

**Files:**
- Modify: `src/components/ai/RightSidebar.tsx`

**Background — what exists:**

`RightSidebar.tsx` (93 lines). Props interface at line ~30 has `activeConid`, `activeSymbol`, `fibonacci`, `chartIndicators`. The tab bar is at line ~54: a `<div className="flex border-b ...">` containing the tab buttons.

- [ ] **Step 1: Add onCollapse to the props interface**

In `RightSidebarProps`, add:
```ts
/** Called when the user clicks the collapse chevron. */
onCollapse?: () => void;
```

- [ ] **Step 2: Destructure onCollapse in the component function**

```ts
export default function RightSidebar({
  activeConid,
  activeSymbol,
  fibonacci,
  chartIndicators,
  onCollapse,
}: RightSidebarProps) {
```

- [ ] **Step 3: Add ChevronRight import**

Add to the `lucide-react` import (or add a new one):
```ts
import { ChevronRight } from "lucide-react";
```

- [ ] **Step 4: Add the collapse button to the tab bar**

In the tab bar div (`<div className="flex border-b ...">`), after the last tab button and before the closing `</div>`:
```tsx
{onCollapse && (
  <button
    onClick={onCollapse}
    title="Collapse panel (\)"
    className="ml-auto px-2 text-[var(--text-3)] transition-colors hover:text-[var(--clr-cyan)]"
  >
    <ChevronRight size={12} />
  </button>
)}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: the `onCollapse` prop error from Task 2 should now be resolved. No new errors in either file.

- [ ] **Step 6: Commit both Task 2 and Task 3**

```bash
git add src/pages/AnalysisPage.tsx src/components/ai/RightSidebar.tsx
git commit -m "feat(analysis): collapsible right panel — 32px rail + chevron buttons + backslash shortcut (spec C)"
```

---

### Task 4: Add history_period override to backend IndicatorRequest + indicators router

Currently the backend `indicators.py` always uses `TIMEFRAME_SPEC[timeframe].period` to determine how much history to fetch. We need an optional override so the frontend can request a specific time range (e.g., "3M" of daily bars instead of the default "1y").

**Files:**
- Modify: `backend/models/__init__.py`
- Modify: `backend/routers/indicators.py`

**Background — what exists:**

`IndicatorRequest` model at `backend/models/__init__.py:285`:
```python
class IndicatorRequest(BaseModel):
    conid: int
    timeframe: Literal[...] = "1D"
    indicators: list[str] = Field(default=[...], ...)
    period: Optional[str] = None  # Deprecated — ignored when timeframe is provided
```

`backend/routers/indicators.py:62-84`:
```python
spec = TIMEFRAME_SPEC.get(request.timeframe)
ibkr_period = spec.period
ibkr_bar = spec.bar
raw = await ibkr.history(request.conid, period=ibkr_period, bar=ibkr_bar)
```

The existing `request.period` field is deprecated and completely ignored. We need a NEW field `history_period` that acts as an override for the IBKR period (keeping the bar size from TIMEFRAME_SPEC).

The mapping from frontend period labels to IBKR period strings:
- "1M" → "1m", "3M" → "3m", "6M" → "6m", "1Y" → "1y", "2Y" → "2y", "5Y" → "5y"
  (Simple: lowercase the entire string — "3M".lower() = "3m", "1Y".lower() = "1y")

- [ ] **Step 1: Add history_period field to IndicatorRequest**

In `backend/models/__init__.py`, in `IndicatorRequest`, add after the `period` field:
```python
history_period: Optional[str] = None
"""
Optional override for the IBKR history fetch window.
When set, overrides the period from TIMEFRAME_SPEC while keeping the bar size.
Accepts the same labels as the frontend 'defaultPeriod' setting:
'1M', '3M', '6M', '1Y', '2Y', '5Y'.
"""
```

- [ ] **Step 2: Add the period override logic in indicators.py**

In `backend/routers/indicators.py`, after `ibkr_period = spec.period` and before the `ibkr_bar = spec.bar` line, add:

```python
# Apply history_period override if provided (keeps bar size from TIMEFRAME_SPEC)
if request.history_period:
    ibkr_period = request.history_period.lower()
```

Full context after the change:
```python
spec = TIMEFRAME_SPEC.get(request.timeframe)
if spec is None:
    log.warning("Unknown timeframe %r, falling back to 1D spec", request.timeframe)
    spec = TIMEFRAME_SPEC["1D"]

ibkr_period = spec.period
# Apply history_period override if provided (keeps bar size from TIMEFRAME_SPEC)
if request.history_period:
    ibkr_period = request.history_period.lower()

ibkr_bar = spec.bar
```

- [ ] **Step 3: Verify no Python syntax errors**

Run from the backend directory:
```bash
cd /Users/benarojasmac/Desktop/Projects/Parallax/backend && python -c "from models import IndicatorRequest; print('ok')"
```

Expected: `ok`

Also run ruff (if available):
```bash
cd /Users/benarojasmac/Desktop/Projects/Parallax/backend && uv run ruff check routers/indicators.py models/__init__.py 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/models/__init__.py backend/routers/indicators.py
git commit -m "feat(backend): add history_period override to IndicatorRequest (spec C default period)"
```

---

### Task 5: Wire defaultPeriod + loadedPeriod in useChartData

This task adds the period-escalation machinery: `loadedPeriod` state (starts at `defaultPeriod`, resets on conid change, escalates via `loadMore()`), period ladder, `isLoadingMore` flag.

**Files:**
- Modify: `src/hooks/useChartData.ts`
- Modify: `src/lib/api.ts` (add `history_period` to `IndicatorRequest`)

**Background — what exists:**

`useChartData.ts` after Spec B has:
- `candlesQuery`: key `["candles", conid, timeframe]`, calls `api.computeIndicators({ conid, timeframe, indicators: [] })`
- `indicatorsQuery`: key `["indicators", conid, timeframe, indicatorKey]`, calls `api.computeIndicators({ conid, timeframe, indicators: [...] })`

`api.ts` `IndicatorRequest`:
```ts
export interface IndicatorRequest {
  conid: number;
  timeframe: Timeframe;
  indicators?: string[];
  period?: string;  // deprecated
}
```

`src/store/settings.ts` exports `useSettingsStore`. `defaultPeriod` is a string field with default `"3M"`.

- [ ] **Step 1: Add history_period to the frontend IndicatorRequest type**

In `src/lib/api.ts`, in the `IndicatorRequest` interface, add after the deprecated `period` field:
```ts
/** Override the backend's default history window. Accepts: "1M", "3M", "6M", "1Y", "2Y", "5Y". */
history_period?: string;
```

- [ ] **Step 2: Add the period ladder constant and useSettingsStore import to useChartData.ts**

At the top of `src/hooks/useChartData.ts`, add the import:
```ts
import { useSettingsStore } from "@/store/settings";
```

After the imports, add the constant:
```ts
const PERIOD_LADDER = ["1M", "3M", "6M", "1Y", "2Y", "5Y"] as const;
type LoadedPeriod = (typeof PERIOD_LADDER)[number];
```

- [ ] **Step 3: Add loadedPeriod state to the hook**

Inside `useChartData`, after the existing state declarations (`liveTick`, `wsStatus`):

```ts
const defaultPeriod = useSettingsStore((s) => s.defaultPeriod) as LoadedPeriod;
const [loadedPeriod, setLoadedPeriod] = useState<LoadedPeriod>(
  () => (PERIOD_LADDER.includes(defaultPeriod as LoadedPeriod) ? defaultPeriod : "3M")
);
const isEscalatingRef = useRef(false);
```

Add a reset effect so `loadedPeriod` resets when conid changes or `defaultPeriod` changes:
```ts
useEffect(() => {
  const newPeriod = PERIOD_LADDER.includes(defaultPeriod as LoadedPeriod) ? defaultPeriod : "3M";
  setLoadedPeriod(newPeriod as LoadedPeriod);
  isEscalatingRef.current = false;
}, [conid, defaultPeriod]);
```

- [ ] **Step 4: Update candlesQuery to include loadedPeriod in the key and pass history_period**

Change the `candlesQuery` from:
```ts
const candlesQuery = useQuery<IndicatorComputeResponse>({
  queryKey: ["candles", conid, timeframe],
  queryFn: () =>
    api.computeIndicators({
      conid: conid!,
      timeframe,
      indicators: [],
    }),
  ...
});
```

To:
```ts
const candlesQuery = useQuery<IndicatorComputeResponse>({
  queryKey: ["candles", conid, timeframe, loadedPeriod],
  queryFn: () =>
    api.computeIndicators({
      conid: conid!,
      timeframe,
      indicators: [],
      history_period: loadedPeriod,
    }),
  ...
});
```

Also add `loadedPeriod` to `indicatorsQuery` key and payload:
```ts
const indicatorsQuery = useQuery<IndicatorComputeResponse>({
  queryKey: ["indicators", conid, timeframe, indicatorKey, loadedPeriod],
  queryFn: () =>
    api.computeIndicators({
      conid: conid!,
      timeframe,
      indicators: indicatorIdsToBackendNames(activeIndicators),
      history_period: loadedPeriod,
    }),
  ...
});
```

- [ ] **Step 5: Add loadMore callback + isLoadingMore + canLoadMore to the return**

After the existing state declarations, add:
```ts
const currentPeriodIndex = PERIOD_LADDER.indexOf(loadedPeriod);
const canLoadMore = currentPeriodIndex < PERIOD_LADDER.length - 1;
const isLoadingMore = candlesQuery.isFetching && isEscalatingRef.current;

const loadMore = useCallback(() => {
  if (!canLoadMore || candlesQuery.isFetching) return;
  const nextPeriod = PERIOD_LADDER[currentPeriodIndex + 1];
  isEscalatingRef.current = true;
  setLoadedPeriod(nextPeriod);
}, [canLoadMore, candlesQuery.isFetching, currentPeriodIndex]);

// Clear the escalating flag once the new candles arrive
useEffect(() => {
  if (!candlesQuery.isFetching) {
    isEscalatingRef.current = false;
  }
}, [candlesQuery.isFetching]);
```

Update the return object to include the new values:
```ts
return {
  candles: candlesQuery.data?.candles ?? [],
  indicators: indicatorsQuery.data?.indicators ?? [],
  fibonacci,
  fibSource,
  liveTick,
  wsStatus,
  isLoading: candlesQuery.isLoading,
  isFetching: candlesQuery.isFetching,
  error: candlesQuery.error,
  refetch: candlesQuery.refetch,
  /** Escalate to the next period in the ladder. No-op at the top. */
  loadMore,
  /** True while loading a period escalation. */
  isLoadingMore,
  /** False when already at the top of the period ladder (5Y). */
  canLoadMore,
};
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no new errors in `src/hooks/useChartData.ts` or `src/lib/api.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useChartData.ts src/lib/api.ts
git commit -m "feat(chart-data): wire defaultPeriod + loadedPeriod escalation ladder (spec C)"
```

---

### Task 6: Auto-load older candles in ChartContainer + loading pill

Subscribe to visible-time-range changes. When the user pans near the left edge, call `loadMore()`. Preserve the visible logical range when older candles arrive.

**Files:**
- Modify: `src/pages/AnalysisPage.tsx` — pass new props to ChartContainer; add loading pill
- Modify: `src/components/charts/ChartContainer.tsx` — subscribe to range change; preserve range on escalation; accept loadMore props

**Background — what exists:**

`ChartContainer` props interface at line ~58. The component currently receives: `candles`, `indicators`, `fibonacci`, `activeIndicators`, `liveTick`, `conid`, `timeframe`, `symbol`.

`AnalysisPage.tsx` extracts from `useChartData`: `candles, indicators, fibonacci, liveTick, isLoading, isFetching, error`. After Task 5 it also exposes `loadMore, isLoadingMore, canLoadMore`. These need to be destructured and passed to `ChartContainer`.

In `ChartContainer`, the candles effect at lines ~217-242 already tracks `prevConidRef` and `prevTimeframeRef` (added in Spec B Task 4). We need to add `prevFirstCandleTimeRef` to distinguish period escalation from timeframe change.

- [ ] **Step 1: Add new props to ChartContainerProps**

In `src/components/charts/ChartContainer.tsx`, add to `ChartContainerProps`:
```ts
/** Called when the user has panned near the leftmost loaded candle. */
onLoadMore?: () => void;
/** True while a period escalation is loading. */
isLoadingMore?: boolean;
/** False when already at the top of the period ladder (5Y). */
canLoadMore?: boolean;
```

Destructure them in the component function:
```ts
export default function ChartContainer({
  candles,
  indicators,
  fibonacci: _fibonacci,
  activeIndicators,
  liveTick,
  conid = null,
  timeframe = "1D",
  symbol,
  onLoadMore,
  isLoadingMore = false,
  canLoadMore = false,
}: ChartContainerProps) {
```

- [ ] **Step 2: Add prevFirstCandleTimeRef + stable callback refs**

After the existing `prevConidRef` (line ~94), add:
```ts
const prevFirstCandleTimeRef = useRef<number | null>(null);
// Stable refs so the scroll handler doesn't need to re-subscribe on every render
const onLoadMoreRef = useRef(onLoadMore);
const isLoadingMoreRef = useRef(isLoadingMore);
const canLoadMoreRef = useRef(canLoadMore);
```

Add three sync effects to keep refs current:
```ts
useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);
useEffect(() => { isLoadingMoreRef.current = isLoadingMore; }, [isLoadingMore]);
useEffect(() => { canLoadMoreRef.current = canLoadMore; }, [canLoadMore]);
```

- [ ] **Step 3: Update candles effect to preserve range on period escalation**

Replace the current candles effect (which uses `prevConidRef` and `prevTimeframeRef` from Spec B) with this expanded version:

```ts
useEffect(() => {
  const candleSeries = candleSeriesRef.current;
  const chart = chartRef.current;
  if (!candleSeries || !chart || candles.length === 0) return;

  // Capture the current visible range before any data changes.
  // Used to restore position after a period escalation (older bars loaded).
  const visibleRange = chart.timeScale().getVisibleLogicalRange();

  const candleData: CandlestickData<Time>[] = candles.map((c) => ({
    time: c.time as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  candleSeries.setData(candleData);

  const newFirst = candles[0].time;
  const isNewSymbol = conid !== prevConidRef.current;
  const isTimeframeChange = timeframe !== prevTimeframeRef.current;
  // Period escalation: same symbol, same timeframe, but more history loaded
  const isPeriodEscalation =
    !isNewSymbol &&
    !isTimeframeChange &&
    prevFirstCandleTimeRef.current !== null &&
    newFirst < prevFirstCandleTimeRef.current;

  if (isNewSymbol) {
    // New symbol: re-enable autoscale and fit the new data
    chart.priceScale("right").applyOptions({ autoScale: true });
    chart.timeScale().fitContent();
  } else if (isPeriodEscalation) {
    // Older candles loaded: restore exactly where the user was so the
    // chart doesn't jump under their hand
    if (visibleRange) {
      chart.timeScale().setVisibleLogicalRange(visibleRange);
    }
  } else {
    // Timeframe change or indicator change: fit the new data
    chart.timeScale().fitContent();
  }

  prevConidRef.current = conid;
  prevTimeframeRef.current = timeframe;
  prevFirstCandleTimeRef.current = newFirst;
}, [candles, conid, timeframe]);
```

Note: `prevTimeframeRef` must be added to `ChartContainer` if not already there from Spec B. Declare it at the refs block:
```ts
const prevTimeframeRef = useRef<Timeframe>("1D");
```

- [ ] **Step 4: Subscribe to visible-time-range changes**

After the reset-zoom effect (from Spec B), add a new effect that subscribes to the time scale's visible range changes and calls `loadMore` when the user pans near the left edge:

```ts
// Auto-load older candles when user pans near the leftmost loaded bar
useEffect(() => {
  const chart = chartRef.current;
  if (!chart) return;

  const handler = () => {
    if (!canLoadMoreRef.current || isLoadingMoreRef.current) return;
    const logicalRange = chart.timeScale().getVisibleLogicalRange();
    if (!logicalRange) return;
    // Trigger when the left edge is within 10 bars of data start (index ~0)
    if (logicalRange.from <= 10) {
      onLoadMoreRef.current?.();
    }
  };

  chart.timeScale().subscribeVisibleTimeRangeChange(handler);
  return () => {
    try { chart.timeScale().unsubscribeVisibleTimeRangeChange(handler); } catch { /* chart gone */ }
  };
}, []); // Subscribe once — handler reads from refs
```

- [ ] **Step 5: Add loading pill to ChartContainer JSX**

At the end of `ChartContainer`'s JSX (the component doesn't currently return any JSX — it just renders a div via refs). Wait, `ChartContainer` renders a `<div ref={containerRef} ...>`. We need to look at how it renders.

Actually `ChartContainer` renders:
```tsx
return (
  <div ref={containerRef} className="absolute inset-0">
    ...
    <FibDrawMode ... />
    <DrawingsLayer ... />
  </div>
);
```

Inside the main container div, add a loading pill positioned at the bottom-left:
```tsx
{/* Loading older bars pill — shown during period escalation */}
{isLoadingMore && (
  <div className="pointer-events-none absolute bottom-8 left-4 z-10 flex items-center gap-1.5 rounded-full border border-[var(--clr-cyan)] bg-[var(--bg-0)] px-3 py-1 text-[10px] text-[var(--clr-cyan)]">
    <div className="h-2.5 w-2.5 animate-spin rounded-full border border-[var(--clr-cyan)] border-t-transparent" />
    Loading older bars…
  </div>
)}
```

- [ ] **Step 6: Update AnalysisPage to destructure and pass new props**

In `src/pages/AnalysisPage.tsx`, add the new values to the `useChartData` destructure:
```ts
const {
  candles,
  indicators,
  fibonacci,
  liveTick,
  isLoading,
  isFetching,
  error,
  loadMore,
  isLoadingMore,
  canLoadMore,
} = useChartData(activeConid, timeframe, activeIndicators);
```

Pass them to `ChartContainer`:
```tsx
<ChartContainer
  candles={candles}
  indicators={indicators}
  fibonacci={fibonacci}
  activeIndicators={activeIndicators}
  liveTick={liveTick}
  conid={activeConid}
  timeframe={timeframe}
  symbol={activeSymbol || undefined}
  onLoadMore={loadMore}
  isLoadingMore={isLoadingMore}
  canLoadMore={canLoadMore}
/>
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no new errors in the files we modified.

- [ ] **Step 8: Commit**

```bash
git add src/components/charts/ChartContainer.tsx src/pages/AnalysisPage.tsx
git commit -m "feat(chart): auto-load older candles on left-edge pan + loading pill (spec C)"
```

---

## Manual Testing Checklist

**Collapsible panel:**
- Click the chevron-right in the sidebar header → panel collapses to a 32px rail. Chart takes full width minus the left toolbar.
- Click the chevron-left on the collapsed rail → restores the full panel.
- Press `\` from anywhere on the page → toggles. Press while focused in the symbol input → does NOT toggle (guard works).

**Default Period:**
- Go to Settings, change "Default Period" from 3M to 1Y. Return to Analysis. Open a new symbol (e.g. AAPL). The chart loads roughly 1 year of bars (more bars than the 3M default).
- Change back to 3M. Open another symbol. Loads ~3 months.

**Auto-load on scroll:**
- Open a chart with default 3M. Pan left until the leftmost visible bar is near the start of the data. "Loading older bars…" pill appears. Older candles arrive. The visible window stays put — does not jump or snap.
- Continue panning through escalations: 3M → 6M → 1Y → 2Y → 5Y.
- At 5Y (top of ladder), panning does not trigger another load; no spinner appears.
- Switch symbol mid-escalation → `loadedPeriod` resets to `defaultPeriod`.

---

## Files Touched

- `src/store/chart.ts` — add `rightPanelCollapsed` + `toggleRightPanel`
- `src/pages/AnalysisPage.tsx` — dynamic grid; collapsed rail; `\` shortcut; pass loadMore props
- `src/components/ai/RightSidebar.tsx` — accept and display `onCollapse` chevron
- `src/lib/api.ts` — add `history_period` to `IndicatorRequest`
- `src/hooks/useChartData.ts` — `loadedPeriod` state; period ladder; `loadMore`; `isLoadingMore`; `canLoadMore`
- `src/components/charts/ChartContainer.tsx` — new props; scroll subscription; range preservation; loading pill
- `backend/models/__init__.py` — add `history_period` to `IndicatorRequest`
- `backend/routers/indicators.py` — use `history_period` override when provided

---

## Out of Scope

- Per-chart period override in the chart toolbar (deferred)
- Custom date-range pickers
- Persisting collapsed/expanded panel state across sessions (in-memory only)
- Deep IBKR pacing-failure recovery (rely on the existing error toast)
