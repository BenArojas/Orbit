"""ADX prompt fact builder.

ADX measures trend STRENGTH only, never direction.
Never emits bullish/bearish polarity — only neutral or caution.
v2 adds +DI/-DI for direction.
"""
from __future__ import annotations

from models import IndicatorResult
from services.prompt_facts.types import PromptFact
from services.prompt_facts._common import is_rising_n, is_falling_n


def _make(tf: str, condition: str, text: str, *, polarity: str, strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.adx.{condition}",
        timeframe=tf, indicator="adx",
        text=text, polarity=polarity,
        strength=strength, priority=priority, data=data,
    )


def build_adx_facts(*, symbol: str, timeframe: str, adx: IndicatorResult) -> list[PromptFact]:
    series = [iv.value for iv in adx.values if iv.value is not None]
    if not series:
        return []

    last = series[-1]
    facts: list[PromptFact] = []

    if last >= 25 and len(series) >= 5:
        if is_rising_n(series, n=5, mode="slow"):
            facts.append(_make(
                timeframe, "strong_rising",
                f"ADX {last:.1f} above 25 and rising — strong trend (direction unspecified).",
                polarity="neutral", strength=60, priority=72,
                data={"adx": last},
            ))
        elif is_falling_n(series, n=5, mode="slow"):
            facts.append(_make(
                timeframe, "strong_falling",
                f"ADX {last:.1f} above 25 but falling — trend weakening.",
                polarity="caution", strength=55, priority=70,
                data={"adx": last},
            ))

    if last < 20:
        facts.append(_make(
            timeframe, "weak",
            f"ADX {last:.1f} below 20 — weak/no trend.",
            polarity="neutral", strength=45, priority=62,
            data={"adx": last},
        ))

    return facts
