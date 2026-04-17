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
 * Polling cadence (matches HealthStrip):
 *   - 2 s while provisioning, waiting for login, or we have no status yet
 *   - 10 s once the gateway is running + authenticated (steady state)
 *
 * Immediate refetches are triggered by the WebSocket `session_dropped`
 * event via IbkrReconnectBanner; gateway action mutations (provision,
 * start, stop, reset-session, factory-reset) write their response
 * directly into the cache.
 */

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, GatewayStatusResponse, GatewayState } from "@/lib/api";

// Poll cadence — mirror HealthStrip so both widgets update in lockstep.
const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 10_000;
// staleTime slightly below SLOW_POLL_MS so background refetches fire without
// forcing a redundant refetch on component remount.
const STALE_TIME_MS = 8_000;

const GATEWAY_QUERY_KEY = ["gateway-status"] as const;

const PROVISIONING_STATES: GatewayState[] = [
  "downloading_jre",
  "downloading_gw",
  "starting",
];

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
  /** R2 — stop tickle/WS, restart gateway, clear in-memory state */
  resetSession: () => Promise<void>;
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

function computeRefetchInterval(data: GatewayStatusResponse | undefined): number {
  // No data yet = cold start — poll fast so the UI catches up the moment
  // the backend comes online.
  if (!data) return FAST_POLL_MS;
  const provisioning = PROVISIONING_STATES.includes(data.state);
  const needsLogin = data.auth_required ?? false;
  return provisioning || needsLogin ? FAST_POLL_MS : SLOW_POLL_MS;
}

export function useGateway(): UseGatewayReturn {
  const queryClient = useQueryClient();

  const query = useQuery<GatewayStatusResponse>({
    queryKey: GATEWAY_QUERY_KEY,
    queryFn: api.gatewayStatus,
    refetchInterval: (q) => computeRefetchInterval(q.state.data),
    staleTime: STALE_TIME_MS,
    // Backend not ready yet is the common "error" on cold start — keep
    // retrying quietly so the first successful poll wins fast.
    retry: 3,
    retryDelay: 500,
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

  const runAction = useCallback(
    async (
      fn: () => Promise<GatewayStatusResponse>,
      fallbackMsg: string,
    ): Promise<void> => {
      setActionState({ error: null, loading: true });
      try {
        const data = await fn();
        setCacheStatus(data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : fallbackMsg;
        setActionState({ error: msg, loading: false });
        return;
      }
      setActionState({ error: null, loading: false });
    },
    [setActionState, setCacheStatus],
  );

  const provision = useCallback(
    (force = false) =>
      runAction(() => api.gatewayProvision(force), "Provisioning failed"),
    [runAction],
  );

  const start = useCallback(
    () => runAction(api.gatewayStart, "Failed to start Gateway"),
    [runAction],
  );

  const stop = useCallback(
    () => runAction(api.gatewayStop, "Failed to stop Gateway"),
    [runAction],
  );

  const resetSession = useCallback(
    () => runAction(api.gatewayResetSession, "Failed to reset session"),
    [runAction],
  );

  const factoryReset = useCallback(
    () => runAction(api.gatewayFactoryReset, "Factory reset failed"),
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
    resetSession,
    factoryReset,
    actionError: actionState.error,
    actionLoading: actionState.loading,
    refetch,
  };
}
