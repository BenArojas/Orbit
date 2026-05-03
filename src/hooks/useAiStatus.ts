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
import { api } from "@/lib/api";
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
    queryFn: () => api.aiStatus(),
    refetchInterval: isReady ? POLL_INTERVAL_READY : POLL_INTERVAL_SETUP,
    staleTime: isReady ? 30_000 : 5_000,
  });

  // Sync query result → store
  useEffect(() => {
    if (statusQuery.data) {
      setOllamaStatus(statusQuery.data);
    }
  }, [statusQuery.data, setOllamaStatus]);

  // ── Fetch models when Ollama is running ──

  // Rule 3: static — model list only changes when user pulls/deletes a model;
  // the refresh mutation invalidates explicitly. No polling clock needed.
  const modelsQuery = useQuery({
    queryKey: ["ai", "models"],
    queryFn: () => api.aiModels(),
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
    mutationFn: (model: string) => api.aiSelectModel({ model }),
    onSuccess: (data) => {
      setOllamaStatus(data);
      // Invalidate status so everything re-syncs
      queryClient.invalidateQueries({ queryKey: ["ai", "status"] });
    },
  });

  // ── Refresh (re-scan after user pulls a model) ──

  const refreshMutation = useMutation({
    mutationFn: () => api.aiRefresh(),
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

    // Actions
    selectModel: selectModelMutation.mutate,
    isSelectingModel: selectModelMutation.isPending,
    refresh: refreshMutation.mutate,
    isRefreshing: refreshMutation.isPending,
  };
}
