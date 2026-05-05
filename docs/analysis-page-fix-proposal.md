# Analysis Page — Fix Proposal

**Status:** Draft, awaiting implementation
**Owner:** Both (Ben + Ofek)
**Created:** 2026-05-04
**Phase mapping:** Pre-Phase 8 cleanup. Phase 8 task 8.5 (indicator accuracy E2E) cannot be reliably written until these bugs are fixed — testing a broken page locks in the bugs.

---

## 1. Branch plan

Five branches, sequential. Project rule #7 (one branch per feature/fix).

| # | Branch | Scope | Est |
|---|--------|-------|-----|
| 1 | `fix/analysis-quick-wins` | Logo hide, volume default off, theme-aware chart colors, symbol-input sync, ticker+company header, chart watermark | ~1 day |
| 2 | `fix/analysis-timeframe-bar` | Backend `(period, bar)` table rewrite, frontend timeframe mapping, queryKey fix, tests | ~1 day |
| 3 | `fix/analysis-indicators` | BB rendering, ATR numeric badge, MACD empty-panel fix, sub-chart re-toggle fix | ~1 day |
| 4 | `fix/analysis-ai-panel` | Drop Manual button, fix stuck "Analyzing X…" state, structured-output timeouts | ~1 day |
| 5 | `feat/analysis-watchlist-triggers` | Right-sidebar tabs (AI / Watchlists / Triggers) | ~1.5 days |

Each branch ends with: PR to `dev`, passing tests, manual smoke check on Analysis page.

---

## 2. Branch 1 — Quick wins

### 2.1 TradingView logo

**Files:** `src/components/charts/ChartContainer.tsx`, `src/components/charts/SubChartPanel.tsx`

**Change:** Add `attributionLogo: false` to `layout` options in both `createChart` calls.

```ts
const chart = createChart(container, {
  layout: {
    background: { ... },
    textColor: ...,
    attributionLogo: false,   // ← add
  },
  ...
});
```

**Test:** Visual smoke. No unit test.

---

### 2.2 Volume default off

**Files:** `src/components/charts/ChartContainer.tsx`

**Current:** Volume histogram series is added unconditionally on chart create (line 143). Visible regardless of `activeIndicators.has("volume")`.

**Change:**
- Remove unconditional `addSeries(HistogramSeries, ...)` from chart-create effect.
- Treat volume like any other indicator: add/remove via a new `addVolumeOverlay` / `removeVolumeOverlay` pair, called from the indicator-overlay effect when `activeIndicators.has("volume")` toggles.
- Move volume rendering into `src/components/charts/indicatorOverlays.ts` next to the EMA/BB/VWAP overlays. Add `"volume"` to `OVERLAY_INDICATOR_IDS`.
- Live-tick effect (line 206) needs to no-op when volume series is null.

**Test:** Existing chart tests must still pass. Add a new test in `src/components/charts/__tests__/indicatorOverlays.test.ts` (create if missing) verifying that volume series is added when "volume" is in activeIndicators and removed when it's toggled off.

---

### 2.3 Theme-aware chart colors

**Files:** `src/components/charts/ChartContainer.tsx`, `src/components/charts/SubChartPanel.tsx`, `src/store/settings.ts` (if it owns theme)

**Decision:** Q2 → option (a) — read CSS variables at chart-create time and re-apply on theme change.

**Change:**
- New helper `src/components/charts/chartTheme.ts` exporting:
  ```ts
  export function readChartTheme(): ChartThemeColors {
    const cs = getComputedStyle(document.documentElement);
    return {
      bg: cs.getPropertyValue("--bg-0").trim(),
      gridLines: cs.getPropertyValue("--chart-grid").trim(),
      text: cs.getPropertyValue("--text-3").trim(),
      borderColor: cs.getPropertyValue("--border").trim(),
      // up/down/wick colors stay from existing INDICATOR_COLORS — those are semantic (green=up, red=down) regardless of theme
    };
  }
  ```
