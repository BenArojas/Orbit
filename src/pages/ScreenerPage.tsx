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
import { api, type ScanRequest, type ScannerLocation } from "@/lib/api";
import { useScreenerStore, type ActiveFilter } from "@/store/screener";

/**
 * Resolve the (instrument, location) pair to send to the scan endpoint.
 *
 * Logic:
 *   - For non-STK presets (ETF/FUT), always use the preset's bundled
 *     instrument + location (the Location dropdown is disabled for these).
 *   - For STK presets, use the location dropdown's selection. Look up the
 *     matching curated entry to get the right instrument code (e.g. picking
 *     "Japan" yields instrument="STOCK.HK", location="STK.HK.TSE_JPN").
 *   - If the location code isn't in the curated list (shouldn't happen
 *     under normal flow), fall back to the preset's bundled instrument.
 */
function resolveScanTarget(
  preset: { instrument: string; location: string },
  locationOverride: string,
  locations: ScannerLocation[],
): { instrument: string; location: string } {
  if (preset.instrument !== "STK") {
    return { instrument: preset.instrument, location: preset.location };
  }
  const opt = locations.find((l) => l.location === locationOverride);
  if (!opt) {
    return { instrument: preset.instrument, location: preset.location };
  }
  return { instrument: opt.instrument, location: opt.location };
}

/**
 * Resolve the US-only card lock — for cards with `usOnly: true` (currently
 * just "S&P 500 gainers"), the scan must run against STK.US.MAJOR
 * regardless of the user's selected location, because their criteria
 * don't translate to non-US markets (S&P 500 is US-only; market-cap
 * thresholds are in listing currency so a "$50B large cap" filter
 * doesn't mean the same thing in JPY or CHF).
 *
 * Returns the effective location for this scan, plus a banner message
 * to surface via setLocationResetReason when the lock actually changed
 * something (null when the user was already on US).
 *
 * Pure function — no side effects, easy to unit-test.
 */
export function resolveUsOnlyLock(
  card: { usOnly?: boolean; title: string },
  currentLocation: string,
): { effectiveLocation: string; banner: string | null } {
  if (card.usOnly && currentLocation !== "STK.US.MAJOR") {
    return {
      effectiveLocation: "STK.US.MAJOR",
      banner: `Location set to US — Listed/NASDAQ. ${card.title} is US-only.`,
    };
  }
  return { effectiveLocation: currentLocation, banner: null };
}
import ScreenerFilterBar from "@/components/screener/ScreenerFilterBar";
import ScreenerResultsTable from "@/components/screener/ScreenerResultsTable";
import ScreenerPagination from "@/components/screener/ScreenerPagination";
import ScreenerPeekPanel from "@/components/screener/ScreenerPeekPanel";
import ScreenerAiPanel from "@/components/screener/ScreenerAiPanel";
import BrowseAllScansPanel from "@/components/screener/BrowseAllScansPanel";
import LocationResetBanner from "@/components/screener/LocationResetBanner";

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
  /**
   * If true, clicking the card forces locationOverride to STK.US.MAJOR.
   * Used for cards whose criteria are inherently US-bound (e.g. "S&P 500
   * names" only makes sense for STK.US.MAJOR, and IBKR's market-cap filter
   * is in the listing currency so a $50B threshold doesn't translate to
   * non-US markets).
   *
   * The filter bar shows a small "US-only" chip on these cards. If the
   * user had a non-US location selected, we fire the LocationResetBanner
   * to explain why the location just changed.
   */
  usOnly?: boolean;
}

// Market-cap brackets used by the cards (and mirrored in the AI prompt's
// sensible-defaults table — see services/screener_ai.py SYSTEM_PROMPT).
//   Small cap:   $300M – $5B
//   Mid cap:     $5B   – $50B
//   Large cap:   $50B+ (anything at or above this floor)
// IBKR's marketCapAbove1e6 / marketCapBelow1e6 filters take values in
// MILLIONS of the listing currency. So 50000 = $50B in USD for US stocks.
const MC_LARGE_FLOOR_M = 50000;

