/**
 * CompareModeHeader — Bar at the top of Compare Mode.
 *
 *   Compare:  AAPL (read-only)  vs  [SPY ▾] (editable)        + Add pane    ✕ Exit
 *
 * The primary stock is read-only inside compare mode — to swap stocks
 * the user must exit (or click a watchlist row, which AnalysisPage
 * handles by force-exiting + switching).
 *
 * The reference input resolves via api.resolveConid on Enter or blur.
 * On mount, if the reference has no conid yet (first entry or post-
 * rehydrate), we kick off resolution immediately.
 */

import { useEffect, useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useChartStore } from "@/store/chart";
import { useCompareStore, MAX_PANES } from "@/store/compare";

export default function CompareModeHeader() {
  const activeSymbol = useChartStore((s) => s.activeSymbol);
  const reference = useCompareStore((s) => s.reference);
  const panes = useCompareStore((s) => s.panes);
  const setReference = useCompareStore((s) => s.setReference);
  const setReferenceSymbol = useCompareStore((s) => s.setReferenceSymbol);
  const addPane = useCompareStore((s) => s.addPane);
  const exit = useCompareStore((s) => s.exit);

  const [refInput, setRefInput] = useState(reference.symbol);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (!inputFocused) setRefInput(reference.symbol);
  }, [reference.symbol, inputFocused]);

  const resolveMutation = useMutation({
    mutationFn: (sym: string) => api.resolveConid(sym),
    onSuccess: (result) => {
      setReference(result.symbol, result.conid);
    },
    onError: (_err, sym) => {
      const isAutoResolveFallback = sym === reference.symbol && reference.conid == null;
      if (isAutoResolveFallback) {
        toast.error(`Reference symbol unresolvable: ${sym} — falling back to SPY`);
        setReferenceSymbol("SPY");
      } else {
        toast.error(`Reference symbol not found: ${sym}`);
        setRefInput(reference.symbol);
      }
    },
  });

  // Auto-resolve on mount whenever the reference is missing a conid.
  useEffect(() => {
    if (reference.conid == null && !resolveMutation.isPending) {
      resolveMutation.mutate(reference.symbol);
    }
    // intentionally only on mount + symbol change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference.symbol]);

  const submit = () => {
    const sym = refInput.trim().toUpperCase();
    if (!sym || sym === reference.symbol) {
      setRefInput(reference.symbol);
      return;
    }
    resolveMutation.mutate(sym);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") setRefInput(reference.symbol);
  };

  const atPaneCap = panes.length >= MAX_PANES;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-1)] px-3 py-2 text-[12px]">
      <span className="text-[var(--text-3)]">Compare:</span>
      <span className="rounded bg-[var(--bg-3)] px-2 py-0.5 font-mono text-[11px] font-bold text-foreground">
        {activeSymbol || "—"}
      </span>
      <span className="text-[var(--text-3)]">vs</span>
      <input
        type="text"
        value={inputFocused ? refInput : reference.symbol}
        aria-label="Reference symbol"
        placeholder="SPY"
        onChange={(e) => setRefInput(e.target.value.toUpperCase())}
        onFocus={() => setInputFocused(true)}
        onBlur={() => { setInputFocused(false); submit(); }}
        onKeyDown={handleKeyDown}
        className={`w-[80px] rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 py-0.5 text-center font-mono text-[11px] font-bold text-[#6ee884] outline-none transition-all focus:border-[var(--clr-cyan)] ${
          resolveMutation.isPending ? "animate-pulse" : ""
        }`}
      />

      <div className="ml-auto flex items-center gap-2">
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
