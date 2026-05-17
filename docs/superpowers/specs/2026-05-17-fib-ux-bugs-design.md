# Spec A — Fib UX Bugs

**Date:** 2026-05-17
**Scope:** Two independent Fibonacci-related UX bugs on the Analysis page.

---

## Problem

### Bug 1 — `no_active_fib` silent failure

When the user toggles the `fibonacci` indicator on, the backend may return:

```
{ "no_active_fib": true, "historical_candidates": [...6 items...] }
```

Today, `ChartContainer.tsx:331` filters out any fib result with `no_active_fib === true` before rendering. The indicator pill stays toggled on, but nothing appears on the chart and the user gets no explanation. Backend logs the situation (`No active fib candidates (all played out or broken)`) but that's invisible to the user.

### Bug 6 — Draw Fib / Draw Ext: second click does nothing

Repro: click "Draw Fib" → the status pill appears ("Click first point (retracement)"). Click once on the chart → pill updates to "Click second point (retracement)". Click a second time → **nothing happens**. The fib is not locked, the pill remains, the user has to press Escape.

Behavior is the same for "Draw Ext".

---

## Approach — Bug 1

**Goal:** Surface the "no active fib" state to the user and stop showing a toggled-on-but-empty indicator pill.

**Solution: toast + auto-untoggle.**

- Add an effect in `src/pages/AnalysisPage.tsx` that watches `fibonacci?.no_active_fib` together with `activeIndicators.has("fibonacci")`.
- When both are true for a freshly-arrived result, fire a toast:
  - Title: `No active Fibonacci setup for <SYMBOL> on <TIMEFRAME>`
  - Body: `<N> historical candidates — none currently in play`
- Then call the chart store's existing indicator-toggle action to remove `fibonacci` from `activeIndicators`.
- Use a `useRef` guard keyed on `(conid, timeframe)` so we don't re-fire the toast on every TanStack Query refetch — only when a fresh "no active" arrives for a new symbol/timeframe combination, or after a deliberate re-toggle.

**Toast wiring:** verify whether a toast provider (likely `sonner` per shadcn convention) is already mounted in `src/App.tsx` or a layout component. If not, add `sonner` and mount `<Toaster />` once at the app root.

**No backend changes.** The `no_active_fib` signal is already in the response.

## Approach — Bug 6

**Investigation step (do this first, ~30 min):**

Add temporary `console.log` statements at these locations to confirm where the second click is being lost:

- `FibDrawMode.tsx:183` — handler entry (does the second click reach the handler at all?)
- `FibDrawMode.tsx:188` — `coordinateToPrice` result
- `FibDrawMode.tsx:196` — branch taken when `fibDrawPointA` is already set
- `FibDrawMode.tsx:217` — lock mutation about to fire

Run repro, capture logs, then pick the fix path. Remove the logs before committing.

**Top suspects (one of these is likely the cause):**

1. **Stale-closure / over-subscribing click effect.** The click effect at `FibDrawMode.tsx:180` has `lockFib` in its dependency array. `useLockFib()` may return a new object reference each render (TanStack Query mutation hooks often do). That re-runs the effect → unsubscribes the old click handler → subscribes a new one. If this churn happens between the user's mousedown and the click dispatch, the click is fired against an unsubscribed handler. The status pill updates correctly after the first click because the store update triggers a re-render *before* the user clicks a second time — but every subsequent render risks the same race.

2. **Ghost-series subscription side effects.** When `fibDrawPointA` is set, the crosshair-move effect at `FibDrawMode.tsx:241` re-subscribes and `drawGhost` calls `ensureGhostSeries` → `clearGhost` + `chart.addSeries` on the first move. Adding/removing series mid-interaction in Lightweight Charts can disturb pointer event routing.

**Likely fix — split capture from lock.**

Refactor the click handler so its only job is to capture coordinates into the store:

- Add a `fibDrawPointB` field to the chart store (alongside the existing `fibDrawPointA`).
- The click handler writes either `pointA` or `pointB`, then returns.
- A separate effect watches `(fibDrawPointA, fibDrawPointB)` — when both are set, it computes the swing high/low/direction and fires the `lockFib` mutation, then resets both points and calls `exitFibDrawMode`.
- This keeps the click effect's dependency array tiny and stable (`chart`, `candleSeries`, `fibDrawMode`, `fibDrawPointA`, store setters). `lockFib` no longer needs to be in the click effect's deps.

If the investigation points instead at suspect 2, fall back to creating the ghost series once when `fibDrawMode` enters (not lazily on first move) so no series-graph mutations happen between clicks.

---

## Testing

Manual test plan (no new unit tests — these are integration-level UX bugs):

**Bug 1:**
- Toggle `fibonacci` on for a symbol with an active fib → chart renders fib, no toast. (Regression check.)
- Toggle `fibonacci` on for a symbol with `no_active_fib: true` → toast appears once, pill auto-untoggles.
- Switch to a different symbol, toggle on again → toast fires again if the new symbol is also no-active.
- Toggle on/off rapidly on the same no-active symbol → toast fires once per deliberate toggle, not on background refetches.

**Bug 6:**
- Draw Fib → click point A → click point B → fib locks and appears on chart.
- Repeat for Draw Ext.
- Rapid clicks (two clicks within ~200ms) → still locks correctly, no race.
- Escape during draw mode → cancels cleanly, no leftover ghost lines.

---

## Files Touched

- `src/pages/AnalysisPage.tsx` — toast + auto-untoggle effect for Bug 1.
- `src/store/chart.ts` — add `fibDrawPointB` field + setter (for Bug 6 split-capture fix).
- `src/components/charts/FibDrawMode.tsx` — refactor click handler to capture-only; new lock effect.
- `src/App.tsx` (or layout root) — mount `<Toaster />` if not already present.
- `package.json` — add `sonner` if not already installed.

No backend changes.

---

## Out of Scope

- Showing the 6 historical fib candidates as clickable options in the FibScoreCard (deferred — would be a separate feature).
- Any change to the fib drawing-tool from the new drawing toolbar (`DrawingToolbar.tsx`). This spec only addresses the legacy `enterFibDrawMode` flow exposed by the "Draw Fib" / "Draw Ext" toolbar buttons.
