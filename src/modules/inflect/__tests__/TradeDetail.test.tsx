/**
 * TradeDetail tests — debug fill fields used to diagnose bad math cases.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradeDetail } from "../TradeDetail";
import type { InflectTrade } from "../types";

const hookMocks = vi.hoisted(() => ({
  useInflectTrade: vi.fn(),
}));

vi.mock("@/hooks/useTradeJournal", () => ({
  useInflectTrade: hookMocks.useInflectTrade,
}));

vi.mock("../JournalEditor", () => ({
  JournalEditor: () => <div>Journal editor</div>,
}));

function makeTrade(): InflectTrade {
  return {
    trade_id: "DU1:265598:exec-1",
    account_id: "DU1",
    conid: 265598,
    symbol: "ES",
    sec_type: "FUT",
    direction: "LONG",
    status: "CLOSED",
    open_time: "2026-06-02T13:00:00Z",
    open_time_ms: 1_000,
    close_time: "2026-06-02T14:00:00Z",
    close_time_ms: 5_000,
    qty: 1,
    avg_entry: 5250,
    avg_exit: 5251,
    gross_pnl: 50,
    commissions: 2.5,
    net_pnl: 47.5,
    return_pct: 0.9,
    hold_duration_sec: 3600,
    r_multiple: null,
    multiplier: 50,
    fills: [
      {
        execution_id: "exec-1",
        conid: 265598,
        symbol: "ES",
        side: "BUY",
        quantity: 1,
        price: 5250,
        commission: 1.25,
        net_amount: -262500,
        sec_type: "FUT",
        trade_time: "2026-06-02T13:00:00Z",
        trade_time_ms: 1_000,
        multiplier: 50,
      } as InflectTrade["fills"][number] & { multiplier: number },
    ],
    journal_entry: null,
  };
}

describe("TradeDetail", () => {
  it("renders fill debug fields for math investigation", () => {
    hookMocks.useInflectTrade.mockReturnValue({
      data: makeTrade(),
      isLoading: false,
      error: null,
    });

    render(<TradeDetail tradeId="DU1:265598:exec-1" accountId="DU1" onClose={vi.fn()} />);

    expect(screen.getByText("exec-1")).toBeInTheDocument();
    expect(screen.getAllByText("Jun 2, 2026, 01:00 PM")[0]).toBeInTheDocument();
    expect(screen.getByText("-$262,500")).toBeInTheDocument();
    expect(screen.getAllByText("FUT")[0]).toBeInTheDocument();
    expect(screen.getAllByText("265598")[0]).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });
});
