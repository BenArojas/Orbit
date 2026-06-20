from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

Direction = Literal["STRONG LONG", "LONG", "NEUTRAL", "SHORT", "STRONG SHORT"]

_LONG_DIRECTIONS = {"STRONG LONG", "LONG"}
_SHORT_DIRECTIONS = {"STRONG SHORT", "SHORT"}


class AISignalGroundingError(Exception):
    """Raised when a model signal violates the grounding contract."""


class SignalLevelDraft(BaseModel):
    price: Decimal | None = None
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


def validate_signal_draft(raw: object) -> ValidatedSignal:
    try:
        draft = SignalDraft.model_validate(raw)
    except ValidationError as exc:
        raise AISignalGroundingError(f"Invalid signal schema: {exc}") from exc

    levels = (draft.entry.price, draft.stop.price, draft.target.price)

    if draft.direction == "NEUTRAL":
        if any(level is not None for level in levels):
            raise AISignalGroundingError("NEUTRAL cannot contain numeric trade levels")
        draft.meta.risk_reward = None
        return draft

    if any(level is None for level in levels):
        raise AISignalGroundingError(
            f"{draft.direction} requires numeric entry, stop, and target"
        )

    entry = draft.entry.price
    stop = draft.stop.price
    target = draft.target.price
    assert entry is not None and stop is not None and target is not None

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
        entry=SignalLevelDraft(price=None, note="No grounded level"),
        stop=SignalLevelDraft(price=None, note="No grounded level"),
        target=SignalLevelDraft(price=None, note="No grounded level"),
        confirmations=[],
        cautions=[reason],
        meta=SignalMetaDraft(risk_reward=None),
    )
