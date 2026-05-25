"""RSI facts — above/below 50 with momentum, OB/OS extremes, recent crosses."""
from __future__ import annotations

from typing import Optional

from models import IndicatorResult
from services.prompt_facts._common import is_falling_n, is_rising_n, recent_cross
from services.prompt_facts.types import PromptFact


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.rsi.{condition}", timeframe=tf, indicator="rsi",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data,
    )


def build_rsi_facts(*, symbol: str, timeframe: str, rsi: Optional[IndicatorResult]) -> list[PromptFact]:
    if rsi is None or not rsi.values:
        return []
    series = [iv.value for iv in rsi.values]
    clean = [v for v in series if v is not None]
    if not clean:
        return []
    rsi_val = clean[-1]
    facts: list[PromptFact] = []

    rising = is_rising_n(series, n=3, mode="momentum")
    falling = is_falling_n(series, n=3, mode="momentum")

    if rsi_val > 50 and rising:
        facts.append(_make(
            timeframe, "above_50_rising",
            f"RSI {rsi_val:.1f}, above 50 and rising 3 bars.",
            polarity="bullish", strength=60, priority=80,
            data={"rsi": rsi_val},
        ))
    elif rsi_val > 50 and falling:
        facts.append(_make(
            timeframe, "above_50_falling",
            f"RSI {rsi_val:.1f}, above 50 but falling 3 bars.",
            polarity="neutral", strength=45, priority=75,
            data={"rsi": rsi_val},
        ))
    elif rsi_val < 50 and falling:
        facts.append(_make(
            timeframe, "below_50_falling",
            f"RSI {rsi_val:.1f}, below 50 and falling 3 bars.",
            polarity="bearish", strength=60, priority=80,
            data={"rsi": rsi_val},
        ))
    elif rsi_val < 50 and rising:
        facts.append(_make(
            timeframe, "below_50_rising",
            f"RSI {rsi_val:.1f}, below 50 but rising 3 bars.",
            polarity="neutral", strength=45, priority=75,
            data={"rsi": rsi_val},
        ))

    if rsi_val > 70:
        facts.append(_make(
            timeframe, "overbought",
            f"RSI {rsi_val:.1f} above 70 — overbought.",
            polarity="caution", strength=55, priority=78,
            data={"rsi": rsi_val},
        ))
    if rsi_val < 30:
        facts.append(_make(
            timeframe, "oversold",
            f"RSI {rsi_val:.1f} below 30 — oversold.",
            polarity="caution", strength=55, priority=78,
            data={"rsi": rsi_val},
        ))

    # Recent crosses of 30 / 50 / 70 thresholds.
    constants = {"30_recent": 30.0, "50_recent": 50.0, "70_recent": 70.0}
    polarity_for: dict[str, str] = {"30_recent": "caution", "70_recent": "caution"}
    for cond_suffix, threshold in constants.items():
        ref = [threshold] * len(series)
        found, bars_ago = recent_cross(series, ref, timeframe=timeframe)
        if not found:
            continue
        if cond_suffix == "50_recent":
            polarity = "bullish" if rsi_val > 50 else "bearish"
        else:
            polarity = polarity_for[cond_suffix]
        facts.append(_make(
            timeframe, f"cross_{cond_suffix}",
            f"RSI crossed {threshold:.0f} {bars_ago} bar(s) ago.",
            polarity=polarity, strength=50, priority=70,
            data={"threshold": threshold, "bars_ago": bars_ago,
                  "direction": "up" if rsi_val > threshold else "down"},
        ))

    return facts
