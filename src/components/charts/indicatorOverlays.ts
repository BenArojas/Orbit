/**
 * Indicator Overlay System — adds/removes indicator series on the main chart.
 *
 * This module handles all "overlay" type indicators that render directly
 * on the price chart (not in sub-chart panels):
 *
 *   - EMA 9/21/50/200 — colored line series
 *   - Bollinger Bands — upper/lower/middle line series
 *   - VWAP — single line series
 *
 * Oscillators (RSI, MACD, Stochastic) and sub-chart indicators (OBV, ADX)
 * are rendered in separate panels (task 4.3).
 *
 * Volume is handled directly in ChartContainer (not here).
 * Fibonacci is handled by FibonacciOverlay (task 4.4).
 *
 * Each indicator is added as one or more ISeriesApi instances on the chart.
 * The OverlayState tracks all active series so they can be cleanly removed.
 */

import {
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  type SeriesType,
} from "lightweight-charts";
import type { IndicatorResult, IndicatorValue } from "@/lib/api";
import type { IndicatorId } from "@/store/chart";

// ── Types ────────────────────────────────────────────────────

/** Tracks all series added to the chart for clean removal */
export type OverlayState = Record<string, ISeriesApi<SeriesType>[]>;

// ── Color palette for indicator lines ────────────────────────

const INDICATOR_COLORS: Record<string, string> = {
  ema9: "#00d4ff",   // cyan — fast EMA
  ema21: "#b44dff",  // purple — short-term
  ema50: "#ff9f1c",  // orange — medium-term
  ema200: "#ff4466", // red — long-term (200 EMA is a key level)
  bollinger_upper: "rgba(68, 136, 255, 0.5)",  // blue, semi-transparent
  bollinger_lower: "rgba(68, 136, 255, 0.5)",
  bollinger_middle: "rgba(68, 136, 255, 0.3)", // fainter for the SMA middle
  vwap: "#ff9f1c",   // orange — VWAP stands out
};

// ── Map from IndicatorId to backend indicator name ───────────

const INDICATOR_NAME_MAP: Record<string, string> = {
  ema9: "ema_9",
  ema21: "ema_21",
  ema50: "ema_50",
  ema200: "ema_200",
  bollinger: "bbands",
  vwap: "vwap",
};

/** Indicator IDs that are overlays on the main chart */
const OVERLAY_INDICATOR_IDS: IndicatorId[] = [
  "ema9", "ema21", "ema50", "ema200", "bollinger", "vwap",
];

// ── Helpers ──────────────────────────────────────────────────

/** Convert IndicatorValue[] to LineData[] (filter out nulls) */
function toLineData(values: IndicatorValue[], field: keyof IndicatorValue = "value"): LineData<Time>[] {
  const result: LineData<Time>[] = [];
  for (const v of values) {
    const val = v[field];
    if (val != null && typeof val === "number" && !isNaN(val)) {
      result.push({ time: v.time as Time, value: val });
    }
  }
  return result;
}

/** Find an indicator result by its backend name */
function findIndicator(indicators: IndicatorResult[], backendName: string): IndicatorResult | undefined {
  return indicators.find((ind) => ind.name === backendName);
}

// ── Add EMA line series ──────────────────────────────────────

function addEmaOverlay(
  chart: IChartApi,
  indicator: IndicatorResult,
  indicatorId: string,
): ISeriesApi<"Line">[] {
  const color = INDICATOR_COLORS[indicatorId] ?? "#00d4ff";
  const data = toLineData(indicator.values);
  if (data.length === 0) return [];

  const series = chart.addSeries(LineSeries, {
    color,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  series.setData(data);
  return [series];
}

// ── Add Bollinger Bands (upper + middle + lower) ─────────────

function addBollingerOverlay(
  chart: IChartApi,
  indicator: IndicatorResult,
): ISeriesApi<"Line">[] {
  const series: ISeriesApi<"Line">[] = [];

  // Upper band
  const upperData = toLineData(indicator.values, "upper");
  if (upperData.length > 0) {
    const upper = chart.addSeries(LineSeries, {
      color: INDICATOR_COLORS.bollinger_upper,
      lineWidth: 1,
      lineStyle: 0, // solid
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    upper.setData(upperData);
    series.push(upper);
  }

  // Middle band (SMA)
  const middleData = toLineData(indicator.values, "value");
  if (middleData.length > 0) {
    const middle = chart.addSeries(LineSeries, {
      color: INDICATOR_COLORS.bollinger_middle,
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    middle.setData(middleData);
    series.push(middle);
  }

  // Lower band
  const lowerData = toLineData(indicator.values, "lower");
  if (lowerData.length > 0) {
    const lower = chart.addSeries(LineSeries, {
      color: INDICATOR_COLORS.bollinger_lower,
      lineWidth: 1,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    lower.setData(lowerData);
    series.push(lower);
  }

  return series;
}

// ── Add VWAP line ────────────────────────────────────────────

function addVwapOverlay(
  chart: IChartApi,
  indicator: IndicatorResult,
): ISeriesApi<"Line">[] {
  const data = toLineData(indicator.values);
  if (data.length === 0) return [];

  const series = chart.addSeries(LineSeries, {
    color: INDICATOR_COLORS.vwap,
    lineWidth: 2,
    lineStyle: 2, // dashed — distinguishes from EMAs
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  series.setData(data);
  return [series];
}

// ── Public API ───────────────────────────────────────────────

/**
 * Add indicator overlay series to the chart.
 * Returns OverlayState tracking all added series for later removal.
 */
export function addIndicatorOverlays(
  chart: IChartApi,
  indicators: IndicatorResult[],
  activeIndicators: Set<IndicatorId>,
): OverlayState {
  const state: OverlayState = {};

  for (const indicatorId of OVERLAY_INDICATOR_IDS) {
    if (!activeIndicators.has(indicatorId)) continue;

    const backendName = INDICATOR_NAME_MAP[indicatorId];
    if (!backendName) continue;

    const result = findIndicator(indicators, backendName);
    if (!result) continue;

    let series: ISeriesApi<"Line">[] = [];

    if (indicatorId === "bollinger") {
      series = addBollingerOverlay(chart, result);
    } else if (indicatorId === "vwap") {
      series = addVwapOverlay(chart, result);
    } else {
      // EMA variants
      series = addEmaOverlay(chart, result, indicatorId);
    }

    if (series.length > 0) {
      state[indicatorId] = series;
    }
  }

  return state;
}

/**
 * Remove all overlay series tracked in OverlayState from the chart.
 */
export function removeIndicatorOverlays(
  chart: IChartApi,
  state: OverlayState,
): void {
  for (const seriesList of Object.values(state)) {
    for (const series of seriesList) {
      try {
        chart.removeSeries(series);
      } catch (_e: unknown) {
        // Series may already be removed if chart was destroyed
      }
    }
  }
}
