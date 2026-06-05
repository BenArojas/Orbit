/**
 * IndicatorPill — Toggleable indicator chip with glow effect
 *
 * Displays an indicator name as a small pill/chip. When active (toggled on),
 * it glows with a color specific to that indicator. Clicking toggles it on/off
 * via the chart store.
 *
 * Color mapping is synced with indicatorOverlays.ts so each pill matches
 * the actual line color drawn on the chart — the visual association is the
 * whole point ("cyan pill = cyan EMA line on the chart").
 *
 *   EMA 9   → cyan   (matches #00d4ff chart line)
 *   EMA 21  → purple (matches #b44dff chart line)
 *   EMA 50  → orange (matches #ff9f1c chart line)
 *   EMA 200 → red    (matches #ff4466 chart line)
 *   BB      → blue   (matches rgba(68,136,255) bands)
 *   VWAP    → orange (matches #ff9f1c chart line)
 */

import { useChartStore, type IndicatorId } from "@/store";

/* ── Color + label config per indicator ── */

interface PillConfig {
  label: string;
  /** CSS variable name for the color (e.g. "blue" → var(--clr-blue)) */
  color: string;
}

const PILL_CONFIG: Record<IndicatorId, PillConfig> = {
  // Overlays — colors match indicatorOverlays.ts INDICATOR_COLORS exactly
  ema9:       { label: "EMA 9",   color: "cyan" },   // #00d4ff
  ema21:      { label: "EMA 21",  color: "purple" },  // #b44dff
  ema50:      { label: "EMA 50",  color: "orange" },  // #ff9f1c
  ema200:     { label: "EMA 200", color: "red" },     // #ff4466
  bollinger:  { label: "BB",      color: "blue" },    // rgba(68,136,255)
  vwap:       { label: "VWAP",    color: "orange" },  // #ff9f1c
  // Sub-chart indicators
  rsi:        { label: "RSI",     color: "purple" },
  macd:       { label: "MACD",    color: "cyan" },
  stochastic: { label: "Stoch",   color: "green" },
  obv:        { label: "OBV",     color: "blue" },
  // Value indicators
  atr:        { label: "ATR",     color: "red" },
  adx:        { label: "ADX",     color: "orange" },
  // Other overlays
  volume:     { label: "Vol",     color: "blue" },
  fibonacci:  { label: "Fib",     color: "green" },
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
      className="rounded-full border px-2.5 py-1 font-data text-[10px] font-medium transition-all duration-150"
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
