"""
Test that the _request() retry policy follows the 4-attempt schedule.

A sequence of three 503 responses followed by a 200 must succeed (not give
up after 3 tries as the old policy did). We mock httpx at the response level
so the test stays fast and does not need a real IBKR Gateway.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from services.ibkr import IBKRService, IBKR_RETRY_MAX_ATTEMPTS, IBKR_RETRY_BACKOFF_SECONDS
from state import IBKRState


def _make_svc() -> IBKRService:
    """Build a minimal IBKRService with a mocked httpx client."""
    svc = IBKRService.__new__(IBKRService)
    svc.state = IBKRState()
    svc._tickle_task = None
    svc._ws_task = None
    svc.base_url = "https://localhost:5000/v1/api"
    svc._ensure_auth_cache_attrs()
    return svc


def _make_response(status_code: int, body: object = None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = body or {}
    resp.text = ""
    resp.headers = {}
    return resp


@pytest.mark.asyncio
async def test_three_503s_then_200_succeeds(monkeypatch):
    """Old policy gave up after 3 total attempts; new policy allows 4.

    With 3 consecutive 503 responses and a 200 on the 4th attempt the call
    must succeed (not raise).
    """
    svc = _make_svc()

    call_count = 0

    async def fake_request(method: str, endpoint: str, **kwargs) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count <= 3:
            return _make_response(503)
        return _make_response(200, {"ok": True})

    mock_http = MagicMock()
    mock_http.request = fake_request
    svc.http = mock_http

    sleep_calls: list[float] = []

    import services.ibkr as ibkr_mod

    async def fake_sleep(secs: float) -> None:
        sleep_calls.append(secs)

    monkeypatch.setattr(ibkr_mod.asyncio, "sleep", fake_sleep)

    result = await svc._request("GET", "/iserver/marketdata/history")

    assert result == {"ok": True}, f"expected success on 4th attempt; got {result}"
    assert call_count == 4, (
        f"expected exactly 4 HTTP calls (3 × 503 + 1 × 200); got {call_count}"
    )

    # The three inter-attempt sleeps should follow the backoff schedule.
    expected_delays = list(IBKR_RETRY_BACKOFF_SECONDS[:3])
    assert sleep_calls == expected_delays, (
        f"expected sleep calls {expected_delays}; got {sleep_calls}"
    )


@pytest.mark.asyncio
async def test_four_503s_raises(monkeypatch):
    """Exhausting all IBKR_RETRY_MAX_ATTEMPTS 503s must propagate an error."""
    from exceptions import IBKRRequestError

    svc = _make_svc()

    async def always_503(method: str, endpoint: str, **kwargs) -> httpx.Response:
        return _make_response(503)

    mock_http = MagicMock()
    mock_http.request = always_503
    svc.http = mock_http

    import services.ibkr as ibkr_mod

    monkeypatch.setattr(ibkr_mod.asyncio, "sleep", AsyncMock())

    with pytest.raises(IBKRRequestError):
        await svc._request("GET", "/iserver/marketdata/history")


@pytest.mark.asyncio
async def test_retry_constants_are_consistent():
    """Sanity-check: backoff tuple has enough entries for max-attempts - 1."""
    # We need at most (IBKR_RETRY_MAX_ATTEMPTS - 1) delay values because the
    # final attempt does not sleep before raising. The tuple may be longer
    # (we clamp via min(attempt, len-1)) but must have at least one entry.
    assert len(IBKR_RETRY_BACKOFF_SECONDS) >= 1
    assert len(IBKR_RETRY_BACKOFF_SECONDS) >= IBKR_RETRY_MAX_ATTEMPTS - 1
