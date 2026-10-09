import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parallaxApi, type TriggerHit } from "@/modules/parallax/api";
import { useNavigationStore } from "@/store/navigation";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { formatTriggerConditionValue } from "@/components/triggers/formatTriggerCondition";
import { formatTime, timeValue } from "./setupPlanPresentation";

export function TodayTimeline() {
  const open = useNavigationStore((state) => state.todayContext.alertHistoryOpen ?? false);
  const setTodayContext = useNavigationStore((state) => state.setTodayContext);
  const queryClient = useQueryClient();
  const { addHandler } = useWebSocket();
  const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);
  const { data: hits, isError } = useQuery<TriggerHit[]>({ queryKey: ["trigger-hits", "timeline"], queryFn: () => parallaxApi.getTriggerHits({ status: "all", limit: 200 }), staleTime: 30_000, refetchInterval: 60_000 });
  useEffect(() => addHandler((message: WsMessage) => { if (message.type === "trigger_alert") void queryClient.invalidateQueries({ queryKey: ["trigger-hits"] }); }), [addHandler, queryClient]);
  const groups = new Map<string, TriggerHit[]>();
  for (const hit of hits ?? []) { const key = `${hit.rule_id}:${hit.conid}`; const group = groups.get(key) ?? []; group.push(hit); groups.set(key, group); }
  for (const group of groups.values()) group.sort((left, right) => timeValue(right.triggered_at) - timeValue(left.triggered_at) || right.id - left.id);
  return <details open={open} onToggle={(event) => { if (event.currentTarget.open !== open) setTodayContext({ alertHistoryOpen: event.currentTarget.open }); }} className="workbench-surface workbench-disclosure text-base">
    <summary className="cursor-pointer py-2 font-medium">History</summary>
    {isError && <p role="alert" className="py-2 text-[var(--clr-red)]">Alert history could not be refreshed.</p>}
    {!hits?.length ? <p className="px-4 py-3 text-[var(--text-2)]">No alert history yet.</p> : [...groups.values()].map((group) => <details key={`${group[0].rule_id}:${group[0].conid}`} className="border-b border-[var(--border)] px-4 py-2">
      <summary className="cursor-pointer py-2">{group[0].symbol} · {group[0].rule_name ?? "Deleted rule"} · {group.length} alerts</summary>
      {group.map((hit) => <button key={hit.id} type="button" onClick={() => navigateToAnalysis(hit.conid, hit.symbol, undefined, hit.id)} className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 py-3 text-left hover:bg-[var(--bg-2)]">
        <time className="text-[15px] text-[var(--text-2)]">{formatTime(hit.triggered_at)}</time><span>{hit.condition_values.map(formatTriggerConditionValue).join(" · ")}</span>{hit.dismissed_at && <span className="text-[15px] text-[var(--text-2)]">Acknowledged</span>}
      </button>)}
    </details>)}
  </details>;
}
