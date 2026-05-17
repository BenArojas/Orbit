/**
 * Chart Store — Technical Analysis screen state
 *
 * Tracks which instrument is being analyzed, active timeframe,
 * and which indicators are toggled on/off.
 *
 * Hub integration: conid (IBKR contract ID) is the universal instrument key.
 * When Inflect queries /indicators for trade context, it sends the same conid
 * stored here. No special Inflect logic needed — it's a natural API consumer.
 */

import { create } from "zustand";

import type { FibonacciCandidate, FibonacciResult } from "@/lib/api";
import { useDrawingsStore } from "@/store/drawings";

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1D" | "1W" | "1M";

/** Matches the 14 indicators from PROJECT_PLAN.md */
export type IndicatorId =
  | "rsi"
  | "macd"
  | "ema9"
  | "ema21"
  | "ema50"
  | "ema200"
  | "fibonacci"
  | "volume"
  | "bollinger"
  | "vwap"
  | "atr"
  | "stochastic"
  | "obv"
  | "adx";

/** Mode for fib manual draw. null = not drawing. */
export type FibDrawMode = "retracement" | "extension";

/** The two click points captured during manual fib drawing. */
export interface FibDrawPoint {
  time: number;  // Unix seconds
  price: number;
}

// ── Active fibs (Branch 4) ───────────────────────────────────
//
// The chart can render multiple fibs at once: an auto-detected primary
// (or user-picked override) plus any number of user-locked fibs. The
// store owns the ordered list; the overlay layer renders them; the
// FibStackPanel surfaces them as cards. Locked fibs persist
// per-conid in SQLite and show on all timeframes (per Ofek's spec).

/**
 * One fib being rendered on the chart. The primary (auto or override)
 * lives at index 0 of `activeFibs`; locked fibs follow in lock order.
 *
 *   - `id` is "primary" for index 0 and "lock-{lockId}" for locked entries.
 *   - `lockId` is the SQLite primary key for locked fibs (null otherwise).
 *   - `colorIndex` is the position in FIB_COLOR_PALETTE.
 *
 * Plan: docs/fibonacci-improvements-plan.md, Branch 4 / item 8.
 */
export interface ActiveFib {
  id: string;
  source: "auto" | "manual" | "locked";
  lockId: number | null;
  result: FibonacciResult;
  colorIndex: number;
}

/**
 * Color palette for stacked fibs. Index 0 is reserved for the
 * primary — the current `FibonacciOverlay` palette (gold GP / cyan
 * retracement / purple extension). Each subsequent slot is a muted
 * palette so the primary stays salient.
 *
 * Each entry exposes the colors the overlay needs to know about.
 * Hex / rgba literals — alpha will be modulated at render time
 * (locked fibs render at ~0.55× opacity per plan decision 8C).
 *
 * Branch 6 (plan decision 2A) keeps the per-fib color theming for
 * GP / non-GP retracement / extension but moves the SWING BOUNDARY
 * lines (0 and 1.0) to a shared bright magenta so they always pop
 * against bull-green / bear-red candles, regardless of which fib
 * they belong to. The per-fib disambiguation is carried by the
 * "(P)" / "(L1)" / "(L2)" suffix on the price scale instead.
 */
export interface FibPaletteEntry {
  /** Color for the golden-pocket levels (0.618 / 0.65 / 0.716). */
  goldenPocket: string;
  /** Color for non-GP retracement levels. */
  retracement: string;
  /** Color for extension levels. */
  extension: string;
  /** Human-readable name used in the legend. */
  name: string;
}

/**
 * Shared color for swing boundary lines (the 0 and 1.0 retracement
 * levels). Used across all fibs. Magenta — high contrast against the
 * bull-green / bear-red candle palette, no risk of being mistaken for
 * a price-direction signal. (Plan decision 2A.)
 */
export const FIB_BOUNDARY_COLOR = "rgba(255, 60, 220, 0.85)";

