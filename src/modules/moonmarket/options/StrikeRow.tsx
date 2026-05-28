import type { MoonMarketOptionContract, MoonMarketOptionsChainData } from "@/lib/api";
import { OptionContractCell } from "./OptionContractCell";

function strikeKey(strike: number): string {
  return strike.toFixed(2);
}

export function StrikeRow({
  underlyingConid,
  expiration,
  strike,
  chainData,
  loading,
  onLoad,
  onSelect,
}: {
  underlyingConid: number;
  expiration: string;
  strike: number;
  chainData: MoonMarketOptionsChainData;
  loading: boolean;
  onLoad: (args: { underlyingConid: number; expiration: string; strike: number }) => void;
  onSelect: (option: MoonMarketOptionContract) => void;
}) {
  const rowKey = strikeKey(strike);
  const contracts = chainData[rowKey];
  const hasData = Boolean(contracts?.call || contracts?.put);

  if (!hasData) {
    return (
      <button
        type="button"
        aria-label={`Load strike ${strike}`}
        disabled={loading}
        onClick={() => onLoad({ underlyingConid, expiration, strike })}
        className="grid min-h-16 w-full grid-cols-[1fr_92px_1fr] items-center gap-2 border-b border-border px-2 py-2 text-[12px] text-[var(--text-3)] hover:bg-[var(--bg-2)] disabled:opacity-60"
      >
        <div className="h-8 rounded border border-dashed border-border bg-[var(--bg-1)]/60" />
        <div className="rounded-md border border-border bg-[var(--bg-2)] py-1 text-center font-data text-[12px] text-[var(--text-1)]">
          {strike.toFixed(2)}
        </div>
        <div className="h-8 rounded border border-dashed border-border bg-[var(--bg-1)]/60" />
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
