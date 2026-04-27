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
  locationOverride: "STK.US.MAJOR" as string,
  locationResetReason: null as string | null,
  isScanning: false,
  results: [],
  isDirty: false,
  addFilter: vi.fn(),
  updateFilter: vi.fn(),
  removeFilter: vi.fn(),
  clearFilters: vi.fn(),
  setPreset: vi.fn(),
  setLocationOverride: vi.fn(),
  setLocationResetReason: vi.fn(),
};

// Path B: locations come from the backend now (curated list — each entry
// pairs an instrument with its valid location code). This mock matches the
// shape the real /screener/locations endpoint returns.
const MOCK_LOCATIONS = [
  { instrument: "STK", location: "STK.US.MAJOR", label: "US — Listed/NASDAQ" },
  { instrument: "STK", location: "STK.US.MINOR", label: "US — OTC Markets" },
  { instrument: "STOCK.NA", location: "STK.NA.CANADA", label: "Canada" },
  { instrument: "STOCK.HK", location: "STK.HK.TSE_JPN", label: "Japan" },
  { instrument: "STOCK.EU", location: "STK.EU.LSE", label: "UK — LSE" },
];

// ── Default useQuery implementation ───────────────────────────

function defaultUseQuery({ queryKey }: { queryKey: unknown[] }) {
  const key = queryKey[0];
  if (key === "screener-presets") return { data: MOCK_PRESETS, isLoading: false };
  if (key === "screener-filter-catalogue") return { data: MOCK_CATALOGUE, isLoading: false };
  if (key === "screener-locations") return { data: MOCK_LOCATIONS, isLoading: false };
  return { data: undefined, isLoading: false };
}

// ── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.filters = [];
  mockStore.selectedPreset = null;
  mockStore.locationOverride = "STK.US.MAJOR";
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
    // NumericFilterInput is type="text" → role "textbox" (was "spinbutton" before)
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("10");
  });
});

// ── Grouped preset select ─────────────────────────────────────

