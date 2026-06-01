import { cn } from "@/lib/utils";
import { formatHold, formatMoney, formatNumber, formatPercent, formatSignedMoney } from "./format";
import type { InflectTrade } from "./types";

function formatTime(value: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function TradesTable({
  trades,
  selectedTradeId,
  onSelect,
}: {
  trades: InflectTrade[];
  selectedTradeId: string | null;
  onSelect: (tradeId: string) => void;
}) {
  if (!trades.length) {
    return (
      <div className="rounded-md border border-border bg-[var(--bg-2)] p-6 text-center text-[12px] text-[var(--text-3)]">
        No trades for the selected filters.
      </div>
    );
  }

  return (
    <section className="rounded-md border border-border bg-[var(--bg-2)]">
      <div className="overflow-x-auto pb-2">
        <table className="w-full min-w-[820px] text-left text-[11px]">
          <thead className="sticky top-0 border-b border-border bg-[var(--bg-2)] text-[10px] uppercase text-[var(--text-3)]">
            <tr>
              <th className="px-3 py-2 font-medium">Closed</th>
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium">Direction</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Entry</th>
              <th className="px-3 py-2 text-right font-medium">Exit</th>
              <th className="px-3 py-2 text-right font-medium">Net P&amp;L</th>
              <th className="px-3 py-2 text-right font-medium">Return</th>
              <th className="px-3 py-2 text-right font-medium">Hold</th>
              <th className="px-3 py-2 font-medium">Setup</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => {
              const net = trade.net_pnl;
              const positive = net != null && net > 0;
              const negative = net != null && net < 0;
              return (
                <tr
                  key={trade.trade_id}
                  onClick={() => onSelect(trade.trade_id)}
                  className={cn(
                    "cursor-pointer border-b border-border/70 last:border-0 hover:bg-[var(--bg-3)]",
                    selectedTradeId === trade.trade_id && "bg-[var(--clr-cyan)]/10",
                  )}
                >
                  <td className="px-3 py-2 text-[var(--text-3)]">{formatTime(trade.close_time)}</td>
                  <td className="px-3 py-2 font-semibold">{trade.symbol || `#${trade.conid}`}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded px-2 py-1",
                        trade.direction === "LONG"
                          ? "bg-[var(--clr-green)]/15 text-[var(--clr-green)]"
                          : "bg-[var(--clr-red)]/15 text-[var(--clr-red)]",
                      )}
                    >
                      {trade.direction}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-2)]">{trade.status}</td>
                  <td className="px-3 py-2 text-right font-data">{formatNumber(trade.qty)}</td>
                  <td className="px-3 py-2 text-right font-data">{formatMoney(trade.avg_entry)}</td>
                  <td className="px-3 py-2 text-right font-data">{formatMoney(trade.avg_exit)}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-data",
                      positive && "text-[var(--clr-green)]",
                      negative && "text-[var(--clr-red)]",
                    )}
                  >
                    {formatSignedMoney(net)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-data",
                      positive && "text-[var(--clr-green)]",
                      negative && "text-[var(--clr-red)]",
                    )}
                  >
                    {formatPercent(trade.return_pct)}
                  </td>
                  <td className="px-3 py-2 text-right font-data text-[var(--text-2)]">
                    {formatHold(trade.hold_duration_sec)}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-3)]">
                    {trade.journal_entry?.setup ?? "--"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
