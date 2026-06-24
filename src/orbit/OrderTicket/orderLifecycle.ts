import type {
  MoonMarketLiveOrder,
  MoonMarketOrderDraft,
  MoonMarketOrderSide,
  MoonMarketOrderType,
  MoonMarketTimeInForce,
  MoonMarketTrade,
  MoonMarketTrailingType,
} from "@/modules/moonmarket/api";
import type { OrderTicketAssetClass } from "./useOrderTicketStore";

export type OrderLifecycleInput = {
  conid: number;
  assetClass: OrderTicketAssetClass;
  side: MoonMarketOrderSide;
  quantity: number;
  orderType: MoonMarketOrderType;
  tif: MoonMarketTimeInForce;
  price: string;
  auxPrice: string;
  trailingType: MoonMarketTrailingType;
  trailingAmt: string;
  outsideRth: boolean;
  canUseOutsideRth: boolean;
  takeProfitEnabled: boolean;
  stopLossEnabled: boolean;
  profitTakerPrice: string;
  stopLossPrice: string;
  newClientOrderId: () => string;
};

export type OrderChainResult = {
  orders: MoonMarketOrderDraft[];
  errors: string[];
};

export type OrderResultClassification = {
  kind: "submitted" | "reply_required" | "rejected" | "unknown";
  replyId: string | null;
  orderId: string | null;
  rejected: boolean;
};

export type TrackedOrder = {
  orderId: string;
  order: MoonMarketOrderDraft;
  submittedAt: number;
};

export type OrderTrackerState = {
  orderId: string;
  orderType: string;
  status: "filled" | "partial" | "pending" | "submitted";
  liveStatus?: string | null;
  quantity?: number | null;
  filledQuantity?: number | null;
  averagePrice?: number | null;
  currentPrice?: number | null;
  limitPrice?: number | null;
  distancePercent?: number | null;
  remainingQuantity?: number | null;
};

export type OrderTrackerInput = {
  trackedOrder: TrackedOrder | null;
  liveOrders: MoonMarketLiveOrder[];
  trades: MoonMarketTrade[];
  currentPrice: number | null;
};

export type OrderRefreshReason = "submitted" | "filled" | "cancelled";

export type OrderRefreshPlan = {
  revalidatePositions: boolean;
  invalidateQueryKeys: Array<readonly [string, string, string | number]>;
};

const ORDER_TYPE_CODES: MoonMarketOrderType[] = ["MKT", "LMT", "STP", "STP_LIMIT", "TRAIL", "TRAILLMT"];
const FALLBACK_OUTSIDE_RTH_ORDER_TYPES = new Set<MoonMarketOrderType>(["LMT", "STP_LIMIT", "TRAILLMT"]);
const IBKR_ORDER_TYPES: Record<string, MoonMarketOrderType> = {
  market: "MKT",
  mkt: "MKT",
  limit: "LMT",
  lmt: "LMT",
  stop: "STP",
  stp: "STP",
  stop_limit: "STP_LIMIT",
  stp_lmt: "STP_LIMIT",
  stoplimit: "STP_LIMIT",
  stop_limit_order: "STP_LIMIT",
  trailing_stop: "TRAIL",
  trail: "TRAIL",
  trailing_stop_limit: "TRAILLMT",
  traillmt: "TRAILLMT",
};

export function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// A required price field is invalid when the user typed something that does
// not parse to a positive number.
export function priceInputInvalid(value: string): boolean {
  if (value.trim() === "") return false;
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed <= 0;
}

function mapOrderType(value: string): MoonMarketOrderType | null {
  return IBKR_ORDER_TYPES[value.toLowerCase().replace(/[\s-]+/g, "_")] ?? null;
}

export function orderTypesFromRules(values: unknown): MoonMarketOrderType[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<MoonMarketOrderType>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const code = mapOrderType(value);
    if (code) seen.add(code);
  }
  return ORDER_TYPE_CODES.filter((code) => seen.has(code));
}

export function availableOrderTypesFromRules(values: unknown): MoonMarketOrderType[] {
  const fromRules = orderTypesFromRules(values);
  return fromRules.length ? fromRules : ORDER_TYPE_CODES;
}

export function outsideRthOrderTypesFromRules(values: unknown): Set<MoonMarketOrderType> {
  return new Set(Array.isArray(values) ? orderTypesFromRules(values) : [...FALLBACK_OUTSIDE_RTH_ORDER_TYPES]);
}

