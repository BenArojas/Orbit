# Spec A — Fib UX Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two Fibonacci-related UX bugs on the Analysis page: (1) silent `no_active_fib` failure, and (2) Draw Fib/Ext second click not registering.

**Architecture:** Bug 1 is a thin React effect in `AnalysisPage` that watches the fib response and toggles the indicator off with a toast. Bug 2 splits the FibDrawMode click handler into a capture-only click effect plus a separate "both points present → lock" effect, eliminating the stale-closure / re-subscription race on `lockFib`.

**Tech Stack:** React 19, TypeScript strict, Zustand, TanStack Query v5, Sonner (already installed), Lightweight Charts v5.

**Spec:** [docs/superpowers/specs/2026-05-17-fib-ux-bugs-design.md](../specs/2026-05-17-fib-ux-bugs-design.md)

**Files touched:**
- Modify: `src/pages/AnalysisPage.tsx` — add no_active_fib auto-untoggle + toast effect
- Modify: `src/store/chart.ts` — add `fibDrawPointB` field + setter, reset in the right places
- Modify: `src/components/charts/FibDrawMode.tsx` — split click handler into capture + lock effects

No backend changes. No new dependencies (Sonner is already wired in `src/App.tsx:236`).

**Important context:**
- Toast pattern in this codebase: `import { toast } from "sonner"` then `toast.info(...)`, `toast.success(...)`, `toast.error(...)`. See `src/components/dashboard/TriggerRules.tsx:22,233` for an example.
- The spec explicitly opts out of new unit tests — manual repro is the verification gate. Use Vitest only for incidental store-shape changes.
- `pnpm` or `npm` — check `package.json` engines / `package-lock.json` presence. Commands below assume `npm`. Switch to `pnpm` if `pnpm-lock.yaml` is present.

---

## Task 1: Add no_active_fib auto-untoggle + toast in AnalysisPage

**Files:**
- Modify: `src/pages/AnalysisPage.tsx`

- [ ] **Step 1: Read the current AnalysisPage**

Confirm the current shape of imports and where to add the effect. The new effect should live near the other indicator-related effects (after the `hasEverLoaded` effect around line 160).

- [ ] **Step 2: Add the toast + auto-untoggle effect**

Add this import at the top of `src/pages/AnalysisPage.tsx` (after the existing imports, before the constants section):

```tsx
import { toast } from "sonner";
```

Pull `toggleIndicator` from the chart store. Update the destructured store hook near line 57:

```tsx
const {
  activeConid,
  activeSymbol,
  timeframe,
  activeIndicators,
  setActiveConid,
  setActiveSymbol,
  setTimeframe,
  fibDrawMode,
  enterFibDrawMode,
  exitFibDrawMode,
  toggleIndicator,
} = useChartStore();
```

Add this effect after the `hasEverLoaded` effect (after line 164):

```tsx
// Bug 1: surface `no_active_fib` to the user.
//
// When the backend reports there's no currently-active fib for this
// (conid, timeframe), the indicator pill stays toggled on but nothing
// renders on the chart. The user has no idea why. We toast once and
// auto-untoggle the pill so the UI matches reality.
//
// The ref guard keys on `${conid}|${timeframe}` so we don't re-fire
// on background refetches — only on a fresh "no active" result for a
// new symbol/timeframe combination (or after a deliberate re-toggle,
// since re-toggling triggers a refetch with the indicator in the key).
const noActiveFibKeyRef = useRef<string | null>(null);
useEffect(() => {
  if (!activeIndicators.has("fibonacci")) {
    noActiveFibKeyRef.current = null;
    return;
  }
  if (!fibonacci?.no_active_fib) return;

  const key = `${activeConid}|${timeframe}`;
  if (noActiveFibKeyRef.current === key) return;
  noActiveFibKeyRef.current = key;

  const historicalCount = fibonacci.candidates?.length ?? 0;
  const symbolLabel = activeSymbol || "this symbol";
  toast.info(`No active Fibonacci setup for ${symbolLabel} on ${timeframe}`, {
    description:
      historicalCount > 0
        ? `${historicalCount} historical candidate${historicalCount === 1 ? "" : "s"} — none currently in play`
        : "No setups found",
  });
  toggleIndicator("fibonacci");
}, [
  fibonacci,
  activeIndicators,
  activeConid,
  activeSymbol,
  timeframe,
  toggleIndicator,
]);
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck` (or `tsc --noEmit` if no script exists)
Expected: PASS — no new TypeScript errors.

