/**
 * Tests for navigation store — navigateToAnalysis sets both conid and symbol.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNavigationStore } from "../navigation";

// Mock the chart store dynamic import
vi.mock("../chart", () => ({
  useChartStore: {
    getState: vi.fn().mockReturnValue({
      setActiveConid: vi.fn(),
      setActiveSymbol: vi.fn(),
    }),
  },
}));

describe("useNavigationStore.navigateToAnalysis", () => {
  beforeEach(() => {
    useNavigationStore.setState({ activeScreen: "today" });
  });

  it("switches screen to analysis", async () => {
    useNavigationStore.getState().navigateToAnalysis(265598);
    // Give the dynamic import a tick to resolve
    await Promise.resolve();
    expect(useNavigationStore.getState().activeScreen).toBe("analysis");
  });

  it("calls setActiveConid with the provided conid", async () => {
    const { useChartStore } = await import("../chart");
    const mockState = useChartStore.getState();

    useNavigationStore.getState().navigateToAnalysis(265598, "AAPL");
    await Promise.resolve();

    expect(mockState.setActiveConid).toHaveBeenCalledWith(265598);
  });

  it("calls setActiveSymbol when symbol is provided", async () => {
    const { useChartStore } = await import("../chart");
    const mockState = useChartStore.getState();

    useNavigationStore.getState().navigateToAnalysis(265598, "AAPL");
    await Promise.resolve();

    expect(mockState.setActiveSymbol).toHaveBeenCalledWith("AAPL");
  });

  it("does not call setActiveSymbol when symbol is omitted", async () => {
    const { useChartStore } = await import("../chart");
    const mockState = useChartStore.getState();
    vi.clearAllMocks();

    useNavigationStore.getState().navigateToAnalysis(265598);
    await Promise.resolve();

    expect(mockState.setActiveSymbol).not.toHaveBeenCalled();
  });
});
