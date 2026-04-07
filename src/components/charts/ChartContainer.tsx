/**
 * ChartContainer — Main candlestick chart with volume overlay.
 *
 * Wraps TradingView Lightweight Charts v5. Manages the chart instance
 * lifecycle (create, resize, destroy) and renders candlestick + volume
 * series. Indicator overlays are added via the indicatorOverlays module.
 *
 * The chart fills its parent container and auto-resizes via ResizeObserver.
 *
 * Props:
 *   candles — OHLCV bar data (time-sorted, Unix seconds)
 *   indicators — computed indicator results from the backend
 *   fibonacci — Fibonacci retracement result (reserved for task 4.4)
 *   activeIndicators — set of toggled-on indicator IDs
 *   liveTick — latest WebSocket price tick for real-time last-candle updates
 */

import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { CandleData, IndicatorResult, FibonacciResult } from "@/lib/api";
import type { IndicatorId } from "@/store/chart";
import { addIndicatorOverlays, removeIndicatorOverlays, type OverlayState } from "./indicatorOverlays";
import { addFibonacciOverlay, removeFibonacciOverlay, type FibOverlayState } from "./FibonacciOverlay";
import FibDrawMode from "./FibDrawMode";
import type { Timeframe } from "@/store/chart";

// ── Theme colors (match styles.css) ──────────────────────────

const CHART_COLORS = {
  bg: "#05080e",
  gridLines: "rgba(255, 255, 255, 0.03)",
  crosshair: "rgba(0, 212, 255, 0.4)",
  text: "#4a5568",
  borderColor: "rgba(255, 255, 255, 0.06)",
  upColor: "#00ff88",
  downColor: "#ff4466",
  upWick: "#00ff88",
  downWick: "#ff4466",
  volumeUp: "rgba(0, 255, 136, 0.18)",
  volumeDown: "rgba(255, 68, 102, 0.18)",
} as const;

// ── Props ────────────────────────────────────────────────────

export interface ChartContainerProps {
  candles: CandleData[];
  indicators: IndicatorResult[];
  fibonacci: FibonacciResult | null;
  activeIndicators: Set<IndicatorId>;
  /** Called when a live tick updates the last candle */
  liveTick?: { last: number; volume: number; high: number; low: number } | null;
  /** Active instrument conid (for fib draw-mode lock) */
  conid?: number | null;
  /** Current timeframe string (for fib draw-mode lock) */
  timeframe?: Timeframe;
}

// ── Component ────────────────────────────────────────────────

export default function ChartContainer({
  candles,
  indicators,
  fibonacci,
  activeIndicators,
  liveTick,
  conid = null,
  timeframe = "1D",
}: ChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayStateRef = useRef<OverlayState>({});
  const fibOverlayRef = useRef<FibOverlayState>([]);

  // ── Create chart instance ──────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: CHART_COLORS.bg },
        textColor: CHART_COLORS.text,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: CHART_COLORS.gridLines },
        horzLines: { color: CHART_COLORS.gridLines },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: CHART_COLORS.crosshair,
          width: 1,
          style: 2, // dashed
          labelBackgroundColor: "#0f1724",
        },
        horzLine: {
          color: CHART_COLORS.crosshair,
          width: 1,
          style: 2,
          labelBackgroundColor: "#0f1724",
        },
      },
      rightPriceScale: {
        borderColor: CHART_COLORS.borderColor,
        scaleMargins: { top: 0.05, bottom: 0.2 }, // Leave room for volume
      },
      timeScale: {
        borderColor: CHART_COLORS.borderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      handleScroll: { vertTouchDrag: false },
    });

    // Candlestick series (v5 API: chart.addSeries(SeriesDefinition, options))
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: CHART_COLORS.upColor,
      downColor: CHART_COLORS.downColor,
      wickUpColor: CHART_COLORS.upWick,
      wickDownColor: CHART_COLORS.downWick,
      borderVisible: false,
    });

    // Volume histogram (overlaid at bottom of main chart)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Auto-resize
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      removeIndicatorOverlays(chart, overlayStateRef.current);
      overlayStateRef.current = {};
      removeFibonacciOverlay(chart, fibOverlayRef.current);
      fibOverlayRef.current = [];
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []); // Chart instance created once

  // ── Update candle + volume data ────────────────────────────

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || candles.length === 0) return;

    const candleData: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData: HistogramData<Time>[] = candles.map((c) => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? CHART_COLORS.volumeUp : CHART_COLORS.volumeDown,
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    // Fit content with a small right margin
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // ── Live tick updates (WebSocket) ──────────────────────────

  useEffect(() => {
    if (!liveTick || !candleSeriesRef.current || !volumeSeriesRef.current) return;
    if (candles.length === 0) return;

    const lastCandle = candles[candles.length - 1];
    const time = lastCandle.time as Time;

    // Update the last candle with live data
    candleSeriesRef.current.update({
      time,
      open: lastCandle.open,
      high: Math.max(lastCandle.high, liveTick.high),
      low: Math.min(lastCandle.low, liveTick.low),
      close: liveTick.last,
    });

    volumeSeriesRef.current.update({
      time,
      value: liveTick.volume,
      color:
        liveTick.last >= lastCandle.open
          ? CHART_COLORS.volumeUp
          : CHART_COLORS.volumeDown,
    });
  }, [liveTick, candles]);

  // ── Indicator overlays ─────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove old overlays, add new ones
    removeIndicatorOverlays(chart, overlayStateRef.current);
    overlayStateRef.current = addIndicatorOverlays(
      chart,
      indicators,
      activeIndicators,
    );
  }, [indicators, activeIndicators]);

  // ── Fibonacci overlay ──────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove previous fib lines
    removeFibonacciOverlay(chart, fibOverlayRef.current);
    fibOverlayRef.current = [];

    // Only render if fibonacci toggle is active AND we have fib data
    if (!activeIndicators.has("fibonacci") || !fibonacci || candles.length === 0) {
      return;
    }

    fibOverlayRef.current = addFibonacciOverlay(chart, fibonacci, candles);
  }, [fibonacci, activeIndicators, candles]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      style={{ minHeight: 300 }}
    >
      <FibDrawMode
        chart={chartRef.current}
        candleSeries={candleSeriesRef.current}
        candles={candles}
        conid={conid}
        timeframe={timeframe}
      />
    </div>
  );
}
