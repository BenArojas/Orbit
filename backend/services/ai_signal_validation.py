from __future__ import annotations

from collections.abc import Mapping, Set as AbstractSet
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

Direction = Literal["STRONG LONG", "LONG", "NEUTRAL", "SHORT", "STRONG SHORT"]
GroundingMap = Mapping[str, AbstractSet[Decimal | float | int | str]]

_LONG_DIRECTIONS = {"STRONG LONG", "LONG"}
_SHORT_DIRECTIONS = {"STRONG SHORT", "SHORT"}
_PRICE_CENT = Decimal("0.01")


class AISignalGroundingError(Exception):
    """Raised when a model signal violates the grounding contract."""


class SignalLevelDraft(BaseModel):
    price: Decimal | None = None
    source_fact_id: str | None = None
    note: str


class SignalMetaDraft(BaseModel):
    risk_reward: str | None = None
    score: str | None = None
    adx_trend: str | None = None
    volume_signal: str | None = None


class SignalDraft(BaseModel):
    direction: Direction
    confidence: int = Field(ge=0, le=100)
    description: str
    entry: SignalLevelDraft
    stop: SignalLevelDraft
    target: SignalLevelDraft
    confirmations: list[str]
    cautions: list[str]
    meta: SignalMetaDraft = Field(default_factory=SignalMetaDraft)


ValidatedSignal = SignalDraft


def calculate_risk_reward(
    *,
    direction: str,
    entry: Decimal,
    stop: Decimal,
    target: Decimal,
) -> Decimal:
    del direction  # Geometry validation already decided the orientation.

    reward = abs(target - entry)
    risk = abs(entry - stop)
    if risk == 0:
        raise AISignalGroundingError("Risk distance cannot be zero")
    return (reward / risk).quantize(Decimal("0.01")).normalize()


def _format_risk_reward(value: Decimal) -> str:
    return f"{value}:1"


def _quantize_price(value: Decimal | float | int | str) -> Decimal:
    return Decimal(str(value)).quantize(_PRICE_CENT)


def _normalize_grounding_map(grounding_map: GroundingMap | None) -> dict[str, frozenset[Decimal]]:
    if grounding_map is None:
        return {}
    normalized: dict[str, frozenset[Decimal]] = {}
    for fact_id, prices in grounding_map.items():
        normalized[fact_id] = frozenset(_quantize_price(price) for price in prices)
    return normalized


def _validate_grounded_level(
    *,
    level_name: str,
    level: SignalLevelDraft,
    grounding_map: dict[str, frozenset[Decimal]],
) -> Decimal:
    if level.price is None or level.source_fact_id is None:
        raise AISignalGroundingError(
            f"{level_name} requires a numeric price and source_fact_id"
        )

    allowed_prices = grounding_map.get(level.source_fact_id)
    if allowed_prices is None:
        raise AISignalGroundingError(
            f"{level_name} cites unknown source fact ID {level.source_fact_id}"
        )

    price = _quantize_price(level.price)
    if price not in allowed_prices:
        raise AISignalGroundingError(
            f"{level_name} price {price} is not present in cited fact {level.source_fact_id}"
        )
    level.price = price
    return price


def validate_signal_draft(
    raw: object,
    *,
    grounding_map: GroundingMap | None = None,
) -> ValidatedSignal:
    try:
        draft = SignalDraft.model_validate(raw)
    except ValidationError as exc:
        raise AISignalGroundingError(f"Invalid signal schema: {exc}") from exc

    normalized_grounding_map = _normalize_grounding_map(grounding_map)
    levels = (draft.entry.price, draft.stop.price, draft.target.price)
    source_ids = (
        draft.entry.source_fact_id,
        draft.stop.source_fact_id,
        draft.target.source_fact_id,
    )

    if draft.direction == "NEUTRAL":
        if any(level is not None for level in levels):
            raise AISignalGroundingError("NEUTRAL cannot contain numeric trade levels")
        if any(source_id is not None for source_id in source_ids):
            raise AISignalGroundingError("NEUTRAL cannot cite source facts for trade levels")
        draft.meta.risk_reward = None
        return draft

    entry = _validate_grounded_level(
        level_name="entry",
        level=draft.entry,
        grounding_map=normalized_grounding_map,
    )
    stop = _validate_grounded_level(
        level_name="stop",
        level=draft.stop,
        grounding_map=normalized_grounding_map,
    )
    target = _validate_grounded_level(
        level_name="target",
        level=draft.target,
        grounding_map=normalized_grounding_map,
    )

    if draft.direction in _LONG_DIRECTIONS and not (stop < entry < target):
        raise AISignalGroundingError("LONG geometry requires stop < entry < target")
    if draft.direction in _SHORT_DIRECTIONS and not (target < entry < stop):
        raise AISignalGroundingError("SHORT geometry requires target < entry < stop")

    draft.meta.risk_reward = _format_risk_reward(
        calculate_risk_reward(
            direction=draft.direction,
            entry=entry,
            stop=stop,
            target=target,
        )
    )
    return draft


def safe_neutral_signal(reason: str) -> ValidatedSignal:
    return SignalDraft(
        direction="NEUTRAL",
        confidence=0,
        description=reason,
        entry=SignalLevelDraft(price=None, source_fact_id=None, note="No grounded level"),
        stop=SignalLevelDraft(price=None, source_fact_id=None, note="No grounded level"),
        target=SignalLevelDraft(price=None, source_fact_id=None, note="No grounded level"),
        confirmations=[],
        cautions=[reason],
        meta=SignalMetaDraft(risk_reward=None),
    )
