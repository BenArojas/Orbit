/**
 * Relative Rotation Graph (RRG) Panel — Task 3.4
 *
 * A 4-quadrant scatter plot showing sector rotation dynamics.
 * X-axis: RS-Ratio (relative trend strength vs SPY, centered at 100)
 * Y-axis: RS-Momentum (rate of change of RS-Ratio, centered at 100)
 *
 * Quadrants:
 *   Leading   (top-right)  — green  — outperforming and improving
 *   Weakening (bottom-right) — orange — outperforming but fading
 *   Lagging   (bottom-left) — red    — underperforming and worsening
 *   Improving (top-left)    — cyan   — underperforming but recovering
 *
 * Each dot has a trail (last 5 points) showing movement direction.
 * Matches the approved Layout A v2 mockup style.
 *
 * Data: GET /sectors/rrg
 */

import { useQuery } from "@tanstack/react-query";
import { api, type RRGDataPoint } from "../../lib/api";
import { useIbkrReadyTier } from "@/hooks/useIbkrReadyTier";
import { RRGSkeleton } from "./skeletons";

// Colors per quadrant (matching the mockup)
const QUADRANT_COLORS: Record<string, string> = {
  leading: "var(--clr-green)",
  weakening: "var(--clr-orange)",
  lagging: "var(--clr-red)",
  improving: "var(--clr-cyan)",
};

export default function RRGPanel() {
  // Tier 4 in the 9-tier dashboard cascade (Phase 8 / Task 8.9):
  // fires 750 ms after IBKR connects — right after Sector Performance.
  const ready = useIbkrReadyTier(4);
  const { data: rrg, isLoading, error } = useQuery({
    queryKey: ["sectors", "rrg"],
    queryFn: api.sectorRRG,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    enabled: ready,
  });

  // Skeleton until tier gate fires AND first fetch completes
  if (!ready || (isLoading && !rrg)) {
    return <RRGSkeleton />;
  }

  return (
    // Phase 8.9: expand vertically instead of a fixed height so the RRG uses
    // the full space in its grid row (`flex-1 min-h-[280px]`). Dot positions
    // are now percentage-based so they re-layout cleanly on resize.
    <div className="mx-auto flex h-full min-h-[280px] w-full max-w-[78%] flex-1 flex-col rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[12px] font-semibold tracking-wide text-[var(--text-2)]">
          Relative Rotation Graph
        </span>
        <span className="rounded-full bg-[var(--glow-cyan)] px-2 py-0.5 text-[11px] font-medium text-[var(--clr-cyan)]">
          vs SPY
        </span>
      </div>

      {/* Graph area */}
      <div className="relative flex-1 min-h-[240px] bg-[var(--bg-1)] overflow-hidden">
        {/* Radial glow background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(0,212,255,0.03), transparent 60%)",
          }}
        />

        {/* Crosshair axes */}
        <div className="absolute top-1/2 left-0 right-0 h-px bg-[var(--border)]" />
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--border)]" />

        {/* Quadrant labels */}
        <span className="absolute top-2 left-2.5 text-[8px] font-bold uppercase tracking-widest text-[var(--clr-cyan)] opacity-25">
          Improving
        </span>
        <span className="absolute top-2 right-2.5 text-[8px] font-bold uppercase tracking-widest text-[var(--clr-green)] opacity-25">
          Leading
        </span>
        <span className="absolute bottom-2 left-2.5 text-[8px] font-bold uppercase tracking-widest text-[var(--clr-red)] opacity-25">
          Lagging
        </span>
        <span className="absolute bottom-2 right-2.5 text-[8px] font-bold uppercase tracking-widest text-[var(--clr-orange)] opacity-25">
          Weakening
        </span>

        {/* Axis labels */}
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[7px] text-[var(--text-3)]">
          RS-Ratio
        </span>
        <span className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[7px] text-[var(--text-3)]">
          RS-Momentum
        </span>

        {/* Loading / Error / Empty */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-[var(--clr-red)]">Failed to load RRG</span>
          </div>
        )}
        {!isLoading && !error && rrg?.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-[11px] text-[var(--text-3)]">No RRG data available</span>
            <span className="text-[10px] text-[var(--text-3)] opacity-60">
              Connect IBKR to see sector rotation
            </span>
          </div>
        )}

        {/* Data points */}
        {rrg?.map((point) => (
          <RRGDot key={point.symbol} point={point} allPoints={rrg} />
        ))}
      </div>
    </div>
  );
}

/**
 * Map an RS-Ratio/RS-Momentum value to a 0–100 percentage within the graph.
 * Center is at 100; we auto-scale around the max deviation of all points so
 * a small cluster uses the full canvas.
 *
 * Phase 8.9: returns percentages so the graph container can flex vertically
 * (height changes no longer require recomputing pixel Y coordinates).
 */
function toPercent(
  value: number,
  center: number,
  allValues: number[],
): number {
  const maxDev = Math.max(
    ...allValues.map((v) => Math.abs(v - center)),
    2, // minimum range of ± 2
  );
  const range = maxDev * 1.3; // 30 % padding

  const normalized = (value - center) / range; // -1 to 1
  // 85 % of half-height gives a 7.5 % margin at each edge.
  return 50 + normalized * 50 * 0.85;
}

function RRGDot({
  point,
  allPoints,
}: {
  point: RRGDataPoint;
  allPoints: RRGDataPoint[];
}) {
  const color = QUADRANT_COLORS[point.quadrant] ?? "var(--text-2)";

  const allRatios = allPoints.map((p) => p.rs_ratio);
  const allMomentums = allPoints.map((p) => p.rs_momentum);

  const xPct = toPercent(point.rs_ratio, 100, allRatios);
  // Y is inverted: higher momentum → smaller top %.
  const yPct = 100 - toPercent(point.rs_momentum, 100, allMomentums);

  return (
    <>
      {/* Trail line — also in % coords so it scales with the container */}
      {point.trail.length > 1 && (
        <svg
          className="absolute inset-0 h-full w-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ zIndex: 1 }}
        >
          <polyline
            points={point.trail
              .map((t) => {
                const tx = toPercent(t.rs_ratio, 100, allRatios);
                const ty = 100 - toPercent(t.rs_momentum, 100, allMomentums);
                return `${tx},${ty}`;
              })
              .join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="0.4"
            strokeOpacity="0.3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}

      {/* Dot */}
      <div
        className="absolute h-2.5 w-2.5 rounded-full transition-all duration-[2000ms] ease-in-out"
        style={{
          left: `${xPct}%`,
          top: `${yPct}%`,
          transform: "translate(-50%, -50%)",
          backgroundColor: color,
          boxShadow: `0 0 8px ${color}`,
          zIndex: 2,
        }}
      >
        {/* Glow halo */}
        <div
          className="absolute -inset-1 rounded-full blur-sm opacity-20"
          style={{ backgroundColor: color }}
        />
      </div>

      {/* Label */}
      <span
        className="pointer-events-none absolute whitespace-nowrap text-[8px] font-bold"
        style={{
          left: `${xPct}%`,
          top: `calc(${yPct}% - 12px)`,
          transform: "translateX(-50%)",
          color,
          zIndex: 3,
        }}
      >
        {point.symbol}
      </span>
    </>
  );
}
