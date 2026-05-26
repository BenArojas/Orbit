import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderTicket } from "../OrderTicket";
import { useAccountStore } from "../useAccountStore";
import { useOrderTicketStore } from "../useOrderTicketStore";

const mockApi = vi.hoisted(() => ({
  moonmarketPreviewOrder: vi.fn(),
  moonmarketPlaceOrders: vi.fn(),
  moonmarketReplyOrder: vi.fn(),
  moonmarketModifyOrder: vi.fn(),
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
    mockApi.moonmarketPlaceOrders.mockReset();
    mockApi.moonmarketReplyOrder.mockReset();
    mockApi.moonmarketModifyOrder.mockReset();
    mockApi.moonmarketPreviewOrder.mockResolvedValue({ account_id: "DU12345", result: { data: [{ amount: { total: "925.60" } }] } });
    mockApi.moonmarketPlaceOrders.mockResolvedValue({ account_id: "DU12345", result: { data: [{ id: "reply-1" }] } });
    mockApi.moonmarketReplyOrder.mockResolvedValue({ account_id: "DU12345", result: { data: [{ order_id: "order-1" }] } });
    mockApi.moonmarketModifyOrder.mockResolvedValue({ account_id: "DU12345", result: { data: [{ order_id: "order-1" }] } });
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

  it("renders active symbol, paper badge, and bracket fields", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });
    renderTicket();

    expect(screen.getByRole("dialog", { name: /order ticket/i })).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText(/paper/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/bracket order/i));
    expect(screen.getByLabelText(/profit taker price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/stop loss price/i)).toBeInTheDocument();
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
});