- In `ChartContainer` and `SubChartPanel`: replace hard-coded `CHART_COLORS.bg` / `gridLines` / `text` / `borderColor` with `readChartTheme()` at create-time.
- Subscribe to theme changes (whatever mechanism the settings store uses — likely a Zustand subscribe or a `MutationObserver` on `document.documentElement` class). On theme change call `chart.applyOptions({ layout: { background: ..., textColor: ... }, grid: ..., timeScale: ..., rightPriceScale: ... })`.
- May need new CSS variables in `src/styles.css` if `--chart-grid` doesn't exist (use a `--bg-3` or similar).

**Test:** Add unit test for `readChartTheme` (mock `getComputedStyle`). Manual visual smoke for theme toggle.

---

### 2.4 Symbol input desync

**Files:** `src/store/navigation.ts`, `src/pages/AnalysisPage.tsx`, `src/lib/api.ts` (verify resolveConid response shape)

**Two root causes:**
1. `navigateToAnalysis(conid)` only sets `activeConid`, never `activeSymbol`. Stale symbol leaks across navigations.
2. `AnalysisPage` `symbolInput` is initialized once from `activeSymbol`. No `useEffect` resyncs it when the store changes.

**Change:**

1. `src/store/navigation.ts`:
   ```ts
   navigateToAnalysis: (conid: number, symbol: string) => void;
   ```
   Update to set both `activeConid` and `activeSymbol`. Audit all call sites — anywhere `navigateToAnalysis(conid)` is called must now pass the symbol too. Search: `grep -rn navigateToAnalysis src/`.

2. `src/pages/AnalysisPage.tsx`:
   ```ts
   useEffect(() => {
     if (!inputFocused) setSymbolInput(activeSymbol);
   }, [activeSymbol, inputFocused]);
   ```
   This makes the input mirror store state whenever the user isn't actively typing.

**Test:**
- Unit test in `src/store/navigation.test.ts` (create if missing) — `navigateToAnalysis(123, "QQQ")` sets both fields.
- Integration test in `src/pages/__tests__/AnalysisPage.test.tsx` — mock store, assert input value updates on store change.

---

### 2.5 Ticker + company name header (Q3 = D)

**Files:** `src/pages/AnalysisPage.tsx`, `src/components/charts/ChartContainer.tsx`, `src/lib/api.ts`

**Decision:** Both — small badge next to symbol input AND watermark on chart.

**Change:**

1. **Header badge (toolbar):** Right after the symbol input, render:
   ```tsx
   <div className="flex flex-col leading-tight">
     <span className="font-mono text-sm font-bold">{activeSymbol || "—"}</span>
     <span className="text-[10px] text-[var(--text-3)] truncate max-w-[200px]">
       {companyName || ""}
     </span>
   </div>
   ```
   Source for `companyName`: pull from instruments table via a new query or extend `resolveConid` to return it. Verify backend response shape — `IndicatorComputeResponse` doesn't carry it, but `/instruments` does. Cleanest: new `useInstrument(conid)` hook that hits `GET /instruments/{conid}` (verify endpoint exists; if not, add it).

2. **Chart watermark:** Use Lightweight Charts native watermark feature (v5: `watermark` plugin, or `chart.applyOptions({ watermark: { ... } })` if v5 deprecated this, render an absolutely-positioned div in the chart container parent):
   ```tsx
   <div className="absolute top-2 left-3 pointer-events-none z-10">
     <span className="font-mono text-2xl font-bold opacity-10">{activeSymbol}</span>
   </div>
   ```

**Test:** Snapshot test of `AnalysisPage` with a mocked active symbol. Visual smoke for watermark.

---

## 3. Branch 2 — Timeframe + bar fix

### 3.1 Backend constants overhaul

**Files:** `backend/constants/__init__.py`, new `backend/constants/ibkr_history.py`

