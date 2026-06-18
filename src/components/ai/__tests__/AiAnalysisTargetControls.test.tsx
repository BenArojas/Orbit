import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAiStore } from "@/store/ai";
import AiAnalysisTargetControls from "../AiAnalysisTargetControls";

const apiMocks = vi.hoisted(() => ({
  models: vi.fn(),
  selectModel: vi.fn(),
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
    aiModels: vi.fn().mockResolvedValue([]),
    aiSelectModel: vi.fn(),
    aiRefresh: vi.fn(),
    aiOpenRouterModels: apiMocks.models,
    aiSelectOpenRouterModel: apiMocks.selectModel,
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
    });
  });

  it("shows explicit Local Ollama and OpenRouter targets without Hybrid auto", () => {
    renderControls();

    expect(screen.getByRole("button", { name: /local ollama/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /openrouter/i })).toBeInTheDocument();
    expect(screen.queryByText(/hybrid auto/i)).not.toBeInTheDocument();
  });

  it("loads authenticated models and persists the selected OpenRouter model", async () => {
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));

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

  it("stores the local fallback choice for the next OpenRouter run", async () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));

    const fallback = await screen.findByRole("switch", {
      name: /local fallback/i,
    });
    expect(fallback).toHaveAttribute("aria-checked", "true");

    fireEvent.click(fallback);

    expect(fallback).toHaveAttribute("aria-checked", "false");
    expect(useAiStore.getState().analysisFallbackEnabled).toBe(false);
  });

  it("shows explicit empty-state text when no compatible OpenRouter models are available", async () => {
    apiMocks.models.mockResolvedValueOnce({
      provider_name: "openrouter",
      selected_model: null,
      fetched_at: "2026-06-18T00:00:00Z",
      models: [],
    });

    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));

    expect(await screen.findByText("No compatible OpenRouter models available."))
      .toBeInTheDocument();
  });

  it("renders catalog fetch failures as alerts", async () => {
    apiMocks.models.mockRejectedValueOnce(new Error("OpenRouter catalog unavailable"));

    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("OpenRouter catalog unavailable");
  });
});
