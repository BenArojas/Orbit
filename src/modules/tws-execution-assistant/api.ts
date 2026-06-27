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
  /** TCP-reachable even before Orbit's adapter connects. */
  api_server_available: boolean;
}

export interface PositionSnapshot {
  conid: number;
  symbol: string;
  position: number;
  avg_cost: number;
}

export interface OrderSnapshot {
  order_id: number;
  conid: number;
  symbol: string;
  side: string;
  quantity: number;
  order_type: string;
  lmt_price: number | null;
  status: string;
  is_unmanaged: boolean;
}

export interface ReconciliationSnapshot {
  position_count: number;
  open_order_count: number;
  unmanaged_order_count: number;
  positions: PositionSnapshot[];
  open_orders: OrderSnapshot[];
}

export interface TwsConnectRequest {
  host: string;
  port: number;
  client_id: number;
}

export const TWS_CONNECT_DEFAULTS: TwsConnectRequest = {
  host: "127.0.0.1",
  port: 4002, // IB Gateway paper; TWS paper is 7497
  client_id: 1,
};

export type ExecutionPlanStatus = "draft" | "valid" | "invalid";
export type ExecutionPlanSide = "BUY" | "SELL";
export type ExecutionPlanOrderType = "LMT" | "MKT";

export interface ExecutionPlanDraftRequest {
  conid: number;
  symbol: string;
  side: ExecutionPlanSide;
  quantity: number;
  order_type: ExecutionPlanOrderType;
  limit_price: number | null;
}

export interface ExecutionPlan {
  plan_id: string;
  conid: number;
  symbol: string;
  side: ExecutionPlanSide;
  quantity: number;
  order_type: ExecutionPlanOrderType;
  limit_price: number | null;
  status: ExecutionPlanStatus;
  validation_errors: string[];
  created_at: string;
}

export const twsApi = {
  getMode: () =>
    sidecarRequest<BrokerSessionModeResponse>("GET", "/orbit/session/mode"),
  setMode: (target: BrokerSessionSwitchTarget) =>
    sidecarRequest<BrokerSessionModeResponse>("POST", "/orbit/session/mode", { target }),
  getStatus: () =>
    sidecarRequest<TwsStatusResponse>("GET", "/execution-assistant/status"),
  connect: (req: TwsConnectRequest) =>
    sidecarRequest<TwsStatusResponse>("POST", "/execution-assistant/connect", req),
  disconnect: () =>
    sidecarRequest<TwsStatusResponse>("POST", "/execution-assistant/disconnect"),
  getReconciliation: () =>
    sidecarRequest<ReconciliationSnapshot>("GET", "/execution-assistant/reconciliation"),
  createPlanDraft: (req: ExecutionPlanDraftRequest) =>
    sidecarRequest<ExecutionPlan>("POST", "/execution-assistant/plans/draft", req),
  validatePlan: (plan_id: string) =>
    sidecarRequest<ExecutionPlan>("POST", `/execution-assistant/plans/${plan_id}/validate`),
  getPlan: (plan_id: string) =>
    sidecarRequest<ExecutionPlan>("GET", `/execution-assistant/plans/${plan_id}`),
} as const;