export function buildOrderDraft(input: OrderLifecycleInput): MoonMarketOrderDraft {
  const isTrailing = input.orderType === "TRAIL" || input.orderType === "TRAILLMT";
  const needsLimitPrice = input.orderType === "LMT" || input.orderType === "STP_LIMIT";
  const needsStopAuxPrice = input.orderType === "STP" || input.orderType === "STP_LIMIT";

  return {
    conid: input.conid,
    assetClass: input.assetClass,
    side: input.side,
    quantity: input.quantity,
    orderType: input.orderType,
    tif: input.tif,
    price: needsLimitPrice || input.orderType === "TRAILLMT" ? numberOrUndefined(input.price) : undefined,
    auxPrice: needsStopAuxPrice ? numberOrUndefined(input.auxPrice) : undefined,
    trailingType: isTrailing ? input.trailingType : undefined,
    trailingAmt: isTrailing ? numberOrUndefined(input.trailingAmt) : undefined,
    outsideRTH: input.outsideRth && input.canUseOutsideRth ? true : undefined,
  };
}

export function buildOrderChain(input: OrderLifecycleInput): OrderChainResult {
  const baseOrder = buildOrderDraft(input);
  if (input.assetClass === "OPT" || (!input.takeProfitEnabled && !input.stopLossEnabled)) {
    return { orders: [baseOrder], errors: [] };
  }

  const profitPrice = numberOrUndefined(input.profitTakerPrice);
  const stopPrice = numberOrUndefined(input.stopLossPrice);
  const errors: string[] = [];
  if (input.takeProfitEnabled && !profitPrice) errors.push("Profit taker price is required.");
  if (input.stopLossEnabled && !stopPrice) errors.push("Stop loss price is required.");
  if (errors.length) return { orders: [], errors };

  const parentId = input.newClientOrderId();
  const oppositeSide: MoonMarketOrderSide = input.side === "BUY" ? "SELL" : "BUY";
  const orders: MoonMarketOrderDraft[] = [{ ...baseOrder, cOID: parentId }];

  if (input.takeProfitEnabled && profitPrice) {
    orders.push({
      conid: input.conid,
      assetClass: "STK",
      parentId,
      side: oppositeSide,
      quantity: baseOrder.quantity,
      orderType: "LMT",
      tif: "GTC",
      price: profitPrice,
      isSingleGroup: true,
    });
  }

  if (input.stopLossEnabled && stopPrice) {
    orders.push({
      conid: input.conid,
      assetClass: "STK",
      parentId,
      side: oppositeSide,
      quantity: baseOrder.quantity,
      orderType: "STP",
      tif: "GTC",
      price: stopPrice,
      isSingleGroup: true,
    });
  }

  return { orders, errors: [] };
}

export function buildOrderSubmission(input: OrderLifecycleInput): OrderChainResult {
  const errors: string[] = [];
  if (input.quantity <= 0) errors.push("Quantity must be greater than zero.");
  if ((input.orderType === "TRAIL" || input.orderType === "TRAILLMT") && !numberOrUndefined(input.trailingAmt)) {
    errors.push("Trail distance is required.");
  }
  if (input.orderType === "TRAILLMT" && !numberOrUndefined(input.price)) {
    errors.push("Limit offset is required.");
  }
  if (input.orderType === "STP" && !numberOrUndefined(input.auxPrice)) {
    errors.push("Stop price is required.");
  }
  if (input.orderType === "STP_LIMIT" && (!numberOrUndefined(input.price) || !numberOrUndefined(input.auxPrice))) {
    errors.push("Stop-limit orders require both a stop price and a limit price.");
  }
  if ((input.orderType === "LMT" || input.orderType === "STP_LIMIT") && priceInputInvalid(input.price)) {
    errors.push("Limit price must be greater than zero.");
  }
  if ((input.orderType === "STP" || input.orderType === "STP_LIMIT") && priceInputInvalid(input.auxPrice)) {
    errors.push("Stop price must be greater than zero.");
  }
  if (errors.length) return { orders: [], errors };
  return buildOrderChain(input);
}

function resultData(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("result" in result)) return result;
  return (result as { result: unknown }).result;
}

function resultRows(result: unknown): Array<Record<string, unknown>> {
  const payload = resultData(result);
  if (Array.isArray(payload)) {
    return payload.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return data.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
    }
  }
  return payload && typeof payload === "object" ? [payload as Record<string, unknown>] : [];
}

function textId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return null;
}

function rowRejected(row: Record<string, unknown>): boolean {
  if (typeof row.error === "string" && row.error.trim()) return true;
  const status = typeof row.order_status === "string"
    ? row.order_status.toLowerCase()
    : typeof row.status === "string"
      ? row.status.toLowerCase()
      : "";
  return status === "inactive" || status === "rejected";
}

