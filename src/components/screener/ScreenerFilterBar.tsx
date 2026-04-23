/**
 * ScreenerFilterBar — Preset selector + IBKR native filter pills + scan button
 *
 * Layout:
 *   Row 1: [Preset Dropdown] | [Quick-pick chips] | [+ Add Filter ▾] [Clear] | [AI] [Scan]
 *   Filter pills appear inline after quick-picks / add button.
 *
 * Filters are IBKR native scanner filter codes (code/value pairs).
 * Categories and codes come from GET /screener/filter-catalogue — no hardcoded local list.
 *
 * Quick-pick chips: the 5 `popular=true` catalogue entries — one click opens a
 * compact value input and adds the filter directly to the bar.
 *
 * Preset grouping: popular presets at the top, niche ("More screens") below.
 */

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, Play, Loader2, ChevronDown, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type FilterCatalogueEntry } from "@/lib/api";
import { useScreenerStore, type ActiveFilter } from "@/store/screener";
import { PresetSkeleton } from "./ScreenerSkeleton";
import NumericFilterInput from "./NumericFilterInput";

// ── Helpers ───────────────────────────────────────────────────

const CAT_LABELS: Record<string, string> = {
  fundamental: "Fundamental",
  technical: "Technical",
  analyst: "Analyst",
  short_ownership: "Short Interest",
};

/** Category order for the Add Filter dropdown */
const CAT_ORDER = ["fundamental", "technical", "analyst", "short_ownership"];

/** Build a human-readable display label for a filter value */
function buildLabel(entry: FilterCatalogueEntry, value: string, direction: "above" | "below") {
  const arrow = direction === "above" ? "≥" : "≤";
  const unitSuffix = entry.unit ? ` ${entry.unit}` : "";
  return `${entry.label} ${arrow} ${value}${unitSuffix}`;
}

// ── Active filter pill ────────────────────────────────────────
// Clicking the pill opens a compact popover pre-filled with the current value,
// so users can tweak a threshold without removing + re-adding.
// The catalogue `entry` is looked up by the parent via filter.code and passed
// down — when it's missing (AI-suggested code not in our catalogue, rare) the
// pill falls back to read-only mode with just the remove button.

