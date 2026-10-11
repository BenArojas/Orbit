import type { RuleEvaluation, SetupPlan } from "@/modules/parallax/api";
import { formatTriggerConditionValue } from "@/components/triggers/formatTriggerCondition";

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
  const result = evaluation.invalidation_outcome === "matched" ? "Invalidation condition matched"
    : evaluation.outcome === "matched" ? "Waiting condition matched"
    : evaluation.outcome === "not_matched" ? "No match"
    : evaluation.outcome === "unavailable" ? "Check unavailable" : "Check failed";
  return `${hasCurrentRevision(plan, evaluation) ? "" : "Previous revision · "}${result}`;
}

export function monitoringLabel(plan: SetupPlan): string {
  return { not_monitored: "Manual review", not_checked: "Awaiting first check", healthy: "Monitoring current", unavailable: "Monitoring unavailable", overdue: "Monitoring overdue" }[plan.monitoring_health];
}

export function planGuidance(plan: SetupPlan, candidate = plan.review_evaluation ?? plan.latest_evaluation) {
  const latest = plan.latest_evaluation && hasCurrentRevision(plan, plan.latest_evaluation) ? plan.latest_evaluation : null;
  const manual = plan.monitoring_mode === "manual";
  const monitoringIssue = !manual && (plan.monitoring_health !== "healthy" || !latest ||
    latest.outcome === "failed" || latest.outcome === "unavailable" ||
    latest.invalidation_outcome === "failed" || latest.invalidation_outcome === "unavailable");
  const match = plan.unreviewed_match_count > 0 && candidate && isUnreviewedMatch(plan, candidate) ? candidate : null;
  const invalidation = match?.invalidation_outcome === "matched";
  const needsAttention = plan.unreviewed_match_count > 0 || monitoringIssue;
  const priority = invalidation ? 0 : plan.unreviewed_match_count > 0 ? 1 : monitoringIssue ? 2 : 3;
  const label = invalidation ? "Invalidation matched" : plan.unreviewed_match_count > 0 ? "Condition matched"
    : manual ? "Manual review" : monitoringIssue ? plan.monitoring_health === "not_checked" ? "Awaiting first check" : "Status unknown" : "Still watching";
  const change = invalidation ? "Your saved invalidation condition matched."
    : match ? "Your saved waiting conditions matched."
    : plan.unreviewed_match_count > 0 ? "An earlier condition match needs review."
    : manual ? "This plan is not checked automatically."
    : monitoringIssue ? plan.monitoring_health === "overdue" ? "Automatic checks are overdue."
      : plan.monitoring_health === "not_checked" ? "No automatic check has completed yet." : "Automatic monitoring is unavailable."
    : latest?.outcome === "matched" || latest?.invalidation_outcome === "matched" ? "The latest condition match has been reviewed."
    : "Your saved conditions have not matched.";
  const review = invalidation ? "Review whether your saved plan still holds."
    : plan.unreviewed_match_count > 0 ? "Review the chart against your saved conditions."
    : manual ? "Open the chart to review your saved intention."
    : monitoringIssue ? "Check the chart manually; current status is unknown."
    : "Keep watching for new evidence against your plan.";
  const evidence = manual ? null : match ?? latest;
  const invalidationEvidence = evidence?.invalidation_outcome === "matched" && (invalidation || evidence.outcome !== "matched");
  const values = evidence?.condition_values
    .filter((value) => invalidationEvidence ? value.condition_role === "invalidation" : value.condition_role !== "invalidation")
    .filter((value) => value.actual_value != null && Number.isFinite(value.actual_value))
    .map((value) => formatTriggerConditionValue(value).replace(" -> ", " · checked "))
    .join(" · ") ?? "";
  const evidenceText = evidence && (evidence.outcome === "matched" || evidence.outcome === "not_matched" || evidence.invalidation_outcome === "matched") ? values : "";
  const latestNote = match && latest && latest.id !== match.id && !monitoringIssue
    ? `Latest check: ${evaluationLabel(plan, latest)} · ${formatTime(latest.evidence_at ?? latest.checked_at)}. Earlier alert remains unreviewed.` : null;
  return { needsAttention, monitoringIssue, priority, label, change, review, evidence, evidenceText,
    latestNote,
    monitoring: monitoringIssue && plan.monitoring_health === "healthy" ? "Current evidence unavailable" : monitoringLabel(plan),
    tone: invalidation ? "danger" : monitoringIssue && !plan.unreviewed_match_count ? "warning" : needsAttention ? "active" : "quiet" };
}
