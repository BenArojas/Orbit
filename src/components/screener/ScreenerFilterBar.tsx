/**
 * ScreenerFilterBar — Preset selector + IBKR native filter pills + scan button
 *
 * Layout: [Preset Dropdown] | [+ Add Filter ▾] [Filter Pills...] [Clear] | [Scan]
 *
 * Filters are IBKR native scanner filter codes (code/value pairs).
 * Grouped by category: Fundamental, Technical, Analyst, Short Interest.
 */

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, Play, Loader2, ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useScreenerStore, type ActiveFilter } from "@/store/screener";
import { PresetSkeleton } from "./ScreenerSkeleton";

// ── Filter catalogue ─────────────────────────────────────────

interface FilterDef {
  label: string;
  aboveCode: string;
  belowCode: string;
  unit?: string;         // Display unit (e.g. "$B", "%")
  placeholder?: string;  // Input placeholder
}

interface FilterCategory {
  label: string;
  filters: FilterDef[];
}

const FILTER_CATEGORIES: FilterCategory[] = [
  {
    label: "Fundamental",
    filters: [
      { label: "Market Cap", aboveCode: "marketCapAbove1e6", belowCode: "marketCapBelow1e6", unit: "$M", placeholder: "1000" },
      { label: "P/E Ratio", aboveCode: "minPeRatio", belowCode: "maxPeRatio", placeholder: "15" },
      { label: "ROE", aboveCode: "minROE", belowCode: "maxROE", unit: "%", placeholder: "15" },
      { label: "Operating Margin TTM", aboveCode: "minOperatingMargin", belowCode: "maxOperatingMargin", unit: "%", placeholder: "10" },
      { label: "Net Margin TTM", aboveCode: "minNetMargin", belowCode: "maxNetMargin", unit: "%", placeholder: "5" },
      { label: "Revenue Chg TTM", aboveCode: "minRevenueChangePercentTTM", belowCode: "maxRevenueChangePercentTTM", unit: "%", placeholder: "10" },
      { label: "Revenue Growth 5Y", aboveCode: "minRevenuePctChange5Y", belowCode: "maxRevenuePctChange5Y", unit: "%", placeholder: "10" },
      { label: "EPS Chg TTM", aboveCode: "minEpsChangePercent", belowCode: "maxEpsChangePercent", unit: "%", placeholder: "10" },
      { label: "Price/Book", aboveCode: "minPriceBook", belowCode: "maxPriceBook", placeholder: "1" },
      { label: "Quick Ratio", aboveCode: "minQuickRatio", belowCode: "maxQuickRatio", placeholder: "1" },
      { label: "Earnings Within (days)", aboveCode: "wshEarningsDate", belowCode: "wshEarningsDate", unit: "days", placeholder: "5" },
    ],
  },
  {
    label: "Technical",
    filters: [
      { label: "Price", aboveCode: "priceAbove", belowCode: "priceBelow", unit: "$", placeholder: "10" },
      { label: "Day Change %", aboveCode: "changePercAbove", belowCode: "changePercBelow", unit: "%", placeholder: "3" },
      { label: "Volume vs Avg", aboveCode: "volumeAbove", belowCode: "volumeBelow", placeholder: "1000000" },
      { label: "Price vs EMA(20) %", aboveCode: "priceVsEMA20Above", belowCode: "priceVsEMA20Below", unit: "%", placeholder: "5" },
      { label: "Price vs EMA(50) %", aboveCode: "priceVsEMA50Above", belowCode: "priceVsEMA50Below", unit: "%", placeholder: "5" },
      { label: "Price vs EMA(200) %", aboveCode: "priceVsEMA200Above", belowCode: "priceVsEMA200Below", unit: "%", placeholder: "5" },
      { label: "MACD Histogram", aboveCode: "macdHistAbove", belowCode: "macdHistBelow", placeholder: "0" },
      { label: "IV Rank 52W", aboveCode: "ivRankAbove", belowCode: "ivRankBelow", unit: "%", placeholder: "50" },
    ],
  },
  {
    label: "Analyst",
    filters: [
      { label: "Avg Rating", aboveCode: "avgRatingAbove", belowCode: "avgRatingBelow", placeholder: "3" },
      { label: "# Analyst Ratings", aboveCode: "numRatingsAbove", belowCode: "numRatingsBelow", placeholder: "5" },
      { label: "Avg Price Target", aboveCode: "avgTargetPriceAbove", belowCode: "avgTargetPriceBelow", unit: "$", placeholder: "50" },
      { label: "Target/Price Ratio", aboveCode: "targetPriceRatioAbove", belowCode: "targetPriceRatioBelow", placeholder: "1.1" },
    ],
  },
  {
    label: "Short Interest",
    filters: [
      { label: "Utilization", aboveCode: "shortableSharesAbove", belowCode: "shortableSharesBelow", unit: "%", placeholder: "50" },
      { label: "Borrow Fee Rate", aboveCode: "rebateRateAbove", belowCode: "rebateRateBelow", unit: "%", placeholder: "1" },
      { label: "Insider % of Float", aboveCode: "insiderOwnershipAbove", belowCode: "insiderOwnershipBelow", unit: "%", placeholder: "10" },
      { label: "Institutional % of Float", aboveCode: "institutionalOwnershipAbove", belowCode: "institutionalOwnershipBelow", unit: "%", placeholder: "50" },
    ],
  },
];

