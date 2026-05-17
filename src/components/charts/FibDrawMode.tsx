/**
 * FibDrawMode — Two-click manual fib drawing on the chart.
 *
 * Lifecycle:
 *   1. User clicks "Draw Fib" button → enterFibDrawMode("retracement")
 *   2. User clicks first point on chart → captured as point A (swing start)
 *   3. As user moves crosshair, a ghost preview shows fib levels from A→cursor
 *   4. User clicks second point → captured as point B (swing end)
 *   5. The fib is locked via POST /fibonacci/lock and exitFibDrawMode()
 *   6. Escape at any point cancels the draw
 *
 * Implementation notes:
 *   - Uses Lightweight Charts v5 subscribeClick / subscribeCrosshairMove
 *   - Ghost preview renders temporary PriceLines that update on mousemove.
 *     PriceLines use applyOptions({ price }) which does NOT fire crosshair
 *     move events — avoids the infinite recursion that setData() caused.
 *   - This component is a "behavior" component (no visible DOM of its own,
 *     apart from a tiny status pill) — it imperatively controls the chart
 *     via the chartRef passed as prop.
 */

import { useEffect, useRef, useCallback } from "react";
import {
  type IChartApi,
  type ISeriesApi,
  type Time,
  type IPriceLine,
} from "lightweight-charts";

import {
  FIB_BOUNDARY_COLOR,
  FIB_COLOR_PALETTE,
  useChartStore,
  type FibDrawPoint,
} from "@/store/chart";
import { useLockFib } from "@/hooks/useLockedFibs";

// ── Constants ────────────────────────────────────────────────

const GHOST_LEVELS = [0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0];

/** Levels that fall inside the golden pocket. */
const GHOST_GP_LEVELS = new Set([0.618, 0.65, 0.716]);

// Branch 6 (plan decision 2A): the ghost preview now uses the same
// color rules as the locked overlay. Pulled from the PRIMARY palette
// slot so what the user sees during draw matches what they'll see
// once the fib is locked. Slightly more transparent than the final
// render (×0.85) to keep "this is a preview" feel without going so
// faint that the line disappears.
const GHOST_PREVIEW_OPACITY = 0.85;

function ghostColor(ratio: number): string {
  if (ratio === 0 || ratio === 1.0) return FIB_BOUNDARY_COLOR;
  const primary = FIB_COLOR_PALETTE[0];
  return GHOST_GP_LEVELS.has(ratio)
    ? primary.goldenPocket
    : primary.retracement;
}

/** Scale the alpha channel of an `rgba(...)` color by `factor`. */
function applyAlpha(color: string, factor: number): string {
  const match =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
      color,
    );
  if (!match) return color;
  const [, r, g, b, a = "1"] = match;
  const newAlpha = Math.max(0, Math.min(1, parseFloat(a) * factor));
  return `rgba(${r}, ${g}, ${b}, ${newAlpha.toFixed(3)})`;
}

// ── Props ────────────────────────────────────────────────────

interface FibDrawModeProps {
  /** The Lightweight Charts instance ref */
  chart: IChartApi | null;
  /** The candle series ref — needed to convert pixel→price via coordinateToPrice */
  candleSeries: ISeriesApi<"Candlestick"> | null;
  /** Candle data — we only use the length for the guard in drawGhost */
  candles: unknown[];
  /** Current conid for locking */
  conid: number | null;
  /** Current timeframe string */
  timeframe: string;
}

// ── Component ────────────────────────────────────────────────

