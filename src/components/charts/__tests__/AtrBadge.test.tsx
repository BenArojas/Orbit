/**
 * Tests for AtrBadge — toolbar numeric badge for the ATR indicator.
 *
 * Covers:
 *   - Renders null when indicators list is empty
 *   - Renders null when ATR result is present but has no values
 *   - Renders the badge with formatted value when ATR has data
 *   - Uses the last value in the series (most recent bar)
 *   - Renders null when the last value is null
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AtrBadge from "../AtrBadge";
import type { IndicatorResult } from "@/modules/parallax/api";

// ── Helpers ───────────────────────────────────────────────────

function makeAtrResult(values: Array<{ time: number; value: number | null }>): IndicatorResult {
  return {
    name: "atr",
    type: "value",
    values: values.map((v) => ({
      time: v.time,
      value: v.value,
      signal: null,
      histogram: null,
      upper: null,
      lower: null,
    })),
    params: { period: 14 },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("AtrBadge", () => {
  it("renders nothing when indicators list is empty", () => {
    const { container } = render(<AtrBadge indicators={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when ATR result has no values", () => {
    const atr = makeAtrResult([]);
    const { container } = render(<AtrBadge indicators={[atr]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when other indicators are present but not ATR", () => {
    const rsi: IndicatorResult = {
      name: "rsi",
      type: "oscillator",
      values: [{ time: 1700000000, value: 55, signal: null, histogram: null, upper: null, lower: null }],
      params: {},
    };
    const { container } = render(<AtrBadge indicators={[rsi]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders ATR label and formatted value", () => {
    const atr = makeAtrResult([
      { time: 1700000000, value: 3.12 },
      { time: 1700086400, value: 4.567 },
    ]);
    render(<AtrBadge indicators={[atr]} />);

    expect(screen.getByText("ATR")).toBeTruthy();
    // Most recent value formatted to 2 decimal places
    expect(screen.getByText("4.57")).toBeTruthy();
  });

  it("uses the last value in the series (most recent bar)", () => {
    const atr = makeAtrResult([
      { time: 1700000000, value: 1.0 },
      { time: 1700086400, value: 2.0 },
      { time: 1700172800, value: 9.99 },
    ]);
    render(<AtrBadge indicators={[atr]} />);
    expect(screen.getByText("9.99")).toBeTruthy();
  });

  it("renders nothing when last value is null", () => {
    const atr = makeAtrResult([
      { time: 1700000000, value: 2.5 },
      { time: 1700086400, value: null },
    ]);
    const { container } = render(<AtrBadge indicators={[atr]} />);
    expect(container.firstChild).toBeNull();
  });
});
