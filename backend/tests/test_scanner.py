"""
Tests for the background scanner service — critical-promise subset.

Covers:
  - External failures stop safely (indicator compute error, bar still returned)
  - Scanner lifecycle safety (double-start, status before start)
  - Auth wait behaviour (returns false on stop, true when authenticated)
  - Empty watchlist skips evaluation without fetching history
"""
from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from models import CandleData
from services.scanner import ScannerService


# ── Helpers ──────────────────────────────────────────────────


def make_candle(
    t: int = 1_700_000_000,
    o: float = 100.0,
    h: float = 105.0,
    l: float = 95.0,
    c: float = 102.0,
    v: float = 1_000_000,
) -> CandleData:
    return CandleData(time=t, open=o, high=h, low=l, close=c, volume=v)


def make_candles(closes: list[float], base_time: int = 1_700_000_000) -> list[CandleData]:
    """Build a candle list from a sequence of closing prices."""
    candles = []
    for i, c in enumerate(closes):
        candles.append(CandleData(
            time=base_time + i * 86400,
            open=c * 0.99,
            high=c * 1.01,
            low=c * 0.98,
            close=c,
            volume=1_000_000.0,
        ))
    return candles


def _mock_ibkr(candles: list[CandleData]) -> MagicMock:
    """Return a minimal IBKRService mock whose history() returns the given candles."""
    ibkr = MagicMock()
    ibkr.history = AsyncMock(return_value={
        "data": [
            {
                "t": c.time * 1000,
                "o": c.open,
                "h": c.high,
                "l": c.low,
                "c": c.close,
                "v": c.volume,
            }
            for c in candles
        ]
    })
    ibkr.move_between_watchlists = AsyncMock(return_value=None)
    ibkr.get_watchlist_members = AsyncMock(return_value=[])
    return ibkr


def _mock_db(hit_id: int | None = 1) -> MagicMock:
    db = MagicMock()
    db.get_trigger_rules = AsyncMock(return_value=[])
    db.get_setting = AsyncMock(return_value=None)
    db.record_trigger_hit = AsyncMock(return_value=hit_id)
    db.get_watchlist_config = AsyncMock(return_value=None)
    return db


def _make_scanner(ibkr=None, db=None) -> ScannerService:
    return ScannerService(
        ibkr=ibkr or _mock_ibkr([]),
        db=db or _mock_db(),
    )


def _make_per_stock_rule(
    rule_id: int = 1,
    conid: int = 265598,
    symbol: str = "AAPL",
    indicator: str = "rsi",
    condition: str = "below",
    threshold: float | None = 30.0,
    timeframe: str = "1D",
    news_candle_method: str | None = None,
    ibkr_mirror_target: str | None = None,
    watchlist_name: str | None = None,
) -> dict:
    return {
        "id": rule_id,
        "name": f"Rule {rule_id}",
        "conid": conid,
        "symbol": symbol,
        "watchlist_name": watchlist_name,
        "timeframe": timeframe,
        "ibkr_mirror_target": ibkr_mirror_target,
        "scan_interval_seconds": 60,
        "enabled": 1,
        "conditions": [
            {
                "indicator": indicator,
                "condition": condition,
                "threshold": threshold,
                "news_candle_method": news_candle_method,
            },
        ],
    }


# ══════════════════════════════════════════════════════════════
#  _fetch_evaluation_bar — indicator-compute error handling
# ══════════════════════════════════════════════════════════════


class TestFetchEvaluationBarErrorHandling:
    """If IndicatorService.compute raises, the bar should still come back
    (without the indicator), and _evaluate_conditions should treat the
    missing indicator as a no-fire."""

    @pytest.mark.asyncio
    async def test_fetch_evaluation_bar_handles_indicator_compute_error(self, monkeypatch):
        candles = make_candles([100.0 + i for i in range(30)])
        ibkr = _mock_ibkr(candles)
        scanner = ScannerService(ibkr=ibkr, db=_mock_db())

        from services import scanner as scanner_mod

        def _boom(*args, **kwargs):
            raise ValueError("indicator compute exploded")

        monkeypatch.setattr(scanner_mod._indicator_svc, "compute", _boom)

        rule = _make_per_stock_rule(
            indicator="rsi", condition="below", threshold=30.0,
        )

        bar = await scanner._fetch_evaluation_bar(conid=123, rule=rule)

        # Bar still returned (raw OHLCV is independent of indicator compute),
        # but the rsi value must be absent.
        assert bar is not None
        assert "rsi" not in bar

        # And the condition evaluator must treat that as a no-fire.
        result = scanner._evaluate_conditions(rule, bar)
        assert result["fires"] is False


# ══════════════════════════════════════════════════════════════
#  Scanner lifecycle
# ══════════════════════════════════════════════════════════════


class TestScannerLifecycle:
    """Basic start/stop/status tests."""

    def test_status_before_start(self):
        scanner = _make_scanner()
        s = scanner.status()
        assert s["running"] is False
        assert s["default_interval_seconds"] == 300
        assert s["last_run_at"] is None

    @pytest.mark.asyncio
    async def test_double_start_is_safe(self):
        scanner = _make_scanner()
        scanner.start()
        scanner.start()
        await scanner.stop()


# ══════════════════════════════════════════════════════════════
#  Auth wait behaviour
# ══════════════════════════════════════════════════════════════


class TestAuthWait:
    """Tests for _wait_for_ibkr_auth."""

    @pytest.mark.asyncio
    async def test_returns_true_when_already_authenticated(self):
        ibkr = MagicMock()
        ibkr.state = MagicMock()
        ibkr.state.authenticated = True
        scanner = ScannerService(ibkr=ibkr, db=_mock_db())
        result = await scanner._wait_for_ibkr_auth()
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_stop_called(self):
        ibkr = MagicMock()
        ibkr.state = MagicMock()
        ibkr.state.authenticated = False
        scanner = ScannerService(ibkr=ibkr, db=_mock_db())
        scanner._stop_event.set()
        result = await scanner._wait_for_ibkr_auth()
        assert result is False

    @pytest.mark.asyncio
    async def test_authenticates_after_delay(self):
        """Scanner detects auth that arrives mid-wait."""
        ibkr = MagicMock()
        ibkr.state = MagicMock()
        ibkr.state.authenticated = False
        scanner = ScannerService(ibkr=ibkr, db=_mock_db())

        async def _flip():
            await asyncio.sleep(0.05)
            ibkr.state.authenticated = True

        asyncio.create_task(_flip())
        result = await scanner._wait_for_ibkr_auth()
        assert result is True


# ══════════════════════════════════════════════════════════════
#  _evaluate_one — empty watchlist guard
# ══════════════════════════════════════════════════════════════


class TestEvaluateOne:
    """Targeted integration tests for safe evaluation paths."""

    @pytest.mark.asyncio
    async def test_empty_watchlist_skips_evaluation(self):
        ibkr = _mock_ibkr([])
        ibkr.get_watchlist_members = AsyncMock(return_value=[])
        db = _mock_db()
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_per_stock_rule(
            indicator="rsi", condition="below", threshold=40.0,
            conid=None, symbol=None, watchlist_name="Empty List",
        )
        new_hits = await scanner._evaluate_one(rule)
        assert new_hits == 0
        ibkr.history.assert_not_awaited()
