import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { MoonMarketOptionContract } from "@/lib/api";
import { useOrderTicketStore } from "@/orbit/OrderTicket";
import { OptionsChainTable } from "./OptionsChainTable";
import { useOptionChain, useOptionExpirations } from "./useOptionsChain";

function midpoint(bid: number | null | undefined, ask: number | null | undefined): number | null {
  if (typeof bid === "number" && Number.isFinite(bid) && typeof ask === "number" && Number.isFinite(ask)) {
    return (bid + ask) / 2;
  }
  return null;
}

export function OptionsChainPage() {
  const [params] = useSearchParams();
  const rawConid = Number(params.get("conid"));
  const underlyingConid = Number.isFinite(rawConid) && rawConid > 0 ? rawConid : null;
  const symbol = params.get("symbol")?.toUpperCase() ?? "";
  const openOrderTicket = useOrderTicketStore((state) => state.open);
  const expirationsQuery = useOptionExpirations(underlyingConid, symbol || null);
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const expiration = selectedExpiration ?? expirationsQuery.data?.expirations[0] ?? null;
  const chainQuery = useOptionChain(underlyingConid, expiration);
  const quoteQuery = useQuery({
    queryKey: ["market", "quote", underlyingConid],
    enabled: Boolean(underlyingConid),
    queryFn: ({ signal }) => api.quote(underlyingConid as number, signal),
  });
  const underlyingPrice = quoteQuery.data?.lastPrice ?? midpoint(quoteQuery.data?.bid, quoteQuery.data?.ask);
  const title = useMemo(() => symbol || "Options", [symbol]);

  if (!underlyingConid || !symbol) {
    return (
      <main className="p-4">
        <section className="rounded-md border border-dashed border-border bg-[var(--bg-2)] p-4 text-[12px] text-[var(--text-3)]">
          Open Options from Parallax Analysis or a MoonMarket portfolio holding.
        </section>
      </main>
    );
  }

  const handleSelect = (option: MoonMarketOptionContract) => {
    const description = `${symbol} ${option.expiration} ${option.strike} ${option.type.toUpperCase()}`;
    openOrderTicket({
      conid: option.contractId,
      symbol: description,
      description,
      assetClass: "OPT",
      side: "BUY",
    });
  };

  return (
    <main className="min-h-0 p-4">
      <OptionsChainTable
        title={title}
        underlyingConid={underlyingConid}
        expirations={expirationsQuery.data?.expirations ?? []}
        selectedExpiration={expiration}
        onExpirationChange={(next) => {
          setSelectedExpiration(next);
        }}
        allStrikes={chainQuery.data?.all_strikes ?? []}
        underlyingPrice={underlyingPrice}
        underlyingPriceLoading={quoteQuery.isLoading}
        underlyingPriceError={quoteQuery.isError || (!quoteQuery.isLoading && underlyingPrice == null)}
        onRetryQuote={() => {
          void quoteQuery.refetch();
        }}
        loading={expirationsQuery.isLoading || chainQuery.isLoading}
        error={expirationsQuery.error || chainQuery.error}
        onSelect={handleSelect}
      />
    </main>
  );
}
