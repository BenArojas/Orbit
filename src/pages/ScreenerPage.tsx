/**
 * Screener Page — Filter instruments via IBKR native scanner filters
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────┐
 *   │ Filter bar (sticky top, full width)             │
 *   ├────────────────────────────┬────────────────────┤
 *   │ Results table (scrollable) │ AI panel (300px)   │
 *   ├────────────────────────────┤ collapsible        │
 *   │ Pagination (bottom)        │                    │
 *   └────────────────────────────┴────────────────────┘
 *   + ScreenerPeekPanel (right overlay on row click)
 *
 * Flow:
 *   1. User picks a scanner preset (Most Active, Top Gainers, etc.)
 *   2. User optionally adds IBKR native filter codes (or uses AI panel)
 *   3. User optionally picks server-side sort field + direction
 *   4. User clicks "Scan" → POST /screener/scan
 *   5. Results render in sortable, paginated table
 *   6. Click any row → quick-peek slide-over with key stats + "Open in Analysis" CTA
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

export default function ScreenerPage() {
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const {
    selectedPreset,
    filters,
    isScanning,
    pageSize,
    scannerSort,
    setScanning,
    setResults,
  } = useScreenerStore();

  const scanMutation = useMutation({
    mutationFn: (req: ScanRequest) => api.screenerScan(req),
    onMutate: () => setScanning(true),
    onSuccess: (data) => {
      setResults(
        data.results,
        data.total_scanned,
        data.total_matched,
        data.page,
        data.total_pages,
      );
    },
    onSettled: () => setScanning(false),
  });

  const doScan = useCallback(
    (page = 1, size = pageSize) => {
      if (!selectedPreset || isScanning) return;

      const req: ScanRequest = {
        instrument: selectedPreset.instrument,
        scan_type: selectedPreset.scan_type,
        location: selectedPreset.location,
        filters: filters.map((f) => ({ code: f.code, value: f.value })),
        max_results: 200,
        sort_field: scannerSort.field || undefined,
        sort_direction: scannerSort.direction,
        page,
        page_size: size,
      };

      scanMutation.mutate(req);
    },
    [selectedPreset, filters, isScanning, pageSize, scannerSort, scanMutation],
  );

  const handleScan = useCallback(() => doScan(1, pageSize), [doScan, pageSize]);

  const handlePageChange = useCallback(
    (page: number, size: number) => doScan(page, size),
    [doScan],
  );

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
          <ScreenerPagination onPageChange={handlePageChange} />
        </div>

        {/* Right column: AI panel (collapsible) */}
        <ScreenerAiPanel isOpen={aiPanelOpen} />
      </div>

      {/* Quick-peek slide-over (overlay) */}
      <ScreenerPeekPanel />
    </div>
  );
}
