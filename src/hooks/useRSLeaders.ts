import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parallaxApi, type RSLeadersResponse } from "@/modules/parallax/api";
import { useNavigationStore } from "@/store/navigation";

const snapshotKey = ["parallax", "rs-leaders"] as const;
const refreshKey = ["parallax", "rs-leaders-refresh"] as const;
const progressKey = ["parallax", "rs-leaders-progress"] as const;

export function useRSLeaders(enabled: boolean, refreshAfterAuth = false) {
  const queryClient = useQueryClient();
  const sessionEpoch = useNavigationStore((state) => state.namesContext.brokerSessionEpoch);
  const sessionSnapshotKey = useMemo(() => [...snapshotKey, sessionEpoch] as const, [sessionEpoch]);
  const sessionRefreshKey = useMemo(() => [...refreshKey, sessionEpoch] as const, [sessionEpoch]);
  const sessionProgressKey = useMemo(() => [...progressKey, sessionEpoch] as const, [sessionEpoch]);

  const query = useQuery({
    queryKey: sessionSnapshotKey,
    queryFn: ({ signal }) => parallaxApi.rsLeaders(signal),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const progress = useQuery({
    queryKey: sessionProgressKey,
    queryFn: async () => null,
    enabled: false,
    initialData: null as { phase: "downloading" | "verifying" | null; error: string | null } | null,
  });

  const refresh = useCallback(() => queryClient.fetchQuery<RSLeadersResponse>({
    queryKey: sessionRefreshKey,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      queryClient.setQueryData(sessionProgressKey, { phase: "downloading", error: null });
      try {
        const source = await parallaxApi.refreshRSLeadersSource(signal);
        if (source.phase === "unavailable") {
          const message = source.issues.join(" · ") || "Published rankings are unavailable.";
          queryClient.setQueryData(sessionProgressKey, { phase: null, error: message });
          const saved = queryClient.getQueryData<RSLeadersResponse>(sessionSnapshotKey);
          if (saved) return saved;
          throw new Error(message);
        }
        queryClient.setQueryData(sessionProgressKey, { phase: "verifying", error: null });
        const result = await parallaxApi.resolveRSLeaders(signal);
        queryClient.setQueryData(sessionSnapshotKey, result);
        void queryClient.invalidateQueries({ queryKey: ["parallax", "rs-ratings"] });
        queryClient.setQueryData(sessionProgressKey, {
          phase: null,
          error: result.status === "unavailable" ? result.issues.join(" · ") || "Leader listings could not be verified." : null,
        });
        return result;
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          queryClient.setQueryData(sessionProgressKey, { phase: null, error: null });
          throw error;
        }
        queryClient.setQueryData(sessionProgressKey, {
          phase: null,
          error: error instanceof Error ? error.message : "Leader update failed.",
        });
        throw error;
      }
    },
  }), [queryClient, sessionProgressKey, sessionRefreshKey, sessionSnapshotKey]);

  useEffect(() => {
    if (enabled && refreshAfterAuth) void refresh().catch(() => undefined);
  }, [enabled, refreshAfterAuth, refresh]);

  return {
    ...query,
    progress: progress.data,
    refresh,
  };
}
