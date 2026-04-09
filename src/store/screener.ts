/**
 * Screener Store — Filter state + results for the stock screener
 *
 * Tracks which IBKR native filters are active, the selected scanner preset,
 * scan results, pagination, sort state, and quick-peek selection.
 * All filtering happens server-side via IBKR.
 *
 * Results persist across page navigations (5.9) — navigating to Analysis
 * and back restores the last scan.
 */

import { create } from "zustand";
import type { IbkrFilterItem, ScreenerResultRow, ScannerPreset } from "@/lib/api";

/** An active filter with a local ID for React key + removal */
export interface ActiveFilter extends IbkrFilterItem {
  id: string;           // Local UUID for React key / removal
  display_label: string; // Human-readable label e.g. "Market Cap ≥ $1B"
}

/** Sort direction for results table */
export type SortDir = "asc" | "desc";

/** IBKR scanner sort options (server-side) */
export interface ScannerSort {
  field: string;       // IBKR sort code (e.g. "changePercAbove")
  direction: SortDir;  // "asc" or "desc"
}

interface ScreenerState {
  /** Active native IBKR filter criteria */
  filters: ActiveFilter[];

  /** Selected scanner preset */
  selectedPreset: ScannerPreset | null;

  /** Is a scan currently running? */
  isScanning: boolean;

  /** Scan results from the last run */
  results: ScreenerResultRow[];
  totalScanned: number;
  totalMatched: number;

  /** Pagination */
  page: number;
  pageSize: number;
  totalPages: number;

  /** Client-side column sort (for the results table) */
  sortBy: string;
  sortDir: SortDir;

  /** IBKR server-side sort (sent with scan request) */
  scannerSort: ScannerSort;

  /** Quick-peek slide-over */
  peekConid: number | null;

  /** Actions */
  addFilter: (filter: ActiveFilter) => void;
  removeFilter: (id: string) => void;
  clearFilters: () => void;
  setPreset: (preset: ScannerPreset) => void;
  setScanning: (v: boolean) => void;
  setResults: (
    results: ScreenerResultRow[],
    scanned: number,
    matched: number,
    page: number,
    totalPages: number,
  ) => void;
  clearResults: () => void;
  setSort: (col: string, dir: SortDir) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setScannerSort: (sort: ScannerSort) => void;
  setPeekConid: (conid: number | null) => void;
}

export const useScreenerStore = create<ScreenerState>()((set) => ({
  filters: [],
  selectedPreset: null,
  isScanning: false,
  results: [],
  totalScanned: 0,
  totalMatched: 0,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  sortBy: "change_percent",
  sortDir: "desc",
  scannerSort: { field: "", direction: "desc" },
  peekConid: null,

  addFilter: (filter) =>
    set((state) => ({ filters: [...state.filters, filter] })),

  removeFilter: (id) =>
    set((state) => ({
      filters: state.filters.filter((f) => f.id !== id),
    })),

  clearFilters: () => set({ filters: [] }),

  setPreset: (preset) => {
    // When preset has default_filters, auto-apply them
    const defaultFilters: ActiveFilter[] = (preset.default_filters ?? []).map((f, i) => ({
      ...f,
      id: `preset-${f.code}-${i}`,
      display_label: `${f.code}: ${f.value}`,
    }));
    set({
      selectedPreset: preset,
      filters: defaultFilters,
      page: 1,
    });
  },

  setScanning: (v) => set({ isScanning: v }),

  setResults: (results, scanned, matched, page, totalPages) =>
    set({ results, totalScanned: scanned, totalMatched: matched, page, totalPages }),

  clearResults: () =>
    set({ results: [], totalScanned: 0, totalMatched: 0, page: 1, totalPages: 1 }),

  setSort: (col, dir) => set({ sortBy: col, sortDir: dir }),

  setPage: (page) => set({ page }),

  setPageSize: (size) => set({ pageSize: size, page: 1 }),

  setScannerSort: (sort) => set({ scannerSort: sort }),

  setPeekConid: (conid) => set({ peekConid: conid }),
}));
