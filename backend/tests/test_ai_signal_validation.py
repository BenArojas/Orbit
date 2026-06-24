from decimal import Decimal

import pytest

from services.ai_signal_validation import (
    AISignalGroundingError,
    calculate_risk_reward,
    safe_neutral_signal,
    validate_signal_draft,
)

GROUNDING_MAP = {
    "D.ema.price_near_21": frozenset({Decimal("25.50"), Decimal("27.00")}),
    "D.bbands.outside_lower": frozenset({Decimal("25.50"), Decimal("27.00")}),
    "D.fibonacci.target_extension_1272": frozenset({Decimal("31.50")}),
    "D.ema.stack_bullish": frozenset(
        {Decimal("31.50"), Decimal("29.00"), Decimal("27.00"), Decimal("25.50")}
    ),
}


def _neutral_with_levels() -> dict:
    return {
        "direction": "NEUTRAL",
        "confidence": 35,
        "description": "Insufficient confirmation",
        "entry": {
            "price": 27.0,
            "source_fact_id": "D.ema.price_near_21",
            "note": "estimated middle band",
        },
        "stop": {
            "price": 25.5,
            "source_fact_id": "D.bbands.outside_lower",
            "note": "estimated lower band",
        },
        "target": {
            "price": 31.5,
            "source_fact_id": "D.fibonacci.target_extension_1272",
            "note": "estimated projection",
        },
        "confirmations": [],
        "cautions": ["Only one verified fact"],
        "meta": {
            "risk_reward": "3:1",
            "score": "4/10",
            "adx_trend": None,
            "volume_signal": None,
        },
    }


def test_neutral_rejects_numeric_trade_levels():
    with pytest.raises(AISignalGroundingError, match="NEUTRAL cannot contain numeric trade levels"):
        validate_signal_draft(_neutral_with_levels(), grounding_map=GROUNDING_MAP)


def test_neutral_null_contract_is_accepted():
    raw = _neutral_with_levels()
    raw["entry"] = {"price": None, "source_fact_id": None, "note": "No grounded level"}
    raw["stop"] = {"price": None, "source_fact_id": None, "note": "No grounded level"}
    raw["target"] = {"price": None, "source_fact_id": None, "note": "No grounded level"}
    raw["meta"]["risk_reward"] = None

    validated = validate_signal_draft(raw, grounding_map=GROUNDING_MAP)

    assert validated.direction == "NEUTRAL"
    assert validated.entry.price is None
    assert validated.entry.source_fact_id is None
    assert validated.meta.risk_reward is None


def test_long_geometry_must_be_stop_below_entry_below_target():
    raw = _neutral_with_levels()
    raw["direction"] = "LONG"
    raw["entry"] = {"price": 31.5, "source_fact_id": "D.ema.stack_bullish", "note": "entry"}
    raw["stop"] = {
        "price": 31.5,
        "source_fact_id": "D.ema.stack_bullish",
        "note": "stop above entry is invalid",
    }
    raw["target"] = {
        "price": 31.5,
        "source_fact_id": "D.fibonacci.target_extension_1272",
        "note": "target",
    }

    with pytest.raises(AISignalGroundingError, match="LONG geometry"):
        validate_signal_draft(raw, grounding_map=GROUNDING_MAP)


def test_short_geometry_must_be_target_below_entry_below_stop():
    raw = _neutral_with_levels()
    raw["direction"] = "SHORT"
    raw["entry"] = {"price": 27.0, "source_fact_id": "D.ema.price_near_21", "note": "entry"}
    raw["stop"] = {
        "price": 25.5,
        "source_fact_id": "D.bbands.outside_lower",
        "note": "stop below entry is invalid",
    }
    raw["target"] = {
        "price": 25.5,
        "source_fact_id": "D.bbands.outside_lower",
        "note": "target",
    }

    with pytest.raises(AISignalGroundingError, match="SHORT geometry"):
        validate_signal_draft(raw, grounding_map=GROUNDING_MAP)


def test_invalid_direction_is_rejected():
    raw = _neutral_with_levels()
    raw["direction"] = "MOON"

    with pytest.raises(AISignalGroundingError):
        validate_signal_draft(raw, grounding_map=GROUNDING_MAP)


def test_confidence_must_be_within_bounds():
    raw = _neutral_with_levels()
    raw["confidence"] = 250

    with pytest.raises(AISignalGroundingError):
        validate_signal_draft(raw, grounding_map=GROUNDING_MAP)


def test_server_calculates_long_risk_reward():
    assert calculate_risk_reward(
        direction="LONG",
        entry=Decimal("27"),
        stop=Decimal("25.5"),
        target=Decimal("31.5"),
    ) == Decimal("3")


def test_valid_long_signal_uses_server_risk_reward_not_model_value():
    raw = _neutral_with_levels()
    raw["direction"] = "LONG"
    raw["entry"] = {"price": 27.0, "source_fact_id": "D.ema.price_near_21", "note": "entry"}
    raw["stop"] = {"price": 25.5, "source_fact_id": "D.bbands.outside_lower", "note": "stop"}
    raw["target"] = {
        "price": 31.5,
        "source_fact_id": "D.fibonacci.target_extension_1272",
        "note": "target",
    }
    raw["meta"]["risk_reward"] = "99:1"

    validated = validate_signal_draft(raw, grounding_map=GROUNDING_MAP)

    assert validated.meta.risk_reward == "3:1"


