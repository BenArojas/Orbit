/**
 * Today page — daily trading cockpit.
 *
 * Layout (full-height grid):
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  TodayContextStrip (54px — 7-cell market snapshot)         │
 *   ├──────────────────────────────────────┬─────────────────────┤
 *   │  TodayHits (filter pills + grid)     │  WatchlistSidebar   │
 *   │  TodayTimeline (scrollable feed)     │  TodayRulesPanel    │
 *   └──────────────────────────────────────┴─────────────────────┘
 *
 * All data composition lives in the child components — this page is layout
 * only.
 */

import {
  TodayContextStrip,
  TodayHits,
  TodayTimeline,
  TodayRulesPanel,
} from "@/components/today";
import WatchlistSidebar from "@/components/watchlist/WatchlistSidebar";

export default function TodayPage() {
  return (
    <div className="grid h-full grid-rows-[54px_1fr] overflow-hidden">
      <TodayContextStrip />
      <div className="grid grid-cols-[1fr_260px] overflow-hidden">
        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          <TodayHits />
          <TodayTimeline />
        </div>
        <aside className="flex min-h-0 flex-col overflow-hidden border-l border-border bg-[var(--bg-1)]">
          <div className="flex-1 overflow-hidden border-b border-border">
            <WatchlistSidebar />
          </div>
          <div className="overflow-y-auto">
            <TodayRulesPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}
