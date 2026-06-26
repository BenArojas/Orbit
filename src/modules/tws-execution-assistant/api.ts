/**
 * TWS Execution Assistant sidecar contract.
 *
 * Owns the broker session mode endpoint and TWS-specific endpoint contracts.
 * Transport mechanics stay in "@/lib/sidecarClient".
 */

import { sidecarRequest } from "@/lib/sidecarClient";

export type BrokerSessionMode = "none" | "client_portal" | "tws";

/** Accepted switch targets — "none" cannot be set explicitly. */
export type BrokerSessionSwitchTarget = "client_portal" | "tws";

export interface BrokerSessionModeResponse {
  mode: BrokerSessionMode;
  available_modules: string[];
}

export type TwsAdapterState =
  | "not_initialized"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface ReconciliationSummary {
  position_count: number;
  open_order_count: number;
  unmanaged_order_count: number;
}

export interface TwsStatusResponse {
  mode: BrokerSessionMode;
  connected: boolean;
  adapter_state: TwsAdapterState;
  kill_switch_active: boolean;
  reconciliation_summary: ReconciliationSummary;
}

export const twsApi = {
  getMode: () =>
    sidecarRequest<BrokerSessionModeResponse>("GET", "/orbit/session/mode"),
  setMode: (target: BrokerSessionSwitchTarget) =>
    sidecarRequest<BrokerSessionModeResponse>("POST", "/orbit/session/mode", { target }),
  getStatus: () =>
    sidecarRequest<TwsStatusResponse>("GET", "/execution-assistant/status"),
} as const;
