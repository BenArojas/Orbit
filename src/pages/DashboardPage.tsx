/**
 * Dashboard Page — Market pulse, gauges, sectors, watchlists
 *
 * Layout from mockup: grid with main content + 310px sidebar
 *   Main: Market pulse bar (top), gauge row, sector panels, RRG
 *   Sidebar: Master watchlist, trigger watchlists, trigger rules
 *
 * Phase 3 tasks implemented:
 *   3.3 — SectorPerformancePanel (YTD bars)
 *   3.4 — RRGPanel (Relative Rotation Graph)
 *   3.5 — WatchlistSidebar (IBKR-synced watchlist)
 *
 * Still placeholder: Market Pulse (3.1), Gauges (3.2),
 *   Dynamic Trigger Watchlists (3.6), Trigger Rules (3.7)
 */

import SectorPerformancePanel from "../components/dashboard/SectorPerformancePanel";
import RRGPanel from "../components/dashboard/RRGPanel";
import WatchlistSidebar from "../components/watchlist/WatchlistSidebar";

export default function DashboardPage() {
  return (
    <div className="grid h-full grid-cols-[1fr_310px] grid-rows-[54px_1fr]">
      {/* Market Pulse bar — spans full width (Phase 3 task 3.1 — Ofek) */}
      <div className="col-span-2 flex items-center border-b border-border bg-[var(--bg-1)] px-4">
        <span className="font-data text-xs text-[var(--text-3)]">
          Market Pulse — Phase 3 (task 3.1)
        </span>
      </div>

      {/* Main content area */}
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {/* Gauge row placeholder (Phase 3 task 3.2 — Ofek) */}
        <div className="flex gap-3">
          {["Market Strength", "VIX Fear", "Sector Rotation", "Active Triggers"].map(
            (label) => (
              <div
                key={label}
                className="flex min-w-[140px] flex-1 flex-col items-center rounded-lg border border-border bg-card p-4"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                  {label}
                </span>
                <span className="font-data mt-2 text-2xl font-bold text-[var(--text-2)]">
                  --
                </span>
              </div>
            )
          )}
        </div>

        {/* Sector Performance — task 3.3 */}
        <SectorPerformancePanel />

        {/* Relative Rotation Graph — task 3.4 */}
        <RRGPanel />
      </div>

      {/* Sidebar — Master Watchlist (task 3.5) */}
      <div className="border-l border-border bg-[var(--bg-1)] overflow-hidden">
        <WatchlistSidebar />
      </div>
    </div>
  );
}
