import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppIcon } from "@/orbit/AppIcon";
import { Activity } from "lucide-react";

describe("AppIcon", () => {
  it("is clickable and calls onOpen when enabled", () => {
    const onOpen = vi.fn();
    render(<AppIcon label="Parallax" icon={Activity} enabled onOpen={onOpen} />);
    const btn = screen.getByRole("button", { name: /parallax/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("is disabled and does not call onOpen when not enabled", () => {
    const onOpen = vi.fn();
    render(<AppIcon label="MoonMarket" icon={Activity} enabled={false} onOpen={onOpen} />);
    const btn = screen.getByRole("button", { name: /moonmarket/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows a badge when provided", () => {
    render(<AppIcon label="Inflect" icon={Activity} enabled={false} badge="Coming soon" />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("renders a description when provided", () => {
    render(<AppIcon label="Parallax" icon={Activity} enabled description="Technical analysis" />);
    expect(screen.getByText(/technical analysis/i)).toBeInTheDocument();
  });
});
