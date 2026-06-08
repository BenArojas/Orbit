import { useState } from "react";
import type { MoonMarketOptionContract } from "@/modules/moonmarket/api";
import { OptionContractCell } from "./OptionContractCell";
import { useOptionStrike } from "./useOptionsChain";

function strikeKey(strike: number): string {
  return strike.toFixed(2);
}

type StrikeContracts = { call?: MoonMarketOptionContract; put?: MoonMarketOptionContract };

export function StrikeRow({
  underlyingConid,
  expiration,
  strike,
  preloaded,
  onSelect,
}: {
  underlyingConid: number;
  expiration: string;
  strike: number;
  preloaded?: StrikeContracts;
  onSelect: (option: MoonMarketOptionContract) => void;
}) {
  const [manualLoad, setManualLoad] = useState(false);
  const rowKey = strikeKey(strike);
  const hasPreloaded = Boolean(preloaded?.call || preloaded?.put);
  // When the bundled window query already supplied this strike's pair, render it
  // directly and skip the per-strike query (only manual loads run their own query).
  const contractQuery = useOptionStrike(underlyingConid, expiration, strike, !hasPreloaded && manualLoad);
  const contracts = hasPreloaded ? preloaded : contractQuery.data?.data;
  const hasData = Boolean(contracts?.call || contracts?.put);
  const loading = contractQuery.isLoading || contractQuery.isFetching;

  if (!hasData) {
    return (
      <button
        type="button"
        aria-label={`Load strike ${strike}`}
        disabled={loading}
        onClick={() => {
          if (contractQuery.isError) {
            void contractQuery.refetch();
            return;
          }
          setManualLoad(true);
        }}
        className="grid min-h-16 w-full grid-cols-[1fr_92px_1fr] items-center gap-2 border-b border-border px-2 py-2 text-[12px] text-[var(--text-3)] hover:bg-[var(--bg-2)] disabled:opacity-60"
      >
        <div className="flex h-8 items-center justify-center rounded border border-dashed border-border bg-[var(--bg-1)]/60 text-[10px]">
          {loading ? "Loading" : contractQuery.isError ? "Retry" : "Load"}
        </div>
        <div className="rounded-md border border-border bg-[var(--bg-2)] py-1 text-center font-data text-[12px] text-[var(--text-1)]">
          {strike.toFixed(2)}
        </div>
        <div className="flex h-8 items-center justify-center rounded border border-dashed border-border bg-[var(--bg-1)]/60 text-[10px]">
          {loading ? "Loading" : contractQuery.isError ? "Retry" : "Load"}
        </div>
      </button>
    );
  }

  return (
    <div
      data-testid={`option-strike-${rowKey}`}
      className="grid min-h-16 grid-cols-[1fr_92px_1fr] items-center gap-2 border-b border-border px-2 py-2"
    >
      <OptionContractCell contract={contracts?.call} side="call" onSelect={() => contracts?.call && onSelect(contracts.call)} />
      <div className="rounded-md border border-border bg-[var(--bg-2)] py-1 text-center font-data text-[12px] text-[var(--text-1)]">
        {rowKey}
      </div>
      <OptionContractCell contract={contracts?.put} side="put" onSelect={() => contracts?.put && onSelect(contracts.put)} />
    </div>
  );
}
