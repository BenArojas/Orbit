import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAiStore } from "@/store/ai";
import AiAnalysisTargetControls from "../AiAnalysisTargetControls";

const apiMocks = vi.hoisted(() => ({
  models: vi.fn(),
  selectModel: vi.fn(),
  routingPolicy: vi.fn(),
  updateRoutingPolicy: vi.fn(),
}));

vi.mock("@/modules/parallax/api", () => ({
  AI_PROVIDERS_QUERY_KEY: ["ai", "providers"],
  AI_OPENROUTER_MODELS_QUERY_KEY: ["ai", "providers", "openrouter", "models"],
  parallaxApi: {
    aiStatus: vi.fn().mockResolvedValue({
      state: "ready",
      selected_model: "gemma4:4b",
      ready: true,
      error: null,
      platform: "darwin",
    }),
    aiProviders: vi.fn().mockResolvedValue({
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
      ],
      active_provider: "ollama",
      routing_mode: "cloud_manual",
      cloud_enabled: true,
    }),
    aiModels: vi.fn().mockResolvedValue([
      {
        name: "gemma4:4b",
        size_bytes: 4_000_000_000,
        size_gb: 4,
        family: "gemma4",
        parameter_size: "4B",
        quantization: "Q4_K_M",
        modified_at: "2026-06-18T00:00:00Z",
      },
    ]),
    aiSelectModel: vi.fn(),
    aiRefresh: vi.fn(),
    aiOpenRouterModels: apiMocks.models,
    aiSelectOpenRouterModel: apiMocks.selectModel,
    aiRoutingPolicy: apiMocks.routingPolicy,
    aiUpdateRoutingPolicy: apiMocks.updateRoutingPolicy,
  },
}));

function renderControls() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AiAnalysisTargetControls />
    </QueryClientProvider>,
  );
}