export function classifyOrderResult(result: unknown): OrderResultClassification {
  let replyId: string | null = null;
  let orderId: string | null = null;
  let rejected = false;

  for (const row of resultRows(result)) {
    replyId ??= textId(row.id);
    orderId ??= textId(row.order_id ?? row.orderId);
    rejected ||= rowRejected(row);
  }

  if (rejected) return { kind: "rejected", replyId: null, orderId, rejected: true };
  if (orderId) return { kind: "submitted", replyId: null, orderId, rejected: false };
  if (replyId) return { kind: "reply_required", replyId, orderId: null, rejected: false };
  return { kind: "unknown", replyId: null, orderId: null, rejected: false };
}

function matchingLiveOrder(orders: MoonMarketLiveOrder[], trackedOrder: TrackedOrder | null): MoonMarketLiveOrder | null {
  if (!trackedOrder) return null;
  return orders.find((order) => order.order_id === trackedOrder.orderId) ?? null;
}

// Trades refine average fill price but do not trigger fill state.
function fillEnrichment(trades: MoonMarketTrade[], trackedOrder: TrackedOrder | null): {
  quantity: number;
  averagePrice: number | null;
} | null {
  if (!trackedOrder) return null;
  const matches = trades.filter((trade) => (
    trade.conid === trackedOrder.order.conid
    && trade.side === trackedOrder.order.side
    && trade.trade_time_ms != null
    && trade.trade_time_ms >= trackedOrder.submittedAt
  ));
  const quantity = matches.reduce((sum, trade) => sum + Math.abs(trade.quantity), 0);
  if (quantity <= 0) return null;
  const basis = matches.reduce((sum, trade) => (
    trade.price == null ? sum : sum + Math.abs(trade.quantity) * trade.price
  ), 0);
  return {
    quantity,
    averagePrice: basis > 0 ? basis / quantity : null,
  };
}

function orderIsFilled(status: string | null | undefined): boolean {
  return status?.toLowerCase() === "filled";
}

export function orderIsTerminal(status: string | null | undefined): boolean {
  const normalized = status?.toLowerCase();
  return normalized === "filled" || normalized === "cancelled" || normalized === "inactive" || normalized === "api cancelled";
}

export function deriveOrderTracker(input: OrderTrackerInput): OrderTrackerState | null {
  const { trackedOrder, liveOrders, trades, currentPrice } = input;
  if (!trackedOrder) return null;

  const liveOrder = matchingLiveOrder(liveOrders, trackedOrder);
  const enrichment = fillEnrichment(trades, trackedOrder);
  const trackedLimitPrice = trackedOrder.order.price ?? liveOrder?.limit_price ?? null;
  const distancePercent = currentPrice != null && trackedLimitPrice != null && trackedLimitPrice > 0
    ? Math.round((Math.abs(currentPrice - trackedLimitPrice) / trackedLimitPrice) * 10_000) / 100
    : null;
  const orderedQty = trackedOrder.order.quantity;
  const liveStatus = liveOrder?.status ?? null;
  const remaining = liveOrder?.remaining_quantity ?? null;
  const liveFilled = liveOrder?.quantity != null && remaining != null
    ? Math.max(0, liveOrder.quantity - remaining)
    : null;
  const filled = orderIsFilled(liveStatus) || (remaining != null && remaining <= 0 && liveOrder != null);

  if (filled) {
    return {
      orderId: trackedOrder.orderId,
      orderType: trackedOrder.order.orderType,
      status: "filled",
      quantity: orderedQty,
      filledQuantity: liveFilled ?? enrichment?.quantity ?? orderedQty,
      averagePrice: enrichment?.averagePrice ?? null,
    };
  }

  const partialFilled = liveFilled != null && liveFilled > 0;
  return {
    orderId: trackedOrder.orderId,
    orderType: trackedOrder.order.orderType,
    status: partialFilled ? "partial" : (liveOrder ? "pending" : "submitted"),
    liveStatus: liveStatus ?? "Pending",
    quantity: orderedQty,
    filledQuantity: liveFilled ?? 0,
    currentPrice,
    limitPrice: trackedLimitPrice,
    distancePercent,
    remainingQuantity: remaining ?? orderedQty,
  };
}

export function buildOrderRefreshPlan(input: {
  accountId: string;
  conid: number;
  reason: OrderRefreshReason;
}): OrderRefreshPlan {
  const accountQueryKeys: Array<readonly [string, string, string]> = [
    ["moonmarket", "portfolio", input.accountId],
    ["moonmarket", "funds", input.accountId],
    ["moonmarket", "live-orders", input.accountId],
    ["moonmarket", "trades", input.accountId],
  ];

  if (input.reason === "submitted") {
    return {
      revalidatePositions: true,
      invalidateQueryKeys: [
        accountQueryKeys[0],
        accountQueryKeys[2],
        accountQueryKeys[1],
        accountQueryKeys[3],
        ["market", "quote", input.conid],
      ],
    };
  }

  return {
    revalidatePositions: false,
    invalidateQueryKeys: accountQueryKeys,
  };
}
