/**
 * ChartContainer — Main candlestick chart with conditional volume overlay.
 *
 * Wraps TradingView Lightweight Charts v5. Manages the chart instance
 * lifecycle (create, resize, destroy) and renders candlestick series.
 * Volume and indicator overlays are conditional — all driven by activeIndicators.
 *
 * Theme awareness: chart colours are read from CSS custom properties at
 * create time and re-applied when the theme class on <html> changes.
 *
 * Props:
 *   candles          — OHLCV bar data (time-sorted, Unix seconds)
 *   indicators       — computed indicator results from the backend
 *   fibonacci        — Fibonacci retracement result
 *   activeIndicators — set of toggled-on indicator IDs
 *   liveTick         — latest WebSocket price tick for real-time last-candle updates
 */

import {
  createChart,
  CandlestickSeries,
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
import {
  addIndicatorOverlays,
  removeIndicatorOverlays,
  addVolumeOverlay,
  removeVolumeOverlay,
  type OverlayState,
} from "./indicatorOverlays";
import { addFibonacciOverlay, removeFibonacciOverlay, type FibOverlayState } from "./FibonacciOverlay";
import FibDrawMode from "./FibDrawMode";
import { readChartTheme } from "./chartTheme";
import type { Timeframe } from "@/store/chart";

const CROSSHAIR_COLOR = "rgba(0, 212, 255, 0.4)";
const CROSSHAIR_LABEL_BG = "#0f1724";

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
  /** Symbol string shown as chart watermark */
  symbol?: string;
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
  symbol,
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

    const theme = readChartTheme();

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: theme.bg },
        textColor: theme.text,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: theme.gridLines },
        horzLines: { color: theme.gridLines },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: CROSSHAIR_COLOR,
          width: 1,
          style: 2,
          labelBackgroundColor: CROSSHAIR_LABEL_BG,
        },
        horzLine: {
          color: CROSSHAIR_COLOR,
          width: 1,
          style: 2,
          labelBackgroundColor: CROSSHAIR_LABEL_BG,
        },
      },
      rightPriceScale: {
        borderColor: theme.borderColor,
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      timeScale: {
        borderColor: theme.borderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      handleScroll: { vertTouchDrag: false },
    });

    // Candlestick series (v5 API) — colours read from theme at create time
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:       theme.upColor,
      downColor:     theme.downColor,
      wickUpColor:   theme.upColor,
      wickDownColor: theme.downColor,
      borderVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    // Auto-resize
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    // Theme change — re-apply layout + candle colours when .dark/.light toggles
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
        timeScale: { borderColor: t.borderColor },
      });
      // Re-apply candle colours — they differ between dark and light themes
      candleSeries.applyOptions({
        upColor:       t.upColor,
        downColor:     t.downColor,
        wickUpColor:   t.upColor,
        wickDownColor: t.downColor,
      });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
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

  // ── Update candle data ─────────────────────────────────────

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries || candles.length === 0) return;

    const candleData: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.setData(candleData);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // ── Volume overlay — controlled by indicator toggle ────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (activeIndicators.has("volume")) {
      // Add series if not already present
      if (!volumeSeriesRef.current) {
        volumeSeriesRef.current = addVolumeOverlay(chart, candles);
      } else if (candles.length > 0) {
        // Update existing series with fresh candle data
        const data: HistogramData<Time>[] = candles.map((c) => ({
          time: c.time as Time,
          value: c.volume,
          color: c.close >= c.open ? "rgba(0, 255, 136, 0.18)" : "rgba(255, 68, 102, 0.18)",
        }));
        volumeSeriesRef.current.setData(data);
      }
    } else {
      // Remove series when toggled off
      if (volumeSeriesRef.current) {
        volumeSeriesRef.current = removeVolumeOverlay(chart, volumeSeriesRef.current);
      }
    }
  }, [activeIndicators, candles]);

  // ── Live tick updates (WebSocket) ──────────────────────────

  useEffect(() => {
    if (!liveTick || !candleSeriesRef.current) return;
    if (candles.length === 0) return;

    const lastCandle = candles[candles.length - 1];
    const time = lastCandle.time as Time;

    candleSeriesRef.current.update({
      time,
      open: lastCandle.open,
      high: Math.max(lastCandle.high, liveTick.high),
      low:  Math.min(lastCandle.low, liveTick.low),
      close: liveTick.last,
    });

    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.update({
        time,
        value: liveTick.volume,
        color:
          liveTick.last >= lastCandle.open
            ? "rgba(0, 255, 136, 0.18)"
            : "rgba(255, 68, 102, 0.18)",
      });
    }
  }, [liveTick, candles]);

  // ── Indicator overlays ─────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

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

    removeFibonacciOverlay(chart, fibOverlayRef.current);
    fibOverlayRef.current = [];

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
      {/* Symbol watermark — absolutely positioned, pointer-events-none */}
      {symbol && (
        <div className="pointer-events-none absolute left-3 top-2 z-10 select-none">
          <span className="font-mono text-2xl font-bold opacity-[0.07]">
            {symbol}
          </span>
        </div>
      )}

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
