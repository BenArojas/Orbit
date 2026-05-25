"""MACD facts — line state (4-quadrant), histogram state (4-quadrant), recent cross."""
from __future__ import annotations

from typing import Optional

from models import IndicatorResult
from services.prompt_facts._common import is_falling_n, is_rising_n, recent_cross
from services.prompt_facts.types import PromptFact

_HIST_EPSILON = 1e-4


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.macd.{condition}", timeframe=tf, indicator="macd",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data,
    )


def build_facts(ind: Optional[IndicatorResult], *, timeframe: str) -> list[PromptFact]:
    if ind is None or not ind.values:
        return []
    line_series = [iv.value for iv in ind.values]
    sig_series = [iv.signal for iv in ind.values]
    hist_series = [iv.histogram for iv in ind.values]
    if not line_series or line_series[-1] is None or sig_series[-1] is None:
        return []
    line = line_series[-1]
    sig = sig_series[-1]
    hist = hist_series[-1] if hist_series[-1] is not None else 0.0

    facts: list[PromptFact] = []

    # Line state
    line_above_sig = line > sig
    line_above_zero = line > 0
    line_data = {"line": line, "signal": sig, "hist": hist}
    if line_above_sig and line_above_zero:
        facts.append(_make(
            timeframe, "line_bullish_impulse",
            f"MACD line {line:.3f} above signal {sig:.3f}, both above zero.",
            polarity="bullish", strength=75, priority=85, data=line_data,
        ))
    elif line_above_sig and not line_above_zero:
        facts.append(_make(
            timeframe, "line_bearish_improving",
            f"MACD line {line:.3f} above signal {sig:.3f} but still below zero.",
            polarity="neutral", strength=50, priority=72, data=line_data,
        ))
    elif (not line_above_sig) and line_above_zero:
        facts.append(_make(
            timeframe, "line_bullish_weakening",
            f"MACD line {line:.3f} below signal {sig:.3f}, still above zero.",
            polarity="neutral", strength=45, priority=72, data=line_data,
        ))
    else:
        facts.append(_make(
            timeframe, "line_bearish_impulse",
            f"MACD line {line:.3f} below signal {sig:.3f}, both below zero.",
            polarity="bearish", strength=75, priority=85, data=line_data,
        ))

    # Histogram state — skip when near zero
    if abs(hist) >= _HIST_EPSILON:
        rising = is_rising_n(hist_series, n=3, mode="momentum")
        falling = is_falling_n(hist_series, n=3, mode="momentum")
        if hist > 0 and rising:
            facts.append(_make(
                timeframe, "hist_above_rising",
                f"MACD histogram {hist:+.4f}, above zero and rising 3 bars.",
                polarity="bullish", strength=70, priority=82, data={"hist": hist},
            ))
        elif hist > 0 and falling:
            facts.append(_make(
                timeframe, "hist_above_falling",
                f"MACD histogram {hist:+.4f}, above zero but falling 3 bars.",
                polarity="neutral", strength=45, priority=70, data={"hist": hist},
            ))
        elif hist < 0 and rising:
            facts.append(_make(
                timeframe, "hist_below_rising",
                f"MACD histogram {hist:+.4f}, below zero but rising 3 bars.",
                polarity="neutral", strength=50, priority=70, data={"hist": hist},
            ))
        elif hist < 0 and falling:
            facts.append(_make(
                timeframe, "hist_below_falling",
                f"MACD histogram {hist:+.4f}, below zero and falling 3 bars.",
                polarity="bearish", strength=70, priority=82, data={"hist": hist},
            ))

    # Recent line/signal cross
    found, bars_ago = recent_cross(line_series, sig_series, timeframe=timeframe)
    if found:
        direction = "up" if line > sig else "down"
        facts.append(_make(
            timeframe, "cross_recent",
            f"MACD line crossed signal {bars_ago} bar(s) ago ({direction}).",
            polarity="bullish" if direction == "up" else "bearish",
            strength=72, priority=84,
            data={"bars_ago": bars_ago, "direction": direction},
        ))

    return facts
