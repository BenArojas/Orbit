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
import { ApiError } from "./api";
import { NetworkOfflineError } from "./network";

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
        // Retry once for everything else (network blip, sidecar slow start)
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
