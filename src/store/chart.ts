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

interface ChartState {
  /** Currently viewed instrument (null = nothing selected) */
  activeConid: number | null;

  /** Symbol string for display (resolved from instruments table) */
  activeSymbol: string;

  /** Selected timeframe */
  timeframe: Timeframe;

  /** Set of toggled-on indicator IDs */
  activeIndicators: Set<IndicatorId>;

  /** Actions */
  setActiveConid: (conid: number) => void;
  setActiveSymbol: (symbol: string) => void;
  setTimeframe: (tf: Timeframe) => void;
  toggleIndicator: (id: IndicatorId) => void;
  setIndicators: (ids: IndicatorId[]) => void;
  clearChart: () => void;
}

/** Default indicators toggled on for new sessions */
const DEFAULT_INDICATORS: IndicatorId[] = [
  "ema9",
  "ema21",
  "ema50",
  "volume",
  "rsi",
  "fibonacci",
];

export const useChartStore = create<ChartState>()((set) => ({
  activeConid: null,
  activeSymbol: "",
  timeframe: "1D",
  activeIndicators: new Set<IndicatorId>(DEFAULT_INDICATORS),

  setActiveConid: (conid) => set({ activeConid: conid }),

  setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),

  setTimeframe: (tf) => set({ timeframe: tf }),

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
    }),
}));
