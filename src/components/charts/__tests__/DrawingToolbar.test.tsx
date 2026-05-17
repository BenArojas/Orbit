/**
 * Tests for DrawingToolbar — Branch 3.
 *
 * Covers:
 *   - Renders one button per CORE_TOOLS entry
 *   - Clicking a tool sets activeTool in the drawings store
 *   - Second click on the active tool clears it (toggle behavior)
 *   - "Hide all" button toggles drawingsHidden
 *   - "Delete selected" is disabled when nothing is selected
 *   - "Delete selected" fires deleteDrawing and clears selectedDrawingId
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

import DrawingToolbar from "../DrawingToolbar";
import { useDrawingsStore } from "@/store/drawings";
import { CORE_TOOLS } from "../drawingsRegistry";

// ── Mocks ─────────────────────────────────────────────────────

const mockDeleteMutate = vi.fn();
vi.mock("@/hooks/useDrawings", () => ({
  useDeleteDrawing: () => ({ mutate: mockDeleteMutate }),
}));

// @base-ui/react tooltip portal needs document.body.
// The jsdom environment satisfies this — no extra setup needed.

// ── Helpers ───────────────────────────────────────────────────

function resetStore() {
  useDrawingsStore.setState({
    activeTool: null,
    selectedDrawingId: null,
    drawingsHidden: false,
  });
}

function makeWrapper() {
  const client = new QueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function renderToolbar(conid = 265598) {
  return render(
    createElement(DrawingToolbar, { conid }),
    { wrapper: makeWrapper() },
  );
}

// ── Tests ─────────────────────────────────────────────────────

describe("DrawingToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("renders one button per CORE_TOOLS entry", () => {
    renderToolbar();
    const toolbar = screen.getByTestId("drawing-toolbar");
    // Each tool button has an aria-label matching tool.label.
    for (const tool of CORE_TOOLS) {
      expect(toolbar.querySelector(`[aria-label="${tool.label}"]`)).toBeTruthy();
    }
  });

  it("clicking a tool sets activeTool in the store", () => {
    renderToolbar();
    const btn = screen.getByRole("button", { name: "Horizontal Line" });
    fireEvent.click(btn);
    expect(useDrawingsStore.getState().activeTool).toBe("horizontal_line");
  });

  it("clicking the active tool again clears it (toggle)", () => {
    useDrawingsStore.setState({ activeTool: "horizontal_line" });
    renderToolbar();
    const btn = screen.getByRole("button", { name: "Horizontal Line" });
    fireEvent.click(btn);
    expect(useDrawingsStore.getState().activeTool).toBeNull();
  });

  it("clicking a different tool replaces the active tool", () => {
    useDrawingsStore.setState({ activeTool: "horizontal_line" });
    renderToolbar();
    const btn = screen.getByRole("button", { name: "Trendline" });
    fireEvent.click(btn);
    expect(useDrawingsStore.getState().activeTool).toBe("trend_line");
  });

  it("'Hide all drawings' toggles drawingsHidden", () => {
    renderToolbar();
    const btn = screen.getByRole("button", { name: "Hide all drawings" });
    fireEvent.click(btn);
    expect(useDrawingsStore.getState().drawingsHidden).toBe(true);
  });

  it("'Show all drawings' label appears when hidden", () => {
    useDrawingsStore.setState({ drawingsHidden: true });
    renderToolbar();
    expect(screen.getByRole("button", { name: "Show all drawings" })).toBeTruthy();
  });

  it("'Delete selected' is disabled when selectedDrawingId is null", () => {
    renderToolbar();
    const btn = screen.getByRole("button", { name: "Delete selected drawing" });
    expect(btn).toBeDisabled();
  });

  it("'Delete selected' fires deleteDrawing and clears selection", () => {
    useDrawingsStore.setState({ selectedDrawingId: 42 });
    renderToolbar();
    const btn = screen.getByRole("button", { name: "Delete selected drawing" });
    fireEvent.click(btn);
    expect(mockDeleteMutate).toHaveBeenCalledWith(42);
    expect(useDrawingsStore.getState().selectedDrawingId).toBeNull();
  });
});
