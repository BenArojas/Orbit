/**
 * Tests for SubChartPanel — deferred chart creation guard.
 *
 * Covers:
 *   - Component mounts without throwing when container is initially 0×0
 *   - createChart is NOT called before ResizeObserver fires a non-zero size
 *   - createChart IS called once ResizeObserver reports non-zero dimensions
 *   - Repeated resize calls after init do not call createChart again
 *   - "No data" empty state shown when indicator has no values
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import SubChartPanel from "../SubChartPanel";
import type { IndicatorResult } from "@/lib/api";

// ── Mock lightweight-charts ───────────────────────────────────

const mockAddSeries = vi.fn().mockReturnValue({
  setData: vi.fn(),
});
const mockRemoveSeries = vi.fn();
const mockApplyOptions = vi.fn();
const mockFitContent = vi.fn();
const mockRemove = vi.fn();
const mockTimeScale = vi.fn().mockReturnValue({ fitContent: mockFitContent });

const mockChart = {
  addSeries: mockAddSeries,
  removeSeries: mockRemoveSeries,
  applyOptions: mockApplyOptions,
  timeScale: mockTimeScale,
  remove: mockRemove,
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

let capturedCallback: ResizeCallback | null = null;

const MockResizeObserver = vi.fn().mockImplementation((cb: ResizeCallback) => {
  capturedCallback = cb;
  return {
    observe: vi.fn(),
    disconnect: vi.fn(),
  };
});

// ── Helpers ───────────────────────────────────────────────────

function fireResize(width: number, height: number) {
  capturedCallback?.([
    { contentRect: { width, height } } as unknown as ResizeObserverEntry,
  ]);
}

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

describe("SubChartPanel — deferred chart creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallback = null;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("MutationObserver", vi.fn().mockReturnValue({
      observe: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not call createChart before ResizeObserver fires", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    // ResizeObserver registered but not yet fired
    expect(mockCreateChart).not.toHaveBeenCalled();
  });

  it("does not call createChart when ResizeObserver fires zero dimensions", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    act(() => fireResize(0, 0));
    expect(mockCreateChart).not.toHaveBeenCalled();
  });

  it("calls createChart once ResizeObserver reports non-zero dimensions", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    act(() => fireResize(800, 100));
    expect(mockCreateChart).toHaveBeenCalledTimes(1);
    expect(mockCreateChart).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ width: 800, height: 100 }),
    );
  });

  it("calls applyOptions (not createChart again) on subsequent resizes", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    act(() => fireResize(800, 100));
    act(() => fireResize(900, 120));
    expect(mockCreateChart).toHaveBeenCalledTimes(1);
    expect(mockApplyOptions).toHaveBeenCalledWith(
      expect.objectContaining({ width: 900, height: 120 }),
    );
  });

  it("adds series only after chart is ready", () => {
    render(<SubChartPanel type="rsi" indicator={makeRsiResult()} />);
    // Before resize — no series
    expect(mockAddSeries).not.toHaveBeenCalled();
    act(() => fireResize(800, 100));
    // After resize — series added
    expect(mockAddSeries).toHaveBeenCalled();
  });

  it("shows 'No data' empty state when indicator has no values", () => {
    const emptyIndicator: IndicatorResult = {
      name: "rsi", type: "oscillator", values: [], params: {},
    };
    const { getByText } = render(
      <SubChartPanel type="rsi" indicator={emptyIndicator} />,
    );
    expect(getByText("No data")).toBeTruthy();
  });

  it("mounts without throwing when indicator is undefined", () => {
    expect(() =>
      render(<SubChartPanel type="macd" indicator={undefined} />),
    ).not.toThrow();
  });
});
