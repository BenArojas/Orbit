"""ATR prompt fact builder."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from models import IndicatorResult
from services.prompt_facts._common import is_rising_n, is_falling_n
from services.prompt_facts.types import PromptFact


def _make(tf: str, condition: str, text: str, *, polarity: str, strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.atr.{condition}",
        timeframe=tf, indicator="atr",
        text=text, polarity=polarity,
        strength=strength, priority=priority, data=data,
    )


def build_atr_facts(*, symbol: str, timeframe: str, atr: IndicatorResult, last_close: float) -> list[PromptFact]:
    del symbol
    if not atr.values:
        return []

    last_atr = atr.values[-1].value
    if last_atr is None or last_atr <= 0:
        return []

    displayed_atr = Decimal(str(last_atr)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if displayed_atr <= 0:
        return []

    facts: list[PromptFact] = []

    atr_pct = last_atr / last_close * 100 if last_close else 0.0
    facts.append(_make(
        timeframe, "stop_distances",
        f"ATR {last_atr:.2f} ({atr_pct:.1f}% of price). "
        f"1.5x ATR distance = {last_atr*1.5:.2f} points. "
        f"2.0x ATR distance = {last_atr*2.0:.2f} points.",
        polarity="neutral", strength=50, priority=60,
        data={"atr": last_atr, "atr_pct": atr_pct, "stop_1_5x": last_atr * 1.5, "stop_2_0x": last_atr * 2.0},
    ))

    series = [iv.value for iv in atr.values if iv.value is not None]
    if len(series) >= 6:
        if is_rising_n(series, n=5, mode="slow"):
            facts.append(_make(
                timeframe, "expanding",
                "Volatility expanding — ATR rising over last 5 bars.",
                polarity="caution", strength=50, priority=72,
                data={"atr_5_ago": series[-6], "atr_current": last_atr},
            ))
        elif is_falling_n(series, n=5, mode="slow"):
            facts.append(_make(
                timeframe, "contracting",
                "Volatility contracting — ATR falling over last 5 bars.",
                polarity="neutral", strength=45, priority=68,
                data={"atr_5_ago": series[-6], "atr_current": last_atr},
            ))

    return facts
