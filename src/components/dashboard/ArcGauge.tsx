/**
 * Arc Gauge Components — Task 3.2 (Phase 8 / Task 8.9 rewrite)
 *
 * Four SVG arc gauges displayed in a row on the Dashboard:
 *   1. Market Strength — % of 11 sector ETFs above their 50-day EMA (green)
 *   2. VIX Fear        — current VIX level (red) — clickable → Analysis 1D
 *   3. Sector Rotation — offensive vs defensive 1-month perf (cyan)
 *   4. Triggers Active — # of trigger rules enabled (orange)
 *
 * Each gauge is a semicircular SVG path with a glowing fill driven by a
 * 0–100 value. Design from mockup: card with radial gradient glow,
 * header (title + badge), SVG arc, big value number, subtitle.
 *
 * Phase 8.9 changes:
 *   - Market Strength + Sector Rotation gauges now fed by real data
 *     (`/sectors/breadth`, `/sectors/rotation`) instead of "PENDING" placeholders.
 *   - VIX card is clickable → navigates Analysis to the VIX conid @ 1D timeframe.
 */

import type { ElementType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  type QuoteResponse,
  type ConidResponse,
  type TriggerRule,
  type TriggerHit,
  type MarketBreadthResponse,
  type SectorRotationResponse,
} from "@/lib/api";
import { useIbkrReady } from "@/context/GatewayContext";
import { useIbkrReadyTier } from "@/hooks/useIbkrReadyTier";
import { useNavigationStore } from "@/store";
import { useChartStore } from "@/store/chart";
import { ArcGaugeRowSkeleton } from "./skeletons";

// ── Arc SVG constants ──────────────────────────────────────

/** Total length of the semicircular arc path (calculated from the SVG path) */
const ARC_LENGTH = 141;

/** The SVG path for the background arc and fill arc */
const ARC_PATH = "M 15 55 A 45 45 0 0 1 105 55";

// ── Gauge Card ─────────────────────────────────────────────

interface GaugeProps {
  title: string;
  value: string | number;
  /** 0–100, controls how full the arc is */
  fillPercent: number;
  badge: string;
  subtitle: string;
  color: string;       // e.g., "var(--clr-green)"
  glowColor: string;   // e.g., "var(--glow-green)"
  badgeClass: string;   // e.g., "badge-green"
  onClick?: () => void;
  clickHint?: string;
}

function GaugeCard({
  title,
  value,
  fillPercent,
  badge,
  subtitle,
  color,
  glowColor,
  badgeClass,
  onClick,
  clickHint,
}: GaugeProps) {
  // Calculate stroke-dashoffset: full arc (141) minus how much to fill
  const offset = ARC_LENGTH - (ARC_LENGTH * Math.min(fillPercent, 100)) / 100;

  const clickable = typeof onClick === "function";
  const Tag: ElementType = clickable ? "button" : "div";

  return (
    <Tag
      onClick={clickable ? onClick : undefined}
      title={clickHint}
      className={`group relative flex min-w-[140px] flex-1 flex-col items-center rounded-[10px] border border-border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-[rgba(255,255,255,0.1)]${
        clickable ? " cursor-pointer" : ""
      }`}
    >
      {/* Radial glow at top of card */}
      <div
        className="pointer-events-none absolute inset-0 rounded-[10px] opacity-50"
        style={{
          background: `radial-gradient(ellipse at 50% -20%, ${glowColor}, transparent 70%)`,
        }}
      />

      {/* Header: title + badge */}
      <div className="relative z-10 flex w-full items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          {title}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${badgeClass}`}
        >
          {badge}
        </span>
      </div>

      {/* SVG Arc */}
      <svg className="relative z-10 my-1" viewBox="0 0 120 65" width="120" height="65">
        {/* Background arc (dark) */}
        <path
          d={ARC_PATH}
          fill="none"
          stroke="var(--bg-0)"
          strokeWidth={5}
          strokeLinecap="round"
        />
        {/* Filled arc (colored + glowing) */}
        <path
          d={ARC_PATH}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={ARC_LENGTH}
          strokeDashoffset={offset}
          style={{
            filter: `drop-shadow(0 0 4px ${color})`,
            transition: "stroke-dashoffset 0.8s ease-out",
          }}
        />
      </svg>

      {/* Value */}
      <span
        className="relative z-10 font-data text-lg font-bold"
        style={{ color }}
      >
        {value}
      </span>

      {/* Subtitle */}
      <span className="relative z-10 text-[9px] text-center text-[var(--text-3)]">
        {subtitle}
      </span>
    </Tag>
  );
}

