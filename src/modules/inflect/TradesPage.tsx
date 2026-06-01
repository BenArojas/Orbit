import { useState } from "react";
import { cn } from "@/lib/utils";
import { useInflectStore } from "@/store/inflect";
import { useInflectTrades } from "@/hooks/useInflectTrades";
import { TradesTable } from "./TradesTable";
import { TradeDetail } from "./TradeDetail";
import type { InflectTradeStatus } from "./types";

type StatusFilter = "ALL" | InflectTradeStatus;
const STATUS_TABS: StatusFilter[] = ["ALL", "CLOSED", "OPEN"];

export function TradesPage({ accountId }: { accountId: string | null }) {
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const selectedTradeId = useInflectStore((state) => state.selectedTradeId);
  const selectTrade = useInflectStore((state) => state.selectTrade);

  const tradesQuery = useInflectTrades(
    accountId ?? undefined,
    status === "ALL" ? undefined : status,
  );
  const trades = tradesQuery.data?.trades ?? [];

  return (
    <div className="flex h-full min-h-0">
      <main className="min-w-0 flex-1 space-y-4 overflow-y-auto p-4 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold">Trades</h2>
            <p className="text-[11px] text-[var(--text-3)]">
              Round-trip trades derived from your executions.
            </p>
          </div>
          <div className="flex h-8 items-center gap-1 rounded-md border border-border bg-[var(--bg-2)] p-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={status === tab}
                onClick={() => setStatus(tab)}
                className={cn(
                  "h-6 rounded px-2.5 text-[11px] font-medium capitalize",
                  status === tab
                    ? "bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)]"
                    : "text-[var(--text-3)]",
                )}
              >
                {tab === "ALL" ? "All" : tab.toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {tradesQuery.error ? (
          <div className="rounded-md border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-4 text-[12px] text-[var(--clr-red)]">
            Inflect trade data is unavailable.
          </div>
        ) : tradesQuery.isLoading ? (
          <div className="min-h-[360px] animate-pulse rounded-md border border-border bg-[var(--bg-2)]" />
        ) : (
          <TradesTable
            trades={trades}
            selectedTradeId={selectedTradeId}
            onSelect={selectTrade}
          />
        )}
      </main>

      {selectedTradeId ? (
        <TradeDetail
          tradeId={selectedTradeId}
          accountId={accountId}
          onClose={() => selectTrade(null)}
        />
      ) : null}
    </div>
  );
}
