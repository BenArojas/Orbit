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
});
