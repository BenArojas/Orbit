import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  MoonMarketLiveOrder,
  MoonMarketOrderDraft,
  MoonMarketOrderSide,
  MoonMarketOrderType,
  MoonMarketTimeInForce,
  MoonMarketTrailingType,
  MoonMarketTrade,
} from "@/lib/api";
import { api } from "@/lib/api";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";
import { useAccountStore } from "./useAccountStore";
import { useCancelOrder, useModifyOrder, usePlaceOrder, usePreviewOrder, useReplyOrder } from "./useOrderMutations";
import type { OrderTicketTarget } from "./useOrderTicketStore";
import { useOrderTicketStore } from "./useOrderTicketStore";
import { OrderResult, type OrderTrackerState } from "./OrderResult";
import { ORDER_TYPE_LABELS, TIF_LABELS, TRAILING_TYPE_LABELS } from "./labels";
import { cashForBuyingPowerPct, computeRiskReward, sharesForCash } from "./orderMath";

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// A required price field is "invalid" when the user typed something that does
// not parse to a positive number. numberOrUndefined silently drops <= 0 input,
// so we detect that case here to surface inline feedback instead of swallowing it.
function priceInputInvalid(value: string): boolean {
  if (value.trim() === "") return false;
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed <= 0;
}

function resultData(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("result" in result)) return result;
  return (result as { result: unknown }).result;
}

