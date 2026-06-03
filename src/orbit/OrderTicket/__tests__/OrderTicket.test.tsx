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
}));

const mockWs = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  addHandler: vi.fn(),
  handlers: [] as Array<(msg: { type: string; conid?: number; [key: string]: unknown }) => void>,
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

function renderTicket() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <OrderTicket />
    </QueryClientProvider>,
  );
}

describe("OrderTicket", () => {
  beforeEach(() => {
    mockApi.moonmarketPreviewOrder.mockReset();
    mockApi.quote.mockReset();
    mockApi.moonmarketPlaceOrders.mockReset();
    mockApi.moonmarketReplyOrder.mockReset();
    mockApi.moonmarketModifyOrder.mockReset();
    mockApi.moonmarketAccountFunds.mockReset();
    mockApi.moonmarketAccountFunds.mockResolvedValue({
      account_id: "DU12345",
      buying_power: 40000,
      available_funds: 10000,
      cash: 10000,
      currency: "USD",
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
    expect(screen.getByLabelText(/tif/i)).toHaveValue("GTC");
    expect(screen.getByLabelText(/trail by/i)).toHaveValue("amt");
    expect(screen.getByLabelText(/trail distance/i)).toHaveValue("2");
    expect(screen.getByLabelText(/limit offset/i)).toHaveValue("178");
    expect(screen.getByLabelText(/aux price/i)).toHaveValue("183");
    expect(screen.getByLabelText(/outside regular trading hours/i)).toBeChecked();
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
});
