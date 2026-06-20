from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from models import CandleData, FibonacciSnapshot, IndicatorResult, IndicatorValue
from services.prompt_builder import build_full_prompt_context_bundle
from tests.fixtures.eval_scenarios import aapl_in_swing, nvda_ema_stack, tsm_extension

_T0 = 1_700_000_000
_DAY = 86_400
_WEEK = 7 * _DAY
_BUDGET_TOKENS = 3500
_DISPLAY_NAME = {
    "adx": "ADX",
    "atr": "ATR",
    "bbands": "Bollinger Bands",
    "ema": "EMA Stack",
    "fibonacci": "Fibonacci Retracement",
    "macd": "MACD",
    "obv": "OBV",
    "rsi": "RSI",
    "stoch": "Stochastic",
    "volume": "Volume",
    "vwap": "VWAP",
}
_INDICATOR_ORDER = (
    "fibonacci",
    "ema",
    "rsi",
    "macd",
    "volume",
    "bbands",
    "vwap",
    "atr",
    "stoch",
    "obv",
    "adx",
)


@dataclass(frozen=True)
class PromptEvalCase:
    case_id: str
    symbol: str
    timeframe_data: dict[str, dict]
    allowed_directions: frozenset[str]
    insufficient_for_levels: bool
    required_caution_concepts: tuple[str, ...] = field(default_factory=tuple)
    context: str = ""
    allowed_fact_ids: frozenset[str] = frozenset()
    grounding_map: dict[str, frozenset[Decimal]] = field(default_factory=dict)
    indicator_names: tuple[str, ...] = field(default_factory=tuple)
    indicators_display: tuple[str, ...] = field(default_factory=tuple)


def _candle(
    close: float,
    *,
    open_offset: float,
    high_offset: float,
    low_offset: float,
    volume: float,
    i: int,
    step: int = _DAY,
) -> CandleData:
    return CandleData(
        time=_T0 + i * step,
        open=close + open_offset,
        high=close + high_offset,
        low=close - low_offset,
        close=close,
        volume=volume,
    )


def _indicator(name: str, values: list[IndicatorValue], **params) -> IndicatorResult:
    return IndicatorResult(name=name, type="overlay", values=values, params=params)


def _iv(value: float, i: int, *, signal: float | None = None) -> IndicatorValue:
    return IndicatorValue(time=_T0 + i * _DAY, value=value, signal=signal)


def _bband_iv(middle: float, upper: float, lower: float, i: int) -> IndicatorValue:
    return IndicatorValue(
        time=_T0 + i * _DAY,
        value=middle,
        upper=upper,
        lower=lower,
    )


def _indicator_names_from_timeframe_data(timeframe_data: dict[str, dict]) -> tuple[str, ...]:
    names: set[str] = set()
    for data in timeframe_data.values():
        for indicator in data.get("indicators", []):
            raw_name = str(getattr(indicator, "name", "")).lower()
            if raw_name:
                names.add(raw_name)
        if data.get("fibs") or data.get("fibonacci") is not None:
            names.add("fibonacci")
    return tuple(name for name in _INDICATOR_ORDER if name in names)


def _make_case(
    *,
    case_id: str,
    symbol: str,
    timeframe_data: dict[str, dict],
    allowed_directions: frozenset[str],
    insufficient_for_levels: bool,
    required_caution_concepts: tuple[str, ...] = (),
) -> PromptEvalCase:
    bundle = build_full_prompt_context_bundle(
        symbol=symbol,
        timeframe_data=timeframe_data,
        indicator_priority=[],
        budget_tokens=_BUDGET_TOKENS,
    )
    indicator_names = _indicator_names_from_timeframe_data(timeframe_data)
    return PromptEvalCase(
        case_id=case_id,
        symbol=symbol,
        timeframe_data=timeframe_data,
        allowed_directions=allowed_directions,
        insufficient_for_levels=insufficient_for_levels,
        required_caution_concepts=required_caution_concepts,
        context=bundle.context,
        allowed_fact_ids=bundle.allowed_fact_ids,
        grounding_map=bundle.grounding_map,
        indicator_names=indicator_names,
        indicators_display=tuple(_DISPLAY_NAME[name] for name in indicator_names if name in _DISPLAY_NAME),
    )


