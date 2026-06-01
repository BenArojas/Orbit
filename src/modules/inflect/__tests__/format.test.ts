/**
 * Inflect formatter tests — null/non-finite guards, signed money, hold-time
 * compaction, and the month label.
 */

import { describe, it, expect } from "vitest";
import {
  formatHold,
  formatMonthLabel,
  formatNumber,
  formatPercent,
  formatSignedMoney,
} from "../format";

describe("formatSignedMoney", () => {
  it("prefixes a + on positive values", () => {
    expect(formatSignedMoney(1234)).toBe("+$1,234");
  });

  it("keeps the native minus on negatives (no double sign)", () => {
    expect(formatSignedMoney(-50.5)).toBe("-$50.50");
  });

  it("returns -- for null/non-finite", () => {
    expect(formatSignedMoney(null)).toBe("--");
    expect(formatSignedMoney(Number.NaN)).toBe("--");
  });
});

describe("formatNumber / formatPercent", () => {
  it("guards null/non-finite", () => {
    expect(formatNumber(undefined)).toBe("--");
    expect(formatPercent(null)).toBe("--");
  });

  it("signs percent and fixes 2 decimals", () => {
    expect(formatPercent(10)).toBe("+10.00%");
    expect(formatPercent(-3.5)).toBe("-3.50%");
  });
});

describe("formatHold", () => {
  it("renders seconds, minutes, hours, and days compactly", () => {
    expect(formatHold(45)).toBe("45s");
    expect(formatHold(120)).toBe("2m");
    expect(formatHold(3 * 3600 + 30 * 60)).toBe("3h 30m");
    expect(formatHold(2 * 86400 + 5 * 3600)).toBe("2d 5h");
  });

  it("guards null/negative", () => {
    expect(formatHold(null)).toBe("--");
    expect(formatHold(-1)).toBe("--");
  });
});

describe("formatMonthLabel", () => {
  it("renders a 1-based month with its year", () => {
    expect(formatMonthLabel(2026, 6)).toBe("June 2026");
    expect(formatMonthLabel(2026, 1)).toBe("January 2026");
    expect(formatMonthLabel(2026, 12)).toBe("December 2026");
  });
});
