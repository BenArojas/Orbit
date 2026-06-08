import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BackfillStatus } from "../BackfillStatus";
import type { InflectBackfillStatusItem } from "@/modules/inflect/api";

function item(over: Partial<InflectBackfillStatusItem>): InflectBackfillStatusItem {
  return {
    account_id: "DU1",
    conid: 265598,
    status: "pending",
    attempts: 0,
    days_used: null,
    last_checked_ms: null,
    last_error: null,
    created_at: "2026-06-02T13:00:00Z",
    updated_at: "2026-06-02T13:00:00Z",
    ...over,
  };
}

describe("BackfillStatus", () => {
  it.each([
    ["pending", "Backfill queued"],
    ["rate_limited", "Backfill queued"],
    ["running", "Checking IBKR"],
    ["resolved", "Resolved"],
    ["still_needs_basis", "Still needs basis"],
    ["failed", "Still needs basis"],
    ["max_days_rejected", "IBKR rejected long history"],
  ] as const)("renders %s as %s", (status, label) => {
    render(<BackfillStatus item={item({ status })} onAddManualLot={vi.fn()} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(status)).not.toBeInTheDocument();
  });

  it("renders the last checked time when available", () => {
    render(
      <BackfillStatus
        item={item({ status: "resolved", last_checked_ms: Date.UTC(2026, 5, 2, 13, 30) })}
      />,
    );
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
    expect(screen.getByText(/Jun 2, 2026/)).toBeInTheDocument();
  });

  it("shows a manual starting lot CTA for unresolved history", () => {
    const onAddManualLot = vi.fn();
    render(<BackfillStatus item={item({ status: "still_needs_basis" })} onAddManualLot={onAddManualLot} />);
    expect(
      screen.getByText("Opening lot may predate IBKR history. Add a manual starting lot."),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "Add a manual starting lot" }).click();
    expect(onAddManualLot).toHaveBeenCalledTimes(1);
  });
});
