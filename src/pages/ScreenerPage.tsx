/**
 * Screener Page — Filter instruments via IBKR native scanner filters
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────┐
 *   │ Filter bar (sticky top, full width)             │
 *   ├────────────────────────────┬────────────────────┤
 *   │ Disclaimer strip           │                    │
 *   │ Results table (scrollable) │ AI panel (300px)   │
 *   │ Pagination (bottom)        │ collapsible        │
 *   └────────────────────────────┴────────────────────┘
 *   + ScreenerPeekPanel (right overlay on row click)
 *
 * Empty state:
 *   When no scan has been run yet, show 4 "Try this" cards. Clicking one
 *   calls applyPreset + fires the scan immediately so the results appear
 *   without a second click. Cards are hidden once results arrive.
 *
 * Flow:
 *   1. User picks a scanner preset (Most Active, Top Gainers, etc.)
 *      OR clicks a "Try this" empty-state card.
 *   2. User optionally adds IBKR native filter codes (or uses AI panel)
 *   3. User clicks "Scan" → POST /screener/scan (always page 1, 50 rows)
 *   4. Results render. Sorting + pagination happen client-side from the
 *      cumulative store buffer.
 *   5. Click any row → quick-peek slide-over with key stats + "Open in Analysis"
 *
 * TODO (next pass): "Search next 50"
 *   Once IBKR offset paging is wired up, we'll add a button in the disclaimer
 *   that calls appendResults() to grow the buffer without clearing page/sort.
 */

import { useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type ScanRequest } from "@/lib/api";
import { useScreenerStore, type ActiveFilter } from "@/store/screener";
import ScreenerFilterBar from "@/components/screener/ScreenerFilterBar";
import ScreenerResultsTable from "@/components/screener/ScreenerResultsTable";
import ScreenerPagination from "@/components/screener/ScreenerPagination";
import ScreenerPeekPanel from "@/components/screener/ScreenerPeekPanel";
import ScreenerAiPanel from "@/components/screener/ScreenerAiPanel";

/** How many rows we ask the backend for per scan call. Matches IBKR's
 *  effective cap of ~50 results/scan. Future "Search next 50" will keep
 *  this constant and add a startAt-style param. */
const SCAN_BATCH_SIZE = 50;

// ── Empty-state "Try this" cards ─────────────────────────────

interface CardDef {
  id: string;
  title: string;
  description: string;
  /** Must match an entry in the presets list */
  scanType: string;
  location: string;
  instrument: string;
  filters: Array<{ code: string; value: string; display_label: string }>;
}

const EMPTY_CARDS: CardDef[] = [
  {
    id: "large-cap-gainers",
    title: "Large cap gainers",
    description: "S&P 500 names up today with market cap above $10B",
    scanType: "TOP_PERC_GAIN",
    location: "STK.US.MAJOR",
    instrument: "STK",
    filters: [
      { code: "marketCapAbove1e6", value: "10000", display_label: "Market Cap ≥ $10B" },
    ],
  },
  {
    id: "liquid-breakouts",
    title: "Liquid breakouts",
    description: "Stocks above $10 gaining hard on volume ≥ 1M",
    scanType: "TOP_PERC_GAIN",
    location: "STK.US.MAJOR",
    instrument: "STK",
    filters: [
      { code: "priceAbove", value: "10", display_label: "Price ≥ $10" },
      { code: "volumeAbove", value: "1000000", display_label: "Volume ≥ 1M" },
    ],
  },
  {
    id: "value-screen",
    title: "Value screen",
    description: "Most active stocks with P/E ≤ 15 and Price/Book ≤ 2",
    scanType: "MOST_ACTIVE",
    location: "STK.US.MAJOR",
    instrument: "STK",
    filters: [
      { code: "maxPeRatio", value: "15", display_label: "P/E ≤ 15" },
      { code: "maxPrice2Bk", value: "2", display_label: "Price/Book ≤ 2" },
    ],
  },
  {
    id: "oversold-large-caps",
    title: "Oversold large caps",
    description: "Large caps pulling back below their 20-day EMA",
    scanType: "TOP_PERC_LOSE",
    location: "STK.US.MAJOR",
    instrument: "STK",
    filters: [
      { code: "marketCapAbove1e6", value: "10000", display_label: "Market Cap ≥ $10B" },
      { code: "lastVsEMAChangeRatio20Below", value: "-5", display_label: "Vs EMA(20) ≤ -5%" },
    ],
  },
];

// ── Empty state card component ────────────────────────────────

