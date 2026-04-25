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
    locationOverride: null,
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

// ── applyPreset ───────────────────────────────────────────────
// Used by empty-state "Try this" cards — sets preset + filters atomically
// and keeps isDirty=false so no stale amber pulse appears.

describe("applyPreset", () => {
  it("sets selectedPreset and filters atomically", () => {
    const filters: ActiveFilter[] = [FILTER];
    useScreenerStore.getState().applyPreset(PRESET, filters);

    const s = useScreenerStore.getState();
    expect(s.selectedPreset).toEqual(PRESET);
    expect(s.filters).toEqual(filters);
  });

  it("does NOT set isDirty (caller fires scan immediately)", () => {
    useScreenerStore.getState().applyPreset(PRESET, [FILTER]);
    expect(useScreenerStore.getState().isDirty).toBe(false);
  });

  it("resets page to 1", () => {
    useScreenerStore.setState({ page: 3 });
    useScreenerStore.getState().applyPreset(PRESET, []);
    expect(useScreenerStore.getState().page).toBe(1);
  });

  it("does not clear isDirty that was already false before call", () => {
    useScreenerStore.setState({ isDirty: false });
    useScreenerStore.getState().applyPreset(PRESET, [FILTER]);
    expect(useScreenerStore.getState().isDirty).toBe(false);
  });

  it("clears isDirty even if it was true before call", () => {
    // User had previously dirtied the store, then clicked an empty-state card
    useScreenerStore.getState().addFilter(FILTER);
    expect(useScreenerStore.getState().isDirty).toBe(true);

    const anotherFilter: ActiveFilter = { id: "f-2", code: "volumeAbove", value: "1000000", display_label: "Volume ≥ 1M" };
    useScreenerStore.getState().applyPreset(PRESET, [anotherFilter]);

    const s = useScreenerStore.getState();
    expect(s.isDirty).toBe(false);
    expect(s.filters).toHaveLength(1);
    expect(s.filters[0].code).toBe("volumeAbove");
  });
});

// ── setPreset preserves filters (Task #17) ────────────────────
// Bug fix: previously setPreset wiped filters to preset.default_filters
// (or [] when none existed), which silently destroyed AI-suggested filters
// the user had just accepted. New behavior: scanner picker only updates
// selectedPreset; filters stay put.

describe("setPreset", () => {
  it("preserves existing filters when picking a new scanner", () => {
    useScreenerStore.getState().addFilter(FILTER);
    expect(useScreenerStore.getState().filters).toHaveLength(1);

    useScreenerStore.getState().setPreset(PRESET);

    const s = useScreenerStore.getState();
    expect(s.selectedPreset).toEqual(PRESET);
    // Filter survives — this is the whole point of the fix
    expect(s.filters).toHaveLength(1);
    expect(s.filters[0].code).toBe("priceAbove");
    expect(s.isDirty).toBe(true);
    expect(s.page).toBe(1);
  });

  it("does NOT auto-apply preset.default_filters", () => {
    // Even when a preset has bundled defaults, setPreset must not splat
    // them on top of the user's existing filter list. Try-this empty-state
    // cards still get the bundled-defaults behavior via applyPreset().
    const presetWithDefaults: ScannerPreset = {
      ...PRESET,
      default_filters: [{ code: "minPeRatio", value: "5" }],
    };
    useScreenerStore.getState().addFilter(FILTER);
    useScreenerStore.getState().setPreset(presetWithDefaults);

    const codes = useScreenerStore.getState().filters.map((f) => f.code);
    expect(codes).toEqual(["priceAbove"]); // bundled minPeRatio NOT added
  });
});

// ── setLocationOverride (Task #19 — decouple location from preset) ──

describe("setLocationOverride", () => {
  it("defaults to null", () => {
    expect(useScreenerStore.getState().locationOverride).toBeNull();
  });

  it("sets the override and marks dirty", () => {
    useScreenerStore.getState().setLocationOverride("STK.JP.TSE");
    const s = useScreenerStore.getState();
    expect(s.locationOverride).toBe("STK.JP.TSE");
    expect(s.isDirty).toBe(true);
    expect(s.page).toBe(1);
  });

  it("can be cleared by passing null", () => {
    useScreenerStore.getState().setLocationOverride("STK.UK.LSE");
    useScreenerStore.getState().setLocationOverride(null);
    expect(useScreenerStore.getState().locationOverride).toBeNull();
  });

  it("is independent of selectedPreset", () => {
    // Setting a location override doesn't touch the selected preset
    useScreenerStore.getState().setPreset(PRESET);
    useScreenerStore.getState().setLocationOverride("STK.JP.TSE");

    const s = useScreenerStore.getState();
    expect(s.selectedPreset).toEqual(PRESET);
    expect(s.locationOverride).toBe("STK.JP.TSE");
  });

  it("is reset by resetScreener", () => {
    useScreenerStore.getState().setLocationOverride("STK.JP.TSE");
    useScreenerStore.getState().resetScreener();
    expect(useScreenerStore.getState().locationOverride).toBeNull();
  });
});

// ── updateFilter (Task #18 — wires AI panel "Update" button) ────────
// Already exercised by the pill click-to-edit flow, but the AI panel now
// reuses it to replace a filter value rather than creating a duplicate.

describe("updateFilter (AI replace flow)", () => {
  it("replaces value + display_label on the matching filter id", () => {
    useScreenerStore.getState().addFilter(FILTER); // priceAbove = 10
    useScreenerStore
      .getState()
      .updateFilter(FILTER.id, "25", "Price ≥ 25");

    const f = useScreenerStore.getState().filters[0];
    expect(f.value).toBe("25");
    expect(f.display_label).toBe("Price ≥ 25");
    // Filter count stays at 1 — proves no duplicate was created
    expect(useScreenerStore.getState().filters).toHaveLength(1);
  });
});
