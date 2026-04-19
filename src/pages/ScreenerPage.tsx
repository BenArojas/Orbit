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
 * Flow:
 *   1. User picks a scanner preset (Most Active, Top Gainers, etc.)
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
import { useMutation } from "@tanstack/react-query";
import { api, type ScanRequest } from "@/lib/api";
import { useScreenerStore } from "@/store/screener";
import ScreenerFilterBar from "@/components/screener/ScreenerFilterBar";
import ScreenerResultsTable from "@/components/screener/ScreenerResultsTable";
import ScreenerPagination from "@/components/screener/ScreenerPagination";
import ScreenerPeekPanel from "@/components/screener/ScreenerPeekPanel";
import ScreenerAiPanel from "@/components/screener/ScreenerAiPanel";

/** How many rows we ask the backend for per scan call. Matches IBKR's
 *  effective cap of ~50 results/scan. Future "Search next 50" will keep
 *  this constant and add a startAt-style param. */
const SCAN_BATCH_SIZE = 50;

export default function ScreenerPage() {
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const {
    selectedPreset,
    filters,
    isScanning,
    setScanning,
    replaceResults,
  } = useScreenerStore();

  const scanMutation = useMutation({
    mutationFn: (req: ScanRequest) => api.screenerScan(req),
    onMutate: () => setScanning(true),
    onSuccess: (data) => {
      // Fresh scan → replace buffer. (appendResults is reserved for future
      // "Search next 50" paging.)
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
      // No server-side sort — all sorting is client-side from the store.
      page: 1,
      page_size: SCAN_BATCH_SIZE,
    };

    scanMutation.mutate(req);
  }, [selectedPreset, filters, isScanning, scanMutation]);

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
        {/* Left column: results + pagination */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <ScreenerResultsTable />
          <ScreenerPagination />
        </div>

        {/* Right column: AI panel (collapsible) */}
        <ScreenerAiPanel isOpen={aiPanelOpen} />
      </div>

      {/* Quick-peek slide-over (overlay) */}
      <ScreenerPeekPanel />
    </div>
  );
}
