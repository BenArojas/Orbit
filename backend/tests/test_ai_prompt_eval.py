import json

from tests.fixtures.ai_prompt_eval_cases import EVAL_CASES

from services.ai_prompt_eval import (
    PROMPT_EVAL_WEIGHTS,
    PromptEvalSummary,
    compare_candidates,
    grade_prompt_output,
)

WULF_CASE = next(c for c in EVAL_CASES if c.case_id == "wulf_bb_sparse")

UNGROUNDED_WULF = json.dumps(
    {
        "direction": "LONG",
        "confidence": 70,
        "description": "Bounce off lower band [close] toward middle band.",
        "entry": {"price": 27.0, "note": "estimated"},
        "stop": {"price": 25.5, "note": "estimated"},
        "target": {"price": 31.5, "note": "estimated"},
        "confirmations": ["Price near lower band [close]"],
        "cautions": [],
        "meta": {"risk_reward": "3:1", "score": "7/10", "adx_trend": None, "volume_signal": None},
    }
)

GROUNDED_WULF = json.dumps(
    {
        "direction": "NEUTRAL",
        "confidence": 30,
        "description": "Only %B is verified [bbands.percent_b]; single verified fact means insufficient evidence for a trade plan.",
        "entry": {"price": None, "note": "No grounded level"},
        "stop": {"price": None, "note": "No grounded level"},
        "target": {"price": None, "note": "No grounded level"},
        "confirmations": [],
        "cautions": ["Single verified fact", "Insufficient evidence for numeric levels"],
        "meta": {"risk_reward": None, "score": "3/10", "adx_trend": None, "volume_signal": None},
    }
)


def test_weights_total_one_hundred():
    assert sum(PROMPT_EVAL_WEIGHTS.values()) == 100


def test_ungrounded_neutral_case_fails_hard_gate():
    result = grade_prompt_output(WULF_CASE, UNGROUNDED_WULF)
    assert "numeric_level_in_insufficient_case" in result.hard_failures
    assert result.eligible is False


def test_grounded_neutral_case_is_eligible_and_scores_high():
    result = grade_prompt_output(WULF_CASE, GROUNDED_WULF)
    assert result.eligible is True
    assert result.weighted_score >= 90


def test_unknown_fact_id_fails_hard_gate():
    bad = json.loads(GROUNDED_WULF)
    bad["description"] = "Support at 25 [fib.level] holds."
    result = grade_prompt_output(WULF_CASE, json.dumps(bad))
    assert "cited_unknown_fact" in result.hard_failures
    assert result.eligible is False


def test_invalid_json_fails_hard_gate():
    result = grade_prompt_output(WULF_CASE, "not json")
    assert "invalid_json" in result.hard_failures
    assert result.eligible is False


def test_compare_rejects_candidate_with_case_regression_over_ten_points():
    baseline = _summary(weighted_mean=80.0, per_case={"wulf_bb_sparse": 90.0})
    candidate = _summary(weighted_mean=83.0, per_case={"wulf_bb_sparse": 78.0})
    decision = compare_candidates(baseline, candidate)
    assert decision.accepted is False
    assert "case_regression" in decision.reasons


def test_compare_accepts_candidate_meeting_all_thresholds():
    baseline = _summary(weighted_mean=80.0, per_case={"wulf_bb_sparse": 90.0})
    candidate = _summary(weighted_mean=83.0, per_case={"wulf_bb_sparse": 88.0})
    decision = compare_candidates(baseline, candidate)
    assert decision.accepted is True


def _summary(*, weighted_mean: float, per_case: dict[str, float]):
    return PromptEvalSummary(
        candidate="test",
        weighted_mean=weighted_mean,
        per_case_scores=per_case,
        hard_gate_failures=0,
        mean_actual_cost_usd=0.001,
        mean_latency_ms=900.0,
    )
