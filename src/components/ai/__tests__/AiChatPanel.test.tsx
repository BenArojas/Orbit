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
