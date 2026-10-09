import { useQuery } from "@tanstack/react-query";
import { parallaxApi, type TriggerHit } from "@/modules/parallax/api";
import { useNavigationStore } from "@/store/navigation";
import { formatTriggerConditionValue } from "@/components/triggers/formatTriggerCondition";

export function TodayHits() {
  const navigateToAnalysis = useNavigationStore((state) => state.navigateToAnalysis);
  const { data: hits, isLoading, isError, refetch } = useQuery<TriggerHit[]>({
    queryKey: ["trigger-hits", "active"],
    queryFn: () => parallaxApi.getTriggerHits({ status: "active", limit: 200 }),
    staleTime: 15_000, refetchInterval: 30_000,
  });
  const groups = new Map<string, TriggerHit>();
  for (const hit of hits ?? []) {
    const key = `${hit.rule_id}:${hit.conid}`;
    const previous = groups.get(key);
    if (!previous || hit.id > previous.id) groups.set(key, hit);
  }
  const alerts = [...groups.values()];
  return <section aria-label="Quick alerts" className="space-y-3 text-base">
    <h2 className="text-lg font-semibold">{alerts.length ? `New alerts · ${alerts.length}` : "No new alerts"}</h2>
    {isLoading ? <p role="status">Loading alerts…</p> : isError ? <div><p role="alert" className="text-[var(--clr-red)]">Alerts could not be refreshed.</p><button type="button" onClick={() => void refetch()} className="underline">Retry</button></div>
      : !alerts.length ? <p className="text-[var(--text-2)]">Simple price or indicator alerts, without a trading plan.</p>
      : <div className="border-t border-[var(--border)]">{alerts.map((hit) => <button key={`${hit.rule_id}:${hit.conid}`} type="button" aria-label={`Open ${hit.symbol} ${hit.rule_name ?? "alert"} in Analysis`} onClick={() => navigateToAnalysis(hit.conid, hit.symbol, undefined, hit.id)} className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-4 text-left hover:bg-[var(--bg-2)]">
        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-baseline gap-2"><strong className="text-lg font-semibold">{hit.symbol}</strong><span>{hit.rule_name ?? "Deleted rule"}</span></span><span className="mt-1 block text-[var(--text-2)]">{hit.condition_values.map(formatTriggerConditionValue).join(" · ")}</span></span><span className="text-[var(--clr-cyan)]">Review →</span>
      </button>)}</div>}
  </section>;
}
