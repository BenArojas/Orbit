/**
 * BrowseAllScansPanel — slide-over with the FULL IBKR scan-type catalogue.
 *
 * Path C: power users get access to every scan type IBKR returns from
 * /iserver/scanner/params, organized into our 8 curated categories
 * (movers, highs_lows, pre_post_market, gaps, options_vol, fundamentals,
 * special, etfs) plus an "Other Scans" bucket for anything that doesn't
 * fit a curated category.
 *
 * Triggered from the "Browse all scans →" entry at the bottom of the
 * preset dropdown. Picking a row:
 *   1. Builds a synthetic ScannerPreset from the row (so the rest of the
 *      app treats it the same as a curated preset).
 *   2. Resets the location override to STK.US.MAJOR if the current
 *      override's instrument isn't in the picked scan's `instruments`
 *      array (and surfaces a banner via setLocationResetReason).
 *   3. PRESERVES the user's active filters — power users mid-flow
 *      shouldn't lose their pills.
 *   4. Closes the panel.
 *
 * Layout matches ScreenerPeekPanel: right-side overlay, 380px wide,
 * slide-in from right. Search filters across code + display_name.
 * Categories are collapsible (first one expanded by default).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, X, Sparkles, Search } from "lucide-react";
import {
  api,
  type ScannerPreset,
  type ScannerScanType,
} from "@/lib/api";
import {
  useScreenerStore,
  DEFAULT_LOCATION_CODE,
} from "@/store/screener";

// Category labels — must mirror backend/constants/scan_types.py CATEGORY_LABELS.
// Kept in code on the frontend (not fetched) because they're style/copy choices.
const CATEGORY_LABELS: Record<string, string> = {
  movers: "Movers",
  highs_lows: "Highs & Lows",
  pre_post_market: "Pre / Post Market",
  gaps: "Gaps",
  options_vol: "Options & Volatility",
  fundamentals: "Fundamentals",
  special: "Special Situations",
  etfs: "ETFs",
  other: "Other Scans",
};

const CATEGORY_ORDER = [
  "movers",
  "highs_lows",
  "pre_post_market",
  "gaps",
  "options_vol",
  "fundamentals",
  "special",
  "etfs",
  "other",
] as const;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the synthetic preset built from the picked scan. */
  onPick: (preset: ScannerPreset) => void;
}

/**
 * Build a synthetic ScannerPreset from a Browse-panel pick. The rest of
 * the app treats this exactly like a curated preset — it carries the
 * `instruments` array (for the location dropdown's compat filter) and a
 * `group` (so it slots into the "More screens" optgroup if the user later
 * looks at the dropdown).
 */
function scanTypeToPreset(scan: ScannerScanType): ScannerPreset {
  return {
    instrument: "STK",
    scan_type: scan.code,
    location: DEFAULT_LOCATION_CODE,
    display_name: scan.display_name,
    category: scan.is_curated ? "popular" : "niche",
    instruments: scan.instruments,
    group: scan.group,
  };
}

