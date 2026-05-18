import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import CompareChart from "../CompareChart";

const mockApplyOptions = vi.fn();
const mockSetData = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockAddSeries = vi.fn(() => ({
  setData: mockSetData,
  update: mockUpdate,
  applyOptions: vi.fn(),
}));
const mockPriceScale = vi.fn(() => ({ applyOptions: mockApplyOptions }));
const mockSubscribeCrosshairMove = vi.fn();
const mockUnsubscribeCrosshairMove = vi.fn();
const mockTimeScale = vi.fn(() => ({
  applyOptions: vi.fn(),
  fitContent: vi.fn(),
  getVisibleRange: () => null,
  setVisibleRange: vi.fn(),
}));
const mockChart = {
  addSeries: mockAddSeries,
  priceScale: mockPriceScale,
  applyOptions: vi.fn(),
  subscribeCrosshairMove: mockSubscribeCrosshairMove,
  unsubscribeCrosshairMove: mockUnsubscribeCrosshairMove,
  timeScale: mockTimeScale,
  remove: mockRemove,
  setCrosshairPosition: vi.fn(),
  clearCrosshairPosition: vi.fn(),
};

vi.mock("lightweight-charts", async () => {
  const actual = await vi.importActual<typeof import("lightweight-charts")>("lightweight-charts");
  return {
    ...actual,
    createChart: vi.fn(() => mockChart),
  };
});

vi.mock("@/components/charts/chartTheme", () => ({
  readChartTheme: () => ({
    bg: "#000",
    gridLines: "#222",
    text: "#fff",
    borderColor: "#444",
    upColor: "#0f0",
    downColor: "#f00",
  }),
}));

// Mock the crosshair store — find the correct import path
vi.mock("@/store", () => ({
  useCrosshairStore: (selector: (s: { setHovered: () => void; time: null; source: null }) => unknown) =>
    selector({ setHovered: vi.fn(), time: null, source: null }),
}));

const CANDLES = [
  { time: 1700000000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
  { time: 1700000300, open: 101, high: 103, low: 100, close: 102, volume: 2000 },
];

const REF_CANDLES = [
  { time: 1700000000, open: 500, high: 502, low: 499, close: 501, volume: 0 },
  { time: 1700000300, open: 501, high: 503, low: 500, close: 502, volume: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", vi.fn().mockReturnValue({
    observe: vi.fn(),
    disconnect: vi.fn(),
  }));
  vi.stubGlobal("MutationObserver", vi.fn().mockReturnValue({
    observe: vi.fn(),
    disconnect: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CompareChart — overlay layout", () => {
  it("mounts two candle series and a volume histogram (for stock)", () => {
    render(
      <CompareChart
        layout="overlay"
        stockCandles={CANDLES}
        refCandles={REF_CANDLES}
        stockSymbol="AAPL"
        refSymbol="SPY"
        stockLiveTick={null}
        refLiveTick={null}
      />,
    );
    // 2 candles + 1 volume = 3 addSeries calls
    expect(mockAddSeries).toHaveBeenCalledTimes(3);
  });

  it("sets both price scales to Mode.Normal (Regular)", () => {
    render(
      <CompareChart
        layout="overlay"
        stockCandles={CANDLES}
        refCandles={REF_CANDLES}
        stockSymbol="AAPL"
        refSymbol="SPY"
        stockLiveTick={null}
        refLiveTick={null}
      />,
    );
    const calls = mockApplyOptions.mock.calls.map((c) => c[0]);
    const modes = calls.filter((c) => "mode" in c).map((c) => c.mode);
    // PriceScaleMode.Normal === 0
    expect(modes.every((m) => m === 0)).toBe(true);
    expect(modes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("CompareChart — stockOnly layout", () => {
  it("mounts one candle series + volume", () => {
    render(
      <CompareChart
        layout="stockOnly"
        stockCandles={CANDLES}
        refCandles={REF_CANDLES}
        stockSymbol="AAPL"
        refSymbol="SPY"
        stockLiveTick={null}
        refLiveTick={null}
      />,
    );
    // 1 candle + 1 volume = 2 addSeries
    expect(mockAddSeries).toHaveBeenCalledTimes(2);
  });
});

describe("CompareChart — refOnly layout", () => {
  it("mounts one candle series, no volume", () => {
    render(
      <CompareChart
        layout="refOnly"
        stockCandles={CANDLES}
        refCandles={REF_CANDLES}
        stockSymbol="AAPL"
        refSymbol="SPY"
        stockLiveTick={null}
        refLiveTick={null}
      />,
    );
    // 1 candle, no volume
    expect(mockAddSeries).toHaveBeenCalledTimes(1);
  });
});
