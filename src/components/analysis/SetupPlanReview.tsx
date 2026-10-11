import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Square, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import "@/components/today/workbench.css";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parallaxApi, type SetupPlan, type SetupPlanDetail } from "@/modules/parallax/api";
import { useAccountStore, useOrbitAccountContext } from "@/orbit/accountContext";
import { useNavigationStore } from "@/store/navigation";
import { formatTriggerCondition, formatTriggerConditionValue } from "@/components/triggers/formatTriggerCondition";
import { evaluationLabel, formatTime, isUnreviewedMatch, planGuidance, setupLabel } from "@/components/today/setupPlanPresentation";
import type { SetupPlanEditor } from "./useSetupPlanEditor";

type ActionScope = { accountId: string; accountMode: "paper" | "live"; sessionEpoch: number; planId: number; conid: number };

export function SetupPlanReview({ editor, onEdit }: { editor: SetupPlanEditor; onEdit: () => void }) {
  const plan = editor.plan!;
  const { refetchAccounts } = useOrbitAccountContext();
  const queryClient = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scopeRef = useRef<ActionScope | null>(null);
  scopeRef.current = editor.ibkrReady && editor.scopeReady && editor.contextReady && !editor.invalidPlan && editor.planId === plan.id
    ? { accountId: plan.account_id, accountMode: plan.account_mode, sessionEpoch: useNavigationStore.getState().namesContext.brokerSessionEpoch, planId: plan.id, conid: plan.conid }
    : null;
  const isCurrent = (scope: ActionScope) => {
    const current = scopeRef.current;
    const navigation = useNavigationStore.getState();
    const account = useAccountStore.getState().selectedAccount();
    return mounted.current && current?.accountId === scope.accountId && current.accountMode === scope.accountMode && current.sessionEpoch === scope.sessionEpoch && current.planId === scope.planId &&
      navigation.activeScreen === "analysis" && navigation.analysisContext.setupPlanId === scope.planId && navigation.analysisContext.conid === scope.conid &&
      navigation.namesContext.brokerSessionEpoch === scope.sessionEpoch && useAccountStore.getState().selectedAccountId === scope.accountId &&
      (account ? account.is_paper ? "paper" : "live" : "unknown") === scope.accountMode;
  };
  const action = useMutation({
    mutationFn: async ({ scope, archive, evaluationIds }: { scope: ActionScope; archive: boolean; evaluationIds: number[] }) => {
      if (!isCurrent(scope)) throw new Error("The IBKR account or plan changed. Reopen this plan.");
      const latest = await refetchAccounts();
      const selected = latest?.accounts.find((account) => account.account_id === latest.selected_account_id);
      if (!isCurrent(scope) || latest?.selected_account_id !== scope.accountId || !selected || (selected.is_paper ? "paper" : "live") !== scope.accountMode) {
        throw new Error("The IBKR account or plan changed. Reopen this plan.");
      }
      return archive ? parallaxApi.archiveSetupPlan(scope.planId) : parallaxApi.reviewSetupPlan(scope.planId, evaluationIds);
    },
    onSuccess: (updated, { scope, archive }) => {
      if (!isCurrent(scope) || updated.id !== scope.planId || updated.account_id !== scope.accountId || updated.account_mode !== scope.accountMode) return;
      const listKey = ["parallax", "setup-plans", scope.accountId, scope.accountMode, scope.sessionEpoch];
      queryClient.setQueryData<SetupPlanDetail>(["parallax", "setup-plan", scope.accountId, scope.accountMode, scope.sessionEpoch, scope.planId], updated);
      queryClient.setQueryData<SetupPlan[]>(listKey, (plans) => plans?.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      void queryClient.invalidateQueries({ queryKey: listKey });
      if (!isCurrent(scope)) return;
      const navigation = useNavigationStore.getState();
      navigation.setTodayContext({ selectedPlanId: archive ? null : scope.planId, watchingOpen: !archive });
      navigation.navigate("today");
    },
  });
  const matches = plan.unreviewed_matches.filter((evaluation) => isUnreviewedMatch(plan, evaluation));
  const guidance = planGuidance(plan, matches.find((evaluation) => evaluation.invalidation_outcome === "matched") ?? matches[0] ?? plan.latest_evaluation);
  const apply = (archive: boolean) => {
    const scope = scopeRef.current;
    if (!scope || action.isPending || (!archive && !matches.length)) return;
    action.mutate({ scope, archive, evaluationIds: matches.map((evaluation) => evaluation.id) });
  };

  return <section aria-label="Review setup plan" className="analysis-review">
    <header><div className="mb-3 flex items-center justify-between gap-2 text-[15px] text-[var(--text-2)]"><span className="flex items-center gap-2"><Eye size={16} />Tracked plan</span><span className="workbench-status" data-tone={guidance.tone}>{guidance.label}</span></div><h2>{plan.symbol}</h2><p className="mt-1 text-[var(--text-2)]">{setupLabel(plan.setup_type)}</p></header>
    <p className="text-[var(--text-1)]">{plan.waiting_intention}</p>
    {plan.monitoring_mode === "automatic" ? <div className="review-evidence">
      <h3>{matches.length ? "Change to review" : "Automatic check"}</h3>
      <p className="font-medium text-[var(--text-1)]">{guidance.change}</p>
      <p className="mb-3 text-[var(--text-2)]">{guidance.review}</p>
      {guidance.latestNote && <p className="mb-3 text-[15px] text-[var(--text-2)]">{guidance.latestNote}</p>}
      <p>{plan.rule?.conditions.map(formatTriggerCondition).join(" · ") || "Conditions unavailable"}{plan.rule && ` · ${plan.rule.timeframe}`}</p>
      {matches.length ? <ul className="space-y-2">{matches.map((evaluation) => <li key={evaluation.id}>
        <p className="font-medium">{evaluationLabel(plan, evaluation)}</p>
        <p>{evaluation.condition_values.map(formatTriggerConditionValue).join(" · ") || evaluationLabel(plan, evaluation)}</p>
        <time className="text-[15px] text-[var(--text-2)]">{formatTime(evaluation.evidence_at ?? evaluation.checked_at)}</time>
      </li>)}</ul> : guidance.evidenceText ? <p className="text-[15px] text-[var(--text-2)]">{guidance.evidenceText}<br />Evidence {formatTime(guidance.evidence?.evidence_at ?? guidance.evidence?.checked_at ?? null)}{guidance.monitoringIssue && " · Historical check; current status unknown"}</p> : <p className="text-[15px] text-[var(--text-2)]">{guidance.monitoring}</p>}
    </div> : <p className="text-[var(--text-2)]">Manual review · no automatic condition.</p>}
    {guidance.monitoringIssue && <p role="status" className="text-[15px] text-[var(--clr-orange)]">{guidance.monitoring}. Current status is unknown.{matches.length > 0 && " Earlier alerts remain available for review."}</p>}
    {matches.length > 0 && <div className="review-primary"><Button disabled={action.isPending} onClick={() => apply(false)} className="workbench-button workbench-primary"><Check />{action.isPending ? "Saving…" : "Keep watching"}</Button><p className="mt-2 text-[15px] text-[var(--text-2)]">Marks these alerts reviewed. Tracking continues.</p></div>}
    {action.isError && !confirmArchive && <p role="alert" className="text-[var(--clr-red)]">{action.error.message || "The action was not saved."}</p>}
    <details className="workbench-disclosure review-actions"><summary>More</summary><div>
      <Button variant="outline" className="workbench-button" disabled={action.isPending} onClick={onEdit}><Pencil />Edit plan</Button>
      <Button variant="destructive" className="workbench-button workbench-danger" disabled={action.isPending} onClick={() => { action.reset(); setConfirmArchive(true); }}><Square />Stop tracking</Button>
    </div></details>
    <Dialog open={confirmArchive} onOpenChange={(open) => { if (!action.isPending) setConfirmArchive(open); }}>
      <DialogContent showCloseButton={!action.isPending} className="border border-[var(--border)] bg-[var(--bg-0)] p-6 text-base sm:max-w-md">
        <DialogHeader><DialogTitle className="text-xl">Stop tracking {plan.symbol}?</DialogTitle><DialogDescription className="text-base text-[var(--text-2)]">Monitoring stops. Your plan and its history are retained.</DialogDescription></DialogHeader>
        {action.isError && <p role="alert" className="text-[var(--clr-red)]">{action.error.message || "The action was not saved. Try again."}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" className="workbench-button" disabled={action.isPending} onClick={() => setConfirmArchive(false)}>Cancel</Button><Button variant="destructive" className="workbench-button workbench-danger" disabled={action.isPending} onClick={() => apply(true)}>{action.isPending ? "Saving…" : "Stop tracking"}</Button></div>
      </DialogContent>
    </Dialog>
  </section>;
}
