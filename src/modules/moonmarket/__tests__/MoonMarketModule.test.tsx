import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

const routerState = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/moonmarket",
}));
const orderTicketState = vi.hoisted(() => ({ open: vi.fn() }));
const navigationState = vi.hoisted(() => ({ navigateToAnalysis: vi.fn() }));
const liveQuotesState = vi.hoisted(() => ({
  ticks: new Map<number, { last: number; changePct?: number }>(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => routerState.navigate,
  useLocation: () => ({ pathname: routerState.pathname }),
  useSearchParams: () => [new URLSearchParams(routerState.pathname.split("?")[1] ?? "")],
}));

vi.mock("@/orbit/OrderTicket/useOrderTicketStore", () => ({
  useOrderTicketStore: (selector: (state: typeof orderTicketState) => unknown) => selector(orderTicketState),
}));

vi.mock("@/store/navigation", () => ({
  useNavigationStore: (selector: (state: typeof navigationState) => unknown) => selector(navigationState),
}));

vi.mock("@/hooks/useLiveQuotes", () => ({
  useLiveQuotes: () => liveQuotesState.ticks,
}));

const mockApi = vi.hoisted(() => ({
  moonmarketAccounts: vi.fn(),
  moonmarketPortfolio: vi.fn(),
  moonmarketPerformance: vi.fn(),
  moonmarketTrades: vi.fn(),
  moonmarketLiveOrders: vi.fn(),
  moonmarketCancelOrder: vi.fn(),
  moonmarketModifyOrder: vi.fn(),
  moonmarketOptionExpirations: vi.fn(),
  moonmarketOptionChain: vi.fn(),
  moonmarketOptionContract: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mockApi,
}));

import { MoonMarketModule } from "@/modules/moonmarket/MoonMarketModule";
import { useAccountStore } from "@/orbit/OrderTicket/useAccountStore";
import { useSettingsStore } from "@/store";

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
    liveQuotesState.ticks = new Map();
    useSettingsStore.setState({ themeMode: "dark", isLoaded: true });
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add("dark");
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
          pnl_percent: 0.92,
          daily_pnl_percent: -0.18,
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
          pnl_percent: 14.29,
          daily_pnl_percent: 1,
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
          pnl_percent: 0.92,
          daily_pnl_percent: -0.18,
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
          pnl_percent: 14.29,
          daily_pnl_percent: 1,
        },
      ],
    });
    mockApi.moonmarketPerformance.mockResolvedValue({
      account_id: "DU12345",
      period: "1Y",
      nav: { dates: ["2026-01-01", "2026-01-02"], values: [100000, 101250] },
      cumulative_return: { dates: ["2026-01-01", "2026-01-02"], values: [0, 0.0125] },
      period_return: { dates: ["2026-01-01", "2026-01-02"], values: [0, 0.007] },
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
    mockApi.moonmarketCancelOrder.mockResolvedValue({ account_id: "DU12345", result: { status: "cancelled" } });
    mockApi.moonmarketModifyOrder.mockResolvedValue({ account_id: "DU12345", result: { status: "modified" } });
    mockApi.moonmarketOptionExpirations.mockResolvedValue({
      underlying_conid: 265598,
      symbol: "AAPL",
      expirations: ["JUN24"],
    });
    mockApi.moonmarketOptionChain.mockResolvedValue({
      underlying_conid: 265598,
      expiration: "JUN24",
      all_strikes: [180],
      chain: {},
    });
    mockApi.moonmarketOptionContract.mockResolvedValue({ strike: 180, data: {} });
  });

  it("renders the portfolio chart deck and stacked performance cards", async () => {
    renderMoonMarket();

    expect(await screen.findByText(/portfolio allocation/i)).toBeInTheDocument();
    expect(await screen.findByTestId("moonmarket-chart-treemap")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /treemap/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /donut/i })).toBeInTheDocument();
    expect(screen.getByText(/net liquidation/i)).toBeInTheDocument();
    expect(await screen.findByText(/\$101,250/i)).toBeInTheDocument();
    expect(screen.getByText(/\+1\.25%/i)).toBeInTheDocument();
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

  it("keeps the return toggle scoped to treemap and exposes leaders sorting", async () => {
    renderMoonMarket();

    await screen.findByTestId("moonmarket-chart-treemap");
    expect(screen.getByRole("button", { name: /today/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /leaders/i }));

    expect(await screen.findByTestId("moonmarket-chart-leaders")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /today/i })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /leader sort/i })).toBeInTheDocument();
  });

  it("uses the bottom area as a contextual inspector instead of a duplicate holdings table", async () => {
    renderMoonMarket();

    await screen.findByTestId("moonmarket-chart-treemap");
    fireEvent.click(screen.getByRole("button", { name: /select aapl/i }));

    const inspector = within(screen.getByTestId("moonmarket-position-inspector"));
    expect(inspector.getByText(/position inspector/i)).toBeInTheDocument();
    expect(inspector.getByText(/apple inc/i)).toBeInTheDocument();
    expect(inspector.getByText(/last price/i)).toBeInTheDocument();
    expect(screen.queryByText(/^qty$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /leaders/i }));
    expect(await screen.findByTestId("moonmarket-chart-leaders")).toBeInTheDocument();
    expect(screen.getByTestId("moonmarket-position-inspector")).toBeInTheDocument();
  });

  it("opens the ticket and Parallax analysis from the selected position inspector", async () => {
    renderMoonMarket();

    await screen.findByTestId("moonmarket-chart-treemap");
    fireEvent.click(screen.getByRole("button", { name: /select aapl/i }));
    fireEvent.click(screen.getByRole("button", { name: /trade aapl/i }));

    expect(orderTicketState.open).toHaveBeenCalledWith(
      expect.objectContaining({ conid: 265598, symbol: "AAPL", side: "SELL", assetClass: "STK" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /analyze aapl/i }));
    expect(navigationState.navigateToAnalysis).toHaveBeenCalledWith(265598, "AAPL");
    expect(routerState.navigate).toHaveBeenCalledWith("/parallax");

    fireEvent.click(screen.getByRole("button", { name: /options aapl/i }));
    expect(routerState.navigate).toHaveBeenCalledWith("/moonmarket/options?conid=265598&symbol=AAPL");
  });

  it("opens option holdings in the ticket as options with compact labels", async () => {
    mockApi.moonmarketPortfolio.mockResolvedValueOnce({
      account_id: "DU12345",
      total_market_value: 1386,
      total_unrealized_pnl: 55,
      positions: [
        {
          conid: 778899,
          symbol: "IBKR DEC2026 90 C [IBKR 261218C00090000 100]",
          description: "IBKR DEC2026 90 C [IBKR 261218C00090000 100]",
          asset_class: "OPT",
          quantity: 1,
          last_price: 13.86,
          average_cost: 13.31,
          market_value: 1386,
          unrealized_pnl: 55,
          daily_pnl: 8,
          pnl_percent: 4.13,
          daily_pnl_percent: 0.58,
          currency: "USD",
        },
      ],
      allocation: [
        {
          conid: 778899,
          symbol: "IBKR DEC2026 90 C [IBKR 261218C00090000 100]",
          label: "IBKR DEC2026 90 C [IBKR 261218C00090000 100]",
          value: 1386,
          percent: 100,
          asset_class: "OPT",
          unrealized_pnl: 55,
          daily_pnl: 8,
          pnl_percent: 4.13,
          daily_pnl_percent: 0.58,
        },
      ],
    });

    renderMoonMarket();

    await screen.findByTestId("moonmarket-chart-treemap");
    fireEvent.click(screen.getByRole("button", { name: /select ibkr dec2026 90call/i }));
    fireEvent.click(screen.getByRole("button", { name: /trade ibkr dec2026 90call/i }));

    expect(orderTicketState.open).toHaveBeenCalledWith(
      expect.objectContaining({ conid: 778899, symbol: "IBKR DEC2026 90call", side: "SELL", assetClass: "OPT" }),
    );
  });

  it("navigates from portfolio to transactions", async () => {
    renderMoonMarket();

    expect(await screen.findByText(/portfolio allocation/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^transactions$/i }));

    expect(routerState.navigate).toHaveBeenCalledWith("/moonmarket/transactions");
  });

  it("renders the options route and exposes the Options nav tab", async () => {
    renderMoonMarket("/moonmarket/options?conid=265598&symbol=AAPL");

    expect(await screen.findByRole("heading", { name: /aapl options/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^options$/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("hydrates and updates the shared account store from the selector", async () => {
    renderMoonMarket();

    await waitFor(() => expect(useAccountStore.getState().selectedAccountId).toBe("DU12345"));

    fireEvent.change(screen.getByRole("combobox", { name: /account/i }), { target: { value: "U12345" } });

    expect(useAccountStore.getState().selectedAccountId).toBe("U12345");
  });

  it("shows an account data error when MoonMarket account hydration fails", async () => {
    mockApi.moonmarketAccounts.mockRejectedValue(new Error("accounts failed"));

    renderMoonMarket();

    expect(await screen.findByRole("alert")).toHaveTextContent(/moonmarket account data is unavailable/i);
  });

  it("renders the transactions route with trades and actionable live orders", async () => {
    renderMoonMarket("/moonmarket/transactions");

    expect(await screen.findByRole("heading", { name: /transactions ledger/i })).toBeInTheDocument();
    expect(await screen.findByText(/2 trades/i)).toBeInTheDocument();
    expect(screen.getByText(/\$175/i)).toBeInTheDocument();
    expect(screen.getByText(/symbol activity/i)).toBeInTheDocument();
    expect(screen.getByText(/volume mix/i)).toBeInTheDocument();
    expect(screen.getByText(/BOT 5 AAPL/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /live orders/i }));

    expect(await screen.findByText(/BUY 5 AAPL LIMIT 180.00/i)).toBeInTheDocument();
    expect(screen.getByText(/submitted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /modify aapl order/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel aapl order/i })).toBeInTheDocument();
  });

  it("applies the global theme class when toggled from MoonMarket", async () => {
    renderMoonMarket();

    await screen.findByText(/portfolio allocation/i);
    fireEvent.click(screen.getByRole("button", { name: /switch to light mode/i }));

    await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("clears donut selection from the donut center", async () => {
    renderMoonMarket();

    await screen.findByTestId("moonmarket-chart-treemap");
    fireEvent.click(screen.getByRole("button", { name: /donut/i }));
    fireEvent.click(await screen.findByRole("button", { name: /select aapl/i }));
    expect(screen.getByTestId("moonmarket-position-inspector")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear selected holding/i }));

    expect(screen.getByText(/select a holding in the chart/i)).toBeInTheDocument();
  });

  it("uses websocket ticks to update portfolio values without waiting for REST polling", async () => {
    liveQuotesState.ticks = new Map([[265598, { last: 210, changePct: 2 }]]);

    renderMoonMarket();

    expect(await screen.findByText(/\$2,150 total value/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /select aapl/i }));
    expect(screen.getAllByText(/\$1,050/i).length).toBeGreaterThan(0);
  });

  it("cancels and opens modify mode from the live orders table", async () => {
    renderMoonMarket("/moonmarket/transactions");

    fireEvent.click(await screen.findByRole("button", { name: /live orders/i }));
    fireEvent.click(await screen.findByRole("button", { name: /modify aapl order/i }));

    expect(orderTicketState.open).toHaveBeenCalledWith({
      mode: "modify",
      orderId: "123456789",
      conid: 265598,
      symbol: "AAPL",
      side: "BUY",
      draft: { conid: 265598, side: "BUY", quantity: 5, orderType: "LMT", tif: "DAY", price: 180 },
    });

    fireEvent.click(screen.getByRole("button", { name: /cancel aapl order/i }));
    await waitFor(() => expect(mockApi.moonmarketCancelOrder).toHaveBeenCalledWith("DU12345", "123456789"));
  });
});
