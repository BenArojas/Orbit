/**
 * ScreenerPeekPanel — Quick-peek slide-over for screener results.
 *
 * Slides in from the right (~400px) when a row is clicked.
 * Shows: symbol/name, mini 5-day chart (placeholder), key stats,
 * and two CTAs: "Open in Analysis" + "Add to Watchlist".
 *
 * Data source: GET /screener/contract/{conid} for detailed info,
 * plus the already-loaded ScreenerResultRow for price/chg/volume.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ArrowRight, Plus, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useScreenerStore } from "@/store/screener";
import { useNavigationStore } from "@/store";
import { SlideOverSkeleton } from "./ScreenerSkeleton";
import { useIbkrReady } from "@/context/GatewayContext";

// ── Formatters ────────────────────────────────────────────────

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return v < 10 ? v.toFixed(3) : v.toFixed(2);
}

function fmtMktCap(v: number | null): string {
  // v is in $M from IBKR
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}T`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}B`;
  return `$${v.toFixed(0)}M`;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtVolume(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

// ── Stat row ──────────────────────────────────────────────────

function StatRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">
        {label}
      </span>
      <span
        className={`font-data text-[11px] font-medium ${color ?? "text-[var(--text-1)]"}`}
      >
        {value}
      </span>
    </div>
  );
}

// ── 52-Week Range Bar ─────────────────────────────────────────

function RangeBar({
  low,
  high,
  current,
}: {
  low: number | null;
  high: number | null;
  current: number | null;
}) {
  if (low == null || high == null || current == null || high <= low) {
    return null;
  }

  const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));

  return (
    <div className="flex flex-col gap-1 py-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">
        52-Week Range
      </span>
      <div className="flex items-center gap-2">
        <span className="font-data text-[10px] text-[var(--text-3)]">
          {fmtPrice(low)}
        </span>
        <div className="relative h-1.5 flex-1 rounded-full bg-[var(--bg-3)]">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-[var(--clr-cyan)]/40"
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-[var(--clr-cyan)]"
            style={{ left: `${pct}%` }}
          />
        </div>
        <span className="font-data text-[10px] text-[var(--text-3)]">
          {fmtPrice(high)}
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function ScreenerPeekPanel() {
  const peekConid = useScreenerStore((s) => s.peekConid);
  const setPeekConid = useScreenerStore((s) => s.setPeekConid);
  const results = useScreenerStore((s) => s.results);
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);

  // Find the row in existing results for quick data
  const row = results.find((r) => r.conid === peekConid);

  const ibkrReady = useIbkrReady();

  // Fetch full contract details
  const { data: contract, isLoading } = useQuery({
    queryKey: ["contract-info", peekConid],
    queryFn: () => api.screenerContractInfo(peekConid!),
    enabled: ibkrReady && !!peekConid,
    staleTime: 60_000 * 30, // 30 min — contract details don't change
  });

  // Close on Escape
  useEffect(() => {
    if (!peekConid) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPeekConid(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [peekConid, setPeekConid]);

  if (!peekConid) return null;

  const isOpen = !!peekConid;
  const chgColor =
    (row?.change_percent ?? 0) > 0
      ? "text-[var(--clr-green)]"
      : (row?.change_percent ?? 0) < 0
        ? "text-[var(--clr-red)]"
        : "text-[var(--text-2)]";

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setPeekConid(null)}
      />

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-[400px] flex-col border-l border-[var(--border)] bg-[var(--bg-1)] shadow-2xl transition-transform duration-200 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-data text-lg font-bold text-[var(--text-1)]">
              {row?.symbol || contract?.symbol || "—"}
            </span>
            {row?.sec_type && (
              <span className="rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--text-3)]">
                {row.sec_type}
              </span>
            )}
          </div>
          <button
            onClick={() => setPeekConid(null)}
            className="rounded p-1 text-[var(--text-3)] transition-colors hover:bg-[var(--bg-3)] hover:text-[var(--text-1)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <SlideOverSkeleton />
          ) : (
            <div className="flex flex-col gap-3 p-4">
              {/* Company name */}
              <p className="text-[12px] text-[var(--text-3)]">
                {row?.company_name || contract?.company_name || ""}
              </p>

              {/* Price block */}
              <div className="flex items-baseline gap-3">
                <span className="font-data text-2xl font-bold text-[var(--text-1)]">
                  {fmtPrice(row?.last_price ?? null)}
                </span>
                <span className={`font-data text-sm font-medium ${chgColor}`}>
                  {fmtPct(row?.change_percent ?? null)}
                </span>
                {(row?.change_percent ?? 0) > 0 ? (
                  <TrendingUp size={14} className="text-[var(--clr-green)]" />
                ) : (row?.change_percent ?? 0) < 0 ? (
                  <TrendingDown size={14} className="text-[var(--clr-red)]" />
                ) : null}
              </div>

              {/* Divider */}
              <div className="h-px bg-[var(--border)]" />

              {/* Key stats */}
              <div className="flex flex-col">
                <StatRow label="Market Cap" value={fmtMktCap(row?.market_cap ?? contract?.market_cap ?? null)} />
                <StatRow label="Volume" value={fmtVolume(row?.volume ?? null)} />
                {contract?.avg_volume != null && (
                  <StatRow label="Avg Volume" value={fmtVolume(contract.avg_volume)} />
                )}
                {contract?.pe_ratio != null && (
                  <StatRow label="P/E Ratio" value={contract.pe_ratio.toFixed(1)} />
                )}
                {contract?.dividend_yield != null && (
                  <StatRow label="Div Yield" value={`${contract.dividend_yield.toFixed(2)}%`} />
                )}
                {contract?.exchange && (
                  <StatRow label="Exchange" value={contract.exchange} />
                )}
                {contract?.currency && (
                  <StatRow label="Currency" value={contract.currency} />
                )}
                {contract?.industry && (
                  <StatRow label="Industry" value={contract.industry} />
                )}
                {contract?.category && (
                  <StatRow label="Category" value={contract.category} />
                )}
              </div>

              {/* 52-Week range */}
              <RangeBar
                low={contract?.low_52w ?? null}
                high={contract?.high_52w ?? null}
                current={row?.last_price ?? null}
              />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 border-t border-border p-4">
          <Button
            className="flex-1 gap-1.5 border-[var(--clr-cyan)]/30 bg-[var(--clr-cyan)]/15 text-[var(--clr-cyan)] hover:bg-[var(--clr-cyan)]/25"
            onClick={() => {
              navigateToAnalysis(peekConid);
              setPeekConid(null);
            }}
          >
            <ArrowRight size={14} />
            Open in Analysis
          </Button>
          <Button
            variant="outline"
            className="flex-1 gap-1.5 border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)]"
            onClick={() => {
              // TODO: wire to watchlist add action
              setPeekConid(null);
            }}
          >
            <Plus size={14} />
            Add to Watchlist
          </Button>
        </div>
      </div>
    </>
  );
}
