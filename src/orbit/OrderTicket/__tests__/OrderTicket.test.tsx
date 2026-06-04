import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderTicket } from "../OrderTicket";
import { useAccountStore } from "../useAccountStore";
import { useOrderTicketStore } from "../useOrderTicketStore";

const mockApi = vi.hoisted(() => ({
  quote: vi.fn(),
  moonmarketPreviewOrder: vi.fn(),
  moonmarketPlaceOrders: vi.fn(),
  moonmarketReplyOrder: vi.fn(),
  moonmarketModifyOrder: vi.fn(),
  moonmarketAccountFunds: vi.fn(),
  moonmarketPortfolio: vi.fn(),
  moonmarketRevalidatePositions: vi.fn(),
  moonmarketOrderRules: vi.fn(),
  moonmarketTrades: vi.fn(),
  moonmarketLiveOrders: vi.fn(),
}));

const mockWs = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  addHandler: vi.fn(),
  handlers: [] as Array<(msg: { type: string; conid?: number; [key: string]: unknown }) => void>,
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
  Toaster: () => null,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      ...mockApi,
    },
  };
});

vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    status: "connected",
    subscribe: mockWs.subscribe,
    unsubscribe: mockWs.unsubscribe,
    addHandler: mockWs.addHandler,
    send: vi.fn(),
  }),
}));

type LiveOrderOverride = Partial<import("@/lib/api").MoonMarketLiveOrder> & { order_id: string };
type TradeOverride = Partial<import("@/lib/api").MoonMarketTrade> & { execution_id: string; conid: number };

type RenderTicketOptions = {
  liveOrders?: LiveOrderOverride[];
  trades?: TradeOverride[];
  placeResult?: unknown;
};

function seedLiveOrder(order: LiveOrderOverride): import("@/lib/api").MoonMarketLiveOrder {
  return {
    order_id: order.order_id,
    conid: order.conid ?? 265598,
    symbol: order.symbol ?? "AAPL",
    description: order.description ?? null,
    side: order.side ?? "BUY",
    order_type: order.order_type ?? "LMT",
    quantity: order.quantity ?? null,
    remaining_quantity: order.remaining_quantity ?? null,
    limit_price: order.limit_price ?? null,
    aux_price: order.aux_price ?? null,
    trailing_type: order.trailing_type ?? null,
    trailing_amt: order.trailing_amt ?? null,
    outside_rth: order.outside_rth ?? false,
    tif: order.tif ?? "DAY",
    status: order.status ?? "Submitted",
  };
}

function seedTrade(trade: TradeOverride): import("@/lib/api").MoonMarketTrade {
  return {
    execution_id: trade.execution_id,
    account_id: trade.account_id ?? "DU12345",
    conid: trade.conid,
    symbol: trade.symbol ?? "AAPL",
    description: trade.description ?? null,
    side: trade.side ?? "BUY",
    quantity: trade.quantity ?? 0,
    price: trade.price ?? null,
    net_amount: trade.net_amount ?? null,
    commission: trade.commission ?? null,
    sec_type: trade.sec_type ?? "STK",
    trade_time: trade.trade_time ?? "2026-06-04T19:40:00+00:00",
    trade_time_ms: trade.trade_time_ms ?? Date.now(),
  };
}

