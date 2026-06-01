import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Layout } from "@/store/compare";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useCompareData } from "../useCompareData";

const mockComputeIndicators = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockAddHandler = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    computeIndicators: (...args: unknown[]) => mockComputeIndicators(...args),
  },
}));

vi.mock("../useWebSocket", () => ({
  useWebSocket: () => ({
    status: "connected",
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    addHandler: (h: unknown) => { mockAddHandler(h); return () => {}; },
  }),
}));

vi.mock("@/context/GatewayContext", () => ({
  useIbkrReady: () => true,
}));

const MOCK_RESPONSE = {
  conid: 0,
  timeframe: "1D" as const,
  period: "1y",
  candles: [{ time: 1700000000, open: 1, high: 2, low: 1, close: 2, volume: 100 }],
  indicators: [],
  fibonacci: null,
};

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockComputeIndicators.mockResolvedValue(MOCK_RESPONSE);
});

describe("useCompareData — overlay layout", () => {
  it("fetches both stock and reference candles with empty indicator list", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "overlay"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalledTimes(2));

    const calls = mockComputeIndicators.mock.calls.map((c) => c[0] as { conid: number; indicators: string[] });
    const conids = calls.map((c) => c.conid).sort();
    expect(conids).toEqual([265598, 320227571].sort());
    for (const call of calls) {
      expect(call.indicators).toEqual([]);
    }
  });

  it("uses query keys that match useChartData (cache-shared)", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "overlay"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalled());

    const queryCache = client.getQueryCache();
    const keys = queryCache.getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(["candles", 265598, "5m", "5D"]);
    expect(keys).toContainEqual(["candles", 320227571, "5m", "5D"]);
  });

  it("uses the same EMA-200-safe period defaults as the main chart", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "1D", "overlay"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalledTimes(2));

    for (const call of mockComputeIndicators.mock.calls) {
      expect(call[0].history_period).toBe("1Y");
    }
  });

  it("subscribes to both conids via WS", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "overlay"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith(265598));
    expect(mockSubscribe).toHaveBeenCalledWith(320227571);
  });
});

describe("useCompareData — stockOnly layout", () => {
  it("does not fetch the reference candles", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "stockOnly"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalledTimes(1));
    expect(mockComputeIndicators.mock.calls[0][0].conid).toBe(265598);
  });

  it("does not subscribe to the reference conid", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "stockOnly"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith(265598));
    expect(mockSubscribe).not.toHaveBeenCalledWith(320227571);
  });
});

describe("useCompareData — refOnly layout", () => {
  it("does not fetch the stock candles", async () => {
    const client = makeClient();
    renderHook(() => useCompareData(265598, 320227571, "5m", "refOnly"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalledTimes(1));
    expect(mockComputeIndicators.mock.calls[0][0].conid).toBe(320227571);
  });
});

describe("useCompareData — unmount", () => {
  it("unsubscribes from any active conids on unmount", async () => {
    const client = makeClient();
    const { unmount } = renderHook(
      () => useCompareData(265598, 320227571, "5m", "overlay"),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled());
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledWith(265598);
    expect(mockUnsubscribe).toHaveBeenCalledWith(320227571);
  });
});

describe("useCompareData — layout change", () => {
  it("unsubscribes from reference when layout changes to stockOnly", async () => {
    const client = makeClient();
    const { rerender } = renderHook(
      ({ layout }: { layout: Layout }) =>
        useCompareData(265598, 320227571, "5m", layout),
      { wrapper: wrapper(client), initialProps: { layout: "overlay" as Layout } },
    );
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith(320227571));
    rerender({ layout: "stockOnly" });
    expect(mockUnsubscribe).toHaveBeenCalledWith(320227571);
  });
});
