import type { RuleEvaluation, SetupPlan } from "@/modules/parallax/api";

export function setupLabel(type: SetupPlan["setup_type"]): string {
  return type === "breakout_retest" ? "Breakout retest" : type === "pullback" ? "Pullback" : "Breakout";
}

export function timeValue(value: string): number {
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(" ", "T")}Z`);
}

export function formatTime(value: string | null): string {
  if (!value) return "Time unavailable";
  const date = new Date(timeValue(value));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function hasCurrentRevision(plan: SetupPlan, evaluation: RuleEvaluation): boolean {
  return evaluation.plan_id === plan.id && evaluation.plan_revision === plan.revision &&
    evaluation.rule_id === plan.rule?.id && evaluation.rule_revision === plan.rule?.revision;
}

export function isUnreviewedMatch(plan: SetupPlan, evaluation: RuleEvaluation): boolean {
  return plan.lifecycle === "active" && hasCurrentRevision(plan, evaluation) && evaluation.reviewed_at == null &&
    (evaluation.outcome === "matched" || evaluation.invalidation_outcome === "matched");
}

export function evaluationLabel(plan: SetupPlan, evaluation: RuleEvaluation): string {
  const result = evaluation.outcome === "matched" ? "Waiting condition matched"
    : evaluation.invalidation_outcome === "matched" ? "Invalidation condition matched"
    : evaluation.outcome === "not_matched" ? "No match"
    : evaluation.outcome === "unavailable" ? "Check unavailable" : "Check failed";
  return `${hasCurrentRevision(plan, evaluation) ? "" : "Previous revision · "}${result}`;
}

export function monitoringLabel(plan: SetupPlan): string {
  return { not_monitored: "Manual review", not_checked: "Awaiting first check", healthy: "Monitoring current", unavailable: "Monitoring unavailable", overdue: "Monitoring overdue" }[plan.monitoring_health];
}
