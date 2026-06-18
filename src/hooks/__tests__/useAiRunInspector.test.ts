import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parallaxApi } from "@/modules/parallax/api";
import { useAiRunInspector } from "../useAiRunInspector";

vi.mock("@/modules/parallax/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/parallax/api")>();
  return {
    ...actual,
    parallaxApi: {
      ...actual.parallaxApi,
      aiAnalysisPreview: vi.fn(),
      aiAnalysisCompare: vi.fn(),
    },
  };
});

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => createElement(
  QueryClientProvider, { client: queryClient }, children,
);

describe("useAiRunInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it("previews without streaming and confirms only the snapshot id", async () => {
    const startPreparedAnalyze = vi.fn();
    vi.mocked(parallaxApi.aiAnalysisPreview).mockResolvedValue({
      snapshot_id: "snapshot-123",
      expires_at: "2026-06-18T12:10:00Z",
      provider_name: "openrouter",
      model: {
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        context_length: 200000,
        max_completion_tokens: 4096,
        prompt_price_per_token: "0.000003",
        completion_price_per_token: "0.000015",
        request_price: "0",
      },
      request_body: {},
      disclosure: {
        sent_to_cloud: [],
        kept_local: [],
        exact_payload_available_until: "2026-06-18T12:10:00Z",
      },
      cost: {
        currency: "USD",
        estimated_input_tokens: 1,
        expected_output_tokens: 1,
        max_output_tokens: 1,
        estimated_cost_usd: "0.001",
        maximum_cost_usd: "0.002",
      },
      fallback_enabled: false,
    });
    const { result } = renderHook(
      () => useAiRunInspector(startPreparedAnalyze, true), { wrapper },
    );

    await act(async () => {
      await result.current.review({
        conid: 265598,
        symbol: "AAPL",
        timeframes: ["D"],
        indicators: ["RSI"],
        provider_name: "openrouter",
        model: "anthropic/claude-sonnet-4",
        task_type: "analysis",
      });
    });

    expect(startPreparedAnalyze).not.toHaveBeenCalled();
    expect(result.current.open).toBe(true);
    act(() => result.current.send());
    expect(result.current.open).toBe(true);
    expect(startPreparedAnalyze).toHaveBeenCalledWith(
      "snapshot-123", "anthropic/claude-sonnet-4",
    );
  });

  it("keeps comparison results in hook memory", async () => {
    const comparison = {
      snapshot_id: "snapshot-123",
      same_input: true as const,
      local: { message: "Local", signal: null, quality: {
        response_completed: true, signal_parsed: false, entry_present: false,
        stop_present: false, target_present: false, checks_count: 1,
        narrative_characters: 5,
      }, receipt: {} },
      cloud: { message: "Cloud", signal: null, quality: {
        response_completed: true, signal_parsed: false, entry_present: false,
        stop_present: false, target_present: false, checks_count: 1,
        narrative_characters: 5,
      }, receipt: {} },
    };
    vi.mocked(parallaxApi.aiAnalysisCompare).mockResolvedValue(comparison as never);
    const { result } = renderHook(
      () => useAiRunInspector(vi.fn(), true), { wrapper },
    );

    await act(async () => {
      await result.current.review({
        conid: 265598, symbol: "AAPL", timeframes: ["D"], indicators: ["RSI"],
        provider_name: "openrouter", model: "anthropic/claude-sonnet-4",
        task_type: "analysis",
      });
    });
    await act(async () => {
      await result.current.compare();
    });

    expect(parallaxApi.aiAnalysisCompare).toHaveBeenCalledWith("snapshot-123");
    expect(result.current.comparison).toEqual(comparison);
  });
});
