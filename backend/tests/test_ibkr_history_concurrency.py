"""
Tests for the IBKR /iserver/marketdata/history concurrency limit and
the bumped 4-attempt retry policy.
"""

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch

sys.modules.setdefault("pandas_ta", MagicMock())
sys.modules.setdefault("pandas", MagicMock())

import pytest

from services.ibkr import (
    IBKRService,
    IBKR_HISTORY_MAX_CONCURRENT,
    IBKR_RETRY_MAX_ATTEMPTS,
    IBKR_RETRY_BACKOFF_SECONDS,
)


def test_concurrency_limit_constant():
    assert IBKR_HISTORY_MAX_CONCURRENT == 4


def test_retry_attempts_constant():
    assert IBKR_RETRY_MAX_ATTEMPTS == 4


def test_retry_backoff_schedule():
    assert IBKR_RETRY_BACKOFF_SECONDS == (0.5, 1.0, 2.0, 4.0)


@pytest.mark.asyncio
async def test_history_semaphore_caps_at_four():
    """Firing 8 concurrent history calls must never exceed 4 in-flight.

    Uses the same concurrency-tracking pattern as test_bundled_candles.py:
    each fake_history increments in_flight on entry, yields control (so
    concurrent coroutines can actually run in parallel in the event loop),
    then decrements on exit. Peak is asserted ≤ IBKR_HISTORY_MAX_CONCURRENT.
    """
    from state import IBKRState

    svc = IBKRService.__new__(IBKRService)
    svc.state = IBKRState()
    svc.http = MagicMock()
    svc._tickle_task = None
    svc._ws_task = None
    svc._ensure_coalescing_dicts()

    in_flight = 0
    peak_concurrency = 0
    call_count = 0

    async def fake_history(conid: int, period: str = "1m", bar: str = "30min") -> dict:
        nonlocal in_flight, peak_concurrency, call_count
        in_flight += 1
        if in_flight > peak_concurrency:
            peak_concurrency = in_flight
        call_count += 1
        await asyncio.sleep(0.01)
        in_flight -= 1
        return {
            "data": [
                {"t": 1_000_000, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 100}
            ]
        }

    svc.history = fake_history  # type: ignore[method-assign]

    conids = list(range(2001, 2009))  # 8 conids
    result = await svc.history_bundled(conids, period="5d", bar="5min")

    assert call_count == 8, f"expected 8 history() calls; got {call_count}"
    assert peak_concurrency <= IBKR_HISTORY_MAX_CONCURRENT, (
        f"peak concurrency was {peak_concurrency}; semaphore should cap at "
        f"{IBKR_HISTORY_MAX_CONCURRENT}"
    )
    assert len(result["items"]) == 8
    assert result["errors"] == {}
