/**
 * Screener Page — Filter instruments by indicator criteria
 *
 * Layout: filter bar (top sticky) + results table (scrollable main)
 * Clicking a result navigates to Analysis with that instrument.
 *
 * Flow:
 *   1. User picks a scanner preset (Most Active, Top Gainers, etc.)
 *   2. User optionally adds indicator filters (RSI < 30, Price > 5, etc.)
 *   3. User clicks "Scan" → POST /screener/scan
 *   4. Results render in sortable table
 *   5. Click any row → Analysis page for that conid
 */

import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type ScanRequest, type ScreenerFilterItem } from "@/lib/api";
import { useScreenerStore } from "@/store/screener";
import ScreenerFilterBar from "@/components/screener/ScreenerFilterBar";
import ScreenerResultsTable from "@/components/screener/ScreenerResultsTable";

export default function ScreenerPage() {
  const {
    selectedPreset,
    filters,
    isScanning,
    setScanning,
    setResults,
  } = useScreenerStore();

  // Scan mutation — fires POST /screener/scan
  const scanMutation = useMutation({
    mutationFn: (req: ScanRequest) => api.screenerScan(req),
    onMutate: () => setScanning(true),
    onSuccess: (data) => {
      setResults(data.results, data.total_scanned, data.total_matched);
    },
    onSettled: () => setScanning(false),
  });

  const handleScan = useCallback(() => {
    if (!selectedPreset || isScanning) return;

    // Build the scan request
    const enabledFilters = filters.filter((f) => f.enabled);
    const filterItems: ScreenerFilterItem[] = enabledFilters.map((f) => ({
      indicator: f.indicator,
      op: f.op,
      value: f.value,
      ...(f.op === "between" && f.value2 != null ? { value2: f.value2 } : {}),
    }));

    const req: ScanRequest = {
      instrument: selectedPreset.instrument,
      scan_type: selectedPreset.scan_type,
      location: selectedPreset.location,
      filters: filterItems,
      indicators: ["rsi", "macd", "ema_50", "ema_200", "volume", "adx"],
      max_results: 50,
    };

    scanMutation.mutate(req);
  }, [selectedPreset, filters, isScanning, scanMutation, setResults]);

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
    </div>
  );
}
