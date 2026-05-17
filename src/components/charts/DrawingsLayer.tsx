/**
 * DrawingsLayer — Bridges the DrawingManager (vendored library) with our
 * store, hooks, and server-persisted drawings.
 *
 * This is a "behavior" component that renders minimal DOM: a context menu
 * overlay when a drawing is right-clicked, and a "SNAP" indicator when
 * Shift is held in draw mode.
 *
 * Responsibilities:
 *   1. Attaches a DrawingManager to the chart on mount.
 *   2. Syncs server drawings (from useDrawings) into the manager.
 *   3. Captures multi-click anchor sequences in draw mode; fires
 *      useCreateDrawing on completion.
 *   4. Shift-to-snap: when Shift is held at click time, snaps the anchor
 *      to the nearest OHLC value on the closest candle.
 *   5. Bridges manager selection events → drawings store.
 *   6. Bridges store selectedDrawingId → manager.selectDrawing.
 *   7. Delete key: removes the selected drawing.
 *   8. Right-click context menu: delete, change color, width, style.
 *   9. drawingsHidden toggle: patches each drawing's visibility.
 *
 * Plan: docs/drawing-tools-plan.md, Branch 3.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from "lightweight-charts";

import {
  DrawingManager,
  HorizontalLine,
  TrendLine,
  Ray,
  Rectangle,
  VerticalLine,
  TextAnnotation,
  LongPosition,
  ShortPosition,
  Forecast,
  BarsPattern,
} from "@/lib/drawings";
import type { IDrawing, DrawingStyle, Anchor } from "@/lib/drawings";

import type {
  Drawing,
  DrawingAnchor,
  DrawingStylePayload,
  DrawingKind,
  CandleData,
} from "@/lib/api";
import { useDrawingsStore } from "@/store/drawings";
import {
  useDrawings,
  useCreateDrawing,
  useUpdateDrawing,
  useDeleteDrawing,
} from "@/hooks/useDrawings";

// ── Constants ─────────────────────────────────────────────────

const ANCHOR_COUNTS: Record<DrawingKind, number> = {
  horizontal_line: 1,
  trend_line: 2,
  ray: 2,
  rectangle: 2,
  vertical_line: 1,
  text: 1,
  long_position: 3,
  short_position: 3,
  forecast: 2,
  bars_pattern: 3,
};

/** Preset color swatches shown in the right-click color picker. */
const COLOR_PRESETS = [
  "#2962FF",
  "#00D4FF",
  "#FF4466",
  "#00FF88",
  "#FFB800",
  "#884DFF",
  "#FF8C00",
  "#FFFFFF",
] as const;

// ── Helpers ───────────────────────────────────────────────────

function toVendorStyle(s?: DrawingStylePayload | null): Partial<DrawingStyle> {
  if (!s) return {};
  const out: Partial<DrawingStyle> = {};
  if (s.line_color) out.lineColor = s.line_color;
  if (s.line_width) out.lineWidth = s.line_width;
  if (s.fill_color) out.fillColor = s.fill_color;
  return out;
}

function toVendorAnchor(a: DrawingAnchor): Anchor {
  return { time: a.time as Time, price: a.price };
}

function makeDrawingInstance(d: Drawing): IDrawing | null {
  const id = String(d.id);
  const anchors = d.anchors.map(toVendorAnchor);
  const style = toVendorStyle(d.style);

  switch (d.kind) {
    case "horizontal_line": return new HorizontalLine(id, anchors, style);
    case "trend_line":      return new TrendLine(id, anchors, style);
    case "ray":             return new Ray(id, anchors, style);
    case "rectangle":       return new Rectangle(id, anchors, style);
    case "vertical_line":   return new VerticalLine(id, anchors, style);
    case "text":            return new TextAnnotation(id, anchors, style);
    case "long_position":   return new LongPosition(id, anchors, style);
    case "short_position":  return new ShortPosition(id, anchors, style);
    case "forecast":        return new Forecast(id, anchors, style);
    case "bars_pattern":    return new BarsPattern(id, anchors, style);
    default:                return null;
  }
}

/**
 * Snap the given price to the nearest OHLC value on the nearest candle.
 * Returns the original anchor unchanged if candles is empty.
 */
function snapToNearestOhlc(
  anchor: Anchor,
  candles: CandleData[],
): Anchor {
  if (candles.length === 0) return anchor;

  const clickTime = anchor.time as number;

  // Find closest candle by timestamp.
  let nearest = candles[0];
  let minDiff = Math.abs(nearest.time - clickTime);
  for (const c of candles) {
    const diff = Math.abs(c.time - clickTime);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = c;
    }
  }

  // Snap price to closest OHLC value on that candle.
  const candidates = [nearest.open, nearest.high, nearest.low, nearest.close];
  let snappedPrice = candidates[0];
  let minPriceDiff = Math.abs(snappedPrice - anchor.price);
  for (const p of candidates) {
    const d = Math.abs(p - anchor.price);
    if (d < minPriceDiff) {
      minPriceDiff = d;
      snappedPrice = p;
    }
  }

  return { time: nearest.time as Time, price: snappedPrice };
}