export const FIB_COLOR_PALETTE: readonly FibPaletteEntry[] = [
  // 0 — primary. Opacity bumped (0.55/0.70 → 0.85) per Branch 6:
  // non-GP retracement lines now match GP weight + font, so they need
  // a similar visual presence too.
  {
    goldenPocket: "rgba(255, 200, 0, 0.85)",
    retracement:  "rgba(0, 212, 255, 0.85)",
    extension:    "rgba(136, 68, 255, 0.55)",
    name: "Primary",
  },
  // 1 — teal. Bumped from 0.55/0.40 → 0.75/0.65 so locked retracement
  // lines stay legible after the 0.55× locked-opacity scaling.
  {
    goldenPocket: "rgba(64, 224, 208, 0.75)",
    retracement:  "rgba(64, 224, 208, 0.65)",
    extension:    "rgba(64, 224, 208, 0.45)",
    name: "Teal",
  },
  // 2 — salmon
  {
    goldenPocket: "rgba(250, 128, 114, 0.75)",
    retracement:  "rgba(250, 128, 114, 0.65)",
    extension:    "rgba(250, 128, 114, 0.45)",
    name: "Salmon",
  },
  // 3 — lavender
  {
    goldenPocket: "rgba(181, 126, 220, 0.75)",
    retracement:  "rgba(181, 126, 220, 0.65)",
    extension:    "rgba(181, 126, 220, 0.45)",
    name: "Lavender",
  },
  // 4 — sage
  {
    goldenPocket: "rgba(143, 188, 143, 0.75)",
    retracement:  "rgba(143, 188, 143, 0.65)",
    extension:    "rgba(143, 188, 143, 0.45)",
    name: "Sage",
  },
  // 5 — amber
  {
    goldenPocket: "rgba(255, 159, 28, 0.75)",
    retracement:  "rgba(255, 159, 28, 0.65)",
    extension:    "rgba(255, 159, 28, 0.45)",
    name: "Amber",
  },
  // 6 — rose
  {
    goldenPocket: "rgba(255, 102, 153, 0.75)",
    retracement:  "rgba(255, 102, 153, 0.65)",
    extension:    "rgba(255, 102, 153, 0.45)",
    name: "Rose",
  },
  // 7 — sky
  {
    goldenPocket: "rgba(135, 206, 235, 0.75)",
    retracement:  "rgba(135, 206, 235, 0.65)",
    extension:    "rgba(135, 206, 235, 0.45)",
    name: "Sky",
  },
];

/**
 * Visual reminder threshold — when activeFibs reaches this size, the
 * FibStackPanel surfaces a yellow warning. The chart still functions
 * but the user is told things are getting cluttered.
 * Plan decision 8B.
 */
export const FIB_STACK_SOFT_CAP = 5;

/**
 * Hard cap — addLockedFib refuses to add beyond this count.
 * Plan decision 8B.
 */
export const FIB_STACK_HARD_CAP = 8;

interface ChartState {
  /** Currently viewed instrument (null = nothing selected) */
  activeConid: number | null;

  /** Symbol string for display (resolved from instruments table) */
  activeSymbol: string;

  /** Selected timeframe */
  timeframe: Timeframe;

  /** Set of toggled-on indicator IDs */
  activeIndicators: Set<IndicatorId>;

  /** Fibonacci manual draw mode — null when not drawing */
  fibDrawMode: FibDrawMode | null;

  /** First click captured (swing point A); null until user clicks */
  fibDrawPointA: FibDrawPoint | null;

  /** Second click captured (swing point B); null until user clicks the second point */
  fibDrawPointB: FibDrawPoint | null;

  /**
   * Candidate the user clicked in the Candidates panel to render
   * on the chart in place of the auto-detected primary. null when
   * the chart should show the auto result. Branch 3, plan decision 4.
   */
  displayedFibOverride: FibonacciCandidate | null;

  /**
   * When true, the chart overlay is suppressed even if a fib is
   * available — used by the "Clear chart fib" button. Resets on
   * timeframe change, conid change, or when the user picks a new
   * candidate. Branch 3, plan decision 4B.
   */
  fibCleared: boolean;

  /**
   * Ordered list of fibs currently rendered on the chart.
   *   - index 0 is the primary (auto or override).
   *   - index 1+ are locked fibs in lock order.
   *
   * Branch 4 / plan item 8. The list is conid-scoped (cleared on
   * conid change via clearChart) but persists across timeframe
   * switches — locked fibs show on all TFs per Ofek's spec.
   */
  activeFibs: ActiveFib[];

  /**
   * Incremented by requestResetZoom(). ChartContainer watches this and calls
   * priceScale("right").applyOptions({ autoScale: true }) + timeScale().fitContent()
   * when it changes.
   */
  resetZoomRequestId: number;

