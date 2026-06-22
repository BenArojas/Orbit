from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from constants.ibkr_history import IBKR_BAR_LIMIT
from exceptions import IBKRBarLimitExceededError


def _make_bar(t: int = 1700000000000) -> dict:
    return {"t": t, "o": 100.0, "h": 110.0, "l": 90.0, "c": 105.0, "v": 1000}


def _make_ibkr(bars: list[dict]) -> MagicMock:
    ibkr = MagicMock()
    ibkr.history = AsyncMock(return_value={"data": bars})
    return ibkr


def _make_indicator_service(results=None, fibonacci=None) -> MagicMock:
    svc = MagicMock()
    svc.compute = MagicMock(return_value=(results or [], fibonacci))
    return svc


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


