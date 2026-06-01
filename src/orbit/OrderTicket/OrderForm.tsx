import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  MoonMarketOrderDraft,
  MoonMarketOrderSide,
  MoonMarketOrderType,
  MoonMarketTimeInForce,
} from "@/lib/api";
import { api } from "@/lib/api";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { useAccountStore } from "./useAccountStore";
import { useModifyOrder, usePlaceOrder, usePreviewOrder, useReplyOrder } from "./useOrderMutations";
import type { OrderTicketTarget } from "./useOrderTicketStore";
import { OrderResult } from "./OrderResult";

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resultData(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("result" in result)) return result;
  return (result as { result: unknown }).result;
}

function firstReplyId(result: unknown): string | null {
  const payload = resultData(result);
  if (!payload || typeof payload !== "object" || !("data" in payload)) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const first = data[0];
  if (!first || typeof first !== "object") return null;
  const id = (first as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
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

export function OrderForm({ target }: OrderFormProps) {
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
  const [liveBook, setLiveBook] = useState<LiveBook>({
    bid: null,
    ask: null,
    bidSize: null,
    askSize: null,
  });
  const [previewResult, setPreviewResult] = useState<unknown>(null);
  const [actionResult, setActionResult] = useState<unknown>(null);
  const [replyId, setReplyId] = useState<string | null>(null);

  const previewMutation = usePreviewOrder();
  const placeMutation = usePlaceOrder();
  const modifyMutation = useModifyOrder();
  const replyMutation = useReplyOrder();
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
    setLiveBook({ bid: null, ask: null, bidSize: null, askSize: null });
    setPreviewResult(null);
    setActionResult(null);
    setReplyId(null);
  }, [target]);

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

  const baseOrder = useMemo<MoonMarketOrderDraft>(() => ({
    conid: target.conid,
    assetClass,
    side,
    quantity: Number(quantity) || 0,
    orderType,
    tif,
    price: numberOrUndefined(price),
    auxPrice: numberOrUndefined(auxPrice),
  }), [assetClass, auxPrice, orderType, price, quantity, side, target.conid, tif]);

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
    const orders = buildOrders();
    if (!orders.length) return;
    if (target.mode === "modify" && target.orderId) {
      modifyMutation.mutate(
        { accountId: selectedAccountId, orderId: target.orderId, order: orders[0] },
        {
          onSuccess: (result) => setActionResult(result),
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
          setReplyId(firstReplyId(result));
        },
        onError: () => toast.error("Order placement failed."),
      },
    );
  };

  const handleConfirm = (confirmed: boolean) => {
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
        },
        onError: () => toast.error("Order confirmation failed."),
      },
    );
  };

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
          <button type="button" aria-pressed={side === "BUY"} onClick={() => setSide("BUY")} className="rounded-md border border-border px-3 py-2 text-[12px]">BUY</button>
          <button type="button" aria-pressed={side === "SELL"} onClick={() => setSide("SELL")} className="rounded-md border border-border px-3 py-2 text-[12px]">SELL</button>
        </div>
        <label className="block text-[11px] text-[var(--text-3)]">
          Quantity
          <input aria-label="Quantity" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
        </label>
        <label className="block text-[11px] text-[var(--text-3)]">
          Order Type
          <select aria-label="Order Type" value={orderType} onChange={(event) => setOrderType(event.target.value as MoonMarketOrderType)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]">
            <option value="MKT">Market</option>
            <option value="LMT">Limit</option>
            <option value="STP">Stop</option>
            <option value="STP_LIMIT">Stop Limit</option>
          </select>
        </label>
        <label className="block text-[11px] text-[var(--text-3)]">
          TIF
          <select aria-label="TIF" value={tif} onChange={(event) => setTif(event.target.value as MoonMarketTimeInForce)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]">
            <option value="DAY">DAY</option>
            <option value="GTC">GTC</option>
            <option value="IOC">IOC</option>
          </select>
        </label>
        <label className="block text-[11px] text-[var(--text-3)]">
          Limit Price
          <input aria-label="Limit Price" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
        </label>
        <label className="block text-[11px] text-[var(--text-3)]">
          Aux Price
          <input aria-label="Aux Price" value={auxPrice} onChange={(event) => setAuxPrice(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px]" />
        </label>
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
      </div>
      {liveBlocked ? <div className="border-t border-border px-4 py-2 text-[11px] text-[var(--clr-red)]">Live account order mutations are blocked in Orbit v1.</div> : null}
      <div className="flex gap-2 border-t border-border p-4">
        <button type="button" onClick={handlePreview} disabled={!selectedAccountId || previewMutation.isPending} className="rounded-md border border-border px-3 py-2 text-[12px] disabled:opacity-50">Preview</button>
        <button type="button" onClick={handlePlace} disabled={!selectedAccountId || liveBlocked || placeMutation.isPending || modifyMutation.isPending} className="rounded-md border border-[var(--clr-cyan)] px-3 py-2 text-[12px] text-[var(--clr-cyan)] disabled:opacity-50">
          {target.mode === "modify" ? "Modify" : "Place"}
        </button>
      </div>
      <OrderResult previewResult={previewResult} actionResult={actionResult} replyId={replyId} onConfirm={handleConfirm} confirming={replyMutation.isPending} liveBlocked={liveBlocked} />
    </form>
  );
}
