"""
Verifies that a rule fires only when ALL its conditions pass on
the same bar, and that condition_values is populated correctly.
"""
import pytest
from unittest.mock import AsyncMock

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
