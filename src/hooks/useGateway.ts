/**
 * useGateway — polls IBKR Gateway status and exposes lifecycle actions.
 *
 * Mirrors the useAiStatus pattern:
 *   - Polls /gateway/status at a configurable interval
 *   - Faster polling during provisioning (2s), slower when stable (30s)
 *   - Exposes provision/start/stop actions for the frontend UI
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, GatewayStatusResponse, GatewayState } from "@/lib/api";

// How long (ms) we stay at the fast poll interval while waiting for login
// before backing off to SLOW_POLL_MS to reduce noise.
const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 30_000;
const FAST_POLL_LIMIT_MS = 90_000; // back off after 90 s

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
  /** Error from the last action, if any */
  actionError: string | null;
  /** Is an action (provision/start/stop) currently running? */
  actionLoading: boolean;
  /**
   * Force an immediate /gateway/status poll (bypasses the 30 s slow-poll
   * wait). Used by the IbkrReconnectBanner when a WebSocket
   * `session_dropped` event arrives — without this, the UI would keep
   * showing stale `authenticated: true` until the next slow poll.
   */
  refetch: () => Promise<void>;
}

const PROVISIONING_STATES: GatewayState[] = [
  "downloading_jre",
  "downloading_gw",
  "starting",
];

export function useGateway(): UseGatewayReturn {
  const [status, setStatus] = useState<GatewayStatusResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track when we entered the "waiting for login" fast-poll window
  const fastPollStartRef = useRef<number | null>(null);

  const isProvisioning = status
    ? PROVISIONING_STATES.includes(status.state)
    : false;
  const isRunning = status?.running ?? false;
  const isAuthenticated = status?.authenticated ?? false;
  const needsLogin = status?.auth_required ?? false;
  const sessionDropped = status?.session_dropped ?? false;

  // ── Polling ──────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.gatewayStatus();
      setStatus(data);
    } catch {
      // Backend not up yet — ignore, will retry
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // Poll faster during provisioning/starting.
    // While needsLogin we start fast then back off after FAST_POLL_LIMIT_MS
    // to avoid drowning the Gateway in auth probes.
    const wantsFast = isProvisioning || needsLogin;
    if (!wantsFast) {
      fastPollStartRef.current = null;
    } else if (fastPollStartRef.current === null) {
      fastPollStartRef.current = Date.now();
    }

    const elapsed = fastPollStartRef.current
      ? Date.now() - fastPollStartRef.current
      : 0;
    const ms =
      wantsFast && elapsed < FAST_POLL_LIMIT_MS ? FAST_POLL_MS : SLOW_POLL_MS;

    intervalRef.current = setInterval(fetchStatus, ms);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus, isProvisioning, needsLogin]);

  // ── Actions ──────────────────────────────────────────────

  const provision = useCallback(
    async (force = false) => {
      setActionError(null);
      setActionLoading(true);
      try {
        const data = await api.gatewayProvision(force);
        setStatus(data);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Provisioning failed";
        setActionError(msg);
      } finally {
        setActionLoading(false);
      }
    },
    [],
  );

  const start = useCallback(async () => {
    setActionError(null);
    setActionLoading(true);
    try {
      const data = await api.gatewayStart();
      setStatus(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start Gateway";
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setActionError(null);
    setActionLoading(true);
    try {
      const data = await api.gatewayStop();
      setStatus(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to stop Gateway";
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  }, []);

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
    actionError,
    actionLoading,
    refetch: fetchStatus,
  };
}
