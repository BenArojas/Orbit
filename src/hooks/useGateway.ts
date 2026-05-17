/**
 * useGateway — polls IBKR Gateway status and exposes lifecycle actions.
 *
 * Built on TanStack Query so every consumer of GatewayContext shares a
 * single polling source. Before 8.1-1C this was a bespoke setInterval
 * hook that created an independent cold-start window for GatewaySetup —
 * HealthStrip (useQuery) would reflect "backend ready" seconds before
 * useGateway's own interval finished firing, which is the lag the user
 * saw on startup.
 *
 * Polling cadence (Phase 8 / Task 3.7):
 *   - false  when the tab is hidden (Page Visibility API — no point
 *            polling a tab the user isn't looking at)
 *   - 2 s    while provisioning, cold start, or no status yet
 *   - 3 s    when the gateway is up but waiting for IBKR login
 *            (keeps the login-success feedback responsive)
 *   - 60 s   once fully authenticated (steady-state heartbeat only —
 *            real auth changes are pushed via WS `auth_state` topic,
 *            Task 2.5)
 *
 * Immediate refetches are triggered by:
 *   - WebSocket `session_dropped` event via IbkrReconnectBanner
 *   - WebSocket `auth_state` push → GatewayContext writes cache directly
 *   - Gateway action mutations (provision/start/stop/reset-session/
 *     factory-reset) write their response directly into the cache
 *   - Visibility flip hidden→visible (refetchOnWindowFocus)
 */

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, GatewayStatusResponse, GatewayState } from "@/lib/api";

// Root-level query keys whose data depends on the IBKR session.  When the
// session is reset (logout / restart / factory reset) we invalidate these
// so the UI doesn't show stale prices, watchlists, or scanner metadata
// until something else asks for fresh data.  Local-only state (gateway
// status, settings, AI status, trigger-rule config) is intentionally left
// alone — that data isn't tied to an IBKR session.
const IBKR_QUERY_PREFIXES: ReadonlyArray<string> = [
  "quote",
  "candles",
  "indicators",
  "chart-data",
  "contract-info",
  "conid",
  "watchlists",
  "watchlist-instruments",
  "watchlist-quotes",
  "sectors",
  "sector-rotation",
  "market-breadth",
  "trigger-hits",
  "health-details",
  "screener-presets",
  "screener-filter-catalogue",
  "screener-locations",
  "screener-all-scan-types",
];

// Poll cadences — Phase 8 / Task 3.7
const COLD_POLL_MS      = 2_000;   // no data yet / provisioning
const PRELOGIN_POLL_MS  = 3_000;   // gateway up, waiting for IBKR login
const STEADY_POLL_MS    = 60_000;  // fully authenticated (WS drives changes)
// staleTime slightly below the slowest cadence so background refetches fire
// without forcing a redundant refetch on component remount.
const STALE_TIME_MS = 55_000;

const GATEWAY_QUERY_KEY = ["gateway-status"] as const;

const PROVISIONING_STATES: GatewayState[] = [
  "downloading_jre",
  "downloading_gw",
  "starting",
];

/**
 * Optional feedback layer for an action — toasts on success/failure
 * and IBKR-cache invalidation.  Kept as an opts bag so the
 * cheap actions (provision/start/stop) can opt out — their state
 * change is already obvious from the gateway card body.
 */
interface ActionFeedback {
  successToast?: string;
  errorToast?: boolean;
  invalidateIbkr?: boolean;
}

interface UseGatewayReturn {
  /** Current Gateway state from the backend */
  status: GatewayStatusResponse | null;
  /** Is the Gateway running and healthy? */
  isRunning: boolean;
  /** Is the IBKR session fully authenticated? */
  isAuthenticated: boolean;
  /** Is the Gateway up, but waiting for the user to log in? */
  needsLogin: boolean;
  /** Is a download/setup in progress? */
  isProvisioning: boolean;
  /** True when a previously-authenticated session has since dropped. */
  sessionDropped: boolean;
  /** Trigger first-time provisioning (download JRE + Gateway) */
  provision: (force?: boolean) => Promise<void>;
  /** Start the Gateway process */
  start: () => Promise<void>;
  /** Stop the Gateway process */
  stop: () => Promise<void>;
  /** R1 — soft logout via IBKR /logout, JVM stays running */
  logout: () => Promise<void>;
  /** R2 — kill JVM and respawn (renamed from resetSession in UI as "Restart Gateway") */
  restartGateway: () => Promise<void>;
  /** R3 — reset-session + wipe root/logs, root/Jts, *.cookie, *.session */
  factoryReset: () => Promise<void>;
  /** Error from the last action, if any */
  actionError: string | null;
  /** Is an action (provision/start/stop/reset) currently running? */
  actionLoading: boolean;
  /**
   * Force an immediate /gateway/status refetch (bypasses the poll window).
   * Called by IbkrReconnectBanner when a WebSocket `session_dropped` event
   * arrives — without this, the UI would keep showing stale
   * `authenticated: true` until the next poll.
   */
  refetch: () => Promise<void>;
}

