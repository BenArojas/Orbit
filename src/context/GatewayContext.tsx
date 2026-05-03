/**
 * GatewayContext — single source of truth for Gateway + IBKR auth state.
 *
 * Wraps the whole app so any component can call useIbkrReady() without
 * prop-drilling.  Eliminates the duplicate /auth/status polling that was
 * causing 401-spam on first load (Ben's issue #3).
 *
 * Phase 8 / Task 3.7 — WS auth_state subscription:
 *   GatewayProvider now subscribes to WebSocket `auth_state` messages
 *   pushed by the backend (Task 2.5). On receipt it writes the new auth
 *   state directly into the TanStack Query cache, so every consumer of
 *   GatewayContext re-renders immediately — no polling lag.  The 60s
 *   steady-state poll in useGateway becomes a pure heartbeat/consistency
 *   check rather than the primary change-detection mechanism.
 *
 * Usage:
 *   const ibkrReady = useIbkrReady();   // gate any IBKR-dependent query
 *   const { isAuthenticated } = useGatewayContext();  // full status
 */

import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGateway } from "@/hooks/useGateway";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import type { GatewayStatusResponse } from "@/lib/api";

interface GatewayContextValue {
  status: GatewayStatusResponse | null;
  isRunning: boolean;
  isAuthenticated: boolean;
  needsLogin: boolean;
  isProvisioning: boolean;
  /** True when a previously-authenticated session has since dropped. */
  sessionDropped: boolean;
  provision: (force?: boolean) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** R1 — soft logout (POST /v1/api/logout); JVM keeps running. */
  logout: () => Promise<void>;
  /** R2 — kill the JVM and respawn (no file changes). */
  restartGateway: () => Promise<void>;
  /** R3 — restartGateway + wipe session files on disk. */
  factoryReset: () => Promise<void>;
  actionError: string | null;
  actionLoading: boolean;
  refetch: () => Promise<void>;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

const GATEWAY_QUERY_KEY = ["gateway-status"] as const;

/** Wrap the app root with this so all children can call useIbkrReady(). */
export function GatewayProvider({ children }: { children: ReactNode }) {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  const { addHandler } = useWebSocket();

  // Phase 8 / Task 3.7 — handle WS `auth_state` pushes from the backend.
  //
  // When IBKR sends an `sts` event (Task 2.5), the backend broadcasts:
  //   { type: "auth_state", authenticated: boolean, session_dropped: boolean }
  //
  // We write this directly into the TanStack cache so every consumer of
  // GatewayContext re-renders immediately — without waiting for the next
  // 60s polling tick.  The backend response shape matches GatewayStatusResponse
  // (partial merge), so we only update the two fields that changed.
  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== "auth_state") return;

      const authenticated = msg.authenticated as boolean | undefined;
      const sessionDropped = msg.session_dropped as boolean | undefined;

      if (typeof authenticated !== "boolean") return;

      queryClient.setQueryData<GatewayStatusResponse>(
        GATEWAY_QUERY_KEY,
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            authenticated,
            session_dropped: sessionDropped ?? prev.session_dropped,
            // When authenticated flips false, auth_required becomes true
            // so the UI shows the login prompt without waiting for a poll.
            auth_required: authenticated ? false : (prev.auth_required ?? true),
          };
        },
      );
    },
    [queryClient],
  );

  useEffect(() => {
    return addHandler(handleWsMessage);
  }, [addHandler, handleWsMessage]);

  return (
    <GatewayContext.Provider value={gateway}>
      {children}
    </GatewayContext.Provider>
  );
}

/** Returns true when a previously-authenticated IBKR session has since dropped. */
export function useSessionDropped(): boolean {
  const ctx = useContext(GatewayContext);
  if (!ctx) return false;
  return ctx.sessionDropped;
}

/** Full gateway context — use in GatewaySetup and other gateway-aware UI. */
export function useGatewayContext(): GatewayContextValue {
  const ctx = useContext(GatewayContext);
  if (!ctx) {
    throw new Error("useGatewayContext must be used inside <GatewayProvider>");
  }
  return ctx;
}

/**
 * Returns true only when the Gateway is running AND the IBKR session is
 * authenticated.  Pass this as `enabled` to any TanStack Query that hits
 * an IBKR-backed endpoint to stop the pre-auth 401 flood.
 *
 * @example
 *   const ibkrReady = useIbkrReady();
 *   const { data } = useQuery({ queryKey: [...], queryFn: ..., enabled: ibkrReady });
 */
export function useIbkrReady(): boolean {
  const ctx = useContext(GatewayContext);
  // If used outside the provider (e.g. in tests), default to false — safe.
  if (!ctx) return false;
  return ctx.isRunning && ctx.isAuthenticated;
}
