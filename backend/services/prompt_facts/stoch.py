"""Stochastic prompt fact builder."""
from __future__ import annotations

from models import IndicatorResult
from services.prompt_facts._common import recent_cross
from services.prompt_facts.types import PromptFact


def _make(tf: str, condition: str, text: str, *, polarity: str, strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.stoch.{condition}",
        timeframe=tf, indicator="stoch",
        text=text, polarity=polarity,
        strength=strength, priority=priority, data=data,
    )


def build_stoch_facts(*, symbol: str, timeframe: str, stoch: IndicatorResult) -> list[PromptFact]:
    if not stoch.values:
        return []

    last = stoch.values[-1]
    if last.value is None or last.signal is None:
        return []

    facts: list[PromptFact] = []
    k = last.value
    d = last.signal

    if k > d:
        facts.append(_make(
            timeframe, "k_above_d",
            f"Stochastic %K {k:.1f} above %D {d:.1f}.",
            polarity="bullish", strength=55, priority=72,
            data={"k": k, "d": d},
        ))
    elif k < d:
        facts.append(_make(
            timeframe, "k_below_d",
            f"Stochastic %K {k:.1f} below %D {d:.1f}.",
            polarity="bearish", strength=55, priority=72,
            data={"k": k, "d": d},
        ))

    k_series = [iv.value for iv in stoch.values if iv.value is not None]
    d_series = [iv.signal for iv in stoch.values if iv.signal is not None]
    n = min(len(k_series), len(d_series))
    if n >= 2:
        found, bars_ago = recent_cross(k_series[-n:], d_series[-n:], timeframe=timeframe)
        if found:
            facts.append(_make(
                timeframe, "cross_recent",
                f"Stochastic %K crossed %D {bars_ago} bar(s) ago.",
                polarity="bullish" if k > d else "bearish",
                strength=70, priority=85,
                data={"bars_ago": bars_ago},
            ))

    # OB/OS exit: previous was beyond threshold, current is back inside.
    if len(k_series) >= 2:
        prev_k = k_series[-2]
        if prev_k >= 80 and k < 80:
            facts.append(_make(
                timeframe, "overbought_exit",
                f"Stochastic exited overbought (%K {prev_k:.1f} -> {k:.1f}).",
                polarity="caution", strength=65, priority=84,
                data={"prev_k": prev_k, "k": k},
            ))
        elif prev_k <= 20 and k > 20:
            facts.append(_make(
                timeframe, "oversold_exit",
                f"Stochastic exited oversold (%K {prev_k:.1f} -> {k:.1f}).",
                polarity="bullish", strength=65, priority=84,
                data={"prev_k": prev_k, "k": k},
            ))

    return facts
