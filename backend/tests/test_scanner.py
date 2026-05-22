"""
Tests for the background scanner service (multi-condition edition).

Covers:
  - module-level _passes — per-condition predicate
  - module-level _scalar_pair — indicator value extraction semantics
  - module-level _evaluate_news_candle_metric — news_candle detection
  - ScannerService._evaluate_one — full fan-out across scope targets
  - ScannerService dedup behaviour — same rule does not re-fire on same day
  - ScannerService start / stop lifecycle
  - ScannerService._wait_for_ibkr_auth
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from models import CandleData
from services.scanner import (
    ScannerService,
    _evaluate_news_candle_metric,
    _passes,
    _scalar_pair,
)


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
#  _passes — per-condition predicate
# ══════════════════════════════════════════════════════════════


class TestPasses:
    """Unit tests for the pure condition evaluator."""

    # above
    def test_above_true(self):
        assert _passes("above", 75.0, 70.0, prev=None) is True

    def test_above_false(self):
        assert _passes("above", 65.0, 70.0, prev=None) is False

    def test_above_equal_is_false(self):
        assert _passes("above", 70.0, 70.0, prev=None) is False

    # below
    def test_below_true(self):
        assert _passes("below", 28.5, 30.0, prev=None) is True

    def test_below_false(self):
        assert _passes("below", 35.0, 30.0, prev=None) is False

    def test_below_equal_is_false(self):
        assert _passes("below", 30.0, 30.0, prev=None) is False

    # crosses_above
    def test_crosses_above_true(self):
        assert _passes("crosses_above", 31.0, 30.0, prev=29.0) is True

    def test_crosses_above_false_no_cross(self):
        assert _passes("crosses_above", 35.0, 30.0, prev=32.0) is False

    def test_crosses_above_was_equal(self):
        # prev == threshold counts as "was at or below"
        assert _passes("crosses_above", 31.0, 30.0, prev=30.0) is True

    def test_crosses_above_no_prev_returns_false(self):
        assert _passes("crosses_above", 31.0, 30.0, prev=None) is False

    # crosses_below
    def test_crosses_below_true(self):
        assert _passes("crosses_below", 29.0, 30.0, prev=31.0) is True

    def test_crosses_below_false_no_cross(self):
        assert _passes("crosses_below", 25.0, 30.0, prev=28.0) is False

    def test_crosses_below_was_equal(self):
        assert _passes("crosses_below", 29.0, 30.0, prev=30.0) is True

    def test_crosses_below_no_prev_returns_false(self):
        assert _passes("crosses_below", 29.0, 30.0, prev=None) is False

    # null threshold + fires
    def test_null_threshold_is_truthy(self):
        assert _passes("above", 1.0, None, prev=None) is True
        assert _passes("above", 0.0, None, prev=None) is False

    def test_fires_op_uses_truthy(self):
        assert _passes("fires", 1.0, 0.5, prev=None) is True
        assert _passes("fires", 0.0, 0.5, prev=None) is False

    # unknown op
    def test_unknown_condition_returns_false(self):
        assert _passes("explodes", 50.0, 30.0, prev=None) is False


# ══════════════════════════════════════════════════════════════
#  _scalar_pair — indicator value extraction
# ══════════════════════════════════════════════════════════════


def _iv(value=None, signal=None, histogram=None, upper=None, lower=None):
    """Build a minimal IndicatorValue-like object."""
    from types import SimpleNamespace
    return SimpleNamespace(
        value=value,
        signal=signal,
        histogram=histogram,
        upper=upper,
        lower=lower,
    )


def _ir(name: str, values: list) -> Any:
    """Build a minimal IndicatorResult-like object."""
    from types import SimpleNamespace
    return SimpleNamespace(name=name, values=values)


class TestScalarPair:
    """Unit tests for indicator value extraction."""

    def _pair(self, indicator, result, last_close=100.0, last_volume=None, candles=None):
        if candles is None:
            candles = make_candles([100.0, 100.0])
        if last_volume is None:
            last_volume = float(candles[-1].volume)
        return _scalar_pair(indicator, result, last_close, last_volume, candles)

    # ── RSI ─────────────────────────────────────────────────

    def test_rsi_returns_raw_value(self):
        result = _ir("rsi", [_iv(value=25.0), _iv(value=28.7)])
        curr, prev = self._pair("rsi", result)
        assert curr == pytest.approx(28.7)
        assert prev == pytest.approx(25.0)

    def test_rsi_missing_returns_none(self):
        curr, prev = self._pair("rsi", None)
        assert curr is None
        assert prev is None

    def test_rsi_single_value_prev_none(self):
        result = _ir("rsi", [_iv(value=28.7)])
        curr, prev = self._pair("rsi", result)
        assert curr == pytest.approx(28.7)
        assert prev is None

    # ── MACD ────────────────────────────────────────────────

    def test_macd_uses_histogram(self):
        result = _ir("macd", [_iv(histogram=-0.5), _iv(histogram=0.3)])
        curr, prev = self._pair("macd", result)
        assert curr == pytest.approx(0.3)
        assert prev == pytest.approx(-0.5)

    def test_macd_falls_back_to_value_when_no_histogram(self):
        result = _ir("macd", [_iv(value=1.5, histogram=None)])
        curr, _ = self._pair("macd", result)
        assert curr == pytest.approx(1.5)

    # ── EMA ─────────────────────────────────────────────────

    def test_ema_returns_price_minus_ema(self):
        result = _ir("ema_50", [_iv(value=95.0), _iv(value=90.0)])
        curr, prev = self._pair("ema_50", result, last_close=100.0)
        assert curr == pytest.approx(10.0)
        assert prev == pytest.approx(5.0)

    def test_ema_threshold_zero_means_price_at_ema(self):
        result = _ir("ema_50", [_iv(value=100.0)])
        curr, _ = self._pair("ema_50", result, last_close=100.0)
        assert curr == pytest.approx(0.0)

    # ── VWAP ────────────────────────────────────────────────

    def test_vwap_returns_price_minus_vwap(self):
        result = _ir("vwap", [_iv(value=98.0), _iv(value=99.0)])
        curr, prev = self._pair("vwap", result, last_close=100.0)
        assert curr == pytest.approx(1.0)
        assert prev == pytest.approx(2.0)

    # ── Bollinger Bands (%B) ─────────────────────────────────

    def test_bbands_pct_b_at_upper(self):
        result = _ir("bbands", [_iv(upper=110.0, lower=90.0)])
        curr, _ = self._pair("bbands", result, last_close=110.0)
        assert curr == pytest.approx(1.0)

    def test_bbands_pct_b_at_lower(self):
        result = _ir("bbands", [_iv(upper=110.0, lower=90.0)])
        curr, _ = self._pair("bbands", result, last_close=90.0)
        assert curr == pytest.approx(0.0)

    def test_bbands_pct_b_midpoint(self):
        result = _ir("bbands", [_iv(upper=110.0, lower=90.0)])
        curr, _ = self._pair("bbands", result, last_close=100.0)
        assert curr == pytest.approx(0.5)

    def test_bbands_above_upper_exceeds_one(self):
        result = _ir("bbands", [_iv(upper=110.0, lower=90.0)])
        curr, _ = self._pair("bbands", result, last_close=115.0)
        assert curr == pytest.approx(1.25)

    def test_bbands_zero_width_returns_none(self):
        result = _ir("bbands", [_iv(upper=100.0, lower=100.0)])
        curr, _ = self._pair("bbands", result, last_close=100.0)
        assert curr is None

    # ── Stochastic ──────────────────────────────────────────

    def test_stoch_uses_k_value(self):
        result = _ir("stoch", [_iv(value=15.0, signal=20.0), _iv(value=18.0, signal=22.0)])
        curr, prev = self._pair("stoch", result)
        assert curr == pytest.approx(18.0)
        assert prev == pytest.approx(15.0)

    # ── Volume ──────────────────────────────────────────────

    def test_volume_uses_candle_volume(self):
        candles = make_candles([100.0, 102.0])
        candles[-1] = CandleData(
            time=candles[-1].time, open=102.0, high=103.0, low=101.0, close=102.0, volume=5_000_000.0
        )
        curr, _ = self._pair("volume", None, candles=candles)
        assert curr == pytest.approx(5_000_000.0)

    def test_volume_single_candle_prev_none(self):
        candles = make_candles([100.0])
        curr, prev = self._pair("volume", None, candles=candles)
        assert curr is not None
        assert prev is None


# ══════════════════════════════════════════════════════════════
#  _evaluate_news_candle_metric — pure function
# ══════════════════════════════════════════════════════════════


def _news_candles(
    prev_closes: list[float],
    prev_ranges: list[tuple[float, float]] | None = None,
    prev_volumes: list[float] | None = None,
    last: dict | None = None,
) -> list[CandleData]:
    n = len(prev_closes)
    out: list[CandleData] = []
    for i, close in enumerate(prev_closes):
        high, low = (prev_ranges[i] if prev_ranges else (close * 1.01, close * 0.99))
        vol = prev_volumes[i] if prev_volumes else 1_000_000.0
        out.append(CandleData(
            time=1_700_000_000 + i * 86400,
            open=close,
            high=high,
            low=low,
            close=close,
            volume=vol,
        ))
    if last:
        out.append(CandleData(
            time=1_700_000_000 + n * 86400,
            open=last.get("o", 100.0),
            high=last.get("h", 101.0),
            low=last.get("l", 99.0),
            close=last.get("c", 100.0),
            volume=last.get("v", 1_000_000.0),
        ))
    return out


class TestEvaluateNewsCandleMetric:
    """Pure-function tests for the news_candle metric helper."""

    def _eval(self, method, candles):
        return _evaluate_news_candle_metric(method, candles)

    # ── volume_spike ─────────────────────────────────────────

    def test_volume_spike_3x(self):
        prev = [100.0] * 20
        candles = _news_candles(
            prev, prev_volumes=[1_000_000.0] * 20,
            last={"v": 3_000_000.0},
        )
        assert self._eval("volume_spike", candles) == pytest.approx(3.0)

    def test_volume_spike_below_average(self):
        prev = [100.0] * 20
        candles = _news_candles(
            prev, prev_volumes=[2_000_000.0] * 20,
            last={"v": 1_000_000.0},
        )
        assert self._eval("volume_spike", candles) == pytest.approx(0.5)

    def test_volume_spike_needs_20_lookback(self):
        prev = [100.0] * 10
        candles = _news_candles(prev, last={"v": 5_000_000.0})
        assert self._eval("volume_spike", candles) is None

    def test_volume_spike_zero_average_returns_none(self):
        prev = [100.0] * 20
        candles = _news_candles(
            prev, prev_volumes=[0.0] * 20,
            last={"v": 1_000_000.0},
        )
        assert self._eval("volume_spike", candles) is None

    # ── range_spike ──────────────────────────────────────────

    def test_range_spike_double(self):
        prev = [100.0] * 20
        ranges = [(101.0, 99.0)] * 20
        candles = _news_candles(
            prev, prev_ranges=ranges,
            last={"o": 100.0, "h": 102.0, "l": 98.0, "c": 100.0},
        )
        assert self._eval("range_spike", candles) == pytest.approx(2.0)

    def test_range_spike_needs_20_lookback(self):
        prev = [100.0] * 5
        candles = _news_candles(prev, last={"h": 110.0, "l": 90.0})
        assert self._eval("range_spike", candles) is None

    def test_range_spike_zero_avg_returns_none(self):
        prev = [100.0] * 20
        ranges = [(100.0, 100.0)] * 20
        candles = _news_candles(
            prev, prev_ranges=ranges,
            last={"h": 105.0, "l": 95.0},
        )
        assert self._eval("range_spike", candles) is None

    # ── gap ──────────────────────────────────────────────────

    def test_gap_up_2_percent(self):
        prev = [100.0] * 20
        candles = _news_candles(
            prev, last={"o": 102.0, "h": 103.0, "l": 101.5, "c": 102.5},
        )
        assert self._eval("gap", candles) == pytest.approx(2.0)

    def test_gap_down_uses_absolute(self):
        prev = [100.0] * 20
        candles = _news_candles(
            prev, last={"o": 97.0, "h": 97.5, "l": 95.5, "c": 96.0},
        )
        assert self._eval("gap", candles) == pytest.approx(3.0)

    def test_gap_needs_only_2_bars(self):
        candles = [
            make_candle(t=1, o=100.0, h=101.0, l=99.0, c=100.0),
            make_candle(t=2, o=105.0, h=106.0, l=104.0, c=105.5),
        ]
        assert self._eval("gap", candles) == pytest.approx(5.0)

    def test_gap_zero_prev_close_returns_none(self):
        candles = [
            make_candle(t=1, o=0.0, h=0.0, l=0.0, c=0.0),
            make_candle(t=2, o=10.0, h=11.0, l=9.0, c=10.0),
        ]
        assert self._eval("gap", candles) is None

    # ── long_wick ────────────────────────────────────────────

    def test_long_wick_upper_3x_body(self):
        prev = [100.0] * 2
        candles = _news_candles(
            prev,
            last={"o": 100.0, "h": 104.0, "l": 100.0, "c": 101.0},
        )
        assert self._eval("long_wick", candles) == pytest.approx(3.0)

    def test_long_wick_lower_beats_upper(self):
        prev = [100.0] * 2
        candles = _news_candles(
            prev,
            last={"o": 101.0, "h": 101.0, "l": 95.0, "c": 100.0},
        )
        assert self._eval("long_wick", candles) == pytest.approx(5.0)

    def test_long_wick_doji_body_zero_returns_none(self):
        prev = [100.0] * 2
        candles = _news_candles(
            prev,
            last={"o": 100.0, "h": 102.0, "l": 98.0, "c": 100.0},
        )
        assert self._eval("long_wick", candles) is None

    # ── Guards ───────────────────────────────────────────────

    def test_unknown_method_returns_none(self):
        candles = make_candles([100.0, 101.0, 102.0])
        assert self._eval("tsunami", candles) is None

    def test_none_method_returns_none(self):
        candles = make_candles([100.0, 101.0, 102.0])
        assert self._eval(None, candles) is None

    def test_not_enough_candles_returns_none(self):
        candles = [make_candle()]
        assert self._eval("gap", candles) is None


# ══════════════════════════════════════════════════════════════
#  _evaluate_one — full fan-out integration
# ══════════════════════════════════════════════════════════════


class TestEvaluateOne:
    """Integration tests: rule → scope → fetch_bar → evaluate → record."""

    @pytest.mark.asyncio
    async def test_per_stock_rsi_below_fires(self):
        """Per-stock rule: RSI < 40 fires on a declining series."""
        closes = [100.0 - i * 1.5 for i in range(30)]
        candles = make_candles(closes)

        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=42)
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_per_stock_rule(indicator="rsi", condition="below", threshold=40.0)
        new_hits = await scanner._evaluate_one(rule)
        assert new_hits == 1
        db.record_trigger_hit.assert_called_once()
        kwargs = db.record_trigger_hit.call_args.kwargs
        values = kwargs["condition_values"]
        assert len(values) == 1
        assert values[0]["indicator"] == "rsi"
        assert values[0]["actual_value"] < 40.0

    @pytest.mark.asyncio
    async def test_per_stock_rsi_above_does_not_fire(self):
        closes = [100.0 - i * 1.5 for i in range(30)]
        candles = make_candles(closes)

        ibkr = _mock_ibkr(candles)
        db = _mock_db()
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_per_stock_rule(indicator="rsi", condition="above", threshold=70.0)
        new_hits = await scanner._evaluate_one(rule)
        assert new_hits == 0
        db.record_trigger_hit.assert_not_called()

    @pytest.mark.asyncio
    async def test_dedup_returns_zero_new_hits(self):
        closes = [100.0 - i * 1.5 for i in range(30)]
        candles = make_candles(closes)
        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=None)  # dedup
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_per_stock_rule(indicator="rsi", condition="below", threshold=40.0)
        new_hits = await scanner._evaluate_one(rule)
        assert new_hits == 0

    @pytest.mark.asyncio
    async def test_callback_called_with_new_signature(self):
        """on_trigger_fired receives (hit_id, rule, target, condition_values)."""
        closes = [100.0 - i * 1.5 for i in range(30)]
        candles = make_candles(closes)
        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=99)
        scanner = ScannerService(ibkr=ibkr, db=db)

        received: list[tuple] = []

        async def _cb(hit_id, rule, target, values):
            received.append((hit_id, rule["id"], target["conid"], values))

        scanner.on_trigger_fired = _cb

        rule = _make_per_stock_rule(indicator="rsi", condition="below", threshold=40.0)
        await scanner._evaluate_one(rule)

        assert len(received) == 1
        hit_id, rule_id, conid, values = received[0]
        assert (hit_id, rule_id, conid) == (99, 1, 265598)
        assert len(values) == 1

    @pytest.mark.asyncio
    async def test_not_enough_candles_returns_zero(self):
        ibkr = _mock_ibkr([make_candle()])  # only 1 candle
        db = _mock_db()
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_per_stock_rule(indicator="rsi", condition="below", threshold=30.0)
        new_hits = await scanner._evaluate_one(rule)
        assert new_hits == 0
        db.record_trigger_hit.assert_not_called()

    @pytest.mark.asyncio
    async def test_news_candle_gap_fires(self):
        """news_candle rule with method=gap fires on a 3% gap."""
        prev = [100.0] * 20
        candles = _news_candles(
            prev, last={"o": 103.0, "h": 104.0, "l": 102.5, "c": 103.5},
        )
        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=11)
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_per_stock_rule(
            indicator="news_candle", condition="above",
            threshold=1.5, news_candle_method="gap",
        )
        new_hits = await scanner._evaluate_one(rule)
        assert new_hits == 1
        kwargs = db.record_trigger_hit.call_args.kwargs
        actual = kwargs["condition_values"][0]["actual_value"]
        assert actual == pytest.approx(3.0)

    @pytest.mark.asyncio
    async def test_news_candle_below_threshold_no_fire(self):
        prev = [100.0] * 20
        candles = _news_candles(
            prev, last={"o": 101.0, "h": 101.5, "l": 100.8, "c": 101.2},
        )
        ibkr = _mock_ibkr(candles)
        db = _mock_db()
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_per_stock_rule(
            indicator="news_candle", condition="above",
            threshold=5.0, news_candle_method="gap",
        )
        new_hits = await scanner._evaluate_one(rule)
        assert new_hits == 0
        db.record_trigger_hit.assert_not_called()

    @pytest.mark.asyncio
    async def test_multi_condition_rule_fires_when_all_pass(self):
        """Two conditions on the same rule — both must pass to fire."""
        closes = [100.0 - i * 1.5 for i in range(30)]
        candles = make_candles(closes)
        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=77)
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_per_stock_rule(indicator="rsi", condition="below", threshold=40.0)
        # add a second condition that should pass: close below 100
        rule["conditions"].append({
            "indicator": "close",
            "condition": "below",
            "threshold": 100.0,
            "news_candle_method": None,
        })

        new_hits = await scanner._evaluate_one(rule)
        assert new_hits == 1
        kwargs = db.record_trigger_hit.call_args.kwargs
        assert len(kwargs["condition_values"]) == 2

    @pytest.mark.asyncio
    async def test_multi_condition_rule_no_fire_when_one_fails(self):
        closes = [100.0 - i * 1.5 for i in range(30)]
        candles = make_candles(closes)
        ibkr = _mock_ibkr(candles)
        db = _mock_db()
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_per_stock_rule(indicator="rsi", condition="below", threshold=40.0)
        # second condition fails: close above 200
        rule["conditions"].append({
            "indicator": "close",
            "condition": "above",
            "threshold": 200.0,
            "news_candle_method": None,
        })

        new_hits = await scanner._evaluate_one(rule)
        assert new_hits == 0
        db.record_trigger_hit.assert_not_called()

    @pytest.mark.asyncio
    async def test_watchlist_scope_fans_out_to_members(self):
        """A watchlist-scoped rule fetches & evaluates each member."""
        closes = [100.0 - i * 1.5 for i in range(30)]
        candles = make_candles(closes)
        ibkr = _mock_ibkr(candles)
        ibkr.get_watchlist_members = AsyncMock(return_value=[
            {"conid": 10, "symbol": "AAA"},
            {"conid": 20, "symbol": "BBB"},
        ])
        db = _mock_db(hit_id=1)
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_per_stock_rule(
            indicator="rsi", condition="below", threshold=40.0,
            conid=None, symbol=None, watchlist_name="Swing Setups",
        )
        new_hits = await scanner._evaluate_one(rule)
        # Two members → both fire (history mock returns the same candles for both)
        assert new_hits == 2
        # Two history calls — one per member
        assert ibkr.history.await_count == 2

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
    async def test_start_creates_task(self):
        scanner = _make_scanner()
        scanner.start()
        assert scanner._task is not None
        assert not scanner._task.done()
        await scanner.stop()

    @pytest.mark.asyncio
    async def test_double_start_is_safe(self):
        scanner = _make_scanner()
        scanner.start()
        scanner.start()
        await scanner.stop()

    @pytest.mark.asyncio
    async def test_stop_sets_running_false(self):
        scanner = _make_scanner()
        scanner.start()
        await scanner.stop()
        assert scanner.status()["running"] is False

    @pytest.mark.asyncio
    async def test_stop_before_start_is_safe(self):
        scanner = _make_scanner()
        await scanner.stop()

    @pytest.mark.asyncio
    async def test_stop_before_auth_returns_cleanly(self):
        ibkr = MagicMock()
        ibkr.state = MagicMock()
        ibkr.state.authenticated = False
        scanner = ScannerService(ibkr=ibkr, db=_mock_db())
        scanner.start()
        await asyncio.sleep(0.05)
        await scanner.stop()
        assert scanner.status()["running"] is False


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

        # Force the shared module-level IndicatorService.compute to raise
        # one of the caught exceptions.
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
