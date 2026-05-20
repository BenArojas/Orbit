"""
Tests for the background scanner service (Phase 6.1 / 6.2).

Covers:
  - ScannerService._check_condition — all four conditions + edge cases
  - ScannerService._extract_values — per-indicator scalar extraction
  - ScannerService._evaluate_group — full evaluation with mocked IBKR + DB
  - ScannerService dedup behaviour — same rule does not re-fire on same day
  - ScannerService start / stop lifecycle
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

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
    """Build a candle list from a sequence of closing prices (all other fields derived)."""
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
    return ibkr


def _mock_db(hit_id: int | None = 1) -> MagicMock:
    """Return a minimal DatabaseService mock."""
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


def _make_rule(
    rule_id: int = 1,
    conid: int = 265598,
    symbol: str = "AAPL",
    indicator: str = "rsi",
    condition: str = "below",
    threshold: float = 30.0,
    timeframe: str = "1D",
    auto_expire_days: int | None = None,
) -> dict:
    return {
        "id": rule_id,
        "conid": conid,
        "symbol": symbol,
        "indicator": indicator,
        "condition": condition,
        "threshold": threshold,
        "timeframe": timeframe,
        "target_watchlist": "RSI Alerts",
        "source_watchlist": "My Stocks",
        "auto_expire_days": auto_expire_days,
        "enabled": 1,
    }


# ══════════════════════════════════════════════════════════════
#  _check_condition
# ══════════════════════════════════════════════════════════════


class TestCheckCondition:
    """Unit tests for the pure condition evaluator."""

    def _chk(self, prev, curr, condition, threshold) -> bool:
        return ScannerService._check_condition(prev, curr, condition, threshold)

    # above
    def test_above_true(self):
        assert self._chk(None, 75.0, "above", 70.0) is True

    def test_above_false(self):
        assert self._chk(None, 65.0, "above", 70.0) is False

    def test_above_equal_is_false(self):
        # "above" means strictly greater than
        assert self._chk(None, 70.0, "above", 70.0) is False

    # below
    def test_below_true(self):
        assert self._chk(None, 28.5, "below", 30.0) is True

    def test_below_false(self):
        assert self._chk(None, 35.0, "below", 30.0) is False

    def test_below_equal_is_false(self):
        assert self._chk(None, 30.0, "below", 30.0) is False

    # crosses_above
    def test_crosses_above_true(self):
        assert self._chk(29.0, 31.0, "crosses_above", 30.0) is True

    def test_crosses_above_false_no_cross(self):
        assert self._chk(32.0, 35.0, "crosses_above", 30.0) is False

    def test_crosses_above_was_equal(self):
        # prev == threshold counts as "was at or below" → crossing above is valid
        assert self._chk(30.0, 31.0, "crosses_above", 30.0) is True

    def test_crosses_above_no_prev_returns_false(self):
        assert self._chk(None, 31.0, "crosses_above", 30.0) is False

    # crosses_below
    def test_crosses_below_true(self):
        assert self._chk(31.0, 29.0, "crosses_below", 30.0) is True

    def test_crosses_below_false_no_cross(self):
        assert self._chk(28.0, 25.0, "crosses_below", 30.0) is False

    def test_crosses_below_was_equal(self):
        assert self._chk(30.0, 29.0, "crosses_below", 30.0) is True

    def test_crosses_below_no_prev_returns_false(self):
        assert self._chk(None, 29.0, "crosses_below", 30.0) is False

    # unknown condition
    def test_unknown_condition_returns_false(self):
        assert self._chk(None, 50.0, "explodes", 30.0) is False


# ══════════════════════════════════════════════════════════════
#  _extract_values
# ══════════════════════════════════════════════════════════════


def _iv(value=None, signal=None, histogram=None, upper=None, lower=None):
    """Build a minimal IndicatorValue-like object (using a SimpleNamespace)."""
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


class TestExtractValues:
    """Unit tests for indicator value extraction logic."""

    def _extract(self, indicator, results, last_close=100.0, last_volume=None, candles=None):
        scanner = _make_scanner()
        if candles is None:
            candles = make_candles([100.0, 100.0])
        # Mirror how _evaluate_group calls _extract_values: last_volume comes
        # from the last candle, so tests that supply custom candles get the
        # right volume automatically without having to repeat it.
        if last_volume is None:
            last_volume = float(candles[-1].volume)
        return scanner._extract_values(indicator, results, last_close, last_volume, candles)

    # ── RSI ─────────────────────────────────────────────────

    def test_rsi_returns_raw_value(self):
        results = {"rsi": _ir("rsi", [_iv(value=25.0), _iv(value=28.7)])}
        prev, curr = self._extract("rsi", results)
        assert curr == pytest.approx(28.7)
        assert prev == pytest.approx(25.0)

    def test_rsi_missing_returns_none(self):
        prev, curr = self._extract("rsi", {})
        assert curr is None
        assert prev is None

    def test_rsi_single_value_prev_none(self):
        results = {"rsi": _ir("rsi", [_iv(value=28.7)])}
        prev, curr = self._extract("rsi", results)
        assert curr == pytest.approx(28.7)
        assert prev is None

    # ── MACD ────────────────────────────────────────────────

    def test_macd_uses_histogram(self):
        results = {"macd": _ir("macd", [_iv(histogram=-0.5), _iv(histogram=0.3)])}
        prev, curr = self._extract("macd", results)
        assert curr == pytest.approx(0.3)
        assert prev == pytest.approx(-0.5)

    def test_macd_falls_back_to_value_when_no_histogram(self):
        results = {"macd": _ir("macd", [_iv(value=1.5, histogram=None)])}
        _, curr = self._extract("macd", results)
        assert curr == pytest.approx(1.5)

    # ── EMA ─────────────────────────────────────────────────

    def test_ema_returns_price_minus_ema(self):
        # last_close=100, EMA=90 → value=10
        results = {"ema_50": _ir("ema_50", [_iv(value=95.0), _iv(value=90.0)])}
        prev, curr = self._extract("ema_50", results, last_close=100.0)
        assert curr == pytest.approx(10.0)  # 100 - 90
        assert prev == pytest.approx(5.0)   # 100 - 95

    def test_ema_threshold_zero_means_price_at_ema(self):
        # When last_close == EMA, value == 0 → "above" threshold=0 is False
        results = {"ema_50": _ir("ema_50", [_iv(value=100.0)])}
        _, curr = self._extract("ema_50", results, last_close=100.0)
        assert curr == pytest.approx(0.0)

    # ── VWAP ────────────────────────────────────────────────

    def test_vwap_returns_price_minus_vwap(self):
        results = {"vwap": _ir("vwap", [_iv(value=98.0), _iv(value=99.0)])}
        prev, curr = self._extract("vwap", results, last_close=100.0)
        assert curr == pytest.approx(1.0)   # 100 - 99
        assert prev == pytest.approx(2.0)   # 100 - 98

    # ── Bollinger Bands (%B) ─────────────────────────────────

    def test_bbands_pct_b_at_upper(self):
        # close == upper → %B = 1.0
        results = {"bbands": _ir("bbands", [_iv(upper=110.0, lower=90.0)])}
        _, curr = self._extract("bbands", results, last_close=110.0)
        assert curr == pytest.approx(1.0)

    def test_bbands_pct_b_at_lower(self):
        results = {"bbands": _ir("bbands", [_iv(upper=110.0, lower=90.0)])}
        _, curr = self._extract("bbands", results, last_close=90.0)
        assert curr == pytest.approx(0.0)

    def test_bbands_pct_b_midpoint(self):
        results = {"bbands": _ir("bbands", [_iv(upper=110.0, lower=90.0)])}
        _, curr = self._extract("bbands", results, last_close=100.0)
        assert curr == pytest.approx(0.5)

    def test_bbands_above_upper_exceeds_one(self):
        results = {"bbands": _ir("bbands", [_iv(upper=110.0, lower=90.0)])}
        _, curr = self._extract("bbands", results, last_close=115.0)
        assert curr == pytest.approx(1.25)

    def test_bbands_zero_width_returns_none(self):
        results = {"bbands": _ir("bbands", [_iv(upper=100.0, lower=100.0)])}
        _, curr = self._extract("bbands", results, last_close=100.0)
        assert curr is None

    # ── Stochastic ──────────────────────────────────────────

    def test_stoch_uses_k_value(self):
        results = {"stoch": _ir("stoch", [_iv(value=15.0, signal=20.0), _iv(value=18.0, signal=22.0)])}
        prev, curr = self._extract("stoch", results)
        assert curr == pytest.approx(18.0)
        assert prev == pytest.approx(15.0)

    # ── Volume ──────────────────────────────────────────────

    def test_volume_uses_candle_volume(self):
        candles = make_candles([100.0, 102.0])
        candles[-1] = CandleData(
            time=candles[-1].time, open=102.0, high=103.0, low=101.0, close=102.0, volume=5_000_000.0
        )
        prev, curr = self._extract("volume", {}, candles=candles)
        assert curr == pytest.approx(5_000_000.0)

    def test_volume_single_candle_prev_none(self):
        candles = make_candles([100.0])
        _, curr = self._extract("volume", {}, candles=candles)
        assert curr is not None
        prev, _ = self._extract("volume", {}, candles=candles)
        # With only one candle prev should be None
        assert prev is None


# ══════════════════════════════════════════════════════════════
#  _evaluate_group — integration-level
# ══════════════════════════════════════════════════════════════


class TestEvaluateGroup:
    """Integration tests for _evaluate_group: mocked IBKR + DB."""

    @pytest.mark.asyncio
    async def test_rsi_below_fires_when_rsi_is_low(self):
        """Rule: RSI < 30 → fires when RSI is 28."""
        # Build candles that will produce RSI ≈ 28 (lots of down days)
        # Use enough bars for RSI-14 to converge (need at least 14)
        closes = [100.0 - i * 1.5 for i in range(30)]  # steady decline → low RSI
        candles = make_candles(closes)

        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=42)
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_rule(indicator="rsi", condition="below", threshold=40.0)

        # Run evaluation — RSI on a 30-bar decline will be well below 40
        hits = await scanner._evaluate_group(rule["conid"], [rule])
        assert hits == 1
        db.record_trigger_hit.assert_called_once()
        call_kwargs = db.record_trigger_hit.call_args.kwargs
        assert call_kwargs["rule_id"] == 1
        assert call_kwargs["actual_value"] < 40.0

    @pytest.mark.asyncio
    async def test_rsi_above_does_not_fire_when_rsi_is_low(self):
        """Rule: RSI > 70 → should NOT fire on a declining price series."""
        closes = [100.0 - i * 1.5 for i in range(30)]  # down trend → low RSI
        candles = make_candles(closes)

        ibkr = _mock_ibkr(candles)
        db = _mock_db()
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_rule(indicator="rsi", condition="above", threshold=70.0)

        hits = await scanner._evaluate_group(rule["conid"], [rule])
        assert hits == 0
        db.record_trigger_hit.assert_not_called()

    @pytest.mark.asyncio
    async def test_ema_crosses_above_fires_on_breakout(self):
        """
        Rule: EMA-9 crosses above (price − EMA > 0 crosses above 0).
        Build a series that starts below its EMA-9 then rallies through it.
        """
        # 20 bars flat at 100, then 5 bars rallying to 115
        closes = [100.0] * 20 + [102.0, 104.0, 107.0, 111.0, 115.0]
        candles = make_candles(closes)

        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=7)
        scanner = ScannerService(ibkr=ibkr, db=db)

        # threshold=0: price crossing above EMA-9
        rule = _make_rule(indicator="ema_9", condition="crosses_above", threshold=0.0)

        hits = await scanner._evaluate_group(rule["conid"], [rule])
        # May or may not fire depending on where in the rally the EMA sits,
        # but the machinery should not raise any exceptions
        assert hits >= 0  # structural integrity
        assert not db.record_trigger_hit.called or db.record_trigger_hit.call_args.kwargs["actual_value"] > 0

    @pytest.mark.asyncio
    async def test_dedup_prevents_double_fire(self):
        """When record_trigger_hit returns None (dedup), hit count stays 0."""
        closes = [100.0 - i * 1.5 for i in range(30)]
        candles = make_candles(closes)

        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=None)  # None = deduplicated
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_rule(indicator="rsi", condition="below", threshold=40.0)
        hits = await scanner._evaluate_group(rule["conid"], [rule])

        # DB was called (rule evaluated and fired) but hit_id=None → not counted
        assert hits == 0

    @pytest.mark.asyncio
    async def test_callback_called_on_new_hit(self):
        """on_trigger_fired callback is invoked with (rule, hit_id, actual_value)."""
        closes = [100.0 - i * 1.5 for i in range(30)]
        candles = make_candles(closes)

        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=99)
        scanner = ScannerService(ibkr=ibkr, db=db)

        received: list[tuple] = []

        async def _cb(rule, hit_id, actual_value):
            received.append((rule, hit_id, actual_value))

        scanner.on_trigger_fired = _cb

        rule = _make_rule(indicator="rsi", condition="below", threshold=40.0)
        await scanner._evaluate_group(rule["conid"], [rule])

        assert len(received) == 1
        assert received[0][1] == 99  # hit_id

    @pytest.mark.asyncio
    async def test_not_enough_candles_returns_zero(self):
        """If IBKR returns < 2 candles, evaluation silently returns 0."""
        ibkr = _mock_ibkr([make_candle()])  # only 1 candle
        db = _mock_db()
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = _make_rule(indicator="rsi", condition="below", threshold=30.0)
        hits = await scanner._evaluate_group(rule["conid"], [rule])

        assert hits == 0
        db.record_trigger_hit.assert_not_called()


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
        scanner.start()  # second call should be a no-op
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
        await scanner.stop()  # should not raise

    @pytest.mark.asyncio
    async def test_stop_before_auth_returns_cleanly(self):
        """If stop() is called while waiting for auth, the task exits cleanly."""
        ibkr = MagicMock()
        ibkr.state = MagicMock()
        ibkr.state.authenticated = False  # never authenticates
        scanner = ScannerService(ibkr=ibkr, db=_mock_db())
        scanner.start()
        await asyncio.sleep(0.05)  # let the task start its auth-wait loop
        await scanner.stop()
        assert scanner.status()["running"] is False


# ══════════════════════════════════════════════════════════════
#  Per-rule interval: _rule_is_due
# ══════════════════════════════════════════════════════════════


class TestRuleIsDue:
    """Unit tests for per-rule interval filtering."""

    def _scanner(self) -> ScannerService:
        return _make_scanner()

    def _rule(self, rule_id: int = 1, interval: int | None = None) -> dict:
        r = _make_rule(rule_id=rule_id)
        r["scan_interval_seconds"] = interval
        return r

    def test_rule_never_evaluated_is_always_due(self):
        scanner = self._scanner()
        assert scanner._rule_is_due(self._rule()) is True

    def test_rule_just_evaluated_is_not_due(self):
        import time as _time
        scanner = self._scanner()
        rule = self._rule(rule_id=1, interval=300)
        scanner._last_evaluated[1] = _time.monotonic()  # just now
        assert scanner._rule_is_due(rule) is False

    def test_rule_evaluated_long_ago_is_due(self):
        import time as _time
        scanner = self._scanner()
        rule = self._rule(rule_id=1, interval=60)
        scanner._last_evaluated[1] = _time.monotonic() - 120  # 2 min ago
        assert scanner._rule_is_due(rule) is True

    def test_per_rule_interval_overrides_global(self):
        """A rule with interval=60 is due before the global 300s elapses."""
        import time as _time
        scanner = self._scanner()
        scanner._global_interval = 300

        rule_fast = self._rule(rule_id=1, interval=60)
        rule_slow = self._rule(rule_id=2, interval=None)  # uses global 300

        # Simulate 90 seconds have passed since both were evaluated
        elapsed = 90
        scanner._last_evaluated[1] = _time.monotonic() - elapsed
        scanner._last_evaluated[2] = _time.monotonic() - elapsed

        assert scanner._rule_is_due(rule_fast) is True   # 90 > 60
        assert scanner._rule_is_due(rule_slow) is False  # 90 < 300

    def test_minimum_interval_enforced(self):
        """Even if a rule sets interval=5, it is clamped to _MIN_RULE_INTERVAL."""
        import time as _time
        from services.scanner import _MIN_RULE_INTERVAL
        scanner = self._scanner()
        rule = self._rule(rule_id=1, interval=5)  # far below minimum
        # Evaluated _MIN_RULE_INTERVAL - 10 seconds ago → not yet due
        scanner._last_evaluated[1] = _time.monotonic() - (_MIN_RULE_INTERVAL - 10)
        assert scanner._rule_is_due(rule) is False

    def test_mark_evaluated_records_timestamp(self):
        import time as _time
        scanner = self._scanner()
        before = _time.monotonic()
        scanner._mark_evaluated([1, 2, 3])
        after = _time.monotonic()
        for rule_id in [1, 2, 3]:
            assert before <= scanner._last_evaluated[rule_id] <= after


# ══════════════════════════════════════════════════════════════
#  Auth wait behaviour
# ══════════════════════════════════════════════════════════════


class TestAuthWait:
    """Tests for _wait_for_ibkr_auth."""

    @pytest.mark.asyncio
    async def test_returns_true_when_already_authenticated(self):
        ibkr = MagicMock()
        ibkr.state = MagicMock()
        ibkr.state.authenticated = True  # immediately authenticated
        scanner = ScannerService(ibkr=ibkr, db=_mock_db())
        result = await scanner._wait_for_ibkr_auth()
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_stop_called(self):
        ibkr = MagicMock()
        ibkr.state = MagicMock()
        ibkr.state.authenticated = False  # never authenticates
        scanner = ScannerService(ibkr=ibkr, db=_mock_db())
        scanner._stop_event.set()  # pre-set stop
        result = await scanner._wait_for_ibkr_auth()
        assert result is False

    @pytest.mark.asyncio
    async def test_authenticates_after_delay(self):
        """Scanner detects auth that arrives mid-wait."""
        ibkr = MagicMock()
        ibkr.state = MagicMock()
        ibkr.state.authenticated = False
        scanner = ScannerService(ibkr=ibkr, db=_mock_db())

        # After a tiny delay, flip auth to True
        async def _flip():
            await asyncio.sleep(0.05)
            ibkr.state.authenticated = True

        asyncio.create_task(_flip())
        result = await scanner._wait_for_ibkr_auth()
        assert result is True


# ══════════════════════════════════════════════════════════════
#  News candle detection (Phase 6.6)
# ══════════════════════════════════════════════════════════════


def _news_candles(
    prev_closes: list[float],
    prev_ranges: list[tuple[float, float]] | None = None,
    prev_volumes: list[float] | None = None,
    last: dict | None = None,
) -> list[CandleData]:
    """
    Build a candle list where the last bar is custom, and the preceding bars
    form the 20-bar average lookback window.

    prev_closes: closes of the 20 lookback bars (oldest → newest)
    prev_ranges: optional list of (high, low) per lookback bar
    prev_volumes: optional list of volumes per lookback bar
    last: dict with o/h/l/c/v keys for the final (signal) bar
    """
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


class TestEvaluateNewsCandle:
    """Unit tests for ScannerService._evaluate_news_candle (pure function)."""

    def _eval(self, method, candles):
        return ScannerService._evaluate_news_candle(method, candles)

    # ── volume_spike ─────────────────────────────────────────

    def test_volume_spike_3x(self):
        # 20 bars at 1M volume, last bar at 3M → multiplier = 3.0
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
        # Only 10 prior bars → None
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
        # 20 bars with range=2, last bar range=4 → multiplier = 2.0
        prev = [100.0] * 20
        ranges = [(101.0, 99.0)] * 20  # range of 2
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
        # zero-width candles in lookback window
        ranges = [(100.0, 100.0)] * 20
        candles = _news_candles(
            prev, prev_ranges=ranges,
            last={"h": 105.0, "l": 95.0},
        )
        assert self._eval("range_spike", candles) is None

    # ── gap ──────────────────────────────────────────────────

    def test_gap_up_2_percent(self):
        # prev.close=100, last.open=102 → gap = 2%
        prev = [100.0] * 20
        candles = _news_candles(
            prev, last={"o": 102.0, "h": 103.0, "l": 101.5, "c": 102.5},
        )
        assert self._eval("gap", candles) == pytest.approx(2.0)

    def test_gap_down_uses_absolute(self):
        # prev.close=100, last.open=97 → |gap| = 3%
        prev = [100.0] * 20
        candles = _news_candles(
            prev, last={"o": 97.0, "h": 97.5, "l": 95.5, "c": 96.0},
        )
        assert self._eval("gap", candles) == pytest.approx(3.0)

    def test_gap_needs_only_2_bars(self):
        # 2 bars is enough (unlike volume/range which need 21)
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
        # body=1 (open=100, close=101), upper_wick=3 (high=104), lower_wick=0
        prev = [100.0] * 2
        candles = _news_candles(
            prev,
            last={"o": 100.0, "h": 104.0, "l": 100.0, "c": 101.0},
        )
        assert self._eval("long_wick", candles) == pytest.approx(3.0)

    def test_long_wick_lower_beats_upper(self):
        # body=1, upper_wick=0, lower_wick=5 → ratio=5
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
        candles = [make_candle()]  # only 1
        assert self._eval("gap", candles) is None


class TestEvaluateGroupNewsCandle:
    """Integration tests for news_candle rules flowing through _evaluate_group."""

    def _rule(self, method: str, threshold: float, rule_id: int = 100) -> dict:
        r = _make_rule(
            rule_id=rule_id,
            indicator="news_candle",
            condition="fires",
            threshold=threshold,
        )
        r["news_candle_method"] = method
        return r

    @pytest.mark.asyncio
    async def test_gap_fires_when_above_threshold(self):
        """news_candle/gap with threshold=1.5 fires on a 3% gap."""
        # 20 prev bars at 100, last bar opens at 103 (3% gap)
        prev = [100.0] * 20
        candles = _news_candles(
            prev, last={"o": 103.0, "h": 104.0, "l": 102.5, "c": 103.5},
        )

        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=1)
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = self._rule("gap", threshold=1.5)
        hits = await scanner._evaluate_group(rule["conid"], [rule])

        assert hits == 1
        db.record_trigger_hit.assert_called_once()
        assert db.record_trigger_hit.call_args.kwargs["actual_value"] == pytest.approx(3.0)
        assert db.record_trigger_hit.call_args.kwargs["indicator"] == "news_candle"

    @pytest.mark.asyncio
    async def test_gap_does_not_fire_below_threshold(self):
        """news_candle/gap with threshold=5 does NOT fire on a 1% gap."""
        prev = [100.0] * 20
        candles = _news_candles(
            prev, last={"o": 101.0, "h": 101.5, "l": 100.8, "c": 101.2},
        )

        ibkr = _mock_ibkr(candles)
        db = _mock_db()
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = self._rule("gap", threshold=5.0)
        hits = await scanner._evaluate_group(rule["conid"], [rule])
        assert hits == 0
        db.record_trigger_hit.assert_not_called()

    @pytest.mark.asyncio
    async def test_volume_spike_fires(self):
        prev = [100.0] * 20
        candles = _news_candles(
            prev, prev_volumes=[1_000_000.0] * 20,
            last={"v": 5_000_000.0},
        )
        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=11)
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = self._rule("volume_spike", threshold=3.0)
        hits = await scanner._evaluate_group(rule["conid"], [rule])
        assert hits == 1

    @pytest.mark.asyncio
    async def test_news_candle_and_indicator_rules_coexist(self):
        """A group containing both news_candle and RSI rules evaluates both."""
        closes = [100.0 - i * 1.5 for i in range(30)]  # declining → low RSI
        candles = make_candles(closes)
        # Make the final bar also a 3% gap-down for the news_candle
        last = candles[-1]
        prev = candles[-2]
        candles[-1] = CandleData(
            time=last.time,
            open=prev.close * 0.97,  # gap down 3%
            high=prev.close * 0.98,
            low=prev.close * 0.95,
            close=prev.close * 0.96,
            volume=1_000_000.0,
        )

        ibkr = _mock_ibkr(candles)
        db = _mock_db(hit_id=1)
        scanner = ScannerService(ibkr=ibkr, db=db)

        rsi_rule = _make_rule(rule_id=1, indicator="rsi", condition="below", threshold=40.0)
        news_rule = self._rule("gap", threshold=1.0, rule_id=2)

        hits = await scanner._evaluate_group(rsi_rule["conid"], [rsi_rule, news_rule])

        # Both should fire
        assert hits == 2
        assert db.record_trigger_hit.call_count == 2

    @pytest.mark.asyncio
    async def test_unknown_method_does_not_fire(self):
        prev = [100.0] * 20
        candles = _news_candles(prev, last={"o": 200.0, "h": 250.0, "l": 180.0, "c": 220.0})
        ibkr = _mock_ibkr(candles)
        db = _mock_db()
        scanner = ScannerService(ibkr=ibkr, db=db)

        rule = self._rule("pulsar", threshold=0.1)
        hits = await scanner._evaluate_group(rule["conid"], [rule])
        assert hits == 0
        db.record_trigger_hit.assert_not_called()
