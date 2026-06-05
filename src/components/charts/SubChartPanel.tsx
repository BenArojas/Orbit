/**
 * SubChartPanel — Sub-chart for one indicator (RSI / MACD / Stoch / OBV / ADX).
 *
 * Stacked below the main candle chart, one panel per active oscillator-style
 * indicator. Each panel:
 *   - Renders a Lightweight Charts v5 instance with the indicator series
 *   - Shows an indicator label + the *current value(s)* in its top-left header,
 *     updating live as the user moves the crosshair
 *   - Syncs its crosshair with all the other panels + the main chart, via
 *     `useCrosshairStore`, so a hover anywhere shows the same vertical bar
 *     across every chart on the page
 *
 * This is a clean rewrite of the original deferred-init implementation, which
 * had a race where the chart was never created if the container's ResizeObserver
 * never fired with a non-zero size on first toggle.
 *
 * Init strategy: synchronous `useLayoutEffect`. We create the chart immediately
 * on mount; the ResizeObserver only updates dimensions afterwards. The chart
 * starts at width=1, height=PANEL_HEIGHT and resizes as soon as layout settles.
 * No deferred-state machine, no chartReady flag.
 *
 * Crosshair sync:
 *   - We `subscribeCrosshairMove` and call `useCrosshairStore.setHovered(t, id)`
 *     when the move is *user-initiated* (param.sourceEvent is defined).
 *   - We subscribe to the store; if a different `source` writes a time, we
 *     mirror via `setCrosshairPosition`. This gives multi-pane sync identical
 *     to TradingView/ThinkorSwim.
 *
 * Header value display:
 *   - Driven by `hoveredIdx` (state), set from the same crosshair-move handler.
 *   - When no crosshair is active, falls back to the latest value in the series.
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
  type MouseEventParams,
  ColorType,
} from "lightweight-charts";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { IndicatorResult, IndicatorValue } from "@/lib/api";
import { useCrosshairStore } from "@/store";
import { readChartTheme } from "./chartTheme";

// ── Public types ─────────────────────────────────────────────

export type SubChartType = "rsi" | "macd" | "stochastic" | "obv" | "adx";

export interface SubChartPanelProps {
  type: SubChartType;
  indicator: IndicatorResult | undefined;
}

// ── Constants ────────────────────────────────────────────────

const PANEL_HEIGHT = 120;

const COLORS = {
  rsi:           "#b44dff",
  macdLine:      "#00d4ff",
  macdSignal:    "#ff9f1c",
  macdHistUp:    "rgba(0, 255, 136, 0.55)",
  macdHistDown:  "rgba(255, 68, 102, 0.55)",
  stochK:        "#00d4ff",
  stochD:        "#ff9f1c",
  obv:           "#4488ff",
  adx:           "#ff9f1c",
  refLine:       "rgba(255, 255, 255, 0.08)",
} as const;

const LABELS: Record<SubChartType, string> = {
  rsi:        "RSI (14)",
  macd:       "MACD (12,26,9)",
  stochastic: "Stoch (14,3,3)",
  obv:        "OBV",
  adx:        "ADX (14)",
};

const BACKEND_NAME: Record<SubChartType, string> = {
  rsi:        "rsi",
  macd:       "macd",
  stochastic: "stoch",
  obv:        "obv",
  adx:        "adx",
};

// ── Helpers ──────────────────────────────────────────────────

function toLineData(
  values: IndicatorValue[],
  field: keyof IndicatorValue = "value",
): LineData<Time>[] {
  const out: LineData<Time>[] = [];
  for (const v of values) {
    const val = v[field];
    if (typeof val === "number" && !isNaN(val)) {
      out.push({ time: v.time as Time, value: val });
    }
  }
  return out;
}

/** Format a number as 1.23M / 4.5K / 98 — used for OBV which is volume-scale. */
function formatCompact(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(2);
}

/**
 * Build the header value text for a given indicator type at a given index.
 * `idx === -1` means "no hover, use latest non-null value".
 */
function buildHeaderValue(
  type: SubChartType,
  values: IndicatorValue[] | undefined,
  idx: number,
): string {
  if (!values || values.length === 0) return "—";
  const i = idx >= 0 && idx < values.length ? idx : values.length - 1;
  const v = values[i];
  if (!v) return "—";

  switch (type) {
    case "rsi":
    case "adx":
      return fmt(v.value as number | null | undefined);
    case "obv":
      return formatCompact(v.value as number | null | undefined);
    case "macd": {
      const m = fmt(v.value as number | null | undefined);
      const s = fmt(v.signal as number | null | undefined);
      const h = fmt(v.histogram as number | null | undefined);
      return `${m} / ${s} / ${h}`;
    }
    case "stochastic": {
      const k = fmt(v.value as number | null | undefined);
      const d = fmt(v.signal as number | null | undefined);
      return `${k} / ${d}`;
    }
  }
}

