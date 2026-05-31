import { formatMoney, formatNumber } from "./format";
import type { MoonMarketTrade } from "./types";

type SymbolRow = {
  symbol: string;
  count: number;
  buyCount: number;
  sellCount: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  netCash: number;
};

function symbolRows(trades: MoonMarketTrade[]): SymbolRow[] {
  const rows = new Map<string, SymbolRow>();
  for (const trade of trades) {
    const symbol = trade.symbol ?? `#${trade.conid}`;
    const row =
      rows.get(symbol) ?? {
        symbol,
        count: 0,
        buyCount: 0,
        sellCount: 0,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        netCash: 0,
      };
    const quantity = Math.abs(trade.quantity);
    row.count += 1;
    row.volume += quantity;
    if (trade.side === "BUY") {
      row.buyCount += 1;
      row.buyVolume += quantity;
    } else {
      row.sellCount += 1;
      row.sellVolume += quantity;
    }
    row.netCash += trade.net_amount ?? 0;
    rows.set(symbol, row);
  }
  return [...rows.values()].sort((a, b) => b.volume - a.volume).slice(0, 8);
}

function EmptyChart({ title }: { title: string }) {
  return (
    <section className="min-h-44 rounded-md border border-border bg-[var(--bg-2)] p-4">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <div className="mt-6 rounded border border-dashed border-border bg-[var(--bg-1)] p-5 text-center text-[12px] text-[var(--text-3)]">
        No recent executions for this account.
      </div>
    </section>
  );
}

export function TransactionCharts({ trades }: { trades: MoonMarketTrade[] }) {
  const rows = symbolRows(trades);
  if (!rows.length) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <EmptyChart title="Symbol Activity" />
        <EmptyChart title="Volume by Symbol" />
      </div>
    );
  }

  const maxVolume = Math.max(...rows.map((row) => row.volume), 1);
  const maxCash = Math.max(...rows.map((row) => Math.abs(row.netCash)), 1);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-md border border-border bg-[var(--bg-2)] p-3.5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold">Symbol Activity</h3>
            <p className="text-[11px] text-[var(--text-3)]">Net cash impact by symbol</p>
          </div>
        </div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.symbol} className="grid grid-cols-[64px_minmax(0,1fr)_92px] items-center gap-3 text-[11px]">
              <div className="truncate font-semibold">{row.symbol}</div>
              <div className="h-2 overflow-hidden rounded bg-[var(--bg-1)]">
                <div
                  className={row.netCash >= 0 ? "h-full rounded bg-[var(--clr-green)]" : "h-full rounded bg-[var(--clr-red)]"}
                  style={{ width: `${Math.max(8, (Math.abs(row.netCash) / maxCash) * 100)}%` }}
                />
              </div>
              <div className={row.netCash >= 0 ? "text-right font-data text-[var(--clr-green)]" : "text-right font-data text-[var(--clr-red)]"}>
                {formatMoney(row.netCash)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-border bg-[var(--bg-2)] p-3.5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold">Volume Mix</h3>
            <p className="text-[11px] text-[var(--text-3)]">Buy and sell quantity by symbol</p>
          </div>
        </div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.symbol} className="grid grid-cols-[64px_minmax(0,1fr)_74px] items-center gap-3 text-[11px]">
              <div className="truncate font-semibold">{row.symbol}</div>
              <div
                className="flex h-2 overflow-hidden rounded bg-[var(--bg-1)]"
                aria-label={`${row.symbol} volume ${formatNumber(row.volume)}`}
              >
                <div
                  className="h-full bg-[var(--clr-green)]"
                  style={{ width: `${row.volume ? (row.buyVolume / row.volume) * Math.max(8, (row.volume / maxVolume) * 100) : 0}%` }}
                />
                <div
                  className="h-full bg-[var(--clr-red)]"
                  style={{ width: `${row.volume ? (row.sellVolume / row.volume) * Math.max(8, (row.volume / maxVolume) * 100) : 0}%` }}
                />
              </div>
              <div className="text-right font-data text-[var(--text-3)]">
                {formatNumber(row.buyVolume)} / {formatNumber(row.sellVolume)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