**Current bug:** `PERIOD_BAR` has 7 entries indexed by frontend period string (`"1D"`, `"5D"`, etc.) and each maps to a fixed `(period, bar)` IBKR pair. Frontend timeframes `15m`/`1h` collapse to the same period; `4h`/`1D` collapse to the same period. The `IndicatorRequest` model has no `bar` field.

**Change:**

1. Create `backend/constants/ibkr_history.py`:
   ```python
   """
   IBKR /iserver/marketdata/history — canonical period/bar combinations.

   Source: IBKR Client Portal Web API docs.
   Each entry maps a frontend timeframe → (ibkr_period, ibkr_bar, est_max_bars).
   All combinations:
     - Respect IBKR step-size table (period → allowed bar range)
     - Stay under the 1000-bar response limit
     - Use the longest history that still fits
   """
   from typing import Literal, NamedTuple

   Timeframe = Literal["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"]

   class HistorySpec(NamedTuple):
       period: str       # IBKR period string ("1d", "1y", etc.)
       bar: str          # IBKR bar string ("1min", "1d", etc.)
       est_max_bars: int # Sanity cap — fail-fast if response exceeds

   TIMEFRAME_SPEC: dict[str, HistorySpec] = {
       "1m":  HistorySpec(period="1d", bar="1min", est_max_bars=400),
       "5m":  HistorySpec(period="5d", bar="5min", est_max_bars=400),
       "15m": HistorySpec(period="1w", bar="15min", est_max_bars=110),  # IBKR caps 15m bars at 1w period (Q1a)
       "1h":  HistorySpec(period="1m", bar="1h",   est_max_bars=160),
       "4h":  HistorySpec(period="6m", bar="4h",   est_max_bars=240),
       "1D":  HistorySpec(period="1y", bar="1d",   est_max_bars=260),
       "1W":  HistorySpec(period="5y", bar="1w",   est_max_bars=270),
       "1M":  HistorySpec(period="15y", bar="1m",  est_max_bars=200),
   }

   IBKR_BAR_LIMIT = 1000
   ```

2. Mark old `PERIOD_BAR` as deprecated. Migrate callers (`routers/market.py`, `routers/indicators.py`) to use `TIMEFRAME_SPEC`.

3. New typed error in `backend/services/errors.py` (or wherever IBKR errors live):
   ```python
   class IBKRBarLimitExceededError(Exception):
       """Raised when a (period, bar) request would return >1000 bars."""
   ```

### 3.2 Backend request model

**Files:** `backend/models/__init__.py`, `backend/routers/indicators.py`

**Change:**

1. Update `IndicatorRequest`:
   ```python
   class IndicatorRequest(BaseModel):
       conid: int
       timeframe: Literal["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"] = "1D"
       indicators: list[str] = []
       # Deprecated, kept for backwards compat — remove in next release:
       period: str | None = None
   ```

2. `routers/indicators.py` looks up `TIMEFRAME_SPEC[request.timeframe]` to get `(period, bar)`. Pass both to `ibkr.history(conid, period, bar)`. Remove the old `PERIOD_BAR` lookup.

3. Response — add `timeframe` field to `IndicatorComputeResponse` so frontend can verify what it got.

### 3.3 Frontend changes

**Files:** `src/hooks/useChartData.ts`, `src/lib/api.ts`

**Change:**

1. `src/lib/api.ts` — `IndicatorRequest`:
   ```ts
   export interface IndicatorRequest {
     conid: number;
     timeframe: Timeframe;        // ← new, primary
     indicators?: string[];
     period?: string;             // ← deprecated
   }
   ```

2. `src/hooks/useChartData.ts`:
   - Delete `TIMEFRAME_TO_PERIOD` map.
   - Pass `timeframe` directly to `api.computeIndicators`.
   - Fix queryKey: include timeframe.
     ```ts
     queryKey: ["chart-data", conid, timeframe, indicatorKey],
     ```

### 3.4 Tests

