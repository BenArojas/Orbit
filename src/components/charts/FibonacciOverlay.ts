/**
 * Fibonacci overlay for Lightweight Charts v5.
 *
 * Renders retracement + extension levels as horizontal lines on the
 * main price chart. Branch 4 adds support for multiple stacked fibs
 * (primary + locked) — each gets a color slot from FIB_COLOR_PALETTE
 * and an opacity multiplier so the primary stays visually dominant.
 *
 * Architecture:
 *   - Pure functions — no React. Called imperatively from
 *     ChartContainer's useEffect just like indicatorOverlays.ts.
 *   - Returns an array of ISeriesApi references so ChartContainer can
 *     clean them up when the fib data changes or the component
 *     unmounts.
 *
 * References:
 *   Ofek's spec: .auto-memory/project_fibonacci_spec.md
 *   Plan: docs/fibonacci-improvements-plan.md (Branches 1, 3, 4)
 *   Levels: 0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0 (retracement)
 *           1.272 → 4.618 (extension)
 *   Golden pocket: 0.618 / 0.65 / 0.716 → visually band-like
 */

import {
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from "lightweight-charts";

import type { FibonacciLevel } from "@/modules/parallax/api";
import {
  FIB_BOUNDARY_COLOR,
  FIB_COLOR_PALETTE,
  type ActiveFib,
  type FibPaletteEntry,
} from "@/store/chart";

// ── Types ────────────────────────────────────────────────────

export type FibOverlayState = ISeriesApi<"Line">[];

// ── Opacity multipliers ──────────────────────────────────────
//
// Primary stays at full opacity; locked fibs render dimmer so the
// primary remains salient (plan decision 8C). Multiplying with the
// palette's baked-in alpha gives us simple visual hierarchy without
// a second palette set.

const PRIMARY_OPACITY = 1.0;
const LOCKED_OPACITY = 0.55;

// ── Public API ───────────────────────────────────────────────

/**
 * Add overlays for an ordered list of fibs.
 *
 * Each ActiveFib is rendered using FIB_COLOR_PALETTE[fib.colorIndex],
 * with the primary at full opacity and locked entries dimmed. Level
 * labels include a per-fib suffix — "(P)" for the primary, "(L1)",
 * "(L2)" etc. for locked fibs in stack order — so traders can tell at
 * a glance which line belongs to which fib.
 */
export function addFibonacciOverlays(
  chart: IChartApi,
  fibs: ActiveFib[],
  candles: { time: number }[],
): FibOverlayState {
  if (!candles.length || fibs.length === 0) return [];

  const firstTime = candles[0].time as Time;
  const lastTime = candles[candles.length - 1].time as Time;
  const series: FibOverlayState = [];

  // Track how many locked fibs we've already painted so the label
  // suffix ("L1", "L2", ...) reflects display order, not the lockId.
  let lockedSeen = 0;

  for (const fib of fibs) {
    const palette =
      FIB_COLOR_PALETTE[fib.colorIndex] ?? FIB_COLOR_PALETTE[0];
    const isPrimary = fib.id === "primary";
    const labelSuffix = isPrimary
      ? "(P)"
      : `(L${++lockedSeen})`;
    const opacity = isPrimary ? PRIMARY_OPACITY : LOCKED_OPACITY;

    for (const level of fib.result.levels) {
      const s = addLevelLine(
        chart,
        level,
        firstTime,
        lastTime,
        "retracement",
        palette,
        opacity,
        labelSuffix,
      );
      if (s) series.push(s);
    }
    for (const level of fib.result.extensions) {
      const s = addLevelLine(
        chart,
        level,
        firstTime,
        lastTime,
        "extension",
        palette,
        opacity,
        labelSuffix,
      );
      if (s) series.push(s);
    }
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
  palette: FibPaletteEntry,
  opacity: number,
  labelSuffix: string,
): ISeriesApi<"Line"> | null {
  // A level can project to a non-positive price — e.g. a deep DOWN
  // extension (4.618) whose distance below the swing low exceeds the
  // low itself. A line at $0 or below is meaningless for a price chart,
  // so we skip it rather than drawing an impossible level.
  if (!Number.isFinite(level.price) || level.price <= 0) return null;

  const isBoundary = level.level === 0 || level.level === 1.0;
  const isGP = level.golden_pocket;

  let color: string;
  let lineWidth: number;
  let lineStyle: number; // 0=solid, 2=dashed, 3=dotted

  // Branch 6 (plan decision 2A):
  //   - Boundary lines (0 and 1.0) are bright magenta across every
  //     fib, weight 2, solid. High contrast against the candle
  //     palette.
  //   - GP and non-GP retracement lines share the same weight (2) and
  //     style (solid). Only their COLOR differentiates them (gold vs
  //     cyan for the primary). This matches the user's request that
  //     "all levels between 0 and 1 should match the golden pocket
  //     line weight/font".
  //   - Extension lines keep the lighter dashed treatment so target
  //     levels read as projections rather than entries.
  if (isBoundary) {
    color = FIB_BOUNDARY_COLOR;
    lineWidth = 2;
    lineStyle = 0; // solid
  } else if (isGP) {
    color = palette.goldenPocket;
    lineWidth = 2;
    lineStyle = 0;
  } else if (kind === "extension") {
    // Extensions stay dashed so they read as projections rather than
    // entries, but at weight 2 (was 1) so the far target lines are
    // legible instead of hairline-faint at a zoomed-out scale.
    color = palette.extension;
    lineWidth = 2;
    lineStyle = 2; // dashed
  } else {
    // Non-GP retracement: weight + style now match GP.
    color = palette.retracement;
    lineWidth = 2;
    lineStyle = 0;
  }

  if (opacity !== 1.0) {
    color = applyOpacity(color, opacity);
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
    // Title shows the level label + per-fib suffix on the price scale.
    title: labelSuffix ? `${level.label} ${labelSuffix}` : level.label,
  });
  series.setData(data);
  return series;
}

/**
 * Scale the alpha channel of an `rgba(...)` color string by `factor`.
 * Falls back to the original string for unrecognized formats.
 */
function applyOpacity(color: string, factor: number): string {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    color,
  );
  if (!match) return color;
  const [, r, g, b, a = "1"] = match;
  const newAlpha = Math.max(0, Math.min(1, parseFloat(a) * factor));
  return `rgba(${r}, ${g}, ${b}, ${newAlpha.toFixed(3)})`;
}
