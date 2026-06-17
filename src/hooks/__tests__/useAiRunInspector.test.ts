import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parallaxApi } from "@/modules/parallax/api";
import { useAiRunInspector } from "../useAiRunInspector";

vi.mock("@/modules/parallax/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/parallax/api")>();
  return { ...actual, parallaxApi: { ...actual.parallaxApi, aiAnalysisPreview: vi.fn() } };
});

describe("useAiRunInspector", () => {
  beforeEach(() => vi.clearAllMocks());

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
    const { result } = renderHook(() => useAiRunInspector(startPreparedAnalyze));

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
    expect(startPreparedAnalyze).toHaveBeenCalledWith(
      "snapshot-123", "anthropic/claude-sonnet-4",
    );
  });
});
