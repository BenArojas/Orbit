/**
 * Network offline detection — Phase 8.1-F
 *
 * Client-side offline detection to fast-fail API calls when the browser
 * knows we're offline. Without this, fetch would burn the 3 backend
 * retries (≈3.5 s) + httpx's own retry budget before surfacing anything
 * to the user, and the user sees no UI feedback until the whole chain
 * bottoms out.
 *
 * How it works:
 *   1. `api.ts request()` calls `ensureOnline()` before every fetch.
 *      If `navigator.onLine` is false, it throws `NetworkOfflineError`
 *      immediately — no fetch, no retry.
 *   2. `initNetworkMonitor(queryClient)` wires window `offline`/`online`
 *      listeners. Offline → singleton toast. Online → dismiss toast +
 *      `invalidateQueries()` so everything refetches automatically.
 *   3. `query.ts` excludes `NetworkOfflineError` from retries — a
 *      no-network error should not trigger the one-retry fallback.
 *
 * Why a singleton toast: a dashboard with N widgets each firing their
 * own query would produce N toasts. `toast.error(..., { id: TOAST_ID })`
 * guarantees at most one is ever on screen, regardless of how many
 * queries fail simultaneously.
 */

import { toast } from "sonner";
import type { QueryClient } from "@tanstack/react-query";

/** Singleton sonner toast id — keeps at most one "offline" toast on screen. */
export const NETWORK_OFFLINE_TOAST_ID = "network-offline";

/** User-facing copy. Kept in one place so tests can assert against it. */
export const NETWORK_OFFLINE_MESSAGE =
  "Connection might be off — check your Wi-Fi and try again";

/**
 * Thrown by `api.ts request()` when `navigator.onLine === false`.
 * Excluded from TanStack Query retries in `query.ts`.
 */
export class NetworkOfflineError extends Error {
  constructor(message = NETWORK_OFFLINE_MESSAGE) {
    super(message);
    this.name = "NetworkOfflineError";
  }
}

/**
 * Pre-flight check used by `api.ts request()`. Also fires the toast so
 * every failing request contributes to the same singleton — meaning an
 * offline user sees the toast even if the `offline` window event hasn't
 * fired yet (some environments fire it lazily).
 */
export function ensureOnline(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    showOfflineToast();
    throw new NetworkOfflineError();
  }
}

/** Shows the singleton offline toast. Safe to call repeatedly. */
export function showOfflineToast(): void {
  toast.error(NETWORK_OFFLINE_MESSAGE, {
    id: NETWORK_OFFLINE_TOAST_ID,
    duration: Infinity,
  });
}

/** Dismisses the offline toast, if shown. */
export function dismissOfflineToast(): void {
  toast.dismiss(NETWORK_OFFLINE_TOAST_ID);
}

/**
 * Wire up window `offline` / `online` listeners once on app mount.
 * Returns a cleanup function (useful for tests / StrictMode remounts).
 */
export function initNetworkMonitor(queryClient: QueryClient): () => void {
  if (typeof window === "undefined") return () => {};

  const handleOffline = () => {
    showOfflineToast();
  };

  const handleOnline = () => {
    dismissOfflineToast();
    // Refetch everything that's currently mounted — dashboards, charts,
    // watchlists. `invalidateQueries()` with no filter marks all queries
    // stale; active queries refetch immediately, inactive ones on next
    // mount.
    void queryClient.invalidateQueries();
  };

  window.addEventListener("offline", handleOffline);
  window.addEventListener("online", handleOnline);

  return () => {
    window.removeEventListener("offline", handleOffline);
    window.removeEventListener("online", handleOnline);
  };
}
