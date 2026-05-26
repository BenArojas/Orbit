import { formatMoney, formatNumber } from "./format";
import type { MoonMarketLiveOrder } from "./types";

export function LiveOrdersTable({ orders }: { orders: MoonMarketLiveOrder[] }) {
  return (
    <section className="rounded-md border border-border bg-[var(--bg-2)]">
      <div className="border-b border-border p-3">
        <h3 className="text-[13px] font-semibold">Live Orders</h3>
        <p className="text-[11px] text-[var(--text-3)]">{orders.length} working orders</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[11px]">
          <thead className="border-b border-border text-[10px] uppercase text-[var(--text-3)]">
            <tr>
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Quantity</th>
              <th className="px-3 py-2 text-right font-medium">Remaining</th>
              <th className="px-3 py-2 text-right font-medium">Limit</th>
              <th className="px-3 py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.order_id} className="border-b border-border/70 last:border-0">
                <td className="px-3 py-2 font-semibold">{order.symbol ?? (order.conid ? `#${order.conid}` : "--")}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!orders.length && (
        <div className="p-6 text-center text-[12px] text-[var(--text-3)]">No live orders for this account.</div>
      )}
    </section>
  );
}
