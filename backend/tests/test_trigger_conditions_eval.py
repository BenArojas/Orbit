"""
Verifies that a rule fires only when ALL its conditions pass on
the same bar, and that condition_values is populated correctly.
"""
import pytest
from unittest.mock import AsyncMock

from models import CandleData
from services.scanner import ScannerService


def _bar_with(rsi: float, ema_200: float, close: float) -> dict:
    return {"rsi": rsi, "ema_200": ema_200, "close": close}


@pytest.mark.asyncio
async def test_all_conditions_pass_fires():
    scanner = ScannerService(db=AsyncMock(), ibkr=AsyncMock())
    rule = {
        "id": 1, "name": "Mean Rev", "conid": 123, "symbol": "AAPL",
        "watchlist_name": None, "timeframe": "1D", "ibkr_mirror_target": None,
        "conditions": [
            {"indicator": "rsi", "condition": "below", "threshold": 30.0},
            {"indicator": "ema_200", "condition": "above", "threshold": 0.0},
        ],
    }
    bar = _bar_with(rsi=25.0, ema_200=180.0, close=185.0)
    result = scanner._evaluate_conditions(rule, bar)
    assert result["fires"] is True
    assert len(result["values"]) == 2


@pytest.mark.asyncio
async def test_one_condition_fails_no_fire():
    scanner = ScannerService(db=AsyncMock(), ibkr=AsyncMock())
    rule = {
        "id": 1, "conid": 123, "symbol": "AAPL",
        "watchlist_name": None, "timeframe": "1D", "ibkr_mirror_target": None,
        "conditions": [
            {"indicator": "rsi", "condition": "below", "threshold": 30.0},
            {"indicator": "ema_200", "condition": "above", "threshold": 0.0},
        ],
    }
    bar = _bar_with(rsi=45.0, ema_200=180.0, close=185.0)
    result = scanner._evaluate_conditions(rule, bar)
    assert result["fires"] is False


@pytest.mark.asyncio
async def test_close_range_conditions_support_fib_golden_pocket_alerts():
    scanner = ScannerService(db=AsyncMock(), ibkr=AsyncMock())
    rule = {
        "id": 1,
        "conid": 123,
        "symbol": "AAPL",
        "watchlist_name": None,
        "timeframe": "15m",
        "ibkr_mirror_target": None,
        "conditions": [
            {"indicator": "close", "condition": "above", "threshold": 110.5},
            {"indicator": "close", "condition": "below", "threshold": 111.46},
        ],
    }

    inside = scanner._evaluate_conditions(rule, {"close": 111.0})
    outside = scanner._evaluate_conditions(rule, {"close": 112.0})

    assert inside["fires"] is True
    assert outside["fires"] is False
    assert inside["values"] == [
        {
            "indicator": "close",
            "condition": "above",
            "threshold": 110.5,
            "actual_value": 111.0,
            "news_candle_method": None,
        },
        {
            "indicator": "close",
            "condition": "below",
            "threshold": 111.46,
            "actual_value": 111.0,
            "news_candle_method": None,
        },
    ]


@pytest.mark.asyncio
async def test_crosses_above_requires_prior_bar_below():
    scanner = ScannerService(db=AsyncMock(), ibkr=AsyncMock())
    rule = {
        "id": 1, "conid": 123, "symbol": "AAPL",
        "watchlist_name": None, "timeframe": "1D", "ibkr_mirror_target": None,
        "conditions": [
            {"indicator": "rsi", "condition": "crosses_above", "threshold": 30.0},
        ],
    }
    bar = {"rsi": 32.0, "rsi_prev": 28.0, "close": 100.0}
    result = scanner._evaluate_conditions(rule, bar)
    assert result["fires"] is True

    bar2 = {"rsi": 32.0, "rsi_prev": 31.0, "close": 100.0}
    result2 = scanner._evaluate_conditions(rule, bar2)
    assert result2["fires"] is False


@pytest.mark.asyncio
async def test_crosses_below_requires_prior_bar_above():
    scanner = ScannerService(db=AsyncMock(), ibkr=AsyncMock())
    rule = {
        "id": 1, "conid": 123, "symbol": "AAPL",
        "watchlist_name": None, "timeframe": "1D", "ibkr_mirror_target": None,
        "conditions": [
            {"indicator": "rsi", "condition": "crosses_below", "threshold": 70.0},
        ],
    }
    bar = {"rsi": 68.0, "rsi_prev": 72.0, "close": 100.0}
    result = scanner._evaluate_conditions(rule, bar)
    assert result["fires"] is True

    bar2 = {"rsi": 68.0, "rsi_prev": 69.0, "close": 100.0}
    result2 = scanner._evaluate_conditions(rule, bar2)
    assert result2["fires"] is False


@pytest.mark.asyncio
async def test_volume_condition_uses_20_bar_average_ratio():
    scanner = ScannerService(db=AsyncMock(), ibkr=AsyncMock())
    candles = [
        CandleData(time=i, open=10, high=11, low=9, close=10, volume=100)
        for i in range(20)
    ]
    candles.append(CandleData(time=20, open=10, high=11, low=9, close=10, volume=250))
    scanner._fetch_candles = AsyncMock(return_value=candles)
    rule = {
        "id": 1,
        "conid": 123,
        "symbol": "AAPL",
        "watchlist_name": None,
        "timeframe": "1D",
        "conditions": [
            {"indicator": "volume", "condition": "above", "threshold": 1.5},
        ],
    }

    bar = await scanner._fetch_evaluation_bar(123, rule)

    assert bar is not None
    assert bar["volume"] == 2.5


@pytest.mark.asyncio
async def test_fetch_evaluation_bar_uses_rule_timeframe_history_spec():
    ibkr = AsyncMock()
    ibkr.history = AsyncMock(return_value={
        "data": [
            {"t": 1_000, "o": 10, "h": 11, "l": 9, "c": 10, "v": 100},
            {"t": 2_000, "o": 10, "h": 11, "l": 9, "c": 10, "v": 110},
        ],
    })
    scanner = ScannerService(db=AsyncMock(), ibkr=ibkr)
    rule = {
        "id": 1,
        "conid": 123,
        "symbol": "AAPL",
        "watchlist_name": None,
        "timeframe": "15m",
        "conditions": [
            {"indicator": "rsi", "condition": "below", "threshold": 30.0},
        ],
    }

    await scanner._fetch_evaluation_bar(123, rule)

    ibkr.history.assert_awaited_once_with(123, period="1w", bar="15min")