/**
 * Returns the refetch interval for the gateway-status query, or `false` to
 * pause polling entirely.
 *
 * Priority (highest first):
 *   1. Tab hidden → pause (Page Visibility API).  No point hitting the
 *      backend for a tab the user isn't looking at; TanStack's
 *      refetchOnWindowFocus will fire one immediate fetch when the tab
 *      comes back into view.
 *   2. Cold start / provisioning → 2 s fast poll.
 *   3. Waiting for IBKR login → 3 s (snappy login-success feedback).
 *   4. Fully authenticated → 60 s heartbeat only; WS auth_state push
 *      (Task 2.5) drives real-time auth changes.
 */
function computeRefetchInterval(
  data: GatewayStatusResponse | undefined,
): number | false {
  // Pause while the tab is hidden — resume on visibility restore.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false;
  }
  if (!data) return COLD_POLL_MS;
  if (PROVISIONING_STATES.includes(data.state)) return COLD_POLL_MS;
  if (data.auth_required ?? false) return PRELOGIN_POLL_MS;
  if (data.authenticated) return STEADY_POLL_MS;
  // Gateway running but not authenticated and no login required
  // (e.g. transitioning states) — keep fast poll.
  return COLD_POLL_MS;
}

/** @internal Exported for unit testing only. */
export { computeRefetchInterval as __computeRefetchIntervalForTests };

