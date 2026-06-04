import { Pencil, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { MoonMarketOrderDraft, MoonMarketOrderSide, MoonMarketOrderType } from "@/lib/api";
import { useAccountStore } from "@/orbit/OrderTicket/useAccountStore";
import { useOrderTicketStore } from "@/orbit/OrderTicket/useOrderTicketStore";
import { useCancelOrder } from "@/orbit/OrderTicket/useOrderMutations";
import { formatMoney, formatNumber } from "./format";
import type { MoonMarketLiveOrder } from "./types";

function normalizeSide(side: string): MoonMarketOrderSide {
  return side.toUpperCase().includes("SELL") || side.toUpperCase() === "SLD" ? "SELL" : "BUY";
}

function normalizeOrderType(orderType: string | null): MoonMarketOrderType {
  const normalized = orderType?.toUpperCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "MKT" ||
    normalized === "MARKET" ||
    normalized === "LMT" ||
    normalized === "LIMIT" ||
    normalized === "STP" ||
    normalized === "STOP" ||
    normalized === "STP_LIMIT" ||
    normalized === "STOP_LIMIT" ||
    normalized === "TRAIL" ||
    normalized === "TRAILING_STOP" ||
    normalized === "TRAILLMT" ||
    normalized === "TRAILING_STOP_LIMIT"
  ) {
    if (normalized === "MARKET") return "MKT";
    if (normalized === "LIMIT") return "LMT";
    if (normalized === "STOP") return "STP";
    if (normalized === "STOP_LIMIT") return "STP_LIMIT";
    if (normalized === "TRAILING_STOP") return "TRAIL";
    if (normalized === "TRAILING_STOP_LIMIT") return "TRAILLMT";
    return normalized as MoonMarketOrderType;
  }
  return "LMT";
}

function normalizeTif(tif: string | null | undefined): MoonMarketOrderDraft["tif"] {
  const normalized = tif?.toUpperCase();
  return normalized === "GTC" || normalized === "IOC" ? normalized : "DAY";
}

function orderDraft(order: MoonMarketLiveOrder): MoonMarketOrderDraft | null {
  if (!order.conid || !order.quantity) {
    return null;
  }

  return {
    conid: order.conid,
    side: normalizeSide(order.side),
    quantity: order.quantity,
    orderType: normalizeOrderType(order.order_type),
    tif: normalizeTif(order.tif),
    price: order.limit_price ?? undefined,
    auxPrice: order.aux_price ?? undefined,
    trailingType: order.trailing_type ?? undefined,
    trailingAmt: order.trailing_amt ?? undefined,
    outsideRTH: order.outside_rth || undefined,
  };
}

export function LiveOrdersTable({ accountId, orders }: { accountId: string | null; orders: MoonMarketLiveOrder[] }) {
  const selectedAccount = useAccountStore((state) => state.selectedAccount());
  const openOrderTicket = useOrderTicketStore((state) => state.open);
  const cancelMutation = useCancelOrder();
  const liveBlocked = selectedAccount ? !selectedAccount.is_paper : true;

  const cancelOrder = (order: MoonMarketLiveOrder) => {
    if (!accountId || liveBlocked) {
      return;
    }

    cancelMutation.mutate(
      { accountId, orderId: order.order_id },
      {
        onSuccess: () => toast.success("Order cancelled."),
        onError: () => toast.error("Cancel failed."),
      },
    );
  };

  const modifyOrder = (order: MoonMarketLiveOrder) => {
    const draft = orderDraft(order);
    if (!draft || !order.conid) {
      return;
    }

    openOrderTicket({
      mode: "modify",
      orderId: order.order_id,
      conid: order.conid,
      symbol: order.symbol ?? undefined,
      side: draft.side,
      draft,
    });
  };

  return (
    <section className="rounded-md border border-border bg-[var(--bg-2)]">
      <div className="border-b border-border p-3">
        <h3 className="text-[13px] font-semibold">Live Orders</h3>
        <p className="text-[11px] text-[var(--text-3)]">{orders.length} working orders</p>
      </div>
      <div data-testid="moonmarket-live-orders-scroll" className="max-h-[300px] overflow-auto">
        <table className="w-full min-w-[760px] text-left text-[11px]">
          <thead className="sticky top-0 border-b border-border bg-[var(--bg-2)] text-[10px] uppercase text-[var(--text-3)]">
            <tr>
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Quantity</th>
              <th className="px-3 py-2 text-right font-medium">Remaining</th>
              <th className="px-3 py-2 text-right font-medium">Limit</th>
              <th className="px-3 py-2 text-right font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const draft = orderDraft(order);
              const label = order.symbol ?? order.order_id;

              return (
                <tr key={order.order_id} className="border-b border-border/70 last:border-0">
                  <td className="px-3 py-2 font-semibold">
                    {order.symbol ?? (order.conid ? `#${order.conid}` : "--")}
                  </td>
                  <td className="max-w-[260px] truncate px-3 py-2 text-[var(--text-2)]">{order.description}</td>
                  <td className="px-3 py-2">{order.side}</td>
                  <td className="px-3 py-2 text-[var(--text-3)]">{order.order_type ?? "--"}</td>
                  <td className="px-3 py-2 text-right font-data">{formatNumber(order.quantity)}</td>
                  <td className="px-3 py-2 text-right font-data">{formatNumber(order.remaining_quantity)}</td>
                  <td className="px-3 py-2 text-right font-data">{formatMoney(order.limit_price)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className="rounded bg-[var(--clr-orange)]/15 px-2 py-1 text-[var(--clr-orange)]">
                      {order.status ?? "Unknown"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        aria-label={`Modify ${label} order`}
                        onClick={() => modifyOrder(order)}
                        disabled={liveBlocked || !draft}
                        className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[10px] text-[var(--text-2)] hover:border-[var(--clr-cyan)] hover:text-[var(--clr-cyan)] disabled:opacity-40"
                      >
                        <Pencil className="h-3 w-3" />
                        Modify
                      </button>
                      <button
                        type="button"
                        aria-label={`Cancel ${label} order`}
                        onClick={() => cancelOrder(order)}
                        disabled={liveBlocked || !accountId || cancelMutation.isPending}
                        className="inline-flex h-7 items-center gap-1 rounded border border-[var(--clr-red)]/50 px-2 text-[10px] text-[var(--clr-red)] hover:bg-[var(--clr-red)]/10 disabled:opacity-40"
                      >
                        <XCircle className="h-3 w-3" />
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!orders.length && (
        <div className="p-6 text-center text-[12px] text-[var(--text-3)]">No live orders for this account.</div>
      )}
    </section>
  );
}
