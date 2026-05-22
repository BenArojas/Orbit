/**
 * TriggersTab — View and toggle trigger rules relevant to the active instrument.
 *
 * Shows every rule that targets the current stock either as a per-stock
 * override (rule.conid === activeConid) or via a watchlist whose name is
 * known (rule.watchlist_name set). Rules under the new multi-condition
 * schema describe ALL conditions joined by AND on the same bar.
 *
 * Allows enabling/disabling rules inline. Creation/edit still happens
 * from the dedicated RuleModal surfaced on the Today page.
 *
 * Rules:
 *   - Filters by conid (never by ticker string).
 *   - All updates go through FastAPI (/triggers/rules/{id}).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TriggerRule, TriggerCondition } from "@/lib/api";

interface TriggersTabProps {
  /** IBKR contract ID of the currently displayed instrument */
  activeConid: number | null;
  /** Display symbol — shown in empty state */
  activeSymbol: string;
}

/** Format conditions into a one-line summary: "rsi below 30 AND ema_200 above 0". */
function summarizeConditions(conds: TriggerCondition[]): string {
  if (!conds.length) return "(no conditions)";
  return conds
    .map((c) => {
      const op = c.condition.replace(/_/g, " ");
      const thr = c.threshold ?? "";
      return `${c.indicator} ${op}${thr !== "" ? ` ${thr}` : ""}`;
    })
    .join(" AND ");
}

/** Compact label for a trigger rule */
function RuleRow({
  rule,
  onToggle,
}: {
  rule: TriggerRule;
  onToggle: (enabled: boolean) => void;
}) {
  const summary = summarizeConditions(rule.conditions);
  const scopeLabel = rule.watchlist_name
    ? `watchlist: ${rule.watchlist_name}`
    : rule.symbol
      ? `stock: ${rule.symbol}`
      : null;

  return (
    <div
      className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-0)] px-2.5 py-2"
      data-testid="trigger-rule-row"
    >
      {/* Enable toggle */}
      <button
        onClick={() => onToggle(!rule.enabled)}
        title={rule.enabled ? "Disable rule" : "Enable rule"}
        className={`mt-0.5 flex h-4 w-7 flex-shrink-0 items-center rounded-full border transition-colors ${
          rule.enabled
            ? "border-[var(--clr-green)] bg-[var(--clr-green)]"
            : "border-[var(--border)] bg-[var(--bg-2)]"
        }`}
        aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
      >
        <span
          className={`ml-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
            rule.enabled ? "translate-x-3" : "translate-x-0"
          }`}
        />
      </button>

      {/* Rule details */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[11px] font-medium text-[var(--text-1)]">
          {rule.name}
        </span>
        <span className="truncate text-[10px] text-[var(--text-3)]">
          {summary} · {rule.timeframe}
        </span>
        {scopeLabel && (
          <span className="truncate text-[9px] text-[var(--text-3)]">
            {scopeLabel}
            {rule.ibkr_mirror_target ? ` → ${rule.ibkr_mirror_target}` : ""}
          </span>
        )}
      </div>

      {/* Status badge */}
      <span
        className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${
          rule.enabled
            ? "bg-[rgba(0,212,100,0.12)] text-[var(--clr-green)]"
            : "bg-[var(--bg-2)] text-[var(--text-3)]"
        }`}
      >
        {rule.enabled ? "ON" : "OFF"}
      </span>
    </div>
  );
}

export default function TriggersTab({
  activeConid,
  activeSymbol,
}: TriggersTabProps) {
  const qc = useQueryClient();

  const { data: allRules, isLoading, isError } = useQuery({
    queryKey: ["trigger-rules"],
    queryFn: () => api.getTriggerRules(),
    staleTime: 15_000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.updateTriggerRule(id, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trigger-rules"] });
    },
  });

  // Per-stock rules for this conid. Watchlist-scoped rules aren't shown
  // here because membership isn't trivially available client-side — they
  // surface on the Today page, which is the authoritative cockpit.
  const rules: TriggerRule[] = activeConid
    ? (allRules ?? []).filter((r) => r.conid === activeConid)
    : [];

  // ── Render ──

  if (!activeConid) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-center text-[11px] text-[var(--text-3)]">
          Select a symbol to view its trigger rules.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto px-4 py-3">
      {/* Header */}
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
        {activeSymbol || "Symbol"} — Trigger Rules
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-4 text-[11px] text-[var(--text-3)]">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--clr-cyan)] border-t-transparent" />
          Loading rules…
        </div>
      )}

      {isError && (
        <p className="rounded-md border border-[var(--clr-red)] bg-[rgba(255,68,102,0.08)] px-2 py-1.5 text-[10px] text-[var(--clr-red)]">
          Failed to load trigger rules.
        </p>
      )}

      {!isLoading && !isError && rules.length === 0 && (
        <div className="rounded-lg bg-[var(--bg-0)] px-3 py-4 text-center text-[11px] text-[var(--text-3)]">
          No per-stock rules for {activeSymbol || "this symbol"}.
          <br />
          <span className="text-[10px]">
            Watchlist-scoped rules are managed from the Today page.
          </span>
        </div>
      )}

      {rules.map((rule) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          onToggle={(enabled) =>
            toggleMutation.mutate({ id: rule.id, enabled })
          }
        />
      ))}

      {toggleMutation.isError && (
        <p className="rounded-md border border-[var(--clr-red)] bg-[rgba(255,68,102,0.08)] px-2 py-1.5 text-[10px] text-[var(--clr-red)]">
          {(toggleMutation.error as Error)?.message ?? "Failed to update rule"}
        </p>
      )}
    </div>
  );
}
