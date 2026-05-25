"""VWAP facts — above/below, reclaim/loss within recency, distance-far caution."""
from __future__ import annotations

from typing import Optional

from models import IndicatorResult
from services.prompt_facts._common import recent_cross
from services.prompt_facts.types import PromptFact


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.vwap.{condition}", timeframe=tf, indicator="vwap",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data,
    )


def build_facts(
    ind: Optional[IndicatorResult],
    *,
    last_close: float,
    timeframe: str,
    candle_closes: Optional[list[float]] = None,
) -> list[PromptFact]:
    if ind is None or not ind.values:
        return []
    vwap = ind.values[-1].value
    if vwap is None or vwap <= 0:
        return []
    facts: list[PromptFact] = []

    if last_close > vwap:
        facts.append(_make(
            timeframe, "price_above",
            f"Price ${last_close:.2f} above VWAP ${vwap:.2f}.",
            polarity="bullish", strength=55, priority=78,
            data={"vwap": vwap, "close": last_close},
        ))
    elif last_close < vwap:
        facts.append(_make(
            timeframe, "price_below",
            f"Price ${last_close:.2f} below VWAP ${vwap:.2f}.",
            polarity="bearish", strength=55, priority=78,
            data={"vwap": vwap, "close": last_close},
        ))

    # Recent reclaim/loss — cross between candle closes and VWAP series.
    if candle_closes:
        vwap_series = [iv.value for iv in ind.values]
        n = min(len(candle_closes), len(vwap_series))
        if n >= 2:
            found, bars_ago = recent_cross(
                candle_closes[-n:], vwap_series[-n:], timeframe=timeframe,
            )
            if found:
                direction = "up" if last_close > vwap else "down"
                cond = "reclaim_recent" if direction == "up" else "loss_recent"
                facts.append(_make(
                    timeframe, cond,
                    f"Price crossed VWAP {bars_ago} bar(s) ago ({direction}).",
                    polarity="bullish" if direction == "up" else "bearish",
                    strength=65, priority=82,
                    data={"bars_ago": bars_ago, "direction": direction},
                ))

    distance_pct = abs(last_close - vwap) / vwap * 100
    if distance_pct > 1.5:
        facts.append(_make(
            timeframe, "distance_far",
            f"Price {distance_pct:.1f}% away from VWAP ${vwap:.2f}.",
            polarity="caution", strength=40, priority=68,
            data={"distance_pct": distance_pct},
        ))

    return facts
