/**
 * SubChartPanel — Renders oscillator/line indicators in their own mini chart.
 *
 * Stacked below the main candlestick chart. Each panel is a self-contained
 * Lightweight Charts instance showing one indicator:
 *
 *   - RSI (14)       → single line (0–100 range, 30/70 reference lines)
 *   - MACD (12/26/9) → MACD line + signal line + histogram bars
 *   - Stochastic     → %K line + %D line (0–100 range, 20/80 reference lines)
 *   - OBV            → single cumulative line
 *
 * Each panel auto-syncs its visible time range with the main chart via
 * the optional `timeRangeRef` prop (task 4.3 enhancement — for now each
 * panel manages its own range via fitContent).
 */

import {
  createChart,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type HistogramData,
  type Time,
  ColorType,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { IndicatorResult, IndicatorValue } from "@/lib/api";
import { readChartTheme } from "./chartTheme";

// ── Types ────────────────────────────────────────────────────

export type SubChartType = "rsi" | "macd" | "stochastic" | "obv" | "adx";

export interface SubChartPanelProps {
  type: SubChartType;
  indicator: IndicatorResult | undefined;
}

// ── Per-indicator colors (semantic, theme-independent) ───────

const COLORS = {
  // Per-indicator colors
  rsi: "#b44dff",          // purple
  macdLine: "#00d4ff",     // cyan
  macdSignal: "#ff9f1c",   // orange
  macdHistUp: "rgba(0, 255, 136, 0.5)",
  macdHistDown: "rgba(255, 68, 102, 0.5)",
  stochK: "#00d4ff",       // cyan
  stochD: "#ff9f1c",       // orange
  obv: "#4488ff",          // blue
  adx: "#ff9f1c",          // orange
  refLine: "rgba(255, 255, 255, 0.08)", // reference lines (30/70, 20/80)
} as const;

// ── Labels ───────────────────────────────────────────────────

const LABELS: Record<SubChartType, string> = {
  rsi: "RSI (14)",
  macd: "MACD (12,26,9)",
  stochastic: "Stoch (14,3,3)",
  obv: "OBV",
  adx: "ADX (14)",
};

// ── Backend name mapping ─────────────────────────────────────

const BACKEND_NAME: Record<SubChartType, string> = {
  rsi: "rsi",
  macd: "macd",
  stochastic: "stoch",
  obv: "obv",
  adx: "adx",
};

// ── Helpers ──────────────────────────────────────────────────

function toLineData(
  values: IndicatorValue[],
  field: keyof IndicatorValue = "value",
): LineData<Time>[] {
  const result: LineData<Time>[] = [];
  for (const v of values) {
    const val = v[field];
    if (val != null && typeof val === "number" && !isNaN(val)) {
      result.push({ time: v.time as Time, value: val });
    }
  }
  return result;
}

// ── Component ────────────────────────────────────────────────

export default function SubChartPanel({
  type,
  indicator,
}: SubChartPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<"Line" | "Histogram">[]>([]);

  // ── Create chart instance ──────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const theme = readChartTheme();

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: theme.bg },
        textColor: theme.text,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: theme.gridLines },
        horzLines: { color: theme.gridLines },
      },
      rightPriceScale: {
        borderColor: theme.borderColor,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        visible: false, // Time axis shown on main chart only
      },
      crosshair: {
        vertLine: { visible: false, labelVisible: false },
        horzLine: {
          color: "rgba(0, 212, 255, 0.3)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#0f1724",
        },
      },
      // Scroll/scale disabled — panels should follow the main chart's visible
      // time range. Time-range syncing is a future enhancement: subscribe to
      // the main chart's timeScale().subscribeVisibleLogicalRangeChange() and
      // call panel.timeScale().setVisibleLogicalRange() in response.
      handleScroll: false,
      handleScale: false,
    });

    chartRef.current = chart;

    // Auto-resize — read both dimensions from the DOM so the chart
    // stays correct on window resize (height is controlled by parent CSS,
    // not a fixed prop).
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height: h } = entries[0].contentRect;
      chart.applyOptions({ width, height: h });
    });
    resizeObserver.observe(container);

    // Theme change — re-apply layout colours when .dark/.light toggles on <html>
    const themeObserver = new MutationObserver(() => {
      const t = readChartTheme();
      chart.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: t.bg },
          textColor: t.text,
        },
        grid: {
          vertLines: { color: t.gridLines },
          horzLines: { color: t.gridLines },
        },
        rightPriceScale: { borderColor: t.borderColor },
      });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRefs.current = [];
    };
  }, []); // Chart instance created once — size tracked by ResizeObserver

  // ── Update indicator data ──────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove old series
    for (const s of seriesRefs.current) {
      try { chart.removeSeries(s); } catch (_e: unknown) { /* series already removed on chart destroy */ }
    }
    seriesRefs.current = [];

    if (!indicator || indicator.values.length === 0) return;

    switch (type) {
      case "rsi":
        renderRSI(chart, indicator);
        break;
      case "macd":
        renderMACD(chart, indicator);
        break;
      case "stochastic":
        renderStochastic(chart, indicator);
        break;
      case "obv":
        renderOBV(chart, indicator);
        break;
      case "adx":
        renderADX(chart, indicator);
        break;
    }

    chart.timeScale().fitContent();
  }, [type, indicator]);

  // ── RSI: single line + 30/70 reference lines ───────────────

  function renderRSI(chart: IChartApi, ind: IndicatorResult) {
    const data = toLineData(ind.values);
    if (data.length === 0) return;

    // Main RSI line
    const series = chart.addSeries(LineSeries, {
      color: COLORS.rsi,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
    });
    series.setData(data);
    seriesRefs.current.push(series);

    // 30/70 reference lines (as flat line series)
    for (const level of [30, 70]) {
      const refSeries = chart.addSeries(LineSeries, {
        color: COLORS.refLine,
        lineWidth: 1,
        lineStyle: 2, // dashed
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      // Create flat line at the reference level across all timestamps
      const refData: LineData<Time>[] = [
        { time: data[0].time, value: level },
        { time: data[data.length - 1].time, value: level },
      ];
      refSeries.setData(refData);
      seriesRefs.current.push(refSeries);
    }
  }

  // ── MACD: line + signal + histogram ────────────────────────

  function renderMACD(chart: IChartApi, ind: IndicatorResult) {
    // Histogram bars (rendered first so lines draw on top)
    const histData: HistogramData<Time>[] = [];
    for (const v of ind.values) {
      if (v.histogram != null && !isNaN(v.histogram)) {
        histData.push({
          time: v.time as Time,
          value: v.histogram,
          color: v.histogram >= 0 ? COLORS.macdHistUp : COLORS.macdHistDown,
        });
      }
    }

    if (histData.length > 0) {
      const histSeries = chart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
      });
      histSeries.setData(histData);
      seriesRefs.current.push(histSeries);
    }

    // MACD line
    const macdData = toLineData(ind.values, "value");
    if (macdData.length > 0) {
      const macdSeries = chart.addSeries(LineSeries, {
        color: COLORS.macdLine,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      macdSeries.setData(macdData);
      seriesRefs.current.push(macdSeries);
    }

    // Signal line
    const signalData = toLineData(ind.values, "signal");
    if (signalData.length > 0) {
      const signalSeries = chart.addSeries(LineSeries, {
        color: COLORS.macdSignal,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      signalSeries.setData(signalData);
      seriesRefs.current.push(signalSeries);
    }
  }

  // ── Stochastic: %K + %D + 20/80 reference lines ───────────

  function renderStochastic(chart: IChartApi, ind: IndicatorResult) {
    // %K line (value field)
    const kData = toLineData(ind.values, "value");
    if (kData.length > 0) {
      const kSeries = chart.addSeries(LineSeries, {
        color: COLORS.stochK,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      kSeries.setData(kData);
      seriesRefs.current.push(kSeries);
    }

    // %D line (signal field)
    const dData = toLineData(ind.values, "signal");
    if (dData.length > 0) {
      const dSeries = chart.addSeries(LineSeries, {
        color: COLORS.stochD,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      dSeries.setData(dData);
      seriesRefs.current.push(dSeries);
    }

    // 20/80 reference lines
    const allData = kData.length > 0 ? kData : dData;
    if (allData.length > 0) {
      for (const level of [20, 80]) {
        const refSeries = chart.addSeries(LineSeries, {
          color: COLORS.refLine,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        refSeries.setData([
          { time: allData[0].time, value: level },
          { time: allData[allData.length - 1].time, value: level },
        ]);
        seriesRefs.current.push(refSeries);
      }
    }
  }

  // ── OBV: single cumulative line ────────────────────────────

  function renderOBV(chart: IChartApi, ind: IndicatorResult) {
    const data = toLineData(ind.values);
    if (data.length === 0) return;

    const series = chart.addSeries(LineSeries, {
      color: COLORS.obv,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
    });
    series.setData(data);
    seriesRefs.current.push(series);
  }

  // ── ADX: trend strength line + 25 reference level ─────────

  function renderADX(chart: IChartApi, ind: IndicatorResult) {
    const data = toLineData(ind.values);
    if (data.length === 0) return;

    const series = chart.addSeries(LineSeries, {
      color: COLORS.adx,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
    });
    series.setData(data);
    seriesRefs.current.push(series);

    // 25 reference line — ADX above 25 = trending market
    const refSeries = chart.addSeries(LineSeries, {
      color: COLORS.refLine,
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    refSeries.setData([
      { time: data[0].time, value: 25 },
      { time: data[data.length - 1].time, value: 25 },
    ]);
    seriesRefs.current.push(refSeries);
  }

  return (
    <div className="relative flex-1 border-r border-border last:border-r-0">
      {/* Label */}
      <span className="pointer-events-none absolute left-2.5 top-1 z-10 text-[8px] font-semibold text-[var(--text-3)]">
        {LABELS[type]}
      </span>

      {/* Chart container */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Empty state */}
      {(!indicator || indicator.values.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] text-[var(--text-3)]">
            No data
          </span>
        </div>
      )}
    </div>
  );
}

export { BACKEND_NAME as SUB_CHART_BACKEND_NAMES };
