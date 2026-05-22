/**
 * useStockTags — query rule-fire tags for a set of conids.
 *
 * Shared hook backing the inline <StockTagDots> renderer used in the
 * watchlist sidebar, screener, and Today page. Wraps
 * GET /triggers/tags?conids=... in a TanStack Query keyed by the sorted
 * conid list (so reorders don't refetch). WebSocket trigger_alert events
 * invalidate all stock-tag queries to reflect freshly-fired rules.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type StockTagMap } from "@/lib/api";
import { useWebSocket, type WsMessage } from "./useWebSocket";

export function useStockTags(conids: number[]) {
  const qc = useQueryClient();
  const conidsKey = [...conids].sort((a, b) => a - b).join(",");

  // WS-driven invalidation
  const { addHandler } = useWebSocket();
  useEffect(() => {
    const off = addHandler((m: WsMessage) => {
      if (m.type === "trigger_alert") {
        qc.invalidateQueries({ queryKey: ["stock-tags"] });
      }
    });
    return off;
  }, [addHandler, qc]);

  return useQuery<StockTagMap>({
    queryKey: ["stock-tags", conidsKey],
    queryFn: ({ signal }) => api.getStockTags(conids, signal),
    enabled: conids.length > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
