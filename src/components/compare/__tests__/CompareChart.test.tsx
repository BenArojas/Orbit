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
const mockSubscribeClick = vi.fn();
const mockUnsubscribeClick = vi.fn();
const mockTimeScale = vi.fn(() => ({
  applyOptions: vi.fn(),
  fitContent: vi.fn(),
  getVisibleRange: () => null,
  setVisibleRange: vi.fn(),
  timeToCoordinate: vi.fn(() => null),
  subscribeVisibleTimeRangeChange: vi.fn(),
  unsubscribeVisibleTimeRangeChange: vi.fn(),
}));
const mockChart = {
  addSeries: mockAddSeries,
  priceScale: mockPriceScale,
  applyOptions: vi.fn(),
  subscribeCrosshairMove: mockSubscribeCrosshairMove,
  unsubscribeCrosshairMove: mockUnsubscribeCrosshairMove,
  subscribeClick: mockSubscribeClick,
  unsubscribeClick: mockUnsubscribeClick,
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
  it("mounts two line series (stock + ref)", () => {
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
    // 1 stock line + 1 ref line = 2 addSeries calls
    expect(mockAddSeries).toHaveBeenCalledTimes(2);
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
  it("mounts one line series (stock only)", () => {
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
    // 1 stock line only
    expect(mockAddSeries).toHaveBeenCalledTimes(1);
  });
});

describe("CompareChart — refOnly layout", () => {
  it("mounts one line series (ref only)", () => {
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
    // 1 ref line only
    expect(mockAddSeries).toHaveBeenCalledTimes(1);
  });
});

describe("CompareChart — layout change", () => {
  it("re-pushes data to series when layout changes (no black chart)", () => {
    const { rerender } = render(
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
    const initialSetDataCount = mockSetData.mock.calls.length;
    expect(initialSetDataCount).toBeGreaterThanOrEqual(2);

    rerender(
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
    // After layout change, setData should have been called again on the new series
    expect(mockSetData.mock.calls.length).toBeGreaterThan(initialSetDataCount);
  });
});

describe("CompareChart — no click subscription (marker feature removed)", () => {
  it("does not subscribe to chart click events", () => {
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
    expect(mockSubscribeClick).not.toHaveBeenCalled();
  });
});
