/**
 * Market Pulse Bar — Phase 8 / Task 3.1 (bundled endpoints)
 *
 * Horizontal bar at the top of the Dashboard showing key market instruments.
 * Each item is clickable → navigates to Analysis for that conid.
 *
 * Phase 8 / Task 3.1 changes (bundled endpoints):
 *   - Conid resolution: one useQuery per ticker via useQueries (no stagger
 *     needed — SQLite cache makes these near-instant on second+ run).
 *   - Quotes: single parent-level useQuery → GET /market/quotes?conids=...
 *   - Candles: single parent-level useQuery → GET /market/candles?conids=...
 *   - PulseItem is now a pure display component — it owns no queries.
 *   - HAR call count: 2 requests per polling cycle (down from N×2).
 *
 * Prior architecture (pre-Task-3.1):
 *   13 tickers × (1 quote + 1 candle) = 26 per-ticker fetches per cycle.
 *   Each fired independently and competed for the same IBKR pacing budget.
 *
 * Data flow:
 *   useQueries([conid resolvers]) → knownConids
 *   useQuery(["quotes-bundled", conidsKey])  → quoteByConid map
 *   useQuery(["candles-bundled", conidsKey]) → candlesByConid map
 *   PulseItem receives its slice by conid (no network calls of its own)
 */

import { useQuery, useQueries } from "@tanstack/react-query";
import {
  api,
  type QuoteResponse,
  type CandleData,
  type ConidResponse,
} from "@/lib/api";
import { useNavigationStore, usePulseConfigStore } from "@/store";
import { useIbkrReady } from "@/context/GatewayContext";
import { useIbkrReadyTier } from "@/hooks/useIbkrReadyTier";
import { Pulse } from "./skeletons";

// ── Sparkline ────────────────────────────────────────────────

