/**
 * Tests for chartTheme.ts — readChartTheme reads CSS custom properties.
 */

import { describe, it, expect } from "vitest";
import { readChartTheme } from "../chartTheme";

function mockGetComputedStyle(vars: Record<string, string>) {
  const original = global.getComputedStyle;
  Object.defineProperty(global, "getComputedStyle", {
    value: () => ({
      getPropertyValue: (prop: string) => vars[prop] ?? "",
    }),
    configurable: true,
  });
  return () => {
    Object.defineProperty(global, "getComputedStyle", {
      value: original,
      configurable: true,
    });
  };
}

describe("readChartTheme", () => {
  it("returns values from CSS custom properties", () => {
    const restore = mockGetComputedStyle({
      "--bg-0":       " #05080e",
      "--chart-grid": " rgba(255, 255, 255, 0.03)",
      "--text-3":     " #4a5568",
      "--border":     " rgba(255, 255, 255, 0.06)",
    });

    const theme = readChartTheme();
    expect(theme.bg).toBe("#05080e");
    expect(theme.gridLines).toBe("rgba(255, 255, 255, 0.03)");
    expect(theme.text).toBe("#4a5568");
    expect(theme.borderColor).toBe("rgba(255, 255, 255, 0.06)");

    restore();
  });

  it("trims whitespace from CSS variable values", () => {
    const restore = mockGetComputedStyle({
      "--bg-0":       "  #05080e  ",
      "--chart-grid": "  rgba(0,0,0,0.1)  ",
      "--text-3":     "  #aaa  ",
      "--border":     "  #bbb  ",
    });

    const theme = readChartTheme();
    expect(theme.bg).toBe("#05080e");
    expect(theme.gridLines).toBe("rgba(0,0,0,0.1)");

    restore();
  });

  it("returns empty strings for missing CSS variables", () => {
    const restore = mockGetComputedStyle({});

    const theme = readChartTheme();
    expect(theme.bg).toBe("");
    expect(theme.gridLines).toBe("");
    expect(theme.text).toBe("");
    expect(theme.borderColor).toBe("");

    restore();
  });
});
