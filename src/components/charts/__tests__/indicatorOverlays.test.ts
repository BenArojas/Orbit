/**
 * Tests for volume overlay in indicatorOverlays.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { addVolumeOverlay, removeVolumeOverlay } from "../indicatorOverlays";
import type { CandleData } from "@/modules/parallax/api";

// ── Mock lightweight-charts ───────────────────────────────────

const mockSetData = vi.fn();
const mockApplyOptions = vi.fn();
const mockRemoveSeries = vi.fn();

const mockVolumeSeries = {
  setData: mockSetData,
};

const mockPriceScale = {
  applyOptions: mockApplyOptions,
};

const mockChart = {
  addSeries: vi.fn().mockReturnValue(mockVolumeSeries),
  priceScale: vi.fn().mockReturnValue(mockPriceScale),
  removeSeries: mockRemoveSeries,
};

vi.mock("lightweight-charts", () => ({
  HistogramSeries: "HistogramSeries",
  LineSeries: "LineSeries",
}));

// ── Fixtures ─────────────────────────────────────────────────

const candles: CandleData[] = [
  { time: 1700000000, open: 100, high: 110, low: 90, close: 105, volume: 1000 },
  { time: 1700003600, open: 105, high: 115, low: 100, close: 102, volume: 1500 },
  { time: 1700007200, open: 102, high: 108, low: 98,  close: 108, volume: 2000 },
];

// ── Tests ─────────────────────────────────────────────────────

describe("addVolumeOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when candles array is empty", () => {
    const result = addVolumeOverlay(mockChart as never, []);
    expect(result).toBeNull();
    expect(mockChart.addSeries).not.toHaveBeenCalled();
  });

  it("creates a histogram series and sets data when candles are provided", () => {
    const series = addVolumeOverlay(mockChart as never, candles);

    expect(series).toBe(mockVolumeSeries);
    expect(mockChart.addSeries).toHaveBeenCalledOnce();
    expect(mockSetData).toHaveBeenCalledOnce();

    const data = mockSetData.mock.calls[0][0];
    expect(data).toHaveLength(3);
    expect(data[0].value).toBe(1000);
    expect(data[1].value).toBe(1500);
    expect(data[2].value).toBe(2000);
  });

  it("colours up-candles green and down-candles red", () => {
    addVolumeOverlay(mockChart as never, candles);
    const data = mockSetData.mock.calls[0][0];

    // candle[0]: close(105) >= open(100) → up
    expect(data[0].color).toContain("0, 255, 136");
    // candle[1]: close(102) < open(105) → down
    expect(data[1].color).toContain("255, 68, 102");
    // candle[2]: close(108) >= open(102) → up
    expect(data[2].color).toContain("0, 255, 136");
  });

  it("configures the volume price scale margins", () => {
    addVolumeOverlay(mockChart as never, candles);
    expect(mockChart.priceScale).toHaveBeenCalledWith("volume");
    expect(mockApplyOptions).toHaveBeenCalledWith({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
  });
});

describe("removeVolumeOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes the series from the chart and returns null", () => {
    const result = removeVolumeOverlay(mockChart as never, mockVolumeSeries as never);
    expect(mockRemoveSeries).toHaveBeenCalledWith(mockVolumeSeries);
    expect(result).toBeNull();
  });

  it("does not throw if removeSeries raises (already removed)", () => {
    mockRemoveSeries.mockImplementationOnce(() => {
      throw new Error("Already removed");
    });
    expect(() =>
      removeVolumeOverlay(mockChart as never, mockVolumeSeries as never)
    ).not.toThrow();
  });
});
