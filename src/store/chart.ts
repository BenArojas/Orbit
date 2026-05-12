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

import type { FibonacciCandidate } from "@/lib/api";

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

  /** Actions */
  setActiveConid: (conid: number) => void;
  setActiveSymbol: (symbol: string) => void;
  setTimeframe: (tf: Timeframe) => void;
  toggleIndicator: (id: IndicatorId) => void;
  setIndicators: (ids: IndicatorId[]) => void;
  clearChart: () => void;
  enterFibDrawMode: (mode: FibDrawMode) => void;
  setFibDrawPointA: (pt: FibDrawPoint) => void;
  exitFibDrawMode: () => void;
  /** Render this candidate's fib instead of the auto primary. */
  setDisplayedFib: (candidate: FibonacciCandidate) => void;
  /** Reset to auto primary (clears the override). */
  clearDisplayedFib: () => void;
  /** Hide the fib overlay without untoggling the indicator pill. */
  clearChartFib: () => void;
}

/**
 * Default indicators toggled on for new sessions.
 *
 * Empty by design — the chart loads clean (candles only) so the trader
 * can read price action without visual clutter. Indicators are opt-in
 * via the toolbar pills.
 */
const DEFAULT_INDICATORS: IndicatorId[] = [];

export const useChartStore = create<ChartState>()((set) => ({
  activeConid: null,
  activeSymbol: "",
  timeframe: "1D",
  activeIndicators: new Set<IndicatorId>(DEFAULT_INDICATORS),
  fibDrawMode: null,
  fibDrawPointA: null,
  displayedFibOverride: null,
  fibCleared: false,

  setActiveConid: (conid) => set({ activeConid: conid }),

  setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),

  setTimeframe: (tf) =>
    // Switching timeframe re-fetches data; clear fib state so the
    // override doesn't persist across timeframes the user didn't ask
    // for it on.
    set({ timeframe: tf, displayedFibOverride: null, fibCleared: false }),

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
      displayedFibOverride: null,
      fibCleared: false,
    }),

  enterFibDrawMode: (mode) =>
    set({ fibDrawMode: mode, fibDrawPointA: null }),

  setFibDrawPointA: (pt) =>
    set({ fibDrawPointA: pt }),

  exitFibDrawMode: () =>
    set({ fibDrawMode: null, fibDrawPointA: null }),

  setDisplayedFib: (candidate) =>
    // Picking a candidate implies the user wants to see it — un-clear
    // any prior dismissal.
    set({ displayedFibOverride: candidate, fibCleared: false }),

  clearDisplayedFib: () =>
    set({ displayedFibOverride: null }),

  clearChartFib: () =>
    set({ fibCleared: true, displayedFibOverride: null }),
}));