If `typecheck` isn't a defined script, check `package.json` "scripts" and run the closest equivalent (`npm run lint` or `npx tsc --noEmit`).

- [ ] **Step 4: Manual repro — happy path (regression)**

Start the app:

```bash
# Terminal 1
cd backend && uv run uvicorn main:app --reload --port 8000

# Terminal 2
npm run tauri dev
```

- Open Analysis, search a symbol with a known active fib (e.g. SPY 1D).
- Toggle the Fibonacci pill on.
- **Expected:** fib levels render on the chart, no toast appears, pill stays on.

- [ ] **Step 5: Manual repro — no_active_fib**

- Find or wait for a symbol/timeframe where backend logs say `no_active_fib=True`. Per your earlier report, MSFT 1m or similar low-action periods produce this state. Alternatively, temporarily set a backend env var or hard-code `no_active_fib: true` in the fib router response, repro, then revert.
- Toggle Fibonacci on.
- **Expected:**
  - Toast appears once: "No active Fibonacci setup for <SYMBOL> on <TF>" + "<N> historical candidates — none currently in play".
  - Pill auto-untoggles (visual state matches reality).

- [ ] **Step 6: Manual repro — re-toggle behavior**

- After step 5, toggle Fibonacci back on (still on the same no-active symbol+TF).
- **Expected:** Toast fires again (because the re-toggle changed indicator state → fresh query → fresh "no active" → ref guard sees the same key but the unmount-via-untoggle reset it to null). Pill auto-untoggles again.

- Switch to a different symbol, toggle on.
- **Expected:** If that symbol is also no-active, toast fires. If it has an active fib, no toast and fib renders.

- [ ] **Step 7: Commit**

```bash
git add src/pages/AnalysisPage.tsx
git commit -m "fix(fib): toast + auto-untoggle when no active fib (spec A bug 1)"
```

---

## Task 2: Add fibDrawPointB to chart store

**Files:**
- Modify: `src/store/chart.ts`

- [ ] **Step 1: Add the field to ChartState interface**

In `src/store/chart.ts`, around line 200 (right after `fibDrawPointA`), add:

```ts
  /** First click captured (swing point A); null until user clicks */
  fibDrawPointA: FibDrawPoint | null;

  /** Second click captured (swing point B); null until user clicks the second point */
  fibDrawPointB: FibDrawPoint | null;
```

- [ ] **Step 2: Add the setter to the actions section**

Around line 236 (after `setFibDrawPointA`), add:

```ts
  setFibDrawPointA: (pt: FibDrawPoint) => void;
  setFibDrawPointB: (pt: FibDrawPoint | null) => void;
```

- [ ] **Step 3: Add initial value to the store factory**

Around line 292, add the initial value next to `fibDrawPointA`:

```ts
  fibDrawPointA: null,
  fibDrawPointB: null,
```

- [ ] **Step 4: Add the setter implementation**

Around line 376, after `setFibDrawPointA`, add:

```ts
  setFibDrawPointA: (pt) =>
    set({ fibDrawPointA: pt }),

  setFibDrawPointB: (pt) =>
    set({ fibDrawPointB: pt }),
```

- [ ] **Step 5: Reset pointB in all the places that reset pointA**

`fibDrawPointB` must reset wherever `fibDrawPointA` resets. Search for `fibDrawPointA: null` in the file — there are 4 occurrences (initial value, `clearChart`, `enterFibDrawMode`, `exitFibDrawMode`, plus the `setTimeframe` action that resets fib state). Add `fibDrawPointB: null` next to each.

Specifically:
- Initial state block (~line 292) — already done in Step 3
- `setTimeframe` action — find the set call that includes `displayedFibOverride: null`; pointA may or may not be there. Add `fibDrawPointB: null` if `fibDrawPointA: null` is there.
- `clearChart` action (~line 367) — add `fibDrawPointB: null`
- `enterFibDrawMode` (~line 374) — change to `set({ fibDrawMode: mode, fibDrawPointA: null, fibDrawPointB: null })`
- `exitFibDrawMode` (~line 380) — change to `set({ fibDrawMode: null, fibDrawPointA: null, fibDrawPointB: null })`