  /** Actions */
  setActiveConid: (conid: number) => void;
  setActiveSymbol: (symbol: string) => void;
  setTimeframe: (tf: Timeframe) => void;
  toggleIndicator: (id: IndicatorId) => void;
  setIndicators: (ids: IndicatorId[]) => void;
  clearChart: () => void;
  enterFibDrawMode: (mode: FibDrawMode) => void;
  setFibDrawPointA: (pt: FibDrawPoint) => void;
  setFibDrawPointB: (pt: FibDrawPoint | null) => void;
  exitFibDrawMode: () => void;
  /** Render this candidate's fib instead of the auto primary. */
  setDisplayedFib: (candidate: FibonacciCandidate) => void;
  /** Reset to auto primary (clears the override). */
  clearDisplayedFib: () => void;
  /** Hide the fib overlay without untoggling the indicator pill. */
  clearChartFib: () => void;
  /**
   * Replace activeFibs[0] with `result`, or remove it when `result` is
   * null. Used by useChartData to publish the auto / override primary
   * into the store so the overlay layer can read everything from one
   * place. Branch 4.
   */
  setPrimaryFib: (
    result: FibonacciResult | null,
    source?: "auto" | "manual",
  ) => void;
  /**
   * Append a locked fib to activeFibs, dedup'd by lockId. Returns
   * true on success, false when the hard cap is hit. Branch 4.
   */
  addLockedFib: (lockId: number, result: FibonacciResult) => boolean;
  /**
   * Replace the entire LOCKED portion of activeFibs with the given
   * entries. The primary (index 0, id === "primary") is preserved
   * regardless. Each entry's colorIndex is preserved if the caller
   * supplies one; otherwise it gets a fresh allocation from the
   * palette. Used by useMergeLockedFibsIntoStore to do a full sync
   * against the server's lock list instead of append-only updates.
   * Branch — Bug 2 fix.
   */
  replaceLockedFibs: (
    entries: { lockId: number; result: FibonacciResult }[],
  ) => void;
  /** Remove an active fib by its id ("primary" or "lock-<id>"). */
  removeActiveFib: (id: string) => void;
  /** Wipe the entire stack. Called on conid change via clearChart. */
  clearAllActiveFibs: () => void;
  requestResetZoom: () => void;
}

/**
 * Default indicators toggled on for new sessions.
 *
 * Empty by design — the chart loads clean (candles only) so the trader
 * can read price action without visual clutter. Indicators are opt-in
 * via the toolbar pills.
 */
const DEFAULT_INDICATORS: IndicatorId[] = [];

