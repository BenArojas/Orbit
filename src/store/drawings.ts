/**
 * Drawings Store — per-chart drawing tool UI state
 *
 * Owns three pieces of ephemeral state:
 *   activeTool        — which drawing tool the user has armed (null = pointer mode)
 *   selectedDrawingId — the server id of the drawing currently showing handles
 *   drawingsHidden    — temporary hide-all toggle (drawings stay in SQLite)
 *
 * Persistence of the drawings themselves lives in SQLite via the /drawings
 * endpoints; this store is UI state only.
 *
 * Plan: docs/drawing-tools-plan.md, Branch 2.
 */

import { create } from "zustand";

/** Matches DrawingKind in src/lib/api.ts plus null (pointer mode). */
export type DrawingToolId =
  | null
  | "horizontal_line"
  | "trend_line"
  | "ray"
  | "rectangle"
  | "vertical_line"
  | "text"
  | "long_position"
  | "short_position"
  | "forecast"
  | "bars_pattern";

interface DrawingsState {
  /** Which drawing tool the user is currently using. null = pointer (no tool). */
  activeTool: DrawingToolId;
  /** Server-issued id of the drawing currently selected on the chart. */
  selectedDrawingId: number | null;
  /** True hides ALL drawings from the chart without deleting them. */
  drawingsHidden: boolean;

  setActiveTool: (tool: DrawingToolId) => void;
  setSelectedDrawingId: (id: number | null) => void;
  toggleDrawingsHidden: () => void;
  /**
   * Called by the chart store's setActiveConid to wipe ephemeral draw state
   * when the user switches instruments. Drawings themselves are conid-scoped
   * on the server — the GET query for the new conid will repopulate.
   */
  resetDrawingsForConidChange: () => void;
}

export const useDrawingsStore = create<DrawingsState>()((set) => ({
  activeTool: null,
  selectedDrawingId: null,
  drawingsHidden: false,

  setActiveTool: (tool) => set({ activeTool: tool }),

  setSelectedDrawingId: (id) => set({ selectedDrawingId: id }),

  toggleDrawingsHidden: () =>
    set((s) => ({ drawingsHidden: !s.drawingsHidden })),

  resetDrawingsForConidChange: () =>
    set({ activeTool: null, selectedDrawingId: null }),
}));
