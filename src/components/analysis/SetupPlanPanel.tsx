import { useEffect, useState } from "react";
import { useNavigationStore } from "@/store/navigation";
import { ConditionsList } from "@/components/triggers/ConditionsList";
import { formatTriggerCondition } from "@/components/triggers/formatTriggerCondition";
import { useChartStore } from "@/store/chart";
import { useCompareStore } from "@/store/compare";
import { validConditions, type SetupPlanDraft, type SetupPlanEditor } from "./useSetupPlanEditor";
import { SetupPlanReview } from "./SetupPlanReview";
import { Button } from "@/components/ui/button";

export function SetupPlanPanel({
  conid,
  symbol,
  editor,
}: {
  conid: number | null;
  symbol: string;
  editor: SetupPlanEditor;
}) {
  const returnTo = useNavigationStore((state) => state.analysisContext.returnTo);
  const [editing, setEditing] = useState(false);
  const reviewFromToday = returnTo === "today" && editor.planId != null;
  useEffect(() => setEditing(false), [editor.planId, conid]);
  useEffect(() => { if (editor.saved) setEditing(false); }, [editor.saved]);
  if (!editor.ibkrReady) return <p className="text-[15px] text-[var(--text-3)]">Connect to IBKR to manage setup plans.</p>;
  if (editor.providerScopeLoading) return <p role="status" className="text-[15px] text-[var(--text-3)]">Checking the selected IBKR account…</p>;
  if (editor.providerScopeError) return <div className="space-y-2"><p role="alert" className="text-[15px] text-[var(--clr-red)]">Could not verify IBKR’s selected account.</p><button type="button" onClick={editor.retryProviderScope} className="rounded border border-[var(--border)] px-2 py-1 text-[15px]">Retry</button></div>;
  if (editor.accountMismatch) return <p role="alert" className="text-[15px] text-[var(--clr-orange)]">MoonMarket is set to {editor.selectedAccountId}, but IBKR is using {editor.providerSelectedAccountId}. Change the MoonMarket selection to view or edit setup plans.</p>;
  if (!editor.accountId) return <p role="status" className="text-[15px] text-[var(--text-3)]">No provider-selected IBKR account is available.</p>;
  if (!editor.scopeReady) return <p role="status" className="text-[15px] text-[var(--text-3)]">Waiting for the MoonMarket account selection to match IBKR…</p>;
  if (!editor.contextReady) return <p role="status" className="text-[15px] text-[var(--text-3)]">Preparing setup plan…</p>;
  if (editor.isLoadingPlan) return <p role="status" className="text-[15px] text-[var(--text-3)]">Loading setup plan…</p>;
  if (editor.loadError && !editor.invalidPlan) return <div className="space-y-2"><p role="alert" className="text-[15px] text-[var(--clr-red)]">{editor.loadError}</p><button type="button" onClick={editor.retryLoad} className="rounded border border-[var(--border)] px-2 py-1 text-[15px]">Retry</button></div>;
  if (reviewFromToday && !editing && !editor.invalidPlan && editor.plan) return <SetupPlanReview editor={editor} onEdit={() => setEditing(true)} />;

  return (
    <section aria-label="Setup plan" className="min-w-0 space-y-3 text-base">
      <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
        <div>
          <h2 className="font-semibold text-[var(--text-1)]">{editor.planId == null ? `Create plan for ${symbol}` : `Edit ${symbol} plan #${editor.planId}`}</h2>
        </div>
      </div>
      {reviewFromToday ? <Button variant="outline" className="workbench-button" disabled={editor.savePending} onClick={() => {
        if (editor.dirty && !window.confirm("Discard unsaved setup plan changes?")) return;
        editor.discardChanges(); setEditing(false);
      }}>Cancel editing</Button> : <>
      <button type="button" disabled={editor.savePending || !conid} onClick={editor.startNewPlan} className="w-full rounded border border-[var(--border)] px-3 py-2 text-[15px] font-semibold">New plan for {symbol || "this symbol"}</button>
      <label className="block space-y-1 text-[15px] text-[var(--text-2)]">
        <span>Existing plans for {symbol}</span>
        <select aria-label={`Existing plans for ${symbol}`} disabled={editor.savePending || editor.plansLoading} value={editor.planId ?? "new"} onChange={(event) => event.target.value === "new" ? editor.startNewPlan() : editor.selectPlan(Number(event.target.value))} className="h-9 w-full min-w-0 rounded border border-[var(--border)] bg-[var(--bg-0)] px-2">
          <option value="new">Create a new plan</option>
          {editor.planId != null && !editor.plans.some((plan) => plan.id === editor.planId) && <option value={editor.planId}>Current plan #{editor.planId}</option>}
          {editor.plans.map((plan) => <option key={plan.id} value={plan.id}>#{plan.id} · {plan.setup_type.replace(/_/g, " ")} · {plan.waiting_intention}</option>)}
        </select>
      </label>
      {editor.plansError && <p role="status" className="text-[15px] text-[var(--clr-orange)]">Other plans could not be loaded. <button type="button" onClick={editor.retryPlans} className="underline">Retry</button></p>}
      </>}
      {editor.loadError && editor.invalidPlan && <p role="alert" className="text-[15px] text-[var(--clr-orange)]">{editor.loadError}</p>}
      {!conid ? <p role="status" className="text-[15px] text-[var(--text-3)]">Open a verified stock in Names to track a setup.</p> : (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); editor.submit(); }}>
          <fieldset disabled={editor.savePending} className="space-y-3 disabled:opacity-70">
            <legend className="sr-only">Setup plan details</legend>
          <label className="block space-y-1">
            <span className="text-[15px] text-[var(--text-3)]">Setup type</span>
            <select value={editor.draft.setup_type} onChange={(event) => editor.updateDraft({ setup_type: event.target.value as SetupPlanDraft["setup_type"] })} className="h-10 w-full rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 text-[15px]">
              <option value="pullback">Pullback</option>
              <option value="breakout">Breakout</option>
              <option value="breakout_retest">Breakout retest</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[15px] text-[var(--text-3)]">What are you waiting for?</span>
            <textarea required maxLength={500} rows={3} value={editor.draft.waiting_intention} onChange={(event) => editor.updateDraft({ waiting_intention: event.target.value })} className="w-full resize-y rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 py-1.5 text-[15px]" placeholder="Describe the price action you want to review." />
          </label>
          {!editor.draft.waiting_intention.trim() && <p role="status" className="text-[15px] text-[var(--text-3)]">Describe what you are waiting for before saving.</p>}
          <label className="block space-y-1">
            <span className="text-[15px] text-[var(--text-3)]">Monitoring mode</span>
            <select value={editor.draft.monitoring_mode} onChange={(event) => editor.updateDraft({ monitoring_mode: event.target.value as SetupPlanDraft["monitoring_mode"] })} className="h-10 w-full rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 text-[15px]">
              <option value="manual">Manual review</option>
              <option value="automatic">Automatic conditions</option>
            </select>
          </label>
          {editor.draft.monitoring_mode === "automatic" && <div className="space-y-2 rounded border border-[var(--border)] p-2">
            <p className="text-[15px] text-[var(--text-2)]">Setup type is your trading idea. A condition match requests review of that idea.</p>
            <button type="button" onClick={() => editor.updateDraft({ conditions: [{ indicator: "close", condition: "above", threshold: null, news_candle_method: null }] })} className="rounded border border-[var(--border)] px-2 py-1.5 text-[15px]">{editor.draft.conditions.length ? "Replace with a price alert" : "Add price alert"}</button>
            <p className="text-[15px] text-[var(--text-3)]">Use Price for a simple alert, or choose an indicator and add custom conditions below.</p>
            <ConditionsList value={editor.draft.conditions} onChange={(conditions) => editor.updateDraft({ conditions })} />
            {!validConditions(editor.draft.conditions) && <p role="status" className="text-[15px] text-[var(--text-3)]">Add at least one complete supported condition before saving.</p>}
            <label className="block space-y-1">
              <span className="text-[15px] text-[var(--text-2)]">Check timeframe</span>
              <select value={editor.draft.timeframe} onChange={(event) => editor.updateDraft({ timeframe: event.target.value as SetupPlanDraft["timeframe"] })} className="h-10 w-full rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 text-[15px]">
                {["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W", "1M"].map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
              </select>
            </label>
            {editor.planId != null && <button type="button" onClick={() => {
              const compare = useCompareStore.getState();
              if (compare.active) compare.setPaneTimeframe(compare.panes[0].id, editor.draft.timeframe);
              else useChartStore.getState().setTimeframe(editor.draft.timeframe);
            }} className="rounded border border-[var(--border)] px-2 py-1.5 text-[15px]">View {editor.draft.timeframe} check timeframe</button>}
            <p className="text-[15px] leading-relaxed text-[var(--text-2)]">{validConditions(editor.draft.conditions) ? `Request review when ${editor.draft.conditions.map(formatTriggerCondition).join(" and ")}, using the latest available ${editor.draft.timeframe} candle (may be forming).` : "Complete the conditions to preview the check."} US sessions include extended hours; a match does not confirm the whole setup.</p>
          </div>}
          <label className="block space-y-1">
            <span className="text-[15px] text-[var(--text-3)]">Invalidation reference</span>
            <input type="text" maxLength={500} value={editor.draft.invalidation_reference} onChange={(event) => editor.updateDraft({ invalidation_reference: event.target.value })} className="h-10 w-full rounded border border-[var(--border)] bg-[var(--bg-0)] px-2 text-[15px]" placeholder="Optional price or chart reference" />
          </label>
          <p className="text-[15px] leading-relaxed text-[var(--text-3)]">Planning reference only. It is not an order or guaranteed stop fill, and it is not automatically checked.</p>
          {editor.saveError && <p role="alert" className="text-[15px] text-[var(--clr-red)]">Could not save this setup: {editor.saveError}</p>}
          {editor.saved && <div className="flex items-center justify-between gap-2 rounded border border-[var(--clr-green)]/40 bg-[var(--clr-green)]/10 px-2 py-1.5 text-[15px] text-[var(--clr-green)]"><span role="status">Setup saved.</span><button type="button" onClick={() => useNavigationStore.getState().navigate("today")} className="font-semibold underline">Open Today</button></div>}
          <button type="submit" disabled={!editor.isValid || !editor.dirty || editor.invalidPlan || !conid} className="w-full rounded bg-[var(--clr-cyan)] px-3 py-2 text-[15px] font-semibold text-[var(--bg-0)] disabled:cursor-not-allowed disabled:opacity-50">
            {editor.savePending ? "Saving…" : editor.planId == null ? "Track setup in Today" : "Save plan changes"}
          </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
