/**
 * AtrBadge — shows the current ATR(14) value as a numeric badge in the toolbar.
 *
 * ATR is a "value" type indicator — not rendered as a chart series. When the
 * user toggles ATR on, this badge appears in the toolbar next to the indicator
 * pills, showing the latest ATR reading from the most recent bar.
 *
 * Returns null when the ATR indicator result is absent or has no data yet
 * (e.g. while loading or if the candle count is below the 14-bar minimum).
 */

import type { IndicatorResult } from "@/modules/parallax/api";

interface AtrBadgeProps {
  indicators: IndicatorResult[];
}

export default function AtrBadge({ indicators }: AtrBadgeProps) {
  const atrResult = indicators.find((ind) => ind.name === "atr");
  if (!atrResult || atrResult.values.length === 0) return null;

  const lastValue = atrResult.values[atrResult.values.length - 1].value;
  if (lastValue == null || isNaN(lastValue)) return null;

  return (
    <div className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2.5 py-1">
      <span className="font-data text-[9px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
        ATR
      </span>
      <span
        className="font-data text-[11px] font-bold"
        style={{ color: "#ff9f1c" }}
      >
        {lastValue.toFixed(2)}
      </span>
    </div>
  );
}
