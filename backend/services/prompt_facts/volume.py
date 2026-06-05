"""Volume prompt fact builder.

Decoupled IDs:
  - surge_up    — up candle on >=1.5x avg volume
  - surge_down  — down candle on >=1.5x avg volume
  - dry_up      — any candle on <=0.5x avg volume
"""
from __future__ import annotations

from models import CandleData
from services.prompt_facts.types import PromptFact

SURGE_MULT = 1.5
DRY_MULT = 0.5
MA_WINDOW = 20


def _make(tf: str, condition: str, text: str, *, polarity: str, strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.volume.{condition}",
        timeframe=tf, indicator="volume",
        text=text, polarity=polarity,
        strength=strength, priority=priority, data=data,
    )


def build_volume_facts(*, symbol: str, timeframe: str, candles: list[CandleData]) -> list[PromptFact]:
    if len(candles) < MA_WINDOW + 1:
        return []

    last = candles[-1]
    prior_vols = [c.volume for c in candles[-MA_WINDOW - 1 : -1]]
    avg = sum(prior_vols) / len(prior_vols)
    if avg <= 0:
        return []

    ratio = last.volume / avg
    facts: list[PromptFact] = []

    if ratio >= SURGE_MULT:
        is_up = last.close > last.open
        is_down = last.close < last.open
        if is_up:
            facts.append(_make(
                timeframe, "surge_up",
                f"Up candle on {ratio:.1f}x average volume.",
                polarity="bullish", strength=60, priority=80,
                data={"ratio": ratio, "volume": last.volume, "avg": avg},
            ))
        elif is_down:
            facts.append(_make(
                timeframe, "surge_down",
                f"Down candle on {ratio:.1f}x average volume.",
                polarity="bearish", strength=60, priority=80,
                data={"ratio": ratio, "volume": last.volume, "avg": avg},
            ))

    if ratio <= DRY_MULT:
        facts.append(_make(
            timeframe, "dry_up",
            f"Volume {ratio:.2f}x average — low conviction.",
            polarity="caution", strength=45, priority=65,
            data={"ratio": ratio, "volume": last.volume, "avg": avg},
        ))

    return facts
