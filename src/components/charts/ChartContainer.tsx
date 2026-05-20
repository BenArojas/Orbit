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
  type MouseEventParams,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import { useEffect, useId, useRef } from "react";
import type { CandleData, IndicatorResult, FibonacciResult } from "@/lib/api";
import type { IndicatorId } from "@/store/chart";
import { useChartStore } from "@/store/chart";
import { useCrosshairStore } from "@/store";
import {
  addIndicatorOverlays,
  removeIndicatorOverlays,
  addVolumeOverlay,
  removeVolumeOverlay,
  type OverlayState,
} from "./indicatorOverlays";
import {
  addFibonacciOverlays,
  removeFibonacciOverlay,
  type FibOverlayState,
} from "./FibonacciOverlay";
import FibDrawMode from "./FibDrawMode";
import DrawingsLayer from "./DrawingsLayer";
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
  /** Called when the user has panned near the leftmost loaded candle. */
  onLoadMore?: () => void;
  /** True while a period escalation is loading. */
  isLoadingMore?: boolean;
  /** False when already at the top of the period ladder (5Y). */
  canLoadMore?: boolean;
}

// ── Component ────────────────────────────────────────────────

export default function ChartContainer({
  candles,
  indicators,
  // Branch 4: kept in the interface for backward compat but the
  // overlay now sources fib state from the chart store (activeFibs)
  // so callers' fib payload is no longer used here.
  fibonacci: _fibonacci,
  activeIndicators,
  liveTick,
  conid = null,
  timeframe = "1D",
  symbol,
  onLoadMore,
  isLoadingMore = false,
  canLoadMore = false,
}: ChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayStateRef = useRef<OverlayState>({});
  const fibOverlayRef = useRef<FibOverlayState>([]);
  const prevConidRef = useRef<number | null>(null);
  const prevTimeframeRef = useRef<Timeframe>(timeframe);
  const prevFirstCandleTimeRef = useRef<number | null>(null);
  // Auto-load only fires after the user has explicitly panned/wheeled the chart.
  // Without this, fitContent on initial load puts the visible range at logical
  // position 0, which would otherwise trigger an immediate cascade of escalations.
  const userHasPannedRef = useRef(false);
  const onLoadMoreRef = useRef(onLoadMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const canLoadMoreRef = useRef(canLoadMore);
  useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);
  useEffect(() => { isLoadingMoreRef.current = isLoadingMore; }, [isLoadingMore]);
  useEffect(() => { canLoadMoreRef.current = canLoadMore; }, [canLoadMore]);

  // Branch 3 / plan decision 4B: user-driven "Clear chart fib" flag.
  const fibCleared = useChartStore((s) => s.fibCleared);
  // Branch 4: the overlay now reads the ordered list of fibs
  // (primary + locked) directly from the store. The `fibonacci` prop
  // is kept for backward compatibility with callers that haven't
  // migrated yet but is otherwise unused for rendering.
  const activeFibs = useChartStore((s) => s.activeFibs);
  const resetZoomRequestId = useChartStore((s) => s.resetZoomRequestId);

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
    const chart = chartRef.current;
    if (!candleSeries || !chart || candles.length === 0) return;

    // Capture the current visible TIME range before data changes. Time range
    // (timestamps) is what we want — when older bars load, restoring time keeps
    // the user looking at the same calendar window. Restoring the logical range
    // would glue them to the new oldest bar instead.
    const visibleRange = chart.timeScale().getVisibleRange();

    const candleData: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.setData(candleData);

    const newFirst = candles[0].time;
    const isNewSymbol = conid !== prevConidRef.current;
    const isTimeframeChange = timeframe !== prevTimeframeRef.current;
    const isPeriodEscalation =
      !isNewSymbol &&
      !isTimeframeChange &&
      prevFirstCandleTimeRef.current !== null &&
      newFirst < prevFirstCandleTimeRef.current;

    if (isNewSymbol) {
      // New symbol — re-enable autoscale so the price axis fits the new range.
      chart.priceScale("right").applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
      userHasPannedRef.current = false;
    } else if (isPeriodEscalation && visibleRange) {
      // Older candles loaded: keep the user's view exactly where it was.
      chart.timeScale().setVisibleRange(visibleRange);
    } else if (isTimeframeChange) {
      // Timeframe switch — fit to new content and reset the pan flag.
      chart.timeScale().fitContent();
      userHasPannedRef.current = false;
    } else {
      // Indicator toggle or other same-period refetch — fit to new content.
      chart.timeScale().fitContent();
    }

    prevConidRef.current = conid;
    prevTimeframeRef.current = timeframe;
    prevFirstCandleTimeRef.current = newFirst;
  }, [candles, conid, timeframe]);

  // ── Reset zoom (store-driven) ──────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || resetZoomRequestId === 0) return;
    chart.priceScale("right").applyOptions({ autoScale: true });
    chart.timeScale().fitContent();
  }, [resetZoomRequestId]);

  // ── Auto-load older candles on left-edge pan ───────────────
  //
  // Two guards prevent a cascade on initial load:
  //   1. userHasPannedRef — only auto-load after the user has explicitly
  //      wheeled / dragged / touched the chart. Otherwise fitContent on a
  //      fresh chart would put us at logical position 0 and trigger immediately.
  //   2. logicalRange.from <= 10 — near the leftmost loaded bar.

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const markPanned = () => { userHasPannedRef.current = true; };
    container.addEventListener("wheel", markPanned, { passive: true });
    container.addEventListener("mousedown", markPanned);
    container.addEventListener("touchstart", markPanned, { passive: true });
    return () => {
      container.removeEventListener("wheel", markPanned);
      container.removeEventListener("mousedown", markPanned);
      container.removeEventListener("touchstart", markPanned);
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = () => {
      if (!canLoadMoreRef.current || isLoadingMoreRef.current) return;
      if (!userHasPannedRef.current) return;
      const logicalRange = chart.timeScale().getVisibleLogicalRange();
      if (!logicalRange) return;
      if (logicalRange.from <= 10) {
        onLoadMoreRef.current?.();
      }
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(handler);
    return () => {
      try { chart.timeScale().unsubscribeVisibleTimeRangeChange(handler); } catch { /* chart gone */ }
    };
  }, []);

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

    // The bar's high/low are widened against the latest tick price only.
    // liveTick.high / liveTick.low are IBKR day aggregates (fields 70/71) and
    // are unrelated to the current bar's range — feeding them into Math.min/max
    // dragged the visible bar's wick down to the session/ADR day-low and blew
    // out the price scale on first load.
    candleSeriesRef.current.update({
      time,
      open: lastCandle.open,
      high: Math.max(lastCandle.high, liveTick.last),
      low:  Math.min(lastCandle.low, liveTick.last),
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

    if (!activeIndicators.has("fibonacci") || candles.length === 0) {
      return;
    }

    // Branch 4: the chart renders WHATEVER is in `activeFibs` —
    // primary (auto or override) plus any locked fibs. The store
    // owns the merge; this effect just iterates. Locked fibs persist
    // even when the primary is cleared (decision 4B), so we always
    // attempt rendering whenever the indicator is on.
    let fibsToDraw = activeFibs;

    // Branch 3 / plan decision 4B: "Clear chart fib" drops the
    // primary. We still render any locked fibs because they're
    // independent.
    if (fibCleared) {
      fibsToDraw = fibsToDraw.filter((f) => f.source === "locked");
    }

    // Branch 1: no_active_fib placeholders must not paint either —
    // belt-and-braces in case setPrimaryFib was called with a
    // no-active result by accident.
    fibsToDraw = fibsToDraw.filter((f) => !f.result.no_active_fib);

    if (fibsToDraw.length === 0) return;

    fibOverlayRef.current = addFibonacciOverlays(chart, fibsToDraw, candles);
  }, [activeFibs, activeIndicators, candles, fibCleared]);

  // ── Crosshair sync — broadcast our own moves, mirror others' ──
  //
  // The Analysis page can have up to 5 sub-panels stacked under this main
  // chart. Each chart subscribes to a shared Zustand store; user-initiated
  // moves are broadcast (with our chartId as `source`) and other charts
  // mirror via setCrosshairPosition. The `source !== chartId` check
  // prevents feedback loops.

  const chartId = useId();
  const broadcastHovered = useCrosshairStore((s) => s.setHovered);
  const sharedTime = useCrosshairStore((s) => s.time);
  const sharedSource = useCrosshairStore((s) => s.source);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param: MouseEventParams) => {
      if (!param.sourceEvent) return; // ignore programmatic moves
      const t = (param.time as number | undefined) ?? null;
      broadcastHovered(t, chartId);
    };
    chart.subscribeCrosshairMove(handler);
    return () => {
      try { chart.unsubscribeCrosshairMove(handler); } catch { /* chart gone */ }
    };
  }, [broadcastHovered, chartId]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;
    if (sharedSource === chartId) return; // we broadcast this, ignore
    if (candles.length === 0) return;

    if (sharedTime == null) {
      chart.clearCrosshairPosition();
      return;
    }
    // Find the close at this time so the crosshair has a vertical anchor
    let close: number | null = null;
    for (const c of candles) {
      if (c.time === sharedTime) { close = c.close; break; }
    }
    if (close == null) {
      chart.clearCrosshairPosition();
      return;
    }
    try {
      chart.setCrosshairPosition(close, sharedTime as Time, series);
    } catch {
      /* series removed mid-update */
    }
  }, [sharedTime, sharedSource, chartId, candles]);

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

      <DrawingsLayer
        chart={chartRef.current}
        series={candleSeriesRef.current}
        containerRef={containerRef}
        conid={conid}
        candles={candles}
      />

      {isLoadingMore && (
        <div className="pointer-events-none absolute bottom-8 left-4 z-10 flex items-center gap-1.5 rounded-full border border-[var(--clr-cyan)] bg-[var(--bg-0)] px-3 py-1 text-[10px] text-[var(--clr-cyan)]">
          <div className="h-2.5 w-2.5 animate-spin rounded-full border border-[var(--clr-cyan)] border-t-transparent" />
          Loading older bars…
        </div>
      )}
    </div>
  );
}
