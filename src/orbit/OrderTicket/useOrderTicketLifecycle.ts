import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  MoonMarketOrderDraft,
  MoonMarketOrderSide,
  MoonMarketOrderType,
  MoonMarketTimeInForce,
  MoonMarketTrailingType,
  TradingSafetyAction,
} from "@/modules/moonmarket/api";
import { moonmarketApi } from "@/modules/moonmarket/api";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { useOrbitAccountContext } from "@/orbit/accountContext";
import type { OrderTicketTarget } from "./useOrderTicketStore";
import {
  availableOrderTypesFromRules,
  buildOrderRefreshPlan,
  buildOrderDraft,
  buildOrderSubmission,
  classifyOrderResult,
  deriveOrderTracker,
  numberOrUndefined,
  orderIsTerminal,
  outsideRthOrderTypesFromRules,
  priceInputInvalid,
  type TrackedOrder,
} from "./orderLifecycle";
import { useCancelOrder, useModifyOrder, usePlaceOrder, usePreviewOrder, useReplyOrder } from "./useOrderMutations";
import { cashForBuyingPowerPct, computeRiskReward, sharesForCash } from "./orderMath";
import { parallaxApi } from "@/modules/parallax/api";

/**
 * Outcome of evaluating the backend Trading Safety policy for a live action.
 * Confirmation copy is owned by the backend decision; the UI never invents it.
 */
type LiveGateResult =
  | { status: "confirm"; message: string; confirmLabel: string }
  | { status: "proceed" }
  | { status: "blocked"; reason: string };

async function evaluateLiveGate(
  accountId: string,
  action: TradingSafetyAction,
): Promise<LiveGateResult> {
  let decision: Awaited<ReturnType<typeof moonmarketApi.moonmarketTradingSafetyOrderAction>>;
  try {
    decision = await moonmarketApi.moonmarketTradingSafetyOrderAction(accountId, action);
  } catch {
    return {
      status: "blocked",
      reason: "Could not reach the trading safety service. Live order actions are blocked until it responds.",
    };
  }
  if (!decision.allowed) {
    return {
      status: "blocked",
      reason: decision.confirmation.message ?? "Trading safety rejected this order action.",
    };
  }
  if (!decision.confirmation.required) {
    return { status: "proceed" };
  }
  if (!decision.confirmation.message || !decision.confirmation.confirm_label) {
    return {
      status: "blocked",
      reason: "Trading safety returned an incomplete confirmation. Live order action blocked.",
    };
  }
  return {
    status: "confirm",
    message: decision.confirmation.message,
    confirmLabel: decision.confirmation.confirm_label,
  };
}

