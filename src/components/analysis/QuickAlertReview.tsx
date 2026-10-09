import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parallaxApi, type TriggerHit } from "@/modules/parallax/api";
import { useNavigationStore } from "@/store/navigation";
import { useDismissHit, useSnoozeHit } from "@/hooks/useHitMutations";
import { RuleModal } from "@/components/triggers";
import { formatTriggerConditionValue } from "@/components/triggers/formatTriggerCondition";
import { formatTime } from "@/components/today/setupPlanPresentation";

export function QuickAlertReview({ hitId, conid }: { hitId: number; conid: number | null }) {
  const queryClient = useQueryClient();
  const dismiss = useDismissHit();
  const snooze = useSnoozeHit();
  const hits = useQuery({ queryKey: ["trigger-hits", "timeline"], queryFn: () => parallaxApi.getTriggerHits({ status: "all", limit: 200 }), staleTime: 0 });
  const rules = useQuery({ queryKey: ["trigger-rules"], queryFn: () => parallaxApi.getTriggerRules(), staleTime: 0 });
  const hit = hits.data?.find((item) => item.id === hitId && item.conid === conid)
    ?? queryClient.getQueryData<TriggerHit[]>(["trigger-hits", "active"])?.find((item) => item.id === hitId && item.conid === conid);
  const rule = rules.data?.find((item) => item.id === hit?.rule_id);
  const returnToToday = () => {
    const navigation = useNavigationStore.getState();
    if (navigation.activeScreen === "analysis" && navigation.analysisContext.triggerHitId === hitId && navigation.analysisContext.conid === conid) navigation.navigate("today");
  };
  const pause = useMutation({ mutationFn: (id: number) => parallaxApi.updateTriggerRule(id, { enabled: false }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["trigger-rules"] }); returnToToday(); } });
  if (hits.isLoading && !hit) return <p role="status" className="text-base">Loading alert…</p>;
  if (hits.isError && !hit) return <div className="space-y-2 text-base"><p role="alert">This alert could not be loaded.</p><button type="button" onClick={() => void hits.refetch()} className="underline">Retry</button></div>;
  if (!hit) return <p role="status" className="text-base">This alert is no longer in the loaded history. Return to Today for current alerts.</p>;
  const pending = dismiss.isPending || snooze.isPending || pause.isPending;
  const broadBollinger = hit.condition_values.some((value) => value.indicator === "bbands" && value.condition === "above" && value.threshold === 0);

  return <section aria-label="Review quick alert" className="analysis-review">
    <header><div className="mb-3 flex items-center justify-between gap-2 text-[15px] text-[var(--text-2)]"><span className="flex items-center gap-2"><Bell size={16} />Quick alert</span><span className="workbench-status" data-active={!hit.dismissed_at}>{hit.dismissed_at ? <><Check size={15} />Acknowledged</> : "Needs review"}</span></div><h2>{hit.symbol}</h2><p className="mt-1 text-[var(--text-2)]">{hit.rule_name ?? "Deleted rule"}</p></header>
    <div className="review-evidence"><h3>Triggered condition</h3><p>{hit.condition_values.map(formatTriggerConditionValue).join(" · ")}</p><time><Clock3 size={15} className="mr-2 inline" />{formatTime(hit.triggered_at)}</time></div>
    {broadBollinger && <p className="review-note">0 is the lower Bollinger band. Above 0 is a broad condition.</p>}
    {!hit.dismissed_at && <div className="review-primary"><Button disabled={pending} onClick={() => dismiss.mutate(hit.id, { onSuccess: returnToToday })} className="workbench-button workbench-primary"><Check />{dismiss.isPending ? "Saving…" : "Dismiss alert"}</Button><p className="mt-2 text-[15px] text-[var(--text-2)]">Acknowledges this alert and returns to Today.</p></div>}
    {rule && <p className="text-[15px] text-[var(--text-2)]">{rule.ibkr_mirror_target ? "Mirrored watchlist rules retain their daily checks." : "Another alert appears only after the condition clears and matches again."}</p>}
    {rules.isError && <p role="alert" className="text-[var(--clr-red)]">Alert settings could not be loaded.</p>}
    {pause.isError && <p role="alert" className="text-[var(--clr-red)]">This alert could not be paused.</p>}
    <details className="workbench-disclosure review-actions"><summary>More</summary><div>
      {rule && <><RuleModal initial={rule} trigger={<Button variant="outline" className="workbench-button" disabled={pending}><Pencil />Edit alert</Button>} /><Button variant="outline" className="workbench-button" disabled={pending || !rule.enabled} onClick={() => pause.mutate(rule.id)}><Pause />{rule.enabled ? "Pause alert" : "Paused"}</Button></>}
      <Button variant="outline" className="workbench-button" disabled={pending || !!hit.dismissed_at} onClick={() => snooze.mutate({ id: hit.id, minutes: 60 }, { onSuccess: returnToToday })}><Clock3 />Snooze 1h</Button>
    </div></details>
  </section>;
}
import { Bell, Check, Clock3, Pencil, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import "@/components/today/workbench.css";
