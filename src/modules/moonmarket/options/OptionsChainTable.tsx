import { useMemo } from "react";
import type { MoonMarketOptionContract } from "@/lib/api";
import { StrikeRow } from "./StrikeRow";
import { useOptionWindow } from "./useOptionsChain";

function strikeKey(strike: number): string {
  return strike.toFixed(2);
}

const AUTO_LOAD_STRIKE_COUNT = 6;

function formatPrice(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "--";
}

export function selectStrikesAroundPrice(strikes: number[], price: number | null | undefined, count: number): Set<number> {
  if (!strikes.length || count <= 0) {
    return new Set();
  }
  if (typeof price !== "number" || !Number.isFinite(price)) {
    return new Set(strikes.slice(0, count));
  }

  const upperIndex = strikes.findIndex((strike) => strike >= price);
  // When the spot is not exactly on a strike, bias the centre to the upper
  // (at-or-above-spot) strike so the auto-load window leans toward the money.
  const nearestIndex = upperIndex === -1 ? strikes.length - 1 : upperIndex;
  const maxStart = Math.max(0, strikes.length - count);
  const start = Math.min(Math.max(0, nearestIndex - Math.floor(count / 2)), maxStart);
  return new Set(strikes.slice(start, start + count));
}

export function OptionsChainTable({
  title,
  underlyingConid,
  expirations,
  selectedExpiration,
  onExpirationChange,
  allStrikes,
  underlyingPrice,
  underlyingPriceLoading,
  underlyingPriceError,
  onRetryQuote,
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
  underlyingPrice: number | null | undefined;
  underlyingPriceLoading: boolean;
  underlyingPriceError?: boolean;
  onRetryQuote?: () => void;
  loading: boolean;
  error: unknown;
  onSelect: (option: MoonMarketOptionContract) => void;
}) {
  // Memoize the auto-load window so we don't recompute the Set (and hand a fresh
  // reference to every StrikeRow) on unrelated re-renders; recompute only when an
  // input that actually changes the window changes.
  const autoLoadStrikes = useMemo(
    () =>
      underlyingPriceLoading || underlyingPriceError
        ? new Set<number>()
        : selectStrikesAroundPrice(allStrikes, underlyingPrice, AUTO_LOAD_STRIKE_COUNT),
    [allStrikes, underlyingPrice, underlyingPriceLoading, underlyingPriceError],
  );

  // Fire ONE bundled window request for the auto-load strikes (server-side paced)
  // instead of one request per strike. The no-spot gate above keeps this empty —
  // and therefore disabled — until the underlying spot price is known.
  const windowStrikes = [...autoLoadStrikes];
  const windowQuery = useOptionWindow(underlyingConid, selectedExpiration, windowStrikes);
  const preloadedByStrike = windowQuery.data?.strikes ?? {};

  return (
    <section className="min-h-0 rounded-md border border-border bg-[var(--bg-2)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[16px] font-semibold">{title} Options</h2>
          <p className="text-[11px] text-[var(--text-3)]">
            Underlying #{underlyingConid} · Last {underlyingPriceLoading ? "loading" : formatPrice(underlyingPrice)}
          </p>
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
      ) : underlyingPriceError ? (
        <div className="p-4 text-[12px] text-[var(--clr-orange)]">
          Couldn't determine spot price — pick a strike to load, or
          <button type="button" onClick={() => onRetryQuote?.()} className="ml-1 underline">
            retry
          </button>
          .
        </div>
      ) : allStrikes.length ? (
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
          {allStrikes.map((strike) => (
            <StrikeRow
              key={`${selectedExpiration ?? "none"}-${strike}`}
              underlyingConid={underlyingConid}
              expiration={selectedExpiration ?? ""}
              strike={strike}
              preloaded={preloadedByStrike[strikeKey(strike)]}
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
