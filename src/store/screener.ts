/**
 * Screener Store — Filter state for the stock screener
 *
 * Tracks which indicator filters are active and their parameters.
 * The actual scan computation happens in the backend (services/screener.py).
 * This store just holds the filter UI state.
 */

import { create } from "zustand";

/** Filter condition operators */
export type FilterOp = "gt" | "lt" | "between" | "cross_above" | "cross_below";

/** A single filter criterion */
export interface ScreenerFilter {
  id: string;
  indicator: string; // e.g. "rsi", "ema_trend", "volume_ratio"
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

  /** Is a scan currently running? */
  isScanning: boolean;

  /** Column to sort results by */
  sortBy: string;
  sortDir: SortDir;

  /** Actions */
  addFilter: (filter: ScreenerFilter) => void;
  removeFilter: (id: string) => void;
  updateFilter: (id: string, patch: Partial<ScreenerFilter>) => void;
  toggleFilter: (id: string) => void;
  clearFilters: () => void;
  setScanning: (v: boolean) => void;
  setSort: (col: string, dir: SortDir) => void;
}

export const useScreenerStore = create<ScreenerState>()((set) => ({
  filters: [],
  isScanning: false,
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

  setScanning: (v) => set({ isScanning: v }),

  setSort: (col, dir) => set({ sortBy: col, sortDir: dir }),
}));
