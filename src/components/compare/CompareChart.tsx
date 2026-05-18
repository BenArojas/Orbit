import {
  createChart,
  LineSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  type MouseEventParams,
} from "lightweight-charts";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { readChartTheme } from "@/components/charts/chartTheme";
import { useCrosshairStore } from "@/store";
import type { CandleData } from "@/lib/api";
import type { Layout } from "@/store/compare";
import type { CompareLiveTick } from "@/hooks/useCompareData";

const CROSSHAIR_COLOR = "rgba(0, 212, 255, 0.4)";
const CROSSHAIR_LABEL_BG = "#0f1724";
const STOCK_PRICE_SCALE_ID = "right";
const REF_PRICE_SCALE_ID = "left";

const STOCK_LINE_COLOR = "#ffffff";
const REF_LINE_COLOR = "#6ee884";
const LINE_WIDTH = 2;

export interface CompareChartProps {
  layout: Layout;
  stockCandles: CandleData[] | undefined;
  refCandles: CandleData[] | undefined;
  stockSymbol: string;
  refSymbol: string;
  stockLiveTick: CompareLiveTick | null;
  refLiveTick: CompareLiveTick | null;
}

function toLineData(c: CandleData): LineData<Time> {
  return { time: c.time as Time, value: c.close };
}

export default function CompareChart({
  layout,
  stockCandles,
  refCandles,
  stockSymbol,
  refSymbol,
  stockLiveTick,
  refLiveTick,
}: CompareChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const stockSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const refSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const chartId = useId();

  const showStock = layout !== "refOnly";
  const showRef = layout !== "stockOnly";

  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const broadcastHovered = useCrosshairStore((s) => s.setHovered);
  const sharedTime = useCrosshairStore((s) => s.time);
  const sharedSource = useCrosshairStore((s) => s.source);

  // Create chart instance + series per layout
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
        vertLine: { color: CROSSHAIR_COLOR, width: 1, style: 2, labelBackgroundColor: CROSSHAIR_LABEL_BG },
        horzLine: { color: CROSSHAIR_COLOR, width: 1, style: 2, labelBackgroundColor: CROSSHAIR_LABEL_BG },
      },
      rightPriceScale: {
        borderColor: theme.borderColor,
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      leftPriceScale: {
        visible: true,
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

    chartRef.current = chart;

    if (showStock) {
      const stockSeries = chart.addSeries(LineSeries, {
        color: STOCK_LINE_COLOR,
        lineWidth: LINE_WIDTH,
        priceScaleId: STOCK_PRICE_SCALE_ID,
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
      });
      stockSeriesRef.current = stockSeries;
    }

    if (showRef) {
      const refSeries = chart.addSeries(LineSeries, {
        color: REF_LINE_COLOR,
        lineWidth: LINE_WIDTH,
        priceScaleId: REF_PRICE_SCALE_ID,
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
      });
      refSeriesRef.current = refSeries;
    }

    // Force both price scales to Mode.Normal (= 0 = "Regular")
    chart.priceScale(STOCK_PRICE_SCALE_ID).applyOptions({ mode: 0 });
    chart.priceScale(REF_PRICE_SCALE_ID).applyOptions({ mode: 0 });

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    ro.observe(container);

    const themeObs = new MutationObserver(() => {
      const t = readChartTheme();
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: t.bg }, textColor: t.text },
        grid: { vertLines: { color: t.gridLines }, horzLines: { color: t.gridLines } },
        rightPriceScale: { borderColor: t.borderColor },
        leftPriceScale: { borderColor: t.borderColor },
        timeScale: { borderColor: t.borderColor },
      });
    });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const xhrHandler = (param: MouseEventParams) => {
      const t = (param.time as number | undefined) ?? null;
      setHoveredTime(t);
      if (!param.sourceEvent) return;
      broadcastHovered(t, chartId);
    };
    chart.subscribeCrosshairMove(xhrHandler);

    return () => {
      ro.disconnect();
      themeObs.disconnect();
      try { chart.unsubscribeCrosshairMove(xhrHandler); } catch { /* no-op */ }
      chart.remove();
      chartRef.current = null;
      stockSeriesRef.current = null;
      refSeriesRef.current = null;
    };
  }, [layout, chartId, broadcastHovered, showStock, showRef]);

  // Update data — layout in deps so effects re-fire when chart rebuilds on layout change (black chart fix)
  useEffect(() => {
    const series = stockSeriesRef.current;
    if (!series || !stockCandles || stockCandles.length === 0) return;
    series.setData(stockCandles.map(toLineData));
  }, [stockCandles, layout]);

  useEffect(() => {
    const series = refSeriesRef.current;
    if (!series || !refCandles || refCandles.length === 0) return;
    series.setData(refCandles.map(toLineData));
  }, [refCandles, layout]);

  // Live tick updates
  useEffect(() => {
    const series = stockSeriesRef.current;
    if (!series || !stockCandles || stockCandles.length === 0 || !stockLiveTick) return;
    const last = stockCandles[stockCandles.length - 1];
    series.update({ time: last.time as Time, value: stockLiveTick.last });
  }, [stockLiveTick, stockCandles, layout]);

  useEffect(() => {
    const series = refSeriesRef.current;
    if (!series || !refCandles || refCandles.length === 0 || !refLiveTick) return;
    const last = refCandles[refCandles.length - 1];
    series.update({ time: last.time as Time, value: refLiveTick.last });
  }, [refLiveTick, refCandles, layout]);

  // Mirror shared crosshair from other panes
  useEffect(() => {
    const chart = chartRef.current;
    const series = stockSeriesRef.current ?? refSeriesRef.current;
    if (!chart || !series) return;
    if (sharedSource === chartId) return;
    const candles = stockCandles ?? refCandles;
    if (!candles || candles.length === 0) return;

    if (sharedTime == null) {
      chart.clearCrosshairPosition();
      return;
    }
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
    } catch { /* series removed mid-update */ }
  }, [sharedTime, sharedSource, chartId, stockCandles, refCandles]);

  // Legend
  const legend = useMemo(() => {
    const findAt = (candles: CandleData[] | undefined) => {
      if (!candles || candles.length === 0) return null;
      if (hoveredTime == null) return candles[candles.length - 1];
      for (const c of candles) if (c.time === hoveredTime) return c;
      return null;
    };
    return {
      stock: showStock ? findAt(stockCandles) : null,
      ref: showRef ? findAt(refCandles) : null,
    };
  }, [hoveredTime, stockCandles, refCandles, showStock, showRef]);

  const fmt = (n: number | undefined | null) => n == null ? "—" : n.toFixed(2);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-3 top-2 z-10 rounded border border-[var(--border)] bg-[var(--bg-1)]/85 px-2 py-1 font-mono text-[10px] text-[var(--text-2)]">
        {legend.stock && (
          <div>
            <span className="font-bold text-[var(--text-1)]">{stockSymbol}</span>{" "}
            O {fmt(legend.stock.open)}  H {fmt(legend.stock.high)}  L {fmt(legend.stock.low)}  C {fmt(legend.stock.close)}
          </div>
        )}
        {legend.ref && (
          <div className="text-[#6ee884]">
            <span className="font-bold">{refSymbol}</span>{" "}
            O {fmt(legend.ref.open)}  H {fmt(legend.ref.high)}  L {fmt(legend.ref.low)}  C {fmt(legend.ref.close)}
          </div>
        )}
      </div>
    </div>
  );
}
