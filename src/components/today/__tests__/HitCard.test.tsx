import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HitCard } from "../HitCard";
import type { TriggerHit } from "@/lib/api";

const hit: TriggerHit = {
  id: 1,
  rule_id: 7,
  rule_name: "Golden Pocket Bounce",
  conid: 12345,
  symbol: "AAPL",
  triggered_at: "2026-05-20T13:31:02Z",
  watchlist_name: "Swing Setups",
  condition_values: [
    {
      indicator: "rsi",
      condition: "below",
      threshold: 35,
      actual_value: 28,
    },
    {
      indicator: "fibonacci",
      condition: "above",
      threshold: 0.618,
      actual_value: 0.62,
    },
  ],
  dismissed_at: null,
  snoozed_until: null,
  source_watchlist: null,
  target_watchlist: null,
  moved_back: false,
  expires_at: null,
};

describe("HitCard", () => {
  it("renders symbol, rule, and condition pills", () => {
    render(
      <HitCard
        hit={hit}
        onOpenChart={vi.fn()}
        onDismiss={vi.fn()}
        onSnooze={vi.fn()}
      />,
    );
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText(/Golden Pocket Bounce/)).toBeInTheDocument();
    expect(screen.getByText(/rsi/)).toBeInTheDocument();
    expect(screen.getByText(/fibonacci/)).toBeInTheDocument();
  });

  it("invokes onOpenChart when the open button is clicked", () => {
    const onOpenChart = vi.fn();
    render(
      <HitCard
        hit={hit}
        onOpenChart={onOpenChart}
        onDismiss={vi.fn()}
        onSnooze={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open chart/i }));
    expect(onOpenChart).toHaveBeenCalledWith(hit);
  });

  it("invokes onDismiss and onSnooze with the right args", () => {
    const onDismiss = vi.fn();
    const onSnooze = vi.fn();
    render(
      <HitCard
        hit={hit}
        onOpenChart={vi.fn()}
        onDismiss={onDismiss}
        onSnooze={onSnooze}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    fireEvent.click(screen.getByRole("button", { name: /snooze 1h/i }));
    expect(onDismiss).toHaveBeenCalledWith(hit);
    expect(onSnooze).toHaveBeenCalledWith(hit, 60);
  });
});