- [ ] **Step 6: Type-check**

Run: `npm run typecheck` (or `npx tsc --noEmit`)
Expected: PASS — no new errors.

- [ ] **Step 7: Run existing store tests**

Run: `npx vitest run src/store`
Expected: PASS — existing tests should be unaffected by the additive change.

- [ ] **Step 8: Commit**

```bash
git add src/store/chart.ts
git commit -m "feat(chart-store): add fibDrawPointB for split-capture refactor (spec A bug 6)"
```

---

## Task 3: Investigate bug 6 with temporary logging

**Files:**
- Modify (temporary): `src/components/charts/FibDrawMode.tsx`

- [ ] **Step 1: Add temporary console.logs**

Add these logs at the indicated lines in `src/components/charts/FibDrawMode.tsx`:

In the click handler (around line 183, inside `handleClick`):

```tsx
const handleClick = (param: { time?: Time; point?: { x: number; y: number } }) => {
  console.log("[FibDrawMode] click fired", { time: param.time, point: param.point, hasPointA: !!fibDrawPointA });
  if (!param.time || !param.point) {
    console.log("[FibDrawMode] click rejected — missing time/point");
    return;
  }

  const price = candleSeries.coordinateToPrice(param.point.y);
  console.log("[FibDrawMode] price resolved", price);
  if (price === null || price === undefined) {
    console.log("[FibDrawMode] click rejected — null price");
    return;
  }

  const time = typeof param.time === "number" ? param.time : 0;
  const clickPoint: FibDrawPoint = { time, price };

  if (!fibDrawPointA) {
    console.log("[FibDrawMode] capturing point A", clickPoint);
    setFibDrawPointA(clickPoint);
  } else {
    console.log("[FibDrawMode] capturing point B (will lock)", clickPoint);
    // ...rest of handler unchanged...
```

Also add at the top of the click effect (line 180):

```tsx
useEffect(() => {
  console.log("[FibDrawMode] click effect (re)subscribing", { fibDrawMode, hasPointA: !!fibDrawPointA });
  if (!chart || !candleSeries || !fibDrawMode) return;
  // ...
```

And at cleanup:

```tsx
  return () => {
    console.log("[FibDrawMode] click effect cleanup — unsubscribing");
    chart.unsubscribeClick(handleClick);
  };
```

- [ ] **Step 2: Run the app and reproduce**

```bash
# Terminal 1
cd backend && uv run uvicorn main:app --reload --port 8000

# Terminal 2
npm run tauri dev
```

- Open Analysis, load any symbol.
- Open DevTools (Cmd+Opt+I on macOS in Tauri).
- Click "Draw Fib".
- Click point A on the chart.
- Click point B on the chart.

- [ ] **Step 3: Capture and interpret logs**

Three failure shapes to look for:

**Shape A: handler never fires on second click.**
- Expected logs: `click effect (re)subscribing` (twice, once on enter mode, once on pointA capture), `click fired` (once), `capturing point A`, then **silence** on second click.
- Diagnosis: click subscription is being unsubscribed before the second click. Likely a stale-closure re-render churn from `lockFib`. → Proceed with Task 4 as designed.

**Shape B: handler fires but is rejected at one of the early returns.**
- Expected logs: `click fired` (twice), `click rejected — null price` or `click rejected — missing time/point` on the second.
- Diagnosis: `coordinateToPrice` is returning null. Possibly because the ghost line series shifted the candle series' price scale boundaries, putting the click outside the valid range. → Task 4's split-capture fix won't help. Fall back to creating ghost series once when fibDrawMode enters (not lazily). Add a Task 4-alt step in this case.

**Shape C: handler fires, branches correctly, but the lock mutation never goes out.**
- Expected logs: `click fired` (twice), `capturing point B (will lock)`, then no network request to `/fibonacci/lock`.
- Diagnosis: `lockFib.mutate` itself is broken. Different fix path entirely — investigate `useLockFib`.

Record which shape you observed before continuing.

- [ ] **Step 4: Do NOT commit yet**