describe("AiAnalysisTargetControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.models.mockReset();
    apiMocks.selectModel.mockReset();
    apiMocks.routingPolicy.mockReset();
    apiMocks.updateRoutingPolicy.mockReset();
    apiMocks.models.mockResolvedValue({
      provider_name: "openrouter",
      selected_model: "anthropic/claude-sonnet-4",
      fetched_at: "2026-06-18T00:00:00Z",
      models: [
        {
          id: "anthropic/claude-sonnet-4",
          name: "Claude Sonnet 4",
          context_length: 200000,
          max_completion_tokens: 4096,
          prompt_price_per_token: "0.000003",
          completion_price_per_token: "0.000015",
          request_price: "0",
        },
        {
          id: "google/gemini-2.5-pro",
          name: "Gemini 2.5 Pro",
          context_length: 1048576,
          max_completion_tokens: 4096,
          prompt_price_per_token: "0.00000125",
          completion_price_per_token: "0.00001",
          request_price: "0",
        },
      ],
    });
    apiMocks.selectModel.mockImplementation(async ({ model }: { model: string }) => ({
      ...(await apiMocks.models()),
      selected_model: model,
    }));
    apiMocks.routingPolicy.mockResolvedValue({
      active_provider: "ollama",
      routing_mode: "local_only",
      local_fallback_enabled: true,
    });
    apiMocks.updateRoutingPolicy.mockImplementation(async (policy) => {
      apiMocks.routingPolicy.mockResolvedValue(policy);
      return policy;
    });
    useAiStore.setState({
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
      ],
      activeProvider: "ollama",
      routingMode: "cloud_manual",
      localFallbackEnabled: true,
      analysisProvider: null,
      analysisModel: null,
      analysisFallbackEnabled: null,
    });
  });

  it("shows explicit Local Ollama and OpenRouter targets without Hybrid auto", () => {
    renderControls();

    expect(screen.getByRole("button", { name: /local ollama/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /openrouter/i })).toBeInTheDocument();
    expect(screen.queryByText(/hybrid auto/i)).not.toBeInTheDocument();
  });

  it("renders the Ollama model selector beneath Local Ollama", async () => {
    renderControls();

    expect(await screen.findByRole("button", { name: /gemma4:4b/i }))
      .toBeInTheDocument();
  });

  it("persists OpenRouter selection with local fallback", async () => {
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));

    await waitFor(() => {
      expect(apiMocks.updateRoutingPolicy).toHaveBeenCalledWith({
        active_provider: "openrouter",
        routing_mode: "cloud_with_local_fallback",
        local_fallback_enabled: true,
      });
    });
  });

  it("disables the Local model control while routing persistence is pending", async () => {
    let resolveUpdate: ((policy: {
      active_provider: string;
      routing_mode: string;
      local_fallback_enabled: boolean;
    }) => void) | undefined;
    apiMocks.updateRoutingPolicy.mockImplementation(
      (policy) => new Promise((resolve) => {
        resolveUpdate = () => resolve(policy);
      }),
    );
    useAiStore.setState({
      activeProvider: "openrouter",
      routingMode: "cloud_manual",
      analysisProvider: "openrouter",
    });
    apiMocks.routingPolicy.mockResolvedValue({
      active_provider: "openrouter",
      routing_mode: "cloud_manual",
      local_fallback_enabled: true,
    });
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: /local ollama/i }));

    const modelTrigger = await screen.findByRole("button", { name: /gemma4:4b/i });
    expect(modelTrigger).toBeDisabled();

    await act(async () => {
      resolveUpdate?.({
        active_provider: "ollama",
        routing_mode: "local_only",
        local_fallback_enabled: true,
      });
    });
  });

  it("loads authenticated models and persists the selected OpenRouter model", async () => {
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));

    await waitFor(() => expect(apiMocks.updateRoutingPolicy).toHaveBeenCalled());

    const modelSelect = await screen.findByRole("combobox", {
      name: /openrouter model/i,
    });
    expect(await screen.findByRole("option", { name: "Claude Sonnet 4" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /openrouter\/auto/i })).not.toBeInTheDocument();

    fireEvent.change(modelSelect, { target: { value: "google/gemini-2.5-pro" } });

    await waitFor(() => {
      expect(apiMocks.selectModel).toHaveBeenCalledWith({
        model: "google/gemini-2.5-pro",
      });
    });
    expect((useAiStore.getState() as { analysisProvider?: string }).analysisProvider)
      .toBe("openrouter");
  });

  it("persists disabled fallback as cloud manual routing", async () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));

    await waitFor(() => expect(apiMocks.updateRoutingPolicy).toHaveBeenCalledTimes(1));

    const fallback = await screen.findByRole("switch", {
      name: /local fallback/i,
    });
    expect(fallback).toHaveAttribute("aria-checked", "true");

    fireEvent.click(fallback);

    await waitFor(() => {
      expect(apiMocks.updateRoutingPolicy).toHaveBeenLastCalledWith({
        active_provider: "openrouter",
        routing_mode: "cloud_manual",
        local_fallback_enabled: false,
      });
    });
  });

  it("rehydrates the persisted provider and fallback policy", async () => {
    useAiStore.setState({
      analysisProvider: "ollama",
      analysisFallbackEnabled: true,
    });
    apiMocks.routingPolicy.mockResolvedValue({
      active_provider: "openrouter",
      routing_mode: "cloud_manual",
      local_fallback_enabled: false,
    });

    renderControls();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /openrouter/i }))
        .toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("switch", { name: /local fallback/i }))
        .toHaveAttribute("aria-checked", "false");
    });
  });

  it("shows explicit empty-state text when no compatible OpenRouter models are available", async () => {
    apiMocks.models.mockReset().mockResolvedValue({
      provider_name: "openrouter",
      selected_model: null,
      fetched_at: "2026-06-18T00:00:00Z",
      models: [],
    });

    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));

    await waitFor(() => expect(apiMocks.updateRoutingPolicy).toHaveBeenCalled());

    expect(await screen.findByText("No compatible OpenRouter models available."))
      .toBeInTheDocument();
  });

  it("renders catalog fetch failures as alerts", async () => {
    apiMocks.models.mockReset().mockRejectedValue(
      new Error("OpenRouter catalog unavailable"),
    );

    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));

    await waitFor(() => expect(apiMocks.updateRoutingPolicy).toHaveBeenCalled());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("OpenRouter catalog unavailable");
  });
});
