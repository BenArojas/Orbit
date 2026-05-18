import { X } from "lucide-react";
import type { Timeframe } from "@/store/chart";
import type { Layout } from "@/store/compare";

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];

const LAYOUT_LABELS: Record<Layout, string> = {
  overlay: "Overlay",
  stockOnly: "Stock only",
  refOnly: "Reference only",
};

export interface PaneToolbarProps {
  paneId: string;
  timeframe: Timeframe;
  layout: Layout;
  /** False when only one pane remains — disables the close ✕. */
  canRemove: boolean;
  onTimeframeChange: (tf: Timeframe) => void;
  onLayoutChange: (layout: Layout) => void;
  onRemove: () => void;
}

export default function PaneToolbar({
  paneId,
  timeframe,
  layout,
  canRemove,
  onTimeframeChange,
  onLayoutChange,
  onRemove,
}: PaneToolbarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--bg-1)] px-2 py-1">
      <div className="flex gap-px rounded-md border border-[var(--border)] bg-[var(--bg-0)] p-0.5">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`rounded px-2 py-0.5 font-data text-[10px] font-medium transition-all ${
              tf === timeframe
                ? "bg-[var(--bg-4)] text-foreground shadow-[inset_0_0_8px_var(--glow-cyan)]"
                : "text-[var(--text-3)] hover:text-[var(--text-2)]"
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      <select
        value={layout}
        onChange={(e) => onLayoutChange(e.target.value as Layout)}
        aria-label={`Layout for pane ${paneId}`}
        className="ml-auto rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 py-0.5 font-data text-[10px] text-[var(--text-2)] focus:border-[var(--clr-cyan)] focus:outline-none"
      >
        {(Object.keys(LAYOUT_LABELS) as Layout[]).map((l) => (
          <option key={l} value={l}>
            {LAYOUT_LABELS[l]}
          </option>
        ))}
      </select>

      <button
        onClick={onRemove}
        disabled={!canRemove}
        title={canRemove ? "Remove pane" : "At least one pane required"}
        aria-label="Remove pane"
        className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-3)] transition-colors hover:text-[var(--clr-red)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-[var(--text-3)]"
      >
        <X size={12} />
      </button>
    </div>
  );
}
