/**
 * Tests for AiChatPanel — analyze flow and Cancel button behavior.
 *
 * Covers:
 *   - Cancel button is not shown when isAnalyzing is false
 *   - 'Analyzing <symbol>…' shown when isAnalyzing is true
 *   - ResponseTimeBadge wired in the header (renders nothing until samples,
 *     so we just assert the panel doesn't crash with the new hook in place)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";

// jsdom doesn't implement scrollIntoView — the panel calls it on every
// messages/streamingContent change. Stub once for the file.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () { /* no-op */ };
}

function renderAiChat(element: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(createElement(QueryClientProvider, { client }, element));
}

// ── Mocks ─────────────────────────────────────────────────────

const mockAnalyzing = { current: false };
const mockStartAnalyze = vi.fn();
const mockCancelAnalyze = vi.fn();

vi.mock("@/store", () => ({
  useAiStore: Object.assign(
    () => ({
      sessionId: null,
      messages: [],
      signal: null,
      isAnalyzing: mockAnalyzing.current,
      responseTimes: [],
    }),
    {
      // Allow useAiStore.getState() lookups in the hook (not used here, but
      // keeps the import shape compatible with the real export).
      getState: () => ({ streamingContent: "" }),
    },
  ),
}));

vi.mock("@/hooks/useAiStatus", () => ({
  useAiStatus: () => ({
    ollamaState: "ready",
    selectedModel: "gemma4:4b",
    availableModels: [],
    ollamaError: null,
    isReady: true,
    selectModel: vi.fn(),
    refresh: vi.fn(),
    isRefreshing: false,
  }),
}));

vi.mock("@/hooks/useAiStream", () => ({
  useAiStream: () => ({
    streamChat: vi.fn(),
    cancelStream: vi.fn(),
    isStreaming: false,
    streamingContent: "",
  }),
}));

vi.mock("@/hooks/useAiAnalyzeStream", () => ({
  useAiAnalyzeStream: () => ({
    startAnalyze: mockStartAnalyze,
    cancelAnalyze: mockCancelAnalyze,
    isAnalyzing: mockAnalyzing.current,
    streamingContent: "",
  }),
}));

// Branch 3: FibScoreCard now reads fib config via useFibConfig (a
// TanStack Query hook). Mock it so AiChatPanel tests don't need a
// QueryClientProvider wrapper.
vi.mock("@/hooks/useFibConfig", () => ({
  useFibConfig: () => ({
    config: {
      ratios: [0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0],
      extension_ratios: [1.272, 1.618, 2.0],
      weights: {
        swing_clarity: 0.25,
        multi_touch: 0.25,
        rejection_intensity: 0.20,
        stretched_penalty: 0.15,
        recency: 0.15,
      },
    },
    isLoading: false,
    error: null,
    updateConfig: vi.fn(),
    updateConfigAsync: vi.fn(),
    isUpdating: false,
    updateError: null,
  }),
}));

// Branch 4: FibStackPanel uses useLockedFibs (TanStack Query) for
// lock CRUD. AiChatPanel tests don't exercise that surface, so we
// neuter the hooks rather than spinning up a QueryClient.
vi.mock("@/hooks/useLockedFibs", () => ({
  useLockedFibs: () => ({ data: [], isLoading: false, error: null }),
  useLockFib: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlockFib: () => ({ mutate: vi.fn(), isPending: false }),
  useClearLockedFibs: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ── Tests ─────────────────────────────────────────────────────

describe("AiChatPanel — fib section gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzing.current = false;
  });

  it("shows the fib panel for a drawn fib even when there is no auto fib (pill off)", async () => {
    const { useChartStore } = await import("@/store/chart");
    useChartStore.setState({
      activeFibs: [
        {
          id: "lock-1",
          source: "locked",
          lockId: 1,
          colorIndex: 1,
          hidden: false,
          result: {
            tool_mode: "retracement",
            swing_high: 26,
            swing_low: 14,
            swing_high_time: 1,
            swing_low_time: 0,
            direction: "up",
            levels: [],
            extensions: [],
            score: 0,
            swing_clarity: 0,
            timeframe_clarity: "clean",
            candidates: [],
            convergence_zones: [],
            is_nested: false,
            parent_fib_id: null,
            reasoning: "",
            source: "locked",
            no_active_fib: false,
            no_active_fib_reason: null,
          },
        },
      ],
    });

    const { default: AiChatPanel } = await import("../AiChatPanel");
    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "WULF",
        fibonacci: null, // pill off → no auto fib
      }),
    );

    // The fib section (and its hide/delete controls) must still appear.
    expect(screen.getByTestId("fib-section")).toBeTruthy();
    expect(screen.getByTestId("fib-locked-visibility-1")).toBeTruthy();

    useChartStore.setState({ activeFibs: [] });
  });
});

