# Spec C — Layout & History

**Date:** 2026-05-17
**Scope:** Three Analysis-page features that improve information density and history depth.

---

## Problem

1. **Right sidebar is fixed at 340px** with no way to collapse it. When the user wants more chart real estate (e.g. comparing levels across timeframes), they have no escape hatch.
2. **The "Default Period" setting in the Settings page is dead.** The control exists, the value is stored, but `useChartData` never passes a `period` parameter to the backend — so changing the setting has no effect on the Analysis page chart.
3. **No way to load older candles.** The chart shows whatever the default fetch window contains (likely a fixed ~3M of bars). To see prior swings or longer-term structure, the user has no mechanism — there's no period selector, no scroll-to-load, nothing.

---

## Approach — Collapsible right panel

**Decision (from brainstorming):** Collapse to a 32px rail (symmetric with the left drawing toolbar) plus a `\` keyboard shortcut.

**Change:**
- Add `rightPanelCollapsed: boolean` and `toggleRightPanel()` to a UI store. Pick between `src/store/navigation.ts` (existing layout state) and `src/store/chart.ts` (chart-related transient state) after reading what's there.
- Replace the static grid template in `src/pages/AnalysisPage.tsx:200` with a dynamic value:
  - Expanded: `grid-cols-[32px_1fr_340px]`
  - Collapsed: `grid-cols-[32px_1fr_32px]`
- When collapsed, render a thin 32px rail in place of `RightSidebar`: a single chevron-left button that toggles back to expanded. Matches the visual weight of the left drawing toolbar — symmetric rails on both sides.
- When expanded, add a small chevron-right button to the `RightSidebar` header that collapses it.
- **Keyboard shortcut:** `\` toggles `rightPanelCollapsed`. Add to the existing keyboard handler at `AnalysisPage.tsx:117` (`handleDrawingShortcut`), reusing the same "skip if focused in `HTMLInputElement` / `HTMLTextAreaElement`" guard.
- No animation — instant toggle matches the existing trader-tool feel.

## Approach — Wire the "Default Period" setting

**Current state.** `defaultPeriod` is in `src/store/settings.ts:30` (default `"3M"`), displayed in `SettingsPage.tsx:412-421`, persisted to the backend, but `useChartData` never passes it to the chart fetch call.

**Change:**
- In `src/hooks/useChartData.ts`, read `defaultPeriod` from the settings store.
- Add `period` to the candles query key so changing the setting refetches: `["candles", conid, timeframe, period]`.
- Pass `period` to the candles fetch call. After Spec B's split, the candles fetch should route through `/market/candles/{conid}?period=...`, which already accepts the parameter — no backend change needed for this part.
- For indicators: investigate whether `/indicators/compute` accepts `period`. If not, add the param to the backend route (`backend/routers/indicators.py`) so indicators are computed against the same time range as the candles.

**Per-chart override is out of scope.** The setting is global. A toolbar period selector is deferred to a future iteration.

## Approach — Auto-load older candles on scroll

**Strategy: anchored period escalation.** IBKR's `/iserver/marketdata/history` is anchored to *now* with a period, not paginated by date. So instead of fetching "200 bars before X", we escalate to the next period rung when the user pans near the left edge.

**Frontend.**

- Maintain `loadedPeriod` state in `useChartData`. Initialize to the user's `defaultPeriod` setting.
- Define a static period ladder: `["1M", "3M", "6M", "1Y", "2Y", "5Y"]`. Top of the ladder is the maximum; no further escalation.
- In `ChartContainer.tsx`, subscribe to `chart.timeScale().subscribeVisibleTimeRangeChange`.
- When the leftmost visible time is within ~10 bars of the first loaded candle's time, call a `loadMore()` callback exposed by `useChartData`.
- `loadMore()`:
  - If `loadedPeriod` is already at the top of the ladder, no-op.
  - Otherwise, advance `loadedPeriod` to the next rung. TanStack Query refetches because `period` is in the query key.
  - Guard with an `isLoadingMore` flag / in-flight ref so rapid scroll events don't queue multiple escalations.

**Preserve the visible window on data swap.**

- Before the new candle array hits `setData`: capture the current visible logical range via `chart.timeScale().getVisibleLogicalRange()`.
- After `setData`: restore via `chart.timeScale().setVisibleLogicalRange()` so the chart doesn't snap to fitContent and jump under the user's hand.
- This needs careful coordination with Spec B's price-scale auto-fit logic — the auto-fit fires on conid change, not on period change, so the two shouldn't conflict. Verify in the plan.

**Indicator merge.**

- With Spec B's split, the indicator query is keyed `["indicators", conid, timeframe, period, indicatorKey]`. It refetches against the new period automatically. No manual merge needed.

**Loading affordance.**

- Show a small "Loading older bars…" pill in the bottom-left of the chart area while `isLoadingMore` is true.
- Hidden when data arrives, or when `loadedPeriod` is already at the top of the ladder.

**Reset on symbol switch.**

- When `conid` changes, reset `loadedPeriod` back to `defaultPeriod`.

---

## Testing

Manual:

**Collapse:**
- Click the chevron in the sidebar header → collapses to a 32px rail. Chart expands. Click the rail's chevron → restores.
- Press `\` from anywhere on the page → toggles. Press while focused in the symbol input → does not toggle (guard).

**Default period:**
- Change Default Period in Settings from 3M to 1Y. Return to Analysis. Open a new symbol. Chart loads roughly 1 year of bars.
- Change back to 3M. Open another symbol. Loads ~3 months.

**Auto-load:**
- Open a chart with default 3M. Pan left until the leftmost visible bar is near the start of loaded data. "Loading older bars…" appears. Older candles arrive (chart now spans ~6M). The visible window stays put — does not jump.
- Continue panning left across each escalation. Confirm the sequence: 3M → 6M → 1Y → 2Y → 5Y.
- At 5Y (top of ladder), continued panning does not trigger another load; spinner does not appear.
- Switch symbol mid-pan → `loadedPeriod` resets to `defaultPeriod`.

No new unit tests — these are integration features. Optionally a small unit test for the new `toggleRightPanel` action and the period-ladder progression logic.

---

## Files Touched

- `src/store/settings.ts` — no change expected (already has `defaultPeriod`).
- `src/store/chart.ts` or `src/store/navigation.ts` — add `rightPanelCollapsed` + `toggleRightPanel()`.
- `src/pages/AnalysisPage.tsx` — dynamic grid template; collapsed-rail render; `\` shortcut wiring.
- `src/components/ai/RightSidebar.tsx` (or its header subcomponent) — add the collapse chevron.
- `src/hooks/useChartData.ts` — read `defaultPeriod`; add `loadedPeriod` state; pass `period` to API; expose `loadMore` and `isLoadingMore`.
- `src/components/charts/ChartContainer.tsx` — subscribe to visible-range; call `loadMore` at the left edge; preserve visible logical range across `setData`.
- `src/lib/api.ts` — confirm/route to the right candles endpoint after Spec B; add `period` param to indicators call if missing.
- `backend/routers/indicators.py` — add `period` param if not already present.

---

## Out of Scope

- Per-chart period override in the chart toolbar (deferred).
- Custom date-range pickers.
- History beyond 5Y or "all available" loading.
- Deep IBKR pacing-failure recovery — rely on the existing error toast.
- Persisting collapsed/expanded state across sessions (in-memory only for now).

---

## Dependencies

Spec B (chart state bugs) is a soft prerequisite. The auto-load-on-scroll feature is materially cleaner with the split candles/indicators queries from Spec B — without it, every period escalation would also re-race the indicator refetch through the same query key. Recommended landing order: **A → B → C.**
