/**
 * Today page — daily trading cockpit.
 *
 * Layout (full-height grid):
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  MarketPulse (54px — the original market-indices bar)       │
 *   ├──────────────────────────────────────┬─────────────────────┤
 *   │  TodayHits (filter pills + grid)     │  WatchlistSidebar   │
 *   │  TodayTimeline (scrollable feed)     │  TodayRulesPanel    │
 *   └──────────────────────────────────────┴─────────────────────┘
 *
 * All data composition lives in the child components — this page is layout
 * only.
 */

import { MarketPulse } from "@/components/dashboard";
import {
  TodayHits,
  TodayTimeline,
  TodayRulesPanel,
} from "@/components/today";
import WatchlistSidebar from "@/components/watchlist/WatchlistSidebar";

export default function TodayPage() {
  // Flex column (not a grid) at the root: MarketPulse carries a baked-in
  // `col-span-2` from its dashboard origins. In a grid that span conjures a
  // phantom second column and the content below only fills column one —
  // leaving the right half blank. As a flex child the span is inert and the
  // bar simply takes full width.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <MarketPulse />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px] overflow-hidden">
        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          <TodayHits />
          <TodayTimeline />
        </div>
        <aside className="flex min-h-0 flex-col overflow-hidden border-l border-border bg-[var(--bg-1)]">
          {/* Watchlist takes the flexible top portion */}
          <div className="min-h-0 flex-1 overflow-hidden border-b border-border">
            <WatchlistSidebar />
          </div>
          {/* Rules panel gets a guaranteed slice with its own scroll so it
              never collapses to just its header */}
          <div className="flex max-h-[45%] min-h-[140px] flex-col overflow-y-auto">
            <TodayRulesPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}