**Files:** `backend/tests/test_indicator_compute.py` (extend existing or create), `src/hooks/__tests__/useChartData.test.ts`

- Backend: parametrize test over all 8 timeframes, assert `(period, bar)` passed to IBKR mock matches `TIMEFRAME_SPEC` exactly.
- Backend: assert `IBKRBarLimitExceededError` raised when mock returns >1000 bars.
- Frontend: assert `useChartData` calls `api.computeIndicators` with `timeframe` field, not `period`.
- Frontend: assert switching timeframe invalidates cache (queryKey changes).

---

## 4. Branch 3 — Indicator rendering bugs

### 4.1 BB renders nothing

**Files:** `src/components/charts/indicatorOverlays.ts`, `backend/services/indicators.py`

**Hypothesis (Q8 → option a):** Backend `bbands` indicator name is correct but the IndicatorValue field shape may not populate `upper`/`lower` correctly. Frontend reads `v.upper`, `v.lower`, `v.value` — if backend writes them under different keys (e.g. `bb_upper`), `toLineData` returns empty arrays.

**Action:**

1. Investigate `backend/services/indicators.py` — find the `bbands` compute path. Verify what fields it writes into `IndicatorValue.upper`, `IndicatorValue.lower`, `IndicatorValue.value`.
2. Add logging on first compute call: `log.debug("bbands sample: %s", values[0])`.
3. Whatever the field names are, align frontend to match. If renaming, update `IndicatorValue` typedef in `src/lib/api.ts`.
4. Verification: existing backend test `test_indicators.py` (if it exists) should already cover this. If not, add `test_bbands_field_population`.

### 4.2 ATR numeric badge (Q9 = b)

**Files:** `src/components/indicators/AtrBadge.tsx` (new), `src/pages/AnalysisPage.tsx`, `src/components/indicators/IndicatorPill.tsx`

**Decision:** ATR is a value-type indicator. Show as a small numeric badge in the toolbar when toggled on. No chart series.

**Change:**

1. New component `AtrBadge.tsx`:
   ```tsx
   interface Props { atrValue: number | null; }
   export default function AtrBadge({ atrValue }: Props) {
     if (atrValue == null) return null;
     return (
       <div className="rounded-md border border-[var(--clr-red)] px-2 py-1 font-data text-[10px]">
         <span className="text-[var(--text-3)]">ATR</span>{" "}
         <span className="text-[var(--clr-red)] font-bold">{atrValue.toFixed(2)}</span>
       </div>
     );
   }
   ```

2. `AnalysisPage.tsx`: when `activeIndicators.has("atr")`, find the latest non-null ATR value from `indicators` and render `<AtrBadge>` in the toolbar after IndicatorToolbar.

3. ATR pill toggle keeps existing behavior — `toggleIndicator("atr")` shows/hides the badge.

**Test:** Snapshot test for `AtrBadge` with sample value. Test that it renders when "atr" is in active set.

### 4.3 MACD empty panel + sub-chart re-toggle (Q10 = a)

**Files:** `src/components/charts/SubChartPanel.tsx`

**Hypothesis:** Chart instance created in `useEffect(() => {...}, [])` before parent flex layout settles. Container has `width=0`/`height=0` at first render. When `setData` is called, chart has no drawing area. Toggling off + on remounts but same race repeats.

**Fix attempt 1 (Q10):** Defer chart creation until ResizeObserver reports non-zero size.

**Change:**

1. Restructure `SubChartPanel.tsx`:
   ```ts
   useEffect(() => {
     const container = containerRef.current;
     if (!container) return;

     let chart: IChartApi | null = null;
     let pendingDataApply = false;

     const resizeObserver = new ResizeObserver((entries) => {
       const { width, height } = entries[0].contentRect;
       if (width === 0 || height === 0) return;

       if (!chart) {
         // Lazy-create on first non-zero size
         chart = createChart(container, { ...options, width, height });
         chartRef.current = chart;
         pendingDataApply = true;
       } else {
         chart.applyOptions({ width, height });
       }

       if (pendingDataApply) {
         applyIndicatorData();
         pendingDataApply = false;
       }
     });
     resizeObserver.observe(container);

     return () => {
       resizeObserver.disconnect();
       chart?.remove();
       chartRef.current = null;
     };
   }, []);
   ```

