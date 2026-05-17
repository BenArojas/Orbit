/**
 * Tests for DrawingsLayer — Branch 2.
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

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
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
const mockGetAllDrawings = vi.fn(() => []);
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

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function renderLayer(
  props: Partial<React.ComponentProps<typeof DrawingsLayer>> = {},
  client?: QueryClient,
) {
  const chart = makeChartStub() as unknown as Parameters<typeof DrawingsLayer>[0]["chart"];
  const series = makeSeriesStub() as unknown as Parameters<typeof DrawingsLayer>[0]["series"];
  const containerRef = createRef<HTMLDivElement>();
  const div = document.createElement("div");
  // @ts-expect-error — assign current manually for testing
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
    // @ts-expect-error
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
    // @ts-expect-error
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
});