export default function BrowseAllScansPanel({ isOpen, onClose, onPick }: Props) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const locationOverride = useScreenerStore((s) => s.locationOverride);
  const setLocationOverride = useScreenerStore((s) => s.setLocationOverride);
  const setLocationResetReason = useScreenerStore(
    (s) => s.setLocationResetReason,
  );

  const { data: scans = [], isLoading } = useQuery({
    queryKey: ["screener-all-scan-types"],
    queryFn: () => api.screenerAllScanTypes(),
    staleTime: 60 * 60 * 1000,
    enabled: isOpen, // don't fetch until the panel is opened
  });

  // Locations — needed to resolve the current override's instrument so we
  // can decide whether to reset on pick. Same query the page uses, dedup'd.
  const { data: locations = [] } = useQuery({
    queryKey: ["screener-locations"],
    queryFn: () => api.screenerLocations(),
    staleTime: 60 * 60 * 1000,
    enabled: isOpen,
  });

  // ── Filter + group ─────────────────────────────────────────
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? scans.filter(
          (s) =>
            s.code.toLowerCase().includes(q) ||
            s.display_name.toLowerCase().includes(q),
        )
      : scans;

    const map = new Map<string, ScannerScanType[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const s of filtered) {
      const cat = map.has(s.group) ? s.group : "other";
      map.get(cat)!.push(s);
    }
    // Drop empty buckets so the panel doesn't show empty headers
    return CATEGORY_ORDER
      .map((cat) => ({ key: cat, items: map.get(cat) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [scans, search]);

  // ── Pick handler ───────────────────────────────────────────
  const handlePick = (scan: ScannerScanType) => {
    const preset = scanTypeToPreset(scan);

    // Check whether the current location override is compatible with
    // this scan's instruments. If not, reset to STK.US.MAJOR and
    // surface a banner so the user knows.
    const currentLocOpt = locations.find((l) => l.location === locationOverride);
    const currentInstrument = currentLocOpt?.instrument;
    const compatible = scan.instruments;

    const needsReset =
      currentInstrument !== undefined &&
      compatible.length > 0 &&
      !compatible.includes(currentInstrument);

    if (needsReset) {
      setLocationOverride(DEFAULT_LOCATION_CODE);
      setLocationResetReason(
        `Location reset to US — Listed/NASDAQ. ${scan.display_name} isn't available outside US Stocks.`,
      );
    }

    onPick(preset);
    onClose();
  };

  const toggleCollapsed = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // ── Render ─────────────────────────────────────────────────
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop — clicking dismisses */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over */}
      <aside
        data-testid="browse-all-scans-panel"
        role="dialog"
        aria-label="Browse all scans"
        className="fixed right-0 top-0 z-50 flex h-full w-[380px] flex-col border-l border-[var(--border)] bg-[var(--bg-1)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
          <Sparkles size={14} className="text-[var(--clr-cyan)]" />
          <span className="text-[12px] font-semibold text-[var(--text-1)]">
            Browse all scans
          </span>
          <span className="ml-auto text-[10px] text-[var(--text-3)]">
            {scans.length} total
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-1 rounded p-1 text-[var(--text-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="relative border-b border-[var(--border)] px-3 py-2">
          <Search
            size={12}
            className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[var(--text-3)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search scans…"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-0)] py-1.5 pl-7 pr-2.5 text-[11px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-colors focus:border-[var(--clr-cyan)]"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-4 text-center text-[10px] text-[var(--text-3)]">
              Loading scan types…
            </div>
          )}
          {!isLoading && grouped.length === 0 && (
            <div className="p-4 text-center text-[10px] text-[var(--text-3)]">
              {search ? "No scans match your search." : "No scan types available."}
            </div>
          )}
          {!isLoading &&
            grouped.map(({ key, items }, idx) => {
              // First section auto-expanded; rest collapsed by default.
              // collapsed Set tracks user-toggled OPENS opposite of default.
              const defaultOpen = idx === 0;
              const isOpenSection = defaultOpen
                ? !collapsed.has(key)
                : collapsed.has(key);
              return (
                <div key={key} className="border-b border-[var(--border)]">
                  <button
                    onClick={() => toggleCollapsed(key)}
                    aria-expanded={isOpenSection}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-2)]"
                  >
                    {isOpenSection ? (
                      <ChevronDown size={11} className="text-[var(--text-3)]" />
                    ) : (
                      <ChevronRight size={11} className="text-[var(--text-3)]" />
                    )}
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-2)]">
                      {CATEGORY_LABELS[key] ?? key}
                    </span>
                    <span className="ml-auto text-[10px] text-[var(--text-3)]">
                      {items.length}
                    </span>
                  </button>

                  {isOpenSection && (
                    <div className="pb-1">
                      {items.map((s) => (
                        <ScanRow key={s.code} scan={s} onPick={handlePick} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {/* Footer hint */}
        <div className="border-t border-[var(--border)] px-3 py-2 text-[9px] text-[var(--text-3)]">
          Picking a scan keeps your filters. The location may reset if the
          chosen scan doesn't support it.
        </div>
      </aside>
    </>
  );
}

// ── ScanRow ────────────────────────────────────────────────────

function ScanRow({
  scan,
  onPick,
}: {
  scan: ScannerScanType;
  onPick: (s: ScannerScanType) => void;
}) {
  // Compatibility chip — shows STK if US-only, "STK +N" if it works in
  // additional markets too. Click target is the whole row.
  const total = scan.instruments.length;
  const chip =
    total === 0
      ? "—"
      : total === 1
        ? scan.instruments[0]
        : `${scan.instruments[0]} +${total - 1}`;

  return (
    <button
      onClick={() => onPick(scan)}
      data-testid={`browse-scan-row-${scan.code}`}
      className="flex w-full items-center justify-between gap-3 px-4 py-1.5 text-left transition-colors hover:bg-[var(--bg-2)]"
    >
      <span className="flex flex-1 items-center gap-1.5 min-w-0">
        <span className="truncate text-[11px] text-[var(--text-1)]">
          {scan.display_name}
        </span>
        {scan.is_curated && (
          <span
            title="Curated — also in the main preset dropdown"
            className="shrink-0 rounded-full bg-[var(--clr-cyan)]/15 px-1.5 py-0.5 text-[8px] font-medium text-[var(--clr-cyan)]"
          >
            curated
          </span>
        )}
      </span>
      <span
        className="shrink-0 font-mono text-[9px] text-[var(--text-3)]"
        title={`Compatible instruments: ${scan.instruments.join(", ") || "none"}`}
      >
        {chip}
      </span>
    </button>
  );
}
