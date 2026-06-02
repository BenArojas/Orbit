import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CalendarPage } from "../CalendarPage";
import { useInflectStore } from "@/store/inflect";
import type { InflectTrade } from "../types";

vi.mock("@/hooks/useInflectCalendar", () => ({
  useInflectCalendar: vi.fn(() => ({
    data: {
      account_id: "DU1",
      year: 2026,
      month: 6,
      days: [{ date: "2026-06-02", net_pnl: 198, trade_count: 1 }],
      weeks: [{ week_index: 1, net_pnl: 198, trading_days: 1 }],
      total_net_pnl: 198,
      days_traded: 1,
    },
    error: null,
    isLoading: false,
  })),
}));

vi.mock("@/hooks/useInflectTrades", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useInflectTrades")>();
  return {
    ...actual,
    useInflectTrades: vi.fn(() => ({
      data: { account_id: "DU1", trades: [makeTrade()] },
      error: null,
      isLoading: false,
    })),
  };
});

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

beforeEach(() => {
  useInflectStore.setState({
    page: "calendar",
    year: 2026,
    month: 6,
    selectedDate: null,
    selectedTradeId: null,
  });
});

describe("CalendarPage", () => {
  it("reveals trades for the selected calendar day", () => {
    render(<CalendarPage accountId="DU1" />);
    fireEvent.click(screen.getByRole("button", { name: /june 2, 2026.+1 trade/i }));
    const region = screen.getByRole("region", { name: /trades on june 2, 2026/i });
    expect(region).toBeInTheDocument();
    expect(within(region).getByText("AAPL")).toBeInTheDocument();
    expect(within(region).getByText("+$198.00")).toBeInTheDocument();
  });

  it("clears the selected day when the account changes", () => {
    const { rerender } = render(<CalendarPage accountId="DU1" />);
    fireEvent.click(screen.getByRole("button", { name: /june 2, 2026.+1 trade/i }));
    expect(useInflectStore.getState().selectedDate).toBe("2026-06-02");

    rerender(<CalendarPage accountId="DU2" />);

    expect(useInflectStore.getState().selectedDate).toBeNull();
    expect(screen.queryByRole("region", { name: /trades on june 2, 2026/i })).not.toBeInTheDocument();
  });
});
