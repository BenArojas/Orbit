/**
 * Market Pulse Bar
 *
 * Horizontal bar at the top of the Dashboard showing key market instruments.
 * Each item is clickable → navigates to Analysis for that conid.
 *
 * Live-data architecture:
 *   - One bundled snapshot fetch on first ready provides initial values
 *     (last, changePct, etc.) so the bar paints without waiting for ticks.
 *   - useLiveQuotes subscribes to every resolved conid via the existing
 *     WebSocket singleton. Each incoming market_data message updates one
 *     entry in a Map<conid, LiveTick>.
 *   - The render merges: liveTick overrides snapshot when present.
 *
 * Previous architecture (Phase 8 / Task 3.1) polled quotesBundled every
 * 10s and fetched a daily candle bundle for tiny sparklines. Both were
 * dropped — polling is replaced by WS live ticks, and the sparkline added
 * noise + traffic without much analytical value.
 */

import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  type QuoteResponse,
} from "@/modules/parallax/api";

import {
  parallaxApi,
  type ConidResponse,
} from "@/modules/parallax/api";
import { useNavigationStore, usePulseConfigStore } from "@/store";
import { useIbkrReady } from "@/context/GatewayContext";
import { useIbkrReadyTier } from "@/hooks/useIbkrReadyTier";
import { useLiveQuotes, type LiveQuoteTick } from "@/hooks/useLiveQuotes";
import { Pulse } from "./skeletons";

// ── Per-ticker skeleton ──────────────────────────────────────