2. Same pattern in `ChartContainer.tsx` if main chart has the same issue (less likely since it has `flex-1` parent with explicit height, but verify).

3. If fix-1 doesn't resolve it, try Q10 option (b) — explicit panel dimensions, then (c) — force re-apply on indicator change.

**Test:** Hard to unit-test ResizeObserver behavior. Manual smoke: toggle MACD on, off, on — verify it renders all three times. Same for ADX, OBV, Stoch.

---

## 5. Branch 4 — AI panel

### 5.1 Drop Manual button (Q4 = drop entirely)

**Files:** `src/components/ai/AiConfigPanel.tsx`

**Change:**

1. Delete `mode` state and `AiMode` type.
2. Delete the AI Assist / Manual toggle JSX (lines ~183–204).
3. Update `onRunAnalysis` callback signature — drop `mode` param.
4. Update `AiChatPanel.tsx` `handleRunAnalysis` — drop `mode` from destructure.
5. Re-export only `AiTimeframe` and `AiIndicator` types. Remove `AiMode`.

(With Branch 5 landing tabs, the user clicks Watchlists/Triggers tabs to do non-AI work. No mode concept needed.)

**Test:** Update `AiConfigPanel.test.tsx` snapshot. Remove tests for Manual mode.

### 5.2 Stuck "Analyzing X..." state

**Files:** `backend/services/ai.py`, `src/components/ai/AiChatPanel.tsx`, `src/hooks/useAiStatus.ts`

**Root cause analysis:**
- Structured-output JSON parse fails (per the log Ben shared)
- Falls back to regex parse — also fails
- Last-resort: re-asks model to reformat
- This third call can hang indefinitely on slow models / model errors
- `setAnalyzing(false)` only fires in `onSettled` — but if the request never settles, UI stays stuck

**Change:**

1. **Backend timeouts.** In `ai.py` `analyze_with_signal` (verify exact name): wrap each `chat`/`chat_structured` call with `asyncio.wait_for(..., timeout=N)` where N is configurable (default 60s narrative, 30s extraction, 30s reformat). On timeout raise `AIAnalysisTimeoutError`. Surface to the route handler which returns 504-style response.

2. **Frontend error path.** `AiChatPanel.tsx` `analyzeMutation.onError` already adds an error message — but verify it's actually hit when backend times out. If the request hangs at the HTTP level, may need an `AbortSignal` with `setTimeout` on the frontend too.

3. **Per-stage status messages.** Replace single `Analyzing {symbol}...` with stage labels:
   ```ts
   type AnalysisStage = "narrative" | "extracting_signal" | "reformatting" | null;
   ```
   Backend would need to stream stages — but that's a bigger change. **Alternative simpler version:** keep "Analyzing {symbol}…" but add a "Cancel" button that calls `analyzeMutation.reset()` and `setAnalyzing(false)`.

4. **Fail-soft when signal extraction fails.** Backend currently still returns `message` (the narrative) with `signal: null`. Verify frontend doesn't get stuck when `signal === null` — the issue might be the request never returns, not that the response is malformed.

**Test:** New backend test `test_ai_timeout.py` — mock Ollama to delay >timeout, assert `AIAnalysisTimeoutError` raised. New frontend test — mock `api.aiAnalyze` to throw, assert `isAnalyzing` flips to false and error message shows.

---

## 6. Branch 5 — Watchlist + Triggers tabs (Q5 = Option A)

### 6.1 Right-sidebar tab switcher

**Files:** `src/pages/AnalysisPage.tsx`, new `src/components/analysis/RightSidebar.tsx`, new `src/components/analysis/WatchlistTab.tsx`, new `src/components/analysis/TriggersTab.tsx`

