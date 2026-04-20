/**
 * ScreenerFilterBar tests — Commit 4 additions
 *
 * Covers:
 *  - Quick-pick chips rendered for popular=true catalogue entries
 *  - No chips when catalogue is empty
 *  - Grouped preset <select> renders popular in "Popular" optgroup,
 *    niche in "More screens" optgroup
 *  - Active filter pills render and remove button fires removeFilter
 *  - Clear button only appears when filters are present
 *  - AI toggle button renders only when onToggleAiPanel is provided
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FilterCatalogueEntry, ScannerPreset } from "@/lib/api";
import type { ActiveFilter } from "@/store/screener";
import ScreenerFilterBar from "./ScreenerFilterBar";

// ── Hoist the useQuery mock so vi.mock can reference it ───────

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
}));

vi.mock("@/store/screener", () => ({
  useScreenerStore: () => mockStore,
}));

vi.mock("@/components/screener/ScreenerSkeleton", () => ({
  PresetSkeleton: () => <div data-testid="preset-skeleton" />,
}));

// ── Fixtures ──────────────────────────────────────────────────

const POPULAR_ENTRY: FilterCatalogueEntry = {
  code: "priceAbove",
  label: "Price",
  direction: "above",
  unit: "$",
  example: "10",
  category: "technical",
  popular: true,
  description: "Last traded price in USD",
  paired_code: "priceBelow",
};

const NICHE_ENTRY: FilterCatalogueEntry = {
  code: "minROE",
  label: "ROE",
  direction: "above",
  unit: "%",
  example: "15",
  category: "fundamental",
  popular: false,
  description: "Return on equity — net income / shareholder equity",
  paired_code: "maxROE",
};

const MOCK_CATALOGUE: FilterCatalogueEntry[] = [POPULAR_ENTRY, NICHE_ENTRY];

const POPULAR_PRESET: ScannerPreset = {
  instrument: "STK",
  scan_type: "TOP_PERC_GAIN",
  location: "STK.US.MAJOR",
  display_name: "Top % Gainers",
  category: "popular",
};

const NICHE_PRESET: ScannerPreset = {
  instrument: "STK",
  scan_type: "TOP_OPT_VOLUME",
  location: "STK.US.MAJOR",
  display_name: "Top Options Volume",
  category: "niche",
};

const MOCK_PRESETS: ScannerPreset[] = [POPULAR_PRESET, NICHE_PRESET];

const ACTIVE_FILTER: ActiveFilter = {
  id: "f-1",
  code: "priceAbove",
  value: "10",
  display_label: "Price ≥ $10",
};

// ── Store mock (mutable so tests can change state) ────────────

const mockStore = {
  filters: [] as ActiveFilter[],
  selectedPreset: null as ScannerPreset | null,
  isScanning: false,
  results: [],
  isDirty: false,
  addFilter: vi.fn(),
  updateFilter: vi.fn(),
  removeFilter: vi.fn(),
  clearFilters: vi.fn(),
  setPreset: vi.fn(),
};

// ── Default useQuery implementation ───────────────────────────

function defaultUseQuery({ queryKey }: { queryKey: unknown[] }) {
  const key = queryKey[0];
  if (key === "screener-presets") return { data: MOCK_PRESETS, isLoading: false };
  if (key === "screener-filter-catalogue") return { data: MOCK_CATALOGUE, isLoading: false };
  return { data: undefined, isLoading: false };
}

// ── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.filters = [];
  mockStore.selectedPreset = null;
  mockStore.isScanning = false;
  mockStore.results = [];
  mockStore.isDirty = false;
  useQueryMock.mockImplementation(defaultUseQuery);
});

// ── Catalogue description tooltips ────────────────────────────

describe("Filter catalogue descriptions", () => {
  it("surfaces description as a native title tooltip in the Add Filter list", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    // Open the Add Filter dropdown
    fireEvent.click(screen.getByRole("button", { name: /Add Filter/i }));
    // Click into the Fundamental category where NICHE_ENTRY lives
    fireEvent.click(screen.getByRole("button", { name: "Fundamental" }));
    // The filter list button should expose its description via title
    const roeButton = screen.getByRole("button", { name: /ROE/i });
    expect(roeButton).toHaveAttribute(
      "title",
      "Return on equity — net income / shareholder equity",
    );
  });
});

// ── Quick-pick chips ──────────────────────────────────────────

describe("Quick-pick chips", () => {
  it("renders a chip for each popular=true catalogue entry", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.getByText("Price")).toBeInTheDocument();
  });

  it("does not render a chip for popular=false entries", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    // "ROE" is niche — should not appear as a chip button outside the dropdown
    expect(screen.queryByRole("button", { name: "ROE" })).not.toBeInTheDocument();
  });

  it("renders no chips when catalogue is empty", () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === "screener-filter-catalogue") return { data: [], isLoading: false };
      return defaultUseQuery({ queryKey });
    });
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.queryByText("Price")).not.toBeInTheDocument();
  });

  it("clicking a chip opens a value input pre-filled with the example", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    fireEvent.click(screen.getByText("Price"));
    const input = screen.getByRole("spinbutton");
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("10");
  });
});

// ── Grouped preset select ─────────────────────────────────────

describe("Grouped preset select", () => {
  it("renders popular presets inside a 'Popular' optgroup", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const select = screen.getByRole("combobox");
    const optgroups = select.querySelectorAll("optgroup");
    const popularGroup = Array.from(optgroups).find((g) => g.label === "Popular");
    expect(popularGroup).toBeDefined();
    expect(popularGroup!.querySelector("option")!.textContent).toBe("Top % Gainers");
  });

  it("renders niche presets inside a 'More screens' optgroup", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const select = screen.getByRole("combobox");
    const optgroups = select.querySelectorAll("optgroup");
    const nicheGroup = Array.from(optgroups).find((g) => g.label === "More screens");
    expect(nicheGroup).toBeDefined();
    expect(nicheGroup!.querySelector("option")!.textContent).toBe("Top Options Volume");
  });

  it("shows loading skeleton while presets are fetching", () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === "screener-presets") return { data: undefined, isLoading: true };
      return { data: MOCK_CATALOGUE, isLoading: false };
    });
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.getByTestId("preset-skeleton")).toBeInTheDocument();
  });
});

// ── Active filter pills ───────────────────────────────────────

describe("Active filter pills", () => {
  it("renders a pill for each active filter", () => {
    mockStore.filters = [ACTIVE_FILTER];
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.getByText("Price ≥ $10")).toBeInTheDocument();
  });

  it("Clear button appears only when filters are present", () => {
    mockStore.filters = [];
    const { rerender } = render(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();

    mockStore.filters = [ACTIVE_FILTER];
    rerender(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("calls removeFilter with the correct id when pill X is clicked", () => {
    mockStore.filters = [ACTIVE_FILTER];
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const removeBtn = screen.getByRole("button", {
      name: /Remove filter: Price ≥ \$10/i,
    });
    fireEvent.click(removeBtn);
    expect(mockStore.removeFilter).toHaveBeenCalledWith("f-1");
  });

  it("opens an edit popover and calls updateFilter when the pill body is clicked", () => {
    mockStore.filters = [ACTIVE_FILTER];
    render(<ScreenerFilterBar onScan={vi.fn()} />);

    // Click the pill body (not the X) to open the edit popover
    const pillBody = screen.getByRole("button", {
      name: /Edit filter: Price ≥ \$10/i,
    });
    fireEvent.click(pillBody);

    // Popover should render a number input pre-filled with the current value
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("10");

    // Change the value and save
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mockStore.updateFilter).toHaveBeenCalledWith(
      "f-1",
      "25",
      "Price ≥ 25 $",
    );
  });

  it("falls back to read-only pill when the catalogue entry is missing", () => {
    // Filter code that doesn't exist in MOCK_CATALOGUE — pill should still
    // render (with remove button) but not open an editor on click.
    mockStore.filters = [{
      id: "f-unknown",
      code: "unknownCode",
      value: "42",
      display_label: "Unknown ≥ 42",
    }];
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.getByText("Unknown ≥ 42")).toBeInTheDocument();
    // No edit-pill button (only the remove X) should exist for this filter
    expect(
      screen.queryByRole("button", { name: /Edit filter: Unknown/i }),
    ).not.toBeInTheDocument();
  });
});

// ── AI toggle button ──────────────────────────────────────────

describe("AI toggle button", () => {
  it("renders AI button when onToggleAiPanel is provided", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} onToggleAiPanel={vi.fn()} />);
    expect(screen.getByTitle("AI Filters")).toBeInTheDocument();
  });

  it("does not render AI button when onToggleAiPanel is omitted", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.queryByTitle("AI Filters")).not.toBeInTheDocument();
  });
});