// Flat lookup: code → label (for display in pill)
const CODE_TO_LABEL: Record<string, string> = {};
for (const cat of FILTER_CATEGORIES) {
  for (const f of cat.filters) {
    CODE_TO_LABEL[f.aboveCode] = `${f.label} ≥`;
    CODE_TO_LABEL[f.belowCode] = `${f.label} ≤`;
  }
}

// ── Active filter pill ────────────────────────────────────────

function FilterPill({
  filter,
  onRemove,
}: {
  filter: ActiveFilter;
  onRemove: () => void;
}) {
  return (
    <span className="group flex items-center gap-1.5 rounded-full border border-[var(--clr-cyan)]/40 bg-[var(--glow-cyan)] px-2.5 py-1 font-data text-[10px] font-medium text-[var(--clr-cyan)]">
      <span>{filter.display_label}</span>
      <button
        onClick={onRemove}
        className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--clr-red)]"
        aria-label={`Remove filter: ${filter.display_label}`}
      >
        <X size={10} />
      </button>
    </span>
  );
}

// ── Add filter dropdown + form ────────────────────────────────

function AddFilterDropdown({ onAdd }: { onAdd: (filter: ActiveFilter) => void }) {
  const [open, setOpen] = useState(false);
  const [selectedCat, setSelectedCat] = useState<FilterCategory | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<FilterDef | null>(null);
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    setOpen(true);
    setSelectedCat(null);
    setSelectedFilter(null);
    setValue("");
    setDirection("above");
  };

  const handleSelectFilter = (cat: FilterCategory, filter: FilterDef) => {
    setSelectedCat(cat);
    setSelectedFilter(filter);
    setValue(filter.placeholder ?? "");
  };

  const handleAdd = () => {
    if (!selectedFilter || value === "") return;
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return;

    const code = direction === "above" ? selectedFilter.aboveCode : selectedFilter.belowCode;
    const dirLabel = direction === "above" ? "≥" : "≤";
    const unitSuffix = selectedFilter.unit ? ` ${selectedFilter.unit}` : "";
    const displayLabel = `${selectedFilter.label} ${dirLabel} ${parsed}${unitSuffix}`;

    const filter: ActiveFilter = {
      id: `${code}-${Date.now()}`,
      code,
      value: String(parsed),
      display_label: displayLabel,
    };
    onAdd(filter);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
      >
        <Plus size={10} />
        Add Filter
        <ChevronDown size={10} />
      </button>
    );
  }

  return (
    <div ref={ref} className="relative z-10">
      {/* Trigger (open state) */}
      <button
        onClick={() => setOpen(false)}
        className="flex items-center gap-1 rounded-full border border-[var(--clr-cyan)]/40 bg-[var(--glow-cyan)] px-2.5 py-1 text-[10px] font-medium text-[var(--clr-cyan)]"
      >
        <Plus size={10} />
        Add Filter
        <ChevronDown size={10} />
      </button>

      {/* Dropdown panel */}
      <div className="absolute left-0 top-full mt-1 flex gap-0 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] shadow-xl">
        {/* Category list */}
        <div className="flex min-w-[140px] flex-col border-r border-[var(--border)] py-1">
          {FILTER_CATEGORIES.map((cat) => (
            <button
              key={cat.label}
              onClick={() => { setSelectedCat(cat); setSelectedFilter(null); }}
              className={`px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--bg-3)] ${
                selectedCat?.label === cat.label
                  ? "text-[var(--clr-cyan)] font-medium"
                  : "text-[var(--text-2)]"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Filter list */}
        {selectedCat && (
          <div className="flex min-w-[180px] flex-col py-1 border-r border-[var(--border)]">
            {selectedCat.filters.map((f) => (
              <button
                key={f.aboveCode}
                onClick={() => handleSelectFilter(selectedCat, f)}
                className={`px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--bg-3)] ${
                  selectedFilter?.aboveCode === f.aboveCode
                    ? "text-[var(--clr-cyan)] font-medium"
                    : "text-[var(--text-2)]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* Value input form */}
        {selectedFilter && (
          <div className="flex min-w-[200px] flex-col gap-2 p-3">
            <p className="text-[11px] font-medium text-[var(--text-1)]">
              {selectedFilter.label}
            </p>

            {/* Direction toggle */}
            <div className="flex rounded-md border border-[var(--border)] overflow-hidden text-[10px]">
              <button
                onClick={() => setDirection("above")}
                className={`flex-1 py-1 transition-colors ${
                  direction === "above"
                    ? "bg-[var(--clr-cyan)]/20 text-[var(--clr-cyan)] font-medium"
                    : "text-[var(--text-3)] hover:bg-[var(--bg-3)]"
                }`}
              >
                ≥ Above
              </button>
              <button
                onClick={() => setDirection("below")}
                className={`flex-1 py-1 transition-colors ${
                  direction === "below"
                    ? "bg-[var(--clr-cyan)]/20 text-[var(--clr-cyan)] font-medium"
                    : "text-[var(--text-3)] hover:bg-[var(--bg-3)]"
                }`}
              >
                ≤ Below
              </button>
            </div>

            {/* Value input */}
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder={selectedFilter.placeholder ?? "0"}
                className="w-full rounded border border-[var(--border)] bg-[var(--bg-3)] px-2 py-1 font-data text-[11px] text-[var(--text-1)] outline-none focus:border-[var(--clr-cyan)]"
                autoFocus
              />
              {selectedFilter.unit && (
                <span className="text-[10px] text-[var(--text-3)]">{selectedFilter.unit}</span>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-1.5">
              <button
                onClick={handleAdd}
                className="flex-1 rounded bg-[var(--clr-cyan)]/20 py-1 text-[10px] font-medium text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/30"
              >
                Add
              </button>
              <button
                onClick={() => setOpen(false)}
                className="px-2 py-1 text-[10px] text-[var(--text-3)] transition-colors hover:text-[var(--text-1)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function ScreenerFilterBar({
  onScan,
}: {
  onScan: () => void;
}) {
  const {
    filters,
    selectedPreset,
    isScanning,
    scannerSort,
    addFilter,
    removeFilter,
    clearFilters,
    setPreset,
    setScannerSort,
  } = useScreenerStore();

  const { data: presets, isLoading: presetsLoading } = useQuery({
    queryKey: ["screener-presets"],
    queryFn: () => api.screenerPresets(),
    staleTime: 60_000 * 60,
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
      {presetsLoading ? (
        <PresetSkeleton />
      ) : (
        <select
          value={presetKey}
          onChange={handlePresetChange}
          className="rounded-md border border-[var(--border)] bg-[var(--bg-2)] px-2.5 py-1 font-data text-[11px] text-[var(--text-1)] outline-none transition-colors focus:border-[var(--clr-cyan)]"
        >
          <option value="">Select preset…</option>
          {presets?.map((p) => (
            <option
              key={`${p.instrument}:${p.scan_type}:${p.location}:${p.display_name}`}
              value={`${p.instrument}:${p.scan_type}:${p.location}`}
            >
              {p.display_name}
            </option>
          ))}
        </select>
      )}

      {/* Scanner sort (server-side) */}
      <select
        value={scannerSort.field}
        onChange={(e) =>
          setScannerSort({ field: e.target.value, direction: scannerSort.direction })
        }
        className="rounded-md border border-[var(--border)] bg-[var(--bg-2)] px-2 py-1 font-data text-[10px] text-[var(--text-2)] outline-none transition-colors focus:border-[var(--clr-cyan)]"
      >
        <option value="">Sort: Default</option>
        <option value="changePercAbove">Sort: Chg%</option>
        <option value="volumeAbove">Sort: Volume</option>
        <option value="marketCapAbove1e6">Sort: Mkt Cap</option>
        <option value="priceAbove">Sort: Price</option>
        <option value="minPeRatio">Sort: P/E</option>
      </select>

      {/* Sort direction toggle */}
      {scannerSort.field && (
        <button
          onClick={() =>
            setScannerSort({
              field: scannerSort.field,
              direction: scannerSort.direction === "desc" ? "asc" : "desc",
            })
          }
          className="rounded border border-[var(--border)] px-1.5 py-1 font-data text-[10px] text-[var(--text-3)] transition-colors hover:text-[var(--text-1)]"
        >
          {scannerSort.direction === "desc" ? "↓ Desc" : "↑ Asc"}
        </button>
      )}

      {/* Separator */}
      <div className="h-4 w-px bg-[var(--border)]" />

      {/* Add filter dropdown */}
      <AddFilterDropdown onAdd={addFilter} />

      {/* Active filter pills */}
      {filters.map((f) => (
        <FilterPill
          key={f.id}
          filter={f}
          onRemove={() => removeFilter(f.id)}
        />
      ))}

      {/* Clear all */}
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
        className="gap-1.5 border-[var(--clr-cyan)]/30 bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)] hover:bg-[var(--clr-cyan)]/25 disabled:opacity-40"
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
