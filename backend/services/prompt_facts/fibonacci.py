"""Fibonacci fact builder.

Handles both FibonacciResult (backend auto-fibs) and FibonacciSnapshot
(frontend-provided active fibs) via an internal NormalizedFib adapter.

The position logic is the deterministic fix for the original TSM
extension bug: if price is past the swing in the trend direction, we
emit position_above_swing / position_below_swing and SKIP all retracement
level near-checks — those levels aren't in play.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Union

from models import FibonacciLevel, FibonacciResult, FibonacciSnapshot
from services.indicators import (
    FIB_RETRACEMENT_LEVELS,
    GOLDEN_POCKET_LEVELS,
    IndicatorService,
)
from services.prompt_facts._common import is_near
from services.prompt_facts.types import PromptFact


_RATIO_SUFFIX = {
    0.382: "0382",
    0.500: "0500",
    0.618: "0618",
    0.650: "0650",
    0.716: "0716",
}
_GP_BOUNDARIES = (0.618, 0.716)
_TARGET_EXTENSIONS = {1.272: "1272", 1.500: "1500", 1.618: "1618"}


@dataclass
class _Norm:
    direction: str
    swing_low: float
    swing_high: float
    is_nested: bool
    parent_score: Optional[float]
    convergence_zones: list[dict]
    retracement_levels: list[FibonacciLevel]


def _normalize(fib):
    if fib is None:
        return None
    if isinstance(fib, FibonacciResult):
        return _Norm(
            direction=fib.direction,
            swing_low=fib.swing_low,
            swing_high=fib.swing_high,
            is_nested=fib.is_nested,
            parent_score=None,
            convergence_zones=list(fib.convergence_zones or []),
            retracement_levels=list(fib.levels),
        )
    levels = IndicatorService._build_levels(
        swing_low=fib.swing_low,
        swing_high=fib.swing_high,
        direction=fib.direction,
        ratios=FIB_RETRACEMENT_LEVELS,
        kind="retracement",
    )
    return _Norm(
        direction=fib.direction,
        swing_low=fib.swing_low,
        swing_high=fib.swing_high,
        is_nested=False,
        parent_score=None,
        convergence_zones=[],
        retracement_levels=levels,
    )


def _gp_prices(norm: _Norm) -> dict[float, float]:
    out: dict[float, float] = {}
    span = norm.swing_high - norm.swing_low
    for ratio in (0.618, 0.650, 0.716):
        if norm.direction == "up":
            out[ratio] = norm.swing_high - span * ratio
        else:
            out[ratio] = norm.swing_low + span * ratio
    return out


def _extension_prices(norm: _Norm) -> dict[float, float]:
    """Compute target extension prices in the trend direction.

    Up: swing_high + span * (ratio - 1.0)
    Down: swing_low - span * (ratio - 1.0)
    """
    out: dict[float, float] = {}
    span = norm.swing_high - norm.swing_low
    for ratio in _TARGET_EXTENSIONS:
        if norm.direction == "up":
            out[ratio] = norm.swing_high + span * (ratio - 1.0)
        else:
            out[ratio] = norm.swing_low - span * (ratio - 1.0)
    return out


def _make_fact(*, tf, condition, text, polarity, strength, priority, data) -> PromptFact:
    return PromptFact(
        id=f"{tf}.fibonacci.{condition}",
        timeframe=tf,
        indicator="fibonacci",
        text=text,
        polarity=polarity,
        strength=strength,
        priority=priority,
        data=data,
    )


def build_facts(
    fib: Union[FibonacciResult, FibonacciSnapshot, None],
    *,
    last_close: float,
    atr: Optional[float],
    timeframe: str,
) -> list[PromptFact]:
    norm = _normalize(fib)
    if norm is None:
        return []
    if norm.swing_high - norm.swing_low <= 0:
        return []
    if last_close <= 0:
        return []

    facts: list[PromptFact] = []

    # Position
    if norm.direction == "up" and last_close > norm.swing_high:
        pct_above = (last_close - norm.swing_high) / norm.swing_high * 100
        facts.append(_make_fact(
            tf=timeframe, condition="position_above_swing",
            text=(
                f"Price ${last_close:.2f} is {pct_above:+.1f}% above the swing high "
                f"${norm.swing_high:.2f} — extension territory, retracement levels not in play."
            ),
            polarity="bullish", strength=70, priority=95,
            data={"pct_above_swing_high": pct_above, "swing_high": norm.swing_high},
        ))
        return _finalize(facts, norm, timeframe)

    if norm.direction == "down" and last_close < norm.swing_low:
        pct_below = (norm.swing_low - last_close) / norm.swing_low * 100
        facts.append(_make_fact(
            tf=timeframe, condition="position_below_swing",
            text=(
                f"Price ${last_close:.2f} is {pct_below:+.1f}% below the swing low "
                f"${norm.swing_low:.2f} — extension territory, retracement levels not in play."
            ),
            polarity="bearish", strength=70, priority=95,
            data={"pct_below_swing_low": pct_below, "swing_low": norm.swing_low},
        ))
        return _finalize(facts, norm, timeframe)

    # Inside the swing
    span = norm.swing_high - norm.swing_low
    pct_into = (
        (last_close - norm.swing_low) / span * 100
        if norm.direction == "up"
        else (norm.swing_high - last_close) / span * 100
    )
    facts.append(_make_fact(
        tf=timeframe, condition="position_inside_swing",
        text=(
            f"Price ${last_close:.2f} sits at {pct_into:.0f}% into the "
            f"${norm.swing_low:.2f}–${norm.swing_high:.2f} swing ({norm.direction.upper()})."
        ),
        polarity="neutral", strength=40, priority=80,
        data={"pct_into_swing": pct_into},
    ))

    # Golden pocket
    gp = _gp_prices(norm)
    gp_lo, gp_hi = sorted((gp[0.618], gp[0.716]))
    inside_gp = gp_lo <= last_close <= gp_hi
    if inside_gp:
        polarity = "bullish" if norm.direction == "up" else "bearish"
        facts.append(_make_fact(
            tf=timeframe, condition="in_golden_pocket",
            text=(
                f"Price ${last_close:.2f} is inside the golden pocket "
                f"(${gp_lo:.2f}–${gp_hi:.2f}, ratios 0.618–0.716)."
            ),
            polarity=polarity, strength=80, priority=90,
            data={"level_0618": gp[0.618], "level_0650": gp[0.650], "level_0716": gp[0.716]},
        ))
    else:
        nearest = min(_GP_BOUNDARIES, key=lambda r: abs(last_close - gp[r]))
        if is_near(last_close, gp[nearest], atr):
            distance_atr = abs(last_close - gp[nearest]) / atr if atr else None
            facts.append(_make_fact(
                tf=timeframe, condition="near_golden_pocket",
                text=(
                    f"Price ${last_close:.2f} is near the {nearest:.3f} GP boundary "
                    f"at ${gp[nearest]:.2f}."
                ),
                polarity="neutral", strength=55, priority=85,
                data={"distance_atr": distance_atr, "nearest_boundary_ratio": nearest},
            ))

    # price_near_<ratio> for individual retracement levels
    any_near = False
    for level in norm.retracement_levels:
        suffix = _RATIO_SUFFIX.get(round(level.level, 3))
        if suffix is None:
            continue
        if is_near(last_close, level.price, atr):
            any_near = True
            facts.append(_make_fact(
                tf=timeframe, condition=f"price_near_{suffix}",
                text=(
                    f"Price ${last_close:.2f} is near the {level.label} retracement "
                    f"at ${level.price:.2f}."
                ),
                polarity="neutral", strength=60, priority=70,
                data={"level_price": level.price, "ratio": level.level},
            ))

    if not any_near and not inside_gp:
        nearest_above = min(
            (lv.price for lv in norm.retracement_levels if lv.price > last_close),
            default=None,
        )
        nearest_below = max(
            (lv.price for lv in norm.retracement_levels if lv.price < last_close),
            default=None,
        )
        facts.append(_make_fact(
            tf=timeframe, condition="away_from_levels",
            text=(
                f"No retracement level within striking distance of "
                f"${last_close:.2f} (ATR-aware threshold)."
            ),
            polarity="neutral", strength=30, priority=40,
            data={"nearest_above": nearest_above, "nearest_below": nearest_below},
        ))

    return _finalize(facts, norm, timeframe)


def _finalize(facts: list[PromptFact], norm: _Norm, timeframe: str) -> list[PromptFact]:
    ext_prices = _extension_prices(norm)
    ext_polarity = "bullish" if norm.direction == "up" else "bearish"
    direction_word = "above" if norm.direction == "up" else "below"
    for ratio, suffix in _TARGET_EXTENSIONS.items():
        price = ext_prices[ratio]
        facts.append(_make_fact(
            tf=timeframe, condition=f"target_extension_{suffix}",
            text=f"Extension target {ratio:g}: ${price:.2f} ({direction_word} the swing).",
            polarity=ext_polarity, strength=45, priority=50,
            data={"price": price, "ratio": ratio},
        ))

    if norm.is_nested:
        facts.append(_make_fact(
            tf=timeframe, condition="nested_inside_parent",
            text="This swing is nested inside a higher-scoring parent fib.",
            polarity="caution", strength=35, priority=60,
            data={"parent_score": norm.parent_score},
        ))
    if norm.convergence_zones:
        for zone in norm.convergence_zones:
            price = zone.get("price")
            tfs = zone.get("timeframes", [])
            facts.append(_make_fact(
                tf=timeframe, condition="convergence_cross_tf",
                text=f"Cross-TF fib convergence near ${price} across {', '.join(tfs)}.",
                polarity="bullish" if norm.direction == "up" else "bearish",
                strength=75, priority=88,
                data={"convergence_price": price, "timeframes": tfs},
            ))
    return facts
