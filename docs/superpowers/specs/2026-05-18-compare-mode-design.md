# Compare Mode — Design Spec

**Date:** 2026-05-18
**Branch context:** spec authored against `dev`
**Status:** Design approved, ready for implementation planning
**Inspiration:** [@ultrawavetrader on X](https://x.com/ultrawavetrader/status/2056312851250262081)

---

## 1. Motivation

Indi (@ultrawavetrader) argues that stocks should never be read in isolation — they live in the market's ecosystem, and a trader develops intuition by watching a stock against a market reference (SPY) constantly. His setup is deliberately spartan: both instruments overlaid on a single chart pane with two raw Y-axes, volume on the stock only, **no technical indicators of any kind**. The trader becomes the oscillator.

Compare Mode brings that workflow into Parallax. It is a distinct mode on the Analysis page — entered explicitly via a toolbar button, exited the same way — that replaces the standard chart area with a stack of dual-instrument panes.

It is not an enhancement of the existing chart. It is a separate viewing mode with its own invariants: no indicators, no drawings, no AI overlay, no Fibonacci. Clean only.

---

## 2. User-facing behavior

### Entry & exit

- A **"Compare" button** lives at the right end of the Analysis page top toolbar (after the indicator pills, before the right-panel chevron). The button has a distinct visual treatment so the user understands this is a *mode swap*, not another indicator toggle.
- Keyboard shortcut: **`C`** toggles Compare mode (subject to the same input-element guard the drawing-tool shortcuts use).
- On entry:
  - The standard top toolbar (symbol input, timeframe pills, indicator pills) and all sub-chart panels (RSI, MACD, Stochastic, OBV, ADX) **hide**.
  - All drawing overlays and indicator overlays on the main chart **hide**.
  - The AI panel **auto-collapses** to its 32 px rail (existing collapse behavior). The user can re-expand it manually.
  - The watchlist sidebar stays visible.
  - A single overlay pane is created at the chart's current timeframe.
- On exit: the standard chart, sub-charts, toolbar, and indicator overlays re-render in their previous state. The AI panel does NOT auto-re-expand — the user controls it manually.

### Mode header

A single header bar across the top of the compare area:

```
Compare:  AAPL  vs  [SPY ▾]                   + Add pane    ✕ Exit
          (read-only)  (editable input)
```

- The **primary stock label is read-only** in compare mode. To swap stocks the user must exit compare mode (or click a watchlist item — see edge cases).
- The **reference symbol input** is a free-text input (default `SPY`). Same resolution flow as the main symbol input: type → Enter or blur → `api.resolveConid()` → success updates the compare store; failure shows a toast and restores the previous valid value.
- **+ Add pane** appends a new pane below. New panes default to `overlay` layout and the same timeframe as the most recent pane.
- **✕ Exit** is equivalent to pressing `C` or the toolbar Compare button — exits the mode and restores prior state.

### Panes

The compare area is a vertical stack of panes (max 3). Each pane is independently configurable.

**Per-pane top toolbar** (Pattern A — TradingView-style, inline):

```
1m  5m  15m  1h  4h  1D  1W  1M    [Overlay ▾]     ✕
```

- **Timeframe pills** — same set as the main chart (`TIMEFRAMES` from `chart.ts`). Single-select.
- **Layout dropdown** — `Overlay` / `Stock only` / `Reference only`.
- **✕** removes the pane. Disabled (with tooltip "At least one pane required") when only one pane remains.

### Chart specifics (per pane)

- **Y-axis scale**: both axes always `Mode.Normal` (= "Regular" in TradingView). Not log, not percent, not indexed-to-100. This is the explicit point of Indi's setup.
- **Color**: stock series = foreground/white; reference series = green accent. Both pulled from `chartTheme.ts`.
- **Volume**: a histogram series bound to the stock's scale (margins `{top: 0.85, bottom: 0}`) when stock is visible (overlay or stockOnly). Reference has no volume overlay ever.
- **Crosshair legend** (top-left of pane): shows the stock's symbol + OHLC + volume, then the reference's symbol + OHLC below — same legend pattern Indi shows in his OKLO/SPY screenshot.
- **No indicator overlays. No fib overlays. No drawing layer. No watermark.** None of those components mount in compare mode.

---

## 3. Architecture

### Approach: dedicated `CompareChart` component

Compare Mode does NOT reuse the existing `ChartContainer`. `ChartContainer` carries indicator overlays, fibonacci, drawings, and other concerns Compare Mode explicitly excludes; embedding a parallel data flow for a second instrument and conditionally hiding every indicator-related code path would bloat it badly. The component already does a lot.

A new `CompareChart` component is built fresh on Lightweight Charts v5. It is small (~200 lines) and single-purpose. The minor duplication (createChart, theme reading, resize observer) is worth the separation — it matches how `SubChartPanel` is already a small dedicated chart component separate from `ChartContainer`.

### Component tree

```
AnalysisPage
├── (Compare toggle button in top toolbar)
└── (when compare.active)
    └── CompareView
        ├── CompareModeHeader        ← read-only primary · ref input · + Add pane · ✕ Exit
        └── ComparePane[]            ← length 1–3, from compare store
            └── ComparePane
                ├── PaneToolbar      ← TF pills · layout dropdown · ✕
                └── CompareChart     ← new, dedicated dual-axis chart
```

### Files

**New files**

| Path | Responsibility |
|---|---|
| `src/components/compare/CompareView.tsx` | Container. Renders header + pane list. Handles overall layout. |
| `src/components/compare/CompareModeHeader.tsx` | Header bar. Read-only primary stock label. Editable reference input (with resolution flow). Add-pane button. Exit button. |
| `src/components/compare/ComparePane.tsx` | Single-pane wrapper. Composes PaneToolbar + CompareChart. |
| `src/components/compare/PaneToolbar.tsx` | TF pills, layout dropdown, close ✕. |
| `src/components/compare/CompareChart.tsx` | Dedicated chart. Creates Lightweight Charts instance, mounts 1–2 candle series (per layout) with both scales set to `Mode.Normal`. Mounts volume only when stock is visible. Custom crosshair legend showing both OHLC. |
| `src/components/compare/index.ts` | Barrel exports. |
| `src/store/compare.ts` | Zustand store (see §4). |
| `src/hooks/useCompareData.ts` | Per-pane data hook. Wraps `api.computeIndicators` (empty indicator list) + `useWebSocket` singleton subscriptions. |

**Modified files**

| Path | Change |
|---|---|
| `src/pages/AnalysisPage.tsx` | Add Compare toggle button to top toolbar. Bind `C` shortcut. Conditionally render `<CompareView />` instead of the chart + sub-charts when `compare.active`. Auto-collapse AI panel on entry. Exit compare mode and switch stock when a watchlist click changes `chart.activeSymbol`. |
| `src/store/index.ts` | Re-export the `compare` store. |

**No backend changes.** The existing `POST /indicators/compute` endpoint (called with `indicators: []`) returns plain OHLCV, which is all Compare Mode needs. WebSocket subscriptions reuse the existing singleton.

---

## 4. State

New Zustand store at `src/store/compare.ts`, persisted to localStorage via the existing `persist` middleware pattern (the user's reference + last pane config should survive reload).

```ts
type Layout = 'overlay' | 'stockOnly' | 'refOnly';
type PaneId = string; // nanoid

interface ComparePane {
  id: PaneId;
  layout: Layout;
  timeframe: Timeframe;
}

interface CompareStore {
  active: boolean;
  reference: { symbol: string; conid: number | null };  // default { symbol: 'SPY', conid: null }
  panes: ComparePane[];                                  // length 1–3 when active; never 0

  enter: (initialTimeframe: Timeframe) => void;          // adds 1 overlay pane if panes is empty
  exit: () => void;
  setReference: (symbol: string, conid: number) => void;
  addPane: () => void;                                   // appends overlay pane copying most recent pane's TF; no-op at cap
  removePane: (id: PaneId) => void;                      // no-op if panes.length === 1
  setPaneLayout: (id: PaneId, layout: Layout) => void;
  setPaneTimeframe: (id: PaneId, tf: Timeframe) => void;
}

const MAX_PANES = 3;
const DEFAULT_REFERENCE = { symbol: 'SPY', conid: null };
```

Persistence key: `parallax-compare-store` (project naming convention).

**Reference resolution lifecycle.** The store holds `reference.conid` as `number | null`. It is `null` whenever the symbol hasn't been resolved yet — true on first-ever use (fresh state with default SPY), and true after rehydrate (we never trust a persisted conid because IBKR can re-issue them). `CompareModeHeader` is the single place that drives resolution: on mount and on every reference symbol change, it calls `api.resolveConid()` if `reference.conid` is null, then `setReference(symbol, conid)` on success. Panes do not render until the reference has a conid (skeleton with `"Resolving reference…"`). If resolution fails, the symbol falls back to `SPY` and resolution is retried once. This mirrors the main symbol input's resolution pattern in `AnalysisPage`.

**New-pane timeframe.** `addPane()` copies the timeframe of the most recently added pane (`panes[panes.length - 1].timeframe`). This makes the common "add a higher TF view" gesture one click + one TF change, while keeping a sensible default for users who just want another pane.

---

## 5. Data flow

### Per-pane data hook

```ts
useCompareData(
  stockConid: number | null,
  refConid: number | null,
  timeframe: Timeframe,
  layout: Layout,
): {
  stockCandles: CandleData[] | undefined;
  refCandles: CandleData[] | undefined;
  stockLiveTick: LiveTick | null;
  refLiveTick: LiveTick | null;
  isLoading: boolean;
  error: unknown;
}
```

Internally:

```
stockCandlesQuery     TanStack Query
  queryKey: ["candles", stockConid, timeframe]
  enabled:  layout !== 'refOnly' && stockConid != null
  queryFn:  api.computeIndicators({ conid, timeframe, indicators: [] })

refCandlesQuery       TanStack Query
  queryKey: ["candles", refConid, timeframe]
  enabled:  layout !== 'stockOnly' && refConid != null
  queryFn:  api.computeIndicators({ conid, timeframe, indicators: [] })

WS subscriptions (via existing useWebSocket singleton):
  subscribe(stockConid) when layout !== 'refOnly'
  subscribe(refConid)   when layout !== 'stockOnly'
  cleanup on unmount, on layout change, on conid change
```

### Cache sharing with the existing chart

The query keys `["candles", conid, timeframe]` are **identical** to the keys `useChartData` uses. That means TanStack Query's cache is shared between Compare Mode and the standard chart — if AAPL 5m is already loaded for the main chart, entering compare mode hits the warm cache. Same for the reference once it's been touched once.

WebSocket subscriptions also dedupe at the singleton level. N panes subscribing to AAPL = 1 underlying subscription. Same for the reference.

### Live tick application

In `CompareChart`, the latest WS tick mutates the last candle in-memory (same pattern `ChartContainer` already uses):

```
lastCandle.close = tick.last
lastCandle.high  = max(lastCandle.high, tick.last)
lastCandle.low   = min(lastCandle.low,  tick.last)
lastCandle.volume = tick.volume     // stock only
series.update(lastCandle)
```

Applied per pane, per visible series, per tick. Cheap.

---

## 6. Edge cases

| Case | Behavior |
|---|---|
| Reference symbol input fails resolution | Toast: `"Reference symbol not found: [X]"`. Input value reverts to the previous valid reference. Panes keep showing the previous reference. |
| Reference conid resolves but `computeIndicators` 404s or returns empty | Affected pane shows a per-pane skeleton with `"No data for [SYMBOL]"`. Other panes unaffected. |
| Stock candles fail while in compare mode | Affected pane shows error state. User can exit compare mode normally. |
| WebSocket disconnects mid-session | Existing `useWebSocket` handles reconnect + resubscribe. No new logic. The connection status indicator behaves as today. |
| User clicks a watchlist row while in compare mode | **Force-exit compare mode and switch stock.** Toast: `"Exited compare mode for [NEW_SYMBOL]"`. This is consistent with "primary stock is not editable inside compare mode." |
| User changes timeframe in the main chart, then enters compare mode | First pane uses that timeframe. The main chart's `chart.timeframe` is not modified by compare mode. |
| Layout set to `refOnly` while reference is unresolved | Layout dropdown disables `refOnly` until the reference resolves successfully. Same logic in reverse for `stockOnly` if `stockConid` is null (which should never happen on the Analysis page, but the guard is cheap). |
| Only one pane left | The pane's ✕ close button is disabled with a tooltip. |
| User adds a pane while at the cap of 3 | "+ Add pane" button is disabled with a tooltip (`"Maximum 3 panes"`). |
| Persisted state has a stale conid for the reference symbol | On rehydrate, re-resolve the reference symbol once. If resolution fails, fall back to SPY. |
| User reloads page mid-compare | Persistence restores `active: true`, the reference, and the pane configuration. Re-mounted panes re-fetch data on mount. |

---

## 7. Testing

Vitest + React Testing Library, matching the existing `__tests__/` sibling pattern.

| Test file | Key cases |
|---|---|
| `src/store/__tests__/compare.test.ts` | default state · `enter()` adds 1 overlay pane · `exit()` clears active · `setReference` round-trip · `addPane` respects cap · `removePane` refuses to remove last pane · localStorage persistence + rehydrate fallback |
| `src/components/compare/__tests__/CompareView.test.tsx` | renders header + 1 pane on entry · + Add pane appends · exit button toggles store off · primary stock label is read-only (no input element) |
| `src/components/compare/__tests__/CompareModeHeader.test.tsx` | reference input success path · reference input failure path (toast + revert) · + Add pane disabled at cap · ✕ Exit calls store.exit |
| `src/components/compare/__tests__/ComparePane.test.tsx` | layout dropdown updates store · TF pill click updates store · ✕ disabled when only 1 pane · ✕ removes from store |
| `src/components/compare/__tests__/CompareChart.test.tsx` | overlay layout mounts 2 candle series + 2 price scales · stockOnly mounts 1 series · refOnly mounts 1 series · volume series only present when stock visible · both scales set to `Mode.Normal` · live tick mutates last candle · custom legend renders both OHLC |
| `src/hooks/__tests__/useCompareData.test.ts` | query keys match `["candles", conid, tf]` · `enabled` flags correct per layout · WS subscribe/unsubscribe on mount/unmount/layout-change · subscription dedupe across simultaneous panes |
| `src/pages/__tests__/AnalysisPage.test.tsx` (extend) | Compare toggle button renders · `C` keyboard shortcut · entering compare hides indicator toolbar/sub-charts/drawings · entering compare collapses AI panel · watchlist click while in compare exits + switches stock + shows toast |

No new E2E tests. The repo doesn't have E2E for the chart yet, and adding one specifically for compare mode would be disproportionate.

---

## 8. Non-goals

The following are explicitly **out of scope** for the first implementation:

- AI analysis of the comparison itself ("explain this divergence"). The AI panel collapses and its existing single-stock behavior is unchanged.
- Drawing tools on compare charts (no fibs, no trendlines, no anything). Indi's clean philosophy.
- Indicators on compare charts. Same reason.
- Percent / log / indexed-to-100 scale modes. Both axes always `Mode.Normal`.
- Per-pane reference symbol. Reference is global to compare mode.
- Multi-reference on one pane (e.g., AAPL vs SPY *and* XLK at once).
- Comparing two non-primary stocks (e.g., AAPL vs MSFT where neither is the page's primary).
- Saving named compare presets / configurations.
- Compare mode on any page other than the Analysis page.
- Backend changes — none required.

These are deliberate scope decisions, not oversights. Many would be reasonable additions later; they are not part of v1.

---

## 9. Open items deferred to the implementation plan

These are tactical decisions that don't change the design but will need to be made when writing code:

- Exact icon for the Compare toggle button (Lucide React — likely `GitCompare` or `Layers`).
- Exact pixel sizing of the pane toolbar (matching the existing 24–28 px toolbar conventions on dev).
- Whether to add a brief intro toast on first-ever entry ("Compare mode — clean overlay, no indicators") or skip it. Suggest skip; project's "no hand-holding UI" principle from CLAUDE.md applies.
- Whether reference candle history should escalate the period ladder the same way the main chart does (`1M → 3M → 6M → 1Y → 2Y → 5Y`). Suggest yes for parity, but mark as a follow-up if it complicates the first pass.

---

## 10. Faithfulness to Indi's methodology

Decisions that reflect Indi's explicit recommendations:

- Both Y-axes set to `Regular` scale (not percent, not indexed).
- Volume only on the primary stock.
- No technical indicators of any kind in compare mode.
- Crosshair legend showing OHLC for both instruments.
- Quick reference-symbol swapping (the editable input in the header).
- Multi-timeframe stacking supported (one of the configurable layouts × per-pane TF).

Deliberate deviations from Indi's exact setup:

- **Primary stock is the fixed instrument**, not the reference. Indi fixes the market chart and rotates stocks through it; Parallax's analysis page is already centered on a primary stock, so we fix that and rotate the reference instead. Same comparison, inverted workflow.
- **Stack of panes with mixed layouts** (Stock-only, Reference-only) is more flexible than Indi's strict overlay-only approach. The user explicitly wanted this.
- **Cap of 3 panes** is a Parallax UX constraint, not part of Indi's methodology.
