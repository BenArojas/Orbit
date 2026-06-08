/**
 * Shared Orbit shell API seam for the Python sidecar.
 *
 * Product-module endpoint contracts should live in their owning modules:
 *
 * - MoonMarket: "@/modules/moonmarket/api"
 * - Inflect: "@/modules/inflect/api"
 * - Parallax: "@/modules/parallax/api"
 *
 * This file intentionally remains as a small compatibility/shared-shell layer
 * for Orbit-level concerns such as health, auth, and IBKR Gateway lifecycle.
 * New product endpoints should not be added here.
 *
 * All HTTP transport behavior is owned by "@/lib/sidecarClient".
 */

// Shared shell response types. Product-module response types belong in their module API files.
// Orbit-level sidecar endpoints. Product modules should use their module-local API files.


import { sidecarRequest } from "@/lib/sidecarClient";


// ── Types ───────────────────────────────────────────────────
// Mirror the Pydantic models from backend/models/__init__.py.
// If you change a backend model, update the matching type here.

export interface HealthResponse {
  status: "ok" | "degraded";
  ibkr_connected: boolean;
  ibkr_authenticated: boolean;
  ws_ready: boolean;
  gateway_running: boolean;
  gateway_state: GatewayState;
  version: string;
}

// ── Gateway types ──────────────────────────────────────────

export type GatewayState =
  | "not_provisioned"
  | "downloading_jre"
  | "downloading_gw"
  | "provisioned"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export interface GatewayProgress {
  step: string;
  bytes_downloaded: number;
  bytes_total: number;
  percent: number;
}

export interface GatewayStatusResponse {
  state: GatewayState;
  provisioned: boolean;
  running: boolean;
  authenticated: boolean;
  auth_required: boolean;
  auth_message: string;
  /** True when the session was previously authenticated but has since dropped. */
  session_dropped?: boolean;
  gateway_url: string;
  gateway_home: string;
  error: string | null;
  platform: string;
  progress?: GatewayProgress;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  ws_ready: boolean;
  message: string;
}



// ── Core fetch helper ───────────────────────────────────────



// ── API functions ───────────────────────────────────────────
// Each function maps to one backend endpoint.
// TanStack Query hooks call these — components never call them directly.

// Health & Auth
export const api = {
  health: () => sidecarRequest<HealthResponse>("GET", "/health"),
  authStatus: () => sidecarRequest<AuthStatusResponse>("GET", "/auth/status"),
  logout: () => sidecarRequest<void>("POST", "/auth/logout"),

  // Gateway (IBKR Client Portal lifecycle)
  gatewayStatus: () =>
    sidecarRequest<GatewayStatusResponse>("GET", "/gateway/status"),

  gatewayProvision: (force = false) =>
    sidecarRequest<GatewayStatusResponse>("POST", `/gateway/provision?force=${force}`),

  gatewayStart: () =>
    sidecarRequest<GatewayStatusResponse>("POST", "/gateway/start"),

  gatewayStop: () =>
    sidecarRequest<GatewayStatusResponse>("POST", "/gateway/stop"),

  gatewayReprovision: () =>
    sidecarRequest<GatewayStatusResponse>("POST", "/gateway/reprovision"),

  // R1 — soft logout: POST IBKR /v1/api/logout, drop session, leave JVM alive.
  // Fastest recovery (~1 s); user can re-login immediately without a Java cold start.
  gatewayLogout: () =>
    sidecarRequest<GatewayStatusResponse>("POST", "/gateway/logout"),

  // R2 — stop tickle + WS + gateway, clear in-memory state, restart gateway.
  // Files on disk are untouched.
  gatewayResetSession: () =>
    sidecarRequest<GatewayStatusResponse>("POST", "/gateway/reset-session"),

  // R3 — reset-session + delete root/logs, root/Jts, *.cookie, *.session.
  // Preserves the JRE, Gateway binaries, and conf.yaml.
  gatewayFactoryReset: () =>
    sidecarRequest<GatewayStatusResponse>("POST", "/gateway/factory-reset"),

} as const;
