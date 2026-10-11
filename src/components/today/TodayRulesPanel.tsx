import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parallaxApi, type TriggerHit, type TriggerRule } from "@/modules/parallax/api";
import { RuleModal } from "@/components/triggers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function TodayRulesPanel() {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<TriggerRule | null>(null);
  const { data: rules, isError } = useQuery<TriggerRule[]>({ queryKey: ["trigger-rules"], queryFn: () => parallaxApi.getTriggerRules(), staleTime: Infinity });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => parallaxApi.updateTriggerRule(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trigger-rules"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => parallaxApi.deleteTriggerRule(id),
    onSuccess: async (_, id) => {
      await Promise.all([queryClient.cancelQueries({ queryKey: ["trigger-rules"] }), queryClient.cancelQueries({ queryKey: ["trigger-hits"] })]);
      queryClient.setQueryData<TriggerRule[]>(["trigger-rules"], (items) => items?.filter((rule) => rule.id !== id));
      queryClient.setQueriesData<TriggerHit[]>({ queryKey: ["trigger-hits"] }, (items) => items?.filter((hit) => hit.rule_id !== id));
      void queryClient.invalidateQueries({ queryKey: ["trigger-rules"] });
      void queryClient.invalidateQueries({ queryKey: ["trigger-hits"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-tags"] });
      setDeleting(null);
    },
  });
  return <><details className="workbench-surface workbench-disclosure text-base">
    <summary className="cursor-pointer py-2 font-medium">Alert rules · {rules?.length ?? 0}</summary>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
      <p className="max-w-[60ch] text-[15px] text-[var(--text-2)]">Price or indicator checks without a saved plan.</p>
      <RuleModal trigger={<Button className="workbench-button workbench-primary"><Plus />Add alert</Button>} />
    </div>
    <div>
      {isError && <p role="alert" className="text-[var(--clr-red)]">Alert rules could not be loaded.</p>}
      {toggle.isError && <p role="alert" className="text-[var(--clr-red)]">The alert’s enabled state was not saved.</p>}
      {(rules ?? []).map((rule) => <div key={rule.id} className="workbench-row">
        <div className="min-w-0"><p className="break-words font-semibold text-[var(--text-1)]">{rule.name}</p><p className="mt-1 text-[15px] text-[var(--text-2)]">{rule.watchlist_name ?? rule.symbol}<span className="ml-3 rounded bg-[var(--bg-2)] px-2 py-0.5">{rule.timeframe}</span></p></div>
        <div className="workbench-row-actions">
          <label className="workbench-status min-h-10 cursor-pointer" data-active={rule.enabled}><input type="checkbox" aria-label={`Enable ${rule.name}`} checked={rule.enabled} disabled={toggle.isPending || remove.isPending} onChange={(event) => toggle.mutate({ id: rule.id, enabled: event.target.checked })} className="h-4 w-4 accent-[var(--clr-cyan)]" />{rule.enabled ? "Active" : "Paused"}</label>
          <RuleModal initial={rule} trigger={<Button variant="outline" className="workbench-button" aria-label={`Edit ${rule.name}`}><Pencil />Edit</Button>} />
          <Button variant="destructive" className="workbench-button workbench-danger workbench-icon" aria-label={`Delete ${rule.name}`} disabled={remove.isPending} onClick={() => { remove.reset(); setDeleting(rule); }}><Trash2 /></Button>
        </div>
      </div>)}
    </div>
  </details>
  <Dialog open={!!deleting} onOpenChange={(open) => { if (!open && !remove.isPending) setDeleting(null); }}>
    <DialogContent showCloseButton={!remove.isPending} className="border border-[var(--border)] bg-[var(--bg-0)] p-6 text-base sm:max-w-md">
      <DialogHeader><DialogTitle className="text-xl">Delete {deleting?.name}?</DialogTitle><DialogDescription className="text-base text-[var(--text-2)]">This removes the alert rule and its history. It cannot be undone.</DialogDescription></DialogHeader>
      {remove.isError && <p role="alert" className="text-[var(--clr-red)]">{remove.error.message || "The alert could not be deleted. Try again."}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" className="workbench-button" disabled={remove.isPending} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" className="workbench-button workbench-danger" disabled={remove.isPending} onClick={() => { if (deleting) remove.mutate(deleting.id); }}><Trash2 />{remove.isPending ? "Deleting…" : "Delete alert"}</Button></div>
    </DialogContent>
  </Dialog></>;
}
