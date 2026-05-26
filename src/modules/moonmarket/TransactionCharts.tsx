import { formatMoney, formatNumber } from "./format";
import type { MoonMarketTrade } from "./types";

type SymbolRow = {
  symbol: string;
  count: number;
  volume: number;
  netCash: number;
};

function symbolRows(trades: MoonMarketTrade[]): SymbolRow[] {
  const rows = new Map<string, SymbolRow>();
  for (const trade of trades) {
    const symbol = trade.symbol ?? `#${trade.conid}`;
    const row = rows.get(symbol) ?? { symbol, count: 0, volume: 0, netCash: 0 };
    row.count += 1;
    row.volume += trade.quantity;
    row.netCash += trade.net_amount ?? 0;
    rows.set(symbol, row);
  }
  return [...rows.values()].sort((a, b) => b.volume - a.volume).slice(0, 8);
}

function EmptyChart({ title }: { title: string }) {
  return (
    <section className="min-h-56 rounded-md border border-border bg-[var(--bg-2)] p-4">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <div className="mt-8 rounded border border-dashed border-border bg-[var(--bg-1)] p-6 text-center text-[12px] text-[var(--text-3)]">
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
  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="min-h-56 rounded-md border border-border bg-[var(--bg-2)] p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold">Symbol Activity</h3>
            <p className="text-[11px] text-[var(--text-3)]">Trade count and net cash by symbol</p>
          </div>
        </div>
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.symbol} className="grid grid-cols-[64px_minmax(0,1fr)_88px] items-center gap-3 text-[11px]">
              <div className="truncate font-semibold">{row.symbol}</div>
              <div className="h-2 overflow-hidden rounded bg-[var(--bg-1)]">
                <div
                  className="h-full rounded bg-[var(--clr-cyan)]"
                  style={{ width: `${Math.max(8, (row.count / maxCount) * 100)}%` }}
                />
              </div>
              <div className={row.netCash >= 0 ? "text-right font-data text-[var(--clr-green)]" : "text-right font-data text-[var(--clr-red)]"}>
                {formatMoney(row.netCash)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="min-h-56 rounded-md border border-border bg-[var(--bg-2)] p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold">Volume by Symbol</h3>
            <p className="text-[11px] text-[var(--text-3)]">Execution quantity distribution</p>
          </div>
        </div>
        <div className="flex h-36 items-end gap-3">
          {rows.map((row) => (
            <div key={row.symbol} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div
                className="w-full rounded-t bg-[var(--clr-orange)]/80"
                style={{ height: `${Math.max(10, (row.volume / maxVolume) * 128)}px` }}
                aria-label={`${row.symbol} volume ${formatNumber(row.volume)}`}
              />
              <div className="w-full truncate text-center text-[10px] text-[var(--text-3)]">{row.symbol}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
