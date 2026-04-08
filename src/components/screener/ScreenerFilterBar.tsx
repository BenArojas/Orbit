/**
 * ScreenerFilterBar — Preset selector + indicator filter pills + scan button
 *
 * Layout: [Preset Dropdown] [Filter Pills...] [+ Add Filter] [Scan Button]
 * Each filter pill shows indicator + condition + value, toggleable/removable.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, Play, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useScreenerStore, type ScreenerFilter, type FilterOp } from "@/store/screener";

// ── Indicator options for the filter dropdown ──────────────

const INDICATOR_OPTIONS = [
  { value: "rsi", label: "RSI", color: "purple" },
  { value: "ema_50", label: "EMA 50", color: "cyan" },
  { value: "ema_200", label: "EMA 200", color: "blue" },
  { value: "macd", label: "MACD", color: "orange" },
  { value: "macd_histogram", label: "MACD Hist", color: "orange" },
  { value: "volume", label: "Volume", color: "cyan" },
  { value: "price", label: "Price", color: "green" },
  { value: "change_percent", label: "Change %", color: "green" },
  { value: "atr", label: "ATR", color: "blue" },
  { value: "adx", label: "ADX", color: "purple" },
  { value: "obv", label: "OBV", color: "cyan" },
  { value: "stoch", label: "Stochastic", color: "orange" },
  { value: "bbands", label: "Bollinger", color: "blue" },
] as const;

const OP_LABELS: Record<FilterOp, string> = {
  gt: ">",
  lt: "<",
  between: "↔",
  cross_above: "↑×",
  cross_below: "↓×",
};

// ── Filter pill (inline, toggleable, removable) ────────────

function FilterPill({
  filter,
  onToggle,
  onRemove,
}: {
  filter: ScreenerFilter;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const ind = INDICATOR_OPTIONS.find((o) => o.value === filter.indicator);
  const color = ind?.color ?? "cyan";
  const label = ind?.label ?? filter.indicator;
  const opLabel = OP_LABELS[filter.op] ?? filter.op;

  const valueStr =
    filter.op === "between"
      ? `${filter.value}–${filter.value2 ?? "?"}`
      : `${filter.value}`;

  return (
    <button
      onClick={onToggle}
      className="group flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-data text-[10px] font-medium transition-all duration-150"
      style={
        filter.enabled
          ? {
              borderColor: `var(--clr-${color})`,
              color: `var(--clr-${color})`,
              background: `var(--glow-${color})`,
              boxShadow: `0 0 6px var(--glow-${color})`,
            }
          : {
              borderColor: "var(--border)",
              color: "var(--text-3)",
              background: "transparent",
              opacity: 0.5,
            }
      }
    >
      <span>{label}</span>
      <span className="opacity-60">{opLabel}</span>
      <span>{valueStr}</span>
      <span
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <X size={10} />
      </span>
    </button>
  );
}

// ── Add filter inline form ─────────────────────────────────

function AddFilterForm({ onAdd }: { onAdd: (f: ScreenerFilter) => void }) {
  const [open, setOpen] = useState(false);
  const [indicator, setIndicator] = useState("rsi");
  const [op, setOp] = useState<FilterOp>("gt");
  const [value, setValue] = useState("30");
  const [value2, setValue2] = useState("70");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
      >
        <Plus size={10} />
        Filter
      </button>
    );
  }

  const handleAdd = () => {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return;

    const filter: ScreenerFilter = {
      id: `${indicator}-${op}-${Date.now()}`,
      indicator,
      op,
      value: parsed,
      value2: op === "between" ? parseFloat(value2) || undefined : undefined,
      enabled: true,
    };
    onAdd(filter);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-[var(--clr-cyan)]/30 bg-[var(--bg-2)] px-2 py-1">
      <select
        value={indicator}
        onChange={(e) => setIndicator(e.target.value)}
        className="rounded bg-[var(--bg-3)] px-1.5 py-0.5 font-data text-[10px] text-[var(--text-1)] outline-none"
      >
        {INDICATOR_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={op}
        onChange={(e) => setOp(e.target.value as FilterOp)}
        className="rounded bg-[var(--bg-3)] px-1.5 py-0.5 font-data text-[10px] text-[var(--text-1)] outline-none"
      >
        <option value="gt">&gt;</option>
        <option value="lt">&lt;</option>
        <option value="between">Between</option>
        <option value="cross_above">Cross Above</option>
        <option value="cross_below">Cross Below</option>
      </select>

      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-16 rounded bg-[var(--bg-3)] px-1.5 py-0.5 font-data text-[10px] text-[var(--text-1)] outline-none"
        placeholder="Value"
      />

      {op === "between" && (
        <>
          <span className="text-[10px] text-[var(--text-3)]">–</span>
          <input
            type="number"
            value={value2}
            onChange={(e) => setValue2(e.target.value)}
            className="w-16 rounded bg-[var(--bg-3)] px-1.5 py-0.5 font-data text-[10px] text-[var(--text-1)] outline-none"
            placeholder="Max"
          />
        </>
      )}

      <button
        onClick={handleAdd}
        className="rounded bg-[var(--clr-cyan)]/20 px-2 py-0.5 text-[10px] font-medium text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/30"
      >
        Add
      </button>
      <button
        onClick={() => setOpen(false)}
        className="text-[var(--text-3)] hover:text-[var(--text-1)]"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────

export default function ScreenerFilterBar({
  onScan,
}: {
  onScan: () => void;
}) {
  const {
    filters,
    selectedPreset,
    isScanning,
    addFilter,
    removeFilter,
    toggleFilter,
    clearFilters,
    setPreset,
  } = useScreenerStore();

  // Fetch presets from backend
  const { data: presets } = useQuery({
    queryKey: ["screener-presets"],
    queryFn: () => api.screenerPresets(),
    staleTime: 60_000 * 60, // 1 hour — presets don't change
  });

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const preset = presets?.find(
      (p) => `${p.instrument}:${p.scan_type}:${p.location}` === e.target.value
    );
    if (preset) setPreset(preset);
  };

  const presetKey = selectedPreset
    ? `${selectedPreset.instrument}:${selectedPreset.scan_type}:${selectedPreset.location}`
    : "";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-[var(--bg-1)] px-4 py-2.5">
      {/* Section label */}
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
        Screener
      </span>

      {/* Preset selector */}
      <select
        value={presetKey}
        onChange={handlePresetChange}
        className="rounded-md border border-[var(--border)] bg-[var(--bg-2)] px-2.5 py-1 font-data text-[11px] text-[var(--text-1)] outline-none transition-colors focus:border-[var(--clr-cyan)]"
      >
        <option value="">Select preset…</option>
        {presets?.map((p) => (
          <option
            key={`${p.instrument}:${p.scan_type}:${p.location}`}
            value={`${p.instrument}:${p.scan_type}:${p.location}`}
          >
            {p.display_name}
          </option>
        ))}
      </select>

      {/* Separator */}
      <div className="h-4 w-px bg-[var(--border)]" />

      {/* Active filter pills */}
      {filters.map((f) => (
        <FilterPill
          key={f.id}
          filter={f}
          onToggle={() => toggleFilter(f.id)}
          onRemove={() => removeFilter(f.id)}
        />
      ))}

      {/* Add filter button/form */}
      <AddFilterForm onAdd={addFilter} />

      {/* Clear all filters */}
      {filters.length > 0 && (
        <button
          onClick={clearFilters}
          className="flex items-center gap-1 text-[10px] text-[var(--text-3)] transition-colors hover:text-[var(--clr-red)]"
        >
          <RotateCcw size={10} />
          Clear
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Scan button */}
      <Button
        size="sm"
        onClick={onScan}
        disabled={isScanning || !selectedPreset}
        className="gap-1.5 bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)] hover:bg-[var(--clr-cyan)]/25 border-[var(--clr-cyan)]/30 disabled:opacity-40"
      >
        {isScanning ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Scanning…
          </>
        ) : (
          <>
            <Play size={12} />
            Scan
          </>
        )}
      </Button>
    </div>
  );
}
