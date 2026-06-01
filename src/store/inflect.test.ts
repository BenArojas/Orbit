/**
 * Inflect store tests — view state only (page, selected month, selected trade).
 *
 * The month-stepping math is the interesting bit: stepMonth must wrap across
 * December→January (and back) without producing month 0 or 13.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useInflectStore } from "./inflect";

function resetStore() {
  useInflectStore.setState({
    page: "calendar",
    year: 2026,
    month: 6,
    selectedTradeId: null,
  });
}

beforeEach(resetStore);

describe("setPage", () => {
  it("switches between calendar and trades", () => {
    useInflectStore.getState().setPage("trades");
    expect(useInflectStore.getState().page).toBe("trades");
    useInflectStore.getState().setPage("calendar");
    expect(useInflectStore.getState().page).toBe("calendar");
  });
});

describe("setMonth", () => {
  it("sets year and month directly", () => {
    useInflectStore.getState().setMonth(2025, 11);
    const s = useInflectStore.getState();
    expect(s.year).toBe(2025);
    expect(s.month).toBe(11);
  });
});

describe("stepMonth", () => {
  it("advances within the same year", () => {
    useInflectStore.getState().stepMonth(1);
    const s = useInflectStore.getState();
    expect(s.year).toBe(2026);
    expect(s.month).toBe(7);
  });

  it("wraps December → January of next year", () => {
    useInflectStore.getState().setMonth(2026, 12);
    useInflectStore.getState().stepMonth(1);
    const s = useInflectStore.getState();
    expect(s.year).toBe(2027);
    expect(s.month).toBe(1);
  });

  it("wraps January → December of previous year", () => {
    useInflectStore.getState().setMonth(2026, 1);
    useInflectStore.getState().stepMonth(-1);
    const s = useInflectStore.getState();
    expect(s.year).toBe(2025);
    expect(s.month).toBe(12);
  });

  it("steps backward within the same year", () => {
    useInflectStore.getState().stepMonth(-1);
    const s = useInflectStore.getState();
    expect(s.year).toBe(2026);
    expect(s.month).toBe(5);
  });

  it("never produces a month outside 1–12 across a full year of steps", () => {
    useInflectStore.getState().setMonth(2026, 1);
    for (let i = 0; i < 24; i++) {
      useInflectStore.getState().stepMonth(1);
      const m = useInflectStore.getState().month;
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(12);
    }
  });
});

describe("selectTrade", () => {
  it("sets and clears the selected trade id", () => {
    useInflectStore.getState().selectTrade("DU1:265598:e1");
    expect(useInflectStore.getState().selectedTradeId).toBe("DU1:265598:e1");
    useInflectStore.getState().selectTrade(null);
    expect(useInflectStore.getState().selectedTradeId).toBeNull();
  });
});