def test_directional_signal_rejects_prices_not_present_in_cited_fact():
    raw = _neutral_with_levels()
    raw["direction"] = "LONG"
    raw["entry"] = {"price": 999.0, "source_fact_id": "D.ema.price_near_21", "note": "fake"}
    raw["stop"] = {"price": 998.0, "source_fact_id": "D.bbands.outside_lower", "note": "fake"}
    raw["target"] = {
        "price": 1001.0,
        "source_fact_id": "D.fibonacci.target_extension_1272",
        "note": "fake",
    }

    with pytest.raises(AISignalGroundingError, match="not present in cited fact"):
        validate_signal_draft(raw, grounding_map=GROUNDING_MAP)


def test_directional_signal_accepts_exact_fact_backed_prices():
    raw = _neutral_with_levels()
    raw["direction"] = "LONG"
    raw["entry"] = {"price": 27.0, "source_fact_id": "D.ema.price_near_21", "note": "entry"}
    raw["stop"] = {"price": 25.5, "source_fact_id": "D.bbands.outside_lower", "note": "stop"}
    raw["target"] = {
        "price": 31.5,
        "source_fact_id": "D.fibonacci.target_extension_1272",
        "note": "target",
    }

    validated = validate_signal_draft(raw, grounding_map=GROUNDING_MAP)

    assert validated.entry.source_fact_id == "D.ema.price_near_21"
    assert validated.stop.source_fact_id == "D.bbands.outside_lower"
    assert validated.target.source_fact_id == "D.fibonacci.target_extension_1272"


def test_safe_neutral_signal_has_null_levels():
    validated = safe_neutral_signal("Insufficient verified evidence for numeric trade levels")

    assert validated.direction == "NEUTRAL"
    assert validated.entry.price is None
    assert validated.entry.source_fact_id is None
    assert validated.stop.price is None
    assert validated.target.price is None
    assert validated.meta.risk_reward is None


def test_null_note_on_grounded_level_is_accepted():
    raw = _neutral_with_levels()
    raw["direction"] = "LONG"
    raw["entry"] = {"price": 27.0, "source_fact_id": "D.ema.price_near_21", "note": None}
    raw["stop"] = {"price": 25.5, "source_fact_id": "D.bbands.outside_lower", "note": "stop"}
    raw["target"] = {"price": 31.5, "source_fact_id": "D.fibonacci.target_extension_1272", "note": "target"}

    validated = validate_signal_draft(raw, grounding_map=GROUNDING_MAP)

    assert validated.direction == "LONG"
    assert validated.entry.price == Decimal("27.0")
    assert validated.entry.note is None


def test_numeric_model_risk_reward_is_ignored():
    raw = _neutral_with_levels()
    raw["direction"] = "LONG"
    raw["entry"] = {"price": 27.0, "source_fact_id": "D.ema.price_near_21", "note": "entry"}
    raw["stop"] = {"price": 25.5, "source_fact_id": "D.bbands.outside_lower", "note": "stop"}
    raw["target"] = {"price": 31.5, "source_fact_id": "D.fibonacci.target_extension_1272", "note": "target"}
    raw["meta"]["risk_reward"] = 1.3  # float — must be discarded, not cause a type error

    validated = validate_signal_draft(raw, grounding_map=GROUNDING_MAP)

    assert validated.meta.risk_reward == "3:1"  # server-computed, not "1.3"


def test_grounding_integration_accepts_valid_long_and_rejects_invented_price():
    """Build a real PromptContextBundle, pick 3 grounded LONG candidates,
    verify validate_signal_draft accepts them; change entry by one cent → rejection."""
    from decimal import Decimal
    from models import CandleData, IndicatorResult, IndicatorValue
    from services.prompt_builder import build_full_prompt_context_bundle

    candles = [
        CandleData(time=1_700_000_000 + i * 86400, open=94, high=96, low=93, close=95.0, volume=1_000_000)
        for i in range(25)
    ]

    def _ema(period: int, val: float) -> IndicatorResult:
        return IndicatorResult(
            name=f"ema_{period}", type="overlay",
            values=[IndicatorValue(time=1_700_000_000 + i * 86400, value=val) for i in range(25)],
            params={"period": period},
        )

    bundle = build_full_prompt_context_bundle(
        symbol="INTG",
        timeframe_data={"D": {
            "candles": candles,
            "indicators": [_ema(9, 110.0), _ema(21, 105.0), _ema(50, 100.0), _ema(200, 90.0)],
            "fibs": [], "fibonacci": None,
        }},
        indicator_priority=[],
        budget_tokens=4096,
    )
    gmap = bundle.grounding_map
    # Confirm all three trade levels are in the grounding map
    assert Decimal("95.00") in gmap.get("D.price.current_close", frozenset())
    assert Decimal("90.00") in gmap.get("D.ema.levels_current", frozenset())
    assert Decimal("100.00") in gmap.get("D.ema.levels_current", frozenset())

    def _raw(entry, stop, target):
        return {
            "direction": "LONG",
            "confidence": 60,
            "description": "EMA bullish stack with price above EMA-200.",
            "entry": {"price": entry, "source_fact_id": "D.price.current_close", "note": "current close"},
            "stop": {"price": stop, "source_fact_id": "D.ema.levels_current", "note": "EMA-200"},
            "target": {"price": target, "source_fact_id": "D.ema.levels_current", "note": "EMA-50"},
            "confirmations": ["EMA stack bullish"],
            "cautions": ["RSI not confirmed"],
            "meta": {"risk_reward": None, "score": None, "adx_trend": None, "volume_signal": None},
        }

    # Geometry-valid LONG: stop=90 < entry=95 < target=100
    validated = validate_signal_draft(_raw(95.0, 90.0, 100.0), grounding_map=gmap)
    assert validated.direction == "LONG"

    # Off by one cent on entry → must reject
    with pytest.raises(AISignalGroundingError):
        validate_signal_draft(_raw(95.01, 90.0, 100.0), grounding_map=gmap)
