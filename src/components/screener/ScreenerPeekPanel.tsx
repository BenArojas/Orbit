/**
 * ScreenerPeekPanel — Quick-peek slide-over for screener results.
 *
 * Slides in from the right (~400px) when a row is clicked.
 * Shows: symbol/name, price/change, key stats, enhanced 52W section,
 * relative performance table, and two CTAs.
 *
 * No charts, no live-quote polling — user re-scans for fresh data.
 *
 * Data source:
 *   - ScreenerResultRow (already loaded): price, change%, volume, mkt cap
 *   - GET /screener/contract/{conid}: sector, industry, P/E, div yield,
 *     52W high/low, perf_5d/1m/3m/ytd, w52_pct_from_high/low/days_since_high
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

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return v < 10 ? v.toFixed(3) : v.toFixed(2);
}

function fmtMktCap(v: number | null | undefined): string {
  // v is in $M from IBKR
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}T`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}B`;
  return `$${v.toFixed(0)}M`;
}

function fmtPct(v: number | null | undefined, sign = true): string {
  if (v == null) return "—";
  return `${sign && v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtVolume(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

// ── Helpers ───────────────────────────────────────────────────

function perfColor(v: number | null | undefined): string {
  if (v == null) return "text-[var(--text-2)]";
  return v > 0 ? "text-[var(--clr-green)]" : v < 0 ? "text-[var(--clr-red)]" : "text-[var(--text-2)]";
}

// ── Sub-components ────────────────────────────────────────────

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
    <div className="flex items-center justify-between py-[3px]">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">
        {label}
      </span>
      <span className={`font-data text-[11px] font-medium ${color ?? "text-[var(--text-1)]"}`}>
        {value}
      </span>
    </div>
  );
}

/** Enhanced 52-week positioning — bar + pct from high/low + days since high. */
function W52Section({
  low,
  high,
  current,
  pctFromHigh,
  pctFromLow,
  daysSinceHigh,
}: {
  low: number | null | undefined;
  high: number | null | undefined;
  current: number | null | undefined;
  pctFromHigh: number | null | undefined;
  pctFromLow: number | null | undefined;
  daysSinceHigh: number | null | undefined;
}) {
  const hasBar = low != null && high != null && current != null && high > low;
  const pct = hasBar
    ? Math.max(0, Math.min(100, ((current! - low!) / (high! - low!)) * 100))
    : 50;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">
        52-Week Range
      </span>

      {/* Bar */}
      {hasBar && (
        <div className="flex items-center gap-2">
          <span className="font-data text-[10px] text-[var(--text-3)]">
            {fmtPrice(low)}
          </span>
          <div className="relative h-1.5 flex-1 rounded-full bg-[var(--bg-3)]">
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-[var(--clr-cyan)]/30"
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
      )}

      {/* Positioning metrics */}
      <div className="flex gap-3">
        {pctFromHigh != null && (
          <div className="flex flex-col">
            <span className="text-[9px] uppercase tracking-wide text-[var(--text-3)]">
              From High
            </span>
            <span className={`font-data text-[11px] font-medium ${perfColor(pctFromHigh)}`}>
              {fmtPct(pctFromHigh)}
            </span>
          </div>
        )}
        {pctFromLow != null && (
          <div className="flex flex-col">
            <span className="text-[9px] uppercase tracking-wide text-[var(--text-3)]">
              From Low
            </span>
            <span className={`font-data text-[11px] font-medium ${perfColor(pctFromLow)}`}>
              {fmtPct(pctFromLow)}
            </span>
          </div>
        )}
        {daysSinceHigh != null && (
          <div className="flex flex-col">
            <span className="text-[9px] uppercase tracking-wide text-[var(--text-3)]">
              Days from High
            </span>
            <span className="font-data text-[11px] font-medium text-[var(--text-2)]">
              {daysSinceHigh}d
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Relative performance table — 5D / 1M / 3M / YTD. */
function PerfTable({
  perf5d,
  perf1m,
  perf3m,
  perfYtd,
}: {
  perf5d: number | null | undefined;
  perf1m: number | null | undefined;
  perf3m: number | null | undefined;
  perfYtd: number | null | undefined;
}) {
  const cols: { label: string; value: number | null | undefined }[] = [
    { label: "5D", value: perf5d },
    { label: "1M", value: perf1m },
    { label: "3M", value: perf3m },
    { label: "YTD", value: perfYtd },
  ];

  const hasAny = cols.some((c) => c.value != null);
  if (!hasAny) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">
        Relative Performance
      </span>
      <div className="grid grid-cols-4 gap-1">
        {cols.map(({ label, value }) => (
          <div
            key={label}
            className="flex flex-col items-center rounded bg-[var(--bg-2)] px-1.5 py-1.5"
          >
            <span className="text-[9px] uppercase tracking-wide text-[var(--text-3)]">
              {label}
            </span>
            <span className={`font-data text-[11px] font-semibold ${perfColor(value)}`}>
              {fmtPct(value)}
            </span>
          </div>
        ))}
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

  // Find the row in existing results for live price data (from last scan)
  const row = results.find((r) => r.conid === peekConid);

  const ibkrReady = useIbkrReady();

  // Fetch full contract details + enrichment
  const { data: contract, isLoading } = useQuery({
    queryKey: ["contract-info", peekConid],
    queryFn: () => api.screenerContractInfo(peekConid!),
    enabled: ibkrReady && !!peekConid,
    staleTime: 60_000 * 30, // 30 min — static details + computed history don't drift fast
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
        className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-200"
        onClick={() => setPeekConid(null)}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-[400px] flex-col border-l border-[var(--border)] bg-[var(--bg-1)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
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
            <div className="flex flex-col gap-4 p-4">
              {/* Company name */}
              <p className="text-[11px] leading-tight text-[var(--text-3)]">
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

              {/* Key stats */}
              <div className="flex flex-col divide-y divide-[var(--border)]">
                <StatRow
                  label="Market Cap"
                  value={fmtMktCap(row?.market_cap ?? contract?.market_cap)}
                />
                <StatRow
                  label="Volume"
                  value={fmtVolume(row?.volume)}
                />
                {(contract?.sector || contract?.category) && (
                  <StatRow
                    label="Sector"
                    value={contract.sector || contract.category || "—"}
                  />
                )}
                {contract?.industry && (
                  <StatRow label="Industry" value={contract.industry} />
                )}
                {contract?.pe_ratio != null && (
                  <StatRow label="P/E Ratio" value={contract.pe_ratio.toFixed(1)} />
                )}
                {contract?.dividend_yield != null && (
                  <StatRow
                    label="Div Yield"
                    value={`${contract.dividend_yield.toFixed(2)}%`}
                  />
                )}
              </div>

              {/* 52-Week enhanced section */}
              {(contract?.high_52w != null || contract?.w52_pct_from_high != null) && (
                <>
                  <div className="h-px bg-[var(--border)]" />
                  <W52Section
                    low={contract?.low_52w}
                    high={contract?.high_52w}
                    current={row?.last_price}
                    pctFromHigh={contract?.w52_pct_from_high}
                    pctFromLow={contract?.w52_pct_from_low}
                    daysSinceHigh={contract?.w52_days_since_high}
                  />
                </>
              )}

              {/* Relative performance */}
              {(contract?.perf_5d != null ||
                contract?.perf_1m != null ||
                contract?.perf_3m != null ||
                contract?.perf_ytd != null) && (
                <>
                  <div className="h-px bg-[var(--border)]" />
                  <PerfTable
                    perf5d={contract?.perf_5d}
                    perf1m={contract?.perf_1m}
                    perf3m={contract?.perf_3m}
                    perfYtd={contract?.perf_ytd}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 border-t border-[var(--border)] p-4">
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
