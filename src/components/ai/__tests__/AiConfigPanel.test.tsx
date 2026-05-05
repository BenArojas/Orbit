/**
 * Tests for AiConfigPanel — configuration panel for AI analysis.
 *
 * Covers:
 *   - Renders timeframe chips and indicator chips
 *   - "Run Analysis" button is disabled when no timeframes or indicators selected
 *   - onRunAnalysis is called with the correct shape (no 'mode' field)
 *   - "Manual" toggle is NOT present (was removed in Branch 4)
 *   - Chip selection/deselection works
 *   - chartIndicators prop seeds the initial indicator selection
 *   - Context mode chip row renders all 4 options
 *   - Clicking a context mode chip selects it (and deselects others)
 *   - Clicking the active context mode chip deselects back to "none"
 *   - Slider appears when a non-None mode is selected
 *   - Slider is hidden when mode is "none"
 *   - onRunAnalysis receives contextMode and contextBars
 *   - Bar count defaults change when mode changes
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AiConfigPanel from "../AiConfigPanel";

// ── Tests ─────────────────────────────────────────────────────

describe("AiConfigPanel", () => {
  it("renders timeframe chips", () => {
    render(<AiConfigPanel />);
    for (const tf of ["1H", "4H", "D", "W"]) {
      expect(screen.getByText(tf)).toBeTruthy();
    }
  });

  it("renders indicator chips", () => {
    render(<AiConfigPanel />);
    expect(screen.getByText("RSI")).toBeTruthy();
    expect(screen.getByText("MACD")).toBeTruthy();
    expect(screen.getByText("EMA Stack")).toBeTruthy();
  });

  it("does NOT render a Manual toggle button", () => {
    render(<AiConfigPanel />);
    expect(screen.queryByText("Manual")).toBeNull();
    expect(screen.queryByText("AI Assist")).toBeNull();
  });

  it("calls onRunAnalysis with timeframes, indicators, contextMode, contextBars", () => {
    const onRun = vi.fn();
    render(<AiConfigPanel onRunAnalysis={onRun} />);

    fireEvent.click(screen.getByText("▶ Run Analysis").closest("button")!);

    expect(onRun).toHaveBeenCalledTimes(1);
    const [config] = onRun.mock.calls[0];

    expect(Array.isArray(config.timeframes)).toBe(true);
    expect(Array.isArray(config.indicators)).toBe(true);
    expect(config.contextMode).toBe("none");
    expect(typeof config.contextBars).toBe("number");
    expect("mode" in config).toBe(false); // old field must be gone
  });

  it("run button is disabled when no timeframe is selected", () => {
    render(<AiConfigPanel />);
    fireEvent.click(screen.getByText("4H"));
    fireEvent.click(screen.getByText("D"));

    const runBtn = screen.getByText("▶ Run Analysis").closest("button")!;
    expect(runBtn).toBeDisabled();
  });

  it("toggling a chip removes it from the next onRunAnalysis call", () => {
    const onRun = vi.fn();
    render(<AiConfigPanel onRunAnalysis={onRun} />);

    fireEvent.click(screen.getByText("4H")); // deselect

    fireEvent.click(screen.getByText("▶ Run Analysis").closest("button")!);
    const [config] = onRun.mock.calls[0];
    expect(config.timeframes).not.toContain("4H");
  });

  it("mirrors chartIndicators into initial indicator selection", () => {
    const chartIndicators = new Set(["rsi", "macd"] as const);
    const onRun = vi.fn();
    render(<AiConfigPanel onRunAnalysis={onRun} chartIndicators={chartIndicators} />);

    fireEvent.click(screen.getByText("▶ Run Analysis").closest("button")!);
    const [config] = onRun.mock.calls[0];
    expect(config.indicators).toContain("RSI");
    expect(config.indicators).toContain("MACD");
  });

  // ── Context mode chip row ──────────────────────────────────

  it("renders all four context mode chips", () => {
    render(<AiConfigPanel />);
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByText("Price Summary")).toBeTruthy();
    expect(screen.getByText("OHLCV History")).toBeTruthy();
    expect(screen.getByText("Patterns")).toBeTruthy();
  });

  it("slider is NOT shown when context mode is None (default)", () => {
    render(<AiConfigPanel />);
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("slider appears when Price Summary is selected", () => {
    render(<AiConfigPanel />);
    fireEvent.click(screen.getByText("Price Summary"));
    expect(screen.getByRole("slider")).toBeTruthy();
  });

  it("slider appears when OHLCV History is selected", () => {
    render(<AiConfigPanel />);
    fireEvent.click(screen.getByText("OHLCV History"));
    expect(screen.getByRole("slider")).toBeTruthy();
  });

  it("slider appears when Patterns is selected", () => {
    render(<AiConfigPanel />);
    fireEvent.click(screen.getByText("Patterns"));
    expect(screen.getByRole("slider")).toBeTruthy();
  });

  it("clicking the active mode chip again deselects back to None and hides slider", () => {
    render(<AiConfigPanel />);
    fireEvent.click(screen.getByText("Price Summary")); // select
    expect(screen.getByRole("slider")).toBeTruthy();

    fireEvent.click(screen.getByText("Price Summary")); // deselect
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("switching modes keeps the slider visible", () => {
    render(<AiConfigPanel />);
    fireEvent.click(screen.getByText("Price Summary"));
    fireEvent.click(screen.getByText("Patterns")); // switch

    expect(screen.getByRole("slider")).toBeTruthy();
  });

  it("onRunAnalysis receives the selected contextMode", () => {
    const onRun = vi.fn();
    render(<AiConfigPanel onRunAnalysis={onRun} />);

    fireEvent.click(screen.getByText("Price Summary"));
    fireEvent.click(screen.getByText("▶ Run Analysis").closest("button")!);

    const [config] = onRun.mock.calls[0];
    expect(config.contextMode).toBe("summary");
  });

  it("onRunAnalysis receives the default bar count for the selected mode", () => {
    const onRun = vi.fn();
    render(<AiConfigPanel onRunAnalysis={onRun} />);

    fireEvent.click(screen.getByText("OHLCV History")); // default = 15 bars
    fireEvent.click(screen.getByText("▶ Run Analysis").closest("button")!);

    const [config] = onRun.mock.calls[0];
    expect(config.contextMode).toBe("ohlcv");
    expect(config.contextBars).toBe(15);
  });

  it("time impact note is shown when a non-None mode is selected", () => {
    render(<AiConfigPanel />);
    fireEvent.click(screen.getByText("Price Summary"));
    expect(screen.queryByText(/response time/i)).toBeTruthy();
  });

  it("time impact note is NOT shown when mode is None", () => {
    render(<AiConfigPanel />);
    expect(screen.queryByText(/response time/i)).toBeNull();
  });
});
