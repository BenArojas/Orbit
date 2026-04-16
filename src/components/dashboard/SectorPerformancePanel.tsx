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
import { useIbkrReady } from "@/context/GatewayContext";

export default function SectorPerformancePanel() {
  const ibkrReady = useIbkrReady();
  const { data: sectors, isLoading, error } = useQuery({
    queryKey: ["sectors", "performance"],
    queryFn: api.sectorPerformance,
    staleTime: 60_000, // 1 minute — sector data doesn't change fast
    refetchInterval: 5 * 60_000, // Refresh every 5 minutes
    enabled: ibkrReady,
  });

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[11px] font-semibold tracking-wide text-[var(--text-2)]">
          Sector Performance
        </span>
        <span className="rounded-full bg-[var(--cyan-glow)] px-2 py-0.5 text-[9px] font-medium text-[var(--cyan)]">
          YTD
        </span>
      </div>

      {/* Content */}
      <div className="divide-y divide-border">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-[var(--text-3)]">Loading sectors...</span>
          </div>
        )}

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

  // Calculate bar width relative to max absolute value
  const maxAbsYtd = Math.max(
    ...sectors.map((s) => Math.abs(s.ytdPercent ?? 0)),
    1 // prevent division by zero
  );
  const barWidthPct = Math.min((Math.abs(ytd) / maxAbsYtd) * 50, 50); // max 50% of track

  return (
    <div className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-[var(--bg-3)] cursor-pointer">
      {/* Symbol */}
      <span className="w-9 font-data text-[10px] font-semibold text-[var(--text-2)]">
        {sector.symbol}
      </span>

      {/* Name */}
      <span className="w-[90px] text-[10px] text-[var(--text-3)] truncate">
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
        className={`w-[50px] text-right font-data text-[11px] font-semibold ${
          isUp ? "text-[var(--green)]" : "text-[var(--red)]"
        }`}
      >
        {isUp ? "+" : ""}
        {ytd.toFixed(1)}%
      </span>
    </div>
  );
}
