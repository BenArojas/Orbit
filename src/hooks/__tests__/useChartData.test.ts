/**
 * Tests for useChartData — timeframe field and queryKey behaviour.
 *
 * Covers:
 *   - computeIndicators is called with `timeframe`, not `period`
 *   - queryKey includes timeframe so switching TF invalidates cache
 *   - TIMEFRAME_TO_PERIOD map is gone (no period translation in hook)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useChartData } from "../useChartData";

// ── Mocks ─────────────────────────────────────────────────────

const mockComputeIndicators = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    computeIndicators: (...args: unknown[]) => mockComputeIndicators(...args),
  },
}));

vi.mock("../useWebSocket", () => ({
  useWebSocket: () => ({
    status: "connected",
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    addHandler: vi.fn().mockReturnValue(vi.fn()),
  }),
}));

vi.mock("@/context/GatewayContext", () => ({
  useIbkrReady: () => true,
}));

// ── Helpers ───────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

const MOCK_RESPONSE = {
  conid: 265598,
  timeframe: "1D" as const,
  period: "1y",
  candles: [],
  indicators: [],
  fibonacci: null,
};

// ── Tests ─────────────────────────────────────────────────────

describe("useChartData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeIndicators.mockResolvedValue(MOCK_RESPONSE);
  });

  it("calls computeIndicators with timeframe field (not period)", async () => {
    const client = makeClient();
    const indicators = new Set<never>();

    renderHook(
      () => useChartData(265598, "1D", indicators),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalled());

    const [req] = mockComputeIndicators.mock.calls[0];
    expect(req.timeframe).toBe("1D");
    expect(req.period).toBeUndefined();
  });

  it("does not translate timeframe to a period string", async () => {
    const client = makeClient();
    const indicators = new Set<never>();

    renderHook(
      () => useChartData(265598, "4h", indicators),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalled());

    const [req] = mockComputeIndicators.mock.calls[0];
    // Should NOT translate "4h" → "3M" as the old TIMEFRAME_TO_PERIOD did
    expect(req.timeframe).toBe("4h");
    expect(req.period).toBeUndefined();
  });

  it("queryKey includes timeframe so switching TF fetches fresh data", async () => {
    const client = makeClient();
    const indicators = new Set<never>();

    // Fetch for 1D
    const { rerender } = renderHook(
      ({ tf }: { tf: "1D" | "1W" }) => useChartData(265598, tf, indicators),
      { wrapper: wrapper(client), initialProps: { tf: "1D" } },
    );
    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalledTimes(1));

    // Switch to 1W — should trigger a NEW fetch (different queryKey)
    rerender({ tf: "1W" });
    await waitFor(() => expect(mockComputeIndicators).toHaveBeenCalledTimes(2));

    const calls = mockComputeIndicators.mock.calls;
    expect(calls[0][0].timeframe).toBe("1D");
    expect(calls[1][0].timeframe).toBe("1W");
  });

  it("does not fetch when conid is null", () => {
    const client = makeClient();
    const indicators = new Set<never>();

    renderHook(
      () => useChartData(null, "1D", indicators),
      { wrapper: wrapper(client) },
    );

    expect(mockComputeIndicators).not.toHaveBeenCalled();
  });
});
