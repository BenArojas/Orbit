import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiAnalyzeStream } from "../useAiAnalyzeStream";

const aiStoreState = {
  sessionId: null as string | null,
  messages: [],
  signal: null,
  isAnalyzing: false,
  streamingContent: "",
  setSessionId: vi.fn(),
  addMessage: vi.fn(),
  setSignal: vi.fn(),
  setAnalyzing: vi.fn(),
  setStreaming: vi.fn(),
  setStreamingContent: vi.fn(),
  appendStreamingContent: vi.fn(),
  clearChat: vi.fn(),
  pushResponseTime: vi.fn(),
  setLastProviderMetadata: vi.fn(),
  setLastRunReceipt: vi.fn(),
};

const activeFibs = [
  {
    id: "primary",
    source: "manual" as const,
    lockId: null,
    colorIndex: 0,
    result: {
      swing_high: 130,
      swing_low: 100,
      swing_high_time: 1_700_000_000,
      swing_low_time: 1_699_900_000,
      direction: "up" as const,
      score: 81,
    },
  },
  {
    id: "lock-7",
    source: "locked" as const,
    lockId: 7,
    colorIndex: 1,
    result: {
      swing_high: 150,
      swing_low: 110,
      swing_high_time: 1_700_100_000,
      swing_low_time: 1_700_000_000,
      direction: "up" as const,
      score: 66,
    },
  },
];

vi.mock("@/store", () => ({
  useAiStore: Object.assign(
    () => aiStoreState,
    {
      getState: () => ({ streamingContent: aiStoreState.streamingContent }),
    },
  ),
}));

vi.mock("@/store/chart", () => ({
  useChartStore: {
    getState: () => ({ activeFibs }),
  },
}));

