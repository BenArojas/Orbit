import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

const mockApi = vi.hoisted(() => ({
  moonmarketAccounts: vi.fn(),
  moonmarketPortfolio: vi.fn(),
  moonmarketPerformance: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mockApi,
}));

import { MoonMarketModule } from "@/modules/moonmarket/MoonMarketModule";

function renderMoonMarket() {
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
    navigate.mockClear();
    mockApi.moonmarketAccounts.mockResolvedValue({
      selected_account_id: "DU12345",
      accounts: [{ account_id: "DU12345", label: "Paper Trading", selected: true }],
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
    expect(navigate).toHaveBeenCalledWith("/");
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
});
