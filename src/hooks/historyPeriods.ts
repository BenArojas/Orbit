import type { Timeframe } from "@/store/chart";

export const HISTORY_PERIOD_LADDER = [
  "1D",
  "2D",
  "5D",
  "1W",
  "1M",
  "3M",
  "6M",
  "1Y",
  "2Y",
  "5Y",
  "10Y",
  "15Y",
] as const;

export type HistoryPeriod = (typeof HISTORY_PERIOD_LADDER)[number];

const MIN_PERIOD_FOR_EMA_200: Record<Timeframe, HistoryPeriod> = {
  "1m": "1D",
  "5m": "5D",
  "15m": "1M",
  "1h": "3M",
  "4h": "6M",
  "1D": "1Y",
  "1W": "5Y",
  "1M": "15Y",
};

export const TIMEFRAME_PERIOD_CEILING: Record<Timeframe, HistoryPeriod> = {
  "1m": "2D",
  "5m": "5D",
  "15m": "1M",
  "1h": "6M",
  "4h": "1Y",
  "1D": "5Y",
  "1W": "15Y",
  "1M": "15Y",
};

export function normalizeHistoryPeriod(period: string): HistoryPeriod {
  const upper = period.toUpperCase();
  return (HISTORY_PERIOD_LADDER as readonly string[]).includes(upper)
    ? (upper as HistoryPeriod)
    : "3M";
}

function periodIndex(period: HistoryPeriod): number {
  return HISTORY_PERIOD_LADDER.indexOf(period);
}

export function clampHistoryPeriodToTimeframe(
  period: HistoryPeriod | string,
  timeframe: Timeframe,
): HistoryPeriod {
  const normalized = normalizeHistoryPeriod(period);
  const ceiling = TIMEFRAME_PERIOD_CEILING[timeframe];
  return periodIndex(normalized) > periodIndex(ceiling) ? ceiling : normalized;
}

export function chartHistoryPeriodForTimeframe(
  timeframe: Timeframe,
  preferredPeriod: string,
): HistoryPeriod {
  const preferred = normalizeHistoryPeriod(preferredPeriod);
  const ceiling = TIMEFRAME_PERIOD_CEILING[timeframe];
  const minimum = MIN_PERIOD_FOR_EMA_200[timeframe];

  if (periodIndex(preferred) > periodIndex(ceiling)) {
    return minimum;
  }

  return periodIndex(preferred) < periodIndex(minimum) ? minimum : preferred;
}
