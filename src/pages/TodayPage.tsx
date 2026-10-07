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

import { useLayoutEffect, useRef } from "react";
import { MarketPulse } from "@/components/dashboard";
import {
  TodayHits,
  TodaySetupPlans,
  TodayTimeline,
  TodayRulesPanel,
} from "@/components/today";
import WatchlistSidebar from "@/components/watchlist/WatchlistSidebar";
import { useNavigationStore } from "@/store/navigation";

export default function TodayPage() {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentBodyRef = useRef<HTMLDivElement>(null);
  const restorePendingRef = useRef(false);
  const cancelRestoreRef = useRef<() => void>(() => {});
  const setTodayContext = useNavigationStore((state) => state.setTodayContext);

  useLayoutEffect(() => {
    const node = contentRef.current;
    const body = contentBodyRef.current;
    const target = useNavigationStore.getState().todayContext.scrollTop;
    if (!node || !body || target <= 0) return;

    restorePendingRef.current = true;
    const restore = () => {
      if (!restorePendingRef.current || node.scrollHeight - node.clientHeight < target) return;
      node.scrollTop = target;
      restorePendingRef.current = false;
      observer?.disconnect();
      mutations?.disconnect();
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(restore);
    const mutations = observer ? null : new MutationObserver(restore);
    observer?.observe(body);
    mutations?.observe(body, { childList: true, subtree: true, characterData: true });
    cancelRestoreRef.current = () => {
      restorePendingRef.current = false;
      observer?.disconnect();
      mutations?.disconnect();
    };
    restore();
    return () => {
      cancelRestoreRef.current();
      cancelRestoreRef.current = () => {};
    };
  }, []);

  // Flex column (not a grid) at the root: MarketPulse carries a baked-in
  // `col-span-2` from its dashboard origins. In a grid that span conjures a
  // phantom second column and the content below only fills column one —
  // leaving the right half blank. As a flex child the span is inert and the
  // bar simply takes full width.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <MarketPulse />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px] overflow-hidden">
        <div
          ref={contentRef}
          role="region"
          aria-label="Today workspace content"
          onScroll={(event) => {
            if (restorePendingRef.current) return;
            const scrollTop = event.currentTarget.scrollTop;
            if (scrollTop !== useNavigationStore.getState().todayContext.scrollTop) {
              setTodayContext({ scrollTop });
            }
          }}
          onWheel={() => cancelRestoreRef.current()}
          onTouchStart={() => cancelRestoreRef.current()}
          onPointerDown={() => cancelRestoreRef.current()}
          onKeyDown={() => cancelRestoreRef.current()}
          className="overflow-y-auto p-4"
        >
          <div ref={contentBodyRef} className="flex flex-col gap-3">
            <TodaySetupPlans />
            <TodayHits />
            <TodayTimeline />
          </div>
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