function PulseItemSkeleton({ label, variant }: { label: string; variant: "today" | "market" }) {
  return (
    <div className={`flex min-w-[115px] flex-col gap-1 px-[18px] py-2 ${variant === "market" ? "border-r border-[#E6ECEE] last:border-r-0" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`${variant === "market" ? "text-[11px] text-[#59666E]" : "text-[11px] text-[var(--text-3)]"} font-semibold`}>
          {label}
        </span>
        <Pulse className="h-3 w-[44px]" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Pulse className="h-2 w-[36px]" />
      </div>
    </div>
  );
}

// ── Pulse Item (pure display) ────────────────────────────────

/**
 * Pure display component — receives its data slices from the parent.
 * No network calls; conid resolution + data fetching happen in MarketPulse.
 *
 * `liveTick` (when present) takes precedence over snapshot values so the
 * price ticks visibly without waiting for the next snapshot poll.
 */
function PulseItem({
  label,
  conid,
  quote,
  liveTick,
  loaded,
  variant,
}: {
  label: string;
  conid: number | undefined;
  quote: QuoteResponse | undefined;
  liveTick: LiveQuoteTick | undefined;
  /** True once the bundled quote response has arrived for the first time. */
  loaded: boolean;
  variant: "today" | "market";
}) {
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);

  // Show skeleton until we have at least a conid and the first quote fetch landed.
  if (!loaded || !conid) {
    return <PulseItemSkeleton label={label} variant={variant} />;
  }

  // Live tick overrides snapshot. Both can have stale fields, so we
  // resolve each field independently rather than picking a whole source.
  const price = liveTick?.last ?? quote?.lastPrice;
  const changePct = liveTick?.changePct ?? quote?.changePercent;
  const isUp = (changePct ?? 0) >= 0;
  const availability = liveTick?.availability?.[0];
  const quoteState = availability === "R" ? "Live"
    : availability === "D" || availability === "Y" ? "Delayed"
      : availability === "Z" ? "Frozen"
        : availability === "N" ? "Unavailable" : "Unconfirmed";
  const mineral = variant === "market";

  return (
    <button
      onClick={() => navigateToAnalysis(conid, quote?.symbol || label)}
      aria-label={`${label}, ${quoteState} IBKR quote`}
      className={`group relative flex min-w-[115px] flex-col gap-0.5 px-[18px] py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#436782] active:scale-[0.98] ${mineral ? "border-r border-[#E6ECEE] last:border-r-0 hover:bg-[#F1F4F5]" : "hover:bg-[var(--bg-2)]"}`}
    >
      {/* Glow underline on hover */}
      <div
        className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          backgroundColor: mineral ? (isUp ? "#2F684D" : "#923E3E") : isUp ? "var(--clr-green)" : "var(--clr-red)",
          boxShadow: mineral ? "none" : `0 0 8px ${isUp ? "var(--clr-green)" : "var(--clr-red)"}`,
        }}
      />

      {/* Top row: label + price */}
      <div className="flex items-center justify-between gap-2">
        <span className={mineral ? "text-[11px] font-semibold text-[#59666E]" : "text-[11px] font-semibold text-[var(--text-3)]"}>
          {label}
        </span>
        <span className={mineral ? "font-data text-[13px] font-bold tabular-nums text-[#25313A]" : "font-data text-[13px] font-bold tabular-nums text-[var(--text-1)]"}>
          {price != null ? formatPrice(price) : "--"}
        </span>
      </div>

      {/* Signed movement and feed availability remain distinct. */}
      <div className="flex items-center justify-between gap-2">
        <span className={`font-data text-[11px] tabular-nums ${mineral ? "" : isUp ? "text-up" : "text-down"}`} style={mineral ? { color: changePct == null ? "#59666E" : isUp ? "#2F684D" : "#923E3E" } : undefined}>
          {changePct != null
            ? `${isUp ? "+" : ""}${changePct.toFixed(2)}%`
            : "--"}
        </span>
        <span className="text-[11px]" style={{ color: quoteState === "Live" ? mineral ? "#2F684D" : "var(--clr-green)" : quoteState === "Unavailable" ? mineral ? "#59666E" : "var(--text-3)" : mineral ? "#76500B" : "var(--clr-orange)" }}>
          {quoteState}
        </span>
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

export default function MarketPulse({ variant = "today" }: { variant?: "today" | "market" }) {
  const ibkrReady = useIbkrReady();
  // Tier 1 in the dashboard cascade — fires at t=0 as soon as IBKR connects.
  const tierReady = useIbkrReadyTier(1);
  const gate = ibkrReady && tierReady;

  // User-configurable ticker list. Pre-populates with DEFAULT_PULSE_ITEMS
  // before the backend GET resolves so the bar never flashes empty on first render.
  const items = usePulseConfigStore((s) => s.items);

  // ── Step 1: resolve all conids in parallel ─────────────────
  const conidQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ["conid", item.resolve, item.sec_type ?? ""] as const,
      queryFn: ({ signal }: { signal?: AbortSignal }): Promise<ConidResponse> =>
        parallaxApi.resolveConid(item.resolve, item.sec_type, signal),
      staleTime: Infinity,
      enabled: gate,
    })),
  });

  // Ordered by items index — undefined while resolving.
  const resolvedConids: (number | undefined)[] = conidQueries.map(
    (q) => q.data?.conid,
  );
  const knownConids = useMemo(
    () => resolvedConids.filter((c): c is number => c != null),
    // resolvedConids identity changes every render — comparing by content
    // via the sort-join is the lightest stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedConids.join(",")],
  );
  const allResolved = items.length > 0 && knownConids.length === items.length;

  const sortedConidsKey = useMemo(
    () => [...knownConids].sort((a, b) => a - b).join(","),
    [knownConids],
  );

  // ── Step 2: one bundled snapshot fetch — seeds initial values ──
  //
  // Previously this was a 10-second polling loop. Now it's a one-shot
  // (with a stale time long enough that re-mounts don't re-fetch) and
  // live ticks from useLiveQuotes take over for ongoing updates.
  const { data: quotesData } = useQuery({
    queryKey: ["quotes-bundled", sortedConidsKey],
    queryFn: ({ signal }) => parallaxApi.quotesBundled(knownConids, signal),
    enabled: gate && allResolved,
    staleTime: 60_000,
    refetchInterval: false,
  });

  // ── Step 3: subscribe to live ticks for every resolved conid ──
  const liveTicks = useLiveQuotes(knownConids);

  // ── Step 4: build lookup maps for O(1) slice access ─────────
  const quoteByConid = useMemo(
    () => new Map((quotesData?.items ?? []).map((q) => [q.conid, q])),
    [quotesData],
  );

  const quotesLoaded = quotesData != null;

  // ── Render ───────────────────────────────────────────────────

  if (items.length === 0) {
    return <div className="col-span-2 border-b border-border bg-[var(--bg-1)]" />;
  }

  return (
    <div role={variant === "market" ? "group" : undefined} aria-label={variant === "market" ? "Configured current prices" : undefined} className={variant === "market"
      ? "flex min-w-0 items-center justify-start overflow-x-auto rounded-md bg-[#FCFDFD] px-1 py-1"
      : "col-span-2 flex items-center justify-center overflow-x-auto scrollbar-hidden border-b border-border bg-[var(--bg-1)] px-2 py-1"}>
      {items.map((item, i) => {
        const conid = resolvedConids[i];
        return (
          <PulseItem
            key={item.label}
            label={item.label}
            conid={conid}
            quote={conid != null ? quoteByConid.get(conid) : undefined}
            liveTick={conid != null ? liveTicks.get(conid) : undefined}
            loaded={quotesLoaded && conid != null}
            variant={variant}
          />
        );
      })}
    </div>
  );
}