describe("AiChatPanel — Cancel button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzing.current = false;
  });

  it("Cancel button is NOT shown when isAnalyzing is false", async () => {
    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("'Analyzing AAPL…' text shown when isAnalyzing is true", async () => {
    mockAnalyzing.current = true;
    vi.resetModules();
    vi.doMock("@/store", () => ({
      useAiStore: Object.assign(
        () => ({
          sessionId: null,
          messages: [],
          signal: null,
          isAnalyzing: true,
          responseTimes: [],
        }),
        { getState: () => ({ streamingContent: "" }) },
      ),
    }));

    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText(/Analyzing AAPL/i)).toBeTruthy();
    });
  });
});

// ── Panel ordering (Branch 2 — plan decision 7) ─────────────

describe("AiChatPanel — section order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzing.current = false;
  });

  it("renders FibScoreCard AFTER messages (Fib section at the bottom)", async () => {
    // Provide a fibonacci result + a message so both elements exist.
    vi.resetModules();
    vi.doMock("@/store", () => ({
      useAiStore: Object.assign(
        () => ({
          sessionId: "sess-1",
          messages: [
            { id: "m1", role: "assistant", content: "Test analysis narrative." },
          ],
          signal: null,
          isAnalyzing: false,
          responseTimes: [],
        }),
        { getState: () => ({ streamingContent: "" }) },
      ),
    }));

    const { default: AiChatPanel } = await import("../AiChatPanel");

    const fibonacci = {
      tool_mode: "retracement" as const,
      swing_high: 130,
      swing_low: 100,
      swing_high_time: 1_700_000_000,
      swing_low_time: 1_699_900_000,
      direction: "up" as const,
      levels: [],
      extensions: [],
      score: 78,
      swing_clarity: 0.82,
      timeframe_clarity: "clean" as const,
      candidates: [],
      convergence_zones: [],
      is_nested: false,
      parent_fib_id: null,
      reasoning: "Active fib.",
      source: "auto" as const,
      no_active_fib: false,
      no_active_fib_reason: null,
    };

    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci,
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("fib-section")).toBeTruthy();
    });

    const fibSection = screen.getByTestId("fib-section");
    const messageBubble = screen.getByText(/Test analysis narrative/);

    // DOCUMENT_POSITION_FOLLOWING means fibSection comes AFTER messageBubble
    // in document order. (Node.compareDocumentPosition flag = 4.)
    const relation = messageBubble.compareDocumentPosition(fibSection);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does NOT render Fib section when fibonacci prop is null", async () => {
    vi.resetModules();
    vi.doMock("@/store", () => ({
      useAiStore: Object.assign(
        () => ({
          sessionId: null,
          messages: [],
          signal: null,
          isAnalyzing: false,
          responseTimes: [],
        }),
        { getState: () => ({ streamingContent: "" }) },
      ),
    }));

    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    expect(screen.queryByTestId("fib-section")).toBeNull();
  });
});

