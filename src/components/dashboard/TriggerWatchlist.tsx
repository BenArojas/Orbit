/**
 * Dynamic Trigger Watchlists — Task 3.6
 *
 * Shows stocks that have been flagged by trigger rules.
 * Each item has a glowing left-edge indicator colored by the trigger type:
 *   - EMA triggers = cyan
 *   - RSI triggers = purple
 *   - Volume triggers = orange
 *   - Fibonacci triggers = green
 *
 * Data comes from the backend /triggers/hits endpoint.
 * Items are grouped by trigger type and show: symbol, company name,
 * trigger tag, price, and change %.
 *
 * Clicking an item navigates to the Analysis page for that stock.
 */

import { useQuery } from "@tanstack/react-query";
import { api, type TriggerHit } from "@/lib/api";
import { useNavigationStore } from "@/store";

/** Map indicator names to display info */
const TRIGGER_DISPLAY: Record<
  string,
  { label: string; edgeClass: string; badgeClass: string }
> = {
  ema_9: { label: "EMA 9", edgeClass: "trigger-edge-cyan", badgeClass: "badge-cyan" },
  ema_21: { label: "EMA 21", edgeClass: "trigger-edge-cyan", badgeClass: "badge-cyan" },
  ema_50: { label: "EMA 50", edgeClass: "trigger-edge-cyan", badgeClass: "badge-cyan" },
  ema_200: { label: "EMA 200", edgeClass: "trigger-edge-cyan", badgeClass: "badge-cyan" },
  rsi: { label: "RSI", edgeClass: "trigger-edge-purple", badgeClass: "badge-purple" },
  macd: { label: "MACD", edgeClass: "trigger-edge-purple", badgeClass: "badge-purple" },
  stoch: { label: "Stoch", edgeClass: "trigger-edge-purple", badgeClass: "badge-purple" },
  volume: { label: "Vol", edgeClass: "trigger-edge-orange", badgeClass: "badge-orange" },
  obv: { label: "OBV", edgeClass: "trigger-edge-orange", badgeClass: "badge-orange" },
  fibonacci: { label: "Fib", edgeClass: "trigger-edge-green", badgeClass: "badge-green" },
  bbands: { label: "BB", edgeClass: "trigger-edge-purple", badgeClass: "badge-purple" },
  adx: { label: "ADX", edgeClass: "trigger-edge-cyan", badgeClass: "badge-cyan" },
  atr: { label: "ATR", edgeClass: "trigger-edge-orange", badgeClass: "badge-orange" },
  vwap: { label: "VWAP", edgeClass: "trigger-edge-cyan", badgeClass: "badge-cyan" },
};

function getDisplay(indicator: string) {
  return (
    TRIGGER_DISPLAY[indicator] ?? {
      label: indicator.toUpperCase(),
      edgeClass: "trigger-edge-cyan",
      badgeClass: "badge-cyan",
    }
  );
}

/** Format the condition for display */
function formatCondition(condition: string): string {
  const map: Record<string, string> = {
    above: "\u2191",          // ↑
    below: "\u2193",          // ↓
    crosses_above: "\u2191",  // ↑
    crosses_below: "\u2193",  // ↓
  };
  return map[condition] ?? "";
}

/** Single trigger hit item */
function TriggerHitItem({ hit }: { hit: TriggerHit }) {
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);
  const display = getDisplay(hit.indicator);

  return (
    <button
      onClick={() => navigateToAnalysis(hit.conid)}
      className={`trigger-edge ${display.edgeClass} grid w-full grid-cols-[1fr_50px_52px] items-center gap-1 px-3.5 py-[7px] text-left transition-colors hover:bg-[var(--bg-3)]`}
    >
      {/* Symbol + name + trigger tag */}
      <div className="min-w-0">
        <div className="truncate font-data text-[11px] font-semibold text-[var(--text-1)]">
          {hit.symbol}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[9px] text-[var(--text-3)]">
            {hit.indicator}
          </span>
          <span
            className={`rounded-sm px-1 py-px text-[7px] font-bold ${display.badgeClass}`}
          >
            {display.label} {formatCondition(hit.condition)}
          </span>
        </div>
      </div>

      {/* Actual value when triggered */}
      <div className="font-data text-right text-[11px] text-[var(--text-1)]">
        {Number.isFinite(hit.actual_value) ? hit.actual_value.toFixed(1) : "—"}
      </div>

      {/* Threshold */}
      <div className="font-data text-right text-[10px] text-[var(--text-3)]">
        {hit.condition} {hit.threshold}
      </div>
    </button>
  );
}

/** The trigger watchlist section in the sidebar */
export default function TriggerWatchlist() {
  // limit=200 matches all other consumers — TanStack Query deduplicates to one request.
  // Slice client-side to cap the sidebar display.
  const { data: hits, isLoading, isError } = useQuery<TriggerHit[]>({
    queryKey: ["trigger-hits"],
    queryFn: () => api.getTriggerHits(200),
    refetchInterval: 30_000,
  });

  // Only show unacknowledged / recent hits (cap sidebar at 50)
  const activeHits = (hits?.filter((h) => !h.moved_back) ?? []).slice(0, 50);

  return (
    <div className="flex flex-col">
      {/* Section header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-[var(--bg-1)]/80 px-3.5 py-2 backdrop-blur">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Trigger Hits
        </span>
        <span className="rounded-full bg-[var(--bg-3)] px-1.5 py-0.5 font-data text-[9px] text-[var(--text-3)]">
          {activeHits.length}
        </span>
      </div>

      {/* Items */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <span className="text-[10px] text-[var(--text-3)]">Loading...</span>
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-6">
          <span className="text-[10px] text-[var(--clr-red)]">Failed to load hits</span>
        </div>
      ) : activeHits.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <span className="text-[10px] text-[var(--text-3)]">
            No active trigger hits
          </span>
        </div>
      ) : (
        <div className="flex flex-col">
          {activeHits.map((hit) => (
            <TriggerHitItem key={hit.id} hit={hit} />
          ))}
        </div>
      )}
    </div>
  );
}
