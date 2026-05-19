import { useEffect, useState, type KeyboardEvent } from "react";
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
  /** Per-pane reference symbol — uppercased, e.g. "SPY". */
  refSymbol: string;
  /** True while the resolver is in flight — input pulses while pending. */
  refResolving: boolean;
  /** False when only one pane remains — disables the close ✕. */
  canRemove: boolean;
  onTimeframeChange: (tf: Timeframe) => void;
  onLayoutChange: (layout: Layout) => void;
  /** Fired on Enter/blur with the trimmed-uppercase typed value. */
  onRefSubmit: (symbol: string) => void;
  onRemove: () => void;
}

export default function PaneToolbar({
  paneId,
  timeframe,
  layout,
  refSymbol,
  refResolving,
  canRemove,
  onTimeframeChange,
  onLayoutChange,
  onRefSubmit,
  onRemove,
}: PaneToolbarProps) {
  // Local input state so the user can type freely without us hijacking
  // every keystroke. Synced to `refSymbol` when the input isn't focused.
  const [refInput, setRefInput] = useState(refSymbol);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (!inputFocused) setRefInput(refSymbol);
  }, [refSymbol, inputFocused]);

  const submit = () => {
    const sym = refInput.trim().toUpperCase();
    if (!sym || sym === refSymbol) {
      setRefInput(refSymbol);
      return;
    }
    onRefSubmit(sym);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") setRefInput(refSymbol);
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border)] bg-[var(--bg-1)] px-2 py-1">
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

      {/* Per-pane reference symbol — independent across panes so the user
          can compare the primary stock against multiple relative tickers
          in different panes (e.g. AAPL vs SPY, AAPL vs QQQ, AAPL vs XLK). */}
      <span className="ml-1 text-[10px] text-[var(--text-3)]">vs</span>
      <input
        type="text"
        value={inputFocused ? refInput : refSymbol}
        aria-label={`Reference symbol for pane ${paneId}`}
        placeholder="SPY"
        onChange={(e) => setRefInput(e.target.value.toUpperCase())}
        onFocus={() => setInputFocused(true)}
        onBlur={() => { setInputFocused(false); submit(); }}
        onKeyDown={handleKeyDown}
        className={`w-[64px] rounded border border-[var(--border)] bg-[var(--bg-0)] px-1.5 py-0.5 text-center font-mono text-[10px] font-bold text-[#6ee884] outline-none transition-all focus:border-[var(--clr-cyan)] ${
          refResolving ? "animate-pulse" : ""
        }`}
      />

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
