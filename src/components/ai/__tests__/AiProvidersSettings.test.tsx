import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";

import { parallaxApi } from "@/modules/parallax/api";
import type { AIProviderName, AIProvidersResponse, AIRoutingPolicyResponse } from "@/modules/parallax/api";
import { useAiStore } from "@/store";

import AiProvidersSettings from "../AiProvidersSettings";

vi.mock("@/modules/parallax/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/parallax/api")>();
  return {
    ...actual,
    parallaxApi: {
      ...actual.parallaxApi,
      aiProviders: vi.fn(),
      aiRoutingPolicy: vi.fn(),
      aiUpdateRoutingPolicy: vi.fn(),
    },
  };
});

function renderWithQueryClient(element: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(createElement(QueryClientProvider, { client }, element));
}

const cloudProviders: Array<[AIProviderName, string]> = [
  ["openrouter", "OpenRouter"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["gemini", "Gemini"],
  ["grok", "Grok"],
];

const providersResponse: AIProvidersResponse = {
  active_provider: "ollama",
  routing_mode: "local_only",
  cloud_enabled: false,
  providers: [
    {
      provider_name: "ollama",
      display_name: "Ollama",
      kind: "local",
      enabled: true,
      ready: true,
      selected_model: "gemma4:26b",
      has_key: false,
      error: null,
    },
    ...cloudProviders.map(([providerName, display]) => ({
      provider_name: providerName,
      display_name: display,
      kind: "cloud" as const,
      enabled: false,
      ready: false,
      selected_model: null,
      has_key: false,
      error: null,
    })),
  ],
};

const routingPolicy: AIRoutingPolicyResponse = {
  routing_mode: "local_only",
  local_fallback_enabled: true,
  per_call_cost_cap_usd: 1,
  monthly_cost_cap_usd: 25,
};

describe("AiProvidersSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiStore.setState({
      providers: [],
      activeProvider: "ollama",
      routingMode: "local_only",
      cloudEnabled: false,
      localFallbackEnabled: true,
      perCallCostCapUsd: 1,
      monthlyCostCapUsd: 25,
    });
    vi.mocked(parallaxApi.aiProviders).mockResolvedValue(providersResponse);
    vi.mocked(parallaxApi.aiRoutingPolicy).mockResolvedValue(routingPolicy);
    vi.mocked(parallaxApi.aiUpdateRoutingPolicy).mockImplementation(async (policy) => policy);
  });

  it("renders provider cards with cloud providers disabled and no secret inputs", async () => {
    renderWithQueryClient(<AiProvidersSettings />);

    for (const provider of ["Ollama", "OpenRouter", "OpenAI", "Anthropic", "Gemini", "Grok"]) {
      expect(await screen.findByText(provider)).toBeInTheDocument();
    }
    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.getAllByText("Disabled")).toHaveLength(5);
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/api key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/save key/i)).not.toBeInTheDocument();
  });

  it("round-trips non-secret routing and cost-cap settings", async () => {
    renderWithQueryClient(<AiProvidersSettings />);

    const perCall = await screen.findByLabelText("Per-call cost cap");
    fireEvent.change(perCall, { target: { value: "2.5" } });
    fireEvent.blur(perCall);

    await waitFor(() => {
      expect(parallaxApi.aiUpdateRoutingPolicy).toHaveBeenCalledWith({
        routing_mode: "local_only",
        local_fallback_enabled: true,
        per_call_cost_cap_usd: 2.5,
        monthly_cost_cap_usd: 25,
      });
    });
    expect(useAiStore.getState().perCallCostCapUsd).toBe(2.5);
  });
});
