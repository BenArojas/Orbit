/**
 * ScreenerPagination tests
 *
 * Covers:
 *  - Hidden when buffer empty AND no scan in flight
 *  - Visible during a fresh scan (results=0, isScanning=true) — shows "Loading…"
 *  - Visible with results, shows the count line "Found N results. Showing X–Y of N."
 *  - Mid-rescan (results>0, isScanning=true) replaces the count with "Loading…"
 *    and disables the prev/next buttons
 *  - Prev/Next call setPage when not scanning
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ScreenerResultRow } from "@/lib/api";
import ScreenerPagination from "./ScreenerPagination";

vi.mock("@/store/screener", async () => {
  const actual = await vi.importActual<typeof import("@/store/screener")>(
    "@/store/screener",
  );
  return {
    ...actual,
    useScreenerStore: () => mockStore,
  };
});

// 30 mock rows so we get exactly 2 pages at SCREENER_PAGE_SIZE=25
const MOCK_RESULTS: ScreenerResultRow[] = Array.from({ length: 30 }, (_, i) => ({
  conid: 1000 + i,
  symbol: `SYM${i}`,
  company_name: `Company ${i}`,
  sec_type: "STK",
  last_price: 100,
  change_percent: 1,
  volume: 1_000_000,
  // Path B: new fields on the row — null on regular scans (IBKR usually
  // sends scan_data but the table only renders it as a fallback when
  // last_price is null, which doesn't apply for these test fixtures).
  scan_data: null,
  scan_data_label: null,
}));

const mockStore = {
  results: [] as ScreenerResultRow[],
  page: 1,
  setPage: vi.fn(),
  isScanning: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.results = [];
  mockStore.page = 1;
  mockStore.isScanning = false;
});

describe("ScreenerPagination", () => {
  it("renders nothing when no results and not scanning", () => {
    const { container } = render(<ScreenerPagination />);
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Loading…' on a fresh scan with no prior results", () => {
    mockStore.isScanning = true;
    render(<ScreenerPagination />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it("shows the result count when results exist and not scanning", () => {
    mockStore.results = MOCK_RESULTS;
    render(<ScreenerPagination />);
    // Range text is split across spans — match by partial text.
    expect(screen.getByText(/Found/i)).toBeInTheDocument();
    expect(screen.getByText(/results/)).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
  });

  it("replaces count with 'Loading…' during a rescan and disables prev/next", () => {
    mockStore.results = MOCK_RESULTS;
    mockStore.isScanning = true;
    mockStore.page = 2;
    render(<ScreenerPagination />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/Found/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
    expect(screen.getByLabelText("Next page")).toBeDisabled();
  });

  it("calls setPage when Next clicked and not scanning", () => {
    mockStore.results = MOCK_RESULTS;
    mockStore.page = 1;
    render(<ScreenerPagination />);
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(mockStore.setPage).toHaveBeenCalledWith(2);
  });

  it("does NOT call setPage when scanning", () => {
    mockStore.results = MOCK_RESULTS;
    mockStore.page = 1;
    mockStore.isScanning = true;
    render(<ScreenerPagination />);
    // Button is disabled — fireEvent.click on a disabled button should no-op
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(mockStore.setPage).not.toHaveBeenCalled();
  });
});
