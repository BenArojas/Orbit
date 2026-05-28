import type { Dispatch, SetStateAction } from "react";
import type { MoonMarketOptionContract, MoonMarketOptionsChainData } from "@/lib/api";
import { useLazyOptionStrike } from "./useOptionsChain";
import { StrikeRow } from "./StrikeRow";

export function OptionsChainTable({
  title,
  underlyingConid,
  expirations,
  selectedExpiration,
  onExpirationChange,
  allStrikes,
  chainData,
  setChainData,
  loading,
  error,
  onSelect,
}: {
  title: string;
  underlyingConid: number;
  expirations: string[];
  selectedExpiration: string | null;
  onExpirationChange: (expiration: string) => void;
  allStrikes: number[];
  chainData: MoonMarketOptionsChainData;
  setChainData: Dispatch<SetStateAction<MoonMarketOptionsChainData>>;
  loading: boolean;
  error: unknown;
  onSelect: (option: MoonMarketOptionContract) => void;
}) {
  const lazyStrike = useLazyOptionStrike((next) => {
    setChainData((current) => ({ ...current, ...next }));
  });

  return (
    <section className="min-h-0 rounded-md border border-border bg-[var(--bg-2)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[16px] font-semibold">{title} Options</h2>
          <p className="text-[11px] text-[var(--text-3)]">Underlying #{underlyingConid}</p>
        </div>
        <label className="text-[11px] text-[var(--text-3)]">
          Expiration
          <select
            aria-label="Expiration"
            value={selectedExpiration ?? ""}
            disabled={!expirations.length}
            onChange={(event) => onExpirationChange(event.target.value)}
            className="ml-2 h-8 min-w-32 rounded-md border border-border bg-[var(--bg-1)] px-2 text-[12px] text-[var(--text-1)]"
          >
            {expirations.map((expiration) => (
              <option key={expiration} value={expiration}>
                {expiration}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="grid grid-cols-[1fr_92px_1fr] gap-2 border-b border-border px-2 py-2 text-center text-[10px] uppercase text-[var(--text-3)]">
        <div className="grid grid-cols-6 gap-2">
          <span>Delta</span>
          <span>Bid Sz</span>
          <span>Ask Sz</span>
          <span>Last</span>
          <span>Ask</span>
          <span>Bid</span>
        </div>
        <span>Strike</span>
        <div className="grid grid-cols-6 gap-2">
          <span>Delta</span>
          <span>Bid Sz</span>
          <span>Ask Sz</span>
          <span>Last</span>
          <span>Ask</span>
          <span>Bid</span>
        </div>
      </div>

      {error ? (
        <div className="p-4 text-[12px] text-[var(--clr-red)]">Options chain is unavailable.</div>
      ) : loading ? (
        <div className="p-4 text-[12px] text-[var(--text-3)]">Loading chain data...</div>
      ) : allStrikes.length ? (
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
          {allStrikes.map((strike) => (
            <StrikeRow
              key={strike}
              underlyingConid={underlyingConid}
              expiration={selectedExpiration ?? ""}
              strike={strike}
              chainData={chainData}
              loading={lazyStrike.isPending && lazyStrike.variables?.strike === strike}
              onLoad={lazyStrike.mutate}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <div className="p-4 text-[12px] text-[var(--text-3)]">No strikes available for this expiration.</div>
      )}
    </section>
  );
}