function FilterPill({
  filter,
  entry,
  onRemove,
  onUpdate,
}: {
  filter: ActiveFilter;
  entry: FilterCatalogueEntry | undefined;
  onRemove: () => void;
  onUpdate: (value: string, display_label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(filter.value);
  const ref = useRef<HTMLDivElement>(null);

  // Keep local input in sync if the filter is reset externally
  useEffect(() => {
    setValue(filter.value);
  }, [filter.value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const direction: "above" | "below" = entry?.direction ?? "above";

  const handleSave = () => {
    if (!entry || !value) return;
    onUpdate(value, buildLabel(entry, value, direction));
    setOpen(false);
  };

  // If we don't have the catalogue entry, render a non-editable pill
  // (still removable) so we never lose the user's filter.
  if (!entry) {
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

  return (
    <div ref={ref} className="relative">
      <span
        className={`group flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-data text-[10px] font-medium transition-colors ${
          open
            ? "border-[var(--clr-cyan)] bg-[var(--clr-cyan)]/20 text-[var(--clr-cyan)]"
            : "border-[var(--clr-cyan)]/40 bg-[var(--glow-cyan)] text-[var(--clr-cyan)] hover:border-[var(--clr-cyan)]"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="cursor-pointer text-left"
          title={entry.description ?? `Click to edit ${entry.label}`}
          aria-label={`Edit filter: ${filter.display_label}`}
          aria-expanded={open}
        >
          {filter.display_label}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--clr-red)]"
          aria-label={`Remove filter: ${filter.display_label}`}
        >
          <X size={10} />
        </button>
      </span>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] p-2.5 shadow-xl">
          <p className="mb-1.5 text-[10px] font-medium text-[var(--text-2)]">
            {entry.label}&nbsp;{direction === "above" ? "≥" : "≤"}
          </p>
          <div className="flex items-center gap-1.5">
            <NumericFilterInput
              value={value}
              onChange={setValue}
              onEnter={handleSave}
              onEscape={() => setOpen(false)}
              className="w-24 rounded border border-[var(--border)] bg-[var(--bg-3)] px-2 py-1 font-data text-[11px] text-[var(--text-1)] outline-none focus:border-[var(--clr-cyan)]"
              autoFocus
            />
            {entry.unit && (
              <span className="text-[10px] text-[var(--text-3)]">{entry.unit}</span>
            )}
            <button
              type="button"
              onClick={handleSave}
              className="rounded bg-[var(--clr-cyan)]/20 px-2 py-1 text-[10px] font-medium text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/30"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quick-pick chip ───────────────────────────────────────────
// One chip per popular=true catalogue entry. Clicking opens a compact
// inline value input — no category/filter navigation needed.

function QuickPickChip({
  entry,
  onAdd,
}: {
  entry: FilterCatalogueEntry;
  onAdd: (filter: ActiveFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(entry.example);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    setValue(entry.example);
    setOpen(true);
  };

  const handleAdd = () => {
    if (!value) return;
    const filter: ActiveFilter = {
      id: `${entry.code}-${Date.now()}`,
      code: entry.code,
      value,
      display_label: buildLabel(entry, value, entry.direction),
    };
    onAdd(filter);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="rounded-full border border-dashed border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--text-3)] transition-colors hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
      >
        {entry.label}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] p-2.5 shadow-xl">
          <p className="mb-1.5 text-[10px] font-medium text-[var(--text-2)]">
            {entry.label}&nbsp;{entry.direction === "above" ? "≥" : "≤"}
          </p>
          <div className="flex items-center gap-1.5">
            <NumericFilterInput
              value={value}
              onChange={setValue}
              onEnter={handleAdd}
              onEscape={() => setOpen(false)}
              className="w-24 rounded border border-[var(--border)] bg-[var(--bg-3)] px-2 py-1 font-data text-[11px] text-[var(--text-1)] outline-none focus:border-[var(--clr-cyan)]"
              autoFocus
            />
            {entry.unit && (
              <span className="text-[10px] text-[var(--text-3)]">{entry.unit}</span>
            )}
            <button
              onClick={handleAdd}
              className="rounded bg-[var(--clr-cyan)]/20 px-2 py-1 text-[10px] font-medium text-[var(--clr-cyan)] transition-colors hover:bg-[var(--clr-cyan)]/30"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add filter dropdown ───────────────────────────────────────
// Three-column panel: category → filter (above-direction entries only) → value + direction toggle.
// Catalogue is fetched once by the parent and passed as a prop.

interface SelectedEntry {
  entry: FilterCatalogueEntry;
  /** below entry from the catalogue (undefined if paired_code is empty) */
  belowEntry?: FilterCatalogueEntry;
}

function AddFilterDropdown({
  catalogue,
  onAdd,
}: {
  catalogue: FilterCatalogueEntry[];
  onAdd: (filter: ActiveFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedEntry | null>(null);
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Only show "above"-direction entries as primary list items to avoid duplicates.
  // below entries are looked up via paired_code when building the value form.
  const primaryByCat = CAT_ORDER.reduce<Record<string, FilterCatalogueEntry[]>>((acc, cat) => {
    acc[cat] = catalogue.filter((e) => e.category === cat && e.direction === "above");
    return acc;
  }, {});

  const handleOpen = () => {
    setOpen(true);
    setSelectedCat(null);
    setSelected(null);
    setValue("");
    setDirection("above");
  };

  const handleSelectEntry = (entry: FilterCatalogueEntry) => {
    const belowEntry = entry.paired_code
      ? catalogue.find((e) => e.code === entry.paired_code)
      : undefined;
    setSelected({ entry, belowEntry });
    setValue(entry.example);
    setDirection("above");
  };

  const handleAdd = () => {
    if (!selected || !value) return;
    const activeEntry = direction === "above" ? selected.entry : selected.belowEntry;
    if (!activeEntry) return;

    const filter: ActiveFilter = {
      id: `${activeEntry.code}-${Date.now()}`,
      code: activeEntry.code,
      value,
      display_label: buildLabel(selected.entry, value, direction),
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
          {CAT_ORDER.map((cat) => (
            <button
              key={cat}
              onClick={() => { setSelectedCat(cat); setSelected(null); }}
              className={`px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--bg-3)] ${
                selectedCat === cat
                  ? "text-[var(--clr-cyan)] font-medium"
                  : "text-[var(--text-2)]"
              }`}
            >
              {CAT_LABELS[cat] ?? cat}
            </button>
          ))}
        </div>

        {/* Filter list */}
        {selectedCat && (
          <div className="flex min-w-[190px] flex-col py-1 border-r border-[var(--border)] overflow-y-auto max-h-60">
            {(primaryByCat[selectedCat] ?? []).map((e) => (
              <button
                key={e.code}
                onClick={() => handleSelectEntry(e)}
                title={e.description ?? undefined}
                className={`px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--bg-3)] ${
                  selected?.entry.code === e.code
                    ? "text-[var(--clr-cyan)] font-medium"
                    : "text-[var(--text-2)]"
                }`}
              >
                {e.label}
                {e.unit && (
                  <span className="ml-1 text-[9px] text-[var(--text-3)]">({e.unit})</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Value input form */}
        {selected && (
          <div className="flex min-w-[200px] flex-col gap-2 p-3">
            <p className="text-[11px] font-medium text-[var(--text-1)]">
              {selected.entry.label}
            </p>

            {/* Direction toggle — only when paired_code exists */}
            {selected.belowEntry && (
              <div className="flex overflow-hidden rounded-md border border-[var(--border)] text-[10px]">
                <button
                  onClick={() => setDirection("above")}
                  className={`flex-1 py-1 transition-colors ${
                    direction === "above"
                      ? "bg-[var(--clr-cyan)]/20 font-medium text-[var(--clr-cyan)]"
                      : "text-[var(--text-3)] hover:bg-[var(--bg-3)]"
                  }`}
                >
                  ≥ Above
                </button>
                <button
                  onClick={() => setDirection("below")}
                  className={`flex-1 py-1 transition-colors ${
                    direction === "below"
                      ? "bg-[var(--clr-cyan)]/20 font-medium text-[var(--clr-cyan)]"
                      : "text-[var(--text-3)] hover:bg-[var(--bg-3)]"
                  }`}
                >
                  ≤ Below
                </button>
              </div>
            )}

            {/* Value input */}
            <div className="flex items-center gap-1">
              <NumericFilterInput
                value={value}
                onChange={setValue}
                onEnter={handleAdd}
                placeholder={selected.entry.example}
                className="w-full rounded border border-[var(--border)] bg-[var(--bg-3)] px-2 py-1 font-data text-[11px] text-[var(--text-1)] outline-none focus:border-[var(--clr-cyan)]"
                autoFocus
              />
              {selected.entry.unit && (
                <span className="text-[10px] text-[var(--text-3)]">{selected.entry.unit}</span>
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
  aiPanelOpen = false,
  onToggleAiPanel,
  onClearResults,
  showClearResults = false,
}: {
  onScan: () => void;
  aiPanelOpen?: boolean;
  onToggleAiPanel?: () => void;
  /** Parent supplies the reset side-effects (store reset + scanMutation.reset). */
  onClearResults?: () => void;
  /** Show the Clear Results button (results exist or there is a scan error). */
  showClearResults?: boolean;
}) {
  const {
    filters,
    selectedPreset,
    isScanning,
    results,
    isDirty,
    addFilter,
    updateFilter,
    removeFilter,
    clearFilters,
    setPreset,
  } = useScreenerStore();

  const { data: presets, isLoading: presetsLoading } = useQuery({
    queryKey: ["screener-presets"],
    queryFn: () => api.screenerPresets(),
    staleTime: 60_000 * 60,
  });

  const { data: catalogue = [] } = useQuery({
    queryKey: ["screener-filter-catalogue"],
    queryFn: () => api.screenerFilterCatalogue(),
    staleTime: Infinity, // catalogue is static
  });

  const popularChips = catalogue.filter((e) => e.popular);

  const presetKey = selectedPreset
    ? `${selectedPreset.instrument}:${selectedPreset.scan_type}:${selectedPreset.location}`
    : "";

  const popularPresets = presets?.filter((p) => p.category === "popular") ?? [];
  const nichePresets = presets?.filter((p) => p.category === "niche") ?? [];

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const preset = presets?.find(
      (p) => `${p.instrument}:${p.scan_type}:${p.location}` === e.target.value
    );
    if (preset) setPreset(preset);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-[var(--bg-1)] px-4 py-2.5">
      {/* Section label */}
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
        Screener
      </span>

      {/* Grouped preset selector */}
      {presetsLoading ? (
        <PresetSkeleton />
      ) : (
        <select
          value={presetKey}
          onChange={handlePresetChange}
          className="rounded-md border border-[var(--border)] bg-[var(--bg-2)] px-2.5 py-1 font-data text-[11px] text-[var(--text-1)] outline-none transition-colors focus:border-[var(--clr-cyan)]"
        >
          <option value="">Select preset…</option>
          {popularPresets.length > 0 && (
            <optgroup label="Popular">
              {popularPresets.map((p) => (
                <option
                  key={`${p.instrument}:${p.scan_type}:${p.location}:${p.display_name}`}
                  value={`${p.instrument}:${p.scan_type}:${p.location}`}
                >
                  {p.display_name}
                  {p.subtitle ? ` — ${p.subtitle}` : ""}
                </option>
              ))}
            </optgroup>
          )}
          {nichePresets.length > 0 && (
            <optgroup label="More screens">
              {nichePresets.map((p) => (
                <option
                  key={`${p.instrument}:${p.scan_type}:${p.location}:${p.display_name}`}
                  value={`${p.instrument}:${p.scan_type}:${p.location}`}
                >
                  {p.display_name}
                  {p.subtitle ? ` — ${p.subtitle}` : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}

      {/* Preset subtitle hint (e.g. "Pre-market only") — explains why a scan
          may legitimately return 0 rows outside its operating window. */}
      {selectedPreset?.subtitle && (
        <span
          data-testid="preset-subtitle"
          className="rounded-full bg-[var(--bg-2)] border border-[var(--border)] px-2 py-0.5 text-[10px] italic text-[var(--text-3)]"
        >
          {selectedPreset.subtitle}
        </span>
      )}

      {/* Separator */}
      <div className="h-4 w-px bg-[var(--border)]" />

      {/* Quick-pick chips (popular catalogue entries) */}
      {popularChips.map((entry) => (
        <QuickPickChip key={entry.code} entry={entry} onAdd={addFilter} />
      ))}

      {/* Separator */}
      {popularChips.length > 0 && <div className="h-4 w-px bg-[var(--border)]" />}

      {/* Add filter dropdown (full catalogue) */}
      <AddFilterDropdown catalogue={catalogue} onAdd={addFilter} />

      {/* Active filter pills */}
      {filters.map((f) => (
        <FilterPill
          key={f.id}
          filter={f}
          entry={catalogue.find((e) => e.code === f.code)}
          onRemove={() => removeFilter(f.id)}
          onUpdate={(value, display_label) => updateFilter(f.id, value, display_label)}
        />
      ))}

      {/* Clear filters (in-place — keeps results visible) */}
      {filters.length > 0 && (
        <button
          onClick={clearFilters}
          title="Remove all filters (keeps current results)"
          className="flex items-center gap-1 text-[10px] text-[var(--text-3)] transition-colors hover:text-[var(--clr-red)]"
        >
          <RotateCcw size={10} />
          Clear
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear results — wipes results + preset + filters so the empty-state cards reappear */}
      {showClearResults && onClearResults && (
        <button
          onClick={onClearResults}
          title="Clear results and return to the start screen"
          className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--clr-red)] hover:text-[var(--clr-red)]"
        >
          <RotateCcw size={12} />
          Clear results
        </button>
      )}

      {/* AI panel toggle */}
      {onToggleAiPanel && (
        <button
          onClick={onToggleAiPanel}
          title={aiPanelOpen ? "Hide AI Filters" : "AI Filters"}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
            aiPanelOpen
              ? "border-[var(--clr-cyan)]/40 bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)]"
              : "border-[var(--border)] text-[var(--text-3)] hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)]"
          }`}
        >
          <Sparkles size={12} />
          AI
        </button>
      )}

      {/* Scan button
          When the user has existing results AND has since changed filters/preset
          without rescanning, we show a small amber pulse so the current results
          can't be mistaken for the latest criteria. */}
      <div className="relative">
        <Button
          size="sm"
          onClick={onScan}
          disabled={isScanning || !selectedPreset}
          title={
            isDirty && results.length > 0
              ? "Filters changed — press Scan to refresh results"
              : undefined
          }
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
        {isDirty && results.length > 0 && !isScanning && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-1 -top-1 flex h-2.5 w-2.5"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--clr-orange)] opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--clr-orange)]" />
          </span>
        )}
      </div>
    </div>
  );
}
