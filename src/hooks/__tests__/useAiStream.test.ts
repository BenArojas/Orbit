import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiStream } from "../useAiStream";

const aiStoreState = {
  isStreaming: false,
  streamingContent: "",
  addMessage: vi.fn(),
  setStreaming: vi.fn(),
  setStreamingContent: vi.fn(),
  appendStreamingContent: vi.fn((chunk: string) => {
    aiStoreState.streamingContent += chunk;
  }),
  setSignal: vi.fn(),
};

vi.mock("@/store", () => ({
  useAiStore: Object.assign(
    () => aiStoreState,
    {
      getState: () => ({ streamingContent: aiStoreState.streamingContent }),
    },
  ),
}));

describe("useAiStream", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    aiStoreState.isStreaming = false;
    aiStoreState.streamingContent = "";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses the authoritative done message instead of streamed raw prose", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            `data: ${JSON.stringify({ type: "token", content: "Raw LONG prose." })}\n\n`,
          ));
          controller.enqueue(new TextEncoder().encode(
            `data: ${JSON.stringify({
              type: "done",
              message: "Orbit withheld the trade plan because it could not be verified.",
              signal: { direction: "NEUTRAL" },
            })}\n\n`,
          ));
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
    }) as typeof fetch;

    const { result } = renderHook(() => useAiStream());

    await act(async () => {
      await result.current.streamChat("sess-1", "Are the levels still valid?");
    });

    expect(aiStoreState.appendStreamingContent).toHaveBeenCalledWith("Raw LONG prose.");
    expect(aiStoreState.addMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      role: "assistant",
      content: "Orbit withheld the trade plan because it could not be verified.",
    }));
    expect(aiStoreState.setSignal).toHaveBeenCalledWith({ direction: "NEUTRAL" });
  });
});