describe("Grouped preset select", () => {
  it("renders popular presets inside a 'Popular' optgroup", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const select = screen.getByTestId("preset-select");
    const optgroups = select.querySelectorAll("optgroup");
    const popularGroup = Array.from(optgroups).find((g) => g.label === "Popular");
    expect(popularGroup).toBeDefined();
    expect(popularGroup!.querySelector("option")!.textContent).toBe("Top % Gainers");
  });

  it("renders niche presets inside a 'More screens' optgroup", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const select = screen.getByTestId("preset-select");
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

  it("appends preset.subtitle to the option label when present", () => {
    const presetsWithSubtitle: ScannerPreset[] = [
      POPULAR_PRESET,
      {
        instrument: "STK",
        scan_type: "TOP_OPEN_PERC_GAIN",
        location: "STK.US.MAJOR",
        display_name: "Pre-Market Gainers",
        category: "niche",
        subtitle: "Pre-market only",
      },
    ];
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === "screener-presets") return { data: presetsWithSubtitle, isLoading: false };
      return defaultUseQuery({ queryKey });
    });
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const opts = screen.getByTestId("preset-select").querySelectorAll("option");
    const text = Array.from(opts).map((o) => o.textContent).join("|");
    expect(text).toMatch(/Pre-Market Gainers — Pre-market only/);
  });

  it("renders the subtitle hint chip when the selected preset has a subtitle", () => {
    const subtitled: ScannerPreset = {
      instrument: "STK",
      scan_type: "TOP_OPEN_PERC_GAIN",
      location: "STK.US.MAJOR",
      display_name: "Pre-Market Gainers",
      category: "niche",
      subtitle: "Pre-market only",
    };
    mockStore.selectedPreset = subtitled;
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const hint = screen.getByTestId("preset-subtitle");
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent("Pre-market only");
  });

  it("does NOT render the subtitle hint chip when the selected preset has no subtitle", () => {
    mockStore.selectedPreset = POPULAR_PRESET; // no subtitle on this fixture
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.queryByTestId("preset-subtitle")).not.toBeInTheDocument();
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

    // Popover renders a NumericFilterInput (type="text" → role "textbox")
    // pre-filled with the current value. Comma-formatted on display.
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("10");

    // Change the value and save — NumericFilterInput strips commas before
    // calling onChange, so user-typed "25,000" arrives as "25000".
    fireEvent.change(input, { target: { value: "25,000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mockStore.updateFilter).toHaveBeenCalledWith(
      "f-1",
      "25000",
      "Price ≥ 25000 $",
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

// ── Clear Results button ──────────────────────────────────────

describe("Clear Results button", () => {
  it("does not render when showClearResults=false", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Clear results/i })).not.toBeInTheDocument();
  });

  it("renders and fires onClearResults when showClearResults=true", () => {
    const onClearResults = vi.fn();
    render(
      <ScreenerFilterBar
        onScan={vi.fn()}
        showClearResults
        onClearResults={onClearResults}
      />,
    );
    const btn = screen.getByRole("button", { name: /Clear results/i });
    fireEvent.click(btn);
    expect(onClearResults).toHaveBeenCalledTimes(1);
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

// ── Location dropdown (Path B — backend-sourced + instrument-aware) ──
//
// The dropdown's options come from /screener/locations (mocked above as
// MOCK_LOCATIONS). There's no longer a "Preset default" entry — the
// dropdown is always at a real location, defaulting to STK.US.MAJOR.
// When the selected preset's `instruments` array doesn't include an
// option's instrument code, that option is disabled (so the user can't
// pick a market the scan_type doesn't support).

describe("Location dropdown", () => {
  it("renders curated options from the backend", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const dropdown = screen.getByTestId("location-override") as HTMLSelectElement;
    expect(dropdown).toBeInTheDocument();
    // No "Preset default" entry any more
    expect(screen.queryByRole("option", { name: "Preset default" })).toBeNull();
    // Several curated options present
    expect(screen.getByRole("option", { name: "US — Listed/NASDAQ" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Japan" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Canada" })).toBeInTheDocument();
  });

  it("defaults to STK.US.MAJOR (US Listed/NASDAQ)", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const dropdown = screen.getByTestId("location-override") as HTMLSelectElement;
    expect(dropdown.value).toBe("STK.US.MAJOR");
  });

  it("calls setLocationOverride with the chosen IBKR code", () => {
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const dropdown = screen.getByTestId("location-override");
    fireEvent.change(dropdown, { target: { value: "STK.HK.TSE_JPN" } });
    expect(mockStore.setLocationOverride).toHaveBeenCalledWith("STK.HK.TSE_JPN");
  });

  it("reflects the current locationOverride in the dropdown value", () => {
    mockStore.locationOverride = "STK.HK.TSE_JPN";
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const dropdown = screen.getByTestId("location-override") as HTMLSelectElement;
    expect(dropdown.value).toBe("STK.HK.TSE_JPN");
  });

  it("is enabled when no preset is selected (default state)", () => {
    mockStore.selectedPreset = null;
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const dropdown = screen.getByTestId("location-override") as HTMLSelectElement;
    expect(dropdown).not.toBeDisabled();
  });

  it("is enabled when the selected preset's instrument is STK", () => {
    mockStore.selectedPreset = POPULAR_PRESET; // instrument = "STK"
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const dropdown = screen.getByTestId("location-override") as HTMLSelectElement;
    expect(dropdown).not.toBeDisabled();
  });

  it("is disabled when the selected preset's instrument is not STK (ETF/FUT)", () => {
    mockStore.selectedPreset = {
      instrument: "ETF.EQ.US",
      scan_type: "MOST_ACTIVE",
      location: "ETF.EQ.US.MAJOR",
      display_name: "Most Active — US ETFs",
      category: "niche",
    } as ScannerPreset;
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const dropdown = screen.getByTestId("location-override") as HTMLSelectElement;
    expect(dropdown).toBeDisabled();
    expect(dropdown.title).toMatch(/stock presets/i);
  });

  it("disables options whose instrument isn't in preset.instruments", () => {
    // STK preset with `instruments: ["STK"]` means ONLY US Major/Minor
    // locations are valid (those have instrument="STK"). Japan (STOCK.HK)
    // and UK (STOCK.EU) should be disabled.
    mockStore.selectedPreset = {
      ...POPULAR_PRESET,
      instruments: ["STK"],
    } as ScannerPreset;
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const usOption = screen.getByRole("option", {
      name: /US — Listed\/NASDAQ/,
    }) as HTMLOptionElement;
    const japanOption = screen.getByRole("option", { name: /Japan/ }) as HTMLOptionElement;
    expect(usOption.disabled).toBe(false);
    expect(japanOption.disabled).toBe(true);
    // Disabled options carry a tooltip explaining why
    expect(japanOption.title).toMatch(/Not available/i);
  });

  it("enables all options when preset.instruments covers them all", () => {
    mockStore.selectedPreset = {
      ...POPULAR_PRESET,
      instruments: ["STK", "STOCK.HK", "STOCK.EU", "STOCK.NA"],
    } as ScannerPreset;
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const japanOption = screen.getByRole("option", { name: /Japan/ }) as HTMLOptionElement;
    const ukOption = screen.getByRole("option", { name: /UK/ }) as HTMLOptionElement;
    expect(japanOption.disabled).toBe(false);
    expect(ukOption.disabled).toBe(false);
  });

  it("enables all options when preset has no instruments info yet", () => {
    // Presets list still loading — don't punish users by blocking the
    // dropdown until the array arrives. Empty `instruments` ⇒ permissive.
    mockStore.selectedPreset = {
      ...POPULAR_PRESET,
      instruments: [],
    } as ScannerPreset;
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const japanOption = screen.getByRole("option", { name: /Japan/ }) as HTMLOptionElement;
    expect(japanOption.disabled).toBe(false);
  });
});

// ── Scan button styling (Commit 3 — primary CTA) ──────────────

describe("Scan button (primary CTA)", () => {
  it("uses solid amber styling so it stands out from cyan UI", () => {
    mockStore.selectedPreset = POPULAR_PRESET;
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const scanBtn = screen.getByRole("button", { name: /Scan/i });
    // Solid amber background + dark text — distinguishes from the
    // tinted-cyan AI button + filter pills.
    expect(scanBtn.className).toMatch(/bg-\[var\(--clr-orange\)\]/);
    expect(scanBtn.className).toMatch(/text-\[var\(--bg-0\)\]/);
    expect(scanBtn.className).toMatch(/font-semibold/);
  });

  it("renders a CYAN dirty-pulse dot (not amber) so it pops on the amber button", () => {
    // results > 0 + isDirty = true triggers the pulse
    mockStore.selectedPreset = POPULAR_PRESET;
    mockStore.results = [{ conid: 1 }] as unknown as typeof mockStore.results;
    mockStore.isDirty = true;
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    const pulse = screen.getByTestId("scan-dirty-pulse");
    expect(pulse).toBeInTheDocument();
    // Cyan, NOT amber — visibility against the amber button
    expect(pulse.innerHTML).toMatch(/bg-\[var\(--clr-cyan\)\]/);
    expect(pulse.innerHTML).not.toMatch(/bg-\[var\(--clr-orange\)\]/);
  });

  it("hides the pulse when no results yet", () => {
    mockStore.selectedPreset = POPULAR_PRESET;
    mockStore.results = [];
    mockStore.isDirty = true;
    render(<ScreenerFilterBar onScan={vi.fn()} />);
    expect(screen.queryByTestId("scan-dirty-pulse")).toBeNull();
  });
});

// ── "Browse all scans →" preset dropdown entry (Path C) ───────

describe("Browse all scans entry", () => {
  it("renders the Browse entry only when onOpenBrowseAllScans is provided", () => {
    const { rerender } = render(<ScreenerFilterBar onScan={vi.fn()} />);
    // No prop ⇒ no entry
    expect(
      screen.queryByRole("option", { name: /Browse all scans/i }),
    ).toBeNull();

    rerender(
      <ScreenerFilterBar onScan={vi.fn()} onOpenBrowseAllScans={vi.fn()} />,
    );
    expect(
      screen.getByRole("option", { name: /Browse all scans/i }),
    ).toBeInTheDocument();
  });

  it("calls onOpenBrowseAllScans (and NOT setPreset) when the Browse entry is picked", () => {
    const onOpenBrowse = vi.fn();
    render(<ScreenerFilterBar onScan={vi.fn()} onOpenBrowseAllScans={onOpenBrowse} />);
    const select = screen.getByTestId("preset-select");
    fireEvent.change(select, { target: { value: "__BROWSE_ALL_SCANS__" } });
    expect(onOpenBrowse).toHaveBeenCalledTimes(1);
    expect(mockStore.setPreset).not.toHaveBeenCalled();
  });
});
