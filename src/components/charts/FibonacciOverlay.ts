/**
 * Fibonacci overlay for Lightweight Charts v5.
 *
 * Renders retracement levels as horizontal lines on the main price chart,
 * with a shaded golden pocket band (0.618→0.716). Extension levels are
 * rendered in a secondary color when tool_mode === "extension".
 *
 * Architecture:
 *   - Pure functions — no React. Called imperatively from ChartContainer's
 *     useEffect just like indicatorOverlays.ts.
 *   - Returns an array of ISeriesApi references so ChartContainer can
 *     clean them up when the fib data changes or the component unmounts.
 *
 * References:
 *   Ofek's spec: .auto-memory/project_fibonacci_spec.md
 *   Levels: 0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0 (retracement)
 *           1.272 → 4.618 (extension)
 *   Golden pocket: 0.618 / 0.65 / 0.716 → shaded band
 */

import {
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from "lightweight-charts";

import type { FibonacciResult, FibonacciLevel } from "@/lib/api";

// ── Color palette ────────────────────────────────────────────

const FIB_COLORS = {
  /** Normal retracement level */
  retracement: "rgba(0, 212, 255, 0.55)",         // cyan, semi-transparent
  /** Golden pocket levels (0.618/0.65/0.716) */
  goldenPocket: "rgba(255, 200, 0, 0.70)",         // warm gold
  /** Golden pocket shaded band — rendered with area fill between 0.618 and 0.716 */
  goldenPocketFill: "rgba(255, 200, 0, 0.08)",
  /** Extension levels */
  extension: "rgba(136, 68, 255, 0.55)",            // purple
  /** Swing markers (0 and 1.0 lines) */
  swingBound: "rgba(255, 255, 255, 0.25)",          // dim white
} as const;

// ── Types ────────────────────────────────────────────────────

export type FibOverlayState = ISeriesApi<"Line">[];

// ── Public API ───────────────────────────────────────────────

/**
 * Add Fibonacci overlay lines to the chart.
 *
 * Returns the series references so the caller can remove them later
 * via `removeFibonacciOverlay`.
 */
export function addFibonacciOverlay(
  chart: IChartApi,
  fib: FibonacciResult,
  candles: { time: number }[],
): FibOverlayState {
  if (!candles.length) return [];

  const firstTime = candles[0].time as Time;
  const lastTime = candles[candles.length - 1].time as Time;
  const series: FibOverlayState = [];

  // ── Retracement levels ──────────────────────────────────
  for (const level of fib.levels) {
    const s = addLevelLine(chart, level, firstTime, lastTime, "retracement");
    if (s) series.push(s);
  }

  // ── Golden pocket fill band (0.618 → 0.716) ────────────
  // Lightweight Charts v5 doesn't natively support area-between-two-lines,
  // so we approximate with two semi-transparent lines that visually create
  // a banded region. The real fill is achieved via a LineSeries with a
  // "lineVisible: false" + "topColor" area style trick. However LW Charts
  // Area is only available via AreaSeries and isn't horizontally bounded.
  // For v1 we keep the 3 GP lines extra-thick + bright which creates the
  // visual band effect traders are used to.

  // ── Extension levels ────────────────────────────────────
  for (const level of fib.extensions) {
    const s = addLevelLine(chart, level, firstTime, lastTime, "extension");
    if (s) series.push(s);
  }

  return series;
}

/**
 * Remove all Fibonacci overlay series from the chart.
 */
export function removeFibonacciOverlay(
  chart: IChartApi,
  state: FibOverlayState,
): void {
  for (const s of state) {
    try {
      chart.removeSeries(s);
    } catch {
      // Series already removed (chart destroy race)
    }
  }
}

// ── Internals ────────────────────────────────────────────────

function addLevelLine(
  chart: IChartApi,
  level: FibonacciLevel,
  firstTime: Time,
  lastTime: Time,
  kind: "retracement" | "extension",
): ISeriesApi<"Line"> | null {
  const isBoundary = level.level === 0 || level.level === 1.0;
  const isGP = level.golden_pocket;

  let color: string;
  let lineWidth: number;
  let lineStyle: number; // 0=solid, 2=dashed, 3=dotted

  if (isBoundary) {
    color = FIB_COLORS.swingBound;
    lineWidth = 1;
    lineStyle = 3; // dotted
  } else if (isGP) {
    color = FIB_COLORS.goldenPocket;
    lineWidth = 2;
    lineStyle = 0; // solid — GP band should stand out
  } else if (kind === "extension") {
    color = FIB_COLORS.extension;
    lineWidth = 1;
    lineStyle = 2; // dashed
  } else {
    color = FIB_COLORS.retracement;
    lineWidth = 1;
    lineStyle = 2; // dashed
  }

  const data: LineData<Time>[] = [
    { time: firstTime, value: level.price },
    { time: lastTime, value: level.price },
  ];

  const series = chart.addSeries(LineSeries, {
    color,
    lineWidth: lineWidth as 1 | 2 | 3 | 4,
    lineStyle,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    // Title shows the level label on the price scale
    title: level.label,
  });
  series.setData(data);
  return series;
}
