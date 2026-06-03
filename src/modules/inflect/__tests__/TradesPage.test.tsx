import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TradesPage } from "../TradesPage";
import { useInflectStore } from "@/store/inflect";
import type { InflectTrade } from "../types";

const hookMocks = vi.hoisted(() => ({
  useInflectTrades: vi.fn(),
  useInflectSymbols: vi.fn(),
}));

vi.mock("@/hooks/useInflectTrades", () => ({
  useInflectTrades: hookMocks.useInflectTrades,
}));

vi.mock("@/hooks/useInflectSymbols", () => ({
  useInflectSymbols: hookMocks.useInflectSymbols,
}));

vi.mock("../TradeDetail", () => ({
  TradeDetail: () => <aside>Trade detail</aside>,
}));

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
  vi.clearAllMocks();
  useInflectStore.setState({ selectedTradeId: null });
  hookMocks.useInflectTrades.mockReturnValue({
    data: {
      account_id: "DU1",
      trades: [
        makeTrade({ trade_id: "DU1:1:closed", symbol: "AAPL" }),
        makeTrade({
          trade_id: "DU1:2:basis",
          conid: 2,
          symbol: "MSFT",
          direction: "UNKNOWN",
          status: "INCOMPLETE_BASIS",
          net_pnl: null,
          return_pct: null,
        }),
      ],
    },
    error: null,
    isLoading: false,
  });
  hookMocks.useInflectSymbols.mockReturnValue({
    data: {
      account_id: "DU1",
      symbols: [
        { conid: 1, symbol: "AAPL" },
        { conid: 2, symbol: "MSFT" },
      ],
    },
    isLoading: false,
  });
});

describe("TradesPage", () => {
  it("filters Needs attention to incomplete basis trades client-side", () => {
    render(<TradesPage accountId="DU1" />);

    fireEvent.click(screen.getByRole("button", { name: /needs attention/i }));

    const table = screen.getByRole("table");
    expect(within(table).queryByText("AAPL")).not.toBeInTheDocument();
    expect(within(table).getByText("MSFT")).toBeInTheDocument();
    expect(screen.getAllByText("Needs basis").length).toBeGreaterThan(0);
    expect(screen.queryByText("UNKNOWN")).not.toBeInTheDocument();
    expect(screen.queryByText("INCOMPLETE_BASIS")).not.toBeInTheDocument();
    expect(hookMocks.useInflectTrades).toHaveBeenLastCalledWith("DU1", undefined);
  });

  it("filters trades by typed ticker text", () => {
    render(<TradesPage accountId="DU1" />);

    fireEvent.change(screen.getByLabelText("Search trades"), {
      target: { value: "msf" },
    });

    const table = screen.getByRole("table");
    expect(within(table).queryByText("AAPL")).not.toBeInTheDocument();
    expect(within(table).getByText("MSFT")).toBeInTheDocument();
  });

  it("filters trades by symbol dropdown conid and clears filters", () => {
    render(<TradesPage accountId="DU1" />);

    fireEvent.change(screen.getByLabelText("Symbol list"), {
      target: { value: "2" },
    });

    let table = screen.getByRole("table");
    expect(within(table).queryByText("AAPL")).not.toBeInTheDocument();
    expect(within(table).getByText("MSFT")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));

    table = screen.getByRole("table");
    expect(within(table).getByText("AAPL")).toBeInTheDocument();
    expect(within(table).getByText("MSFT")).toBeInTheDocument();
  });
});