export default function FibDrawMode({
  chart,
  candleSeries,
  candles,
  conid,
  timeframe,
}: FibDrawModeProps) {
  const fibDrawMode = useChartStore((s) => s.fibDrawMode);
  const fibDrawPointA = useChartStore((s) => s.fibDrawPointA);
  const fibDrawPointB = useChartStore((s) => s.fibDrawPointB);
  const setFibDrawPointA = useChartStore((s) => s.setFibDrawPointA);
  const setFibDrawPointB = useChartStore((s) => s.setFibDrawPointB);
  const exitFibDrawMode = useChartStore((s) => s.exitFibDrawMode);

  const lockFib = useLockFib();
  const ghostLinesRef = useRef<IPriceLine[]>([]);

  // ── Cleanup ghost lines ──────────────────────────────────

  const clearGhost = useCallback(() => {
    if (!candleSeries) return;
    for (const line of ghostLinesRef.current) {
      try {
        candleSeries.removePriceLine(line);
      } catch {
        /* already removed */
      }
    }
    ghostLinesRef.current = [];
  }, [candleSeries]);

  // ── Ensure ghost price lines exist (one per level, reused across moves) ──

  const ensureGhostLines = useCallback(() => {
    if (!candleSeries || ghostLinesRef.current.length === GHOST_LEVELS.length) return;

    // Create price lines once — they'll be reused via applyOptions on each move.
    // Using PriceLines instead of LineSeries avoids the setData → crosshair
    // re-fire → infinite recursion that crashed the chart in v5.
    clearGhost();
    for (let i = 0; i < GHOST_LEVELS.length; i++) {
      const ratio = GHOST_LEVELS[i];
      const line = candleSeries.createPriceLine({
        price: 0,
        color: applyAlpha(ghostColor(ratio), GHOST_PREVIEW_OPACITY),
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: false,
      });
      ghostLinesRef.current.push(line);
    }
  }, [candleSeries, clearGhost]);

  // ── Draw ghost preview at cursor price (reuses existing price lines) ──

  const drawGhost = useCallback(
    (pointA: FibDrawPoint, cursorPrice: number) => {
      if (candles.length === 0) return;

      ensureGhostLines();

      const swingLow = Math.min(pointA.price, cursorPrice);
      const swingHigh = Math.max(pointA.price, cursorPrice);
      const range = swingHigh - swingLow;
      if (range <= 0) return;

      const direction = cursorPrice > pointA.price ? "up" : "down";

      for (let i = 0; i < GHOST_LEVELS.length; i++) {
        const ratio = GHOST_LEVELS[i];
        const price =
          direction === "up"
            ? swingHigh - range * ratio
            : swingLow + range * ratio;

        // applyOptions({ price }) does NOT trigger crosshair move events —
        // safe to call inside subscribeCrosshairMove without recursion.
        ghostLinesRef.current[i]?.applyOptions({ price });
      }
    },
    [candles.length, ensureGhostLines],
  );

  // ── Chart click handler — capture only ──────────────────────
  //
  // Sole job: write pointA or pointB to the store. The lock mutation
  // is in a separate effect below. This keeps the dep array tiny and
  // stable — lockFib is not a dep, eliminating the constant re-
  // subscribe churn that caused the second click to be dropped.

  useEffect(() => {
    if (!chart || !candleSeries || !fibDrawMode) return;

    const handleClick = (param: { time?: Time; point?: { x: number; y: number } }) => {
      if (!param.time || !param.point) return;

      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null || price === undefined) return;

      const time = typeof param.time === "number" ? param.time : 0;
      const clickPoint: FibDrawPoint = { time, price };

      if (!fibDrawPointA) {
        setFibDrawPointA(clickPoint);
      } else {
        setFibDrawPointB(clickPoint);
      }
    };

    chart.subscribeClick(handleClick);
    return () => {
      chart.unsubscribeClick(handleClick);
    };
  }, [
    chart,
    candleSeries,
    fibDrawMode,
    fibDrawPointA,
    setFibDrawPointA,
    setFibDrawPointB,
  ]);

  // ── Lock effect — fires when both points are captured ────────
  //
  // Watches pointA + pointB. When both are set, computes swing
  // high/low/direction and fires the lock mutation. Separating this
  // from the click handler keeps lockFib out of the click effect's
  // deps, fixing the re-subscribe storm.

  useEffect(() => {
    if (!fibDrawPointA || !fibDrawPointB || !fibDrawMode) return;

    const swingLow = Math.min(fibDrawPointA.price, fibDrawPointB.price);
    const swingHigh = Math.max(fibDrawPointA.price, fibDrawPointB.price);
    const direction = fibDrawPointB.price > fibDrawPointA.price ? "up" : "down";

    if (conid && swingHigh > swingLow) {
      lockFib.mutate({
        conid,
        timeframe,
        tool_type: fibDrawMode,
        swing_high_price: swingHigh,
        swing_high_time:
          direction === "up" ? fibDrawPointB.time : fibDrawPointA.time,
        swing_low_price: swingLow,
        swing_low_time:
          direction === "up" ? fibDrawPointA.time : fibDrawPointB.time,
        direction,
      });
    }

    clearGhost();
    exitFibDrawMode();
  }, [
    fibDrawPointA,
    fibDrawPointB,
    fibDrawMode,
    conid,
    timeframe,
    lockFib,
    clearGhost,
    exitFibDrawMode,
  ]);

  // ── Crosshair move → ghost preview ───────────────────────

  useEffect(() => {
    if (!chart || !candleSeries || !fibDrawMode || !fibDrawPointA) return;

    const handleMove = (param: { point?: { x: number; y: number } }) => {
      if (!param.point) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null || price === undefined) return;
      drawGhost(fibDrawPointA, price);
    };

    chart.subscribeCrosshairMove(handleMove);
    return () => {
      chart.unsubscribeCrosshairMove(handleMove);
      clearGhost();
    };
  }, [chart, candleSeries, fibDrawMode, fibDrawPointA, drawGhost, clearGhost]);

  // ── Escape to cancel ─────────────────────────────────────

  useEffect(() => {
    if (!fibDrawMode) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearGhost();
        exitFibDrawMode();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [fibDrawMode, clearGhost, exitFibDrawMode]);

  // ── Cleanup on unmount or mode exit ──────────────────────

  useEffect(() => {
    if (!fibDrawMode) {
      clearGhost();
    }
  }, [fibDrawMode, clearGhost]);

  // ── Status pill (floating indicator that draw mode is active) ──

  if (!fibDrawMode) return null;

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-[var(--clr-green)] bg-[rgba(0,255,136,0.1)] px-3 py-1 font-data text-[10px] text-[var(--clr-green)]">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--clr-green)]" />
      {fibDrawPointA
        ? `Click second point (${fibDrawMode})`
        : `Click first point (${fibDrawMode})`}
      <span className="text-[var(--text-4)]">ESC to cancel</span>
    </div>
  );
}
