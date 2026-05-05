"""
Tests for POST /indicators/compute — timeframe → (period, bar) routing.

Covers:
  - All 8 timeframes are routed to the correct IBKR (period, bar) pair
    as defined in TIMEFRAME_SPEC.
  - IBKRBarLimitExceededError is raised when IBKR returns > IBKR_BAR_LIMIT bars.
  - Response includes the echoed timeframe field.
  - Empty bar response returns empty candles without error.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from constants.ibkr_history import TIMEFRAME_SPEC, IBKR_BAR_LIMIT, VALID_TIMEFRAMES
from exceptions import IBKRBarLimitExceededError


# ── Helpers ───────────────────────────────────────────────────

def _make_bar(t: int = 1700000000000) -> dict:
    """Build a minimal IBKR bar dict (timestamps in milliseconds)."""
    return {"t": t, "o": 100.0, "h": 110.0, "l": 90.0, "c": 105.0, "v": 1000}


def _make_ibkr(bars: list[dict]) -> MagicMock:
    """Stub IBKRService whose history() returns the given bars."""
    ibkr = MagicMock()
    ibkr.history = AsyncMock(return_value={"data": bars})
    return ibkr


def _make_indicator_service(results=None, fibonacci=None) -> MagicMock:
    """Stub IndicatorService.compute()."""
    svc = MagicMock()
    svc.compute = MagicMock(return_value=(results or [], fibonacci))
    return svc


# ── Tests: TIMEFRAME_SPEC routing ─────────────────────────────

class TestTimeframeRouting:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("timeframe", list(VALID_TIMEFRAMES))
    async def test_each_timeframe_passes_correct_period_and_bar(self, timeframe):
        """Router must look up TIMEFRAME_SPEC and pass (period, bar) to ibkr.history."""
        spec = TIMEFRAME_SPEC[timeframe]
        ibkr = _make_ibkr([_make_bar()])

        with patch(
            "routers.indicators._indicator_service", _make_indicator_service()
        ):
            from routers.indicators import compute_indicators
            from models import IndicatorRequest

            req = IndicatorRequest(conid=265598, timeframe=timeframe, indicators=[])
            await compute_indicators(request=req, ibkr=ibkr)

        ibkr.history.assert_awaited_once_with(
            265598, period=spec.period, bar=spec.bar
        )

    @pytest.mark.asyncio
    async def test_response_echoes_timeframe(self):
        """IndicatorComputeResponse must include the requested timeframe."""
        ibkr = _make_ibkr([_make_bar()])

        with patch(
            "routers.indicators._indicator_service", _make_indicator_service()
        ):
            from routers.indicators import compute_indicators
            from models import IndicatorRequest

            req = IndicatorRequest(conid=265598, timeframe="1D", indicators=[])
            resp = await compute_indicators(request=req, ibkr=ibkr)

        assert resp.timeframe == "1D"

    @pytest.mark.asyncio
    async def test_empty_bars_returns_empty_candles(self):
        """No bars from IBKR → return empty candles, no crash."""
        ibkr = _make_ibkr([])

        with patch(
            "routers.indicators._indicator_service", _make_indicator_service()
        ):
            from routers.indicators import compute_indicators
            from models import IndicatorRequest

            req = IndicatorRequest(conid=265598, timeframe="1D", indicators=[])
            resp = await compute_indicators(request=req, ibkr=ibkr)

        assert resp.candles == []
        assert resp.indicators == []


# ── Tests: IBKRBarLimitExceededError ──────────────────────────

class TestBarLimitGuard:
    @pytest.mark.asyncio
    async def test_raises_when_bars_exceed_ibkr_hard_cap(self):
        """Router must raise IBKRBarLimitExceededError when len(bars) > IBKR_BAR_LIMIT."""
        over_limit = [_make_bar(t=1700000000000 + i * 60000) for i in range(IBKR_BAR_LIMIT + 1)]
        ibkr = _make_ibkr(over_limit)

        from routers.indicators import compute_indicators
        from models import IndicatorRequest

        req = IndicatorRequest(conid=265598, timeframe="1m", indicators=[])
        with pytest.raises(IBKRBarLimitExceededError) as exc_info:
            await compute_indicators(request=req, ibkr=ibkr)

        assert exc_info.value.timeframe == "1m"
        assert exc_info.value.received == IBKR_BAR_LIMIT + 1
        assert exc_info.value.limit == IBKR_BAR_LIMIT

    @pytest.mark.asyncio
    async def test_does_not_raise_at_exactly_ibkr_bar_limit(self):
        """Exactly IBKR_BAR_LIMIT bars is fine (the cap is exclusive)."""
        at_limit = [_make_bar(t=1700000000000 + i * 60000) for i in range(IBKR_BAR_LIMIT)]
        ibkr = _make_ibkr(at_limit)

        with patch(
            "routers.indicators._indicator_service", _make_indicator_service()
        ):
            from routers.indicators import compute_indicators
            from models import IndicatorRequest

            req = IndicatorRequest(conid=265598, timeframe="1m", indicators=[])
            # Should not raise
            resp = await compute_indicators(request=req, ibkr=ibkr)

        assert len(resp.candles) == IBKR_BAR_LIMIT


# ── Tests: IBKRBarLimitExceededError shape ────────────────────

class TestIBKRBarLimitExceededError:
    def test_error_attributes(self):
        err = IBKRBarLimitExceededError(timeframe="1m", received=1100, limit=1000)
        assert err.timeframe == "1m"
        assert err.received == 1100
        assert err.limit == 1000
        assert "1m" in str(err)
        assert "1100" in str(err)

    def test_is_ibkr_error_subclass(self):
        from exceptions import IBKRError
        err = IBKRBarLimitExceededError(timeframe="1D", received=1001, limit=1000)
        assert isinstance(err, IBKRError)
