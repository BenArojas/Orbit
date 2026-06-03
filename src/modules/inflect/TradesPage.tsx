import { useState } from "react";
import { cn } from "@/lib/utils";
import { useInflectStore } from "@/store/inflect";
import { useInflectSymbols } from "@/hooks/useInflectSymbols";
import { useInflectTrades } from "@/hooks/useInflectTrades";
import { SymbolSearch } from "./SymbolSearch";
import { StoragePanel } from "./StoragePanel";
import { TradesTable } from "./TradesTable";
import { TradeDetail } from "./TradeDetail";
import { isNeedsBasisStatus } from "./format";
import type { InflectTradeStatus } from "./types";

type StatusFilter = "ALL" | "NEEDS_ATTENTION" | InflectTradeStatus;
const STATUS_TABS: StatusFilter[] = ["ALL", "CLOSED", "OPEN", "NEEDS_ATTENTION"];

function tabLabel(tab: StatusFilter): string {
  if (tab === "ALL") return "All";
  if (tab === "NEEDS_ATTENTION") return "Needs attention";
  return tab.toLowerCase();
}

export function TradesPage({ accountId }: { accountId: string | null }) {
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [selectedConid, setSelectedConid] = useState<number | null>(null);
  const selectedTradeId = useInflectStore((state) => state.selectedTradeId);
  const selectTrade = useInflectStore((state) => state.selectTrade);

  const tradesQuery = useInflectTrades(
    accountId ?? undefined,
    status === "ALL" || status === "NEEDS_ATTENTION" ? undefined : status,
  );
  const symbolsQuery = useInflectSymbols(accountId);
  const allTrades = tradesQuery.data?.trades ?? [];
  const statusFiltered =
    status === "NEEDS_ATTENTION"
      ? allTrades.filter((trade) => isNeedsBasisStatus(trade.status))
      : allTrades;
  const normalizedQuery = symbolQuery.trim().toLowerCase();
  const trades = statusFiltered.filter((trade) => {
    if (selectedConid != null && trade.conid !== selectedConid) return false;
    if (!normalizedQuery) return true;
    return (trade.symbol || `#${trade.conid}`).toLowerCase().includes(normalizedQuery);
  });

  function clearFilters() {
    setStatus("ALL");
    setSymbolQuery("");
    setSelectedConid(null);
    selectTrade(null);
  }

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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SymbolSearch
              query={symbolQuery}
              selectedConid={selectedConid}
              symbols={symbolsQuery.data?.symbols ?? []}
              onQueryChange={(value) => {
                setSymbolQuery(value);
                selectTrade(null);
              }}
              onSymbolChange={(value) => {
                setSelectedConid(value);
                selectTrade(null);
              }}
              onClear={clearFilters}
            />
            <div className="flex h-8 items-center gap-1 rounded-md border border-border bg-[var(--bg-2)] p-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={status === tab}
                  onClick={() => {
                    setStatus(tab);
                    selectTrade(null);
                  }}
                  className={cn(
                    "h-6 rounded px-2.5 text-[11px] font-medium capitalize",
                    status === tab
                      ? "bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)]"
                      : "text-[var(--text-3)]",
                  )}
                >
                  {tabLabel(tab)}
                </button>
              ))}
            </div>
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

        <StoragePanel />
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
