/**
 * Screener Store — Filter state + results for the stock screener
 *
 * Tracks which indicator filters are active, the selected scanner preset,
 * scan results, and sort state. The actual scan computation happens in
 * the backend (services/screener.py).
 */

import { create } from "zustand";
import type { ScreenerResultRow, ScannerPreset } from "@/lib/api";

/** Filter condition operators */
export type FilterOp = "gt" | "lt" | "between" | "cross_above" | "cross_below";

/** A single filter criterion */
export interface ScreenerFilter {
  id: string;
  indicator: string; // e.g. "rsi", "ema_50", "volume", "price", "change_percent"
  op: FilterOp;
  value: number;
  value2?: number; // for "between" operator
  enabled: boolean;
}

/** Sort direction for results table */
export type SortDir = "asc" | "desc";

interface ScreenerState {
  /** Active filter criteria */
  filters: ScreenerFilter[];

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
  addFilter: (filter: ScreenerFilter) => void;
  removeFilter: (id: string) => void;
  updateFilter: (id: string, patch: Partial<ScreenerFilter>) => void;
  toggleFilter: (id: string) => void;
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
  sortBy: "symbol",
  sortDir: "asc",

  addFilter: (filter) =>
    set((state) => ({ filters: [...state.filters, filter] })),

  removeFilter: (id) =>
    set((state) => ({
      filters: state.filters.filter((f) => f.id !== id),
    })),

  updateFilter: (id, patch) =>
    set((state) => ({
      filters: state.filters.map((f) =>
        f.id === id ? { ...f, ...patch } : f
      ),
    })),

  toggleFilter: (id) =>
    set((state) => ({
      filters: state.filters.map((f) =>
        f.id === id ? { ...f, enabled: !f.enabled } : f
      ),
    })),

  clearFilters: () => set({ filters: [] }),

  setPreset: (preset) => set({ selectedPreset: preset }),

  setScanning: (v) => set({ isScanning: v }),

  setResults: (results, scanned, matched) =>
    set({ results, totalScanned: scanned, totalMatched: matched }),

  clearResults: () => set({ results: [], totalScanned: 0, totalMatched: 0 }),

  setSort: (col, dir) => set({ sortBy: col, sortDir: dir }),
}));