function resultRows(result: unknown): Array<Record<string, unknown>> {
  const payload = resultData(result);
  if (Array.isArray(payload)) return payload.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  if (payload && typeof payload === "object" && "data" in payload) {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  return payload && typeof payload === "object" ? [payload as Record<string, unknown>] : [];
}

function firstReplyId(result: unknown): string | null {
  for (const row of resultRows(result)) {
    if (typeof row.id === "string" && row.id.trim()) return row.id;
    if (typeof row.id === "number") return String(row.id);
  }
  return null;
}

function firstOrderId(result: unknown): string | null {
  for (const row of resultRows(result)) {
    const id = row.order_id ?? row.orderId;
    if (typeof id === "string" && id.trim()) return id;
    if (typeof id === "number") return String(id);
  }
  return null;
}

function newClientOrderId(): string {
  return `brkt-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function formatQuoteNumber(value: number | null | undefined, digits = 2): string {
  return value == null ? "—" : value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSize(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function liveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type OrderFormProps = {
  target: OrderTicketTarget;
};

type LiveBook = {
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
};

type TrackedOrder = {
  orderId: string;
  order: MoonMarketOrderDraft;
  submittedAt: number;
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

function mapOrderType(value: string): MoonMarketOrderType | null {
  return IBKR_ORDER_TYPES[value.toLowerCase().replace(/[\s-]+/g, "_")] ?? null;
}

function orderTypesFromRules(values: unknown): MoonMarketOrderType[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<MoonMarketOrderType>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const code = mapOrderType(value);
    if (code) seen.add(code);
  }
  return ORDER_TYPE_CODES.filter((code) => seen.has(code));
}

function matchingLiveOrder(orders: MoonMarketLiveOrder[], trackedOrder: TrackedOrder | null): MoonMarketLiveOrder | null {
  if (!trackedOrder) return null;
  return orders.find((order) => order.order_id === trackedOrder.orderId) ?? null;
}

// Enriches the average fill price from executions at/after submit time only.
// This is never a fill *trigger*: the live order's status/remaining quantity is
// authoritative for fill state (see orderTracker). Trades only refine avg price.
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

function orderIsTerminal(status: string | null | undefined): boolean {
  const normalized = status?.toLowerCase();
  return normalized === "filled" || normalized === "cancelled" || normalized === "inactive" || normalized === "api cancelled";
}

function orderIsFilled(status: string | null | undefined): boolean {
  return status?.toLowerCase() === "filled";
}

export function OrderForm({ target }: OrderFormProps) {
  const queryClient = useQueryClient();
  const closeTicket = useOrderTicketStore((state) => state.close);
  const selectedAccountId = useAccountStore((state) => state.selectedAccountId);
  const selectedAccount = useAccountStore((state) => state.selectedAccount());
  const assetClass = target.assetClass ?? "STK";
  const optionTarget = assetClass === "OPT";
  const [side, setSide] = useState<MoonMarketOrderSide>(target.side ?? "BUY");
  const [quantity, setQuantity] = useState("1");
  const [orderType, setOrderType] = useState<MoonMarketOrderType>("LMT");
  const [tif, setTif] = useState<MoonMarketTimeInForce>("DAY");
  const [price, setPrice] = useState("");
  const [auxPrice, setAuxPrice] = useState("");
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(false);
  const [stopLossEnabled, setStopLossEnabled] = useState(false);
  const [profitTakerPrice, setProfitTakerPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [trailingType, setTrailingType] = useState<MoonMarketTrailingType>("%");
  const [trailingAmt, setTrailingAmt] = useState("");
  const [outsideRth, setOutsideRth] = useState(false);
  const [sizeMode, setSizeMode] = useState<"shares" | "cash" | "bp">("shares");
  const [cashAmount, setCashAmount] = useState("");
  const [bpPercent, setBpPercent] = useState("");
  const [liveBook, setLiveBook] = useState<LiveBook>({
    bid: null,
    ask: null,
    bidSize: null,
    askSize: null,
  });
  const [previewResult, setPreviewResult] = useState<unknown>(null);
  const [actionResult, setActionResult] = useState<unknown>(null);
  const [replyId, setReplyId] = useState<string | null>(null);
  const [trackedOrder, setTrackedOrder] = useState<TrackedOrder | null>(null);
  const [sideTouched, setSideTouched] = useState(false);
  const filledToastRef = useRef<string | null>(null);
  const hasInteractedRef = useRef(false);

  const previewMutation = usePreviewOrder();
  const placeMutation = usePlaceOrder();
  const modifyMutation = useModifyOrder();
  const replyMutation = useReplyOrder();
  const cancelMutation = useCancelOrder();
  const { subscribe, unsubscribe, addHandler } = useWebSocket();
  const liveBlocked = selectedAccount ? !selectedAccount.is_paper : true;
  const quoteQuery = useQuery({
    queryKey: ["market", "quote", target.conid],
    queryFn: ({ signal }) => api.quote(target.conid, signal),
    staleTime: 10_000,
  });
  const quote = quoteQuery.data;
  const book = {
    bid: liveBook.bid ?? quote?.bid,
    ask: liveBook.ask ?? quote?.ask,
    bidSize: liveBook.bidSize ?? quote?.bidSize,
    askSize: liveBook.askSize ?? quote?.askSize,
  };

  const fundsQuery = useQuery({
    queryKey: ["moonmarket", "funds", selectedAccountId],
    queryFn: ({ signal }) => api.moonmarketAccountFunds(selectedAccountId as string, signal),
    enabled: !!selectedAccountId,
    staleTime: 30_000,
  });
  const buyingPower = fundsQuery.data?.buying_power ?? null;
  const portfolioQuery = useQuery({
    queryKey: ["moonmarket", "portfolio", selectedAccountId],
    queryFn: ({ signal }) => api.moonmarketPortfolio(selectedAccountId as string, signal),
    enabled: !!selectedAccountId && !target.side && assetClass === "STK",
    staleTime: 15_000,
  });

  const orderRulesQuery = useQuery({
    queryKey: ["moonmarket", "order-rules", selectedAccountId, target.conid, side],
    queryFn: ({ signal }) => api.moonmarketOrderRules(selectedAccountId as string, target.conid, side, signal),
    enabled: !!selectedAccountId,
    staleTime: 5 * 60_000,
  });
  const availableOrderTypes = useMemo(() => {
    const fromRules = orderTypesFromRules(orderRulesQuery.data?.rules.orderTypes);
    return fromRules.length ? fromRules : ORDER_TYPE_CODES;
  }, [orderRulesQuery.data?.rules.orderTypes]);
  const outsideRthOrderTypes = useMemo(() => {
    const rawRules = orderRulesQuery.data?.rules.orderTypesOutside;
    return new Set(Array.isArray(rawRules) ? orderTypesFromRules(rawRules) : [...FALLBACK_OUTSIDE_RTH_ORDER_TYPES]);
  }, [orderRulesQuery.data?.rules.orderTypesOutside]);
  const tradesQuery = useQuery({
    queryKey: ["moonmarket", "trades", selectedAccountId, 7],
    queryFn: ({ signal }) => api.moonmarketTrades(selectedAccountId as string, 7, signal),
    enabled: !!selectedAccountId && !!trackedOrder,
    refetchInterval: (query) => {
      if (!trackedOrder) return false;
      return fillEnrichment(query.state.data?.trades ?? [], trackedOrder) ? false : 3_000;
    },
  });
  const liveOrdersQuery = useQuery({
    queryKey: ["moonmarket", "live-orders", selectedAccountId],
    queryFn: ({ signal }) => api.moonmarketLiveOrders(selectedAccountId as string, signal),
    enabled: !!selectedAccountId && !!trackedOrder,
    refetchInterval: (query) => {
      const liveOrder = matchingLiveOrder(query.state.data?.orders ?? [], trackedOrder);
      return liveOrder && !orderIsTerminal(liveOrder.status) ? 3_000 : false;
    },
  });

  useEffect(() => {
    setSide(target.side ?? "BUY");
    setQuantity(target.draft?.quantity ? String(target.draft.quantity) : "1");
    setOrderType(target.draft?.orderType ?? "LMT");
    setTif(target.draft?.tif ?? "DAY");
    setPrice(target.draft?.price ? String(target.draft.price) : "");
    setAuxPrice(target.draft?.auxPrice ? String(target.draft.auxPrice) : "");
    setTakeProfitEnabled(false);
    setStopLossEnabled(false);
    setProfitTakerPrice("");
    setStopLossPrice("");
    setTrailingType(target.draft?.trailingType ?? "%");
    setTrailingAmt(target.draft?.trailingAmt ? String(target.draft.trailingAmt) : "");
    setOutsideRth(Boolean(target.draft?.outsideRTH));
    setSizeMode("shares");
    setCashAmount("");
    setBpPercent("");
    setLiveBook({ bid: null, ask: null, bidSize: null, askSize: null });
    setPreviewResult(null);
    setActionResult(null);
    setReplyId(null);
    setTrackedOrder(null);
    setSideTouched(false);
    filledToastRef.current = null;
    hasInteractedRef.current = false;
  }, [target]);

  useEffect(() => {
    if (target.side || sideTouched || hasInteractedRef.current || assetClass !== "STK") return;
    const heldPosition = portfolioQuery.data?.positions.find((position) => (
      position.conid === target.conid && position.quantity !== 0
    ));
    if (heldPosition) {
      setSide("SELL");
    }
  }, [assetClass, portfolioQuery.data?.positions, sideTouched, target.conid, target.side]);

  useEffect(() => {
    if (!availableOrderTypes.includes(orderType)) {
      setOrderType(availableOrderTypes[0] ?? "LMT");
    }
  }, [availableOrderTypes, orderType]);

  useEffect(() => {
    if (outsideRth && !outsideRthOrderTypes.has(orderType)) {
      setOutsideRth(false);
    }
  }, [orderType, outsideRth, outsideRthOrderTypes]);

  useEffect(() => {
    subscribe(target.conid);
    return () => unsubscribe(target.conid);
  }, [subscribe, target.conid, unsubscribe]);

  useEffect(() => {
    const remove = addHandler((msg: WsMessage) => {
      if (msg.type !== "market_data" || msg.conid !== target.conid) return;
      setLiveBook((prev) => ({
        bid: liveNumber(msg.bid) ?? prev.bid,
        ask: liveNumber(msg.ask) ?? prev.ask,
        bidSize: liveNumber(msg.bidSize) ?? prev.bidSize,
        askSize: liveNumber(msg.askSize) ?? prev.askSize,
      }));
    });
    return remove;
  }, [addHandler, target.conid]);

  const isTrailing = orderType === "TRAIL" || orderType === "TRAILLMT";
  const tifOptions = (Object.keys(TIF_LABELS) as Array<keyof typeof TIF_LABELS>)
    .filter((code) => !isTrailing || code !== "IOC");
  const needsLimitPrice = orderType === "LMT" || orderType === "STP_LIMIT";
  const needsStopPrice = orderType === "STP" || orderType === "STP_LIMIT";
  const needsStopAuxPrice = orderType === "STP" || orderType === "STP_LIMIT";
  const canUseOutsideRth = outsideRthOrderTypes.has(orderType);
  const limitPriceInvalid = needsLimitPrice && priceInputInvalid(price);
  const stopPriceInvalid = needsStopPrice && priceInputInvalid(auxPrice);

  useEffect(() => {
    if (isTrailing && tif === "IOC") {
      setTif("DAY");
    }
  }, [isTrailing, tif]);

  // Derived computation order: entryReference → effectiveCash/cashShares/effectiveQuantity → baseOrder
  const entryReference = numberOrUndefined(price) ?? book.ask ?? quote?.lastPrice ?? undefined;
  const effectiveCash =
    sizeMode === "cash"
      ? numberOrUndefined(cashAmount)
      : sizeMode === "bp"
        ? cashForBuyingPowerPct(numberOrUndefined(bpPercent), buyingPower) ?? undefined
        : undefined;
  const cashShares = sharesForCash(effectiveCash, entryReference);
  const effectiveQuantity = sizeMode === "shares" ? Number(quantity) || 0 : cashShares ?? 0;

  const riskReward = computeRiskReward({
    side,
    entry: entryReference,
    takeProfit: takeProfitEnabled ? numberOrUndefined(profitTakerPrice) : undefined,
    stopLoss: stopLossEnabled ? numberOrUndefined(stopLossPrice) : undefined,
  });

  const baseOrder = useMemo<MoonMarketOrderDraft>(() => ({
    conid: target.conid,
    assetClass,
    side,
    quantity: effectiveQuantity,
    orderType,
    tif,
    price: needsLimitPrice || orderType === "TRAILLMT" ? numberOrUndefined(price) : undefined,
    auxPrice: needsStopAuxPrice ? numberOrUndefined(auxPrice) : undefined,
    trailingType: isTrailing ? trailingType : undefined,
    trailingAmt: isTrailing ? numberOrUndefined(trailingAmt) : undefined,
    outsideRTH: outsideRth && canUseOutsideRth ? true : undefined,
  }), [assetClass, auxPrice, canUseOutsideRth, effectiveQuantity, isTrailing, needsLimitPrice, needsStopAuxPrice, orderType, outsideRth, price, side, target.conid, tif, trailingAmt, trailingType]);
  const liveOrder = matchingLiveOrder(liveOrdersQuery.data?.orders ?? [], trackedOrder);
  const enrichment = fillEnrichment(tradesQuery.data?.trades ?? [], trackedOrder);
  const currentPrice = quote?.lastPrice ?? book.ask ?? book.bid ?? null;
  const trackedLimitPrice = trackedOrder?.order.price ?? liveOrder?.limit_price ?? null;
  const distancePercent = currentPrice != null && trackedLimitPrice != null && trackedLimitPrice > 0
    ? Math.round((Math.abs(currentPrice - trackedLimitPrice) / trackedLimitPrice) * 10_000) / 100
    : null;
  const orderTracker = useMemo<OrderTrackerState | null>(() => {
    if (!trackedOrder) return null;
    const orderedQty = trackedOrder.order.quantity;
    const liveStatus = liveOrder?.status ?? null;
    const remaining = liveOrder?.remaining_quantity ?? null;
    const liveFilled = liveOrder?.quantity != null && remaining != null
      ? Math.max(0, liveOrder.quantity - remaining)
      : null;
    const isFilled = orderIsFilled(liveStatus) || (remaining != null && remaining <= 0 && liveOrder != null);
    if (isFilled) {
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
  }, [currentPrice, distancePercent, enrichment, liveOrder, trackedLimitPrice, trackedOrder]);

  useEffect(() => {
    if (!orderTracker || orderTracker.status !== "filled" || filledToastRef.current === orderTracker.orderId) return;
    filledToastRef.current = orderTracker.orderId;
    toast.success(`Order filled: ${orderTracker.filledQuantity ?? 0} shares at $${orderTracker.averagePrice?.toFixed(2) ?? "--"}`);
    if (selectedAccountId) {
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "portfolio", selectedAccountId] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "funds", selectedAccountId] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", selectedAccountId] });
      void queryClient.invalidateQueries({ queryKey: ["moonmarket", "trades", selectedAccountId] });
    }
  }, [orderTracker, queryClient, selectedAccountId]);
  const canUpdateTrackedOrder = Boolean(
    trackedOrder?.orderId
    && trackedOrder.order.orderType !== "MKT"
    && orderTracker?.status !== "filled",
  );

  const refreshAccountAfterSubmitted = (result: unknown) => {
    if (!selectedAccountId || !firstOrderId(result)) return;
    void api.moonmarketRevalidatePositions(selectedAccountId)
      .catch(() => undefined)
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["moonmarket", "portfolio", selectedAccountId] });
        void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", selectedAccountId] });
        void queryClient.invalidateQueries({ queryKey: ["moonmarket", "funds", selectedAccountId] });
        void queryClient.invalidateQueries({ queryKey: ["moonmarket", "trades", selectedAccountId] });
        void queryClient.invalidateQueries({ queryKey: ["market", "quote", target.conid] });
      });
  };

  const buildOrders = (): MoonMarketOrderDraft[] => {
    if (optionTarget || (!takeProfitEnabled && !stopLossEnabled)) return [baseOrder];
    const profitPrice = numberOrUndefined(profitTakerPrice);
    const stopPrice = numberOrUndefined(stopLossPrice);
    if (takeProfitEnabled && !profitPrice) {
      toast.error("Profit taker price is required.");
      return [];
    }
    if (stopLossEnabled && !stopPrice) {
      toast.error("Stop loss price is required.");
      return [];
    }
    const parentId = newClientOrderId();
    const oppositeSide: MoonMarketOrderSide = side === "BUY" ? "SELL" : "BUY";
    const orders: MoonMarketOrderDraft[] = [{ ...baseOrder, cOID: parentId }];
    if (takeProfitEnabled && profitPrice) {
      orders.push({
        conid: target.conid,
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
    if (stopLossEnabled && stopPrice) {
      orders.push({
        conid: target.conid,
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
    return orders;
  };

  const handlePreview = () => {
    if (!selectedAccountId) return;
    previewMutation.mutate(
      { account_id: selectedAccountId, order: baseOrder },
      { onSuccess: (result) => setPreviewResult(result), onError: () => toast.error("Order preview failed.") },
    );
  };

  const handlePlace = () => {
    if (!selectedAccountId || liveBlocked) return;
    if (effectiveQuantity <= 0) {
      toast.error("Quantity must be greater than zero.");
      return;
    }
    if (isTrailing && !numberOrUndefined(trailingAmt)) {
      toast.error("Trail distance is required.");
      return;
    }
    if (orderType === "TRAILLMT" && !numberOrUndefined(price)) {
      toast.error("Limit offset is required.");
      return;
    }
    if (orderType === "STP" && !numberOrUndefined(auxPrice)) {
      toast.error("Stop price is required.");
      return;
    }
    if (orderType === "STP_LIMIT" && (!numberOrUndefined(price) || !numberOrUndefined(auxPrice))) {
      toast.error("Stop-limit orders require both a stop price and a limit price.");
      return;
    }
    if (limitPriceInvalid) {
      toast.error("Limit price must be greater than zero.");
      return;
    }
    if (stopPriceInvalid) {
      toast.error("Stop price must be greater than zero.");
      return;
    }
    const orders = buildOrders();
    if (!orders.length) return;
    const modifyOrderId = target.mode === "modify" && target.orderId
      ? target.orderId
      : canUpdateTrackedOrder && trackedOrder?.orderId
        ? trackedOrder.orderId
        : null;
    if (modifyOrderId) {
      modifyMutation.mutate(
        { accountId: selectedAccountId, orderId: modifyOrderId, order: orders[0] },
        {
          onSuccess: (result) => {
            setActionResult(result);
            setTrackedOrder({ orderId: modifyOrderId, order: orders[0], submittedAt: Date.now() });
            refreshAccountAfterSubmitted(result);
          },
          onError: () => toast.error("Order modification failed."),
        },
      );
      return;
    }
    placeMutation.mutate(
      { account_id: selectedAccountId, orders },
      {
        onSuccess: (result) => {
          setActionResult(result);
          const orderId = firstOrderId(result);
          if (orderId) {
            setReplyId(null);
            setTrackedOrder({ orderId, order: orders[0], submittedAt: Date.now() });
          } else {
            setReplyId(firstReplyId(result));
          }
          refreshAccountAfterSubmitted(result);
        },
        onError: () => toast.error("Order placement failed."),
      },
    );
  };

  const handleConfirm = (confirmed: boolean) => {
    if (liveBlocked) return;
    if (!selectedAccountId || !replyId) return;
    if (!confirmed) {
      setReplyId(null);
      return;
    }
    replyMutation.mutate(
      { accountId: selectedAccountId, replyId, confirmed },
      {
        onSuccess: (result) => {
          setActionResult(result);
          setReplyId(firstReplyId(result));
          const orderId = firstOrderId(result);
          if (orderId) {
            setTrackedOrder({ orderId, order: baseOrder, submittedAt: Date.now() });
          }
          refreshAccountAfterSubmitted(result);
        },
        onError: () => toast.error("Order confirmation failed."),
      },
    );
  };

  const handleCancelTrackedOrder = () => {
    if (!selectedAccountId || liveBlocked || !trackedOrder?.orderId) return;
    cancelMutation.mutate(
      { accountId: selectedAccountId, orderId: trackedOrder.orderId },
      {
        onSuccess: () => {
          toast.success("Order cancelled.");
          setTrackedOrder(null);
          setActionResult(null);
          setReplyId(null);
          void queryClient.invalidateQueries({ queryKey: ["moonmarket", "portfolio", selectedAccountId] });
          void queryClient.invalidateQueries({ queryKey: ["moonmarket", "funds", selectedAccountId] });
          void queryClient.invalidateQueries({ queryKey: ["moonmarket", "live-orders", selectedAccountId] });
          void queryClient.invalidateQueries({ queryKey: ["moonmarket", "trades", selectedAccountId] });
        },
        onError: () => toast.error("Order cancellation failed."),
      },
    );
  };

  const canCancelTrackedOrder = Boolean(trackedOrder?.orderId) && orderTracker?.status !== "filled";

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => event.preventDefault()}>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-md border border-border bg-[var(--bg-1)] p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--text-3)]">
            <span>Bid / Ask Book</span>
            <span>{liveBook.bid != null || liveBook.ask != null ? "Live" : quoteQuery.isFetching ? "Updating" : "Top of book"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
            <div className="rounded border border-border bg-[var(--bg-2)] p-2">
              <div className="text-[var(--text-3)]">Bid</div>
              <div className="mt-1 text-[14px] font-semibold text-[var(--clr-green)]">
                {formatQuoteNumber(book.bid)}
              </div>
              <div className="mt-1 text-[var(--text-3)]" aria-label={`Bid size ${formatSize(book.bidSize)}`}>
                Size <span>{formatSize(book.bidSize)}</span>
              </div>
            </div>
            <div className="rounded border border-border bg-[var(--bg-2)] p-2 text-right">
              <div className="text-[var(--text-3)]">Ask</div>
              <div className="mt-1 text-[14px] font-semibold text-[var(--clr-red)]">
                {formatQuoteNumber(book.ask)}
              </div>
              <div className="mt-1 text-[var(--text-3)]" aria-label={`Ask size ${formatSize(book.askSize)}`}>
                Size <span>{formatSize(book.askSize)}</span>
              </div>
            </div>
          </div>
        </section>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={side === "BUY"}
            onClick={() => {
              setSideTouched(true);
              setSide("BUY");
            }}
            className={cn(
              "rounded-md border px-3 py-2 text-[12px] font-semibold transition-colors",
              side === "BUY"
                ? "border-[var(--clr-green)] bg-[var(--clr-green)]/14 text-[var(--clr-green)] shadow-[0_0_14px_var(--glow-green)]"
                : "border-border text-[var(--text-2)] hover:border-[var(--clr-green)]/50 hover:text-[var(--clr-green)]",
            )}
          >
            BUY
          </button>
          <button
            type="button"
            aria-pressed={side === "SELL"}
            onClick={() => {
              setSideTouched(true);
              setSide("SELL");
            }}
            className={cn(
              "rounded-md border px-3 py-2 text-[12px] font-semibold transition-colors",
              side === "SELL"
                ? "border-[var(--clr-red)] bg-[var(--clr-red)]/14 text-[var(--clr-red)] shadow-[0_0_14px_var(--glow-red)]"
                : "border-border text-[var(--text-2)] hover:border-[var(--clr-red)]/50 hover:text-[var(--clr-red)]",
            )}
          >
            SELL
          </button>
        </div>
        <label className="block text-[11px] font-medium text-[var(--text-2)]">
          Size By
          <select aria-label="Size by" value={sizeMode} onChange={(event) => setSizeMode(event.target.value as "shares" | "cash" | "bp")} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]">
            <option value="shares">Shares</option>
            <option value="cash">Cash ($)</option>
            <option value="bp">% of Buying Power</option>
          </select>
        </label>
        {sizeMode === "shares" ? (
          <label className="block text-[11px] font-medium text-[var(--text-2)]">
            Quantity
            <input aria-label="Quantity" value={quantity} onChange={(event) => { hasInteractedRef.current = true; setQuantity(event.target.value); }} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]" />
          </label>
        ) : sizeMode === "cash" ? (
          <label className="block text-[11px] font-medium text-[var(--text-2)]">
            Cash Amount
            <input aria-label="Cash amount" value={cashAmount} onChange={(event) => { hasInteractedRef.current = true; setCashAmount(event.target.value); }} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]" />
            <span className="mt-1 block text-[var(--text-3)]">{cashShares != null ? `≈ ${cashShares} shares` : "≈ — shares"}</span>
          </label>
        ) : (
          <label className="block text-[11px] font-medium text-[var(--text-2)]">
            Percent of Buying Power
            <input aria-label="Percent of buying power" value={bpPercent} onChange={(event) => { hasInteractedRef.current = true; setBpPercent(event.target.value); }} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]" />
            <span className="mt-1 block text-[var(--text-3)]">
              Buying power {buyingPower != null ? `$${formatQuoteNumber(buyingPower)}` : "—"}
              {" · "}
              {cashShares != null ? `≈ ${cashShares} shares` : "≈ — shares"}
            </span>
          </label>
        )}
        <label className="block text-[11px] font-medium text-[var(--text-2)]">
          Order Type
          <select aria-label="Order Type" value={orderType} onChange={(event) => setOrderType(event.target.value as MoonMarketOrderType)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]">
            {availableOrderTypes.map((code) => (
              <option key={code} value={code}>{ORDER_TYPE_LABELS[code]}</option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] font-normal text-[var(--text-3)]">
            {orderRulesQuery.isError ? "Using fallback order rules." : "Filtered by IBKR contract rules."}
          </span>
        </label>
        <label className="block text-[11px] font-medium text-[var(--text-2)]">
          Time in force
          <select aria-label="Time in force" value={tif} onChange={(event) => setTif(event.target.value as MoonMarketTimeInForce)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]">
            {tifOptions.map((code) => (
              <option key={code} value={code}>{TIF_LABELS[code]}</option>
            ))}
          </select>
        </label>
        {needsStopPrice ? (
          <label className="block text-[11px] font-medium text-[var(--text-2)]">
            Stop Price
            <input aria-label="Stop Price" value={auxPrice} onChange={(event) => setAuxPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]" />
            {stopPriceInvalid ? (
              <span className="mt-1 block text-[10px] font-normal text-[var(--clr-red)]">Stop price must be greater than zero.</span>
            ) : null}
          </label>
        ) : null}
        {needsLimitPrice ? (
          <label className="block text-[11px] font-medium text-[var(--text-2)]">
            Limit Price
            <input aria-label="Limit Price" value={price} onChange={(event) => { hasInteractedRef.current = true; setPrice(event.target.value); }} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]" />
            {limitPriceInvalid ? (
              <span className="mt-1 block text-[10px] font-normal text-[var(--clr-red)]">Limit price must be greater than zero.</span>
            ) : null}
          </label>
        ) : null}
        {canUseOutsideRth ? (
          <label className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-2)]">
            <input aria-label="Outside regular trading hours" type="checkbox" checked={outsideRth} onChange={(event) => setOutsideRth(event.target.checked)} />
            Allow execution outside regular trading hours
          </label>
        ) : null}
        {isTrailing ? (
          <div className="grid gap-3 rounded-md border border-border bg-[var(--bg-1)] p-3">
            <label className="block text-[11px] text-[var(--text-3)]">
              Trail By
              <select aria-label="Trail by" value={trailingType} onChange={(event) => setTrailingType(event.target.value as MoonMarketTrailingType)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]">
                {(Object.keys(TRAILING_TYPE_LABELS) as Array<keyof typeof TRAILING_TYPE_LABELS>).map((code) => (
                  <option key={code} value={code}>{TRAILING_TYPE_LABELS[code]}</option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] text-[var(--text-3)]">
              Trail Distance
              <input aria-label="Trail distance" value={trailingAmt} onChange={(event) => setTrailingAmt(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
            </label>
            {orderType === "TRAILLMT" ? (
              <label className="block text-[11px] text-[var(--text-3)]">
                Limit Offset
                <input aria-label="Limit offset" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
              </label>
            ) : null}
          </div>
        ) : null}
        {optionTarget ? (
          <div className="rounded-md border border-border bg-[var(--bg-1)] px-3 py-2 text-[11px] text-[var(--text-3)]">
            Option bracket orders are deferred until after single-leg paper validation.
          </div>
        ) : (
          <div className="grid gap-2 rounded-md border border-border bg-[var(--bg-1)] p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">Protective Orders</div>
            <label className="flex items-center gap-2 text-[12px]">
              <input aria-label="Take Profit" type="checkbox" checked={takeProfitEnabled} onChange={(event) => setTakeProfitEnabled(event.target.checked)} />
              Take profit
            </label>
            <label className="flex items-center gap-2 text-[12px]">
              <input aria-label="Stop Loss" type="checkbox" checked={stopLossEnabled} onChange={(event) => setStopLossEnabled(event.target.checked)} />
              Stop loss
            </label>
          </div>
        )}
        {takeProfitEnabled || stopLossEnabled ? (
          <div className="grid gap-3">
            {takeProfitEnabled ? (
              <label className="block text-[11px] text-[var(--text-3)]">
                Profit Taker Price
                <input aria-label="Profit Taker Price" value={profitTakerPrice} onChange={(event) => setProfitTakerPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
              </label>
            ) : null}
            {stopLossEnabled ? (
              <label className="block text-[11px] text-[var(--text-3)]">
                Stop Loss Price
                <input aria-label="Stop Loss Price" value={stopLossPrice} onChange={(event) => setStopLossPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
              </label>
            ) : null}
          </div>
        ) : null}
        {riskReward ? (
          <div className="rounded-md border border-border bg-[var(--bg-1)] p-3 text-[11px]">
            <div className="font-semibold text-[var(--text-1)]">
              Risk / Reward&nbsp;&nbsp;1 : {riskReward.ratio.toFixed(1)}
            </div>
            <p className="mt-1 text-[var(--text-3)]">
              For every $1 you risk down to your stop, you stand to make about ${riskReward.ratio.toFixed(2)} at your target. A ratio of 1:3 or higher is generally considered favorable.
            </p>
          </div>
        ) : null}
      </div>
      {liveBlocked ? <div className="border-t border-border px-4 py-2 text-[11px] text-[var(--clr-red)]">Live account order mutations are blocked in Orbit v1.</div> : null}
      <div className="flex gap-2 border-t border-border p-4">
        {orderTracker?.status === "filled" ? (
          <button type="button" onClick={closeTicket} className="rounded-md border border-[var(--clr-green)] px-3 py-2 text-[12px] text-[var(--clr-green)]">
            Close
          </button>
        ) : (
          <>
            <button type="button" onClick={handlePreview} disabled={!selectedAccountId || previewMutation.isPending} className="rounded-md border border-border px-3 py-2 text-[12px] disabled:opacity-50">Preview</button>
            <button type="button" onClick={handlePlace} disabled={!selectedAccountId || liveBlocked || placeMutation.isPending || modifyMutation.isPending} className="rounded-md border border-[var(--clr-cyan)] px-3 py-2 text-[12px] text-[var(--clr-cyan)] disabled:opacity-50">
              {target.mode === "modify" ? "Modify" : canUpdateTrackedOrder ? "Update Order" : "Place"}
            </button>
            {canCancelTrackedOrder ? (
              <button type="button" onClick={handleCancelTrackedOrder} disabled={!selectedAccountId || liveBlocked || cancelMutation.isPending} className="rounded-md border border-[var(--clr-red)] px-3 py-2 text-[12px] text-[var(--clr-red)] disabled:opacity-50">
                {cancelMutation.isPending ? "Cancelling..." : "Cancel Order"}
              </button>
            ) : null}
          </>
        )}
      </div>
      <OrderResult previewResult={previewResult} actionResult={actionResult} replyId={replyId} orderTracker={orderTracker} onConfirm={handleConfirm} confirming={replyMutation.isPending} liveBlocked={liveBlocked} />
    </form>
  );
}