**Layout:**

```
┌─────────────────────────────────────────────────┐
│ [AAPL · Apple] [Toolbar]                        │
├─────────────────────────────────────────┬───────┤
│                                         │ AI ▾  │
│                                         │ Watch │
│              CHART                      │ Trig  │
│                                         ├───────┤
│                                         │       │
│                                         │ tab   │
│                                         │content│
└─────────────────────────────────────────┴───────┘
```

**Change:**

1. New `RightSidebar.tsx` owns tab state:
   ```tsx
   type Tab = "ai" | "watchlists" | "triggers";
   ```

2. Move existing AI panel content into `<AiTab>` (rename `AiChatPanel` → keep the file but extract pure render).

3. New `WatchlistTab.tsx`:
   - List all watchlists from `api.getWatchlists()`
   - For each watchlist, show a checkbox indicating whether `activeConid` is in it
   - Click checkbox → `addInstrumentToWatchlist(name, conid)` / `removeInstrumentFromWatchlist(name, conid)`
   - "+ New watchlist with this stock" button at bottom

4. New `TriggersTab.tsx`:
   - List trigger rules where `source_watchlist` is one of the watchlists this stock is in (filter `getTriggerRules` by this stock's watchlists)
   - Each rule shows: indicator, condition, threshold, source→target watchlist, enabled toggle
   - "+ New trigger rule" button → opens existing `CreateRuleModal` (reuse Phase 6 component) pre-filled with stock's current watchlists

5. `AnalysisPage.tsx` layout simplification:
   ```tsx
   <div className="grid h-full grid-cols-[1fr_340px]">
     <ChartArea ... />
     <RightSidebar
       activeConid={activeConid}
       activeSymbol={activeSymbol}
       fibonacci={fibonacci}
       chartIndicators={activeIndicators}
     />
   </div>
   ```

6. AI suggest only → v2 (per Q5 clarification). Don't build it now.

**Tests:**
- `RightSidebar.test.tsx` — tab switching, default tab is AI
- `WatchlistTab.test.tsx` — checkbox state reflects whether stock is in watchlist
- `TriggersTab.test.tsx` — only shows triggers relevant to this stock

---

## 7. Open items + assumptions to verify before coding

1. **5d period syntax.** Branch 2 assumes IBKR accepts `period=5d`. Verify by hitting the API or checking existing `PERIOD_BAR` history (the old map has `"5D": ("5d", "5min")`, so it's been accepted before). If rejected at runtime, fall back to `period=1d`.
2. **Theme CSS variables.** Branch 1 assumes `--bg-0`, `--text-3`, `--border` already exist in `src/styles.css`. Verify; add `--chart-grid` if missing.
3. **Company name source.** Branch 1.5 assumes `/instruments/{conid}` exists or can be added. Verify or pivot to extending `resolveConid` response.
4. **BB field names.** Branch 3.1 hypothesizes a field-name mismatch. Confirm via logging on first run.
5. **Lightweight Charts watermark API.** v5 may have removed the built-in watermark. Verify; if removed, use absolutely-positioned div overlay.
6. **MACD/sub-chart fix.** Branch 3.3 attempts ResizeObserver-deferred chart creation first. If that doesn't fix it, escalate to options (b) and (c) per Q10.

---

## 8. Out of scope (deferred)

- Fibonacci-related issues (per Ben — discuss after this work lands)
- AI watchlist suggestions (v2)
- Move-stock-between-watchlists via AI (v2)
- Phase 8.5 indicator accuracy E2E test suite (write after Branches 1–4 land)

---

## 9. Acceptance criteria per branch

Each branch's PR must include:

- All listed files changed
- Tests added/updated per project rule #1
- No bare `except` per project rule #4
- Polars only per rule #2 (no new pandas usage)
- Manual smoke test against the Analysis page documented in PR description
- Branch merged to `dev`, not `main`
