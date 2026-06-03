import { Search, X } from "lucide-react";
import type { InflectSymbol } from "./types";

export function SymbolSearch({
  query,
  selectedConid,
  symbols,
  onQueryChange,
  onSymbolChange,
  onClear,
}: {
  query: string;
  selectedConid: number | null;
  symbols: InflectSymbol[];
  onQueryChange: (value: string) => void;
  onSymbolChange: (value: number | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative block">
        <span className="sr-only">Search trades</span>
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-3)]"
          strokeWidth={1.8}
        />
        <input
          aria-label="Search trades"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Ticker"
          className="h-8 w-[150px] rounded-md border border-border bg-[var(--bg-2)] pl-7 pr-2 text-[12px] text-[var(--text-1)] placeholder:text-[var(--text-3)]"
        />
      </label>

      <label>
        <span className="sr-only">Symbol list</span>
        <select
          aria-label="Symbol list"
          value={selectedConid ?? ""}
          onChange={(event) =>
            onSymbolChange(event.target.value ? Number(event.target.value) : null)
          }
          className="h-8 min-w-[130px] rounded-md border border-border bg-[var(--bg-2)] px-2 text-[12px] text-[var(--text-1)]"
        >
          <option value="">All tickers</option>
          {symbols.map((item) => (
            <option key={item.conid} value={item.conid}>
              {item.symbol}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        aria-label="Clear filters"
        onClick={onClear}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-[var(--text-3)] hover:text-[var(--text-1)]"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </div>
  );
}

