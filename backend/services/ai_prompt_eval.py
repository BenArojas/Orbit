from __future__ import annotations

import re
from dataclasses import dataclass, field
from types import MappingProxyType

from services.ai import parse_signal_from_response
from services.ai_signal_validation import AISignalGroundingError, ValidatedSignal, validate_signal_draft
from tests.fixtures.ai_prompt_eval_cases import PromptEvalCase

_FACT_CITATION = re.compile(r"\[([A-Za-z0-9_.]+)\]")

PROMPT_EVAL_WEIGHTS = MappingProxyType(
    {
        "factual_grounding": 35,
        "direction_consistency": 20,
        "actionability": 15,
        "caution_coverage": 10,
        "concision": 10,
        "schema_reliability": 10,
    }
)

_MIN_MEAN_IMPROVEMENT = 2.0
_MAX_CASE_REGRESSION = 10.0
_MAX_COST_LATENCY_REGRESSION = 0.10


@dataclass(frozen=True)
class PromptEvalResult:
    case_id: str
    eligible: bool
    weighted_score: int
    dimension_scores: dict[str, int]
    hard_failures: list[str]


@dataclass(frozen=True)
class PromptEvalSummary:
    candidate: str
    weighted_mean: float
    per_case_scores: dict[str, float]
    hard_gate_failures: int
    mean_actual_cost_usd: float | None
    mean_latency_ms: float | None


@dataclass(frozen=True)
class CandidateDecision:
    accepted: bool
    reasons: list[str] = field(default_factory=list)


def _cited_fact_ids(*texts: str) -> set[str]:
    cited: set[str] = set()
    for text in texts:
        cited.update(_FACT_CITATION.findall(text))
    return cited


def grade_prompt_output(case: PromptEvalCase, output: str) -> PromptEvalResult:
    raw = parse_signal_from_response(output)
    if raw is None:
        return PromptEvalResult(case.case_id, False, 0, {}, ["invalid_json"])
    if case.insufficient_for_levels and any(
        (raw.get(level_name) or {}).get("price") is not None
        for level_name in ("entry", "stop", "target")
    ):
        return PromptEvalResult(
            case.case_id,
            False,
            0,
            {},
            ["numeric_level_in_insufficient_case"],
        )

    try:
        validated = validate_signal_draft(raw, grounding_map=case.grounding_map)
    except AISignalGroundingError as exc:
        message = str(exc).lower()
        if "neutral cannot contain numeric" in message:
            hard_failures = ["neutral_has_numeric_levels"]
        elif "geometry" in message:
            hard_failures = ["invalid_geometry"]
        elif (
            "invalid signal schema" in message
            or "requires numeric" in message
            or "requires a numeric price and source_fact_id" in message
        ):
            hard_failures = ["invalid_schema"]
        else:
            hard_failures = ["grounding_error"]
        return PromptEvalResult(case.case_id, False, 0, {}, hard_failures)

    hard_failures: list[str] = []
    if validated.direction not in case.allowed_directions:
        hard_failures.append("direction_not_allowed")

    cited = _cited_fact_ids(
        validated.description,
        *validated.confirmations,
        *validated.cautions,
    )
    if cited - case.allowed_fact_ids:
        hard_failures.append("cited_unknown_fact")

    if case.insufficient_for_levels and validated.entry.price is not None:
        hard_failures.append("numeric_level_in_insufficient_case")

    if hard_failures:
        return PromptEvalResult(case.case_id, False, 0, {}, hard_failures)

    dimension_scores = _score_dimensions(case, validated, cited)
    weighted = sum(
        round(dimension_scores[name] * weight / 100)
        for name, weight in PROMPT_EVAL_WEIGHTS.items()
    )
    return PromptEvalResult(case.case_id, True, weighted, dimension_scores, [])


def _score_dimensions(
    case: PromptEvalCase,
    validated: ValidatedSignal,
    cited: set[str],
) -> dict[str, int]:
    grounding = 100 if cited and cited <= case.allowed_fact_ids else 70
    direction = 100 if validated.direction in case.allowed_directions else 0
    actionability = 100 if case.insufficient_for_levels or validated.entry.price is not None else 60
    caution_text = " ".join(validated.cautions).lower()
    covered = sum(1 for concept in case.required_caution_concepts if concept in caution_text)
    caution = (
        100
        if not case.required_caution_concepts
        else round(100 * covered / len(case.required_caution_concepts))
    )
    concision = 100 if len(validated.description) <= 600 else 70
    schema = 100
    return {
        "factual_grounding": grounding,
        "direction_consistency": direction,
        "actionability": actionability,
        "caution_coverage": caution,
        "concision": concision,
        "schema_reliability": schema,
    }


def compare_candidates(
    baseline: PromptEvalSummary,
    candidate: PromptEvalSummary,
) -> CandidateDecision:
    reasons: list[str] = []

    if candidate.hard_gate_failures > 0:
        reasons.append("hard_gate_failure")
    if candidate.weighted_mean - baseline.weighted_mean < _MIN_MEAN_IMPROVEMENT:
        reasons.append("insufficient_improvement")

    for case_id, base_score in baseline.per_case_scores.items():
        cand_score = candidate.per_case_scores.get(case_id, 0.0)
        if base_score - cand_score > _MAX_CASE_REGRESSION:
            reasons.append("case_regression")
            break

    if _telemetry_missing(baseline, candidate):
        reasons.append("telemetry_missing")
    else:
        assert baseline.mean_actual_cost_usd is not None
        assert baseline.mean_latency_ms is not None
        assert candidate.mean_actual_cost_usd is not None
        assert candidate.mean_latency_ms is not None
        if _regressed(candidate.mean_actual_cost_usd, baseline.mean_actual_cost_usd):
            reasons.append("cost_regression")
        if _regressed(candidate.mean_latency_ms, baseline.mean_latency_ms):
            reasons.append("latency_regression")

    return CandidateDecision(accepted=not reasons, reasons=reasons)


def _telemetry_missing(
    baseline: PromptEvalSummary,
    candidate: PromptEvalSummary,
) -> bool:
    required = (
        baseline.mean_actual_cost_usd,
        baseline.mean_latency_ms,
        candidate.mean_actual_cost_usd,
        candidate.mean_latency_ms,
    )
    return any(value is None for value in required)


def _regressed(candidate_value: float, baseline_value: float) -> bool:
    if baseline_value <= 0:
        return False
    return (candidate_value - baseline_value) / baseline_value > _MAX_COST_LATENCY_REGRESSION
