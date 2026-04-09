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

interface UseGatewayReturn {
  /** Current Gateway state from the backend */
  status: GatewayStatusResponse | null;
  /** Is the Gateway running and healthy? */
  isRunning: boolean;
  /** Is a download/setup in progress? */
  isProvisioning: boolean;
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

  const isProvisioning = status
    ? PROVISIONING_STATES.includes(status.state)
    : false;
  const isRunning = status?.running ?? false;

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

    // Poll faster during provisioning/starting, slower when stable
    const ms = isProvisioning ? 2000 : 30000;
    intervalRef.current = setInterval(fetchStatus, ms);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus, isProvisioning]);

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
    isProvisioning,
    provision,
    start,
    stop,
    actionError,
    actionLoading,
  };
}
