/**
 * Drawing tools registry — core v1 tools (6 of 10 total).
 *
 * The remaining 4 projection tools (LongPosition, ShortPosition, Forecast,
 * BarsPattern) are registered in Branch 4 as PROJECTION_TOOLS.
 *
 * Each entry declares:
 *   id            — DrawingToolId used in the Zustand store
 *   label         — human-readable name shown in tooltips
 *   Icon          — lucide-react icon component
 *   shortcut      — single-key shortcut wired up in AnalysisPage
 *   upstreamClass — class name in the vendored library (documentation)
 *   anchorCount   — number of chart clicks needed to commit the drawing
 *
 * Plan: docs/drawing-tools-plan.md, Branch 3.
 */

import type { LucideIcon } from "lucide-react";
import { Minus, MoveUpRight, Square, TrendingUp, Type } from "lucide-react";
import type { DrawingToolId } from "@/store/drawings";

export interface DrawingToolEntry {
  id: NonNullable<DrawingToolId>;
  label: string;
  Icon: LucideIcon;
  /** Single-key keyboard shortcut (no modifier). */
  shortcut: string;
  /** Upstream class name in the vendored library — for documentation only. */
  upstreamClass: string;
  /** Number of chart-click anchors required before the drawing is committed. */
  anchorCount: number;
  /** CSS class applied to the icon to rotate it (e.g. "rotate-90"). */
  iconClass?: string;
}

export const CORE_TOOLS: DrawingToolEntry[] = [
  {
    id: "horizontal_line",
    label: "Horizontal Line",
    Icon: Minus,
    shortcut: "H",
    upstreamClass: "HorizontalLine",
    anchorCount: 1,
  },
  {
    id: "trend_line",
    label: "Trendline",
    Icon: TrendingUp,
    shortcut: "T",
    upstreamClass: "TrendLine",
    anchorCount: 2,
  },
  {
    id: "ray",
    label: "Ray",
    Icon: MoveUpRight,
    shortcut: "R",
    upstreamClass: "Ray",
    anchorCount: 2,
  },
  {
    id: "rectangle",
    label: "Rectangle",
    Icon: Square,
    shortcut: "S",
    upstreamClass: "Rectangle",
    anchorCount: 2,
  },
  {
    id: "vertical_line",
    label: "Vertical Line",
    Icon: Minus,
    iconClass: "rotate-90",
    shortcut: "V",
    upstreamClass: "VerticalLine",
    anchorCount: 1,
  },
  {
    id: "text",
    label: "Text Annotation",
    Icon: Type,
    shortcut: "X",
    upstreamClass: "TextAnnotation",
    anchorCount: 1,
  },
];

/** Map from shortcut key (uppercase) to tool id — used by AnalysisPage. */
export const SHORTCUT_MAP: Readonly<Record<string, NonNullable<DrawingToolId>>> = {
  H: "horizontal_line",
  T: "trend_line",
  R: "ray",
  S: "rectangle",
  V: "vertical_line",
  X: "text",
};
