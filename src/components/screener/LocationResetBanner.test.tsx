/**
 * LocationResetBanner tests — transient amber strip rendered when the
 * Browse all scans panel had to auto-reset the location override.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import LocationResetBanner from "./LocationResetBanner";

// Mutable module-level mock state — flipped per test before render.
const mockSetReason = vi.fn();
let mockReason: string | null = null;

vi.mock("@/store/screener", () => ({
  useScreenerStore: (selector: (s: unknown) => unknown) =>
    selector({
      locationResetReason: mockReason,
      setLocationResetReason: mockSetReason,
    }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  mockSetReason.mockClear();
  mockReason = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LocationResetBanner", () => {
  it("renders nothing when locationResetReason is null", () => {
    mockReason = null;
    const { container } = render(<LocationResetBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the reason text when locationResetReason is set", () => {
    mockReason =
      "Location reset to US — Listed/NASDAQ. After-Hours Gainers isn't available outside US Stocks.";
    render(<LocationResetBanner />);
    expect(screen.getByTestId("location-reset-banner")).toBeInTheDocument();
    expect(screen.getByText(/Location reset/)).toBeInTheDocument();
    expect(screen.getByText(/After-Hours Gainers/)).toBeInTheDocument();
  });

  it("auto-dismisses after 5 seconds", () => {
    mockReason = "Location reset to US.";
    render(<LocationResetBanner />);
    // Not dismissed before the timer fires
    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(mockSetReason).not.toHaveBeenCalled();
    // Tip past 5s — auto-dismiss fires
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(mockSetReason).toHaveBeenCalledWith(null);
  });

  it("clears immediately when the dismiss button is clicked", () => {
    mockReason = "Location reset to US.";
    render(<LocationResetBanner />);
    const dismiss = screen.getByLabelText("Dismiss");
    act(() => {
      dismiss.click();
    });
    expect(mockSetReason).toHaveBeenCalledWith(null);
  });
});