// ── Badge helpers ─────────────────────────────────────────

function vixBadge(vix: number): string {
  if (vix < 15) return "LOW";
  if (vix < 20) return "NORMAL";
  if (vix < 25) return "ELEVATED";
  if (vix < 30) return "HIGH";
  return "EXTREME";
}

function vixFillPercent(vix: number): number {
  return Math.min(100, Math.max(0, ((vix - 10) / 30) * 100));
}

function breadthBadge(pct: number): string {
  if (pct >= 75) return "STRONG";
  if (pct >= 55) return "BULLISH";
  if (pct >= 45) return "MIXED";
  if (pct >= 25) return "BEARISH";
  return "WEAK";
}

function rotationBadge(gauge: number, delta: number): string {
  // gauge: 0 = fully defensive, 50 = neutral, 100 = fully offensive
  if (gauge >= 70) return "OFFENSIVE";
  if (gauge >= 55) return "RISK-ON";
  if (gauge > 45) return "NEUTRAL";
  if (gauge > 30) return "RISK-OFF";
  // keep delta available for future 'extreme defensive' classifications
  void delta;
  return "DEFENSIVE";
}

// ── The Four Gauges Row ────────────────────────────────────

export default function ArcGaugeRow() {
  const ibkrReady = useIbkrReady();
  // Tier 2 in the 9-tier dashboard cascade (Phase 8 / Task 8.9):
  // fires 250 ms after IBKR connects — right after Market Pulse.
  const tierReady = useIbkrReadyTier(2);

  const navigateToAnalysis = useNavigationStore((s) => s.navigateToAnalysis);
  const setTimeframe = useChartStore((s) => s.setTimeframe);

  // Resolve VIX conid at runtime (works across paper/live accounts)
  const { data: vixResolved } = useQuery<ConidResponse>({
    queryKey: ["conid", "VIX"],
    queryFn: () => api.resolveConid("VIX"),
    staleTime: Infinity,
    enabled: tierReady,
  });

  const vixConid = vixResolved?.conid;

  // VIX quote
  const { data: vixQuote } = useQuery<QuoteResponse>({
    queryKey: ["quote", vixConid],
    queryFn: () => api.quote(vixConid!),
    enabled: tierReady && vixConid != null,
    refetchInterval: 15_000,
  });

  // Market Strength — breadth proxy from /sectors/breadth
  const { data: breadth } = useQuery<MarketBreadthResponse>({
    queryKey: ["market-breadth"],
    queryFn: () => api.marketBreadth(),
    enabled: tierReady,
    // EMA-based breadth changes slowly. 2 min refetch is plenty + avoids
    // pressuring IBKR with 11 daily-bar requests too often.
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  // Sector Rotation — offensive vs defensive 1-month perf
  const { data: rotation } = useQuery<SectorRotationResponse>({
    queryKey: ["sector-rotation"],
    queryFn: () => api.sectorRotation(),
    enabled: tierReady,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  // Trigger rules + hits (local SQLite, always ok)
  const { data: rules } = useQuery<TriggerRule[]>({
    queryKey: ["trigger-rules"],
    queryFn: () => api.getTriggerRules(),
    staleTime: 30_000,
  });

  const { data: hits } = useQuery<TriggerHit[]>({
    queryKey: ["trigger-hits"],
    queryFn: () => api.getTriggerHits(200),
    staleTime: 30_000,
  });

  const vix = vixQuote?.lastPrice ?? 0;
  const enabledRules = rules?.filter((r) => r.enabled).length ?? 0;
  const totalRules = rules?.length ?? 0;
  const totalHits = hits?.length ?? 0;

  // Skeleton while tier/IBKR isn't ready. Local (SQLite) queries may be
  // ready but the market-data queries aren't, so we align on the IBKR path.
  if (!ibkrReady || !tierReady) {
    return <ArcGaugeRowSkeleton />;
  }

  // ── VIX click handler: open Analysis on VIX at 1D timeframe ──
  const handleVixClick = () => {
    if (vixConid == null) return;
    setTimeframe("1D");
    navigateToAnalysis(vixConid);
  };

  // ── Market Strength values ──
  const breadthValue = breadth?.value;
  const breadthBadgeText =
    breadthValue != null ? breadthBadge(breadthValue) : "LOADING";
  const breadthSubtitle =
    breadth != null
      ? `${breadth.above}/${breadth.total} ETFs above 50-EMA`
      : "Breadth across sector ETFs";

  // ── Sector Rotation values ──
  const rotationValue = rotation?.value;
  const rotationDelta = rotation?.delta_pct ?? 0;
  const rotationSubtitle =
    rotation?.offensive_pct != null && rotation.defensive_pct != null
      ? `1mo: off ${rotation.offensive_pct > 0 ? "+" : ""}${rotation.offensive_pct.toFixed(
          1,
        )}% vs def ${rotation.defensive_pct > 0 ? "+" : ""}${rotation.defensive_pct.toFixed(
          1,
        )}%`
      : "Offensive vs Defensive (1mo)";
  const rotationValueLabel =
    rotationValue != null
      ? `${rotationDelta > 0 ? "+" : ""}${rotationDelta.toFixed(1)}%`
      : "--";

  return (
    <div className="flex gap-3">
      {/* 1. Market Strength — % of sector ETFs above 50-EMA */}
      <GaugeCard
        title="Market Strength"
        value={breadthValue != null ? `${breadthValue.toFixed(0)}%` : "--"}
        fillPercent={breadthValue ?? 0}
        badge={breadthBadgeText}
        subtitle={breadthSubtitle}
        color="var(--clr-green)"
        glowColor="var(--glow-green)"
        badgeClass="badge-green"
      />

      {/* 2. VIX — clickable → Analysis (1D) */}
      <GaugeCard
        title="VIX"
        value={vix > 0 ? vix.toFixed(1) : "--"}
        fillPercent={vix > 0 ? vixFillPercent(vix) : 0}
        badge={vix > 0 ? vixBadge(vix) : "N/A"}
        subtitle="CBOE Volatility Index"
        color="var(--clr-red)"
        glowColor="var(--glow-red)"
        badgeClass="badge-red"
        onClick={vixConid != null ? handleVixClick : undefined}
        clickHint={vixConid != null ? "Open VIX in Analysis (1D)" : undefined}
      />

      {/* 3. Sector Rotation — offensive vs defensive 1mo */}
      <GaugeCard
        title="Sector Rotation"
        value={rotationValueLabel}
        fillPercent={rotationValue ?? 50}
        badge={
          rotationValue != null ? rotationBadge(rotationValue, rotationDelta) : "LOADING"
        }
        subtitle={rotationSubtitle}
        color="var(--clr-cyan)"
        glowColor="var(--glow-cyan)"
        badgeClass="badge-cyan"
      />

      {/* 4. Triggers Active */}
      <GaugeCard
        title="Triggers Active"
        value={`${enabledRules}/${totalRules}`}
        fillPercent={totalRules > 0 ? (enabledRules / totalRules) * 100 : 0}
        badge={totalHits > 0 ? `${totalHits} HITS` : "NO HITS"}
        subtitle="Rules enabled / total rules"
        color="var(--clr-orange)"
        glowColor="var(--glow-orange)"
        badgeClass="badge-orange"
      />
    </div>
  );
}