// ── Copy button on assistant bubbles (Branch 8 — plan item 6) ─

describe("AiChatPanel — assistant bubble Copy button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzing.current = false;
  });

  it("renders a copy button on assistant bubbles only, not user bubbles", async () => {
    vi.resetModules();
    vi.doMock("@/store", () => ({
      useAiStore: Object.assign(
        () => ({
          sessionId: "s",
          messages: [
            { id: "user-1", role: "user", content: "Hi" },
            { id: "asst-1", role: "assistant", content: "Hello" },
          ],
          signal: null,
          isAnalyzing: false,
          responseTimes: [],
        }),
        { getState: () => ({ streamingContent: "" }) },
      ),
    }));

    const { default: AiChatPanel } = await import("../AiChatPanel");
    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    expect(screen.getByTestId("copy-msg-asst-1")).toBeTruthy();
    expect(screen.queryByTestId("copy-msg-user-1")).toBeNull();
  });

  it("clicking copy writes the message content to the clipboard and flips data-copied to true", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    // jsdom doesn't ship navigator.clipboard — install a stub.
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    vi.doMock("@/store", () => ({
      useAiStore: Object.assign(
        () => ({
          sessionId: "s",
          messages: [
            { id: "asst-2", role: "assistant", content: "Analysis text." },
          ],
          signal: null,
          isAnalyzing: false,
          responseTimes: [],
        }),
        { getState: () => ({ streamingContent: "" }) },
      ),
    }));

    const { default: AiChatPanel } = await import("../AiChatPanel");
    const { fireEvent, act } = await import("@testing-library/react");
    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    const btn = screen.getByTestId("copy-msg-asst-2");
    // Pre-click state.
    expect(btn.getAttribute("data-copied")).toBe("false");

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("Analysis text.");
    expect(screen.getByTestId("copy-msg-asst-2").getAttribute("data-copied")).toBe("true");
  });

  it("data-copied resets to false after the confirmation timeout", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock("@/store", () => ({
      useAiStore: Object.assign(
        () => ({
          sessionId: "s",
          messages: [
            { id: "asst-3", role: "assistant", content: "abc" },
          ],
          signal: null,
          isAnalyzing: false,
          responseTimes: [],
        }),
        { getState: () => ({ streamingContent: "" }) },
      ),
    }));

    try {
      const { default: AiChatPanel } = await import("../AiChatPanel");
      const { fireEvent, act } = await import("@testing-library/react");
      renderAiChat(
        createElement(AiChatPanel, {
          activeConid: 265598,
          activeSymbol: "AAPL",
          fibonacci: null,
        }),
      );

      const btn = screen.getByTestId("copy-msg-asst-3");
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(btn.getAttribute("data-copied")).toBe("true");

      // Advance past the 1500 ms confirmation window.
      await act(async () => {
        vi.advanceTimersByTime(1600);
      });
      expect(screen.getByTestId("copy-msg-asst-3").getAttribute("data-copied")).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not crash if navigator.clipboard is unavailable (falls back silently)", async () => {
    // Remove the clipboard so writeText throws.
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    vi.doMock("@/store", () => ({
      useAiStore: Object.assign(
        () => ({
          sessionId: "s",
          messages: [
            { id: "asst-4", role: "assistant", content: "no clipboard" },
          ],
          signal: null,
          isAnalyzing: false,
          responseTimes: [],
        }),
        { getState: () => ({ streamingContent: "" }) },
      ),
    }));

    const { default: AiChatPanel } = await import("../AiChatPanel");
    const { fireEvent, act } = await import("@testing-library/react");
    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    const btn = screen.getByTestId("copy-msg-asst-4");
    await act(async () => {
      fireEvent.click(btn);
    });
    // Even without a working clipboard, the UI confirms (the user
    // gets visual feedback) — graceful degradation, not a crash.
    expect(btn.getAttribute("data-copied")).toBe("true");
  });
});
