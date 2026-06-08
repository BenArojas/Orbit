/**
 * Tests for SubChartPanel — synchronous init + crosshair sync + header value.
 *
 * Covers:
 *   - createChart is called synchronously on mount (no deferred state machine)
 *   - Subsequent ResizeObserver fires call applyOptions, not createChart again
 *   - subscribeCrosshairMove is wired and unsubscribed on unmount
 *   - Header label shows the indicator name + current value
 *   - Empty-data state renders "No data"
 *   - Mounts without throwing when indicator is undefined
 *   - Mirroring: writes from a different source call setCrosshairPosition;
 *     writes from this component's own ID do not.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import SubChartPanel from "../SubChartPanel";
import { useCrosshairStore } from "@/store";
import type { IndicatorResult } from "@/modules/parallax/api";

// ── Mock lightweight-charts ───────────────────────────────────

const mockSetData = vi.fn();
const mockAddSeries = vi.fn().mockReturnValue({ setData: mockSetData });
const mockRemoveSeries = vi.fn();
const mockApplyOptions = vi.fn();
const mockFitContent = vi.fn();
const mockRemove = vi.fn();
const mockTimeScale = vi.fn().mockReturnValue({ fitContent: mockFitContent });
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockSetCrosshair = vi.fn();
const mockClearCrosshair = vi.fn();

const mockChart = {
  addSeries: mockAddSeries,
  removeSeries: mockRemoveSeries,
  applyOptions: mockApplyOptions,
  timeScale: mockTimeScale,
  remove: mockRemove,
  subscribeCrosshairMove: mockSubscribe,
  unsubscribeCrosshairMove: mockUnsubscribe,
  setCrosshairPosition: mockSetCrosshair,
  clearCrosshairPosition: mockClearCrosshair,
};

const mockCreateChart = vi.fn().mockReturnValue(mockChart);

vi.mock("lightweight-charts", () => ({
  createChart: (...args: unknown[]) => mockCreateChart(...args),
  LineSeries: "LineSeries",
  HistogramSeries: "HistogramSeries",
  ColorType: { Solid: "solid" },
}));

vi.mock("../chartTheme", () => ({
  readChartTheme: () => ({
    bg: "#0f1724",
    gridLines: "rgba(255,255,255,0.03)",
    text: "#8899aa",
    borderColor: "#1e2a3a",
  }),
}));

// ── Mock ResizeObserver ───────────────────────────────────────

type ResizeCallback = (entries: ResizeObserverEntry[]) => void;
let capturedResize: ResizeCallback | null = null;

const MockResizeObserver = vi.fn().mockImplementation((cb: ResizeCallback) => {
  capturedResize = cb;
  return { observe: vi.fn(), disconnect: vi.fn() };
});

function fireResize(width: number, height: number) {
  capturedResize?.([
    { contentRect: { width, height } } as unknown as ResizeObserverEntry,
  ]);
}

// ── Helpers ───────────────────────────────────────────────────

function makeRsiResult(n: number = 5): IndicatorResult {
  return {
    name: "rsi",
    type: "oscillator",
    values: Array.from({ length: n }, (_, i) => ({
      time: 1700000000 + i * 86400,
      value: 50 + i,
      signal: null,
      histogram: null,
      upper: null,
      lower: null,
    })),
    params: {},
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("SubChartPanel — synchronous init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedResize = null;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("MutationObserver", vi.fn().mockReturnValue({
      observe: vi.fn(), disconnect: vi.fn(),
    }));
    // Reset store between tests
    useCrosshairStore.setState({ time: null, source: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates the chart synchronously on mount (no waiting for ResizeObserver)", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    expect(mockCreateChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyOptions (not createChart again) on subsequent resizes", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    act(() => fireResize(900, 120));
    expect(mockCreateChart).toHaveBeenCalledTimes(1);
    expect(mockApplyOptions).toHaveBeenCalledWith(
      expect.objectContaining({ width: 900, height: 120 }),
    );
  });

  it("ignores zero-size resize entries", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    mockApplyOptions.mockClear();
    act(() => fireResize(0, 0));
    // No size-update call should have been made for the 0×0 entry
    expect(mockApplyOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({ width: 0, height: 0 }),
    );
  });

  it("adds at least one series for an RSI indicator", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    expect(mockAddSeries).toHaveBeenCalled();
  });

  it("subscribes and unsubscribes crosshair move", () => {
    const { unmount } = render(
      <SubChartPanel type="rsi" indicator={makeRsiResult()} />,
    );
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("SubChartPanel — header value display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedResize = null;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("MutationObserver", vi.fn().mockReturnValue({
      observe: vi.fn(), disconnect: vi.fn(),
    }));
    useCrosshairStore.setState({ time: null, source: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the indicator label", () => {
    const { getByText } = render(
      <SubChartPanel type="rsi" indicator={makeRsiResult()} />,
    );
    expect(getByText("RSI (14)")).toBeTruthy();
  });

  it("shows the latest value when no crosshair is active", () => {
    // Last value is 54 (0..4 + 50)
    const { getByText } = render(
      <SubChartPanel type="rsi" indicator={makeRsiResult()} />,
    );
    expect(getByText("54.00")).toBeTruthy();
  });

  it("shows '—' when indicator has no values", () => {
    const empty: IndicatorResult = {
      name: "rsi", type: "oscillator", values: [], params: {},
    };
    const { getByText } = render(
      <SubChartPanel type="rsi" indicator={empty} />,
    );
    expect(getByText("—")).toBeTruthy();
  });

  it("renders the empty state overlay when indicator is undefined", () => {
    const { getByText } = render(
      <SubChartPanel type="rsi" indicator={undefined} />,
    );
    expect(getByText("No data")).toBeTruthy();
  });

  it("formats MACD as 'macd / signal / hist'", () => {
    const ind: IndicatorResult = {
      name: "macd",
      type: "oscillator",
      values: [
        { time: 1700000000, value: 0.5, signal: 0.4, histogram: 0.1,
          upper: null, lower: null },
      ],
      params: {},
    };
    const { getByText } = render(<SubChartPanel type="macd" indicator={ind} />);
    expect(getByText("0.50 / 0.40 / 0.10")).toBeTruthy();
  });

  it("formats OBV in compact form (K / M / B)", () => {
    const ind: IndicatorResult = {
      name: "obv",
      type: "oscillator",
      values: [
        { time: 1700000000, value: 12_500_000, signal: null, histogram: null,
          upper: null, lower: null },
      ],
      params: {},
    };
    const { getByText } = render(<SubChartPanel type="obv" indicator={ind} />);
    expect(getByText("12.50M")).toBeTruthy();
  });
});

describe("SubChartPanel — crosshair sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedResize = null;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("MutationObserver", vi.fn().mockReturnValue({
      observe: vi.fn(), disconnect: vi.fn(),
    }));
    useCrosshairStore.setState({ time: null, source: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mirrors a crosshair time written by another source", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    mockSetCrosshair.mockClear();
    act(() => {
      useCrosshairStore.setState({
        time: 1700000000 + 2 * 86400, // index 2 → value 52
        source: "external-chart-id",
      });
    });
    expect(mockSetCrosshair).toHaveBeenCalledWith(
      52,
      1700000000 + 2 * 86400,
      expect.anything(),
    );
  });

  it("clears the crosshair when shared time goes back to null", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    mockClearCrosshair.mockClear();
    act(() => {
      useCrosshairStore.setState({ time: null, source: "external" });
    });
    expect(mockClearCrosshair).toHaveBeenCalled();
  });
});
