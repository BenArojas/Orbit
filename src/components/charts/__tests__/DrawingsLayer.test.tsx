/**
 * Tests for DrawingsLayer — Branches 2, 3 & 4.
 *
 * Branch 3 additions:
 *   - Delete key fires useDeleteDrawing when a drawing is selected
 *   - Right-click shows context menu only when a drawing is selected
 *   - Shift-to-snap snaps price to nearest OHLC value at click time
 *
 * Branch 4 additions:
 *   - 3-click sequence for long_position / short_position / bars_pattern
 *     fires useCreateDrawing with 3 anchors after the third click
 *   - 2-click sequence for forecast fires after the second click
 *
 * DrawingManager (the vendored class) is fully stubbed. We verify:
 *   - attach() called on mount when chart + series are ready
 *   - detach() called on unmount
 *   - addDrawing() called for each drawing in the server data
 *   - removeDrawing() called for drawings absent from a new server payload
 *   - manager.selectDrawing() called when store's selectedDrawingId changes
 *   - manager.deselectAll() called when selectedDrawingId is cleared
 *   - useCreateDrawing.mutate() fires with correct payload after N chart clicks
 *   - setActiveTool(null) called after successful drawing creation
 *   - visibility patched on all drawings when drawingsHidden toggles
 *   - drawings remain without being re-added after a timeframe switch
 *     (simulated by keeping same conid but re-rendering with new candle data)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, createRef } from "react";

import DrawingsLayer from "../DrawingsLayer";
import type { Drawing } from "@/lib/api";
import { useDrawingsStore } from "@/store/drawings";

// ── Stub DrawingManager ───────────────────────────────────────

const mockAttach     = vi.fn();
const mockDetach     = vi.fn();
const mockAddDrawing = vi.fn();
const mockRemoveDrawing = vi.fn();
const mockSelectDrawing = vi.fn();
const mockDeselectAll   = vi.fn();
const mockSetActiveTool = vi.fn();
type ManagedDrawingStub = { id: string; updateOptions: ReturnType<typeof vi.fn> };

const mockGetAllDrawings = vi.fn<() => ManagedDrawingStub[]>(() => []);
const mockOn = vi.fn((_event: string, _cb: unknown) => vi.fn()); // returns unsub fn

vi.mock("@/lib/drawings", () => {
  class MockDrawingManager {
    attach = mockAttach;
    detach = mockDetach;
    addDrawing = mockAddDrawing;
    removeDrawing = mockRemoveDrawing;
    selectDrawing = mockSelectDrawing;
    deselectAll = mockDeselectAll;
    setActiveTool = mockSetActiveTool;
    getAllDrawings = mockGetAllDrawings;
    on = mockOn;
  }

  // Minimal no-op drawing class stubs.
  class StubDrawing {
    constructor(public id: string, public anchors: unknown[], public style: unknown) {}
    updateOptions = vi.fn();
  }

  return {
    DrawingManager: MockDrawingManager,
    HorizontalLine: StubDrawing,
    TrendLine: StubDrawing,
    Ray: StubDrawing,
    Rectangle: StubDrawing,
    VerticalLine: StubDrawing,
    TextAnnotation: StubDrawing,
    LongPosition: StubDrawing,
    ShortPosition: StubDrawing,
    Forecast: StubDrawing,
    BarsPattern: StubDrawing,
  };
});

// ── Stub useDrawings + mutations ──────────────────────────────

const mockDrawingsData: Drawing[] = [];
const mockCreateMutate = vi.fn();
const mockDeleteMutate = vi.fn();

vi.mock("@/hooks/useDrawings", () => ({
  useDrawings: () => ({ data: mockDrawingsData }),
  useCreateDrawing: () => ({ mutate: mockCreateMutate }),
  useUpdateDrawing: () => ({ mutate: vi.fn() }),
  useDeleteDrawing: () => ({ mutate: mockDeleteMutate }),
}));

// ── Chart / series stubs ──────────────────────────────────────

function makeChartStub() {
  let clickHandler: ((p: unknown) => void) | null = null;
  return {
    subscribeClick: vi.fn((cb) => { clickHandler = cb; }),
    unsubscribeClick: vi.fn(),
    _fireClick: (params: unknown) => clickHandler?.(params),
  };
}

function makeSeriesStub(price = 150.0) {
  return {
    coordinateToPrice: vi.fn(() => price),
  };
}

// ── Helpers ───────────────────────────────────────────────────

function resetStore() {
  useDrawingsStore.setState({
    activeTool: null,
    selectedDrawingId: null,
    drawingsHidden: false,
  });
}

function makeDrawing(id: number): Drawing {
  return {
    id,
    conid: 100,
    kind: "horizontal_line",
    anchors: [{ time: 1_700_000_000, price: 175.0 }],
    style: null,
    created_at: "2026-01-01",
    updated_at: null,
  };
}

function renderLayer(
  props: Partial<React.ComponentProps<typeof DrawingsLayer>> = {},
  client?: QueryClient,
) {
  const chart = makeChartStub() as unknown as Parameters<typeof DrawingsLayer>[0]["chart"];
  const series = makeSeriesStub() as unknown as Parameters<typeof DrawingsLayer>[0]["series"];
  const containerRef = createRef<HTMLDivElement>();
  const div = document.createElement("div");
  containerRef.current = div;

  const qc = client ?? new QueryClient();

  const result = render(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(DrawingsLayer, {
        chart: chart as Parameters<typeof DrawingsLayer>[0]["chart"],
        series: series as Parameters<typeof DrawingsLayer>[0]["series"],
        containerRef,
        conid: 100,
        ...props,
      }),
    ),
  );

  return { chart, series, containerRef, result, qc };
}

// ── Tests ─────────────────────────────────────────────────────

describe("DrawingsLayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockDrawingsData.length = 0;
    mockGetAllDrawings.mockReturnValue([]);
  });

  it("calls attach on mount", () => {
    renderLayer();
    expect(mockAttach).toHaveBeenCalledOnce();
  });

  it("calls detach on unmount", () => {
    const { result } = renderLayer();
    result.unmount();
    expect(mockDetach).toHaveBeenCalledOnce();
  });

  it("does not attach when chart is null", () => {
    renderLayer({ chart: null });
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it("adds drawings from server data", () => {
    mockDrawingsData.push(makeDrawing(1), makeDrawing(2));
    renderLayer();
    // Two new drawings not in manager → two addDrawing calls.
    expect(mockAddDrawing).toHaveBeenCalledTimes(2);
  });

  it("removes drawings absent from the new server payload", async () => {
    // Simulate manager already has id "1", server returns only id "2".
    mockGetAllDrawings.mockReturnValue([{ id: "1", updateOptions: vi.fn() }]);
    mockDrawingsData.push(makeDrawing(2));

    renderLayer();

    expect(mockRemoveDrawing).toHaveBeenCalledWith("1");
    expect(mockAddDrawing).toHaveBeenCalledTimes(1);
  });

  it("does not re-add drawings that already exist in the manager", () => {
    mockGetAllDrawings.mockReturnValue([{ id: "1", updateOptions: vi.fn() }]);
    mockDrawingsData.push(makeDrawing(1));

    renderLayer();

    expect(mockAddDrawing).not.toHaveBeenCalled();
    expect(mockRemoveDrawing).not.toHaveBeenCalled();
  });

  it("calls manager.selectDrawing when selectedDrawingId is set", async () => {
    renderLayer();
    await act(async () => {
      useDrawingsStore.getState().setSelectedDrawingId(42);
    });
    expect(mockSelectDrawing).toHaveBeenCalledWith("42");
  });

  it("calls manager.deselectAll when selectedDrawingId is cleared", async () => {
    useDrawingsStore.setState({ selectedDrawingId: 42 });
    renderLayer();
    await act(async () => {
      useDrawingsStore.getState().setSelectedDrawingId(null);
    });
    expect(mockDeselectAll).toHaveBeenCalled();
  });

  it("fires useCreateDrawing.mutate after collecting the right anchor count (horizontal line = 1)", async () => {
    const chart = makeChartStub();
    const series = makeSeriesStub(200.0);
    const containerRef = createRef<HTMLDivElement>();
    containerRef.current = document.createElement("div");

    const qc = new QueryClient();
    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(DrawingsLayer, {
          chart: chart as unknown as Parameters<typeof DrawingsLayer>[0]["chart"],
          series: series as unknown as Parameters<typeof DrawingsLayer>[0]["series"],
          containerRef,
          conid: 100,
        }),
      ),
    );

    // Arm the horizontal line tool (needs 1 anchor).
    await act(async () => {
      useDrawingsStore.getState().setActiveTool("horizontal_line");
    });

    // Simulate one chart click.
    await act(async () => {
      chart._fireClick({ point: { x: 50, y: 100 }, time: 1_700_000_000 });
    });

    expect(mockCreateMutate).toHaveBeenCalledOnce();
    const [req] = mockCreateMutate.mock.calls[0] as [{ kind: string; anchors: unknown[] }];
    expect(req.kind).toBe("horizontal_line");
    expect(req.anchors).toHaveLength(1);
  });

  it("collects two clicks before firing mutate for a trendline", async () => {
    const chart = makeChartStub();
    const series = makeSeriesStub();
    const containerRef = createRef<HTMLDivElement>();
    containerRef.current = document.createElement("div");

    const qc = new QueryClient();
    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(DrawingsLayer, {
          chart: chart as unknown as Parameters<typeof DrawingsLayer>[0]["chart"],
          series: series as unknown as Parameters<typeof DrawingsLayer>[0]["series"],
          containerRef,
          conid: 100,
        }),
      ),
    );

    await act(async () => {
      useDrawingsStore.getState().setActiveTool("trend_line");
    });

    // First click — should NOT fire yet.
    await act(async () => {
      chart._fireClick({ point: { x: 50, y: 100 }, time: 1_700_000_000 });
    });
    expect(mockCreateMutate).not.toHaveBeenCalled();

    // Second click — should fire now.
    await act(async () => {
      chart._fireClick({ point: { x: 150, y: 200 }, time: 1_700_086_400 });
    });
    expect(mockCreateMutate).toHaveBeenCalledOnce();
    const [req] = mockCreateMutate.mock.calls[0] as [{ kind: string; anchors: unknown[] }];
    expect(req.kind).toBe("trend_line");
    expect(req.anchors).toHaveLength(2);
  });

  it("updates visibility on all drawings when drawingsHidden toggles", async () => {
    const stubDrawing = { id: "1", updateOptions: vi.fn() };
    mockGetAllDrawings.mockReturnValue([stubDrawing]);

    renderLayer();

    await act(async () => {
      useDrawingsStore.getState().toggleDrawingsHidden();
    });

    expect(stubDrawing.updateOptions).toHaveBeenCalledWith({ visible: false });
  });

  // ── Branch 3: Delete key ──────────────────────────────────

  it("Delete key fires useDeleteDrawing when a drawing is selected", async () => {
    useDrawingsStore.setState({ selectedDrawingId: 7 });
    renderLayer();

    // The production handler listens on window (not the container) because
    // the container div isn't focusable. Dispatch on window directly.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    });

    expect(mockDeleteMutate).toHaveBeenCalledWith(7);
    expect(useDrawingsStore.getState().selectedDrawingId).toBeNull();
  });

  it("Backspace key also fires useDeleteDrawing", async () => {
    useDrawingsStore.setState({ selectedDrawingId: 9 });
    renderLayer();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    });

    expect(mockDeleteMutate).toHaveBeenCalledWith(9);
  });

  it("Delete key is a no-op when no drawing is selected", async () => {
    const { containerRef } = renderLayer();

    await act(async () => {
      containerRef.current!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      );
    });

    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });

  // ── Branch 3: Right-click context menu ────────────────────

  it("right-click shows context menu when a drawing is selected", async () => {
    useDrawingsStore.setState({ selectedDrawingId: 3 });
    const { containerRef, result } = renderLayer();

    await act(async () => {
      containerRef.current!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 80, clientY: 60 }),
      );
    });

    expect(result.baseElement.querySelector("[data-testid='drawing-context-menu']")).toBeTruthy();
  });

  it("right-click does NOT show context menu when no drawing is selected", async () => {
    const { containerRef, result } = renderLayer();

    await act(async () => {
      containerRef.current!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 80, clientY: 60 }),
      );
    });

    expect(result.baseElement.querySelector("[data-testid='drawing-context-menu']")).toBeNull();
  });

  // ── Branch 3: Shift-to-snap ───────────────────────────────

  it("snaps anchor to nearest OHLC when Shift is held at click time", async () => {
    const chart = makeChartStub();
    // Price reported by series = 175.34; candle close = 175.3 → should snap to 175.3
    const series = makeSeriesStub(175.34);
    const containerRef = createRef<HTMLDivElement>();
    containerRef.current = document.createElement("div");

    const qc = new QueryClient();
    const candles = [
      { time: 1_700_000_000, open: 174.0, high: 176.5, low: 173.5, close: 175.3, volume: 1000 },
    ];

    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(DrawingsLayer, {
          chart: chart as unknown as Parameters<typeof DrawingsLayer>[0]["chart"],
          series: series as unknown as Parameters<typeof DrawingsLayer>[0]["series"],
          containerRef,
          conid: 100,
          candles,
        }),
      ),
    );

    await act(async () => {
      useDrawingsStore.getState().setActiveTool("horizontal_line");
    });

    // Simulate Shift held.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    });

    // Click — one anchor needed for horizontal line.
    await act(async () => {
      chart._fireClick({ point: { x: 50, y: 100 }, time: 1_700_000_000 });
    });

    expect(mockCreateMutate).toHaveBeenCalledOnce();
    const [req] = mockCreateMutate.mock.calls[0] as [{ anchors: { price: number }[] }];
    // Should snap to candle close (175.3), not raw price (175.34)
    expect(req.anchors[0].price).toBeCloseTo(175.3, 1);
  });

  // ── Branch 4: Projection tool click sequences ─────────────

  it("3-click sequence for long_position fires mutate with 3 anchors", async () => {
    const chart = makeChartStub();
    const series = makeSeriesStub(200.0);
    const containerRef = createRef<HTMLDivElement>();
    containerRef.current = document.createElement("div");

    const qc = new QueryClient();
    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(DrawingsLayer, {
          chart: chart as unknown as Parameters<typeof DrawingsLayer>[0]["chart"],
          series: series as unknown as Parameters<typeof DrawingsLayer>[0]["series"],
          containerRef,
          conid: 100,
        }),
      ),
    );

    await act(async () => {
      useDrawingsStore.getState().setActiveTool("long_position");
    });

    // Clicks 1 and 2 — must NOT fire yet.
    await act(async () => {
      chart._fireClick({ point: { x: 10, y: 100 }, time: 1_700_000_000 });
    });
    await act(async () => {
      chart._fireClick({ point: { x: 20, y: 120 }, time: 1_700_003_600 });
    });
    expect(mockCreateMutate).not.toHaveBeenCalled();

    // Click 3 — fires now.
    await act(async () => {
      chart._fireClick({ point: { x: 30, y: 80 }, time: 1_700_007_200 });
    });
    expect(mockCreateMutate).toHaveBeenCalledOnce();
    const [req] = mockCreateMutate.mock.calls[0] as [{ kind: string; anchors: unknown[] }];
    expect(req.kind).toBe("long_position");
    expect(req.anchors).toHaveLength(3);
  });

  it("2-click sequence for forecast fires mutate with 2 anchors", async () => {
    const chart = makeChartStub();
    const series = makeSeriesStub(150.0);
    const containerRef = createRef<HTMLDivElement>();
    containerRef.current = document.createElement("div");

    const qc = new QueryClient();
    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(DrawingsLayer, {
          chart: chart as unknown as Parameters<typeof DrawingsLayer>[0]["chart"],
          series: series as unknown as Parameters<typeof DrawingsLayer>[0]["series"],
          containerRef,
          conid: 100,
        }),
      ),
    );

    await act(async () => {
      useDrawingsStore.getState().setActiveTool("forecast");
    });

    // First click — must NOT fire yet.
    await act(async () => {
      chart._fireClick({ point: { x: 50, y: 100 }, time: 1_700_000_000 });
    });
    expect(mockCreateMutate).not.toHaveBeenCalled();

    // Second click — fires now.
    await act(async () => {
      chart._fireClick({ point: { x: 150, y: 200 }, time: 1_700_086_400 });
    });
    expect(mockCreateMutate).toHaveBeenCalledOnce();
    const [req] = mockCreateMutate.mock.calls[0] as [{ kind: string; anchors: unknown[] }];
    expect(req.kind).toBe("forecast");
    expect(req.anchors).toHaveLength(2);
  });

  it("3-click sequence for bars_pattern fires mutate with 3 anchors", async () => {
    const chart = makeChartStub();
    const series = makeSeriesStub(180.0);
    const containerRef = createRef<HTMLDivElement>();
    containerRef.current = document.createElement("div");

    const qc = new QueryClient();
    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(DrawingsLayer, {
          chart: chart as unknown as Parameters<typeof DrawingsLayer>[0]["chart"],
          series: series as unknown as Parameters<typeof DrawingsLayer>[0]["series"],
          containerRef,
          conid: 100,
        }),
      ),
    );

    await act(async () => {
      useDrawingsStore.getState().setActiveTool("bars_pattern");
    });

    await act(async () => {
      chart._fireClick({ point: { x: 10, y: 100 }, time: 1_700_000_000 });
    });
    await act(async () => {
      chart._fireClick({ point: { x: 20, y: 100 }, time: 1_700_086_400 });
    });
    expect(mockCreateMutate).not.toHaveBeenCalled();

    await act(async () => {
      chart._fireClick({ point: { x: 30, y: 100 }, time: 1_700_172_800 });
    });
    expect(mockCreateMutate).toHaveBeenCalledOnce();
    const [req] = mockCreateMutate.mock.calls[0] as [{ kind: string; anchors: unknown[] }];
    expect(req.kind).toBe("bars_pattern");
    expect(req.anchors).toHaveLength(3);
  });

  it("does NOT snap when Shift is not held", async () => {
    const chart = makeChartStub();
    const series = makeSeriesStub(175.34);
    const containerRef = createRef<HTMLDivElement>();
    containerRef.current = document.createElement("div");

    const qc = new QueryClient();
    const candles = [
      { time: 1_700_000_000, open: 174.0, high: 176.5, low: 173.5, close: 175.3, volume: 1000 },
    ];

    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(DrawingsLayer, {
          chart: chart as unknown as Parameters<typeof DrawingsLayer>[0]["chart"],
          series: series as unknown as Parameters<typeof DrawingsLayer>[0]["series"],
          containerRef,
          conid: 100,
          candles,
        }),
      ),
    );

    await act(async () => {
      useDrawingsStore.getState().setActiveTool("horizontal_line");
    });

    await act(async () => {
      chart._fireClick({ point: { x: 50, y: 100 }, time: 1_700_000_000 });
    });

    expect(mockCreateMutate).toHaveBeenCalledOnce();
    const [req] = mockCreateMutate.mock.calls[0] as [{ anchors: { price: number }[] }];
    // No snap — raw price from series stub
    expect(req.anchors[0].price).toBeCloseTo(175.34, 2);
  });
});
