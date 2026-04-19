/**
 * Screener Store — Filter state + cumulative results buffer
 *
 * Responsibilities:
 *   - Track active IBKR native filters + selected preset.
 *   - Hold the *cumulative* scan results buffer (grown by future "Search next 50").
 *   - Hold *client-side* pagination (page number) and sort (column + direction).
 *   - Surface a `isDirty` flag so the UI can indicate that filter/preset state
 *     has changed since the last scan (the user hasn't pressed Scan yet).
 *
 * Pagination / sorting model:
 *   - All filtering happens server-side (IBKR native filters).
 *   - All sorting happens client-side (we want as little backend compute as
 *     possible so the scan returns fast). Default = natural arrival order.
 *   - Pagination is pure client-side slicing of the buffer — page changes never
 *     hit the backend.
 *
 * TODO (next pass): "Search next 50" button
 *   IBKR /iserver/scanner/run returns ~50 rows per call and does not expose
 *   a documented offset. Once we wire it up (startAt? HMDS scanner?), we'll
 *   call `appendResults` to grow the buffer without resetting page/sort.
 */

import { create } from "zustand";
import type { IbkrFilterItem, ScreenerResultRow, ScannerPreset } from "@/lib/api";

/** Rows per page (hardcoded — no page-size selector any more) */
export const SCREENER_PAGE_SIZE = 25;

/** An active filter with a local ID for React key + removal */
export interface ActiveFilter extends IbkrFilterItem {
  id: string;            // Local UUID for React key / removal
  display_label: string; // Human-readable label e.g. "Market Cap ≥ $1B"
}

/** Sort direction for the results table */
export type SortDir = "asc" | "desc";

interface ScreenerState {
  /** Active native IBKR filter criteria */
  filters: ActiveFilter[];

  /** Selected scanner preset */
  selectedPreset: ScannerPreset | null;

  /** Is a scan currently running? */
  isScanning: boolean;

  /** Cumulative scan results (grows when we implement "Search next 50") */
  results: ScreenerResultRow[];

  /** How many rows IBKR returned in the most recent batch */
  lastBatchSize: number;

  /** Total "scanned" count reported by the most recent batch (from backend) */
  totalScanned: number;

  /** Client-side pagination state */
  page: number;

  /**
   * Client-side column sort.
   *   sortBy === ""  →  preserve scanner's natural arrival order (default)
   *   sortBy !== ""  →  sort by that column with sortDir
   */
  sortBy: string;
  sortDir: SortDir;

  /**
   * True when filters or preset have changed since the last successful scan.
   * Used to show a "filters changed — press Scan to refresh" hint.
   */
  isDirty: boolean;

  /** Quick-peek slide-over */
  peekConid: number | null;

  // ── Actions ────────────────────────────────────────────────
  addFilter: (filter: ActiveFilter) => void;
  removeFilter: (id: string) => void;
  clearFilters: () => void;
  setPreset: (preset: ScannerPreset) => void;

  /**
   * Atomically set both preset and filters in one go.
   * Used by the empty-state "Try this" cards so the store + scan request
   * are always in sync (no race between setPreset and addFilter calls).
   * Sets isDirty = false because the caller fires a scan immediately after.
   */
  applyPreset: (preset: ScannerPreset, filters: ActiveFilter[]) => void;

  setScanning: (v: boolean) => void;

  /** Replace buffer with a fresh scan result. Called when the main Scan runs. */
  replaceResults: (rows: ScreenerResultRow[], totalScanned: number) => void;

  /**
   * Append rows to the existing buffer (for the future "Search next 50" flow).
   * Does NOT reset page/sort.
   *
   * TODO: hook this up to a "Search next 50" button once IBKR offset paging is
   * implemented. Right now it's unused but wired into the store API so the
   * component layer doesn't need restructuring when we're ready.
   */
  appendResults: (rows: ScreenerResultRow[], totalScanned: number) => void;

  clearResults: () => void;
  setSort: (col: string, dir: SortDir) => void;
  setPage: (page: number) => void;
  setPeekConid: (conid: number | null) => void;
}

export const useScreenerStore = create<ScreenerState>()((set) => ({
  filters: [],
  selectedPreset: null,
  isScanning: false,
  results: [],
  lastBatchSize: 0,
  totalScanned: 0,
  page: 1,
  sortBy: "",          // "" = natural scanner order
  sortDir: "desc",
  isDirty: false,
  peekConid: null,

  addFilter: (filter) =>
    set((state) => ({
      filters: [...state.filters, filter],
      isDirty: true,
    })),

  removeFilter: (id) =>
    set((state) => ({
      filters: state.filters.filter((f) => f.id !== id),
      isDirty: true,
    })),

  clearFilters: () => set({ filters: [], isDirty: true }),

  setPreset: (preset) => {
    // When preset has default_filters, auto-apply them
    const defaultFilters: ActiveFilter[] = (preset.default_filters ?? []).map(
      (f, i) => ({
        ...f,
        id: `preset-${f.code}-${i}`,
        display_label: `${f.code}: ${f.value}`,
      }),
    );
    set({
      selectedPreset: preset,
      filters: defaultFilters,
      page: 1,
      isDirty: true,
    });
  },

  applyPreset: (preset, filters) =>
    set({
      selectedPreset: preset,
      filters,
      page: 1,
      isDirty: false, // caller fires scan immediately
    }),

  setScanning: (v) => set({ isScanning: v }),

  replaceResults: (rows, totalScanned) =>
    set({
      results: rows,
      lastBatchSize: rows.length,
      totalScanned,
      page: 1,
      sortBy: "",        // reset to natural order on fresh scan
      sortDir: "desc",
      isDirty: false,
    }),

  appendResults: (rows, totalScanned) =>
    set((state) => ({
      results: [...state.results, ...rows],
      lastBatchSize: rows.length,
      totalScanned,
      isDirty: false,
    })),

  clearResults: () =>
    set({
      results: [],
      lastBatchSize: 0,
      totalScanned: 0,
      page: 1,
      sortBy: "",
    }),

  setSort: (col, dir) => set({ sortBy: col, sortDir: dir }),

  setPage: (page) => set({ page }),

  setPeekConid: (conid) => set({ peekConid: conid }),
}));
