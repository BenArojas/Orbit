/**
 * IndicatorPill — Toggleable indicator chip with glow effect
 *
 * Displays an indicator name as a small pill/chip. When active (toggled on),
 * it glows with a color specific to that indicator. Clicking toggles it on/off
 * via the chart store.
 *
 * Color mapping matches the approved mockup (demo-layout-a-v2.html):
 *   EMAs → blue, RSI → purple, MACD → purple, Fibonacci → green,
 *   Volume → cyan, Bollinger → orange, VWAP → cyan, ATR → orange,
 *   Stochastic → purple, OBV → cyan, ADX → orange
 */

import { useChartStore, type IndicatorId } from "@/store";

/* ── Color + label config per indicator ── */

interface PillConfig {
  label: string;
  /** CSS variable name for the color (e.g. "blue" → var(--clr-blue)) */
  color: string;
}

const PILL_CONFIG: Record<IndicatorId, PillConfig> = {
  ema9:       { label: "EMA 9",   color: "blue" },
  ema21:      { label: "EMA 21",  color: "blue" },
  ema50:      { label: "EMA 50",  color: "orange" },
  ema200:     { label: "EMA 200", color: "red" },
  rsi:        { label: "RSI",     color: "purple" },
  macd:       { label: "MACD",    color: "purple" },
  fibonacci:  { label: "Fib",     color: "green" },
  volume:     { label: "Vol",     color: "cyan" },
  bollinger:  { label: "BB",      color: "cyan" },
  vwap:       { label: "VWAP",    color: "cyan" },
  atr:        { label: "ATR",     color: "orange" },
  stochastic: { label: "Stoch",   color: "purple" },
  obv:        { label: "OBV",     color: "cyan" },
  adx:        { label: "ADX",     color: "orange" },
};

/** Display order — matches mockup toolbar layout */
export const INDICATOR_ORDER: IndicatorId[] = [
  "ema9", "ema21", "ema50", "ema200",
  "rsi", "macd", "fibonacci", "volume",
  "bollinger", "vwap", "atr",
  "stochastic", "obv", "adx",
];

interface IndicatorPillProps {
  id: IndicatorId;
}

export default function IndicatorPill({ id }: IndicatorPillProps) {
  const activeIndicators = useChartStore((s) => s.activeIndicators);
  const toggleIndicator = useChartStore((s) => s.toggleIndicator);

  const config = PILL_CONFIG[id];
  const isActive = activeIndicators.has(id);

  const colorVar = `var(--clr-${config.color})`;
  const glowVar = `var(--glow-${config.color})`;

  return (
    <button
      onClick={() => toggleIndicator(id)}
      className="rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium transition-all duration-150 cursor-pointer"
      style={
        isActive
          ? {
              borderColor: colorVar,
              color: colorVar,
              background: glowVar,
              boxShadow: `0 0 8px ${glowVar}`,
            }
          : {
              borderColor: "var(--border)",
              color: "var(--text-3)",
              background: "transparent",
            }
      }
      title={`Toggle ${config.label}`}
    >
      {config.label}
    </button>
  );
}
