/**
 * Market Pulse Bar — Task 3.1 (Phase 8 / Task 8.9 rewrite)
 *
 * Horizontal bar at the top of the Dashboard showing key market instruments.
 * Each item is clickable → navigates to Analysis for that conid.
 *
 * Phase 8.9 changes:
 *   - 13 slots in a new order: SPX → SPY → QQQ → DIA → IWM → BTC → ETH → GLD
 *     → SLV → USO → TLT → DXY → USD/ILS (VIX moved to the arc gauges only)
 *   - Row is centered (`justify-center`) instead of left-aligned
 *   - Tier 1 of the 9-tier dashboard cascade (fires ~0 ms after IBKR ready)
 *   - Inner 80 ms per-ticker stagger: each ticker's queries fire in order so
 *     the IBKR snapshot endpoint isn't hammered with 13 parallel requests
 *   - Per-ticker pulse skeleton while its quote is still loading
 *   - Sparkline tooltip explains the window (12 daily closes · last 5 trading days)
 *
 * Data: /market/conid/{symbol} → /market/quote/{conid} → /market/candles/{conid}?timeframe=5D
 * All three queries are gated on ibkrReady + the per-ticker stagger gate.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type QuoteResponse, type CandleData, type ConidResponse } from "@/lib/api";
import { useNavigationStore, usePulseConfigStore } from "@/store";
import { useIbkrReady } from "@/context/GatewayContext";
import { useIbkrReadyTier } from "@/hooks/useIbkrReadyTier";
import { Pulse } from "./skeletons";

// ── Config ───────────────────────────────────────────────────
//
// Phase 8.9+: pulse-bar tickers are now user-configurable via Settings.
// The list lives in SQLite (see `backend/routers/pulse_config.py`) and
// is loaded into `usePulseConfigStore` on app start. The defaults used
// before hydration come from DEFAULT_PULSE_ITEMS in the store module —
// kept in sync with backend `DEFAULT_PULSE_ITEMS` so the first render
// matches what the DB will eventually return.

/** Per-ticker stagger — each item fires 80 ms after the previous one. */
const TICKER_STAGGER_MS = 80;

// ── Stagger hook ─────────────────────────────────────────────

/** Returns true after `delayMs`, only once `gate` is true. */
function useDelayedReady(gate: boolean, delayMs: number): boolean {
  const [ready, setReady] = useState(delayMs === 0 && gate);

  useEffect(() => {
    if (!gate) {
      setReady(false);
      return;
    }
    if (delayMs === 0) {
      setReady(true);
      return;
    }
    const t = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(t);
  }, [gate, delayMs]);

  return ready;
}

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

// ── Pulse Item ───────────────────────────────────────────────

function PulseItem({
  label,
  resolve,
  secType,
  enabled,
}: {
  label: string;
  resolve: string;
  secType?: string;
  enabled: boolean;
}) {
  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);

  // Step 1 — resolve symbol → conid (cached indefinitely).
  // secType is part of the cache key so two items with the same ticker
  // but different hints don't collide (e.g. a future TWS-paired case).
  const { data: resolved, isError: resolveError } = useQuery<ConidResponse>({
    queryKey: ["conid", resolve, secType ?? ""],
    queryFn: () => api.resolveConid(resolve, secType),
    staleTime: Infinity,
    enabled,
  });

  const conid = resolved?.conid;

  // Step 2 — live quote (fires once conid is known).
  const { data: quote, isError: quoteError } = useQuery<QuoteResponse>({
    queryKey: ["quote", conid],
    queryFn: () => api.quote(conid!),
    enabled: enabled && conid != null,
    refetchInterval: 10_000,
  });

  // Step 3 — recent candles for sparkline.
  const { data: candles } = useQuery<CandleData[]>({
    queryKey: ["candles", conid, "5D"],
    queryFn: () => api.candles(conid!, "5D"),
    enabled: enabled && conid != null,
    staleTime: 60_000,
  });

  // Not yet staggered in, or still waiting on conid + quote → show skeleton.
  if (!enabled || (!quote && !quoteError && !resolveError)) {
    return <PulseItemSkeleton label={label} />;
  }

  const price = quote?.lastPrice;
  const changePct = quote?.changePercent;
  const isUp = (changePct ?? 0) >= 0;

  return (
    <button
      onClick={() => conid && navigateToAnalysis(conid)}
      disabled={conid == null}
      className="group relative flex min-w-[115px] flex-col gap-0.5 px-[18px] py-2 transition-colors hover:bg-[var(--bg-2)] disabled:opacity-60"
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

// ── Stagger wrapper ──────────────────────────────────────────

/**
 * Thin wrapper that computes `enabled` for a single ticker based on
 * its index in the row and the outer IBKR-ready gate.
 */
function StaggeredPulseItem({
  label,
  resolve,
  secType,
  index,
  gate,
}: {
  label: string;
  resolve: string;
  secType?: string;
  index: number;
  gate: boolean;
}) {
  const enabled = useDelayedReady(gate, index * TICKER_STAGGER_MS);
  return (
    <PulseItem
      label={label}
      resolve={resolve}
      secType={secType}
      enabled={enabled}
    />
  );
}

// ── Main bar ─────────────────────────────────────────────────

export default function MarketPulse() {
  const ibkrReady = useIbkrReady();
  // Tier 1 in the 9-tier dashboard cascade (Phase 8 / Task 8.9): fires
  // at t=0 as soon as IBKR connects, before everything else on the page.
  const tierReady = useIbkrReadyTier(1);
  const gate = ibkrReady && tierReady;

  // User-configurable ticker list (Phase 8.9+). `items` pre-populates with
  // DEFAULT_PULSE_ITEMS before the backend GET resolves, so the bar never
  // flashes empty on first render.
  const items = usePulseConfigStore((s) => s.items);

  // If the user has emptied the list via Settings, hide the bar entirely
  // rather than render an empty row that still consumes the 54px track.
  if (items.length === 0) {
    return <div className="col-span-2 border-b border-border bg-[var(--bg-1)]" />;
  }

  return (
    <div className="col-span-2 flex items-center justify-center overflow-x-auto scrollbar-hidden border-b border-border bg-[var(--bg-1)] px-2 py-1">
      {items.map((item, i) => (
        <StaggeredPulseItem
          key={item.label}
          label={item.label}
          resolve={item.resolve}
          secType={item.sec_type}
          index={i}
          gate={gate}
        />
      ))}
    </div>
  );
}
