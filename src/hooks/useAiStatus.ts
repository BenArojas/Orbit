/**
 * useAiStatus — Polls Ollama status and syncs to the AI store.
 *
 * On mount: fetches GET /ai/status once to hydrate the store.
 * Auto-refetches every 10s while the AI panel is mounted, so the UI
 * reacts when the user installs Ollama or pulls a model in their terminal.
 *
 * Also exposes helpers for model listing, selection, and refresh.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  AI_OPENROUTER_MODELS_QUERY_KEY,
  AI_PROVIDERS_QUERY_KEY,
  parallaxApi,
  type AIRoutingPolicyResponse,
  type AIRoutingPolicyUpdate,
} from "@/modules/parallax/api";
import { useAiStore } from "@/store";

/** Refetch interval when Ollama is NOT ready (user might be installing) */
const POLL_INTERVAL_SETUP = 10_000;

/** Refetch interval when Ollama IS ready (just a heartbeat) */
const POLL_INTERVAL_READY = 60_000;

export function useAiStatus() {
  const {
    ollamaState,
    selectedModel,
    availableModels,
    platform,
    ollamaError,
    setOllamaStatus,
    setAvailableModels,
    setProvidersStatus,
    providers = [],
    activeProvider = "ollama",
    routingMode = "local_only",
    analysisProvider,
    setRoutingPolicy,
    setAnalysisProvider,
    setAnalysisModel,
    setAnalysisFallbackEnabled,
    updateProviderStatus,
  } = useAiStore();

  const queryClient = useQueryClient();
  const isReady = ollamaState === "ready";

  // ── Poll /ai/status ──

  // Rule 1: live — staleTime tracks the active refetchInterval / 2
  //   Setup mode (10s interval): staleTime 5s so remounts within 10s serve
  //   fresh data but don't suppress the background refetch at the halfway point.
  //   Ready mode (60s interval): staleTime 30s for the same reason.
  const statusQuery = useQuery({
    queryKey: ["ai", "status"],
    queryFn: () => parallaxApi.aiStatus(),
    refetchInterval: isReady ? POLL_INTERVAL_READY : POLL_INTERVAL_SETUP,
    staleTime: isReady ? 30_000 : 5_000,
  });

  // Sync query result → store
  useEffect(() => {
    if (statusQuery.data) {
      setOllamaStatus(statusQuery.data);
    }
  }, [statusQuery.data, setOllamaStatus]);

  const providersQuery = useQuery({
    queryKey: AI_PROVIDERS_QUERY_KEY,
    queryFn: () => parallaxApi.aiProviders(),
    refetchInterval: isReady ? POLL_INTERVAL_READY : POLL_INTERVAL_SETUP,
    staleTime: isReady ? 30_000 : 5_000,
  });

  useEffect(() => {
    if (providersQuery.data) {
      setProvidersStatus(providersQuery.data);
    }
  }, [providersQuery.data, setProvidersStatus]);

  const routingPolicyQuery = useQuery({
    queryKey: ["ai", "routing-policy"],
    queryFn: () => parallaxApi.aiRoutingPolicy(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (routingPolicyQuery.data) {
      setRoutingPolicy(routingPolicyQuery.data);
      setAnalysisProvider(routingPolicyQuery.data.active_provider);
      setAnalysisFallbackEnabled(
        routingPolicyQuery.data.local_fallback_enabled,
      );
    }
  }, [
    routingPolicyQuery.data,
    setAnalysisFallbackEnabled,
    setAnalysisProvider,
    setRoutingPolicy,
  ]);

  const updateAnalysisRouteMutation = useMutation({
    mutationFn: (policy: AIRoutingPolicyUpdate) =>
      parallaxApi.aiUpdateRoutingPolicy(policy),
    onMutate: async (policy) => {
      await queryClient.cancelQueries({ queryKey: ["ai", "routing-policy"] });
      const state = useAiStore.getState();
      const previousPolicy = queryClient.getQueryData<AIRoutingPolicyResponse>(
        ["ai", "routing-policy"],
      ) ?? {
        active_provider: state.activeProvider,
        routing_mode: state.routingMode,
        local_fallback_enabled: state.localFallbackEnabled,
      };
      queryClient.setQueryData(["ai", "routing-policy"], policy);
      setRoutingPolicy(policy);
      setAnalysisProvider(policy.active_provider);
      setAnalysisFallbackEnabled(policy.local_fallback_enabled);
      return { previousPolicy };
    },
    onSuccess: (policy) => {
      queryClient.setQueryData(["ai", "routing-policy"], policy);
      setRoutingPolicy(policy);
      setAnalysisProvider(policy.active_provider);
      setAnalysisFallbackEnabled(policy.local_fallback_enabled);
      void queryClient.invalidateQueries({ queryKey: AI_PROVIDERS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["ai", "routing-policy"] });
    },
    onError: (_error, _policy, context) => {
      if (context?.previousPolicy) {
        queryClient.setQueryData(
          ["ai", "routing-policy"],
          context.previousPolicy,
        );
        setRoutingPolicy(context.previousPolicy);
        setAnalysisProvider(context.previousPolicy.active_provider);
        setAnalysisFallbackEnabled(
          context.previousPolicy.local_fallback_enabled,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["ai", "routing-policy"] });
    },
  });

  const requestedProvider = analysisProvider ?? activeProvider;
  const openRouterProvider = providers.find(
    (provider) => provider.provider_name === "openrouter",
  );
  const openRouterModelsQuery = useQuery({
    queryKey: AI_OPENROUTER_MODELS_QUERY_KEY,
    queryFn: () => parallaxApi.aiOpenRouterModels(),
    enabled:
      requestedProvider === "openrouter"
      && routingMode !== "local_only"
      && Boolean(openRouterProvider?.enabled && openRouterProvider.has_key),
    staleTime: 10 * 60_000,
  });

  const selectOpenRouterModelMutation = useMutation({
    mutationFn: (model: string) =>
      parallaxApi.aiSelectOpenRouterModel({ model }),
    onSuccess: (data) => {
      setAnalysisModel(data.selected_model);
      if (openRouterProvider && data.selected_model) {
        updateProviderStatus({
          ...openRouterProvider,
          selected_model: data.selected_model,
        });
      }
      queryClient.setQueryData(AI_OPENROUTER_MODELS_QUERY_KEY, data);
      void queryClient.invalidateQueries({ queryKey: AI_PROVIDERS_QUERY_KEY });
    },
  });

  // ── Fetch models when Ollama is running ──

  // Rule 3: static — model list only changes when user pulls/deletes a model;
  // the refresh mutation invalidates explicitly. No polling clock needed.
  const modelsQuery = useQuery({
    queryKey: ["ai", "models"],
    queryFn: () => parallaxApi.aiModels(),
    enabled: ollamaState === "running" || ollamaState === "no_models" || ollamaState === "ready",
    staleTime: Infinity,
    refetchInterval: false,
  });

  useEffect(() => {
    if (modelsQuery.data) {
      setAvailableModels(modelsQuery.data);
    }
  }, [modelsQuery.data, setAvailableModels]);

  // ── Select model ──

  const selectModelMutation = useMutation({
    mutationFn: (model: string) => parallaxApi.aiSelectModel({ model }),
    onSuccess: (data) => {
      setOllamaStatus(data);
      // Invalidate status so everything re-syncs
      queryClient.invalidateQueries({ queryKey: ["ai", "status"] });
    },
  });

  // ── Refresh (re-scan after user pulls a model) ──

  const refreshMutation = useMutation({
    mutationFn: () => parallaxApi.aiRefresh(),
    onSuccess: (data) => {
      setOllamaStatus(data);
      queryClient.invalidateQueries({ queryKey: ["ai", "models"] });
    },
  });

  return {
    // State
    ollamaState,
    selectedModel,
    availableModels,
    platform,
    ollamaError,
    isReady,
    isLoading: statusQuery.isLoading,
    openRouterModels: openRouterModelsQuery.data?.models ?? [],
    openRouterSelectedModel: openRouterModelsQuery.data?.selected_model ?? null,
    isLoadingOpenRouterModels: openRouterModelsQuery.isLoading,
    openRouterModelsError:
      openRouterModelsQuery.error instanceof Error
        ? openRouterModelsQuery.error.message
        : openRouterModelsQuery.error
          ? "Failed to load OpenRouter models."
          : null,

    // Actions
    selectModel: selectModelMutation.mutate,
    isSelectingModel: selectModelMutation.isPending,
    refresh: refreshMutation.mutate,
    isRefreshing: refreshMutation.isPending,
    selectOpenRouterModel: selectOpenRouterModelMutation.mutate,
    isSelectingOpenRouterModel: selectOpenRouterModelMutation.isPending,
    updateAnalysisRoute: updateAnalysisRouteMutation.mutate,
    isUpdatingAnalysisRoute: updateAnalysisRouteMutation.isPending,
    updateAnalysisRouteError: updateAnalysisRouteMutation.error,
  };
}
