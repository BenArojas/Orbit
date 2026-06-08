/**
 * TanStack Query configuration.
 *
 * Creates a shared QueryClient with sensible defaults for a
 * desktop trading app:
 *   - Short stale time (data goes stale fast in markets)
 *   - No retry on 401 (auth errors need re-login, not retry)
 *   - Retry once on network errors (sidecar might be slow to start)
 */

import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/sidecarClient";
import { NetworkOfflineError } from "./network";

// ── Query timing matrix (Phase 8 / Task 3.5) ──────────────────────────────
//
// Rules applied across all useQuery calls in this app:
//
//  1. LIVE market data (quotes, VIX):
//       staleTime = refetchInterval / 2
//       Ensures a remount within the interval gets a quick background refetch
//       at the halfway point rather than serving arbitrarily old data.
//       Example: refetchInterval 10s → staleTime 5s
//
//  2. Server-cached data (sectors/breadth/rotation — 60s server TTL):
//       staleTime: 60_000, refetchInterval: 5 * 60_000
//       Client staleTime matches server cache TTL so remounts within 60s
//       serve instantly from local cache, not from a server that's also
//       serving from cache.
//
//  3. Essentially static data (watchlist names, instrument lists,
//     trigger rules, ai/models, conids):
//       staleTime: Infinity, refetchInterval: false (or omitted)
//       Fetched once per session; mutations/WS events invalidate explicitly.
//       Never burns IBKR quota on a polling clock.
//
//  4. WS-event-driven data (trigger-hits, health-details):
//       staleTime = refetchInterval / 2 as a safety net; WS invalidation
//       is the primary freshness mechanism.
//
//  5. Gateway / health polling:
//       staleTime slightly below refetchInterval so background refetches
//       fire without a redundant remount refetch. Managed in useGateway.ts.
//
// The default staleTime (30s) is intentionally generous — it's the right
// floor for live market data but explicit per-query overrides take precedence.

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,       // 30 seconds — market data moves fast
      gcTime: 5 * 60_000,     // 5 min garbage collection
      refetchOnWindowFocus: false, // Desktop app — no tab switching
      retry: (failureCount, error) => {
        // Don't retry auth errors — user needs to re-login to IBKR
        if (error instanceof ApiError && error.status === 401) return false;
        // Don't retry rate limits — wait for Retry-After
        if (error instanceof ApiError && error.status === 429) return false;
        // Don't retry when the browser is offline — fail fast, show toast,
        // and let `online`-event invalidation refetch on recovery (8.1-F).
        if (error instanceof NetworkOfflineError) return false;
        // Retry up to twice for everything else (network blip, sidecar slow start).
        // Per-query `retry` overrides are intentionally avoided — they replace
        // this function entirely in TanStack v5 and would bypass the
        // NetworkOfflineError / 401 / 429 exclusions above (Phase 8.1-F).
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
