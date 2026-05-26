import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

const routerState = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/moonmarket",
}));
const orderTicketState = vi.hoisted(() => ({ open: vi.fn() }));
const navigationState = vi.hoisted(() => ({ navigateToAnalysis: vi.fn() }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => routerState.navigate,
  useLocation: () => ({ pathname: routerState.pathname }),
}));

vi.mock("@/orbit/OrderTicket/useOrderTicketStore", () => ({
  useOrderTicketStore: (selector: (state: typeof orderTicketState) => unknown) => selector(orderTicketState),
}));

vi.mock("@/store/navigation", () => ({
  useNavigationStore: (selector: (state: typeof navigationState) => unknown) => selector(navigationState),
}));

const mockApi = vi.hoisted(() => ({
  moonmarketAccounts: vi.fn(),
  moonmarketPortfolio: vi.fn(),
  moonmarketPerformance: vi.fn(),
  moonmarketTrades: vi.fn(),
  moonmarketLiveOrders: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mockApi,
}));

import { MoonMarketModule } from "@/modules/moonmarket/MoonMarketModule";
import { useAccountStore } from "@/orbit/OrderTicket/useAccountStore";

function renderMoonMarket(pathname = "/moonmarket") {
  routerState.pathname = pathname;
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MoonMarketModule />
    </QueryClientProvider>,
  );
}