function renderTicket(options?: RenderTicketOptions) {
  if (options) {
    if (options.liveOrders) {
      mockApi.moonmarketLiveOrders.mockResolvedValue({
        account_id: "DU12345",
        orders: options.liveOrders.map(seedLiveOrder),
      });
    }
    if (options.trades) {
      mockApi.moonmarketTrades.mockResolvedValue({
        account_id: "DU12345",
        days: 7,
        summary: {
          total_trades: options.trades.length,
          total_volume: 0,
          total_commissions: 0,
          net_cash: 0,
          buy_count: 0,
          sell_count: 0,
        },
        trades: options.trades.map(seedTrade),
      });
    }
    if (options.placeResult !== undefined) {
      mockApi.moonmarketPlaceOrders.mockResolvedValue(
        options.placeResult && typeof options.placeResult === "object" && "account_id" in (options.placeResult as Record<string, unknown>)
          ? options.placeResult
          : { account_id: "DU12345", ...(options.placeResult as Record<string, unknown>) },
      );
    }
    if (!useOrderTicketStore.getState().target) {
      useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    }
  }
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <OrderTicket />
    </QueryClientProvider>,
  );
  const placeOrder = async (placeOptions?: { orderId?: string }) => {
    if (placeOptions?.orderId) {
      mockApi.moonmarketPlaceOrders.mockResolvedValue({
        account_id: "DU12345",
        result: { data: [{ order_id: placeOptions.orderId }] },
      });
    }
    fireEvent.click(await screen.findByRole("button", { name: /place/i }));
    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
  };
  return { ...rendered, placeOrder };
}