export const useChartStore = create<ChartState>()((set, get) => ({
  activeConid: null,
  activeSymbol: "",
  timeframe: "1D",
  activeIndicators: new Set<IndicatorId>(DEFAULT_INDICATORS),
  fibDrawMode: null,
  fibDrawPointA: null,
  fibDrawPointB: null,
  displayedFibOverride: null,
  fibCleared: false,
  activeFibs: [],
  resetZoomRequestId: 0,

  // Branch 7 / plan decisions 10A + 10B:
  // Switching to a new instrument resets the whole chart so the
  // trader gets a clean slate. Indicators chosen for AAPL rarely
  // make sense for, say, ES futures; carrying over fib state,
  // draw mode, or candidate overrides is even more surprising.
  // The AI chat is cleared by an effect in AnalysisPage.tsx (it
  // owns the cross-store coordination so this slice stays self-
  // contained). Locked fibs are conid-scoped on the server — the
  // useLockedFibs query refetches and repopulates `activeFibs`
  // for the new conid asynchronously.
  //
  // Same-conid sets are idempotent (no-op) so callers can safely
  // re-issue the same value without nuking state. activeSymbol
  // is intentionally NOT touched — the symbol resolver writes it
  // independently and shouldn't race with this reset.
  setActiveConid: (conid) =>
    set((state) => {
      if (state.activeConid === conid) return {};
      // Also clear ephemeral drawing tool state on instrument change.
      // The drawings themselves are conid-scoped on the server; the GET
      // query for the new conid will repopulate via DrawingsLayer.
      useDrawingsStore.getState().resetDrawingsForConidChange();
      return {
        activeConid: conid,
        timeframe: "1D",
        activeIndicators: new Set<IndicatorId>(DEFAULT_INDICATORS),
        fibDrawMode: null,
        fibDrawPointA: null,
        fibDrawPointB: null,
        displayedFibOverride: null,
        fibCleared: false,
        activeFibs: [],
      };
    }),

  setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),

  setTimeframe: (tf) =>
    // Switching timeframe re-fetches data; clear fib state so the
    // override doesn't persist across timeframes the user didn't ask
    // for it on. activeFibs is also cleared — useLockedFibs will
    // repopulate locked entries from cache once the new TF settles
    // (locked fibs are per-conid, not per-TF).
    set({
      timeframe: tf,
      displayedFibOverride: null,
      fibCleared: false,
      activeFibs: [],
    }),

  toggleIndicator: (id) =>
    set((state) => {
      const next = new Set(state.activeIndicators);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { activeIndicators: next };
    }),

  setIndicators: (ids) =>
    set({ activeIndicators: new Set<IndicatorId>(ids) }),

  clearChart: () =>
    set({
      activeConid: null,
      activeSymbol: "",
      timeframe: "1D",
      activeIndicators: new Set<IndicatorId>(DEFAULT_INDICATORS),
      fibDrawMode: null,
      fibDrawPointA: null,
      fibDrawPointB: null,
      displayedFibOverride: null,
      fibCleared: false,
      activeFibs: [],
    }),

  enterFibDrawMode: (mode) =>
    set({ fibDrawMode: mode, fibDrawPointA: null, fibDrawPointB: null }),

  setFibDrawPointA: (pt) =>
    set({ fibDrawPointA: pt }),

  setFibDrawPointB: (pt) =>
    set({ fibDrawPointB: pt }),

  exitFibDrawMode: () =>
    set({ fibDrawMode: null, fibDrawPointA: null, fibDrawPointB: null }),

  setDisplayedFib: (candidate) =>
    // Picking a candidate implies the user wants to see it — un-clear
    // any prior dismissal.
    set({ displayedFibOverride: candidate, fibCleared: false }),

  clearDisplayedFib: () =>
    set({ displayedFibOverride: null }),

  clearChartFib: () =>
    // "Clear fib": remove the primary from the stack, drop any
    // override, mark cleared so the overlay layer skips. Locked
    // fibs stay — they're independent of the primary.
    set((state) => ({
      fibCleared: true,
      displayedFibOverride: null,
      activeFibs: state.activeFibs.filter((f) => f.source === "locked"),
    })),

  // ── Branch 4 — active fib stack ──────────────────────────

  setPrimaryFib: (result, source = "auto") =>
    set((state) => {
      // Remove any existing primary (whatever its source flag was).
      const withoutPrimary = state.activeFibs.filter(
        (f) => f.id !== "primary",
      );
      if (result === null) {
        return { activeFibs: withoutPrimary };
      }
      const primary: ActiveFib = {
        id: "primary",
        source,
        lockId: null,
        result,
        colorIndex: 0,
      };
      return { activeFibs: [primary, ...withoutPrimary] };
    }),

  addLockedFib: (lockId, result) => {
    const state = get();
    // Dedup by lockId so re-fetches don't multiply the list.
    if (state.activeFibs.some((f) => f.lockId === lockId)) {
      return true;
    }
    if (state.activeFibs.length >= FIB_STACK_HARD_CAP) {
      // Hard cap reached — refuse the addition. Caller surfaces a
      // toast / warning. (Plan decision 8B.)
      return false;
    }
    // Pick the lowest unused palette index in [1..palette.length-1].
    // Falls back to wrapping around when the palette is exhausted
    // (shouldn't happen with HARD_CAP=8 and palette=8 entries).
    const usedIndices = new Set(state.activeFibs.map((f) => f.colorIndex));
    let colorIndex = 1;
    while (colorIndex < FIB_COLOR_PALETTE.length && usedIndices.has(colorIndex)) {
      colorIndex += 1;
    }
    if (colorIndex >= FIB_COLOR_PALETTE.length) {
      colorIndex = 1; // wrap — visual collision is acceptable past 8 fibs.
    }
    const locked: ActiveFib = {
      id: `lock-${lockId}`,
      source: "locked",
      lockId,
      result,
      colorIndex,
    };
    set({ activeFibs: [...state.activeFibs, locked] });
    return true;
  },

  // Bug-2 fix. The previous append-only `addLockedFib` flow couldn't
  // remove locked fibs that disappeared from the server's response.
  // That broke the unlock UX: deleting a fib optimistically cleared
  // it from the store, but the very next render of the merge effect
  // saw it again in the still-stale TanStack Query cache and
  // re-added it. The full-replace flow below is the canonical sync
  // of "what the server has" → "what we render".
  replaceLockedFibs: (entries) =>
    set((state) => {
      const primary = state.activeFibs.find((f) => f.id === "primary");
      // Re-allocate color indices so we keep the palette gap-free
      // when locks are added / removed in any order. Each entry gets
      // the next unused slot starting from 1.
      const built: ActiveFib[] = [];
      let nextColorIndex = 1;
      for (const { lockId, result } of entries) {
        const colorIndex = Math.max(
          1,
          nextColorIndex < FIB_COLOR_PALETTE.length
            ? nextColorIndex
            : 1, // wrap; visual collision acceptable past palette size
        );
        nextColorIndex += 1;
        built.push({
          id: `lock-${lockId}`,
          source: "locked",
          lockId,
          result,
          colorIndex,
        });
      }
      const next = primary ? [primary, ...built] : built;
      return { activeFibs: next };
    }),

  removeActiveFib: (id) =>
    set((state) => ({
      activeFibs: state.activeFibs.filter((f) => f.id !== id),
    })),

  clearAllActiveFibs: () => set({ activeFibs: [] }),

  requestResetZoom: () => set((s) => ({ resetZoomRequestId: s.resetZoomRequestId + 1 })),
}));
