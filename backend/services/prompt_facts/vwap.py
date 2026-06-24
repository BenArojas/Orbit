"""VWAP facts — above/below, reclaim/loss within recency, distance-far caution."""
from __future__ import annotations

from typing import Optional

from models import CandleData, IndicatorResult
from services.prompt_facts._common import recent_cross
from services.prompt_facts.types import PromptFact


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict,
          price_values: tuple[float, ...] = ()) -> PromptFact:
    return PromptFact(
        id=f"{tf}.vwap.{condition}", timeframe=tf, indicator="vwap",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data, price_values=price_values,
    )


def build_vwap_facts(
    *,
    symbol: str,
    timeframe: str,
    vwap: Optional[IndicatorResult],
    candles: Optional[list[CandleData]] = None,
    last_close: Optional[float] = None,
) -> list[PromptFact]:
    if vwap is None or not vwap.values:
        return []
    vwap_val = vwap.values[-1].value
    if vwap_val is None or vwap_val <= 0:
        return []
    if last_close is None:
        last_close = candles[-1].close if candles else 0.0
    if last_close <= 0:
        return []
    candle_closes = [c.close for c in candles] if candles else None
    facts: list[PromptFact] = []

    if last_close > vwap_val:
        facts.append(_make(
            timeframe, "price_above",
            f"Price ${last_close:.2f} above VWAP ${vwap_val:.2f}.",
            polarity="bullish", strength=55, priority=78,
            data={"vwap": vwap_val, "close": last_close},
            price_values=(last_close, vwap_val),
        ))
    elif last_close < vwap_val:
        facts.append(_make(
            timeframe, "price_below",
            f"Price ${last_close:.2f} below VWAP ${vwap_val:.2f}.",
            polarity="bearish", strength=55, priority=78,
            data={"vwap": vwap_val, "close": last_close},
            price_values=(last_close, vwap_val),
        ))

    # Recent reclaim/loss — cross between candle closes and VWAP series.
    if candle_closes:
        vwap_series = [iv.value for iv in vwap.values]
        n = min(len(candle_closes), len(vwap_series))
        if n >= 2:
            found, bars_ago = recent_cross(
                candle_closes[-n:], vwap_series[-n:], timeframe=timeframe,
            )
            if found:
                direction = "up" if last_close > vwap_val else "down"
                cond = "reclaim_recent" if direction == "up" else "loss_recent"
                facts.append(_make(
                    timeframe, cond,
                    f"Price crossed VWAP {bars_ago} bar(s) ago ({direction}).",
                    polarity="bullish" if direction == "up" else "bearish",
                    strength=65, priority=82,
                    data={"bars_ago": bars_ago, "direction": direction},
                ))

    distance_pct = abs(last_close - vwap_val) / vwap_val * 100
    if distance_pct > 1.5:
        facts.append(_make(
            timeframe, "distance_far",
            f"Price {distance_pct:.1f}% away from VWAP ${vwap_val:.2f}.",
            polarity="caution", strength=40, priority=68,
            data={"distance_pct": distance_pct},
        ))

    return facts
