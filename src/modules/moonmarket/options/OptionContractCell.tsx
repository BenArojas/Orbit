import type { MoonMarketOptionContract } from "@/modules/moonmarket/api";

function formatNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";
}

export function OptionContractCell({
  contract,
  side,
  onSelect,
}: {
  contract?: MoonMarketOptionContract;
  side: "call" | "put";
  onSelect: () => void;
}) {
  if (!contract) {
    return <div className="h-16 rounded border border-dashed border-border bg-[var(--bg-1)]/60" />;
  }

  return (
    <button
      type="button"
      aria-label={`Select ${side} ${contract.strike}`}
      onClick={onSelect}
      className="grid w-full grid-cols-6 gap-2 rounded border border-border bg-[var(--bg-1)] px-2 py-2 text-left text-[11px] transition-colors hover:border-[var(--clr-cyan)] hover:bg-[var(--clr-cyan)]/5"
    >
      <span className="font-data text-[var(--text-2)]">{formatNumber(contract.delta)}</span>
      <span className="font-data text-[var(--text-3)]">{formatNumber(contract.bidSize, 0)}</span>
      <span className="font-data text-[var(--text-3)]">{formatNumber(contract.askSize, 0)}</span>
      <span className="font-data text-[var(--text-2)]">{formatNumber(contract.lastPrice)}</span>
      <span className="font-data text-[var(--clr-cyan)]">{formatNumber(contract.ask)}</span>
      <span className="font-data text-[var(--text-2)]">{formatNumber(contract.bid)}</span>
    </button>
  );
}
