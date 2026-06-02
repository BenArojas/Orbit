/**
 * TradesTable tests — row rendering, the empty state, and row-click selection.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TradesTable } from "../TradesTable";
import type { InflectTrade } from "../types";

function makeTrade(over: Partial<InflectTrade> = {}): InflectTrade {
  return {
    trade_id: "DU1:1:e1",
    account_id: "DU1",
    conid: 1,
    symbol: "AAPL",
    sec_type: "STK",
    direction: "LONG",
    status: "CLOSED",
    open_time: "2026-06-02T13:00:00Z",
    open_time_ms: 1_000,
    close_time: "2026-06-02T14:00:00Z",
    close_time_ms: 5_000,
    qty: 100,
    avg_entry: 10,
    avg_exit: 12,
    gross_pnl: 200,
    commissions: 2,
    net_pnl: 198,
    return_pct: 19.8,
    hold_duration_sec: 3600,
    r_multiple: null,
    multiplier: 1,
    fills: [],
    journal_entry: null,
    ...over,
  };
}

describe("TradesTable", () => {
  it("renders an empty state when there are no trades", () => {
    render(<TradesTable trades={[]} selectedTradeId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/no trades/i)).toBeInTheDocument();
  });

  it("renders a trade row and its net P&L", () => {
    render(<TradesTable trades={[makeTrade()]} selectedTradeId={null} onSelect={vi.fn()} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("+$198.00")).toBeInTheDocument();
    expect(screen.getByText("LONG")).toBeInTheDocument();
  });

  it("calls onSelect with the trade id when a row is clicked", () => {
    const onSelect = vi.fn();
    render(<TradesTable trades={[makeTrade()]} selectedTradeId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("AAPL"));
    expect(onSelect).toHaveBeenCalledWith("DU1:1:e1");
  });

  it("lets keyboard users open a trade row with Enter or Space", () => {
    const onSelect = vi.fn();
    render(<TradesTable trades={[makeTrade()]} selectedTradeId={null} onSelect={onSelect} />);

    const row = screen.getByText("AAPL").closest("tr");
    expect(row).toHaveAttribute("tabIndex", "0");

    fireEvent.keyDown(row!, { key: "Enter" });
    fireEvent.keyDown(row!, { key: " " });

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, "DU1:1:e1");
    expect(onSelect).toHaveBeenNthCalledWith(2, "DU1:1:e1");
  });

  it("shows the attached journal setup when present", () => {
    render(
      <TradesTable
        trades={[makeTrade({ journal_entry: {
          trade_id: "DU1:1:e1", account_id: "DU1", conid: 1, setup: "Breakout",
          notes: null, tags: [], created_at: null, updated_at: null,
        } })]}
        selectedTradeId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Breakout")).toBeInTheDocument();
  });

  it("renders incomplete basis trades as Needs basis without raw backend labels", () => {
    render(
      <TradesTable
        trades={[
          makeTrade({
            direction: "UNKNOWN",
            status: "INCOMPLETE_BASIS",
            net_pnl: null,
            return_pct: null,
          }),
        ]}
        selectedTradeId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Needs basis").length).toBeGreaterThan(0);
    expect(screen.queryByText("UNKNOWN")).not.toBeInTheDocument();
    expect(screen.queryByText("INCOMPLETE_BASIS")).not.toBeInTheDocument();
  });
});