/** Mini sparkline — up to 12 tiny bars showing recent closes. */
function MiniSparkline({ candles, isUp }: { candles: CandleData[]; isUp: boolean }) {
  const bars = candles.slice(-12);
  if (bars.length === 0) return null;

  const closes = bars.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  return (
    <div
      className="flex items-end gap-px"
      style={{ height: 16 }}
      title="Last 12 daily closes (5-day window) — higher bars = higher price"
    >
      {bars.map((bar, i) => {
        const height = Math.max(2, ((bar.close - min) / range) * 14);
        return (
          <div
            key={i}
            className="w-[2px] rounded-sm"
            style={{
              height,
              backgroundColor: isUp ? "var(--clr-green)" : "var(--clr-red)",
              opacity: 0.45,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Per-ticker skeleton ──────────────────────────────────────

function PulseItemSkeleton({ label }: { label: string }) {
  return (
    <div className="flex min-w-[115px] flex-col gap-1 px-[18px] py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-[var(--text-3)]">
          {label}
        </span>
        <Pulse className="h-3 w-[44px]" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Pulse className="h-2 w-[36px]" />
        <Pulse className="h-[14px] w-[28px]" />
      </div>
    </div>
  );
}

// ── Pulse Item (pure display) ────────────────────────────────

/**
 * Pure display component — receives its data slices from the parent.
 * No network calls; conid resolution and data fetching happen in MarketPulse.
 */
function PulseItem({
  label,
  conid,
  quote,
  candles,
  loaded,
}: {
  label: string;
  conid: number | undefined;
  quote: QuoteResponse | undefined;
  candles: CandleData[] | undefined;
  /** True once the bundled quote response has arrived for the first time. */
  loaded: boolean;
}) {
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);

  // Show skeleton until we have at least a conid and the first quote fetch landed.
  if (!loaded || !conid) {
    return <PulseItemSkeleton label={label} />;
  }

  const price = quote?.lastPrice;
  const changePct = quote?.changePercent;
  const isUp = (changePct ?? 0) >= 0;

  return (
    <button
      onClick={() => navigateToAnalysis(conid, quote?.symbol || label)}
      className="group relative flex min-w-[115px] flex-col gap-0.5 px-[18px] py-2 transition-colors hover:bg-[var(--bg-2)]"
    >
      {/* Glow underline on hover */}
      <div
        className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          backgroundColor: isUp ? "var(--clr-green)" : "var(--clr-red)",
          boxShadow: `0 0 8px ${isUp ? "var(--clr-green)" : "var(--clr-red)"}`,
        }}
      />

      {/* Top row: label + price */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-[var(--text-3)]">
          {label}
        </span>
        <span className="font-data text-[13px] font-bold text-[var(--text-1)]">
          {price != null ? formatPrice(price) : "--"}
        </span>
      </div>

      {/* Bottom row: change % + sparkline */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`font-data text-[10px] ${isUp ? "text-up" : "text-down"}`}
        >
          {changePct != null
            ? `${isUp ? "+" : ""}${changePct.toFixed(2)}%`
            : "--"}
        </span>
        {candles && <MiniSparkline candles={candles} isUp={isUp} />}
      </div>
    </button>
  );
}

/** Format price — comma thousands, 2 decimals under 1k. */
function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  return price.toFixed(2);
}

// ── Main bar ─────────────────────────────────────────────────

export default function MarketPulse() {
  const ibkrReady = useIbkrReady();
  // Tier 1 in the dashboard cascade — fires at t=0 as soon as IBKR connects.
  const tierReady = useIbkrReadyTier(1);
  const gate = ibkrReady && tierReady;

  // User-configurable ticker list. Pre-populates with DEFAULT_PULSE_ITEMS
  // before the backend GET resolves so the bar never flashes empty on first render.
  const items = usePulseConfigStore((s) => s.items);

  // ── Step 1: resolve all conids in parallel ─────────────────
  //
  // useQueries handles a dynamic-length array of queries without breaking
  // the rules of hooks. staleTime: Infinity — conids never change once
  // cached in SQLite (Task 1.5). On warm sessions these are all instant.
  const conidQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ["conid", item.resolve, item.sec_type ?? ""] as const,
      queryFn: (): Promise<ConidResponse> =>
        api.resolveConid(item.resolve, item.sec_type),
      staleTime: Infinity,
      enabled: gate,
    })),
  });

  // Ordered by items index — undefined while resolving.
  const resolvedConids: (number | undefined)[] = conidQueries.map(
    (q) => q.data?.conid,
  );
  const knownConids = resolvedConids.filter((c): c is number => c != null);
  const allResolved = items.length > 0 && knownConids.length === items.length;

  // Stable sort key — must not change once all conids are known to avoid
  // spurious bundled-query re-fetches.
  const sortedConidsKey = [...knownConids].sort((a, b) => a - b).join(",");

  // ── Step 2: one bundled quote fetch for the whole bar ───────
  //
  // Enabled only when ALL conids are resolved so the key is stable and
  // we issue exactly 1 request per polling cycle rather than N partial ones.
  const { data: quotesData } = useQuery({
    queryKey: ["quotes-bundled", sortedConidsKey],
    queryFn: () => api.quotesBundled(knownConids),
    enabled: gate && allResolved,
    // Quotes refresh every 10s (same cadence as the old per-ticker queries).
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  // ── Step 3: one bundled candle fetch for the whole bar ──────
  //
  // Phase 8 / Task 3.3 — defer candles until quotes have settled.
  // Quotes paint the bar first; candles (sparklines) fetch only after the
  // first quote response arrives. This removes one tier of contention
  // during cold start — the two expensive IBKR fan-outs no longer race.
  const { data: candlesData } = useQuery({
    queryKey: ["candles-bundled", sortedConidsKey, "5D"],
    queryFn: () => api.candlesBundled(knownConids, "5D"),
    enabled: gate && allResolved && quotesData != null,
    // Candles are daily bars — 60s stale time matches the old per-ticker value.
    staleTime: 60_000,
  });

  // ── Step 4: build lookup maps for O(1) slice access ─────────
  const quoteByConid = new Map(
    (quotesData?.items ?? []).map((q) => [q.conid, q]),
  );
  const candlesByConid = new Map(
    (candlesData?.items ?? []).map((c) => [c.conid, c.candles]),
  );

  // Quotes are considered "loaded" once the first response arrives.
  // Before that, all items show skeletons so the bar doesn't paint partially.
  const quotesLoaded = quotesData != null;

  // ── Render ───────────────────────────────────────────────────

  if (items.length === 0) {
    return <div className="col-span-2 border-b border-border bg-[var(--bg-1)]" />;
  }

  return (
    <div className="col-span-2 flex items-center justify-center overflow-x-auto scrollbar-hidden border-b border-border bg-[var(--bg-1)] px-2 py-1">
      {items.map((item, i) => {
        const conid = resolvedConids[i];
        return (
          <PulseItem
            key={item.label}
            label={item.label}
            conid={conid}
            quote={conid != null ? quoteByConid.get(conid) : undefined}
            candles={conid != null ? candlesByConid.get(conid) : undefined}
            loaded={quotesLoaded && conid != null}
          />
        );
      })}
    </div>
  );
}
