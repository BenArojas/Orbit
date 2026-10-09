import { useLayoutEffect, useRef } from "react";
import { MarketPulse } from "@/components/dashboard";
import {
  TodayHits,
  TodaySetupPlans,
  TodayTimeline,
  TodayRulesPanel,
} from "@/components/today";
import { useNavigationStore } from "@/store/navigation";

export default function TodayPage() {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentBodyRef = useRef<HTMLDivElement>(null);
  const restorePendingRef = useRef(false);
  const cancelRestoreRef = useRef<() => void>(() => {});
  const setTodayContext = useNavigationStore((state) => state.setTodayContext);
  const view = useNavigationStore((state) => state.todayContext.view);

  useLayoutEffect(() => {
    const node = contentRef.current;
    const body = contentBodyRef.current;
    const context = useNavigationStore.getState().todayContext;
    const target = view === "alerts" ? context.alertsScrollTop : context.scrollTop;
    if (!node || !body) return;
    node.scrollTop = 0;
    if (target <= 0) return;

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
  }, [view]);

  // Flex column (not a grid) at the root: MarketPulse carries a baked-in
  // `col-span-2` from its dashboard origins. In a grid that span conjures a
  // phantom second column and the content below only fills column one —
  // leaving the right half blank. As a flex child the span is inert and the
  // bar simply takes full width.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <MarketPulse />
      <div role="group" aria-label="Today views" className="flex shrink-0 gap-2 border-b border-border px-4 py-2">
        {([["plans", "Tracked plans"], ["alerts", "Standalone alerts"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setTodayContext({ view: value })} className={`rounded border px-3 py-2 text-sm font-medium ${view === value ? "border-[var(--clr-cyan)] bg-[var(--bg-3)] text-[var(--text-1)]" : "border-border text-[var(--text-2)]"}`}>{label}</button>)}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={contentRef}
          role="region"
          aria-label="Today workspace content"
          onScroll={(event) => {
            if (restorePendingRef.current) return;
            const scrollTop = event.currentTarget.scrollTop;
            const field = view === "alerts" ? "alertsScrollTop" : "scrollTop";
            if (scrollTop !== useNavigationStore.getState().todayContext[field]) {
              setTodayContext({ [field]: scrollTop });
            }
          }}
          onWheel={() => cancelRestoreRef.current()}
          onTouchStart={() => cancelRestoreRef.current()}
          onPointerDown={() => cancelRestoreRef.current()}
          onKeyDown={() => cancelRestoreRef.current()}
          className="min-w-0 flex-1 overflow-y-auto p-4"
        >
          <div ref={contentBodyRef} className="flex flex-col gap-3">
            {view === "plans" ? <TodaySetupPlans /> : <>
              <h1 className="text-base font-semibold text-[var(--text-1)]">Standalone alerts</h1>
              <TodayRulesPanel />
              <TodayHits />
              <TodayTimeline />
            </>}
          </div>
        </div>
      </div>
    </div>
  );
}