describe("OrderTicket", () => {
  beforeEach(() => {
    mockApi.moonmarketPreviewOrder.mockReset();
    mockApi.quote.mockReset();
    mockApi.moonmarketPlaceOrders.mockReset();
    mockApi.moonmarketReplyOrder.mockReset();
    mockApi.moonmarketModifyOrder.mockReset();
    mockApi.moonmarketAccountFunds.mockReset();
    mockApi.moonmarketPortfolio.mockReset();
    mockApi.moonmarketRevalidatePositions.mockReset();
    mockApi.moonmarketOrderRules.mockReset();
    mockApi.moonmarketTrades.mockReset();
    mockApi.moonmarketLiveOrders.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
    mockApi.moonmarketAccountFunds.mockResolvedValue({
      account_id: "DU12345",
      buying_power: 40000,
      available_funds: 10000,
      cash: 10000,
      currency: "USD",
    });
    mockApi.moonmarketPortfolio.mockResolvedValue({
      account_id: "DU12345",
      total_market_value: 0,
      total_unrealized_pnl: 0,
      positions: [],
      allocation: [],
    });
    mockWs.subscribe.mockReset();
    mockWs.unsubscribe.mockReset();
    mockWs.addHandler.mockReset();
    mockWs.handlers = [];
    mockWs.addHandler.mockImplementation((handler) => {
      mockWs.handlers.push(handler);
      return () => {
        mockWs.handlers = mockWs.handlers.filter((item) => item !== handler);
      };
    });
    mockApi.moonmarketPreviewOrder.mockResolvedValue({ account_id: "DU12345", result: { data: [{ amount: { total: "925.60" } }] } });
    mockApi.moonmarketPlaceOrders.mockResolvedValue({ account_id: "DU12345", result: { data: [{ id: "reply-1" }] } });
    mockApi.moonmarketReplyOrder.mockResolvedValue({ account_id: "DU12345", result: { data: [{ order_id: "order-1" }] } });
    mockApi.moonmarketModifyOrder.mockResolvedValue({ account_id: "DU12345", result: { data: [{ order_id: "order-1" }] } });
    mockApi.moonmarketRevalidatePositions.mockResolvedValue({
      account_id: "DU12345",
      positions: [],
    });
    mockApi.moonmarketTrades.mockResolvedValue({
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
    mockApi.moonmarketLiveOrders.mockResolvedValue({
      account_id: "DU12345",
      orders: [],
    });
    mockApi.moonmarketOrderRules.mockResolvedValue({
      account_id: "DU12345",
      conid: 265598,
      side: "BUY",
      rules: {
        orderTypes: ["market", "limit", "stop", "stop_limit", "trailing_stop", "trailing_stop_limit"],
        orderTypesOutside: ["limit", "stop_limit", "trailing_stop_limit"],
        tifTypes: ["DAY/o,a", "GTC/o,a"],
      },
    });
    mockApi.quote.mockResolvedValue({
      conid: 265598,
      symbol: "AAPL",
      companyName: "Apple Inc",
      lastPrice: 181.1,
      bid: 181,
      ask: 181.2,
      bidSize: 300,
      askSize: 200,
      open: null,
      high: null,
      low: null,
      previousClose: null,
      changePercent: null,
      changeAmount: null,
      volume: null,
    });
    useAccountStore.setState({
      accounts: [{ account_id: "DU12345", label: "Paper", selected: true, is_paper: true }],
      selectedAccountId: "DU12345",
    });
    useOrderTicketStore.setState({ isOpen: false, target: null });
  });

  it("renders nothing while closed", () => {
    renderTicket();
    expect(screen.queryByRole("dialog", { name: /order ticket/i })).not.toBeInTheDocument();
  });

  it("renders active symbol, paper badge, and independent protective order fields", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
    renderTicket();

    expect(screen.getByRole("dialog", { name: /order ticket/i })).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText(/paper/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/take profit/i));
    fireEvent.click(screen.getByLabelText(/stop loss/i));
    expect(screen.getByLabelText(/profit taker price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/stop loss price/i)).toBeInTheDocument();
  });

  it("shows the top bid/ask book in the ticket", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    expect(await screen.findByText("Bid")).toBeInTheDocument();
    expect(screen.getByText("Ask")).toBeInTheDocument();
    expect(await screen.findByText("181.00")).toBeInTheDocument();
    expect(screen.getByText("181.20")).toBeInTheDocument();
    expect(screen.getByLabelText("Bid size 300")).toBeInTheDocument();
    expect(screen.getByLabelText("Ask size 200")).toBeInTheDocument();
  });

  it("subscribes to live top-of-book updates while the ticket is open", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    const { unmount } = renderTicket();

    expect(await screen.findByText("181.00")).toBeInTheDocument();
    expect(mockWs.subscribe).toHaveBeenCalledWith(265598);

    act(() => {
      for (const handler of mockWs.handlers) {
        handler({
          type: "market_data",
          conid: 265598,
          bid: 182.1,
          ask: 182.25,
          bidSize: 450,
          askSize: 375,
        });
      }
    });

    expect(screen.getByText("182.10")).toBeInTheDocument();
    expect(screen.getByText("182.25")).toBeInTheDocument();
    expect(screen.getByLabelText("Bid size 450")).toBeInTheDocument();
    expect(screen.getByLabelText("Ask size 375")).toBeInTheDocument();

    unmount();
    expect(mockWs.unsubscribe).toHaveBeenCalledWith(265598);
  });

  it("renders option metadata and hides bracket controls for option targets", () => {
    useOrderTicketStore.getState().open({
      conid: 7001,
      symbol: "AAPL JUN24 180 CALL",
      description: "AAPL JUN24 180 CALL",
      assetClass: "OPT",
    });
    renderTicket();

    expect(screen.getByText("OPTION")).toBeInTheDocument();
    expect(screen.getByText("AAPL JUN24 180 CALL")).toBeInTheDocument();
    expect(screen.queryByLabelText(/take profit/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/stop loss/i)).not.toBeInTheDocument();
  });

  it("keeps protective order controls for stock targets", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", assetClass: "STK" });
    renderTicket();

    expect(screen.getByLabelText(/take profit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/stop loss/i)).toBeInTheDocument();
  });

  it("defaults to sell when the target is already in the selected account positions", async () => {
    mockApi.moonmarketPortfolio.mockResolvedValue({
      account_id: "DU12345",
      total_market_value: 1810,
      total_unrealized_pnl: 0,
      positions: [
        {
          conid: 265598,
          symbol: "AAPL",
          description: "Apple Inc",
          asset_class: "STK",
          quantity: 10,
          last_price: 181,
          average_cost: 180,
          market_value: 1810,
          unrealized_pnl: 10,
          daily_pnl: null,
          pnl_percent: 0.5,
          daily_pnl_percent: null,
          currency: "USD",
        },
      ],
      allocation: [],
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL" });
    renderTicket();

    await waitFor(() => expect(screen.getByRole("button", { name: /sell/i })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: /buy/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not auto-flip to sell once the user starts editing before portfolio resolves", async () => {
    let resolvePortfolio: (value: unknown) => void = () => {};
    const heldPortfolio = {
      account_id: "DU12345",
      total_market_value: 1810,
      total_unrealized_pnl: 0,
      positions: [
        {
          conid: 265598,
          symbol: "AAPL",
          description: "Apple Inc",
          asset_class: "STK",
          quantity: 10,
          last_price: 181,
          average_cost: 180,
          market_value: 1810,
          unrealized_pnl: 10,
          daily_pnl: null,
          pnl_percent: 0.5,
          daily_pnl_percent: null,
          currency: "USD",
        },
      ],
      allocation: [],
    };
    mockApi.moonmarketPortfolio.mockImplementation(
      () => new Promise((resolve) => {
        resolvePortfolio = resolve;
      }),
    );
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL" });
    renderTicket();

    // User edits the quantity before the held-position data arrives.
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "4" } });

    await act(async () => {
      resolvePortfolio(heldPortfolio);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /buy/i })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: /sell/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("disables order mutations on a live account but leaves preview available", () => {
    useAccountStore.setState({
      accounts: [{ account_id: "U12345", label: "Live", selected: true, is_paper: false }],
      selectedAccountId: "U12345",
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL" });

    renderTicket();

    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /place/i })).toBeDisabled();
  });

  it("previews and places an order for a paper account", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => expect(mockApi.moonmarketPreviewOrder).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
  });

  it("renders order preview as readable facts instead of raw JSON", async () => {
    mockApi.moonmarketPreviewOrder.mockResolvedValue({
      account_id: "DU12345",
      result: {
        amount: {
          amount: "2,520.80 USD (10 Shares)",
          commission: "1.00 USD",
          total: "2,521.80 USD",
        },
        equity: { current: "1,000,000", change: "-1", after: "999,999" },
        position: { current: "0", change: "10", after: "10" },
        warn: "20/You are trying to submit an order without having market data.",
      },
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL" });
    renderTicket();

    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    expect(await screen.findByText("Estimated Total")).toBeInTheDocument();
    expect(screen.getByText("2,521.80 USD")).toBeInTheDocument();
    expect(screen.getByText("Commission")).toBeInTheDocument();
    expect(screen.getByText("1.00 USD")).toBeInTheDocument();
    expect(screen.getByText("Position After")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText(/without having market data/i)).toBeInTheDocument();
    expect(screen.queryByText(/"account_id"/i)).not.toBeInTheDocument();
  });

  it("shows IBKR confirmation prompts returned as result arrays", async () => {
    mockApi.moonmarketPlaceOrders.mockResolvedValue({
      account_id: "DU12345",
      result: [
        {
          id: "reply-ibkr-1",
          message: [
            "You are submitting an order without market data. Are you sure you want to submit this order?",
          ],
          messageOptions: ["Yes", "No"],
        },
      ],
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    expect(await screen.findByText(/without market data/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm and submit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("revalidates positions after a confirmed order is submitted", async () => {
    mockApi.moonmarketPlaceOrders.mockResolvedValue({
      account_id: "DU12345",
      result: [
        {
          id: "reply-ibkr-1",
          message: ["Confirm this order?"],
          messageOptions: ["Yes", "No"],
        },
      ],
    });
    mockApi.moonmarketReplyOrder.mockResolvedValue({
      account_id: "DU12345",
      result: { data: [{ order_id: "order-1" }] },
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm and submit/i }));

    await waitFor(() => expect(mockApi.moonmarketReplyOrder).toHaveBeenCalledWith("DU12345", "reply-ibkr-1", true));
    await waitFor(() => expect(mockApi.moonmarketRevalidatePositions).toHaveBeenCalledWith("DU12345"));
    expect(await screen.findByText(/order tracker/i)).toBeInTheDocument();
    expect(screen.getByText(/order-1/i)).toBeInTheDocument();
  });

  it("shows a market order as filled when matching trades arrive", async () => {
    mockApi.moonmarketPlaceOrders.mockResolvedValue({ account_id: "DU12345", result: { data: [{ order_id: "order-mkt-1" }] } });
    mockApi.moonmarketLiveOrders.mockResolvedValue({
      account_id: "DU12345",
      orders: [
        {
          order_id: "order-mkt-1",
          conid: 265598,
          symbol: "AAPL",
          description: "BOT 3 AAPL MARKET",
          side: "BUY",
          order_type: "MKT",
          quantity: 3,
          remaining_quantity: 0,
          limit_price: null,
          tif: "DAY",
          status: "Filled",
        },
      ],
    });
    mockApi.moonmarketTrades.mockResolvedValue({
      account_id: "DU12345",
      days: 7,
      summary: {
        total_trades: 1,
        total_volume: 3,
        total_commissions: 1,
        net_cash: -543.75,
        buy_count: 1,
        sell_count: 0,
      },
      trades: [
        {
          execution_id: "E-MKT-1",
          account_id: "DU12345",
          conid: 265598,
          symbol: "AAPL",
          description: "BOT 3 AAPL",
          side: "BUY",
          quantity: 3,
          price: 181.25,
          net_amount: -543.75,
          commission: 1,
          sec_type: "STK",
          trade_time: "2026-06-04T19:40:00+00:00",
          trade_time_ms: Date.now() + 60_000,
        },
      ],
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "MKT" } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    expect(await screen.findByText(/order filled/i)).toBeInTheDocument();
    expect(screen.getByText(/3 shares/i)).toBeInTheDocument();
    expect(await screen.findByText(/\$181\.25 avg/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update order/i })).not.toBeInTheDocument();
  });

  it("marks an order filled from live order status before trades arrive", async () => {
    mockApi.moonmarketPlaceOrders.mockResolvedValue({ account_id: "DU12345", result: { data: [{ order_id: "order-live-filled-1" }] } });
    mockApi.moonmarketLiveOrders.mockResolvedValue({
      account_id: "DU12345",
      orders: [
        {
          order_id: "order-live-filled-1",
          conid: 265598,
          symbol: "AAPL",
          description: "BUY 3 AAPL MARKET",
          side: "BUY",
          order_type: "MKT",
          quantity: 3,
          remaining_quantity: 0,
          limit_price: null,
          tif: "DAY",
          status: "Filled",
        },
      ],
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "MKT" } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    expect(await screen.findByText(/order filled/i)).toBeInTheDocument();
    expect(screen.getByText(/3 shares/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update order/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("tracks a submitted limit order and updates it from the same ticket", async () => {
    mockApi.moonmarketPlaceOrders.mockResolvedValue({ account_id: "DU12345", result: { data: [{ order_id: "limit-1" }] } });
    mockApi.moonmarketLiveOrders.mockResolvedValue({
      account_id: "DU12345",
      orders: [
        {
          order_id: "limit-1",
          conid: 265598,
          symbol: "AAPL",
          description: "BUY 5 AAPL LIMIT 180.00",
          side: "BUY",
          order_type: "LMT",
          quantity: 5,
          remaining_quantity: 5,
          limit_price: 180,
          tif: "DAY",
          status: "Submitted",
        },
      ],
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    expect(await screen.findByText(/order tracker/i)).toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    expect(screen.getByText(/0\.61% away/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "179" } });
    fireEvent.click(screen.getByRole("button", { name: /update order/i }));

    await waitFor(() => expect(mockApi.moonmarketModifyOrder).toHaveBeenCalledWith(
      "DU12345",
      "limit-1",
      expect.objectContaining({ orderType: "LMT", price: 179 }),
    ));
  });

  it("treats a confirmation-only place response as a reply, not a tracked order", async () => {
    mockApi.moonmarketPlaceOrders.mockResolvedValue({
      account_id: "DU12345",
      result: [{ id: "reply-confirm-1", message: ["Confirm this order?"], messageOptions: ["Yes", "No"] }],
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    expect(await screen.findByRole("button", { name: /confirm and submit/i })).toBeInTheDocument();
    expect(screen.queryByText(/order tracker/i)).not.toBeInTheDocument();
  });

  it("treats a final order_id place response as a tracked order, not a confirmation", async () => {
    mockApi.moonmarketPlaceOrders.mockResolvedValue({
      account_id: "DU12345",
      result: [{ order_id: "final-1" }],
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    expect(await screen.findByText(/order tracker/i)).toBeInTheDocument();
    expect(screen.getByText(/final-1/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm and submit/i })).not.toBeInTheDocument();
  });

  it("treats a numeric confirmation id as a confirmation reply", async () => {
    mockApi.moonmarketPlaceOrders.mockResolvedValue({
      account_id: "DU12345",
      result: [{ id: 123, message: ["Confirm this order?"], messageOptions: ["Yes", "No"] }],
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    expect(await screen.findByRole("button", { name: /confirm and submit/i })).toBeInTheDocument();
    expect(screen.queryByText(/order tracker/i)).not.toBeInTheDocument();
  });

  it("clearly indicates the active buy or sell side", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    expect(screen.getByRole("button", { name: /buy/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /sell/i })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /sell/i }));

    expect(screen.getByRole("button", { name: /buy/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /sell/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("places a take-profit-only child order when only take profit is enabled", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByLabelText(/take profit/i));
    fireEvent.change(screen.getByLabelText(/profit taker price/i), { target: { value: "190" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
    const payload = mockApi.moonmarketPlaceOrders.mock.calls[0][0];
    expect(payload.orders).toHaveLength(2);
    expect(payload.orders[0]).toMatchObject({ side: "BUY", cOID: expect.any(String) });
    expect(payload.orders[1]).toMatchObject({
      side: "SELL",
      orderType: "LMT",
      tif: "GTC",
      price: 190,
      parentId: payload.orders[0].cOID,
      isSingleGroup: true,
    });
  });

  it("places a stop-loss-only child order when only stop loss is enabled", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByLabelText(/stop loss/i));
    fireEvent.change(screen.getByLabelText(/stop loss price/i), { target: { value: "175" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
    const payload = mockApi.moonmarketPlaceOrders.mock.calls[0][0];
    expect(payload.orders).toHaveLength(2);
    expect(payload.orders[0]).toMatchObject({ side: "BUY", cOID: expect.any(String) });
    expect(payload.orders[1]).toMatchObject({
      side: "SELL",
      orderType: "STP",
      tif: "GTC",
      price: 175,
      parentId: payload.orders[0].cOID,
      isSingleGroup: true,
    });
  });

  it("shows plain-English order type labels", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
    renderTicket();

    const select = screen.getByLabelText(/order type/i);
    expect(select).toHaveTextContent("Trailing Stop");
    expect(select).toHaveTextContent("Trailing Stop Limit");
    expect(select).toHaveTextContent("Market");
  });

  it("keeps stop-limit available when IBKR returns wire order type values", async () => {
    mockApi.moonmarketOrderRules.mockResolvedValue({
      account_id: "DU12345",
      conid: 265598,
      side: "SELL",
      rules: {
        orderTypes: ["MKT", "LMT", "STP", "STP LMT"],
        orderTypesOutside: ["LMT", "STP LMT"],
      },
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
    renderTicket();

    const select = screen.getByLabelText(/order type/i);
    await waitFor(() => expect(select).not.toHaveTextContent("Trailing Stop"));
    expect(select).toHaveTextContent("Stop Limit");
  });

  it("reveals trailing fields and places a TRAIL order", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "TRAIL" } });
    expect(screen.getByLabelText(/trail by/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/trail by/i), { target: { value: "%" } });
    fireEvent.change(screen.getByLabelText(/trail distance/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
    const order = mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0];
    expect(order).toMatchObject({ orderType: "TRAIL", trailingType: "%", trailingAmt: 5 });
  });

  it("requires a limit offset for TRAILLMT", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "TRAILLMT" } });
    expect(screen.getByLabelText(/limit offset/i)).toBeInTheDocument();
  });

  it("places a TRAILLMT order with limit offset and trailing distance", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "TRAILLMT" } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/trail distance/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/limit offset/i), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
    expect(mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0]).toMatchObject({
      orderType: "TRAILLMT",
      price: 0.5,
      trailingAmt: 2,
    });
  });

  it("hydrates trailing fields from a modify draft", () => {
    useOrderTicketStore.getState().open({
      mode: "modify",
      orderId: "order-1",
      conid: 265598,
      symbol: "AAPL",
      side: "SELL",
      draft: {
        conid: 265598,
        side: "SELL",
        quantity: 5,
        orderType: "TRAILLMT",
        tif: "GTC",
        price: 178,
        auxPrice: 183,
        trailingType: "amt",
        trailingAmt: 2,
        outsideRTH: true,
      },
    });
    renderTicket();

    expect(screen.getByLabelText(/order type/i)).toHaveValue("TRAILLMT");
    expect(screen.getByLabelText(/time in force/i)).toHaveValue("GTC");
    expect(screen.getByLabelText(/trail by/i)).toHaveValue("amt");
    expect(screen.getByLabelText(/trail distance/i)).toHaveValue("2");
    expect(screen.getByLabelText(/limit offset/i)).toHaveValue("178");
    expect(screen.getByLabelText(/outside regular trading hours/i)).toBeChecked();
  });

  it("only shows aux price when the selected order type requires it", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    expect(screen.queryByLabelText(/aux price/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "STP_LIMIT" } });

    expect(screen.getByLabelText(/stop price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/limit price/i)).toBeInTheDocument();
  });

  it("sends stop trigger prices as auxPrice", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "STP" } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/stop price/i), { target: { value: "175" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
    expect(mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0]).toMatchObject({
      orderType: "STP",
      auxPrice: 175,
    });
    expect(mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0].price).toBeUndefined();
  });

  it("does not allow outside regular hours for market orders", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "MKT" } });

    expect(screen.queryByLabelText(/outside regular trading hours/i)).not.toBeInTheDocument();
  });

  it("trusts an explicit empty IBKR outside-RTH rule list", async () => {
    mockApi.moonmarketOrderRules.mockResolvedValue({
      account_id: "DU12345",
      conid: 265598,
      side: "BUY",
      rules: {
        orderTypes: ["LMT"],
        orderTypesOutside: [],
      },
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    await waitFor(() => expect(screen.queryByLabelText(/outside regular trading hours/i)).not.toBeInTheDocument());
  });

  it("passes the outside-RTH flag on placement when checked", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByLabelText(/outside regular trading hours/i));
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
    expect(mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0]).toMatchObject({ outsideRTH: true });
  });

  it("shows a risk/reward readout when take profit and stop loss are set", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "100" } });
    fireEvent.click(screen.getByLabelText(/take profit/i));
    fireEvent.change(screen.getByLabelText(/profit taker price/i), { target: { value: "130" } });
    fireEvent.click(screen.getByLabelText(/stop loss/i));
    fireEvent.change(screen.getByLabelText(/stop loss price/i), { target: { value: "90" } });

    expect(screen.getByText(/risk \/ reward/i)).toHaveTextContent("1 : 3.0");
    expect(screen.getByText(/for every \$1 you risk/i)).toBeInTheDocument();
  });

  it("computes share quantity from a cash amount", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.change(screen.getByLabelText(/size by/i), { target: { value: "cash" } });
    fireEvent.change(screen.getByLabelText(/cash amount/i), { target: { value: "900" } });

    expect(screen.getByText(/≈ 5 shares/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /place/i }));
    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
    expect(mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0]).toMatchObject({ quantity: 5 });
  });

  it("computes share quantity from a percent of buying power", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    // buying_power 40000 → 10% = 4000 cash ; at 200/share → 20 shares
    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText(/size by/i), { target: { value: "bp" } });
    await screen.findByText(/\$40,000\.00/i);
    fireEvent.change(screen.getByLabelText(/percent of buying power/i), { target: { value: "10" } });

    expect(screen.getByText(/≈ 20 shares/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /place/i }));
    await waitFor(() => expect(mockApi.moonmarketPlaceOrders).toHaveBeenCalled());
    expect(mockApi.moonmarketPlaceOrders.mock.calls[0][0].orders[0]).toMatchObject({ quantity: 20 });
  });

  it("does not mark filled from a same-conid/same-side trade that predates submission", async () => {
    // live order present, status Submitted, remaining == quantity; a stale trade exists in window
    const { placeOrder } = renderTicket({
      liveOrders: [{ order_id: "o1", conid: 111, side: "BUY", quantity: 5, remaining_quantity: 5, status: "Submitted", order_type: "LMT", limit_price: 10 }],
      trades: [{ execution_id: "old", conid: 111, side: "BUY", quantity: 3, price: 9.9, trade_time_ms: Date.now() - 60_000 }],
    });
    await placeOrder({ orderId: "o1" });
    expect(await screen.findByText("Order Tracker")).toBeInTheDocument();
    expect(screen.queryByText("Order Filled")).not.toBeInTheDocument();
    expect(screen.getByText(/Remaining/)).toBeInTheDocument();
  });

  it("shows partial fill state when remaining_quantity is between 0 and quantity", async () => {
    const { placeOrder } = renderTicket({
      liveOrders: [{ order_id: "o1", conid: 111, side: "BUY", quantity: 5, remaining_quantity: 2, status: "Submitted", order_type: "LMT", limit_price: 10 }],
    });
    await placeOrder({ orderId: "o1" });
    expect(await screen.findByText(/Partially Filled|Order Tracker/)).toBeInTheDocument();
    expect(screen.queryByText("Order Filled")).not.toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // filled = 5 - 2
  });

  it("marks filled only when live order status is Filled (remaining 0)", async () => {
    const { placeOrder } = renderTicket({
      liveOrders: [{ order_id: "o1", conid: 111, side: "BUY", quantity: 5, remaining_quantity: 0, status: "Filled", order_type: "LMT", limit_price: 10 }],
      trades: [{ execution_id: "e1", conid: 111, side: "BUY", quantity: 5, price: 10.1, trade_time_ms: Date.now() }],
    });
    await placeOrder({ orderId: "o1" });
    expect(await screen.findByText("Order Filled")).toBeInTheDocument();
  });

  it("blocks placing a stop order without a stop price and does not call IBKR", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/order type/i), { target: { value: "STP" } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Stop price is required."));
    expect(mockApi.moonmarketPlaceOrders).not.toHaveBeenCalled();
  });

  it("surfaces a zero limit price as an invalid input and blocks place", async () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    expect(await screen.findByText(/limit price must be greater than zero/i)).toBeInTheDocument();
    expect(mockApi.moonmarketPlaceOrders).not.toHaveBeenCalled();
  });

  it("starts a tracker from a numeric order_id place response", async () => {
    mockApi.moonmarketPlaceOrders.mockResolvedValue({
      account_id: "DU12345",
      result: [{ order_id: 123456 }],
    });
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "BUY" });
    renderTicket();

    fireEvent.change(screen.getByLabelText(/limit price/i), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    expect(await screen.findByText(/order tracker/i)).toBeInTheDocument();
    expect(screen.getByText(/123456/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm and submit/i })).not.toBeInTheDocument();
  });

  it("renders the error card and no success state when IBKR returns a rejection row", async () => {
    const { placeOrder } = renderTicket({
      placeResult: { result: [{ error: "10/Order rejected: insufficient margin" }] },
    });
    await placeOrder();
    expect(await screen.findByText(/Order rejected: insufficient margin/)).toBeInTheDocument();
    expect(screen.queryByText("Order Submitted")).not.toBeInTheDocument();
    expect(screen.queryByText("Order Tracker")).not.toBeInTheDocument();
    expect(screen.queryByText("Order Filled")).not.toBeInTheDocument();
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
  });
});
