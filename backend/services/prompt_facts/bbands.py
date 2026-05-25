"""Bollinger Bands facts — squeeze, band walks, outside-band closes, %B."""
from __future__ import annotations

from typing import Optional

from models import IndicatorResult
from services.prompt_facts._common import percentile_rank
from services.prompt_facts.types import PromptFact


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.bbands.{condition}", timeframe=tf, indicator="bbands",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data,
    )


def build_facts(
    ind: Optional[IndicatorResult],
    *,
    last_close: float,
    candle_closes: list[float],
    timeframe: str,
) -> list[PromptFact]:
    if ind is None or not ind.values:
        return []
    last = ind.values[-1]
    if last.value is None or last.upper is None or last.lower is None:
        return []
    upper, lower, mid = last.upper, last.lower, last.value
    width = upper - lower
    if width <= 0:
        return []
    facts: list[PromptFact] = []

    # Squeeze — band-width percentile rank
    widths = [
        iv.upper - iv.lower
        for iv in ind.values
        if iv.upper is not None and iv.lower is not None
    ]
    if len(widths) >= 20:
        rank = percentile_rank(width, widths, lookback=100)
        if rank <= 0.25:
            facts.append(_make(
                timeframe, "squeeze",
                f"Band width at {rank * 100:.0f}th percentile of last 100 bars — squeeze.",
                polarity="neutral", strength=65, priority=82,
                data={"width": width, "percentile": rank},
            ))

    # Outside-band closes
    if last_close > upper:
        facts.append(_make(
            timeframe, "outside_upper",
            f"Last close ${last_close:.2f} above upper band ${upper:.2f}.",
            polarity="caution", strength=55, priority=78,
            data={"upper": upper, "close": last_close},
        ))
    elif last_close < lower:
        facts.append(_make(
            timeframe, "outside_lower",
            f"Last close ${last_close:.2f} below lower band ${lower:.2f}.",
            polarity="caution", strength=55, priority=78,
            data={"lower": lower, "close": last_close},
        ))

    # Band walks — 3+ of last 5 closes in upper/lower third
    if candle_closes:
        upper_thresh = mid + (upper - mid) * 0.667
        lower_thresh = mid - (mid - lower) * 0.667
        recent = candle_closes[-5:]
        in_upper = sum(1 for c in recent if c > upper_thresh)
        in_lower = sum(1 for c in recent if c < lower_thresh)
        if in_upper >= 3:
            facts.append(_make(
                timeframe, "upper_band_walk",
                f"{in_upper} of last {len(recent)} closes in upper third of band.",
                polarity="bullish", strength=60, priority=80,
                data={"closes_in_upper": in_upper, "window": len(recent)},
            ))
        elif in_lower >= 3:
            facts.append(_make(
                timeframe, "lower_band_walk",
                f"{in_lower} of last {len(recent)} closes in lower third of band.",
                polarity="bearish", strength=60, priority=80,
                data={"closes_in_lower": in_lower, "window": len(recent)},
            ))

    # %B state
    percent_b = (last_close - lower) / width
    if percent_b < 0:
        state, polarity, condition = "under_0", "caution", "percent_b_under_0"
    elif percent_b <= 0.20:
        state, polarity, condition = "0_20", "bearish", "percent_b_0_20"
    elif percent_b >= 1.0:
        state, polarity, condition = "over_100", "caution", "percent_b_over_100"
    elif percent_b >= 0.80:
        state, polarity, condition = "80_100", "bullish", "percent_b_80_100"
    else:
        state, polarity, condition = None, None, None
    if state is not None:
        facts.append(_make(
            timeframe, condition,
            f"%B = {percent_b:.2f} (state: {state}).",
            polarity=polarity, strength=40, priority=65,
            data={"percent_b": percent_b, "state": state},
        ))

    return facts