function EmptyCard({
  card,
  onClick,
  disabled,
}: {
  card: CardDef;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-4 text-left transition-all hover:border-[var(--clr-cyan)]/50 hover:bg-[var(--bg-3)] disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className="text-[12px] font-semibold text-[var(--text-1)] group-hover:text-[var(--clr-cyan)] transition-colors">
        {card.title}
      </span>
      <span className="text-[10px] text-[var(--text-3)] leading-relaxed">
        {card.description}
      </span>
      {/* Filter pills preview */}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {card.filters.map((f) => (
          <span
            key={f.code}
            className="rounded-full bg-[var(--bg-0)] border border-[var(--border)] px-2 py-0.5 font-mono text-[9px] text-[var(--text-3)]"
          >
            {f.display_label}
          </span>
        ))}
      </div>
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function ScreenerPage() {
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const {
    selectedPreset,
    filters,
    results,
    isScanning,
    setScanning,
    replaceResults,
    applyPreset,
  } = useScreenerStore();

  // Presets are also fetched in ScreenerFilterBar — React Query deduplicates.
  const { data: presets } = useQuery({
    queryKey: ["screener-presets"],
    queryFn: () => api.screenerPresets(),
    staleTime: 60_000 * 60,
  });

  const scanMutation = useMutation({
    mutationFn: (req: ScanRequest) => api.screenerScan(req),
    onMutate: () => setScanning(true),
    onSuccess: (data) => {
      replaceResults(data.results, data.total_scanned);
    },
    onSettled: () => setScanning(false),
  });

  const handleScan = useCallback(() => {
    if (!selectedPreset || isScanning) return;

    const req: ScanRequest = {
      instrument: selectedPreset.instrument,
      scan_type: selectedPreset.scan_type,
      location: selectedPreset.location,
      filters: filters.map((f) => ({ code: f.code, value: f.value })),
      max_results: SCAN_BATCH_SIZE,
      page: 1,
      page_size: SCAN_BATCH_SIZE,
    };

    scanMutation.mutate(req);
  }, [selectedPreset, filters, isScanning, scanMutation]);

  /** Apply a preset card and fire the scan immediately. */
  const handleCardClick = useCallback(
    (card: CardDef) => {
      const preset = presets?.find(
        (p) =>
          p.scan_type === card.scanType &&
          p.location === card.location &&
          p.instrument === card.instrument
      );
      if (!preset || isScanning) return;

      const activeFilters: ActiveFilter[] = card.filters.map((f, i) => ({
        ...f,
        id: `card-${card.id}-${f.code}-${i}`,
      }));

      applyPreset(preset, activeFilters);

      // Scan immediately — use card data directly to avoid stale closure
      const req: ScanRequest = {
        instrument: preset.instrument,
        scan_type: preset.scan_type,
        location: preset.location,
        filters: card.filters.map((f) => ({ code: f.code, value: f.value })),
        max_results: SCAN_BATCH_SIZE,
        page: 1,
        page_size: SCAN_BATCH_SIZE,
      };
      scanMutation.mutate(req);
    },
    [presets, isScanning, applyPreset, scanMutation]
  );

  const showEmptyState = results.length === 0 && !isScanning && !scanMutation.isError;

  return (
    <div className="flex h-full flex-col">
      {/* Filter bar — sticky top, full width */}
      <ScreenerFilterBar
        onScan={handleScan}
        aiPanelOpen={aiPanelOpen}
        onToggleAiPanel={() => setAiPanelOpen((v) => !v)}
      />

      {/* Error state */}
      {scanMutation.isError && (
        <div className="border-b border-[var(--clr-red)]/20 bg-[var(--clr-red)]/5 px-4 py-2 text-[11px] text-[var(--clr-red)]">
          {scanMutation.error instanceof Error
            ? scanMutation.error.message
            : "Scan failed — check IBKR connection"}
        </div>
      )}

      {/* Main content — results left, AI panel right */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column: results + pagination (or empty state) */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {showEmptyState ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
              <div className="text-center">
                <p className="text-[13px] font-semibold text-[var(--text-1)]">
                  Pick a preset or try a quick scan
                </p>
                <p className="mt-1 text-[11px] text-[var(--text-3)]">
                  Select a scanner preset above, or click a card to run a pre-built screen
                </p>
              </div>

              {/* Try this cards */}
              <div className="grid w-full max-w-2xl grid-cols-2 gap-3">
                {EMPTY_CARDS.map((card) => (
                  <EmptyCard
                    key={card.id}
                    card={card}
                    onClick={() => handleCardClick(card)}
                    disabled={isScanning || !presets}
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              <ScreenerResultsTable />
              <ScreenerPagination />
            </>
          )}
        </div>

        {/* Right column: AI panel (collapsible) */}
        <ScreenerAiPanel isOpen={aiPanelOpen} />
      </div>

      {/* Quick-peek slide-over (overlay) */}
      <ScreenerPeekPanel />
    </div>
  );
}
