import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  moonmarketTrades: vi.fn(),
  moonmarketLiveOrders: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mockApi,
}));

import { TransactionsPage } from "@/modules/moonmarket/TransactionsPage";

function renderTransactions() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <TransactionsPage accountId="DU12345" />
    </QueryClientProvider>,
  );
}

describe("TransactionsPage", () => {
  beforeEach(() => {
    mockApi.moonmarketTrades.mockResolvedValue({
      account_id: "DU12345",
      days: 7,
      summary: {
        total_trades: 2,
        total_volume: 7,
        total_commissions: 2.25,
        net_cash: 175.4,
        buy_count: 1,
        sell_count: 1,
      },
      trades: [
        {
          execution_id: "E-SELL-1",
          account_id: "DU12345",
          conid: 756733,
          symbol: "SPY",
          description: "SLD 2 SPY",
          side: "SELL",
          quantity: 2,
          price: 550.5,
          net_amount: 1101,
          commission: 1.25,
          sec_type: "ETF",
          trade_time: "2026-05-26T15:32:00+00:00",
          trade_time_ms: 1779809520000,
        },
        {
          execution_id: "E-BUY-1",
          account_id: "DU12345",
          conid: 265598,
          symbol: "AAPL",
          description: "BOT 5 AAPL",
          side: "BUY",
          quantity: 5,
          price: 185.12,
          net_amount: -925.6,
          commission: 1,
          sec_type: "STK",
          trade_time: "2026-05-26T14:32:00+00:00",
          trade_time_ms: 1779805920000,
        },
      ],
    });
    mockApi.moonmarketLiveOrders.mockResolvedValue({
      account_id: "DU12345",
      orders: [],
    });
  });

  it("filters recent trades by side and symbol", async () => {
    renderTransactions();

    expect(await screen.findByText(/BOT 5 AAPL/i)).toBeInTheDocument();
    expect(screen.getByText(/SLD 2 SPY/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^sells$/i }));
    expect(screen.queryByText(/BOT 5 AAPL/i)).not.toBeInTheDocument();
    expect(screen.getByText(/SLD 2 SPY/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^buys$/i }));
    fireEvent.change(screen.getByPlaceholderText(/symbol/i), { target: { value: "AAP" } });
    expect(screen.getByText(/BOT 5 AAPL/i)).toBeInTheDocument();
    expect(screen.queryByText(/SLD 2 SPY/i)).not.toBeInTheDocument();
  });

  it("shows empty states for no trades and no live orders", async () => {
    mockApi.moonmarketTrades.mockResolvedValueOnce({
      account_id: "DU12345",
      days: 7,
      summary: {
        total_trades: 0,
        total_volume: 0,
        total_commissions: 0,
        net_cash: 0,
        buy_count: 0,
        sell_count: 0,
      },
      trades: [],
    });
    mockApi.moonmarketLiveOrders.mockResolvedValueOnce({
      account_id: "DU12345",
      orders: [],
    });

    renderTransactions();

    expect(await screen.findAllByText(/no recent executions/i)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /live orders/i }));
    expect(screen.getByText(/no live orders/i)).toBeInTheDocument();
  });
});
