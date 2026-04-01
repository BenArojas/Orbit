/**
 * Arc Gauge Components — Task 3.2
 *
 * Four SVG arc gauges displayed in a row on the Dashboard:
 *   1. Market Strength — composite of breadth + momentum (green)
 *   2. VIX Fear        — current VIX level (red)
 *   3. Sector Rotation — how defensive/offensive the market is (cyan)
 *   4. Triggers Active — how many trigger rules are enabled and have hits (orange)
 *
 * Each gauge is a semicircular arc (SVG path) with a glowing fill.
 * The fill amount is driven by the value (0–100 scale).
 *
 * Design from mockup: card with radial gradient glow at top,
 * header with title + badge, SVG arc, big value number, subtitle.
 */

import { useQuery } from "@tanstack/react-query";
import { api, type QuoteResponse, type ConidResponse, type TriggerRule, type TriggerHit } from "@/lib/api";

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
}: GaugeProps) {
  // Calculate stroke-dashoffset: full arc (141) minus how much to fill
  const offset = ARC_LENGTH - (ARC_LENGTH * Math.min(fillPercent, 100)) / 100;

  return (
    <div
      className="group relative flex min-w-[140px] flex-1 flex-col items-center rounded-[10px] border border-border bg-card p-3 transition-all hover:-translate-y-0.5 hover:border-[rgba(255,255,255,0.1)]"
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
      <span className="relative z-10 text-[9px] text-[var(--text-3)]">
        {subtitle}
      </span>
    </div>
  );
}

// ── Helper: interpret VIX level ────────────────────────────

function vixBadge(vix: number): string {
  if (vix < 15) return "LOW";
  if (vix < 20) return "NORMAL";
  if (vix < 25) return "ELEVATED";
  if (vix < 30) return "HIGH";
  return "EXTREME";
}

function vixFillPercent(vix: number): number {
  // VIX typically ranges 10–40. Map to 0–100.
  return Math.min(100, Math.max(0, ((vix - 10) / 30) * 100));
}

// ── The Four Gauges Row ────────────────────────────────────

export default function ArcGaugeRow() {
  // Resolve VIX conid at runtime (works across paper/live accounts)
  const { data: vixResolved } = useQuery<ConidResponse>({
    queryKey: ["conid", "VIX"],
    queryFn: () => api.resolveConid("VIX"),
    staleTime: Infinity,
  });

  const vixConid = vixResolved?.conid;

  // Fetch VIX quote for the VIX gauge (only once conid is resolved)
  const { data: vixQuote } = useQuery<QuoteResponse>({
    queryKey: ["quote", vixConid],
    queryFn: () => api.quote(vixConid!),
    enabled: vixConid != null,
    refetchInterval: 15_000,
  });

  // Fetch trigger rules + hits for the Triggers gauge
  const { data: rules } = useQuery<TriggerRule[]>({
    queryKey: ["trigger-rules"],
    queryFn: () => api.getTriggerRules(),
    staleTime: 30_000,
  });

  const { data: hits } = useQuery<TriggerHit[]>({
    queryKey: ["trigger-hits"],
    queryFn: () => api.getTriggerHits(100),
    staleTime: 30_000,
  });

  const vix = vixQuote?.lastPrice ?? 0;
  const enabledRules = rules?.filter((r) => r.enabled).length ?? 0;
  const totalRules = rules?.length ?? 0;
  const totalHits = hits?.length ?? 0;

  return (
    <div className="flex gap-3">
      {/* 1. Market Strength — placeholder value until Phase 6 scanner computes it */}
      <GaugeCard
        title="Market Strength"
        value="--"
        fillPercent={0}
        badge="PENDING"
        subtitle="Breadth + Momentum composite"
        color="var(--clr-green)"
        glowColor="var(--glow-green)"
        badgeClass="badge-green"
      />

      {/* 2. VIX Fear */}
      <GaugeCard
        title="VIX"
        value={vix > 0 ? vix.toFixed(1) : "--"}
        fillPercent={vix > 0 ? vixFillPercent(vix) : 0}
        badge={vix > 0 ? vixBadge(vix) : "N/A"}
        subtitle="CBOE Volatility Index"
        color="var(--clr-red)"
        glowColor="var(--glow-red)"
        badgeClass="badge-red"
      />

      {/* 3. Sector Rotation — placeholder until RRG data drives it */}
      <GaugeCard
        title="Sector Rotation"
        value="--"
        fillPercent={0}
        badge="PENDING"
        subtitle="Offensive vs Defensive posture"
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
