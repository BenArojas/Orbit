import json

from tests.fixtures.ai_prompt_eval_cases import EVAL_CASES

from services.prompt_builder import SIGNAL_INLINE_JSON_INSTRUCTION
from services.ai_prompt_eval import (
    PROMPT_EVAL_WEIGHTS,
    PromptEvalSummary,
    compare_candidates,
    grade_prompt_output,
)

WULF_CASE = next(c for c in EVAL_CASES if c.case_id == "wulf_bb_sparse")
MISSING_TELEMETRY_CASE = next(c for c in EVAL_CASES if c.case_id == "missing_adx_volume")
CONFLICTING_CASE = next(c for c in EVAL_CASES if c.case_id == "conflicting_timeframes")

UNGROUNDED_WULF = json.dumps(
    {
        "direction": "LONG",
        "confidence": 70,
        "description": "Bounce off lower band [D.bbands.percent_b_0_20] toward middle band.",
        "entry": {"price": 27.0, "source_fact_id": "D.bbands.percent_b_0_20", "note": "estimated"},
        "stop": {"price": 25.5, "source_fact_id": "D.bbands.percent_b_0_20", "note": "estimated"},
        "target": {"price": 31.5, "source_fact_id": "D.bbands.percent_b_0_20", "note": "estimated"},
        "confirmations": ["Price near lower band [D.bbands.percent_b_0_20]"],
        "cautions": [],
        "meta": {"risk_reward": "3:1", "score": "7/10", "adx_trend": None, "volume_signal": None},
    }
)

GROUNDED_WULF = json.dumps(
    {
        "direction": "NEUTRAL",
        "confidence": 30,
        "description": "Only %B is verified [D.bbands.percent_b_0_20]; single verified fact means insufficient evidence for a trade plan.",
        "entry": {"price": None, "source_fact_id": None, "note": "No grounded level"},
        "stop": {"price": None, "source_fact_id": None, "note": "No grounded level"},
        "target": {"price": None, "source_fact_id": None, "note": "No grounded level"},
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


def test_real_rendered_fact_id_passes_and_alias_id_fails():
    real_id = next(fid for fid in MISSING_TELEMETRY_CASE.allowed_fact_ids if fid.endswith(".ema.stack_bullish"))
    output = {
        "direction": "LONG",
        "confidence": 72,
        "description": f"Trend remains intact [{real_id}].",
        "entry": {"price": 234.0, "source_fact_id": "D.ema.price_near_21", "note": "entry"},
        "stop": {"price": 224.0, "source_fact_id": real_id, "note": "stop"},
        "target": {"price": 244.16, "source_fact_id": "D.fibonacci.target_extension_1272", "note": "target"},
        "confirmations": [f"EMA alignment [{real_id}]"],
        "cautions": ["ADX unavailable", "Volume unavailable"],
        "meta": {"risk_reward": None, "score": "6/10", "adx_trend": None, "volume_signal": None},
    }

    good = grade_prompt_output(MISSING_TELEMETRY_CASE, json.dumps(output))
    assert good.eligible is True

    output["description"] = "Trend remains intact [ema.stack]."
    bad = grade_prompt_output(MISSING_TELEMETRY_CASE, json.dumps(output))
    assert "cited_unknown_fact" in bad.hard_failures
    assert bad.eligible is False


def test_unknown_fact_id_fails_hard_gate():
    bad = json.loads(GROUNDED_WULF)
    bad["description"] = "Support at 25 [fib.level] holds."
    result = grade_prompt_output(WULF_CASE, json.dumps(bad))
    assert "cited_unknown_fact" in result.hard_failures
    assert result.eligible is False


def test_confidence_label_fails_eval_schema_gate():
    bad = json.loads(GROUNDED_WULF)
    bad["confidence"] = "HIGH"
    result = grade_prompt_output(WULF_CASE, json.dumps(bad))
    assert "invalid_schema" in result.hard_failures
    assert result.eligible is False


def test_invalid_json_fails_hard_gate():
    result = grade_prompt_output(WULF_CASE, "not json")
    assert "invalid_json" in result.hard_failures
    assert result.eligible is False


def test_advertised_fixtures_render_intended_evidence():
    assert "D.bbands.percent_b_0_20" in WULF_CASE.allowed_fact_ids
    assert not any(".adx." in fact_id or ".volume." in fact_id for fact_id in WULF_CASE.allowed_fact_ids)

    assert "W.ema.stack_bullish" in CONFLICTING_CASE.allowed_fact_ids
    assert "D.ema.stack_bearish" in CONFLICTING_CASE.allowed_fact_ids

    assert "D.ema.stack_bullish" in MISSING_TELEMETRY_CASE.allowed_fact_ids
    assert "D.fibonacci.target_extension_1272" in MISSING_TELEMETRY_CASE.allowed_fact_ids
    assert not any(".adx." in fact_id or ".volume." in fact_id for fact_id in MISSING_TELEMETRY_CASE.allowed_fact_ids)


def test_prompt_instruction_no_longer_forces_null_levels():
    assert "source_fact_id" in SIGNAL_INLINE_JSON_INSTRUCTION
    assert "copy an exact numeric price already present in Verified Facts" in SIGNAL_INLINE_JSON_INSTRUCTION
    assert '"entry":  {"price": null' not in SIGNAL_INLINE_JSON_INSTRUCTION


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


def test_missing_telemetry_cannot_be_promoted():
    baseline = _summary(weighted_mean=80.0, per_case={"wulf_bb_sparse": 90.0})
    candidate = _summary(
        weighted_mean=83.0,
        per_case={"wulf_bb_sparse": 88.0},
        mean_actual_cost_usd=None,
    )
    decision = compare_candidates(baseline, candidate)
    assert decision.accepted is False
    assert "telemetry_missing" in decision.reasons


def _summary(
    *,
    weighted_mean: float,
    per_case: dict[str, float],
    mean_actual_cost_usd: float | None = 0.001,
    mean_latency_ms: float | None = 900.0,
):
    return PromptEvalSummary(
        candidate="test",
        weighted_mean=weighted_mean,
        per_case_scores=per_case,
        hard_gate_failures=0,
        mean_actual_cost_usd=mean_actual_cost_usd,
        mean_latency_ms=mean_latency_ms,
    )
