/**
 * Screener Store — Filter state + results for the stock screener
 *
 * Tracks which IBKR native filters are active, the selected scanner preset,
 * scan results, and sort state. All filtering happens server-side via IBKR.
 */

import { create } from "zustand";
import type { IbkrFilterItem, ScreenerResultRow, ScannerPreset } from "@/lib/api";

/** An active filter with a local ID for React key + removal */
export interface ActiveFilter extends IbkrFilterItem {
  id: string;           // Local UUID for React key / removal
  display_label: string; // Human-readable label e.g. "Market Cap > $1B"
}

/** Sort direction for results table */
export type SortDir = "asc" | "desc";

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

  /** Column to sort results by */
  sortBy: string;
  sortDir: SortDir;

  /** Actions */
  addFilter: (filter: ActiveFilter) => void;
  removeFilter: (id: string) => void;
  clearFilters: () => void;
  setPreset: (preset: ScannerPreset) => void;
  setScanning: (v: boolean) => void;
  setResults: (results: ScreenerResultRow[], scanned: number, matched: number) => void;
  clearResults: () => void;
  setSort: (col: string, dir: SortDir) => void;
}

export const useScreenerStore = create<ScreenerState>()((set) => ({
  filters: [],
  selectedPreset: null,
  isScanning: false,
  results: [],
  totalScanned: 0,
  totalMatched: 0,
  sortBy: "change_percent",
  sortDir: "desc",

  addFilter: (filter) =>
    set((state) => ({ filters: [...state.filters, filter] })),

  removeFilter: (id) =>
    set((state) => ({
      filters: state.filters.filter((f) => f.id !== id),
    })),

  clearFilters: () => set({ filters: [] }),

  setPreset: (preset) => set({ selectedPreset: preset }),

  setScanning: (v) => set({ isScanning: v }),

  setResults: (results, scanned, matched) =>
    set({ results, totalScanned: scanned, totalMatched: matched }),

  clearResults: () => set({ results: [], totalScanned: 0, totalMatched: 0 }),

  setSort: (col, dir) => set({ sortBy: col, sortDir: dir }),
}));
