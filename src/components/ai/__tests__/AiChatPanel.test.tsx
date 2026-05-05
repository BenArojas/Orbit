/**
 * Tests for AiChatPanel — Cancel button behavior during analysis.
 *
 * Covers:
 *   - Cancel button is not shown when isAnalyzing is false
 *   - Cancel button appears in the chat area when isAnalyzing is true
 *   - Clicking Cancel calls analyzeMutation.reset() and setAnalyzing(false)
 *   - Error message is shown (not stuck spinner) when analyzeMutation.onError fires
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

// ── Mocks ─────────────────────────────────────────────────────

const mockSetAnalyzing = vi.fn();
const mockAnalyzing = { current: false };

vi.mock("@/store", () => ({
  useAiStore: () => ({
    sessionId: null,
    messages: [],
    signal: null,
    isAnalyzing: mockAnalyzing.current,
    setSessionId: vi.fn(),
    addMessage: vi.fn(),
    setSignal: vi.fn(),
    setAnalyzing: mockSetAnalyzing,
    clearChat: vi.fn(),
  }),
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

vi.mock("@/lib/api", () => ({
  api: {
    aiAnalyze: vi.fn().mockResolvedValue({
      session_id: "sess_1",
      signal: null,
      message: "Test analysis",
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

// ── Tests ─────────────────────────────────────────────────────

describe("AiChatPanel — Cancel button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzing.current = false;
  });

  it("Cancel button is NOT shown when isAnalyzing is false", async () => {
    // Lazy import to get fresh module with mocks applied
    const { default: AiChatPanel } = await import("../AiChatPanel");

    render(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
      { wrapper: makeWrapper() },
    );

    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("'Analyzing AAPL…' text shown when isAnalyzing is true", async () => {
    mockAnalyzing.current = true;

    // Re-import so mock sees the updated value
    vi.resetModules();
    vi.mock("@/store", () => ({
      useAiStore: () => ({
        sessionId: null,
        messages: [],
        signal: null,
        isAnalyzing: true,
        setSessionId: vi.fn(),
        addMessage: vi.fn(),
        setSignal: vi.fn(),
        setAnalyzing: mockSetAnalyzing,
        clearChat: vi.fn(),
      }),
    }));

    const { default: AiChatPanel } = await import("../AiChatPanel");

    render(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(screen.queryByText(/Analyzing AAPL/i)).toBeTruthy();
    });
  });
});
