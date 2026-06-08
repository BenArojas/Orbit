/**
 * BrowseAllScansPanel tests — Path C slide-over with the full IBKR
 * scan-type catalogue.
 *
 * Covers:
 *  - Renders nothing when isOpen=false
 *  - Header / search / categorized sections render
 *  - Search filters across code + display_name
 *  - Picking a row builds a synthetic preset and calls onPick
 *  - When the picked scan's instruments doesn't include the current
 *    location override's instrument, location is reset to STK.US.MAJOR
 *    and the banner reason is set
 *  - When picking a scan compatible with the current location, no reset
 *  - Curated chip renders only on is_curated rows
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ScannerPreset, ScannerScanType, ScannerLocation } from "@/modules/parallax/api";
import BrowseAllScansPanel from "./BrowseAllScansPanel";

// ── Hoist the useQuery mock ───────────────────────────────────

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
}));

// ── Store mock — selector signature ───────────────────────────

const setLocationOverrideMock = vi.fn();
const setLocationResetReasonMock = vi.fn();
let mockLocationOverride = "STK.US.MAJOR";

vi.mock("@/store/screener", () => ({
  useScreenerStore: (selector: (s: unknown) => unknown) =>
    selector({
      locationOverride: mockLocationOverride,
      setLocationOverride: setLocationOverrideMock,
      setLocationResetReason: setLocationResetReasonMock,
    }),
  DEFAULT_LOCATION_CODE: "STK.US.MAJOR",
}));

// ── Fixtures ──────────────────────────────────────────────────

const MOCK_SCANS: ScannerScanType[] = [
  {
    code: "TOP_PERC_GAIN",
    display_name: "Top % Gainers",
    instruments: ["STK", "STOCK.HK", "STOCK.EU"],
    group: "movers",
    is_curated: true,
  },
  {
    code: "MOST_ACTIVE_USD",
    display_name: "Most Active (Dollar Volume)",
    instruments: ["STK"],
    group: "movers",
    is_curated: true,
  },
  {
    code: "TOP_AFTER_HOURS_PERC_GAIN",
    display_name: "After-Hours Gainers",
    instruments: ["STK"], // US-only
    group: "pre_post_market",
    is_curated: true,
  },
  {
    code: "ZZZ_SOMETHING_NEW",
    display_name: "Some New Scan",
    instruments: ["STK"],
    group: "other",
    is_curated: false,
  },
];

const MOCK_LOCATIONS: ScannerLocation[] = [
  { instrument: "STK", location: "STK.US.MAJOR", label: "US — Listed/NASDAQ" },
  { instrument: "STOCK.HK", location: "STK.HK.TSE_JPN", label: "Japan" },
];

function setupQueries() {
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === "screener-all-scan-types") {
      return { data: MOCK_SCANS, isLoading: false };
    }
    if (queryKey[0] === "screener-locations") {
      return { data: MOCK_LOCATIONS, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  });
}

// ── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockLocationOverride = "STK.US.MAJOR";
  setupQueries();
});

// ── Visibility ────────────────────────────────────────────────

describe("Panel visibility", () => {
  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <BrowseAllScansPanel
        isOpen={false}
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel header when isOpen=true", () => {
    render(
      <BrowseAllScansPanel
        isOpen={true}
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("browse-all-scans-panel")).toBeInTheDocument();
    expect(screen.getByText("Browse all scans")).toBeInTheDocument();
  });

  it("calls onClose when the × button is clicked", () => {
    const onClose = vi.fn();
    render(
      <BrowseAllScansPanel isOpen={true} onClose={onClose} onPick={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});

// ── Search ────────────────────────────────────────────────────

describe("Search", () => {
  it("filters rows across code and display_name", () => {
    render(
      <BrowseAllScansPanel
        isOpen={true}
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );

    // Initial: all scans visible (curated movers section is auto-expanded)
    expect(screen.getByText("Top % Gainers")).toBeInTheDocument();

    // Type into search — only matching rows survive
    fireEvent.change(screen.getByPlaceholderText("Search scans…"), {
      target: { value: "after" },
    });
    expect(screen.getByText("After-Hours Gainers")).toBeInTheDocument();
    expect(screen.queryByText("Top % Gainers")).toBeNull();
  });
});

// ── Picking a row ─────────────────────────────────────────────

describe("Picking a scan", () => {
  it("builds a synthetic preset and calls onPick + onClose", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <BrowseAllScansPanel isOpen={true} onClose={onClose} onPick={onPick} />,
    );

    fireEvent.click(screen.getByTestId("browse-scan-row-TOP_PERC_GAIN"));

    expect(onPick).toHaveBeenCalledTimes(1);
    const preset = onPick.mock.calls[0][0] as ScannerPreset;
    expect(preset.scan_type).toBe("TOP_PERC_GAIN");
    expect(preset.display_name).toBe("Top % Gainers");
    expect(preset.instruments).toEqual(["STK", "STOCK.HK", "STOCK.EU"]);
    expect(preset.group).toBe("movers");
    expect(onClose).toHaveBeenCalled();
  });
});

// ── Location auto-reset on incompatible pick ──────────────────

describe("Location override reset", () => {
  // Helper: only the first category section (Movers) is auto-expanded;
  // every other section starts collapsed. Tests that need to click into a
  // non-Movers row must expand its section first.
  function expandSection(label: RegExp) {
    const header = screen.getByRole("button", { name: label });
    fireEvent.click(header);
  }

  it("resets location to STK.US.MAJOR when picked scan doesn't support current instrument", () => {
    // Current override is Japan (STOCK.HK). Pick After-Hours Gainers
    // which only supports STK → reset must fire.
    mockLocationOverride = "STK.HK.TSE_JPN";

    render(
      <BrowseAllScansPanel
        isOpen={true}
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );

    expandSection(/Pre \/ Post Market/);
    fireEvent.click(
      screen.getByTestId("browse-scan-row-TOP_AFTER_HOURS_PERC_GAIN"),
    );

    expect(setLocationOverrideMock).toHaveBeenCalledWith("STK.US.MAJOR");
    expect(setLocationResetReasonMock).toHaveBeenCalledTimes(1);
    const reason = setLocationResetReasonMock.mock.calls[0][0] as string;
    expect(reason).toMatch(/Location reset to US/);
    expect(reason).toMatch(/After-Hours Gainers/);
  });

  it("does NOT reset when picked scan supports current instrument", () => {
    // Current override is Japan (STOCK.HK). Pick TOP_PERC_GAIN whose
    // instruments includes STOCK.HK → no reset. (Movers auto-expanded,
    // no expand needed.)
    mockLocationOverride = "STK.HK.TSE_JPN";

    render(
      <BrowseAllScansPanel
        isOpen={true}
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("browse-scan-row-TOP_PERC_GAIN"));

    expect(setLocationOverrideMock).not.toHaveBeenCalled();
    expect(setLocationResetReasonMock).not.toHaveBeenCalled();
  });

  it("does NOT reset when current override is US default and US is supported", () => {
    mockLocationOverride = "STK.US.MAJOR";

    render(
      <BrowseAllScansPanel
        isOpen={true}
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );

    expandSection(/Pre \/ Post Market/);
    fireEvent.click(
      screen.getByTestId("browse-scan-row-TOP_AFTER_HOURS_PERC_GAIN"),
    );

    expect(setLocationOverrideMock).not.toHaveBeenCalled();
    expect(setLocationResetReasonMock).not.toHaveBeenCalled();
  });
});

// ── Curated marker ────────────────────────────────────────────

describe("Curated marker", () => {
  it("shows the 'curated' chip on rows where is_curated=true", () => {
    render(
      <BrowseAllScansPanel
        isOpen={true}
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    // TOP_PERC_GAIN is curated
    const curatedRow = screen.getByTestId("browse-scan-row-TOP_PERC_GAIN");
    expect(curatedRow.textContent).toMatch(/curated/i);
  });
});
