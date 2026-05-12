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
import { createElement } from "react";

// jsdom doesn't implement scrollIntoView — the panel calls it on every
// messages/streamingContent change. Stub once for the file.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () { /* no-op */ };
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

// ── Tests ─────────────────────────────────────────────────────

describe("AiChatPanel — Cancel button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzing.current = false;
  });

  it("Cancel button is NOT shown when isAnalyzing is false", async () => {
    const { default: AiChatPanel } = await import("../AiChatPanel");

    render(
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

    render(
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

    render(
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

    render(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    expect(screen.queryByTestId("fib-section")).toBeNull();
  });
});
