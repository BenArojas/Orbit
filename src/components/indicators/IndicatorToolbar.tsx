/**
 * IndicatorToolbar — Row of all 14 indicator pills
 *
 * Renders in the Analysis page toolbar, between the timeframe bar and the
 * chart area. Each pill toggles its indicator on/off via the chart store.
 *
 * Separated by a thin divider from the timeframe selector to give visual
 * breathing room in the dense toolbar.
 */

import IndicatorPill, { INDICATOR_ORDER } from "./IndicatorPill";

export default function IndicatorToolbar() {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Divider from timeframe bar */}
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />

      {INDICATOR_ORDER.map((id) => (
        <IndicatorPill key={id} id={id} />
      ))}
    </div>
  );
}