// ── Context menu component ────────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  drawingId: number;
  conid: number;
  onClose: () => void;
}

function DrawingContextMenu({ x, y, drawingId, conid, onClose }: ContextMenuProps) {
  const deleteDrawing = useDeleteDrawing(conid);
  const updateDrawing = useUpdateDrawing(conid);
  const setSelectedDrawingId = useDrawingsStore((s) => s.setSelectedDrawingId);

  const [sub, setSub] = useState<"color" | "width" | "style" | null>(null);

  const handleDelete = () => {
    deleteDrawing.mutate(drawingId);
    setSelectedDrawingId(null);
    onClose();
  };

  const handleColor = (color: string) => {
    updateDrawing.mutate({ id: drawingId, req: { style: { line_color: color } } });
    onClose();
  };

  const handleWidth = (w: number) => {
    updateDrawing.mutate({ id: drawingId, req: { style: { line_width: w } } });
    onClose();
  };

  const handleLineStyle = (ls: "solid" | "dashed" | "dotted") => {
    updateDrawing.mutate({ id: drawingId, req: { style: { line_style: ls } } });
    onClose();
  };

  // Close on click outside.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = document.getElementById("drawing-context-menu");
      if (el && !el.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  return (
    <div
      id="drawing-context-menu"
      data-testid="drawing-context-menu"
      className="absolute z-50 min-w-[140px] overflow-hidden rounded-md border border-border bg-[var(--bg-2)] py-1 text-[11px] shadow-lg"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {sub === null ? (
        <>
          <button
            className="flex w-full items-center px-3 py-1.5 text-left text-[var(--clr-red)] hover:bg-[var(--bg-3)]"
            onClick={handleDelete}
            data-testid="ctx-delete"
          >
            Delete
          </button>
          <div className="my-0.5 h-px bg-border" />
          <button
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[var(--text-2)] hover:bg-[var(--bg-3)]"
            onClick={() => setSub("color")}
          >
            Change color <span className="opacity-50">›</span>
          </button>
          <button
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[var(--text-2)] hover:bg-[var(--bg-3)]"
            onClick={() => setSub("width")}
          >
            Change width <span className="opacity-50">›</span>
          </button>
          <button
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[var(--text-2)] hover:bg-[var(--bg-3)]"
            onClick={() => setSub("style")}
          >
            Change style <span className="opacity-50">›</span>
          </button>
        </>
      ) : sub === "color" ? (
        <div className="flex flex-wrap gap-1 p-2">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              aria-label={c}
              className="h-5 w-5 rounded-sm border border-transparent hover:border-white/40"
              style={{ background: c }}
              onClick={() => handleColor(c)}
            />
          ))}
        </div>
      ) : sub === "width" ? (
        <>
          {([1, 2, 3, 4] as const).map((w) => (
            <button
              key={w}
              className="flex w-full items-center px-3 py-1.5 text-left text-[var(--text-2)] hover:bg-[var(--bg-3)]"
              onClick={() => handleWidth(w)}
            >
              {w}px
            </button>
          ))}
        </>
      ) : (
        <>
          {(["solid", "dashed", "dotted"] as const).map((ls) => (
            <button
              key={ls}
              className="flex w-full items-center px-3 py-1.5 capitalize text-left text-[var(--text-2)] hover:bg-[var(--bg-3)]"
              onClick={() => handleLineStyle(ls)}
            >
              {ls}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────

export interface DrawingsLayerProps {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  conid: number | null;
  /** Candle data — used for Shift-to-snap anchor snapping. */
  candles?: CandleData[];
}

// ── Component ─────────────────────────────────────────────────

export default function DrawingsLayer({
  chart,
  series,
  containerRef,
  conid,
  candles = [],
}: DrawingsLayerProps) {
  const managerRef = useRef<DrawingManager | null>(null);
  const pendingAnchorsRef = useRef<Anchor[]>([]);

  const activeTool        = useDrawingsStore((s) => s.activeTool);
  const selectedDrawingId = useDrawingsStore((s) => s.selectedDrawingId);
  const drawingsHidden    = useDrawingsStore((s) => s.drawingsHidden);
  const setSelectedDrawingId = useDrawingsStore((s) => s.setSelectedDrawingId);
  const setActiveTool        = useDrawingsStore((s) => s.setActiveTool);

  const { data: drawingsData } = useDrawings(conid);
  const createDrawing = useCreateDrawing(conid ?? 0);
  const deleteDrawing = useDeleteDrawing(conid ?? 0);

  // Shift-to-snap tracking.
  const shiftHeldRef = useRef(false);
  const [shiftHeld, setShiftHeld] = useState(false);

  // Right-click context menu state.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ── 1. Mount — attach DrawingManager ──────────────────────

  useEffect(() => {
    if (!chart || !series || !containerRef.current) return;

    const manager = new DrawingManager();
    manager.attach(chart, series, containerRef.current);
    managerRef.current = manager;

    const unsubSelected = manager.on("drawing:selected", (evt) => {
      const numId = evt.drawingId ? parseInt(evt.drawingId, 10) : null;
      setSelectedDrawingId(numId);
    });

    const unsubDeselected = manager.on("drawing:deselected", () => {
      setSelectedDrawingId(null);
    });

    return () => {
      unsubSelected();
      unsubDeselected();
      manager.detach();
      managerRef.current = null;
    };
  }, [chart, series, containerRef, setSelectedDrawingId]);

  // ── 2. Sync server drawings into the manager ───────────────

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager || !drawingsData) return;

    const serverIds = new Set(drawingsData.map((d) => String(d.id)));
    const managerIds = new Set(manager.getAllDrawings().map((d) => d.id));

    for (const id of managerIds) {
      if (!serverIds.has(id)) manager.removeDrawing(id);
    }

    for (const drawing of drawingsData) {
      const id = String(drawing.id);
      if (!managerIds.has(id)) {
        const instance = makeDrawingInstance(drawing);
        if (instance) {
          instance.updateOptions({ visible: !drawingsHidden });
          manager.addDrawing(instance);
        }
      }
    }
  }, [drawingsData, drawingsHidden]);

  // ── 3. Active tool — capture chart clicks ──────────────────

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager || !chart || !series) return;

    pendingAnchorsRef.current = [];

    if (!activeTool) {
      manager.setActiveTool(null);
      return;
    }

    manager.setActiveTool(activeTool);
    const needed = ANCHOR_COUNTS[activeTool];

    const handleClick = (params: MouseEventParams) => {
      if (!params.point || !params.time) return;

      const price = series.coordinateToPrice(params.point.y);
      if (price == null) return;

      let anchor: Anchor = { time: params.time as Time, price };

      // Shift-to-snap: snap to nearest OHLC value.
      if (shiftHeldRef.current && candles.length > 0) {
        anchor = snapToNearestOhlc(anchor, candles);
      }

      pendingAnchorsRef.current.push(anchor);

      if (pendingAnchorsRef.current.length >= needed) {
        const collected = pendingAnchorsRef.current.slice();
        pendingAnchorsRef.current = [];

        createDrawing.mutate(
          {
            conid: conid!,
            kind: activeTool,
            anchors: collected.map<DrawingAnchor>((a) => ({
              time: a.time as number,
              price: a.price,
            })),
          },
          {
            onSuccess: () => {
              setActiveTool(null);
              manager.setActiveTool(null);
            },
          },
        );
      }
    };

    chart.subscribeClick(handleClick);
    return () => {
      try { chart.unsubscribeClick(handleClick); } catch { /* chart gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, chart, series, conid, setActiveTool, candles]);

  // ── 4. Reflect external selection changes into the manager ─

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    if (selectedDrawingId == null) {
      manager.deselectAll();
    } else {
      manager.selectDrawing(String(selectedDrawingId));
    }
  }, [selectedDrawingId]);

  // ── 5. drawingsHidden toggle ────────────────────────────────

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    for (const drawing of manager.getAllDrawings()) {
      drawing.updateOptions({ visible: !drawingsHidden });
    }
  }, [drawingsHidden]);

  // ── 6. Shift key tracking ───────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shiftHeldRef.current = true;
        setShiftHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shiftHeldRef.current = false;
        setShiftHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ── 7. Delete key handler ───────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedDrawingId != null) {
        e.stopPropagation();
        deleteDrawing.mutate(selectedDrawingId);
        setSelectedDrawingId(null);
        setContextMenu(null);
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, selectedDrawingId, setSelectedDrawingId]);

  // ── 8. Right-click context menu ────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextMenu = (e: MouseEvent) => {
      if (selectedDrawingId == null) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      setContextMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };

    container.addEventListener("contextmenu", handleContextMenu);
    return () => container.removeEventListener("contextmenu", handleContextMenu);
  }, [containerRef, selectedDrawingId]);

  // ── Render ─────────────────────────────────────────────────

  const showSnap = shiftHeld && activeTool != null;

  if (!contextMenu && !showSnap) return null;

  return (
    <>
      {/* SNAP indicator — shown when Shift is held in draw mode */}
      {showSnap && (
        <div
          data-testid="snap-indicator"
          className="pointer-events-none absolute left-2 top-2 z-40 rounded bg-[var(--clr-cyan)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-black"
        >
          SNAP
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && selectedDrawingId != null && conid != null && (
        <DrawingContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          drawingId={selectedDrawingId}
          conid={conid}
          onClose={closeContextMenu}
        />
      )}
    </>
  );
}
