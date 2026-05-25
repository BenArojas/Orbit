"""OBV prompt fact builder."""
from __future__ import annotations

from models import CandleData, IndicatorResult
from services.prompt_facts.types import PromptFact


def _make(tf: str, condition: str, text: str, *, polarity: str, strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.obv.{condition}",
        timeframe=tf, indicator="obv",
        text=text, polarity=polarity,
        strength=strength, priority=priority, data=data,
    )


def _net_change(series: list[float], lookback: int) -> float:
    if len(series) < lookback + 1:
        return 0.0
    return series[-1] - series[-lookback - 1]


def build_obv_facts(
    *, symbol: str, timeframe: str, obv: IndicatorResult, candles: list[CandleData]
) -> list[PromptFact]:
    series = [iv.value for iv in obv.values if iv.value is not None]
    if len(series) < 6:
        return []

    facts: list[PromptFact] = []
    lookback = 5
    obv_change = _net_change(series, lookback)

    # Trend
    if obv_change > 0:
        facts.append(_make(
            timeframe, "rising",
            f"OBV rising over last {lookback} bars (accumulation).",
            polarity="bullish", strength=55, priority=70,
            data={"lookback": lookback, "obv_change": obv_change},
        ))
    elif obv_change < 0:
        facts.append(_make(
            timeframe, "falling",
            f"OBV falling over last {lookback} bars (distribution).",
            polarity="bearish", strength=55, priority=70,
            data={"lookback": lookback, "obv_change": obv_change},
        ))

    # Divergence
    closes = [c.close for c in candles]
    if len(closes) >= lookback + 1:
        price_change = closes[-1] - closes[-lookback - 1]
        if price_change > 0 and obv_change < 0:
            facts.append(_make(
                timeframe, "divergence_bearish",
                f"Bearish divergence — price up but OBV down over last {lookback} bars.",
                polarity="caution", strength=75, priority=88,
                data={"price_change": price_change, "obv_change": obv_change},
            ))
        elif price_change < 0 and obv_change > 0:
            facts.append(_make(
                timeframe, "divergence_bullish",
                f"Bullish divergence — price down but OBV up over last {lookback} bars.",
                polarity="bullish", strength=75, priority=88,
                data={"price_change": price_change, "obv_change": obv_change},
            ))

    return facts
