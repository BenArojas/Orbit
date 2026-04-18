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
  AlertLog,
  WatchlistConfigSection,
} from "@/components/dashboard";
import SectorPerformancePanel from "../components/dashboard/SectorPerformancePanel";
import RRGPanel from "../components/dashboard/RRGPanel";
import WatchlistSidebar from "../components/watchlist/WatchlistSidebar";
import { GatewaySetup } from "@/components/gateway/GatewaySetup";

export default function DashboardPage() {
  return (
    // Phase 8.9: third row is `auto` so AlertLog collapses to its header when
    // empty and expands (up to its internal max-height) when alerts exist.
    // The main content column uses `minmax(0,1fr)` so it can shrink and scroll
    // as the alert log grows.
    <div className="grid h-full grid-cols-[1fr_310px] grid-rows-[54px_minmax(0,1fr)_auto]">
      {/* ── Row 1: Market Pulse bar (full width, baked-in col-span-2) ── */}
      <MarketPulse />

      {/* ── Row 2 Left: Main content area ── */}
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
        {/* Gauge row — 4 arc gauges (task 3.2) */}
        <ArcGaugeRow />

        {/* Sector Performance — task 3.3 */}
        <SectorPerformancePanel />

        {/* Relative Rotation Graph — task 3.4 */}
        <RRGPanel />
      </div>

      {/* ── Row 2 Right: Sidebar ── */}
      <div className="flex min-h-0 flex-col overflow-hidden border-l border-border bg-[var(--bg-1)]">
        {/* Gateway Status — IBKR connection setup */}
        <div className="border-b border-border p-2">
          <GatewaySetup />
        </div>

        {/* Master Watchlist — task 3.5 */}
        <div className="flex-1 overflow-hidden border-b border-border">
          <WatchlistSidebar />
        </div>

        {/* Trigger Hits — dynamic watchlist (task 3.6) */}
        <TriggerWatchlist />

        {/* Trigger Rules — compact list + create modal (task 3.7) */}
        <TriggerRules />

        {/* Per-watchlist expiry overrides (task 6.8) */}
        <WatchlistConfigSection />
      </div>

      {/* ── Row 3: Alert Log (full width, auto-height, task 6.7 + 8.9)
          `mt-2` adds an 8 px gap so the log doesn't butt up against the
          sector/RRG cards above. */}
      <div className="col-span-2 mt-2 overflow-hidden">
        <AlertLog />
      </div>
    </div>
  );
}
