/**
 * Crosshair Store — shared timestamp across the main chart and all sub-panels.
 *
 * When the user hovers over any chart on the Analysis page, all the others
 * mirror the crosshair at the same timestamp so values line up vertically.
 *
 * How it works:
 *   - Each chart subscribes to its own crosshair-move events.
 *   - When the move is *user-initiated* (mouse), the chart writes
 *     { time, source } into this store.
 *   - All charts subscribe to store changes; if `source !== self`, they
 *     mirror the crosshair via `chart.setCrosshairPosition(...)`.
 *
 * The `source` field prevents feedback loops — a chart never reacts to
 * its own broadcast.
 *
 * Time is stored as a Unix-second timestamp (lightweight-charts `Time`).
 * `null` means no crosshair (mouse left all charts).
 */

import { create } from "zustand";

interface CrosshairState {
  /** Currently-hovered timestamp (Unix seconds) — null when no chart is hovered. */
  time: number | null;
  /** Identifier of the chart that broadcast this position (anti-loop guard). */
  source: string | null;
  /** Set the hovered time + the chart that originated it. */
  setHovered: (time: number | null, source: string) => void;
}

export const useCrosshairStore = create<CrosshairState>((set) => ({
  time: null,
  source: null,
  setHovered: (time, source) => set({ time, source }),
}));
