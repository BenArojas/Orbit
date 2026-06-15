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
});
