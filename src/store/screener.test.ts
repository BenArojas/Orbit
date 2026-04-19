/**
 * Screener store tests
 *
 * Covers the 8.3 refactor:
 *   - Cumulative buffer (replaceResults / appendResults)
 *   - Client-side pagination (page counter only, no refetch)
 *   - Client-side sort default ("" = natural scanner order)
 *   - `isDirty` flag toggles on filter/preset mutation and resets on scan
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ScreenerResultRow, ScannerPreset } from "@/lib/api";
import {
  useScreenerStore,
  SCREENER_PAGE_SIZE,
  type ActiveFilter,
} from "./screener";

// ── Fixtures ──────────────────────────────────────────────────

function makeRows(n: number, offset = 0): ScreenerResultRow[] {
  return Array.from({ length: n }, (_, i) => ({
    conid: offset + i + 1,
    symbol: `SYM${offset + i + 1}`,
    company_name: `Company ${offset + i + 1}`,
    sec_type: "STK",
    last_price: 100 + i,
    change_percent: i % 2 === 0 ? 1.5 : -2.3,
    volume: 1_000_000 * (i + 1),
    market_cap: 1000 * (i + 1),
  }));
}

const PRESET: ScannerPreset = {
  instrument: "STK",
  scan_type: "MOST_ACTIVE",
  location: "STK.US.MAJOR",
  display_name: "Most Active — US Stocks",
};

const FILTER: ActiveFilter = {
  id: "f-1",
  code: "priceAbove",
  value: "10",
  display_label: "Price ≥ 10",
};

// ── Test helpers ──────────────────────────────────────────────

function resetStore() {
  useScreenerStore.setState({
    filters: [],
    selectedPreset: null,
    isScanning: false,
    results: [],
    lastBatchSize: 0,
    totalScanned: 0,
    page: 1,
    sortBy: "",
    sortDir: "desc",
    isDirty: false,
    peekConid: null,
  });
}

beforeEach(resetStore);

// ── Pagination constants ──────────────────────────────────────

describe("SCREENER_PAGE_SIZE", () => {
  it("is hardcoded to 25 (no per-page selector any more)", () => {
    expect(SCREENER_PAGE_SIZE).toBe(25);
  });
});

// ── replaceResults ────────────────────────────────────────────

describe("replaceResults", () => {
  it("sets results, resets page to 1, clears sort, clears isDirty", () => {
    useScreenerStore.setState({
      page: 3,
      sortBy: "change_percent",
      sortDir: "asc",
      isDirty: true,
    });

    const rows = makeRows(40);
    useScreenerStore.getState().replaceResults(rows, 40);

    const s = useScreenerStore.getState();
    expect(s.results).toHaveLength(40);
    expect(s.lastBatchSize).toBe(40);
    expect(s.totalScanned).toBe(40);
    expect(s.page).toBe(1);
    expect(s.sortBy).toBe("");
    expect(s.sortDir).toBe("desc");
    expect(s.isDirty).toBe(false);
  });

  it("handles an empty scan result without crashing", () => {
    useScreenerStore.getState().replaceResults([], 0);
    const s = useScreenerStore.getState();
    expect(s.results).toHaveLength(0);
    expect(s.lastBatchSize).toBe(0);
  });
});

// ── appendResults (reserved for "Search next 50") ─────────────

describe("appendResults", () => {
  it("grows the buffer without resetting page or sort", () => {
    const store = useScreenerStore.getState();
    store.replaceResults(makeRows(50, 0), 50);
    useScreenerStore.getState().setPage(2);
    useScreenerStore.getState().setSort("change_percent", "desc");

    useScreenerStore.getState().appendResults(makeRows(30, 50), 80);

    const s = useScreenerStore.getState();
    expect(s.results).toHaveLength(80);
    // page and sort preserved (so the user doesn't lose context after "next 50")
    expect(s.page).toBe(2);
    expect(s.sortBy).toBe("change_percent");
    expect(s.sortDir).toBe("desc");
    // lastBatchSize reflects only the most recent batch
    expect(s.lastBatchSize).toBe(30);
    expect(s.totalScanned).toBe(80);
    // isDirty cleared since we just got fresh data
    expect(s.isDirty).toBe(false);
  });
});

// ── isDirty flag ──────────────────────────────────────────────

describe("isDirty flag", () => {
  it("is set when adding a filter", () => {
    useScreenerStore.getState().addFilter(FILTER);
    expect(useScreenerStore.getState().isDirty).toBe(true);
  });

  it("is set when removing a filter", () => {
    useScreenerStore.setState({ filters: [FILTER], isDirty: false });
    useScreenerStore.getState().removeFilter(FILTER.id);
    expect(useScreenerStore.getState().isDirty).toBe(true);
  });

  it("is set when clearing all filters", () => {
    useScreenerStore.setState({ filters: [FILTER], isDirty: false });
    useScreenerStore.getState().clearFilters();
    expect(useScreenerStore.getState().isDirty).toBe(true);
  });

  it("is set when selecting a preset", () => {
    useScreenerStore.getState().setPreset(PRESET);
    expect(useScreenerStore.getState().isDirty).toBe(true);
    expect(useScreenerStore.getState().selectedPreset).toEqual(PRESET);
  });

  it("is cleared by replaceResults", () => {
    useScreenerStore.getState().addFilter(FILTER);
    expect(useScreenerStore.getState().isDirty).toBe(true);

    useScreenerStore.getState().replaceResults(makeRows(5), 5);
    expect(useScreenerStore.getState().isDirty).toBe(false);
  });
});

// ── Client-side pagination ────────────────────────────────────

describe("setPage", () => {
  it("updates page without touching results", () => {
    const rows = makeRows(50);
    useScreenerStore.getState().replaceResults(rows, 50);
    useScreenerStore.getState().setPage(2);

    const s = useScreenerStore.getState();
    expect(s.page).toBe(2);
    expect(s.results).toHaveLength(50);
  });
});

// ── Sort ──────────────────────────────────────────────────────

describe("sort", () => {
  it("defaults to natural scanner order (sortBy = '')", () => {
    expect(useScreenerStore.getState().sortBy).toBe("");
  });

  it("replaceResults always resets sort to natural order", () => {
    useScreenerStore.getState().setSort("change_percent", "asc");
    useScreenerStore.getState().replaceResults(makeRows(5), 5);
    expect(useScreenerStore.getState().sortBy).toBe("");
  });
});

// ── clearResults ──────────────────────────────────────────────

describe("clearResults", () => {
  it("empties buffer and resets page / lastBatchSize", () => {
    useScreenerStore.getState().replaceResults(makeRows(30), 30);
    useScreenerStore.getState().setPage(2);
    useScreenerStore.getState().clearResults();

    const s = useScreenerStore.getState();
    expect(s.results).toEqual([]);
    expect(s.page).toBe(1);
    expect(s.lastBatchSize).toBe(0);
    expect(s.totalScanned).toBe(0);
  });
});