function newClientOrderId(): string {
  return `brkt-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function liveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type LiveBook = {
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
};

export function useOrderTicketLifecycle(target: OrderTicketTarget) {
  const queryClient = useQueryClient();
  const {
    selectedAccountId,
    selectedAccount,
    isLiveAccount,
    isReady: isAccountReady,
    readyState: accountReadyState,
    error: accountError,
  } = useOrbitAccountContext();
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
  const [pendingLiveAction, setPendingLiveAction] = useState<
    { run: () => void; message: string; confirmLabel: string } | null
  >(null);

  const quoteQuery = useQuery({
    queryKey: ["market", "quote", target.conid],
    queryFn: ({ signal }) => parallaxApi.quote(target.conid, signal),
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
    queryFn: ({ signal }) => moonmarketApi.moonmarketAccountFunds(selectedAccountId as string, signal),
    enabled: !!selectedAccountId,
    staleTime: 30_000,
  });
  const buyingPower = fundsQuery.data?.buying_power ?? null;
  const portfolioQuery = useQuery({
    queryKey: ["moonmarket", "portfolio", selectedAccountId],
    queryFn: ({ signal }) => moonmarketApi.moonmarketPortfolio(selectedAccountId as string, signal),
    enabled: !!selectedAccountId && !target.side && assetClass === "STK",
    staleTime: 15_000,
  });

  const orderRulesQuery = useQuery({
    queryKey: ["moonmarket", "order-rules", selectedAccountId, target.conid, side],
    queryFn: ({ signal }) => moonmarketApi.moonmarketOrderRules(selectedAccountId as string, target.conid, side, signal),
    enabled: !!selectedAccountId,
    staleTime: 5 * 60_000,
  });
  const availableOrderTypes = useMemo(() => (
    availableOrderTypesFromRules(orderRulesQuery.data?.rules.orderTypes)
  ), [orderRulesQuery.data?.rules.orderTypes]);
  const outsideRthOrderTypes = useMemo(() => (
    outsideRthOrderTypesFromRules(orderRulesQuery.data?.rules.orderTypesOutside)
  ), [orderRulesQuery.data?.rules.orderTypesOutside]);

  const tradesQuery = useQuery({
    queryKey: ["moonmarket", "trades", selectedAccountId, 7],
    queryFn: ({ signal }) => moonmarketApi.moonmarketTrades(selectedAccountId as string, 7, signal),
    enabled: !!selectedAccountId && !!trackedOrder,
    refetchInterval: (query) => {
      if (!trackedOrder || !selectedAccountId) return false;
      const cachedLiveOrders = (
        queryClient.getQueryData(["moonmarket", "live-orders", selectedAccountId]) as
          | { orders?: import("@/modules/moonmarket/api").MoonMarketLiveOrder[] }
          | undefined
      )?.orders ?? [];
      return deriveOrderTracker({
        trackedOrder,
        liveOrders: cachedLiveOrders,
        trades: query.state.data?.trades ?? [],
        currentPrice: quote?.lastPrice ?? book.ask ?? book.bid ?? null,
      })?.status === "filled" ? false : 3_000;
    },
  });

  const liveOrdersQuery = useQuery({
    queryKey: ["moonmarket", "live-orders", selectedAccountId],
    queryFn: ({ signal }) => moonmarketApi.moonmarketLiveOrders(selectedAccountId as string, signal),
    enabled: !!selectedAccountId && !!trackedOrder,
    refetchInterval: (query) => {
      const liveOrder = trackedOrder
        ? (query.state.data?.orders ?? []).find((order) => order.order_id === trackedOrder.orderId) ?? null
        : null;
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
    setPendingLiveAction(null);
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
  const needsLimitPrice = orderType === "LMT" || orderType === "STP_LIMIT";
  const needsStopPrice = orderType === "STP" || orderType === "STP_LIMIT";
  const canUseOutsideRth = outsideRthOrderTypes.has(orderType);
  const limitPriceInvalid = needsLimitPrice && priceInputInvalid(price);
  const stopPriceInvalid = needsStopPrice && priceInputInvalid(auxPrice);

  useEffect(() => {
    if (isTrailing && tif === "IOC") {
      setTif("DAY");
    }
  }, [isTrailing, tif]);

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

  const lifecycleInput = useMemo(() => ({
    conid: target.conid,
    assetClass,
    side,
    quantity: effectiveQuantity,
    orderType,
    tif,
    price,
    auxPrice,
    trailingType,
    trailingAmt,
    outsideRth,
    canUseOutsideRth,
    takeProfitEnabled,
    stopLossEnabled,
    profitTakerPrice,
    stopLossPrice,
    newClientOrderId,
  }), [assetClass, auxPrice, canUseOutsideRth, effectiveQuantity, orderType, outsideRth, price, profitTakerPrice, side, stopLossEnabled, stopLossPrice, takeProfitEnabled, target.conid, tif, trailingAmt, trailingType]);

  const baseOrder = useMemo<MoonMarketOrderDraft>(() => buildOrderDraft(lifecycleInput), [lifecycleInput]);
  const currentPrice = quote?.lastPrice ?? book.ask ?? book.bid ?? null;
  const orderTracker = useMemo(() => deriveOrderTracker({
    trackedOrder,
    liveOrders: liveOrdersQuery.data?.orders ?? [],
    trades: tradesQuery.data?.trades ?? [],
    currentPrice,
  }), [currentPrice, liveOrdersQuery.data?.orders, trackedOrder, tradesQuery.data?.trades]);

  function runRefreshPlan(reason: "submitted" | "filled" | "cancelled") {
    if (!selectedAccountId) return;
    const plan = buildOrderRefreshPlan({
      accountId: selectedAccountId,
      conid: target.conid,
      reason,
    });
    const invalidate = () => {
      for (const queryKey of plan.invalidateQueryKeys) {
        void queryClient.invalidateQueries({ queryKey: [...queryKey] });
      }
    };
    if (!plan.revalidatePositions) {
      invalidate();
      return;
    }
    void moonmarketApi.moonmarketRevalidatePositions(selectedAccountId)
      .catch(() => undefined)
      .finally(invalidate);
  }

  useEffect(() => {
    if (!orderTracker || orderTracker.status !== "filled" || filledToastRef.current === orderTracker.orderId) return;
    filledToastRef.current = orderTracker.orderId;
    toast.success(`Order filled: ${orderTracker.filledQuantity ?? 0} shares at $${orderTracker.averagePrice?.toFixed(2) ?? "--"}`);
    runRefreshPlan("filled");
  }, [orderTracker]);

  const canUpdateTrackedOrder = Boolean(
    trackedOrder?.orderId
    && trackedOrder.order.orderType !== "MKT"
    && orderTracker?.status !== "filled",
  );

  const canCancelTrackedOrder = Boolean(trackedOrder?.orderId) && orderTracker?.status !== "filled";

  const handlePreview = () => {
    if (!selectedAccountId) return;
    previewMutation.mutate(
      { account_id: selectedAccountId, order: baseOrder },
      { onSuccess: (result) => setPreviewResult(result), onError: () => toast.error("Order preview failed.") },
    );
  };

  const handlePlace = async () => {
    if (!selectedAccountId) return;
    const result = buildOrderSubmission(lifecycleInput);
    for (const error of result.errors) toast.error(error);
    const orders = result.orders;
    if (!orders.length) return;
    const modifyOrderId = target.mode === "modify" && target.orderId
      ? target.orderId
      : canUpdateTrackedOrder && trackedOrder?.orderId
        ? trackedOrder.orderId
        : null;
    const submit = () => {
      if (modifyOrderId) {
        modifyMutation.mutate(
          { accountId: selectedAccountId, orderId: modifyOrderId, order: orders[0] },
          {
            onSuccess: (result) => {
              setActionResult(result);
              setTrackedOrder({ orderId: modifyOrderId, order: orders[0], submittedAt: Date.now() });
              if (classifyOrderResult(result).kind === "submitted") runRefreshPlan("submitted");
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
            const classification = classifyOrderResult(result);
            if (classification.kind === "submitted" && classification.orderId) {
              setReplyId(null);
              setTrackedOrder({ orderId: classification.orderId, order: orders[0], submittedAt: Date.now() });
              runRefreshPlan("submitted");
            } else if (classification.kind === "reply_required") {
              setReplyId(classification.replyId);
            }
          },
          onError: () => toast.error("Order placement failed."),
        },
      );
    };
    if (isLiveAccount) {
      const action: TradingSafetyAction = modifyOrderId ? "modify" : "place";
      const gate = await evaluateLiveGate(selectedAccountId, action);
      if (gate.status === "blocked") {
        toast.error(gate.reason);
        return;
      }
      if (gate.status === "confirm") {
        setPendingLiveAction({ run: submit, message: gate.message, confirmLabel: gate.confirmLabel });
        return;
      }
    }
    submit();
  };

  const handleConfirm = async (confirmed: boolean) => {
    if (!selectedAccountId || !replyId) return;
    if (!confirmed) {
      setReplyId(null);
      return;
    }
    const submit = () => {
      replyMutation.mutate(
        { accountId: selectedAccountId, replyId, confirmed },
        {
          onSuccess: (result) => {
            setActionResult(result);
            const classification = classifyOrderResult(result);
            setReplyId(classification.kind === "reply_required" ? classification.replyId : null);
            if (classification.kind === "submitted" && classification.orderId) {
              setTrackedOrder({ orderId: classification.orderId, order: baseOrder, submittedAt: Date.now() });
              runRefreshPlan("submitted");
            }
          },
          onError: () => toast.error("Order confirmation failed."),
        },
      );
    };
    if (isLiveAccount) {
      const gate = await evaluateLiveGate(selectedAccountId, "reply");
      if (gate.status === "blocked") {
        toast.error(gate.reason);
        return;
      }
      if (gate.status === "confirm") {
        setPendingLiveAction({ run: submit, message: gate.message, confirmLabel: gate.confirmLabel });
        return;
      }
    }
    submit();
  };

  const handleCancelTrackedOrder = async () => {
    if (!selectedAccountId || !trackedOrder?.orderId) return;
    const submit = () => {
      cancelMutation.mutate(
        { accountId: selectedAccountId, orderId: trackedOrder.orderId },
        {
          onSuccess: () => {
            toast.success("Order cancelled.");
            setTrackedOrder(null);
            setActionResult(null);
            setReplyId(null);
            runRefreshPlan("cancelled");
          },
          onError: () => toast.error("Order cancellation failed."),
        },
      );
    };
    if (isLiveAccount) {
      const gate = await evaluateLiveGate(selectedAccountId, "cancel");
      if (gate.status === "blocked") {
        toast.error(gate.reason);
        return;
      }
      if (gate.status === "confirm") {
        setPendingLiveAction({ run: submit, message: gate.message, confirmLabel: gate.confirmLabel });
        return;
      }
    }
    submit();
  };

  const tifOptions = (["DAY", "GTC", "IOC"] as MoonMarketTimeInForce[])
    .filter((code) => !isTrailing || code !== "IOC");

  return {
    selectedAccountId,
    selectedAccount,
    assetClass,
    optionTarget,
    side,
    setSide,
    quantity,
    setQuantity,
    orderType,
    setOrderType,
    tif,
    setTif,
    price,
    setPrice,
    auxPrice,
    setAuxPrice,
    takeProfitEnabled,
    setTakeProfitEnabled,
    stopLossEnabled,
    setStopLossEnabled,
    profitTakerPrice,
    setProfitTakerPrice,
    stopLossPrice,
    setStopLossPrice,
    trailingType,
    setTrailingType,
    trailingAmt,
    setTrailingAmt,
    outsideRth,
    setOutsideRth,
    sizeMode,
    setSizeMode,
    cashAmount,
    setCashAmount,
    bpPercent,
    setBpPercent,
    liveBook,
    book,
    quoteQuery,
    buyingPower,
    availableOrderTypes,
    outsideRthOrderTypes,
    orderRulesQuery,
    cashShares,
    riskReward,
    previewResult,
    actionResult,
    replyId,
    orderTracker,
    pendingLiveAction,
    setPendingLiveAction,
    previewMutation,
    placeMutation,
    modifyMutation,
    replyMutation,
    cancelMutation,
    isAccountReady,
    accountReadyState,
    accountError,
    isLiveAccount,
    tifOptions,
    isTrailing,
    needsLimitPrice,
    needsStopPrice,
    canUseOutsideRth,
    limitPriceInvalid,
    stopPriceInvalid,
    canUpdateTrackedOrder,
    canCancelTrackedOrder,
    handlePreview,
    handlePlace,
    handleConfirm,
    handleCancelTrackedOrder,
    setSideTouched,
    hasInteractedRef,
  };
}
