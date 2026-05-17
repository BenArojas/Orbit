/**
 * DrawingsLayer — Bridges the DrawingManager (vendored library) with our
 * store, hooks, and server-persisted drawings.
 *
 * This is a "behavior" component: it renders no DOM of its own.
 * It mounts inside ChartContainer and owns the full drawing lifecycle:
 *
 *   1. Attaches a DrawingManager to the chart on mount.
 *   2. Syncs server drawings (from useDrawings) into the manager —
 *      adds entries the manager doesn't have, removes ones that vanished.
 *   3. When activeTool is set in the store: captures chart clicks, collects
 *      anchors, fires useCreateDrawing on completion, then clears the tool.
 *   4. Listens for manager events (drawing:selected / drawing:deselected)
 *      and writes them back to the drawings store.
 *   5. Reflects selectedDrawingId changes from the store into the manager.
 *   6. Handles drawingsHidden toggle by patching each drawing's visibility.
 *
 * Cross-TF anchor behaviour: no special treatment needed.
 * The library anchors use { time, price }; LW Charts maps time → x-coord
 * per the active timeframe automatically. Verified in dev (see plan).
 *
 * Plan: docs/drawing-tools-plan.md, Branch 2.
 */

import { useEffect, useRef } from "react";
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

import type { Drawing, DrawingAnchor, DrawingStylePayload, DrawingKind } from "@/lib/api";
import { useDrawingsStore } from "@/store/drawings";
import { useDrawings, useCreateDrawing, useDeleteDrawing } from "@/hooks/useDrawings";

// ── Anchor count per tool ─────────────────────────────────────

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

// ── Coordinate conversion helpers ─────────────────────────────

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

// ── Drawing factory ───────────────────────────────────────────

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

// ── Props ─────────────────────────────────────────────────────

export interface DrawingsLayerProps {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  conid: number | null;
}

// ── Component ─────────────────────────────────────────────────

export default function DrawingsLayer({
  chart,
  series,
  containerRef,
  conid,
}: DrawingsLayerProps) {
  const managerRef = useRef<DrawingManager | null>(null);
  // Anchors collected during the current multi-click drawing sequence.
  const pendingAnchorsRef = useRef<Anchor[]>([]);

  const activeTool        = useDrawingsStore((s) => s.activeTool);
  const selectedDrawingId = useDrawingsStore((s) => s.selectedDrawingId);
  const drawingsHidden    = useDrawingsStore((s) => s.drawingsHidden);
  const setSelectedDrawingId = useDrawingsStore((s) => s.setSelectedDrawingId);
  const setActiveTool        = useDrawingsStore((s) => s.setActiveTool);

  const { data: drawingsData } = useDrawings(conid);
  const createDrawing = useCreateDrawing(conid ?? 0);
  const deleteDrawing = useDeleteDrawing(conid ?? 0);

  // ── 1. Mount — create and attach the manager ───────────────

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

    // Remove drawings that are no longer on the server.
    for (const id of managerIds) {
      if (!serverIds.has(id)) {
        manager.removeDrawing(id);
      }
    }

    // Add new drawings from the server.
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

  // ── 3. Active tool — capture chart clicks for anchor placement ─

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager || !chart || !series) return;

    // Reset pending anchors whenever the tool changes.
    pendingAnchorsRef.current = [];

    if (!activeTool) {
      manager.setActiveTool(null);
      return;
    }

    // Signal the manager so it can show a custom cursor if it supports it.
    manager.setActiveTool(activeTool);

    const needed = ANCHOR_COUNTS[activeTool];

    const handleClick = (params: MouseEventParams) => {
      if (!params.point || !params.time) return;

      // Convert the pixel y-coordinate to a price using the candle series.
      const price = series.coordinateToPrice(params.point.y);
      if (price == null) return;

      const anchor: Anchor = { time: params.time as Time, price };
      pendingAnchorsRef.current.push(anchor);

      if (pendingAnchorsRef.current.length >= needed) {
        const collectedAnchors = pendingAnchorsRef.current.slice();
        pendingAnchorsRef.current = [];

        createDrawing.mutate(
          {
            conid: conid!,
            kind: activeTool,
            anchors: collectedAnchors.map<DrawingAnchor>((a) => ({
              time: a.time as number,
              price: a.price,
            })),
          },
          {
            onSuccess: () => {
              // Exit draw mode — the invalidated query will re-sync the manager.
              setActiveTool(null);
              manager.setActiveTool(null);
            },
          },
        );
      }
    };

    chart.subscribeClick(handleClick);
    return () => {
      try {
        chart.unsubscribeClick(handleClick);
      } catch {
        /* chart already removed */
      }
    };
    // createDrawing and deleteDrawing are stable mutation objects; omitting
    // from deps to avoid re-subscribing on every render cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, chart, series, conid, setActiveTool]);

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

  // ── 6. Delete key handler ───────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedDrawingId != null) {
        e.stopPropagation();
        deleteDrawing.mutate(selectedDrawingId);
        setSelectedDrawingId(null);
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, selectedDrawingId, setSelectedDrawingId]);

  return null;
}
