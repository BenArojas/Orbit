/**
 * TodayRulesPanel — compact rule list shown in the right rail of the Today
 * page. Each row has an LED toggle (enabled/disabled), the rule name, the
 * count of hits the rule has produced, and a hover-only delete affordance.
 *
 * The "+ Add rule" CTA is the existing `<RuleModal />` used with its
 * default trigger.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parallaxApi, type TriggerRule, type TriggerHit } from "@/modules/parallax/api";
import { RuleModal } from "@/components/triggers";

export function TodayRulesPanel() {
  const qc = useQueryClient();

  const { data: rules } = useQuery<TriggerRule[]>({
    queryKey: ["trigger-rules"],
    queryFn: () => parallaxApi.getTriggerRules(),
    staleTime: Infinity,
  });

  const { data: hits } = useQuery<TriggerHit[]>({
    queryKey: ["trigger-hits", "timeline"],
    queryFn: () => parallaxApi.getTriggerHits({ status: "all", limit: 200 }),
    staleTime: 30_000,
  });

  const hitsByRule = new Map<number, number>();
  (hits ?? []).forEach((h) =>
    hitsByRule.set(h.rule_id, (hitsByRule.get(h.rule_id) ?? 0) + 1),
  );

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      parallaxApi.updateTriggerRule(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trigger-rules"] }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => parallaxApi.deleteTriggerRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trigger-rules"] }),
  });

  return (
    <div className="rounded-md border border-border bg-[var(--bg-1)]">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)]">
          Rules · {rules?.length ?? 0}
        </span>
        <RuleModal />
      </div>
      {(rules ?? []).length === 0 ? (
        <div className="px-3 py-4 text-center text-[9.5px] text-[var(--text-3)]">
          No rules yet. Add one to start scanning.
        </div>
      ) : (
        (rules ?? []).map((r) => {
          const scope = r.watchlist_name
            ? r.watchlist_name
            : r.symbol ?? "—";
          const condSummary = r.conditions
            .map((c) => c.indicator)
            .join(" + ");
          return (
            <div
              key={r.id}
              className="group flex items-center gap-2 px-2 py-1 hover:bg-[var(--bg-3)]"
            >
              <button
                type="button"
                aria-label={r.enabled ? "Disable rule" : "Enable rule"}
                onClick={() => toggle.mutate({ id: r.id, enabled: !r.enabled })}
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: r.enabled
                    ? "var(--clr-green)"
                    : "var(--text-3)",
                  boxShadow: r.enabled ? "0 0 6px var(--clr-green)" : undefined,
                }}
              />
              {/* Click the rule body to open the editor pre-filled */}
              <RuleModal
                initial={{
                  id: r.id,
                  name: r.name,
                  enabled: r.enabled,
                  timeframe: r.timeframe,
                  scan_interval_seconds: r.scan_interval_seconds,
                  watchlist_name: r.watchlist_name,
                  conid: r.conid,
                  symbol: r.symbol,
                  template_id: r.template_id,
                  ibkr_mirror_target: r.ibkr_mirror_target,
                  conditions: r.conditions,
                }}
                trigger={
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    title={`${condSummary} · ${scope}`}
                  >
                    <span className="block truncate text-[10px] text-[var(--text-2)]">
                      {r.name}
                    </span>
                    <span className="block truncate text-[8.5px] text-[var(--text-3)]">
                      {condSummary} · {scope}
                    </span>
                  </button>
                }
              />
              <span className="shrink-0 font-data text-[9px] text-[var(--text-3)]">
                {hitsByRule.get(r.id) ?? 0}
              </span>
              <button
                type="button"
                aria-label="Delete rule"
                onClick={() => remove.mutate(r.id)}
                className="hidden shrink-0 text-[10px] text-[var(--text-3)] hover:text-[var(--clr-red)] group-hover:block"
              >
                ×
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
