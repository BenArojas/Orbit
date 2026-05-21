/** Indicator → visual family. Single source of truth for tag colors. */
export type IndicatorFamily =
  | "momentum"
  | "trend"
  | "volume"
  | "fibonacci"
  | "news"
  | "other";

export const INDICATOR_FAMILY: Record<string, IndicatorFamily> = {
  rsi: "momentum",
  macd: "momentum",
  stoch: "momentum",
  bbands: "momentum",
  ema_9: "trend",
  ema_20: "trend",
  ema_21: "trend",
  ema_50: "trend",
  ema_200: "trend",
  vwap: "trend",
  adx: "trend",
  volume: "volume",
  obv: "volume",
  atr: "volume",
  fibonacci: "fibonacci",
  news_candle: "news",
};

export const FAMILY_COLOR: Record<IndicatorFamily, string> = {
  momentum: "var(--clr-purple)",
  trend: "var(--clr-cyan)",
  volume: "var(--clr-orange)",
  fibonacci: "var(--clr-green)",
  news: "var(--clr-red)",
  other: "var(--text-3)",
};

export function familyFor(indicator: string): IndicatorFamily {
  return INDICATOR_FAMILY[indicator] ?? "other";
}

export function colorFor(indicator: string): string {
  return FAMILY_COLOR[familyFor(indicator)];
}

/** Pick the dominant indicator family for a multi-indicator rule. */
export function dominantFamily(indicators: string[]): IndicatorFamily {
  if (indicators.length === 0) return "other";
  const counts = new Map<IndicatorFamily, number>();
  for (const ind of indicators) {
    const f = familyFor(ind);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
