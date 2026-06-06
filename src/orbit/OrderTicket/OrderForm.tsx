import type {
  MoonMarketOrderType,
  MoonMarketTimeInForce,
  MoonMarketTrailingType,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { LiveOrderConfirmDialog } from "./LiveOrderConfirmDialog";
import { ORDER_TYPE_LABELS, TIF_LABELS, TRAILING_TYPE_LABELS } from "./labels";
import { OrderResult } from "./OrderResult";
import { useOrderTicketLifecycle } from "./useOrderTicketLifecycle";
import type { OrderTicketTarget } from "./useOrderTicketStore";
import { useOrderTicketStore } from "./useOrderTicketStore";

function formatQuoteNumber(value: number | null | undefined, digits = 2): string {
  return value == null ? "—" : value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSize(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

type OrderFormProps = {
  target: OrderTicketTarget;
};

export function OrderForm({ target }: OrderFormProps) {
  const closeTicket = useOrderTicketStore((state) => state.close);
  const {
    selectedAccountId,
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
  } = useOrderTicketLifecycle(target);

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
      {isLiveAccount ? <div className="border-t border-[var(--clr-red)]/30 px-4 py-2 text-[11px] text-[var(--clr-red)]">Live account — orders are sent with real money after confirmation.</div> : null}
      <div className="flex gap-2 border-t border-border p-4">
        {orderTracker?.status === "filled" ? (
          <button type="button" onClick={closeTicket} className="rounded-md border border-[var(--clr-green)] px-3 py-2 text-[12px] text-[var(--clr-green)]">
            Close
          </button>
        ) : (
          <>
            <button type="button" onClick={handlePreview} disabled={!selectedAccountId || previewMutation.isPending} className="rounded-md border border-border px-3 py-2 text-[12px] disabled:opacity-50">Preview</button>
            <button type="button" onClick={handlePlace} disabled={!selectedAccountId || placeMutation.isPending || modifyMutation.isPending} className="rounded-md border border-[var(--clr-cyan)] px-3 py-2 text-[12px] text-[var(--clr-cyan)] disabled:opacity-50">
              {target.mode === "modify" ? "Modify" : canUpdateTrackedOrder ? "Update Order" : "Place"}
            </button>
            {canCancelTrackedOrder ? (
              <button type="button" onClick={handleCancelTrackedOrder} disabled={!selectedAccountId || cancelMutation.isPending} className="rounded-md border border-[var(--clr-red)] px-3 py-2 text-[12px] text-[var(--clr-red)] disabled:opacity-50">
                {cancelMutation.isPending ? "Cancelling..." : "Cancel Order"}
              </button>
            ) : null}
          </>
        )}
      </div>
      <OrderResult previewResult={previewResult} actionResult={actionResult} replyId={replyId} orderTracker={orderTracker} onConfirm={handleConfirm} confirming={replyMutation.isPending} />
      <LiveOrderConfirmDialog
        open={!!pendingLiveAction}
        accountId={selectedAccountId}
        message={pendingLiveAction?.message ?? ""}
        confirmLabel={pendingLiveAction?.confirmLabel}
        pending={placeMutation.isPending || modifyMutation.isPending || replyMutation.isPending}
        onConfirm={() => {
          pendingLiveAction?.run();
          setPendingLiveAction(null);
        }}
        onCancel={() => setPendingLiveAction(null)}
      />
    </form>
  );
}
