/**
 * Screener Page — Filter instruments via IBKR native scanner filters
 *
 * Layout: filter bar (top sticky) + results table (scrollable) + pagination (bottom) + peek panel (right)
 *
 * Flow:
 *   1. User picks a scanner preset (Most Active, Top Gainers, etc.)
 *   2. User optionally adds IBKR native filter codes (Market Cap ≥ 1B, P/E ≤ 20, etc.)
 *   3. User optionally picks server-side sort field + direction
 *   4. User clicks "Scan" → POST /screener/scan
 *   5. Results render in sortable, paginated table
 *   6. Click any row → quick-peek slide-over with key stats + "Open in Analysis" CTA
 */

import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type ScanRequest } from "@/lib/api";
import { useScreenerStore } from "@/store/screener";
import ScreenerFilterBar from "@/components/screener/ScreenerFilterBar";
import ScreenerResultsTable from "@/components/screener/ScreenerResultsTable";
import ScreenerPagination from "@/components/screener/ScreenerPagination";
import ScreenerPeekPanel from "@/components/screener/ScreenerPeekPanel";

export default function ScreenerPage() {
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
      {/* Filter bar — sticky top */}
      <ScreenerFilterBar onScan={handleScan} />

      {/* Error state */}
      {scanMutation.isError && (
        <div className="border-b border-[var(--clr-red)]/20 bg-[var(--clr-red)]/5 px-4 py-2 text-[11px] text-[var(--clr-red)]">
          {scanMutation.error instanceof Error
            ? scanMutation.error.message
            : "Scan failed — check IBKR connection"}
        </div>
      )}

      {/* Results table — scrollable */}
      <ScreenerResultsTable />

      {/* Pagination — bottom */}
      <ScreenerPagination onPageChange={handlePageChange} />

      {/* Quick-peek slide-over */}
      <ScreenerPeekPanel />
    </div>
  );
}
