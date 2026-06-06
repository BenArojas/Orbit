import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useOrderTicketLifecycle } from "../useOrderTicketLifecycle";
import { useAccountStore } from "../useAccountStore";

const mockApi = vi.hoisted(() => ({
  quote: vi.fn(),
  moonmarketAccountFunds: vi.fn(),
  moonmarketPortfolio: vi.fn(),
  moonmarketOrderRules: vi.fn(),
  moonmarketTrades: vi.fn(),
  moonmarketLiveOrders: vi.fn(),
}));

const mockWs = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  addHandler: vi.fn(() => () => {}),
  send: vi.fn(),
}));

const mockMutations = vi.hoisted(() => ({
  preview: { mutate: vi.fn(), isPending: false },
  place: { mutate: vi.fn(), isPending: false },
  modify: { mutate: vi.fn(), isPending: false },
  reply: { mutate: vi.fn(), isPending: false },
  cancel: { mutate: vi.fn(), isPending: false },
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
    send: mockWs.send,
  }),
}));

vi.mock("../useOrderMutations", () => ({
  usePreviewOrder: () => mockMutations.preview,
  usePlaceOrder: () => mockMutations.place,
  useModifyOrder: () => mockMutations.modify,
  useReplyOrder: () => mockMutations.reply,
  useCancelOrder: () => mockMutations.cancel,
}));

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useOrderTicketLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWs.addHandler.mockImplementation(() => () => {});
    useAccountStore.setState({
      accounts: [{ account_id: "DU12345", label: "Paper", selected: true, is_paper: true }],
      selectedAccountId: "DU12345",
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
        orderTypes: ["market", "limit", "stop_limit"],
        orderTypesOutside: ["limit"],
        tifTypes: ["DAY/o,a", "GTC/o,a"],
      },
    });
  });

  it("normalizes IBKR order rules through the hook seam", async () => {
    const client = makeClient();
    const target = { conid: 265598, symbol: "AAPL", side: "BUY" } as const;
    const { result, unmount } = renderHook(
      () => useOrderTicketLifecycle(target),
      { wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(mockApi.moonmarketOrderRules).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.orderRulesQuery.isSuccess).toBe(true));
    expect(result.current.availableOrderTypes).toEqual(["MKT", "LMT", "STP_LIMIT"]);

    unmount();
  });
});