export function useGateway(): UseGatewayReturn {
  const queryClient = useQueryClient();

  const query = useQuery<GatewayStatusResponse>({
    queryKey: GATEWAY_QUERY_KEY,
    queryFn: api.gatewayStatus,
    refetchInterval: (q) => computeRefetchInterval(q.state.data),
    staleTime: STALE_TIME_MS,
    // When the user switches back to the tab, fire one immediate refetch so
    // the UI reflects any auth change that happened while it was hidden.
    // This pairs with the visibility-pause in computeRefetchInterval.
    refetchOnWindowFocus: true,
    // One retry at 1.5 s covers a transient backend blip on cold start
    // without a rapid burst.  The 2 s fast-poll cadence takes over after
    // that, so extra retries only add noise without shortening perceived
    // startup time (the poll would fire in the same window anyway).
    retry: 1,
    retryDelay: 1_500,
  });

  const status = query.data ?? null;
  const isProvisioning = status ? PROVISIONING_STATES.includes(status.state) : false;
  const isRunning = status?.running ?? false;
  const isAuthenticated = status?.authenticated ?? false;
  const needsLogin = status?.auth_required ?? false;
  const sessionDropped = status?.session_dropped ?? false;

  // ── Action state (shared across every mutation below) ────────────────
  // Using a module-scoped cache key for action errors would be cleaner with
  // useMutation, but keeping a single imperative wrapper lets every button
  // in GatewaySetup share one "Last action failed: …" line in the UI.
  const setCacheStatus = useCallback(
    (data: GatewayStatusResponse) => {
      queryClient.setQueryData(GATEWAY_QUERY_KEY, data);
    },
    [queryClient],
  );

  // We track the last action's error + loading state on the query cache
  // under a separate key so re-renders stay consistent across consumers.
  const ACTION_STATE_KEY = ["gateway-action-state"] as const;
  const actionState =
    queryClient.getQueryData<{ error: string | null; loading: boolean }>(
      ACTION_STATE_KEY,
    ) ?? { error: null, loading: false };

  const setActionState = useCallback(
    (next: { error: string | null; loading: boolean }) => {
      queryClient.setQueryData(ACTION_STATE_KEY, next);
    },
    [queryClient],
  );

  /**
   * Optimistically flip the cached state before the API call returns so the
   * UI stops looking frozen between click and the next poll.  The backend
   * response (or the next /gateway/status poll, whichever lands first)
   * will overwrite this synthetic state with reality — there's no need for
   * a clear-on-timeout because the cache is always re-written within
   * one poll cycle.
   */
  const optimisticFlip = useCallback(
    (nextState: GatewayState) => {
      const current = queryClient.getQueryData<GatewayStatusResponse>(
        GATEWAY_QUERY_KEY,
      );
      if (current) {
        setCacheStatus({ ...current, state: nextState });
      }
    },
    [queryClient, setCacheStatus],
  );

  /**
   * Invalidate every IBKR-session-dependent query so cached data
   * (prices, watchlists, scanner metadata, …) is refetched once the
   * session is restored.  Local-only data (gateway status, settings,
   * AI, trigger-rule config) is left alone.
   */
  const invalidateIbkrQueries = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (q) => {
        const root = Array.isArray(q.queryKey) ? q.queryKey[0] : q.queryKey;
        return typeof root === "string" && IBKR_QUERY_PREFIXES.includes(root);
      },
    });
  }, [queryClient]);

  const runAction = useCallback(
    async (
      fn: () => Promise<GatewayStatusResponse>,
      fallbackMsg: string,
      optimisticState?: GatewayState,
      feedback: ActionFeedback = {},
    ): Promise<void> => {
      setActionState({ error: null, loading: true });
      if (optimisticState) {
        optimisticFlip(optimisticState);
      }
      try {
        const data = await fn();
        setCacheStatus(data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : fallbackMsg;
        setActionState({ error: msg, loading: false });
        if (feedback.errorToast) {
          toast.error(`${fallbackMsg}: ${msg}`);
        }
        // Trigger a real refetch so the UI doesn't get stuck on the
        // optimistic state if the action threw mid-flight.
        queryClient.invalidateQueries({ queryKey: GATEWAY_QUERY_KEY });
        return;
      }
      setActionState({ error: null, loading: false });
      if (feedback.successToast) {
        toast.success(feedback.successToast);
      }
      if (feedback.invalidateIbkr) {
        invalidateIbkrQueries();
      }
    },
    [
      setActionState,
      setCacheStatus,
      optimisticFlip,
      queryClient,
      invalidateIbkrQueries,
    ],
  );

  const provision = useCallback(
    (force = false) =>
      runAction(
        () => api.gatewayProvision(force),
        "Provisioning failed",
        // Show an immediate "downloading" state until the first progress
        // poll arrives. Backend will replace this with the precise step.
        "downloading_jre",
      ),
    [runAction],
  );

  const start = useCallback(
    () => runAction(api.gatewayStart, "Failed to start Gateway", "starting"),
    [runAction],
  );

  const stop = useCallback(
    () => runAction(api.gatewayStop, "Failed to stop Gateway", "stopping"),
    [runAction],
  );

  const logout = useCallback(
    // Soft logout — JVM stays up so we don't flip the lifecycle state.
    // The toast tells the user the IBKR session was actually dropped, and
    // the cache invalidation forces stale prices/watchlists/etc. to refetch
    // once the new session lands.
    () =>
      runAction(api.gatewayLogout, "Logout failed", undefined, {
        successToast: "Logged out of IBKR",
        errorToast: true,
        invalidateIbkr: true,
      }),
    [runAction],
  );

  const restartGateway = useCallback(
    () =>
      runAction(
        api.gatewayResetSession,
        "Failed to restart Gateway",
        "stopping",
        {
          successToast: "Gateway restarted",
          errorToast: true,
          invalidateIbkr: true,
        },
      ),
    [runAction],
  );

  const factoryReset = useCallback(
    () =>
      runAction(
        api.gatewayFactoryReset,
        "Factory reset failed",
        "stopping",
        {
          successToast: "Factory reset complete",
          errorToast: true,
          invalidateIbkr: true,
        },
      ),
    [runAction],
  );

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: GATEWAY_QUERY_KEY });
  }, [queryClient]);

  return {
    status,
    isRunning,
    isAuthenticated,
    needsLogin,
    isProvisioning,
    sessionDropped,
    provision,
    start,
    stop,
    logout,
    restartGateway,
    factoryReset,
    actionError: actionState.error,
    actionLoading: actionState.loading,
    refetch,
  };
}
