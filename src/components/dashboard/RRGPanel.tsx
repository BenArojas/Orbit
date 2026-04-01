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

// Colors per quadrant (matching the mockup)
const QUADRANT_COLORS: Record<string, string> = {
  leading: "var(--green)",
  weakening: "var(--orange)",
  lagging: "var(--red)",
  improving: "var(--cyan)",
};

export default function RRGPanel() {
  const { data: rrg, isLoading, error } = useQuery({
    queryKey: ["sectors", "rrg"],
    queryFn: api.sectorRRG,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[11px] font-semibold tracking-wide text-[var(--text-2)]">
          Relative Rotation Graph
        </span>
        <span className="rounded-full bg-[var(--cyan-glow)] px-2 py-0.5 text-[9px] font-medium text-[var(--cyan)]">
          vs SPY
        </span>
      </div>

      {/* Graph area */}
      <div className="relative h-[220px] bg-[var(--bg-1)] overflow-hidden">
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
        <span className="absolute top-2 left-2.5 text-[8px] font-bold uppercase tracking-widest text-[var(--cyan)] opacity-25">
          Improving
        </span>
        <span className="absolute top-2 right-2.5 text-[8px] font-bold uppercase tracking-widest text-[var(--green)] opacity-25">
          Leading
        </span>
        <span className="absolute bottom-2 left-2.5 text-[8px] font-bold uppercase tracking-widest text-[var(--red)] opacity-25">
          Lagging
        </span>
        <span className="absolute bottom-2 right-2.5 text-[8px] font-bold uppercase tracking-widest text-[var(--orange)] opacity-25">
          Weakening
        </span>

        {/* Axis labels */}
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[7px] text-[var(--text-3)]">
          RS-Ratio
        </span>
        <span className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[7px] text-[var(--text-3)]">
          RS-Momentum
        </span>

        {/* Loading / Error */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-[var(--text-3)]">Loading RRG...</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-[var(--red)]">Failed to load RRG</span>
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
 * Map RS-Ratio/RS-Momentum values to pixel positions within the graph.
 * Center is at 100,100. We show a reasonable range (typically 96-104).
 */
function toPosition(
  value: number,
  center: number,
  size: number,
  allValues: number[]
): number {
  // Auto-scale: find the range of all values
  const maxDev = Math.max(
    ...allValues.map((v) => Math.abs(v - center)),
    2 // minimum range of +/- 2
  );
  const range = maxDev * 1.3; // Add 30% padding

  // Normalize to 0-1, then to pixel position
  const normalized = (value - center) / range; // -1 to 1
  return size / 2 + normalized * (size / 2) * 0.85; // 85% of half-size to leave margin
}

function RRGDot({
  point,
  allPoints,
}: {
  point: RRGDataPoint;
  allPoints: RRGDataPoint[];
}) {
  const color = QUADRANT_COLORS[point.quadrant] ?? "var(--text-2)";

  // Collect all ratio and momentum values for auto-scaling
  const allRatios = allPoints.map((p) => p.rs_ratio);
  const allMomentums = allPoints.map((p) => p.rs_momentum);

  // Graph dimensions (matching the 220px height container)
  const graphWidth = 100; // percentage
  const graphHeight = 220; // pixels

  const x = toPosition(point.rs_ratio, 100, graphWidth, allRatios);
  const y =
    graphHeight - toPosition(point.rs_momentum, 100, graphHeight, allMomentums); // invert Y

  return (
    <>
      {/* Trail line */}
      {point.trail.length > 1 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 1 }}
        >
          <polyline
            points={point.trail
              .map((t) => {
                const tx = toPosition(t.rs_ratio, 100, graphWidth, allRatios);
                const ty =
                  graphHeight -
                  toPosition(t.rs_momentum, 100, graphHeight, allMomentums);
                return `${(tx / 100) * 100}%,${ty}`;
              })
              .join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="1"
            strokeOpacity="0.3"
          />
        </svg>
      )}

      {/* Dot */}
      <div
        className="absolute w-2.5 h-2.5 rounded-full transition-all duration-[2000ms] ease-in-out"
        style={{
          left: `${x}%`,
          top: `${y}px`,
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
        className="absolute text-[8px] font-bold whitespace-nowrap pointer-events-none"
        style={{
          left: `${x}%`,
          top: `${y - 12}px`,
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