/** Subtitle showing field names for multi-line indicators. */
const FIELD_LABEL: Record<SubChartType, string> = {
  rsi:        "value",
  adx:        "value",
  obv:        "value",
  macd:       "MACD / signal / hist",
  stochastic: "%K / %D",
};

// ── Component ────────────────────────────────────────────────

export default function SubChartPanel({
  type,
  indicator,
}: SubChartPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<"Line" | "Histogram">[]>([]);

  // Primary series — the one used to anchor mirrored crosshair positions.
  // (lightweight-charts' setCrosshairPosition needs an explicit series ref.)
  const primarySeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Sorted timestamps of the current indicator series — used to map a hovered
  // time to the index we display in the header.
  const timesRef = useRef<number[]>([]);

  // -1 means "no crosshair, show latest value"
  const [hoveredIdx, setHoveredIdx] = useState<number>(-1);

  // Stable per-instance ID so the crosshair store knows which panel emitted.
  const chartId = useId();

  const broadcastHovered = useCrosshairStore((s) => s.setHovered);
  const sharedTime = useCrosshairStore((s) => s.time);
  const sharedSource = useCrosshairStore((s) => s.source);

  // ── Create chart synchronously on mount ───────────────────

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const theme = readChartTheme();

    const chart = createChart(container, {
      width: container.clientWidth || 1,
      height: container.clientHeight || PANEL_HEIGHT,
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
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: {
        visible: false, // The main chart owns the time axis
      },
      crosshair: {
        vertLine: {
          color: "rgba(0, 212, 255, 0.4)",
          width: 1,
          style: 2,
          labelVisible: false,
        },
        horzLine: {
          color: "rgba(0, 212, 255, 0.3)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#0f1724",
        },
      },
      handleScroll: false,
      handleScale: false,
    });

    chartRef.current = chart;

    // ── Resize ──
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    // ── Theme change ──
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

    // ── Crosshair: emit when user-initiated, update header value either way ──
    const handleMove = (param: MouseEventParams) => {
      // Always update the header value display, even when programmatic
      const t = (param.time as number | undefined) ?? null;
      if (t == null) {
        setHoveredIdx(-1);
      } else {
        const times = timesRef.current;
        // Binary search for the matching index
        let lo = 0, hi = times.length - 1, found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (times[mid] === t) { found = mid; break; }
          if (times[mid] < t) lo = mid + 1; else hi = mid - 1;
        }
        setHoveredIdx(found);
      }

      // Only broadcast user-initiated moves to avoid feedback loops
      if (param.sourceEvent) {
        broadcastHovered(t, chartId);
      }
    };
    chart.subscribeCrosshairMove(handleMove);

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      chart.unsubscribeCrosshairMove(handleMove);
      try { chart.remove(); } catch { /* already gone */ }
      chartRef.current = null;
      primarySeriesRef.current = null;
      seriesRefs.current = [];
    };
  }, [broadcastHovered, chartId]);

  // ── Render indicator data ─────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Wipe existing series
    for (const s of seriesRefs.current) {
      try { chart.removeSeries(s); } catch { /* already gone */ }
    }
    seriesRefs.current = [];
    primarySeriesRef.current = null;

    if (!indicator || indicator.values.length === 0) {
      timesRef.current = [];
      return;
    }

    timesRef.current = indicator.values.map((v) => v.time as number);

    switch (type) {
      case "rsi":        renderRSI(chart, indicator); break;
      case "macd":       renderMACD(chart, indicator); break;
      case "stochastic": renderStochastic(chart, indicator); break;
      case "obv":        renderOBV(chart, indicator); break;
      case "adx":        renderADX(chart, indicator); break;
    }

    chart.timeScale().fitContent();

    // ── Per-render helpers (closure over chart + refs) ──
    function pushPrimary(s: ISeriesApi<"Line">) {
      seriesRefs.current.push(s);
      if (!primarySeriesRef.current) primarySeriesRef.current = s;
    }
    function pushExtra(s: ISeriesApi<"Line" | "Histogram">) {
      seriesRefs.current.push(s);
    }

    function renderRSI(chart: IChartApi, ind: IndicatorResult) {
      const data = toLineData(ind.values);
      if (data.length === 0) return;
      const series = chart.addSeries(LineSeries, {
        color: COLORS.rsi,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      series.setData(data);
      pushPrimary(series);
      addRefLines(chart, data, [30, 70]);
    }

    function renderMACD(chart: IChartApi, ind: IndicatorResult) {
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
        const hist = chart.addSeries(HistogramSeries, {
          priceLineVisible: false,
          lastValueVisible: false,
        });
        hist.setData(histData);
        pushExtra(hist);
      }

      const macd = toLineData(ind.values, "value");
      if (macd.length > 0) {
        const s = chart.addSeries(LineSeries, {
          color: COLORS.macdLine,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3,
        });
        s.setData(macd);
        pushPrimary(s);
      }

      const sig = toLineData(ind.values, "signal");
      if (sig.length > 0) {
        const s = chart.addSeries(LineSeries, {
          color: COLORS.macdSignal,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(sig);
        pushExtra(s);
      }
    }

    function renderStochastic(chart: IChartApi, ind: IndicatorResult) {
      const k = toLineData(ind.values, "value");
      const d = toLineData(ind.values, "signal");
      if (k.length > 0) {
        const s = chart.addSeries(LineSeries, {
          color: COLORS.stochK,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3,
        });
        s.setData(k);
        pushPrimary(s);
      }
      if (d.length > 0) {
        const s = chart.addSeries(LineSeries, {
          color: COLORS.stochD,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(d);
        pushExtra(s);
      }
      const ref = k.length > 0 ? k : d;
      if (ref.length > 0) addRefLines(chart, ref, [20, 80]);
    }

    function renderOBV(chart: IChartApi, ind: IndicatorResult) {
      const data = toLineData(ind.values);
      if (data.length === 0) return;
      const s = chart.addSeries(LineSeries, {
        color: COLORS.obv,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      s.setData(data);
      pushPrimary(s);
    }

    function renderADX(chart: IChartApi, ind: IndicatorResult) {
      const data = toLineData(ind.values);
      if (data.length === 0) return;
      const s = chart.addSeries(LineSeries, {
        color: COLORS.adx,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      s.setData(data);
      pushPrimary(s);
      addRefLines(chart, data, [25]);
    }

    function addRefLines(
      chart: IChartApi,
      anchor: LineData<Time>[],
      levels: number[],
    ) {
      for (const lvl of levels) {
        const s = chart.addSeries(LineSeries, {
          color: COLORS.refLine,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData([
          { time: anchor[0].time, value: lvl },
          { time: anchor[anchor.length - 1].time, value: lvl },
        ]);
        pushExtra(s);
      }
    }
  }, [type, indicator]);

  // ── Mirror crosshair from other charts ────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    const series = primarySeriesRef.current;
    if (!chart || !series) return;
    if (sharedSource === chartId) return; // we broadcast this, ignore
    if (!indicator || indicator.values.length === 0) return;

    if (sharedTime == null) {
      chart.clearCrosshairPosition();
      return;
    }

    // Look up the indicator value at this time so the crosshair can anchor
    // at the right vertical position. Fall back to clearing if not found.
    let value: number | null = null;
    for (const v of indicator.values) {
      if ((v.time as number) === sharedTime) {
        value = (v.value as number | null) ?? null;
        break;
      }
    }
    if (value == null || isNaN(value)) {
      chart.clearCrosshairPosition();
      return;
    }
    try {
      chart.setCrosshairPosition(value, sharedTime as Time, series);
    } catch {
      // setCrosshairPosition can throw if the series was just removed; ignore
    }
  }, [sharedTime, sharedSource, chartId, indicator]);

  // ── Header value (memoized to avoid recompute every render) ──

  const headerValue = useMemo(
    () => buildHeaderValue(type, indicator?.values, hoveredIdx),
    [type, indicator, hoveredIdx],
  );

  return (
    <div
      className="relative shrink-0 border-b border-border last:border-b-0"
      style={{ height: PANEL_HEIGHT }}
    >
      {/* Header — indicator name + live value(s) */}
      <div className="pointer-events-none absolute left-2.5 top-1 z-10 flex items-baseline gap-2 font-data text-[9px]">
        <span className="font-semibold text-[var(--text-2)]">
          {LABELS[type]}
        </span>
        <span className="text-[var(--text-3)]">
          {FIELD_LABEL[type]}:
        </span>
        <span className="font-semibold text-[var(--clr-cyan)]">
          {headerValue}
        </span>
      </div>

      {/* Chart container */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Empty state */}
      {(!indicator || indicator.values.length === 0) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] text-[var(--text-3)]">No data</span>
        </div>
      )}
    </div>
  );
}

export { BACKEND_NAME as SUB_CHART_BACKEND_NAMES };
