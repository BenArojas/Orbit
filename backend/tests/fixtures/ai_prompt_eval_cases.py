from __future__ import annotations

from dataclasses import dataclass, field

from tests.fixtures.eval_scenarios import aapl_in_swing, nvda_ema_stack, tsm_extension


@dataclass(frozen=True)
class PromptEvalCase:
    case_id: str
    candles: object
    allowed_fact_ids: frozenset[str]
    allowed_directions: frozenset[str]
    insufficient_for_levels: bool
    required_caution_concepts: tuple[str, ...] = field(default_factory=tuple)


def _sparse_bb_only_candles() -> dict:
    return {
        "symbol": "WULF",
        "timeframe": "D",
        "candles": [],
        "indicators": [],
    }


def _conflicting_timeframes_candles() -> dict:
    return {
        "symbol": "QQQ",
        "timeframe": "D/W",
        "candles": [],
        "indicators": [],
    }


def _missing_adx_volume_candles() -> dict:
    return {
        "symbol": "MSFT",
        "timeframe": "D",
        "candles": [],
        "indicators": [],
    }


EVAL_CASES: tuple[PromptEvalCase, ...] = (
    PromptEvalCase(
        case_id="wulf_bb_sparse",
        candles=_sparse_bb_only_candles(),
        allowed_fact_ids=frozenset({"close", "bbands.percent_b"}),
        allowed_directions=frozenset({"NEUTRAL"}),
        insufficient_for_levels=True,
        required_caution_concepts=("single verified fact", "insufficient evidence"),
    ),
    PromptEvalCase(
        case_id="tsm_extension",
        candles=tsm_extension(),
        allowed_fact_ids=frozenset({"close", "ema.stack", "rsi.value"}),
        allowed_directions=frozenset({"LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=("overextension",),
    ),
    PromptEvalCase(
        case_id="aapl_fib_pullback",
        candles=aapl_in_swing(),
        allowed_fact_ids=frozenset({"close", "fib.level", "ema.value"}),
        allowed_directions=frozenset({"LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=(),
    ),
    PromptEvalCase(
        case_id="nvda_ema_extension",
        candles=nvda_ema_stack(),
        allowed_fact_ids=frozenset({"close", "ema.stack", "rsi.value"}),
        allowed_directions=frozenset({"STRONG LONG", "LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=("overextension", "pullback"),
    ),
    PromptEvalCase(
        case_id="conflicting_timeframes",
        candles=_conflicting_timeframes_candles(),
        allowed_fact_ids=frozenset({"close", "ema.stack", "rsi.value"}),
        allowed_directions=frozenset({"NEUTRAL", "LONG", "SHORT"}),
        insufficient_for_levels=False,
        required_caution_concepts=("conflicting timeframes",),
    ),
    PromptEvalCase(
        case_id="missing_adx_volume",
        candles=_missing_adx_volume_candles(),
        allowed_fact_ids=frozenset({"close", "ema.stack"}),
        allowed_directions=frozenset({"LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=("adx unavailable", "volume unavailable"),
    ),
)
