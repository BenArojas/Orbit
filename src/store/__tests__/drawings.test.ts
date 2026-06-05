/**
 * Tests for the drawings store — Branch 2.
 *
 * Covers all slice transitions:
 *   - setActiveTool
 *   - setSelectedDrawingId
 *   - toggleDrawingsHidden
 *   - resetDrawingsForConidChange
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useDrawingsStore } from "../drawings";

// ── Helpers ──────────────────────────────────────────────────

function resetStore() {
  useDrawingsStore.setState({
    activeTool: null,
    selectedDrawingId: null,
    drawingsHidden: false,
  });
}

// ── Tests ─────────────────────────────────────────────────────

describe("drawings store", () => {
  beforeEach(() => {
    resetStore();
  });

  // setActiveTool

  it("setActiveTool sets a tool", () => {
    useDrawingsStore.getState().setActiveTool("horizontal_line");
    expect(useDrawingsStore.getState().activeTool).toBe("horizontal_line");
  });

  it("setActiveTool accepts null to clear the tool", () => {
    useDrawingsStore.getState().setActiveTool("trend_line");
    useDrawingsStore.getState().setActiveTool(null);
    expect(useDrawingsStore.getState().activeTool).toBeNull();
  });

  it("setActiveTool replaces a previously set tool", () => {
    useDrawingsStore.getState().setActiveTool("ray");
    useDrawingsStore.getState().setActiveTool("rectangle");
    expect(useDrawingsStore.getState().activeTool).toBe("rectangle");
  });

  // setSelectedDrawingId

  it("setSelectedDrawingId stores the id", () => {
    useDrawingsStore.getState().setSelectedDrawingId(42);
    expect(useDrawingsStore.getState().selectedDrawingId).toBe(42);
  });

  it("setSelectedDrawingId accepts null to clear selection", () => {
    useDrawingsStore.getState().setSelectedDrawingId(42);
    useDrawingsStore.getState().setSelectedDrawingId(null);
    expect(useDrawingsStore.getState().selectedDrawingId).toBeNull();
  });

  // toggleDrawingsHidden

  it("toggleDrawingsHidden flips false → true", () => {
    expect(useDrawingsStore.getState().drawingsHidden).toBe(false);
    useDrawingsStore.getState().toggleDrawingsHidden();
    expect(useDrawingsStore.getState().drawingsHidden).toBe(true);
  });

  it("toggleDrawingsHidden flips true → false", () => {
    useDrawingsStore.setState({ drawingsHidden: true });
    useDrawingsStore.getState().toggleDrawingsHidden();
    expect(useDrawingsStore.getState().drawingsHidden).toBe(false);
  });

  it("toggleDrawingsHidden is idempotent over two calls", () => {
    useDrawingsStore.getState().toggleDrawingsHidden();
    useDrawingsStore.getState().toggleDrawingsHidden();
    expect(useDrawingsStore.getState().drawingsHidden).toBe(false);
  });

  // resetDrawingsForConidChange

  it("resetDrawingsForConidChange clears activeTool and selectedDrawingId", () => {
    useDrawingsStore.setState({
      activeTool: "ray",
      selectedDrawingId: 7,
      drawingsHidden: true,
    });
    useDrawingsStore.getState().resetDrawingsForConidChange();
    const s = useDrawingsStore.getState();
    expect(s.activeTool).toBeNull();
    expect(s.selectedDrawingId).toBeNull();
    // drawingsHidden is NOT reset — user preference persists across conid changes
    expect(s.drawingsHidden).toBe(true);
  });

  it("resetDrawingsForConidChange is a no-op when state is already clean", () => {
    useDrawingsStore.getState().resetDrawingsForConidChange();
    const s = useDrawingsStore.getState();
    expect(s.activeTool).toBeNull();
    expect(s.selectedDrawingId).toBeNull();
    expect(s.drawingsHidden).toBe(false);
  });
});
