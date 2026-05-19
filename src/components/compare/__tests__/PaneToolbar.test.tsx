import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PaneToolbar from "../PaneToolbar";

const defaultProps = {
  paneId: "pane-1",
  timeframe: "5m" as const,
  layout: "overlay" as const,
  refSymbol: "SPY",
  refResolving: false,
  canRemove: true,
  onTimeframeChange: vi.fn(),
  onLayoutChange: vi.fn(),
  onRefSubmit: vi.fn(),
  onRemove: vi.fn(),
};

describe("PaneToolbar", () => {
  it("highlights the active TF pill", () => {
    render(<PaneToolbar {...defaultProps} timeframe="1h" />);
    const pill = screen.getByRole("button", { name: "1h" });
    expect(pill.className).toMatch(/bg-\[var\(--bg-4\)\]/);
  });

  it("calls onTimeframeChange when a different pill is clicked", () => {
    const onTimeframeChange = vi.fn();
    render(<PaneToolbar {...defaultProps} onTimeframeChange={onTimeframeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "1D" }));
    expect(onTimeframeChange).toHaveBeenCalledWith("1D");
  });

  it("calls onLayoutChange when the dropdown value changes", () => {
    const onLayoutChange = vi.fn();
    render(<PaneToolbar {...defaultProps} onLayoutChange={onLayoutChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "stockOnly" } });
    expect(onLayoutChange).toHaveBeenCalledWith("stockOnly");
  });

  it("disables the close button when canRemove is false", () => {
    render(<PaneToolbar {...defaultProps} canRemove={false} />);
    expect(screen.getByRole("button", { name: /remove pane/i })).toBeDisabled();
  });

  it("calls onRemove when the close button is clicked", () => {
    const onRemove = vi.fn();
    render(<PaneToolbar {...defaultProps} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /remove pane/i }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("renders the per-pane reference symbol", () => {
    render(<PaneToolbar {...defaultProps} refSymbol="QQQ" />);
    const input = screen.getByLabelText(/reference symbol for pane/i) as HTMLInputElement;
    expect(input.value).toBe("QQQ");
  });

  it("calls onRefSubmit with the uppercased symbol on Enter", () => {
    const onRefSubmit = vi.fn();
    render(<PaneToolbar {...defaultProps} onRefSubmit={onRefSubmit} />);
    const input = screen.getByLabelText(/reference symbol for pane/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "qqq" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRefSubmit).toHaveBeenCalledWith("QQQ");
  });

  it("does not call onRefSubmit when the typed symbol is unchanged", () => {
    const onRefSubmit = vi.fn();
    render(<PaneToolbar {...defaultProps} refSymbol="SPY" onRefSubmit={onRefSubmit} />);
    const input = screen.getByLabelText(/reference symbol for pane/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "SPY" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRefSubmit).not.toHaveBeenCalled();
  });

  it("pulses the reference input while resolving", () => {
    render(<PaneToolbar {...defaultProps} refResolving />);
    const input = screen.getByLabelText(/reference symbol for pane/i);
    expect(input.className).toMatch(/animate-pulse/);
  });
});
