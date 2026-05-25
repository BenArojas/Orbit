"""Prompt facts dispatcher.

Routes per-timeframe indicator data to family builders and returns
a list of PromptContextBlock — one per timeframe — with facts sorted by:
  (priority desc, tf_weight desc, strength desc, recency desc).

Per-indicator priority boost: +20 for indicators in indicator_priority.
"""
from __future__ import annotations

from typing import Any

from models import CandleData, FibonacciResult, FibonacciSnapshot, IndicatorResult
from services.prompt_facts.types import PromptContextBlock, PromptFact
from services.prompt_facts.adx import build_adx_facts
from services.prompt_facts.atr import build_atr_facts
from services.prompt_facts.bbands import build_bbands_facts
from services.prompt_facts.ema import build_ema_facts
from services.prompt_facts.fibonacci import build_fibonacci_facts
from services.prompt_facts.macd import build_macd_facts
from services.prompt_facts.obv import build_obv_facts
from services.prompt_facts.rsi import build_rsi_facts
from services.prompt_facts.stoch import build_stoch_facts
from services.prompt_facts.volume import build_volume_facts
from services.prompt_facts.vwap import build_vwap_facts

_TF_WEIGHTS = {"M": 5, "W": 4, "D": 3, "4H": 2, "1H": 1}
_PRIORITY_BOOST = 20


def _tf_weight(tf: str) -> int:
    return _TF_WEIGHTS.get(tf, 1)


def _group_indicators(indicators: list[IndicatorResult]) -> dict[str, list[IndicatorResult]]:
    by_name: dict[str, list[IndicatorResult]] = {}
    for ind in indicators:
        by_name.setdefault(ind.name, []).append(ind)
    return by_name


def _build_for_tf(
    *,
    symbol: str,
    timeframe: str,
    candles: list[CandleData],
    indicators: list[IndicatorResult],
    fibs: list[FibonacciResult | FibonacciSnapshot],
    raw_fibonacci: Any,
    indicator_priority: list[str],
) -> list[PromptFact]:
    facts: list[PromptFact] = []
    last_close = candles[-1].close if candles else 0.0
    by_name = _group_indicators(indicators)

    # Fibonacci — primary snapshot if present, else auto-computed result
    fib_source: FibonacciResult | FibonacciSnapshot | None = None
    if fibs:
        primaries = [f for f in fibs if getattr(f, "is_primary", False)]
        fib_source = primaries[0] if primaries else fibs[0]
    elif raw_fibonacci is not None:
        fib_source = raw_fibonacci

    if fib_source is not None:
        facts.extend(build_fibonacci_facts(
            symbol=symbol, timeframe=timeframe, fib=fib_source, last_close=last_close,
        ))

    if "ema" in by_name:
        facts.extend(build_ema_facts(
            symbol=symbol, timeframe=timeframe, emas=by_name["ema"], last_close=last_close,
        ))

    if "rsi" in by_name and by_name["rsi"]:
        facts.extend(build_rsi_facts(
            symbol=symbol, timeframe=timeframe, rsi=by_name["rsi"][0],
        ))

    if "macd" in by_name and by_name["macd"]:
        facts.extend(build_macd_facts(
            symbol=symbol, timeframe=timeframe, macd=by_name["macd"][0],
        ))

    if "bbands" in by_name and by_name["bbands"]:
        facts.extend(build_bbands_facts(
            symbol=symbol, timeframe=timeframe,
            bbands=by_name["bbands"][0],
            last_close=last_close,
            candles=candles,
        ))

    if "vwap" in by_name and by_name["vwap"]:
        facts.extend(build_vwap_facts(
            symbol=symbol, timeframe=timeframe,
            vwap=by_name["vwap"][0],
            candles=candles,
        ))

    if "atr" in by_name and by_name["atr"]:
        facts.extend(build_atr_facts(
            symbol=symbol, timeframe=timeframe, atr=by_name["atr"][0], last_close=last_close,
        ))

    if "stoch" in by_name and by_name["stoch"]:
        facts.extend(build_stoch_facts(
            symbol=symbol, timeframe=timeframe, stoch=by_name["stoch"][0],
        ))

    if "obv" in by_name and by_name["obv"]:
        facts.extend(build_obv_facts(
            symbol=symbol, timeframe=timeframe, obv=by_name["obv"][0], candles=candles,
        ))

    if "adx" in by_name and by_name["adx"]:
        facts.extend(build_adx_facts(
            symbol=symbol, timeframe=timeframe, adx=by_name["adx"][0],
        ))

    facts.extend(build_volume_facts(symbol=symbol, timeframe=timeframe, candles=candles))

    # Priority boost — applied to all facts whose indicator is in indicator_priority.
    boosted = set(indicator_priority or [])
    if boosted:
        for f in facts:
            if f.indicator in boosted:
                f.priority += _PRIORITY_BOOST

    return facts


def build_prompt_facts(
    *,
    symbol: str,
    timeframe_data: dict[str, dict[str, Any]],
    indicator_priority: list[str],
) -> list[PromptContextBlock]:
    """Build PromptContextBlocks for each timeframe.

    `timeframe_data[tf]` shape (from routers.ai._fetch_timeframe_data):
      {
        "candles": list[CandleData],
        "indicators": list[IndicatorResult],
        "fibs": list[FibonacciSnapshot],      # optional, may be []
        "fibonacci": FibonacciResult | None,  # auto-computed (if no snapshot)
      }
    """
    blocks: list[PromptContextBlock] = []
    for tf, data in timeframe_data.items():
        candles = data.get("candles") or []
        indicators = data.get("indicators") or []
        fibs = data.get("fibs") or []
        raw_fib = data.get("fibonacci")

        facts = _build_for_tf(
            symbol=symbol,
            timeframe=tf,
            candles=candles,
            indicators=indicators,
            fibs=fibs,
            raw_fibonacci=raw_fib,
            indicator_priority=indicator_priority,
        )
        if not facts and not candles:
            continue

        weight = _tf_weight(tf)
        # Sort: priority desc, tf_weight desc (constant within block), strength desc, recency desc.
        # Recency = original insertion order — earlier emission means older fact.
        n = len(facts)
        facts_sorted = sorted(
            list(enumerate(facts)),
            key=lambda pair: (-pair[1].priority, -weight, -pair[1].strength, -(n - pair[0])),
        )
        ordered = [pair[1] for pair in facts_sorted]
        blocks.append(PromptContextBlock(
            timeframe=tf,
            tf_weight=weight,
            facts=ordered,
            last_close=candles[-1].close if candles else 0.0,
        ))

    # Highest TF weight first across blocks.
    blocks.sort(key=lambda b: -b.tf_weight)
    return blocks
