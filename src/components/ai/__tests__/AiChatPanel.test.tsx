/**
 * Tests for AiChatPanel — analyze flow and Cancel button behavior.
 *
 * Covers:
 *   - Cancel button is not shown when isAnalyzing is false
 *   - 'Analyzing <symbol>…' shown when isAnalyzing is true
 *   - Analysis controls remain available when the persisted local route is down
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import type { AIProviderStatus } from "@/modules/parallax/api";

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
const mockOllamaReady = { current: true };
const mockStartAnalyze = vi.fn();
const mockCancelAnalyze = vi.fn();
const mockReviewCloudRun = vi.fn();
const mockInspectorError = { current: null as Error | null };
const mockOpenRouterCatalog = {
  models: [] as Array<{ id: string; name: string }>,
  isLoading: false,
  error: null as string | null,
};
const mockAiStore = {
  activeProvider: "ollama",
  routingMode: "local_only",
  analysisProvider: null as "ollama" | "openrouter" | null,
  analysisModel: null as string | null,
  analysisFallbackEnabled: null as boolean | null,
  lastProviderMetadata: null as {
    provider_name: "ollama" | "openrouter";
    model: string | null;
    kind: "local" | "cloud";
    fallback_used: boolean;
    estimated_cost: number | null;
    actual_cost: number | null;
  } | null,
  providers: [
    {
      provider_name: "ollama",
      display_name: "Ollama",
      kind: "local",
      enabled: true,
      ready: true,
      selected_model: "gemma4:4b",
      has_key: false,
      error: null,
    },
  ] as AIProviderStatus[],
};

afterEach(() => {
  mockOllamaReady.current = true;
});

vi.mock("@/store", () => ({
  useAiStore: Object.assign(
    (selector?: (state: Record<string, unknown>) => unknown) => {
      const state = {
        sessionId: null,
        messages: [],
        signal: null,
        isAnalyzing: mockAnalyzing.current,
        responseTimes: [],
        activeProvider: mockAiStore.activeProvider,
        routingMode: mockAiStore.routingMode,
        providers: mockAiStore.providers,
        analysisProvider: mockAiStore.analysisProvider,
        analysisModel: mockAiStore.analysisModel,
        analysisFallbackEnabled: mockAiStore.analysisFallbackEnabled,
        lastProviderMetadata: mockAiStore.lastProviderMetadata,
      };
      return selector ? selector(state) : state;
    },
    {
      // Allow useAiStore.getState() lookups in the hook (not used here, but
      // keeps the import shape compatible with the real export).
      getState: () => ({ streamingContent: "" }),
    },
  ),
}));

vi.mock("@/hooks/useAiStatus", () => ({
  useAiStatus: () => ({
    ollamaState: mockOllamaReady.current ? "ready" : "not_installed",
    selectedModel: "gemma4:4b",
    availableModels: [{
      name: "gemma4:4b",
      size_bytes: 4_000_000_000,
      size_gb: 4,
      family: "gemma4",
      parameter_size: "4B",
      quantization: "Q4_K_M",
      modified_at: "2026-06-18T00:00:00Z",
    }],
    ollamaError: null,
    isReady: mockOllamaReady.current,
    openRouterModels: mockOpenRouterCatalog.models,
    openRouterSelectedModel: null,
    isLoadingOpenRouterModels: mockOpenRouterCatalog.isLoading,
    openRouterModelsError: mockOpenRouterCatalog.error,
    selectModel: vi.fn(),
    refresh: vi.fn(),
    isRefreshing: false,
  }),
}));

vi.mock("../ResponseTimeBadge", () => ({
  default: () => null,
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
    startPreparedAnalyze: vi.fn(),
    cancelAnalyze: mockCancelAnalyze,
    isAnalyzing: mockAnalyzing.current,
    streamingContent: "",
  }),
}));

vi.mock("@/hooks/useAiRunInspector", () => ({
  useAiRunInspector: () => ({
    preview: null,
    open: false,
    setOpen: vi.fn(),
    isPreviewing: false,
    error: mockInspectorError.current,
    review: mockReviewCloudRun,
    send: vi.fn(),
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
    mockOllamaReady.current = true;
    mockAiStore.activeProvider = "ollama";
    mockAiStore.routingMode = "local_only";
    mockAiStore.analysisProvider = null;
    mockAiStore.analysisModel = null;
    mockAiStore.analysisFallbackEnabled = null;
    mockAiStore.lastProviderMetadata = null;
    mockOpenRouterCatalog.models = [
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ];
    mockOpenRouterCatalog.isLoading = false;
    mockOpenRouterCatalog.error = null;
    mockInspectorError.current = null;
    mockAiStore.providers = [
      {
        provider_name: "ollama",
        display_name: "Ollama",
        kind: "local",
        enabled: true,
        ready: true,
        selected_model: "gemma4:4b",
        has_key: false,
        error: null,
      },
    ];
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

describe("AiChatPanel — provider routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzing.current = false;
    mockAiStore.activeProvider = "openrouter";
    mockAiStore.routingMode = "cloud_manual";
    mockAiStore.analysisProvider = null;
    mockAiStore.analysisModel = null;
    mockAiStore.analysisFallbackEnabled = null;
    mockAiStore.lastProviderMetadata = null;
    mockAiStore.providers = [
      {
        provider_name: "ollama",
        display_name: "Ollama",
        kind: "local",
        enabled: true,
        ready: true,
        selected_model: "gemma4:4b",
        has_key: false,
        error: null,
      },
      {
        provider_name: "openrouter",
        display_name: "OpenRouter",
        kind: "cloud",
        enabled: true,
        ready: false,
        selected_model: "anthropic/claude-sonnet-4",
        has_key: true,
        error: null,
      },
    ];
  });

  it("keeps the title on one line and provider metadata on a bounded second row", async () => {
    const model = "z-ai/glm-5.2-very-long-provider-variant";
    mockAiStore.lastProviderMetadata = {
      provider_name: "openrouter",
      model,
      kind: "cloud",
      fallback_used: true,
      estimated_cost: 0.02,
      actual_cost: null,
    };
    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(createElement(AiChatPanel, {
      activeConid: 265598,
      activeSymbol: "AAPL",
      fibonacci: null,
    }));

    expect(screen.getAllByText("AI Analysis")[0])
      .toHaveClass("whitespace-nowrap");
    expect(screen.getByTestId("ai-run-metadata-row"))
      .toHaveClass("min-w-0");
    expect(screen.getByTitle(model)).toBeInTheDocument();
  });

  it("does not render an editable Ollama model trigger in the header", async () => {
    mockAiStore.activeProvider = "ollama";
    mockAiStore.routingMode = "local_only";
    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    const header = screen.getAllByText("AI Analysis")[0].parentElement;
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).queryByRole("button", { name: /gemma4:4b/i }))
      .not.toBeInTheDocument();
  });

  it("renders Analysis provider controls when Ollama is unavailable and routing is local only", async () => {
    mockOllamaReady.current = false;
    mockAiStore.activeProvider = "ollama";
    mockAiStore.routingMode = "local_only";
    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    expect(screen.getByRole("button", { name: /openrouter/i })).toBeEnabled();
  });

  it("previews the derived cloud route without starting inference", async () => {
    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    fireEvent.click(screen.getByText("RSI"));
    fireEvent.click(screen.getByRole("button", { name: /review cloud run/i }));

    await waitFor(() => {
      expect(mockReviewCloudRun).toHaveBeenCalledTimes(1);
    });
    expect(mockStartAnalyze).not.toHaveBeenCalled();
    const [request] = mockReviewCloudRun.mock.calls[0];
    expect(request.provider_name).toBe("openrouter");
    expect(request.model).toBe("anthropic/claude-sonnet-4");
    expect(request.task_type).toBe("analysis");
  });

  it("uses the exact per-run OpenRouter model selected in Analysis", async () => {
    mockAiStore.analysisProvider = "openrouter";
    mockAiStore.analysisModel = "google/gemini-2.5-pro";
    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    fireEvent.click(screen.getByText("RSI"));
    fireEvent.click(screen.getByRole("button", { name: /review cloud run/i }));

    await waitFor(() => expect(mockReviewCloudRun).toHaveBeenCalledTimes(1));
    const [request] = mockReviewCloudRun.mock.calls[0];
    expect(request.provider_name).toBe("openrouter");
    expect(request.model).toBe("google/gemini-2.5-pro");
    expect(request.model).not.toBe("gemma4:4b");
  });

  it("disables analysis when OpenRouter has no validated model", async () => {
    mockAiStore.analysisProvider = "openrouter";
    mockAiStore.analysisModel = null;
    mockAiStore.providers = mockAiStore.providers.map((provider) =>
      provider.provider_name === "openrouter"
        ? { ...provider, selected_model: null }
        : provider,
    );
    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    fireEvent.click(screen.getByText("RSI"));

    expect(screen.getByRole("button", { name: /review cloud run/i }))
      .toBeDisabled();
  });

  it("disables cloud review when an empty loaded catalog leaves only stale OpenRouter selections", async () => {
    mockAiStore.analysisProvider = "openrouter";
    mockAiStore.analysisModel = "google/gemini-2.5-pro";
    mockOpenRouterCatalog.models = [];
    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(
      createElement(AiChatPanel, {
        activeConid: 265598,
        activeSymbol: "AAPL",
        fibonacci: null,
      }),
    );

    fireEvent.click(screen.getByText("RSI"));

    expect(screen.getByRole("button", { name: /review cloud run/i }))
      .toBeDisabled();
  });

  it("starts cloud analysis when Ollama is unavailable", async () => {
    mockOllamaReady.current = false;
    mockAiStore.analysisProvider = "openrouter";
    mockOpenRouterCatalog.models = [
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
    ];
    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(createElement(AiChatPanel, {
      activeConid: 265598,
      activeSymbol: "AAPL",
      fibonacci: null,
    }));

    fireEvent.click(screen.getByText("RSI"));
    fireEvent.click(screen.getByRole("button", { name: /review cloud run/i }));

    await waitFor(() => expect(mockReviewCloudRun).toHaveBeenCalledTimes(1));
    expect(mockReviewCloudRun.mock.calls[0][0].provider_name).toBe("openrouter");
  });

  it("shows a cloud preview failure", async () => {
    mockInspectorError.current = new Error("Selected model exceeds the cost cap");
    const { default: AiChatPanel } = await import("../AiChatPanel");

    renderAiChat(createElement(AiChatPanel, {
      activeConid: 265598,
      activeSymbol: "AAPL",
      fibonacci: null,
    }));

    expect(screen.getByText("Selected model exceeds the cost cap")).toBeTruthy();
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