describe("useAiAnalyzeStream", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    aiStoreState.isAnalyzing = false;
    aiStoreState.streamingContent = "";

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const payload = JSON.stringify({
            type: "done",
            session_id: "sess-1",
            signal: null,
            message: "Analysis complete.",
            provider: {
              provider_name: "ollama",
              kind: "local",
              model: "gemma4:26b",
              estimated_cost: null,
              actual_cost: null,
              fallback_used: false,
            },
          });
          controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
          controller.close();
        },
      }),
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("serializes activeFibs into the analyze request body", async () => {
    const { result } = renderHook(() => useAiAnalyzeStream());

    await act(async () => {
      await result.current.startAnalyze(
        {
          conid: 265598,
          symbol: "AAPL",
          timeframes: ["D"],
          indicators: ["Fibonacci"],
        },
        "gemma4:4b",
      );
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(options?.body));

    expect(body.fibs).toEqual([
      {
        source: "manual",
        swing_high: 130,
        swing_low: 100,
        swing_high_time: 1_700_000_000,
        swing_low_time: 1_699_900_000,
        direction: "up",
        score: 81,
        is_primary: true,
        timeframe: null,
      },
      {
        source: "locked",
        swing_high: 150,
        swing_low: 110,
        swing_high_time: 1_700_100_000,
        swing_low_time: 1_700_000_000,
        direction: "up",
        score: 66,
        is_primary: false,
        timeframe: null,
      },
    ]);
  });

  it("sends only the reviewed snapshot id for prepared cloud analysis", async () => {
    const { result } = renderHook(() => useAiAnalyzeStream());

    await act(async () => {
      await result.current.startPreparedAnalyze(
        "snapshot-123", "anthropic/claude-sonnet-4",
      );
    });

    const [, options] = vi.mocked(global.fetch).mock.calls[0];
    expect(JSON.parse(String(options?.body))).toEqual({ snapshot_id: "snapshot-123" });
  });

  it("excludes hidden fibs from the analyze request body", async () => {
    // Hide the locked fib — it should drop out of the AI payload entirely.
    (activeFibs[1] as { hidden?: boolean }).hidden = true;
    try {
      const { result } = renderHook(() => useAiAnalyzeStream());
      await act(async () => {
        await result.current.startAnalyze(
          {
            conid: 265598,
            symbol: "AAPL",
            timeframes: ["D"],
            indicators: ["Fibonacci"],
          },
          "gemma4:4b",
        );
      });

      const [, options] = vi.mocked(global.fetch).mock.calls[0];
      const body = JSON.parse(String(options?.body));
      expect(body.fibs).toHaveLength(1);
      expect(body.fibs[0].source).toBe("manual");
    } finally {
      delete (activeFibs[1] as { hidden?: boolean }).hidden;
    }
  });

  it("stores provider metadata from the final done event", async () => {
    const { result } = renderHook(() => useAiAnalyzeStream());

    await act(async () => {
      await result.current.startAnalyze(
        {
          conid: 265598,
          symbol: "AAPL",
          timeframes: ["D"],
          indicators: ["RSI"],
        },
        "gemma4:26b",
      );
    });

    expect(aiStoreState.setLastProviderMetadata).toHaveBeenCalledWith({
      provider_name: "ollama",
      kind: "local",
      model: "gemma4:26b",
      estimated_cost: null,
      actual_cost: null,
      fallback_used: false,
    });
  });

  it("stores cloud provider cost metadata from the final done event", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const payload = JSON.stringify({
            type: "done",
            session_id: "sess-cloud",
            signal: null,
            message: "Cloud analysis complete.",
            provider: {
              provider_name: "openrouter",
              kind: "cloud",
              model: "openrouter/auto",
              estimated_cost: null,
              actual_cost: 0.0123,
              fallback_used: false,
            },
            receipt: {
              run_id: "run-cloud-1",
              requested_provider: "openrouter",
              requested_model: "openrouter/auto",
              executed_provider: "openrouter",
              resolved_model: "openrouter/auto",
              fallback_used: false,
              fallback_reason: null,
              status: "success",
              attempts: [],
              created_at: "2026-06-18T12:00:00Z",
            },
          });
          controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
          controller.close();
        },
      }),
    }) as typeof fetch;

    const { result } = renderHook(() => useAiAnalyzeStream());

    await act(async () => {
      await result.current.startAnalyze(
        {
          conid: 265598,
          symbol: "AAPL",
          timeframes: ["D"],
          indicators: ["RSI"],
        },
        "openrouter/auto",
      );
    });

    expect(aiStoreState.setLastProviderMetadata).toHaveBeenCalledWith({
      provider_name: "openrouter",
      kind: "cloud",
      model: "openrouter/auto",
      estimated_cost: null,
      actual_cost: 0.0123,
      fallback_used: false,
    });
    expect(aiStoreState.setLastRunReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: "run-cloud-1", status: "success" }),
    );
  });

  it("surfaces typed SSE errors and stores their failed receipt", async () => {
    const receipt = {
      run_id: "run-failed-1",
      requested_provider: "openrouter" as const,
      requested_model: "anthropic/claude-sonnet-4",
      executed_provider: null,
      resolved_model: null,
      fallback_used: false,
      fallback_reason: null,
      status: "failed" as const,
      attempts: [{
        provider_name: "openrouter" as const,
        requested_model: "anthropic/claude-sonnet-4",
        resolved_model: null,
        status: "failed" as const,
        provider_request_id: null,
        input_tokens: null,
        output_tokens: null,
        reasoning_tokens: null,
        cached_tokens: null,
        estimated_cost_usd: "0.02",
        actual_cost_usd: null,
        duration_ms: 50,
        error_code: "ai_provider_network_error",
      }],
      created_at: "2026-06-18T12:00:00Z",
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const payload = JSON.stringify({
            type: "error",
            error: "ai_provider_network_error",
            message: "Cloud AI provider network request failed.",
            provider_name: "openrouter",
            receipt,
          });
          controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
          controller.close();
        },
      }),
    }) as typeof fetch;
    const { result } = renderHook(() => useAiAnalyzeStream());

    await act(async () => {
      await result.current.startPreparedAnalyze(
        "snapshot-123", "anthropic/claude-sonnet-4",
      );
    });

    expect(aiStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: "[Analysis failed: Cloud AI provider network request failed.]",
    }));
    expect(aiStoreState.setLastRunReceipt).toHaveBeenCalledWith(receipt);
  });

  it("sends selected provider, model, and task type in the analyze request body", async () => {
    const { result } = renderHook(() => useAiAnalyzeStream());

    await act(async () => {
      await result.current.startAnalyze(
        {
          conid: 265598,
          symbol: "AAPL",
          timeframes: ["D"],
          indicators: ["RSI"],
          provider_name: "openrouter",
          model: "openrouter/auto",
          task_type: "analysis",
        },
        "openrouter/auto",
      );
    });

    const [, options] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(options?.body));

    expect(body.provider_name).toBe("openrouter");
    expect(body.model).toBe("openrouter/auto");
    expect(body.task_type).toBe("analysis");
  });
});