The logs stay in for Task 4 so they can verify the fix. They'll be removed in Task 5.

---

## Task 4: Refactor FibDrawMode click handler — split capture from lock

This assumes Shape A from Task 3. If you observed Shape B or C, adapt as noted in Task 3 Step 3.

**Files:**
- Modify: `src/components/charts/FibDrawMode.tsx`

- [ ] **Step 1: Import the new store action**

In `src/components/charts/FibDrawMode.tsx`, update the chart store imports near line 32:

```tsx
import {
  FIB_BOUNDARY_COLOR,
  FIB_COLOR_PALETTE,
  useChartStore,
  type FibDrawPoint,
} from "@/store/chart";
```

(No change to import line; we'll add the selectors below.) Around line 97, add the pointB selector and setter:

```tsx
const fibDrawMode = useChartStore((s) => s.fibDrawMode);
const fibDrawPointA = useChartStore((s) => s.fibDrawPointA);
const fibDrawPointB = useChartStore((s) => s.fibDrawPointB);
const setFibDrawPointA = useChartStore((s) => s.setFibDrawPointA);
const setFibDrawPointB = useChartStore((s) => s.setFibDrawPointB);
const exitFibDrawMode = useChartStore((s) => s.exitFibDrawMode);
```

- [ ] **Step 2: Rewrite the click handler — capture only**

Replace the entire click effect (currently around lines 180–237) with this capture-only version:

```tsx
// ── Chart click handler — capture-only ───────────────────
//
// The handler's sole job is to write either pointA or pointB to the
// store. The lock mutation is fired by a separate effect (below) that
// watches both points. This keeps this effect's dependency array tiny
// and stable — no `lockFib` reference churn forcing constant re-
// subscriptions, which was the root cause of the second click being
// dropped (Bug 6).

useEffect(() => {
  if (!chart || !candleSeries || !fibDrawMode) return;

  const handleClick = (param: { time?: Time; point?: { x: number; y: number } }) => {
    console.log("[FibDrawMode] click fired", { time: param.time, point: param.point, hasPointA: !!fibDrawPointA });
    if (!param.time || !param.point) return;

    const price = candleSeries.coordinateToPrice(param.point.y);
    if (price === null || price === undefined) return;

    const time = typeof param.time === "number" ? param.time : 0;
    const clickPoint: FibDrawPoint = { time, price };

    if (!fibDrawPointA) {
      console.log("[FibDrawMode] capturing point A", clickPoint);
      setFibDrawPointA(clickPoint);
    } else {
      console.log("[FibDrawMode] capturing point B", clickPoint);
      setFibDrawPointB(clickPoint);
    }
  };

  chart.subscribeClick(handleClick);
  return () => {
    chart.unsubscribeClick(handleClick);
  };
}, [
  chart,
  candleSeries,
  fibDrawMode,
  fibDrawPointA,
  setFibDrawPointA,
  setFibDrawPointB,
]);
```

Note the dep array: `lockFib`, `exitFibDrawMode`, `conid`, `timeframe`, and `clearGhost` are removed. Only the things the click capture itself uses remain.

- [ ] **Step 3: Add the lock effect**

Immediately below the click effect, add:

```tsx
// ── Lock effect — fires when both points are present ─────
//
// Watches (pointA, pointB). When both are set, computes the swing
// high/low and direction, fires the lock mutation, then resets both
// points and exits draw mode. Separating this from the click handler
// is what fixes Bug 6 — the click handler no longer needs `lockFib`
// in its deps, so its subscription is stable across the user's two
// clicks.

useEffect(() => {
  if (!fibDrawPointA || !fibDrawPointB || !fibDrawMode) return;

  const swingLow = Math.min(fibDrawPointA.price, fibDrawPointB.price);
  const swingHigh = Math.max(fibDrawPointA.price, fibDrawPointB.price);
  const direction = fibDrawPointB.price > fibDrawPointA.price ? "up" : "down";

  if (conid && swingHigh > swingLow) {
    lockFib.mutate({
      conid,
      timeframe,
      tool_type: fibDrawMode,
      swing_high_price: swingHigh,
      swing_high_time:
        direction === "up" ? fibDrawPointB.time : fibDrawPointA.time,
      swing_low_price: swingLow,
      swing_low_time:
        direction === "up" ? fibDrawPointA.time : fibDrawPointB.time,
      direction,
    });
  }

  clearGhost();
  exitFibDrawMode();
}, [
  fibDrawPointA,
  fibDrawPointB,
  fibDrawMode,
  conid,
  timeframe,
  lockFib,
  clearGhost,
  exitFibDrawMode,
]);
```

`exitFibDrawMode` already resets both pointA and pointB to null (per Task 2 Step 5), so we don't need to call `setFibDrawPointB(null)` explicitly.

- [ ] **Step 4: Type-check**

Run: `npm run typecheck` (or `npx tsc --noEmit`)
Expected: PASS.

- [ ] **Step 5: Manual repro — happy path**

- Restart the dev server (the Tauri webview may need a hard reload).
- Click "Draw Fib".
- DevTools console: confirm `click effect (re)subscribing` fires.
- Click point A. Console: `click fired`, `capturing point A`.
- Click point B. Console: `click fired`, `capturing point B`.
- **Expected:**
  - Fib is locked (network call to `/fibonacci/lock` returns 200).
  - Fib appears on the chart.
  - Status pill disappears (exit draw mode).
- Repeat for "Draw Ext" — same expected behavior.

- [ ] **Step 6: Manual repro — rapid clicks**

- Click "Draw Fib".
- Click two points within ~200ms of each other.
- **Expected:** still locks correctly. No double-locks, no dropped clicks.

- [ ] **Step 7: Manual repro — Escape mid-draw**

- Click "Draw Fib".
- Click point A.
- Press Escape.
- **Expected:** pill disappears, no lock attempted, no ghost lines remain on chart.

- [ ] **Step 8: Do NOT commit yet**

The logs are still in place. Verify clean repro one more time, then proceed to Task 5 to clean up.

---

## Task 5: Remove temporary instrumentation

**Files:**
- Modify: `src/components/charts/FibDrawMode.tsx`

- [ ] **Step 1: Remove all the console.log statements added in Task 3**

Search for `[FibDrawMode]` in `src/components/charts/FibDrawMode.tsx` and delete every line. Verify no `console.log` remains in the file.

Quick check:

```bash
grep -n "console.log" src/components/charts/FibDrawMode.tsx
```

Expected: no matches.

- [ ] **Step 2: Type-check and lint**

```bash
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Final manual sanity pass**

- Repeat Task 4 Step 5 happy path once more. Confirm everything still works without the logs.

- [ ] **Step 4: Commit**

```bash
git add src/components/charts/FibDrawMode.tsx
git commit -m "fix(fib-draw): split click capture from lock to fix dropped second click (spec A bug 6)"
```

---

## Task 6: Full manual verification sweep

- [ ] **Step 1: Run the full Bug 1 test plan**

From the spec:
- Symbol with active fib → fib renders, no toast. (Regression.)
- Symbol with no_active_fib → toast once, pill auto-untoggles.
- Switch to another no-active symbol → toast fires again.
- Rapid on/off toggles on the same no-active symbol → toast fires once per deliberate user toggle.

- [ ] **Step 2: Run the full Bug 6 test plan**

From the spec:
- Draw Fib → click twice → fib locks.
- Draw Ext → click twice → fib locks.
- Two clicks within ~200ms → locks correctly.
- Escape during draw → cancels cleanly, no leftover ghost lines.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: PASS — no regressions in existing test suites.

- [ ] **Step 4: Confirm git status is clean**

```bash
git status
```

Expected: working tree clean. All three commits (Tasks 1, 2, 5) are present:

```bash
git log --oneline -5
```

Expected (top three commits):
- `fix(fib-draw): split click capture from lock to fix dropped second click (spec A bug 6)`
- `feat(chart-store): add fibDrawPointB for split-capture refactor (spec A bug 6)`
- `fix(fib): toast + auto-untoggle when no active fib (spec A bug 1)`

---

## Done

Spec A is complete. Two bugs fixed in three commits.

If during execution Task 3's investigation revealed Shape B or C (not Shape A), revisit Task 4's approach using the alternative noted in Task 3 Step 3 — but the rest of the plan structure (instrumentation → fix → cleanup → verify) holds either way.