def _wulf_bb_only_timeframe_data() -> dict[str, dict]:
    closes = [
        27.4, 27.1, 26.8, 27.3, 26.9, 27.2, 26.7, 27.0, 26.8,
        27.1, 26.9, 27.2, 26.8, 27.0, 26.7, 26.9, 27.1, 26.8, 25.2,
    ]
    candles = [
        _candle(
            close=close,
            open_offset=-0.2 if i % 2 == 0 else 0.15,
            high_offset=0.45,
            low_offset=0.4,
            volume=1_000_000,
            i=i,
        )
        for i, close in enumerate(closes)
    ]
    widths = [
        (29.8, 24.8),
        (29.4, 24.9),
        (29.2, 24.7),
        (29.7, 24.9),
        (29.5, 24.8),
        (29.6, 24.9),
        (29.3, 24.7),
        (29.4, 24.8),
        (29.5, 24.8),
        (29.6, 24.9),
        (29.4, 24.8),
        (29.5, 24.9),
        (29.3, 24.8),
        (29.4, 24.7),
        (29.2, 24.8),
        (29.3, 24.9),
        (29.4, 24.8),
        (29.3, 24.9),
        (28.0, 25.0),
    ]
    bbands = _indicator(
        "bbands",
        [
            _bband_iv((upper + lower) / 2, upper, lower, i)
            for i, (upper, lower) in enumerate(widths)
        ],
        period=20,
    )
    return {
        "D": {
            "candles": candles,
            "indicators": [bbands],
            "fibs": [],
            "fibonacci": None,
        }
    }


def _conflicting_timeframes_data() -> dict[str, dict]:
    weekly_closes = [
        150.0, 153.0, 156.0, 160.0, 163.0, 166.0, 170.0, 174.0, 178.0,
        182.0, 186.0, 190.0, 194.0, 198.0, 202.0, 206.0, 210.0, 214.0,
        218.0, 222.0, 226.0, 230.0, 234.0, 238.0, 242.0,
    ]
    daily_closes = [
        242.0, 240.0, 238.0, 236.0, 234.0, 232.0, 230.0, 228.0, 226.0,
        224.0, 222.0, 220.0, 218.0, 216.0, 214.0, 212.0, 210.0, 208.0,
        206.0, 204.0, 202.0, 200.0, 198.0, 196.0, 194.0,
    ]
    weekly = {
        "candles": [
            _candle(
                close=close,
                open_offset=-1.5,
                high_offset=2.5,
                low_offset=2.0,
                volume=2_000_000,
                i=i,
                step=_WEEK,
            )
            for i, close in enumerate(weekly_closes)
        ],
        "indicators": [
            _indicator("ema", [_iv(close - 2.0, i) for i, close in enumerate(weekly_closes)], period=9),
            _indicator("ema", [_iv(close - 6.0, i) for i, close in enumerate(weekly_closes)], period=21),
            _indicator("ema", [_iv(close - 14.0, i) for i, close in enumerate(weekly_closes)], period=50),
            _indicator("ema", [_iv(close - 40.0, i) for i, close in enumerate(weekly_closes)], period=200),
        ],
        "fibs": [],
        "fibonacci": None,
    }
    daily = {
        "candles": [
            _candle(
                close=close,
                open_offset=1.2,
                high_offset=2.0,
                low_offset=2.2,
                volume=2_100_000,
                i=i,
            )
            for i, close in enumerate(daily_closes)
        ],
        "indicators": [
            _indicator("ema", [_iv(close + 2.0, i) for i, close in enumerate(daily_closes)], period=9),
            _indicator("ema", [_iv(close + 6.0, i) for i, close in enumerate(daily_closes)], period=21),
            _indicator("ema", [_iv(close + 14.0, i) for i, close in enumerate(daily_closes)], period=50),
            _indicator("ema", [_iv(close + 40.0, i) for i, close in enumerate(daily_closes)], period=200),
        ],
        "fibs": [],
        "fibonacci": None,
    }
    return {"W": weekly, "D": daily}