describe("MoonMarketModule", () => {
  beforeEach(() => {
    useAccountStore.setState({ accounts: [], selectedAccountId: null });
    routerState.navigate.mockClear();
    orderTicketState.open.mockClear();
    navigationState.navigateToAnalysis.mockClear();
    routerState.pathname = "/moonmarket";
    mockApi.moonmarketAccounts.mockResolvedValue({
      selected_account_id: "DU12345",
      accounts: [
        { account_id: "DU12345", label: "Paper Trading", selected: true, is_paper: true },
        { account_id: "U12345", label: "Live Trading", selected: false, is_paper: false },
      ],
    });
    mockApi.moonmarketPortfolio.mockResolvedValue({
      account_id: "DU12345",
      total_market_value: 2100,
      total_unrealized_pnl: 135,
      positions: [
        {
          conid: 756733,
          symbol: "SPY",
          description: "SPDR S&P 500 ETF",
          asset_class: "ETF",
          quantity: 2,
          last_price: 550,
          average_cost: 545,
          market_value: 1100,
          unrealized_pnl: 10,
          daily_pnl: -2,
          currency: "USD",
        },
        {
          conid: 265598,
          symbol: "AAPL",
          description: "Apple Inc",
          asset_class: "STK",
          quantity: 5,
          last_price: 200,
          average_cost: 175,
          market_value: 1000,
          unrealized_pnl: 125,
          daily_pnl: 10,
          currency: "USD",
        },
      ],
      allocation: [
        {
          conid: 756733,
          symbol: "SPY",
          label: "SPDR S&P 500 ETF",
          value: 1100,
          percent: 52.38,
          asset_class: "ETF",
          unrealized_pnl: 10,
          daily_pnl: -2,
        },
        {
          conid: 265598,
          symbol: "AAPL",
          label: "Apple Inc",
          value: 1000,
          percent: 47.62,
          asset_class: "STK",
          unrealized_pnl: 125,
          daily_pnl: 10,
        },
      ],
    });
    mockApi.moonmarketPerformance.mockResolvedValue({
      account_id: "DU12345",
      period: "1Y",
      nav: { dates: ["2026-01-01", "2026-01-02"], values: [100000, 101250] },
      cumulative_return: { dates: ["2026-01-01", "2026-01-02"], values: [0, 1.25] },
      period_return: { dates: ["2026-01-01", "2026-01-02"], values: [0, 0.7] },
    });
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
      orders: [
        {
          order_id: "123456789",
          conid: 265598,
          symbol: "AAPL",
          description: "BUY 5 AAPL LIMIT 180.00",
          side: "BUY",
          order_type: "LMT",
          quantity: 5,
          remaining_quantity: 5,
          limit_price: 180,
          status: "Submitted",
        },
      ],
    });
  });

  it("renders the portfolio chart deck and stacked performance cards", async () => {
    renderMoonMarket();

    expect(await screen.findByText(/portfolio allocation/i)).toBeInTheDocument();
    expect(await screen.findByTestId("moonmarket-chart-treemap")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /treemap/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /donut/i })).toBeInTheDocument();
    expect(screen.getByText(/net liquidation/i)).toBeInTheDocument();
    expect(screen.getByText(/cumulative return/i)).toBeInTheDocument();
    expect(screen.getByText(/period return/i)).toBeInTheDocument();
    expect(screen.queryByText(/historical data/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^qty$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/select a holding/i)).toBeInTheDocument();
  });

  it("switches graph views and navigates back to Orbit", async () => {
    renderMoonMarket();

    await screen.findByTestId("moonmarket-chart-treemap");
    fireEvent.click(screen.getByRole("button", { name: /donut/i }));
    expect(screen.getByRole("button", { name: /donut/i })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByTestId("moonmarket-chart-donut")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back to orbit/i }));
    expect(routerState.navigate).toHaveBeenCalledWith("/");
  });

  it("uses the bottom area as a contextual inspector instead of a duplicate holdings table", async () => {
    renderMoonMarket();

    await screen.findByTestId("moonmarket-chart-treemap");
    fireEvent.click(screen.getByRole("button", { name: /select apple/i }));

    const inspector = within(screen.getByTestId("moonmarket-position-inspector"));
    expect(inspector.getByText(/position inspector/i)).toBeInTheDocument();
    expect(inspector.getByText(/apple inc/i)).toBeInTheDocument();
    expect(inspector.getByText(/last price/i)).toBeInTheDocument();
    expect(screen.queryByText(/^qty$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /leaders/i }));
    expect(await screen.findByTestId("moonmarket-chart-leaders")).toBeInTheDocument();
    expect(screen.queryByText(/position inspector/i)).not.toBeInTheDocument();
  });

  it("opens the ticket and Parallax analysis from the selected position inspector", async () => {
    renderMoonMarket();

    await screen.findByTestId("moonmarket-chart-treemap");
    fireEvent.click(screen.getByRole("button", { name: /select apple/i }));
    fireEvent.click(screen.getByRole("button", { name: /trade aapl/i }));

    expect(orderTicketState.open).toHaveBeenCalledWith({ conid: 265598, symbol: "AAPL", side: "SELL" });

    fireEvent.click(screen.getByRole("button", { name: /analyze aapl/i }));
    expect(navigationState.navigateToAnalysis).toHaveBeenCalledWith(265598, "AAPL");
    expect(routerState.navigate).toHaveBeenCalledWith("/parallax");
  });

  it("navigates from portfolio to transactions", async () => {
    renderMoonMarket();

    expect(await screen.findByText(/portfolio allocation/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^transactions$/i }));

    expect(routerState.navigate).toHaveBeenCalledWith("/moonmarket/transactions");
  });

  it("hydrates and updates the shared account store from the selector", async () => {
    renderMoonMarket();

    await waitFor(() => expect(useAccountStore.getState().selectedAccountId).toBe("DU12345"));

    fireEvent.change(screen.getByRole("combobox", { name: /account/i }), { target: { value: "U12345" } });

    expect(useAccountStore.getState().selectedAccountId).toBe("U12345");
  });

  it("renders the transactions route with trades and read-only live orders", async () => {
    renderMoonMarket("/moonmarket/transactions");

    expect(await screen.findByRole("heading", { name: /transactions ledger/i })).toBeInTheDocument();
    expect(await screen.findByText(/2 trades/i)).toBeInTheDocument();
    expect(screen.getByText(/\$175/i)).toBeInTheDocument();
    expect(screen.getByText(/symbol activity/i)).toBeInTheDocument();
    expect(screen.getByText(/volume by symbol/i)).toBeInTheDocument();
    expect(screen.getByText(/BOT 5 AAPL/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /live orders/i }));

    expect(await screen.findByText(/BUY 5 AAPL LIMIT 180.00/i)).toBeInTheDocument();
    expect(screen.getByText(/submitted/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /modify/i })).not.toBeInTheDocument();
  });
});
