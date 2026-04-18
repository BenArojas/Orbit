/**
 * Sector Performance Panel — Task 3.3
 *
 * Sorted horizontal bar chart showing YTD performance for all 11 SPDR sector ETFs.
 * Green bars extend right (positive), red bars extend left (negative).
 * Matches the approved Layout A v2 mockup.
 *
 * Data: GET /sectors/performance
 */

import { useQuery } from "@tanstack/react-query";
import { api, type SectorPerformance } from "../../lib/api";
import { useIbkrReadyTier } from "@/hooks/useIbkrReadyTier";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { SectorPerformanceSkeleton } from "./skeletons";

// Row layout — keep in sync with SectorRow below. Used to size the scroll
// area so that exactly `visibleRows` fit without the next row peeking through.
const ROW_HEIGHT_PX = 40;

export default function SectorPerformancePanel() {
  // Tier 3 in the 9-tier dashboard cascade (Phase 8 / Task 8.9):
  // fires 500 ms after IBKR connects — after pulse + gauges, before RRG.
  const ready = useIbkrReadyTier(3);
  // Phase 8.9+: on tall viewports (fullscreen, large monitors) show 5 rows
  // without scrolling. On shorter viewports, keep the default 3-row cap so
  // the bottom of the dashboard isn't pushed off-screen.
  const isTallViewport = useMediaQuery("(min-height: 900px)");
  const visibleRows = isTallViewport ? 5 : 3;

  const { data: sectors, isLoading, error } = useQuery({
    queryKey: ["sectors", "performance"],
    queryFn: api.sectorPerformance,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    enabled: ready,
  });

  // Show skeleton while tier gate is closed OR query is actively fetching
  // with no cached data yet.
  if (!ready || (isLoading && !sectors)) {
    return <SectorPerformanceSkeleton rows={visibleRows} />;
  }

  const visibleCount = sectors?.length ?? 0;
  const isScrollable = visibleCount > visibleRows;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[78%] flex-col rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[12px] font-semibold tracking-wide text-[var(--text-2)]">
          Sector Performance
        </span>
        <div className="flex items-center gap-2">
          {isScrollable && (
            <span className="text-[10px] text-[var(--text-3)]">
              {visibleCount} sectors · scroll
            </span>
          )}
          <span className="rounded-full bg-[var(--cyan-glow)] px-2 py-0.5 text-[10px] font-medium text-[var(--cyan)]">
            YTD
          </span>
        </div>
      </div>

      {/* Content — Phase 8.9+: list scrolls when there are more rows than fit.
          Row count is viewport-responsive: 3 on short screens, 5 on tall. */}
      <div className="relative flex-1 min-h-0">
        <div
          className="divide-y divide-border overflow-y-auto"
          style={{
            // +6px so the last row's bottom border is fully visible
            maxHeight: `${ROW_HEIGHT_PX * visibleRows + 6}px`,
          }}
        >
          {error && (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-[var(--clr-red)]">
                Failed to load sector data
              </span>
            </div>
          )}

          {!isLoading && !error && sectors?.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-1 py-8">
              <span className="text-[11px] text-[var(--text-3)]">No sector data available</span>
              <span className="text-[10px] text-[var(--text-3)] opacity-60">
                IBKR must be connected to load sector performance
              </span>
            </div>
          )}

          {sectors?.map((sector) => (
            <SectorRow key={sector.symbol} sector={sector} sectors={sectors} />
          ))}
        </div>

        {/* Fade indicator at the bottom of the scroll area */}
        {isScrollable && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-6"
            style={{
              background:
                "linear-gradient(to top, var(--bg-2, var(--card)), transparent)",
            }}
          />
        )}
      </div>
    </div>
  );
}

function SectorRow({
  sector,
  sectors,
}: {
  sector: SectorPerformance;
  sectors: SectorPerformance[];
}) {
  const ytd = sector.ytdPercent ?? 0;
  const isUp = ytd >= 0;

  // Calculate bar width relative to max absolute value.
  // Guard against empty spread (Math.max() with no args returns -Infinity).
  const maxAbsYtd =
    sectors.length > 0
      ? Math.max(...sectors.map((s) => Math.abs(s.ytdPercent ?? 0)), 1)
      : 1;
  const barWidthPct = Math.min((Math.abs(ytd) / maxAbsYtd) * 50, 50); // max 50% of track

  return (
    <div className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-[var(--bg-3)] cursor-pointer">
      {/* Symbol */}
      <span className="w-9 font-data text-[12px] font-semibold text-[var(--text-2)]">
        {sector.symbol}
      </span>

      {/* Name */}
      <span className="w-[90px] text-[12px] text-[var(--text-3)] truncate">
        {sector.name}
      </span>

      {/* Bar chart — centered bidirectional bar */}
      <div className="relative h-[5px] flex-1 rounded-full bg-[var(--bg-0)]">
        <div
          className="absolute top-0 bottom-0 rounded-full transition-all duration-500"
          style={{
            ...(isUp
              ? {
                  left: "50%",
                  width: `${barWidthPct}%`,
                  background: `linear-gradient(90deg, var(--green), rgba(0,255,136,0.4))`,
                }
              : {
                  right: "50%",
                  width: `${barWidthPct}%`,
                  background: `linear-gradient(270deg, var(--red), rgba(255,68,102,0.4))`,
                }),
          }}
        />
        {/* Center line */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[var(--border)]" />
      </div>

      {/* Percentage */}
      <span
        className={`w-[50px] text-right font-data text-[12px] font-semibold ${
          isUp ? "text-[var(--green)]" : "text-[var(--red)]"
        }`}
      >
        {isUp ? "+" : ""}
        {ytd.toFixed(1)}%
      </span>
    </div>
  );
}