const EMPTY_CARDS: CardDef[] = [
  {
    id: "sp500-gainers",
    title: "S&P 500 gainers",
    description: "S&P 500 names up today with market cap above $50B",
    scanType: "TOP_PERC_GAIN",
    location: "STK.US.MAJOR",
    instrument: "STK",
    usOnly: true,
    filters: [
      {
        code: "marketCapAbove1e6",
        value: String(MC_LARGE_FLOOR_M),
        display_label: "Market Cap ≥ $50B",
      },
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
      {
        code: "marketCapAbove1e6",
        value: String(MC_LARGE_FLOOR_M),
        display_label: "Market Cap ≥ $50B",
      },
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
      <span className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-[var(--text-1)] group-hover:text-[var(--clr-cyan)] transition-colors">
          {card.title}
        </span>
        {card.usOnly && (
          <span
            data-testid={`card-us-only-chip-${card.id}`}
            title="This card always runs against US — Listed/NASDAQ"
            className="rounded-full bg-[var(--clr-orange)]/15 border border-[var(--clr-orange)]/30 px-1.5 py-0.5 text-[8px] font-medium text-[var(--clr-orange)]"
          >
            US-only
          </span>
        )}
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
  // Path C — Browse all scans slide-over open state
  const [browseOpen, setBrowseOpen] = useState(false);

  const {
    selectedPreset,
    locationOverride,
    filters,
    results,
    isScanning,
    setScanning,
    replaceResults,
    applyPreset,
    resetScreener,
    setPreset,
    setLocationOverride,
    setLocationResetReason,
  } = useScreenerStore();

  // Presets are also fetched in ScreenerFilterBar — React Query deduplicates.
  const { data: presets } = useQuery({
    queryKey: ["screener-presets"],
    queryFn: () => api.screenerPresets(),
    staleTime: 60_000 * 60,
  });

  // Locations are also fetched in ScreenerFilterBar — React Query deduplicates.
  // Used here to look up the instrument code paired with the chosen location.
  const { data: locations = [] } = useQuery({
    queryKey: ["screener-locations"],
    queryFn: () => api.screenerLocations(),
    staleTime: 60 * 60 * 1000,
  });

  // Tracks the most recent scan that completed successfully but matched 0 rows
  // (e.g. 13W highs on a slow tape). Used to swap the cold-start headline for
  // a "no matches right now" hint above the same quick-pick cards.
  const [lastScanWasEmpty, setLastScanWasEmpty] = useState(false);

  const scanMutation = useMutation({
    mutationFn: (req: ScanRequest) => api.screenerScan(req),
    onMutate: () => {
      setScanning(true);
      setLastScanWasEmpty(false);
    },
    onSuccess: (data) => {
      replaceResults(data.results, data.total_scanned);
      setLastScanWasEmpty(data.results.length === 0);
    },
    onSettled: () => setScanning(false),
  });

  const handleScan = useCallback(() => {
    if (!selectedPreset || isScanning) return;

    // Resolve instrument+location together so non-US locations get the
    // right top-level instrument (e.g. STOCK.HK for Japan). Sending
    // STK with STK.HK.TSE_JPN gives IBKR 500.
    const target = resolveScanTarget(selectedPreset, locationOverride, locations);

    const req: ScanRequest = {
      instrument: target.instrument,
      scan_type: selectedPreset.scan_type,
      location: target.location,
      filters: filters.map((f) => ({ code: f.code, value: f.value })),
      max_results: SCAN_BATCH_SIZE,
      page: 1,
      page_size: SCAN_BATCH_SIZE,
    };

    scanMutation.mutate(req);
  }, [selectedPreset, locationOverride, locations, filters, isScanning, scanMutation]);

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

      // US-only cards (e.g. "S&P 500 gainers") force the location override
      // back to STK.US.MAJOR. resolveUsOnlyLock returns the effective
      // location to use for this scan + a banner string when the lock
      // actually changed something (so the user knows why their location
      // dropdown just snapped back to US).
      const lock = resolveUsOnlyLock(card, locationOverride);
      if (lock.banner) {
        setLocationOverride(lock.effectiveLocation);
        setLocationResetReason(lock.banner);
      }

      const activeFilters: ActiveFilter[] = card.filters.map((f, i) => ({
        ...f,
        id: `card-${card.id}-${f.code}-${i}`,
      }));

      applyPreset(preset, activeFilters);

      // Scan immediately — use card data directly to avoid stale closure.
      // Location override applies here too (lock.effectiveLocation has
      // already been clamped to STK.US.MAJOR for US-only cards above).
      const target = resolveScanTarget(preset, lock.effectiveLocation, locations);
      const req: ScanRequest = {
        instrument: target.instrument,
        scan_type: preset.scan_type,
        location: target.location,
        filters: card.filters.map((f) => ({ code: f.code, value: f.value })),
        max_results: SCAN_BATCH_SIZE,
        page: 1,
        page_size: SCAN_BATCH_SIZE,
      };
      scanMutation.mutate(req);
    },
    [
      presets,
      locationOverride,
      locations,
      isScanning,
      applyPreset,
      scanMutation,
      setLocationOverride,
      setLocationResetReason,
    ],
  );

  const showEmptyState = results.length === 0 && !isScanning && !scanMutation.isError;

  return (
    <div className="flex h-full flex-col">
      {/* Filter bar — sticky top, full width */}
      <ScreenerFilterBar
        onScan={handleScan}
        aiPanelOpen={aiPanelOpen}
        onToggleAiPanel={() => setAiPanelOpen((v) => !v)}
        showClearResults={results.length > 0 || scanMutation.isError || lastScanWasEmpty}
        onClearResults={() => {
          resetScreener();
          scanMutation.reset();
          setLastScanWasEmpty(false);
        }}
        onOpenBrowseAllScans={() => setBrowseOpen(true)}
      />

      {/* Path C — auto-dismissing banner shown when the Browse panel had
          to reset the location override (e.g. picked a US-only scan
          while Japan was selected). */}
      <LocationResetBanner />

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
                {lastScanWasEmpty ? (
                  <>
                    <p className="text-[13px] font-semibold text-[var(--text-1)]">
                      No matches for this preset right now
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-3)]">
                      {selectedPreset?.subtitle
                        ? `${selectedPreset.subtitle} — try again during its window, or pick a different preset below.`
                        : "Try a different preset, or pick a quick scan card below."}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-semibold text-[var(--text-1)]">
                      Pick a preset or try a quick scan
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-3)]">
                      Select a scanner preset above, or click a card to run a pre-built screen
                    </p>
                  </>
                )}
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

      {/* Path C — Browse all scans slide-over (full IBKR catalogue).
          On pick: builds a synthetic preset, sets it active, and may
          reset locationOverride if it isn't compatible (banner above
          surfaces the reset). User's filters are preserved. */}
      <BrowseAllScansPanel
        isOpen={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onPick={(preset) => setPreset(preset)}
      />
    </div>
  );
}
