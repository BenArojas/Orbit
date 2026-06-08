/**
 * TanStack Query hook for Fibonacci config — canonical ratios + active
 * scoring weights.
 *
 * Config rarely changes (only when the user edits weights), so we cache
 * with `staleTime: Infinity`. The PUT mutation invalidates the query
 * after a successful save so the new weights propagate. We also
 * invalidate every `["indicators"]`-keyed query because the chart's
 * fib display depends on weights — refetching keeps the displayed
 * score in sync with what the user just edited.
 *
 * Branch 3 / plan decision 3A.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { parallaxApi } from "@/modules/parallax/api";
import type { FibConfig, UpdateFibConfigRequest } from "@/modules/parallax/api";

// ── Query key factory ────────────────────────────────────────

const FIB_CONFIG_KEY = ["fib-config"] as const;

// ── Public hook ──────────────────────────────────────────────

interface UseFibConfigReturn {
  config: FibConfig | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Persist new weights server-side. */
  updateConfig: (req: UpdateFibConfigRequest) => void;
  /** Async variant — resolves with the server's normalized weights. */
  updateConfigAsync: (req: UpdateFibConfigRequest) => Promise<FibConfig>;
  isUpdating: boolean;
  updateError: Error | null;
}

export function useFibConfig(): UseFibConfigReturn {
  const qc = useQueryClient();

  const query = useQuery<FibConfig>({
    queryKey: FIB_CONFIG_KEY,
    queryFn: () => parallaxApi.getFibConfig(),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: (req: UpdateFibConfigRequest) => parallaxApi.updateFibConfig(req),
    onSuccess: (config) => {
      // Replace the cached config with the server's normalized response
      // (avoids a redundant refetch right after PUT) ...
      qc.setQueryData(FIB_CONFIG_KEY, config);
      // ... and refetch any indicator queries so chart scores reflect
      // the new weights immediately.
      qc.invalidateQueries({ queryKey: ["indicators"] });
    },
  });

  return {
    config: query.data,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    updateConfig: (req) => mutation.mutate(req),
    updateConfigAsync: (req) => mutation.mutateAsync(req),
    isUpdating: mutation.isPending,
    updateError: (mutation.error as Error | null) ?? null,
  };
}
