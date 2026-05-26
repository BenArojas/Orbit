import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatNumber } from "./format";
import type { MoonMarketTrade } from "./types";

type SideFilter = "all" | "buy" | "sell";

function formatTradeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function TransactionsTable({ trades }: { trades: MoonMarketTrade[] }) {
  const [side, setSide] = useState<SideFilter>("all");
  const [filter, setFilter] = useState("");
  const filteredTrades = useMemo(() => {
    const query = filter.trim().toUpperCase();
    return trades.filter((trade) => {
      const sideMatch = side === "all" || trade.side.toLowerCase() === side;
      const symbolMatch = !query || (trade.symbol ?? "").toUpperCase().includes(query);
      return sideMatch && symbolMatch;
    });
  }, [filter, side, trades]);

  return (
    <section className="rounded-md border border-border bg-[var(--bg-2)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
        <div>
          <h3 className="text-[13px] font-semibold">Recent Trades</h3>
          <p className="text-[11px] text-[var(--text-3)]">{filteredTrades.length} visible executions</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-8 items-center gap-1 rounded-md border border-border bg-[var(--bg-1)] p-1">
            {(["all", "buy", "sell"] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={side === item}
                onClick={() => setSide(item)}
                className={cn(
                  "h-6 rounded px-2 text-[11px] font-medium capitalize",
                  side === item ? "bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)]" : "text-[var(--text-3)]",
                )}
              >
                {item === "all" ? "All" : `${item}s`}
              </button>
            ))}
          </div>
          <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-[var(--bg-1)] px-2">
            <Search className="h-3.5 w-3.5 text-[var(--text-3)]" strokeWidth={1.7} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Symbol"
              className="w-20 bg-transparent text-[11px] outline-none placeholder:text-[var(--text-3)]"
            />
          </label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[11px]">
          <thead className="border-b border-border text-[10px] uppercase text-[var(--text-3)]">
            <tr>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 text-right font-medium">Quantity</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">Net Amount</th>
              <th className="px-3 py-2 text-right font-medium">Commission</th>
            </tr>
          </thead>
          <tbody>
            {filteredTrades.map((trade) => (
              <tr key={trade.execution_id} className="border-b border-border/70 last:border-0">
                <td className="px-3 py-2 text-[var(--text-3)]">{formatTradeTime(trade.trade_time)}</td>
                <td className="px-3 py-2 font-semibold">{trade.symbol ?? `#${trade.conid}`}</td>
                <td className="max-w-[220px] truncate px-3 py-2 text-[var(--text-2)]">{trade.description}</td>
                <td className="px-3 py-2">
                  <span className={trade.side === "BUY" ? "rounded bg-[var(--clr-green)]/15 px-2 py-1 text-[var(--clr-green)]" : "rounded bg-[var(--clr-red)]/15 px-2 py-1 text-[var(--clr-red)]"}>
                    {trade.side}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-data">{formatNumber(trade.quantity)}</td>
                <td className="px-3 py-2 text-right font-data">{formatMoney(trade.price)}</td>
                <td className={trade.net_amount != null && trade.net_amount >= 0 ? "px-3 py-2 text-right font-data text-[var(--clr-green)]" : "px-3 py-2 text-right font-data text-[var(--clr-red)]"}>
                  {formatMoney(trade.net_amount)}
                </td>
                <td className="px-3 py-2 text-right font-data">{formatMoney(trade.commission)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filteredTrades.length && (
        <div className="p-6 text-center text-[12px] text-[var(--text-3)]">No trades found for the selected filters.</div>
      )}
    </section>
  );
}