def _missing_adx_volume_data() -> dict[str, dict]:
    closes = [
        186.0, 188.0, 190.0, 192.0, 194.0, 196.0, 198.0, 200.0, 202.0,
        204.0, 206.0, 208.0, 210.0, 212.0, 214.0, 216.0, 218.0, 220.0,
        222.0, 224.0, 226.0, 228.0, 230.0, 232.0, 234.0,
    ]
    candles = [
        _candle(
            close=close,
            open_offset=-1.0,
            high_offset=2.5,
            low_offset=1.8,
            volume=1_500_000,
            i=i,
        )
        for i, close in enumerate(closes)
    ]
    indicators = [
        _indicator("ema", [_iv(close + 2.0, i) for i, close in enumerate(closes)], period=9),
        _indicator("ema", [_iv(close, i) for i, close in enumerate(closes)], period=21),
        _indicator("ema", [_iv(close - 10.0, i) for i, close in enumerate(closes)], period=50),
        _indicator("ema", [_iv(close - 28.0, i) for i, close in enumerate(closes)], period=200),
        _indicator(
            "rsi",
            [
                _iv(value, i)
                for i, value in enumerate(
                    [
                        54.0, 55.0, 56.2, 57.0, 58.0, 59.0, 60.1, 61.0, 61.5,
                        62.0, 62.4, 62.8, 63.0, 63.2, 63.4, 63.6, 63.8, 64.0,
                        64.2, 64.3, 64.4, 64.5, 64.6, 64.7, 64.8,
                    ]
                )
            ],
            period=14,
        ),
    ]
    fib = FibonacciSnapshot(
        source="auto",
        swing_high=236.0,
        swing_low=206.0,
        swing_high_time=_T0 + 24 * _DAY,
        swing_low_time=_T0 + 9 * _DAY,
        direction="up",
        score=79.0,
        is_primary=True,
        timeframe="D",
        note=None,
    )
    return {
        "D": {
            "candles": candles,
            "indicators": indicators,
            "fibs": [fib],
            "fibonacci": None,
        }
    }


def _single_timeframe_data(scenario: dict) -> dict[str, dict]:
    timeframe = str(scenario["timeframe"])
    return {
        timeframe: {
            "candles": scenario.get("candles", []),
            "indicators": scenario.get("indicators", []),
            "fibs": scenario.get("fibs", []),
            "fibonacci": scenario.get("fibonacci"),
        }
    }


EVAL_CASES: tuple[PromptEvalCase, ...] = (
    _make_case(
        case_id="wulf_bb_sparse",
        symbol="WULF",
        timeframe_data=_wulf_bb_only_timeframe_data(),
        allowed_directions=frozenset({"NEUTRAL"}),
        insufficient_for_levels=True,
        required_caution_concepts=("single verified fact", "insufficient evidence"),
    ),
    _make_case(
        case_id="tsm_extension",
        symbol="TSM",
        timeframe_data=_single_timeframe_data(tsm_extension()),
        allowed_directions=frozenset({"LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=("overextension",),
    ),
    _make_case(
        case_id="aapl_fib_pullback",
        symbol="AAPL",
        timeframe_data=_single_timeframe_data(aapl_in_swing()),
        allowed_directions=frozenset({"LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
    ),
    _make_case(
        case_id="nvda_ema_extension",
        symbol="NVDA",
        timeframe_data=_single_timeframe_data(nvda_ema_stack()),
        allowed_directions=frozenset({"STRONG LONG", "LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=("overextension", "pullback"),
    ),
    _make_case(
        case_id="conflicting_timeframes",
        symbol="QQQ",
        timeframe_data=_conflicting_timeframes_data(),
        allowed_directions=frozenset({"NEUTRAL"}),
        insufficient_for_levels=True,
        required_caution_concepts=("conflicting timeframes",),
    ),
    _make_case(
        case_id="missing_adx_volume",
        symbol="MSFT",
        timeframe_data=_missing_adx_volume_data(),
        allowed_directions=frozenset({"LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=("adx unavailable", "volume unavailable"),
    ),
)
