import { useLayoutEffect, useRef } from "react";
import {
  TodayHits,
  TodaySetupPlans,
  TodayTimeline,
  TodayRulesPanel,
} from "@/components/today";
import { useNavigationStore } from "@/store/navigation";
import "@/components/today/workbench.css";

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

  return (
    <div className="today-workspace flex h-full flex-col overflow-hidden">
      <header className="mx-auto w-full max-w-6xl shrink-0 px-6 pt-5 pb-3"><h1 className="text-2xl font-semibold text-[var(--text-1)]">Today</h1><p className="mt-1 text-base text-[var(--text-2)]">What needs your attention.</p></header>
      <div className="mx-auto w-full max-w-6xl shrink-0 px-6 pb-4"><div role="tablist" aria-label="Today views" className="today-tabs">
        {([["plans", "Tracked plans"], ["alerts", "Quick alerts"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" id={`today-${value}`} aria-controls="today-content" aria-selected={view === value} onClick={() => setTodayContext({ view: value })}>{label}</button>)}
      </div></div>
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
          className="min-w-0 flex-1 overflow-y-auto px-6 pb-6"
        >
          <div id="today-content" role="tabpanel" aria-labelledby={`today-${view}`} ref={contentBodyRef} className="mx-auto flex max-w-[1104px] flex-col gap-5">
            {view === "plans" ? <TodaySetupPlans /> : <>
              <TodayHits />
              <TodayRulesPanel />
              <TodayTimeline />
            </>}
          </div>
        </div>
      </div>
    </div>
  );
}
