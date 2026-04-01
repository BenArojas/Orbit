/**
 * Dashboard Page — Market pulse, gauges, sectors, watchlists
 *
 * Layout from approved mockup (Layout A v2):
 *   Grid: main content area + 310px sidebar
 *   Row 1: Market Pulse bar (full width, 54px tall)
 *   Row 2: Main area = gauge row + sector panels + RRG
 *          Sidebar = master watchlist + trigger hits + trigger rules
 *
 * Phase 3 tasks implemented:
 *   3.1 — MarketPulse (top bar, Ofek)
 *   3.2 — ArcGaugeRow (four arc gauges, Ofek)
 *   3.3 — SectorPerformancePanel (YTD bars, Ben)
 *   3.4 — RRGPanel (Relative Rotation Graph, Ben)
 *   3.5 — WatchlistSidebar (IBKR-synced watchlist, Ben)
 *   3.6 — TriggerWatchlist (dynamic watchlist from hits, Ofek)
 *   3.7 — TriggerRules (compact rule list + create modal, Ofek)
 *   3.8 — Click-to-analyze (handled via navigateToAnalysis in each component)
 */

import {
  MarketPulse,
  ArcGaugeRow,
  TriggerWatchlist,
  TriggerRules,
} from "@/components/dashboard";
import SectorPerformancePanel from "../components/dashboard/SectorPerformancePanel";
import RRGPanel from "../components/dashboard/RRGPanel";
import WatchlistSidebar from "../components/watchlist/WatchlistSidebar";

export default function DashboardPage() {
  return (
    <div className="grid h-full grid-cols-[1fr_310px] grid-rows-[54px_1fr]">
      {/* ── Row 1: Market Pulse bar (full width) ── */}
      <MarketPulse />

      {/* ── Row 2 Left: Main content area ── */}
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {/* Gauge row — 4 arc gauges (task 3.2) */}
        <ArcGaugeRow />

        {/* Sector Performance — task 3.3 */}
        <SectorPerformancePanel />

        {/* Relative Rotation Graph — task 3.4 */}
        <RRGPanel />
      </div>

      {/* ── Row 2 Right: Sidebar ── */}
      <div className="flex flex-col overflow-hidden border-l border-border bg-[var(--bg-1)]">
        {/* Master Watchlist — task 3.5 */}
        <div className="flex-1 overflow-hidden border-b border-border">
          <WatchlistSidebar />
        </div>

        {/* Trigger Hits — dynamic watchlist (task 3.6) */}
        <TriggerWatchlist />

        {/* Trigger Rules — compact list + create modal (task 3.7) */}
        <TriggerRules />
      </div>
    </div>
  );
}
