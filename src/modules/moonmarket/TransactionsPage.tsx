import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Banknote, ListChecks, ReceiptText, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { formatMoney, formatNumber } from "./format";
import { LiveOrdersTable } from "./LiveOrdersTable";
import { TransactionCharts } from "./TransactionCharts";
import { TransactionsTable } from "./TransactionsTable";

type TransactionsTab = "trades" | "orders";

function SummaryCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = "cyan",
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: "cyan" | "green" | "orange" | "red";
}) {
  return (
    <section className="rounded-md border border-border bg-[var(--bg-2)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-[var(--text-3)]">{title}</div>
          <div className="mt-1 truncate font-data text-[18px]">{value}</div>
          <div className="mt-1 truncate text-[11px] text-[var(--text-3)]">{detail}</div>
        </div>
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded border",
            tone === "cyan" && "border-[var(--clr-cyan)]/40 text-[var(--clr-cyan)]",
            tone === "green" && "border-[var(--clr-green)]/40 text-[var(--clr-green)]",
            tone === "orange" && "border-[var(--clr-orange)]/40 text-[var(--clr-orange)]",
            tone === "red" && "border-[var(--clr-red)]/40 text-[var(--clr-red)]",
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.7} />
        </div>
      </div>
    </section>
  );
}

export function TransactionsPage({ accountId }: { accountId: string | null }) {
  const [tab, setTab] = useState<TransactionsTab>("trades");

  const tradesQuery = useQuery({
    queryKey: ["moonmarket", "trades", accountId, 7],
    enabled: Boolean(accountId),
    queryFn: ({ signal }) => api.moonmarketTrades(accountId as string, 7, signal),
  });

  const ordersQuery = useQuery({
    queryKey: ["moonmarket", "live-orders", accountId],
    enabled: Boolean(accountId),
    queryFn: ({ signal }) => api.moonmarketLiveOrders(accountId as string, signal),
  });

  const tradesResponse = tradesQuery.data;
  const summary = tradesResponse?.summary;
  const trades = tradesResponse?.trades ?? [];
  const orders = ordersQuery.data?.orders ?? [];
  const error = tradesQuery.error ?? ordersQuery.error;
  const loading = tradesQuery.isLoading || ordersQuery.isLoading;

  return (
    <main className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">Transactions Ledger</h2>
          <p className="text-[11px] text-[var(--text-3)]">
            Recent executions and read-only working orders for the selected account.
          </p>
        </div>
        <div className="rounded-md border border-border bg-[var(--bg-2)] px-3 py-2 text-[11px] text-[var(--text-3)]">
          Last 7 days
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-4 text-[12px] text-[var(--clr-red)]">
          MoonMarket transactions data is unavailable.
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard
              title="Total Trades"
              value={`${summary?.total_trades ?? 0} trades`}
              detail="Recent executions"
              icon={ReceiptText}
            />
            <SummaryCard
              title="Volume"
              value={formatNumber(summary?.total_volume)}
              detail="Shares/contracts"
              icon={Scale}
              tone="orange"
            />
            <SummaryCard
              title="Commissions"
              value={formatMoney(summary?.total_commissions)}
              detail="Execution costs"
              icon={Banknote}
              tone="red"
            />
            <SummaryCard
              title="Net Cash"
              value={formatMoney(summary?.net_cash)}
              detail="Buys and sells"
              icon={Activity}
              tone={(summary?.net_cash ?? 0) >= 0 ? "green" : "red"}
            />
            <SummaryCard
              title="Buy / Sell"
              value={`${summary?.buy_count ?? 0} / ${summary?.sell_count ?? 0}`}
              detail="Execution mix"
              icon={ListChecks}
              tone="green"
            />
          </div>

          {loading ? (
            <div className="min-h-[360px] animate-pulse rounded-md border border-border bg-[var(--bg-2)]" />
          ) : (
            <>
              <TransactionCharts trades={trades} />

              <section>
                <div className="mb-3 flex h-9 w-fit items-center gap-1 rounded-md border border-border bg-[var(--bg-2)] p-1">
                  <button
                    type="button"
                    aria-pressed={tab === "trades"}
                    onClick={() => setTab("trades")}
                    className={cn(
                      "h-7 rounded px-3 text-[11px] font-medium",
                      tab === "trades" ? "bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)]" : "text-[var(--text-3)]",
                    )}
                  >
                    Recent Trades
                  </button>
                  <button
                    type="button"
                    aria-pressed={tab === "orders"}
                    onClick={() => setTab("orders")}
                    className={cn(
                      "h-7 rounded px-3 text-[11px] font-medium",
                      tab === "orders" ? "bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)]" : "text-[var(--text-3)]",
                    )}
                  >
                    Live Orders
                  </button>
                </div>
                {tab === "trades" ? <TransactionsTable trades={trades} /> : <LiveOrdersTable orders={orders} />}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
