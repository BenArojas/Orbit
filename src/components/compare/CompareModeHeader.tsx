/**
 * CompareModeHeader — Bar at the top of Compare Mode.
 *
 *   Compare:  AAPL                          [+ Add pane]   [✕ Exit]
 *
 * The primary stock is read-only inside compare mode — to swap stocks
 * the user must exit (or click a watchlist row, which AnalysisPage
 * handles by force-exiting + switching).
 *
 * The reference symbol used to live here (one shared across all panes)
 * but each pane now has its own reference input in its toolbar so the
 * user can compare against multiple relative tickers simultaneously.
 */

import { Plus, X } from "lucide-react";

import { useChartStore } from "@/store/chart";
import { useCompareStore, MAX_PANES } from "@/store/compare";

export default function CompareModeHeader() {
  const activeSymbol = useChartStore((s) => s.activeSymbol);
  const panes = useCompareStore((s) => s.panes);
  const colors = useCompareStore((s) => s.colors);
  const addPane = useCompareStore((s) => s.addPane);
  const exit = useCompareStore((s) => s.exit);
  const setColors = useCompareStore((s) => s.setColors);

  const atPaneCap = panes.length >= MAX_PANES;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-1)] px-3 py-2 text-[12px]">
      <span className="text-[var(--text-3)]">Compare:</span>
      <span className="rounded bg-[var(--bg-3)] px-2 py-0.5 font-mono text-[11px] font-bold text-foreground">
        {activeSymbol || "—"}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-3)]">
          Stock
          <input
            type="color"
            aria-label="Stock compare color"
            value={colors.stock}
            onChange={(event) => setColors({ stock: event.target.value })}
            className="h-6 w-7 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0"
          />
        </label>
        <label className="flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-3)]">
          Ref
          <input
            type="color"
            aria-label="Reference compare color"
            value={colors.reference}
            onChange={(event) => setColors({ reference: event.target.value })}
            className="h-6 w-7 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0"
          />
        </label>
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
