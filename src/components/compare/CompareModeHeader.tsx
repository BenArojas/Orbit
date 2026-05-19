/**
 * CompareModeHeader — Bar at the top of Compare Mode.
 *
 *   Compare:  AAPL        [📍 Marker] [🧹 Clear]   [+ Add pane]   [✕ Exit]
 *
 * The primary stock is read-only inside compare mode — to swap stocks
 * the user must exit (or click a watchlist row, which AnalysisPage
 * handles by force-exiting + switching).
 *
 * The reference symbol used to live here (one shared across all panes)
 * but each pane now has its own reference input in its toolbar so the
 * user can compare against multiple relative tickers simultaneously.
 */

import { MapPin, Plus, X, Eraser } from "lucide-react";

import { useChartStore } from "@/store/chart";
import { useCompareStore, MAX_PANES } from "@/store/compare";

export default function CompareModeHeader() {
  const activeSymbol = useChartStore((s) => s.activeSymbol);
  const panes = useCompareStore((s) => s.panes);
  const addPane = useCompareStore((s) => s.addPane);
  const exit = useCompareStore((s) => s.exit);
  const markerMode = useCompareStore((s) => s.markerMode);
  const markers = useCompareStore((s) => s.markers);
  const toggleMarkerMode = useCompareStore((s) => s.toggleMarkerMode);
  const clearMarkers = useCompareStore((s) => s.clearMarkers);

  const atPaneCap = panes.length >= MAX_PANES;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-1)] px-3 py-2 text-[12px]">
      <span className="text-[var(--text-3)]">Compare:</span>
      <span className="rounded bg-[var(--bg-3)] px-2 py-0.5 font-mono text-[11px] font-bold text-foreground">
        {activeSymbol || "—"}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={toggleMarkerMode}
          aria-label={markerMode ? "Exit marker mode" : "Enter marker mode"}
          title={markerMode ? "Click a pane to drop/remove markers · click again to exit" : "Marker mode: click a pane to drop a divergence marker"}
          className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-all ${
            markerMode
              ? "border-[var(--clr-cyan)] bg-[rgba(0,212,255,0.1)] text-[var(--clr-cyan)]"
              : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
          }`}
        >
          <MapPin size={12} /> Marker
        </button>
        {markers.length > 0 && (
          <button
            onClick={clearMarkers}
            aria-label="Clear all markers"
            title={`Clear ${markers.length} marker${markers.length === 1 ? "" : "s"}`}
            className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-3)] transition-all hover:border-[var(--clr-red)] hover:text-[var(--clr-red)]"
          >
            <Eraser size={12} /> Clear
          </button>
        )}
        <button
          onClick={addPane}
          disabled={atPaneCap}
          aria-label="Add pane"
          title={atPaneCap ? `Maximum ${MAX_PANES} panes` : "Add another pane"}
          className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-2)] transition-all hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-2)]"
        >
          <Plus size={12} /> Add pane
        </button>
        <button
          onClick={exit}
          aria-label="Exit compare mode"
          title="Exit Compare mode (C)"
          className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--clr-red)] transition-all hover:border-[var(--clr-red)] hover:bg-[rgba(255,68,102,0.08)]"
        >
          <X size={12} /> Exit
        </button>
      </div>
    </div>
  );
}
