/**
 * GatewayContext — single source of truth for Gateway + IBKR auth state.
 *
 * Wraps the whole app so any component can call useIbkrReady() without
 * prop-drilling.  Eliminates the duplicate /auth/status polling that was
 * causing 401-spam on first load (Ben's issue #3).
 *
 * Usage:
 *   const ibkrReady = useIbkrReady();   // gate any IBKR-dependent query
 *   const { isAuthenticated } = useGatewayContext();  // full status
 */

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useGateway } from "@/hooks/useGateway";
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
  actionError: string | null;
  actionLoading: boolean;
  refetch: () => Promise<void>;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

/** Wrap the app root with this so all children can call useIbkrReady(). */
export function GatewayProvider({ children }: { children: ReactNode }) {
  const gateway = useGateway();
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
