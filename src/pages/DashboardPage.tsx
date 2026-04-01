/**
 * Dashboard Page — Market pulse, gauges, sectors, watchlists
 *
 * Layout from approved mockup (Layout A v2):
 *   Grid: main content area + 310px sidebar
 *   Row 1: Market Pulse bar (full width, 54px tall)
 *   Row 2: Main area = gauge row + sector panels + RRG
 *          Sidebar = master watchlist + trigger hits + trigger rules
 *
 * Phase 3 tasks implemented here:
 *   3.1 — MarketPulse (top bar)
 *   3.2 — ArcGaugeRow (four gauges)
 *   3.6 — TriggerWatchlist (dynamic watchlist from hits)
 *   3.7 — TriggerRules (compact rule list + create modal)
 *   3.8 — Click-to-analyze (handled via navigateToAnalysis in each component)
 *
 * Ben's tasks (3.3 Sector Performance, 3.4 RRG, 3.5 Master Watchlist)
 * are on his branch and will be integrated after merge.
 */

import {
  MarketPulse,
  ArcGaugeRow,
  TriggerWatchlist,
  TriggerRules,
} from "@/components/dashboard";

export default function DashboardPage() {
  return (
    <div className="grid h-full grid-cols-[1fr_310px] grid-rows-[54px_1fr]">
      {/* ── Row 1: Market Pulse bar (full width) ── */}
      <MarketPulse />

      {/* ── Row 2 Left: Main content area ── */}
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {/* Gauge row — 4 arc gauges */}
        <ArcGaugeRow />

        {/* Sector Performance — Ben's task 3.3 (placeholder until merge) */}
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="text-xs font-semibold text-[var(--text-2)]">
            Sector Performance — waiting for Ben&apos;s branch merge
          </span>
        </div>

        {/* RRG — Ben's task 3.4 (placeholder until merge) */}
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="text-xs font-semibold text-[var(--text-2)]">
            Relative Rotation Graph — waiting for Ben&apos;s branch merge
          </span>
        </div>
      </div>

      {/* ── Row 2 Right: Sidebar ── */}
      <div className="flex flex-col overflow-y-auto border-l border-border bg-[var(--bg-1)]">
        {/* Master Watchlist — Ben's task 3.5 (placeholder until merge) */}
        <div className="border-b border-border">
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              Watchlist
            </span>
            <span className="rounded-full bg-[var(--bg-3)] px-1.5 py-0.5 font-data text-[9px] text-[var(--text-3)]">
              0
            </span>
          </div>
          <div className="flex items-center justify-center py-4">
            <span className="text-[10px] text-[var(--text-3)]">
              Waiting for Ben&apos;s branch merge
            </span>
          </div>
        </div>

        {/* Trigger Hits — dynamic watchlist (task 3.6) */}
        <TriggerWatchlist />

        {/* Trigger Rules — compact list + create modal (task 3.7) */}
        <TriggerRules />
      </div>
    </div>
  );
}
