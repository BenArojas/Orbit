"""
Tests for bundled `/market/candles` endpoint (Phase 8 / Task 2.2).

`IBKRService.history_bundled()` fans out history() calls for many conids
concurrently, bounded by a 5-slot semaphore to honor IBKR's documented
5-concurrent cap on /iserver/marketdata/history.

Three behaviors under test:
  1. 13 conids → 13 IBKR history calls, at most 5 concurrent.
  2. 429 with `Retry-After: 2` → caller waits ≥2s before retry (clock mocked).
  3. One conid failure does not cancel others; result has `errors` field.
"""

import asyncio
from unittest.mock import MagicMock

import pytest

from exceptions import IBKRRateLimitError, IBKRRequestError
from services.ibkr import IBKRService
from state import IBKRState


# ── Helpers ──────────────────────────────────────────────────────────


def _make_svc():
    """Build an IBKRService with `history` mocked (not `_request`).

    Mocking `history()` directly lets us:
      - Return shaped data without caring about IBKR wire format.
      - Inject 429 / other errors per conid.
      - Track concurrency via a counter updated inside the mock.

    Returns (svc, history_calls, set_error) where:
      - history_calls: list of conid ints that history() was called for.
      - set_error: dict[conid -> Exception] — set before calling
        history_bundled to inject a per-conid error.
    """
    svc = IBKRService.__new__(IBKRService)
    svc.state = IBKRState()
    svc.http = MagicMock()
    svc._tickle_task = None
    svc._ws_task = None
    svc._ensure_coalescing_dicts()

    history_calls: list[int] = []
    per_conid_errors: dict[int, Exception] = {}

    async def fake_history(conid: int, period: str = "1m", bar: str = "30min") -> dict:
        history_calls.append(conid)
        # Small yield to let concurrent callers actually overlap in the
        # event loop — mirrors real async I/O behaviour.
        await asyncio.sleep(0.005)
        if conid in per_conid_errors:
            raise per_conid_errors[conid]
        return {
            "data": [
                {"t": 1_000_000, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 100}
            ]
        }

    svc.history = fake_history  # type: ignore[method-assign]
    return svc, history_calls, per_conid_errors


# ── Tests ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_thirteen_conids_at_most_five_concurrent():
    """13 conids → 13 IBKR history calls, never more than 5 in flight.

    We verify the concurrency cap by tracking how many calls are
    simultaneously inside `fake_history` via an asyncio.Event gate: each
    call increments a counter, yields, then decrements. The peak is
    recorded and asserted to be ≤ 5.
    """
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
        # Yield so other coroutines get a chance to run and accumulate
        # inside this counter, giving us a real concurrency reading.
        await asyncio.sleep(0.01)
        in_flight -= 1
        return {
            "data": [
                {"t": 1_000_000, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 100}
            ]
        }

    svc.history = fake_history  # type: ignore[method-assign]

    conids = list(range(1001, 1014))  # 13 conids
    result = await svc.history_bundled(conids, period="5d", bar="5min")

    assert call_count == 13, (
        f"expected exactly 13 history() calls; got {call_count}"
    )
    assert peak_concurrency <= 5, (
        f"peak concurrency was {peak_concurrency}; semaphore should cap at 5"
    )
    assert len(result["items"]) == 13
    assert result["errors"] == {}

    # Verify candle shape — each item has conid + TradingView-format bars.
    for item in result["items"]:
        assert "conid" in item
        assert "candles" in item
        assert len(item["candles"]) == 1
        bar = item["candles"][0]
        assert bar["time"] == 1_000  # ms → seconds
        assert bar["open"] == 1.0
        assert bar["close"] == 1.5


@pytest.mark.asyncio
async def test_rate_limit_retries_honor_retry_after(monkeypatch):
    """429 with Retry-After: 2 → caller waits ≥2s before retry.

    Clock is monkeypatched via asyncio.sleep so the test stays fast.
    We assert that asyncio.sleep was called with the Retry-After value
    on the first 429, and that the call eventually succeeds on retry.
    """
    svc, history_calls, per_conid_errors = _make_svc()

    attempt_counts: dict[int, int] = {}
    sleep_calls: list[float] = []

    # Patch asyncio.sleep inside the services.ibkr module so we can
    # intercept the wait without actually sleeping.
    import services.ibkr as ibkr_mod

    async def fake_sleep(secs: float):
        sleep_calls.append(secs)

    monkeypatch.setattr(ibkr_mod.asyncio, "sleep", fake_sleep)

    target_conid = 2001

    async def fake_history_with_429(
        conid: int, period: str = "1m", bar: str = "30min"
    ) -> dict:
        attempt_counts[conid] = attempt_counts.get(conid, 0) + 1
        if conid == target_conid and attempt_counts[conid] == 1:
            # First attempt for this conid: raise 429 with Retry-After: 2.
            raise IBKRRateLimitError(endpoint="/iserver/marketdata/history", retry_after=2)
        return {
            "data": [
                {"t": 1_000_000, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0}
            ]
        }

    svc.history = fake_history_with_429  # type: ignore[method-assign]

    result = await svc.history_bundled([target_conid], period="5d", bar="5min")

    # The 429 wait (2s) should have been passed to asyncio.sleep.
    assert any(s == 2 for s in sleep_calls), (
        f"expected asyncio.sleep(2) for Retry-After: 2; sleep_calls={sleep_calls}"
    )
    # history() was called twice for the target conid (1st → 429, 2nd → success).
    assert attempt_counts[target_conid] == 2, (
        f"expected 2 attempts (1 fail + 1 retry); got {attempt_counts[target_conid]}"
    )
    # Eventual success — conid ends up in items, not errors.
    assert len(result["items"]) == 1
    assert result["items"][0]["conid"] == target_conid
    assert result["errors"] == {}


@pytest.mark.asyncio
async def test_one_conid_failure_does_not_cancel_others():
    """A single conid error is isolated; the rest succeed.

    Result has a non-empty `errors` dict for the failing conid and
    full candles in `items` for all others.
    """
    svc, history_calls, per_conid_errors = _make_svc()

    failing_conid = 3002
    per_conid_errors[failing_conid] = IBKRRequestError(
        status_code=503, detail="service unavailable"
    )

    conids = list(range(3001, 3006))  # 5 conids; 3002 will fail
    result = await svc.history_bundled(conids, period="1m", bar="30min")

    # 4 successes, 1 error.
    assert len(result["items"]) == 4, (
        f"expected 4 items (excluding the failing conid); got {len(result['items'])}"
    )
    assert len(result["errors"]) == 1, (
        f"expected 1 error entry; got {result['errors']}"
    )
    assert failing_conid in result["errors"], (
        f"failing conid {failing_conid} not in errors: {result['errors']}"
    )

    # The successful conids are all present.
    successful_conids = {item["conid"] for item in result["items"]}
    expected_successful = set(conids) - {failing_conid}
    assert successful_conids == expected_successful, (
        f"expected successful conids {expected_successful}; got {successful_conids}"
    )

    # Every history() was still attempted (failure didn't short-circuit gather).
    assert set(history_calls) == set(conids), (
        f"expected all conids attempted; history_calls={set(history_calls)}"
    )
