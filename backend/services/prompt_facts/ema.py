"""EMA facts — stack order, price-vs-all-EMAs, per-period near checks, crosses."""
from __future__ import annotations

from typing import Optional

from models import IndicatorResult
from services.prompt_facts._common import is_near, recent_cross
from services.prompt_facts.types import PromptFact


def _last_val(ir: IndicatorResult) -> Optional[float]:
    if not ir.values:
        return None
    return ir.values[-1].value


def _make(tf: str, condition: str, text: str, polarity: str,
          strength: int, priority: int, data: dict) -> PromptFact:
    return PromptFact(
        id=f"{tf}.ema.{condition}", timeframe=tf, indicator="ema",
        text=text, polarity=polarity, strength=strength,
        priority=priority, data=data,
    )


def build_ema_facts(
    *,
    symbol: str,
    timeframe: str,
    emas: list[IndicatorResult],
    last_close: float,
    atr: Optional[float] = None,
) -> list[PromptFact]:
    if not emas:
        return []
    emas_by_period: dict[int, IndicatorResult] = {}
    for ir in emas:
        period = ir.params.get("period") if ir.params else None
        if period is None:
            continue
        emas_by_period[int(period)] = ir
    if not emas_by_period:
        return []
    values: dict[int, float] = {}
    for period, ir in emas_by_period.items():
        v = _last_val(ir)
        if v is None:
            continue
        values[period] = v
    if not values:
        return []

    required = {9, 21, 50, 200}
    have = set(values.keys())
    facts: list[PromptFact] = []

    per_period = [
        {"period": p, "value": values[p],
         "distance_pct": (last_close - values[p]) / values[p] * 100 if values[p] else 0.0}
        for p in sorted(values.keys())
    ]

    # Stack classification
    if not required.issubset(have):
        facts.append(_make(
            timeframe, "stack_incomplete",
            text=f"EMA stack incomplete — have periods {sorted(have)}, need {sorted(required)}.",
            polarity="neutral", strength=25, priority=70,
            data={"periods": per_period, "missing": sorted(required - have)},
        ))
    else:
        ordered_desc = [values[p] for p in (9, 21, 50, 200)]
        if all(ordered_desc[i] > ordered_desc[i + 1] for i in range(3)):
            facts.append(_make(
                timeframe, "stack_bullish",
                text=(
                    f"EMA stack bullish: 9 (${values[9]:.2f}) > 21 (${values[21]:.2f}) "
                    f"> 50 (${values[50]:.2f}) > 200 (${values[200]:.2f})."
                ),
                polarity="bullish", strength=85, priority=92,
                data={"periods": per_period},
            ))
        elif all(ordered_desc[i] < ordered_desc[i + 1] for i in range(3)):
            facts.append(_make(
                timeframe, "stack_bearish",
                text=(
                    f"EMA stack bearish: 9 (${values[9]:.2f}) < 21 (${values[21]:.2f}) "
                    f"< 50 (${values[50]:.2f}) < 200 (${values[200]:.2f})."
                ),
                polarity="bearish", strength=85, priority=92,
                data={"periods": per_period},
            ))
        else:
            facts.append(_make(
                timeframe, "stack_mixed",
                text=(
                    f"EMA stack mixed — periods not in monotone order "
                    f"(9 ${values[9]:.2f}, 21 ${values[21]:.2f}, "
                    f"50 ${values[50]:.2f}, 200 ${values[200]:.2f})."
                ),
                polarity="caution", strength=40, priority=75,
                data={"periods": per_period},
            ))

    # Price vs all EMAs
    if all(last_close > v for v in values.values()):
        facts.append(_make(
            timeframe, "price_above_all",
            text=f"Price ${last_close:.2f} is above every available EMA.",
            polarity="bullish", strength=70, priority=85,
            data={"periods": per_period},
        ))
    elif all(last_close < v for v in values.values()):
        facts.append(_make(
            timeframe, "price_below_all",
            text=f"Price ${last_close:.2f} is below every available EMA.",
            polarity="bearish", strength=70, priority=85,
            data={"periods": per_period},
        ))

    # Per-period near checks
    for period, v in values.items():
        if is_near(last_close, v, atr):
            facts.append(_make(
                timeframe, f"price_near_{period}",
                text=f"Price ${last_close:.2f} is at the EMA-{period} (${v:.2f}).",
                polarity="neutral", strength=55, priority=72,
                data={"period": period, "value": v},
            ))

    # Cross detection between adjacent EMAs (golden/death cross signals)
    cross_pairs = [(9, 21), (21, 50), (50, 200)]
    for short, long in cross_pairs:
        if short not in emas_by_period or long not in emas_by_period:
            continue
        a = [iv.value for iv in emas_by_period[short].values]
        b = [iv.value for iv in emas_by_period[long].values]
        if len(a) != len(b):
            # recent_cross requires aligned series; skip mismatched lengths.
            continue
        found, bars_ago = recent_cross(a, b, timeframe=timeframe)
        if not found:
            continue
        s_now = values[short]
        l_now = values[long]
        polarity = "bullish" if s_now > l_now else "bearish"
        facts.append(_make(
            timeframe, f"cross_{short}_{long}_recent",
            text=(
                f"EMA-{short} crossed EMA-{long} {bars_ago} bar(s) ago "
                f"({'golden' if polarity == 'bullish' else 'death'} cross)."
            ),
            polarity=polarity, strength=75, priority=88,
            data={"short": short, "long": long, "bars_ago": bars_ago},
        ))

    return facts
