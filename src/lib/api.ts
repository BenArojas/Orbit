/**
 * API client for the Orbit Python sidecar.
 *
 * All HTTP requests to the backend go through this module.
 * Components never call fetch() directly — they use TanStack Query
 * hooks that call these functions under the hood.
 *
 * Base URL points to the Python FastAPI sidecar running on localhost:8000.
 * In dev mode the frontend runs on :1420 (Vite) and proxies to :8000.
 * In production, Tauri launches the sidecar automatically.
 *
 * Orbit integration:
 *   These types and endpoints are shared by Orbit modules. The base URL stays
 *   the same; MoonMarket endpoints live under the /moonmarket/* prefix.
 */


import { request } from "@/lib/sidecarClient";


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



// ── API Error ───────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(body.message as string || `API error ${status}`);
    this.name = "ApiError";
  }
}

// ── Core fetch helper ───────────────────────────────────────



// ── API functions ───────────────────────────────────────────
// Each function maps to one backend endpoint.
// TanStack Query hooks call these — components never call them directly.

// Health & Auth
export const api = {
  health: () => request<HealthResponse>("GET", "/health"),
  authStatus: () => request<AuthStatusResponse>("GET", "/auth/status"),
  logout: () => request<void>("POST", "/auth/logout"),

  // Gateway (IBKR Client Portal lifecycle)
  gatewayStatus: () =>
    request<GatewayStatusResponse>("GET", "/gateway/status"),

  gatewayProvision: (force = false) =>
    request<GatewayStatusResponse>("POST", `/gateway/provision?force=${force}`),

  gatewayStart: () =>
    request<GatewayStatusResponse>("POST", "/gateway/start"),

  gatewayStop: () =>
    request<GatewayStatusResponse>("POST", "/gateway/stop"),

  gatewayReprovision: () =>
    request<GatewayStatusResponse>("POST", "/gateway/reprovision"),

  // R1 — soft logout: POST IBKR /v1/api/logout, drop session, leave JVM alive.
  // Fastest recovery (~1 s); user can re-login immediately without a Java cold start.
  gatewayLogout: () =>
    request<GatewayStatusResponse>("POST", "/gateway/logout"),

  // R2 — stop tickle + WS + gateway, clear in-memory state, restart gateway.
  // Files on disk are untouched.
  gatewayResetSession: () =>
    request<GatewayStatusResponse>("POST", "/gateway/reset-session"),

  // R3 — reset-session + delete root/logs, root/Jts, *.cookie, *.session.
  // Preserves the JRE, Gateway binaries, and conf.yaml.
  gatewayFactoryReset: () =>
    request<GatewayStatusResponse>("POST", "/gateway/factory-reset"),

} as const;
