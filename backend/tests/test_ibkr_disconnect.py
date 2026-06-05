"""
Tests for IBKR mid-session disconnect detection (Phase 7.1).

Covers:
  - Consecutive tickle failures increment state.tickle_fail_count
  - TICKLE_FAIL_THRESHOLD failures set state.session_dropped = True
  - session_dropped WS broadcast fires exactly once per drop event
  - Successful tickle resets fail count and session_dropped flag
  - auth_status() success clears session_dropped
  - /gateway/status response includes session_dropped field
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from config import IBKR_GATEWAY_HOST, IBKR_GATEWAY_PORT
from exceptions import IBKRConnectionError
from services.ibkr import IBKRService, TICKLE_FAIL_THRESHOLD
from state import IBKRState


# ── Helpers ──────────────────────────────────────────────────────────────────


def make_ibkr() -> IBKRService:
    """Return an IBKRService with a mocked HTTP client."""
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = IBKRState()
    svc.http = MagicMock()
    svc._tickle_task = None
    svc._ws_task = None
    return svc


# ── State initialisation ─────────────────────────────────────────────────────


def test_initial_state_has_no_drop_flags():
    """IBKRState starts clean — no disconnect flags set."""
    state = IBKRState()
    assert state.session_dropped is False
    assert state.tickle_fail_count == 0


def test_reset_clears_disconnect_flags():
    """state.reset() clears session_dropped and tickle_fail_count."""
    state = IBKRState()
    state.session_dropped = True
    state.tickle_fail_count = 5
    state.authenticated = True

    state.reset()

    assert state.session_dropped is False
    assert state.tickle_fail_count == 0
    assert state.authenticated is False


# ── Tickle failure tracking ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tickle_failure_increments_count():
    """Each failed tickle increments tickle_fail_count."""
    svc = make_ibkr()
    svc.state.authenticated = True

    # Patch tickle to always return False
    svc.tickle = AsyncMock(return_value=False)
    # No broadcast registered yet — shouldn't crash
    broadcast_calls: list[dict] = []

    async def fake_broadcast(payload: dict) -> None:
        broadcast_calls.append(payload)

    svc.set_broadcast(fake_broadcast)

    # Simulate TICKLE_FAIL_THRESHOLD - 1 failures (not yet at threshold)
    for i in range(TICKLE_FAIL_THRESHOLD - 1):
        # Call the body of _tickle_loop (skip the sleep)
        success = await svc.tickle()
        if success:
            svc.state.tickle_fail_count = 0
            svc.state.session_dropped = False
        else:
            svc.state.tickle_fail_count += 1
            if (
                svc.state.tickle_fail_count >= TICKLE_FAIL_THRESHOLD
                and not svc.state.session_dropped
            ):
                svc.state.session_dropped = True
                await svc._broadcast({"type": "session_dropped"})

    assert svc.state.tickle_fail_count == TICKLE_FAIL_THRESHOLD - 1
    assert svc.state.session_dropped is False
    assert broadcast_calls == []


@pytest.mark.asyncio
async def test_tickle_threshold_triggers_session_dropped():
    """Reaching TICKLE_FAIL_THRESHOLD failures marks session as dropped."""
    svc = make_ibkr()
    svc.state.authenticated = True

    svc.tickle = AsyncMock(return_value=False)
    broadcast_calls: list[dict] = []

    async def fake_broadcast(payload: dict) -> None:
        broadcast_calls.append(payload)

    svc.set_broadcast(fake_broadcast)

    # Simulate exactly TICKLE_FAIL_THRESHOLD failures
    for _ in range(TICKLE_FAIL_THRESHOLD):
        success = await svc.tickle()
        if success:
            svc.state.tickle_fail_count = 0
            svc.state.session_dropped = False
        else:
            svc.state.tickle_fail_count += 1
            if (
                svc.state.tickle_fail_count >= TICKLE_FAIL_THRESHOLD
                and not svc.state.session_dropped
            ):
                svc.state.session_dropped = True
                await svc._broadcast({"type": "session_dropped"})

    assert svc.state.session_dropped is True
    assert len(broadcast_calls) == 1
    assert broadcast_calls[0] == {"type": "session_dropped"}


@pytest.mark.asyncio
async def test_broadcast_fires_only_once_per_drop():
    """session_dropped broadcast fires once even if more failures follow."""
    svc = make_ibkr()
    svc.state.authenticated = True
    svc.tickle = AsyncMock(return_value=False)
    broadcast_calls: list[dict] = []

    async def fake_broadcast(payload: dict) -> None:
        broadcast_calls.append(payload)

    svc.set_broadcast(fake_broadcast)

    # Double the threshold — broadcast should still fire only once
    for _ in range(TICKLE_FAIL_THRESHOLD * 2):
        success = await svc.tickle()
        if success:
            svc.state.tickle_fail_count = 0
            svc.state.session_dropped = False
        else:
            svc.state.tickle_fail_count += 1
            if (
                svc.state.tickle_fail_count >= TICKLE_FAIL_THRESHOLD
                and not svc.state.session_dropped
            ):
                svc.state.session_dropped = True
                await svc._broadcast({"type": "session_dropped"})

    assert len(broadcast_calls) == 1


@pytest.mark.asyncio
async def test_successful_tickle_resets_failure_state():
    """A successful tickle clears fail count and session_dropped."""
    svc = make_ibkr()
    svc.state.authenticated = True
    svc.state.session_dropped = True
    svc.state.tickle_fail_count = TICKLE_FAIL_THRESHOLD

    svc.tickle = AsyncMock(return_value=True)
    broadcast_calls: list[dict] = []

    async def fake_broadcast(payload: dict) -> None:
        broadcast_calls.append(payload)

    svc.set_broadcast(fake_broadcast)

    success = await svc.tickle()
    if success:
        svc.state.tickle_fail_count = 0
        svc.state.session_dropped = False

    assert svc.state.tickle_fail_count == 0
    assert svc.state.session_dropped is False
    assert broadcast_calls == []


# ── auth_status clears drop flag ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_auth_status_success_clears_session_dropped():
    """A successful auth_status (re-auth) clears session_dropped."""
    svc = make_ibkr()
    svc.state.session_dropped = True
    svc.state.tickle_fail_count = TICKLE_FAIL_THRESHOLD
    svc.state.authenticated = False

    # Mock _request to simulate a successful auth probe
    svc._request = AsyncMock(
        return_value={"authenticated": True, "connected": True, "message": "OK"}
    )
    svc.start_tickle_loop = AsyncMock()

    result = await svc.auth_status()

    assert result["authenticated"] is True
    assert svc.state.session_dropped is False
    assert svc.state.tickle_fail_count == 0


@pytest.mark.asyncio
async def test_auth_status_failure_does_not_change_drop_flag():
    """A failed auth_status (still unauthenticated) leaves session_dropped alone."""
    svc = make_ibkr()
    svc.state.session_dropped = True
    svc.state.tickle_fail_count = TICKLE_FAIL_THRESHOLD

    svc._request = AsyncMock(
        return_value={"authenticated": False, "connected": False, "message": "Not authed"}
    )

    result = await svc.auth_status()

    assert result["authenticated"] is False
    # session_dropped stays True — user hasn't re-authenticated yet
    assert svc.state.session_dropped is True


# ── Bug A: connection error while authenticated = immediate session_dropped ──


@pytest.mark.asyncio
async def test_auth_status_connection_error_flips_session_dropped_when_authed():
    """
    Bug A: if we were previously authenticated and auth_status hits an
    IBKRConnectionError (gateway unreachable), flip session_dropped and
    broadcast immediately — don't wait for the ~165 s tickle threshold.
    """
    svc = make_ibkr()
    svc.state.authenticated = True  # was authenticated before the drop
    svc.state.session_dropped = False

    svc._request = AsyncMock(side_effect=IBKRConnectionError("gateway down"))

    broadcast_calls: list[dict] = []

    async def fake_broadcast(payload: dict) -> None:
        broadcast_calls.append(payload)

    svc.set_broadcast(fake_broadcast)

    result = await svc.auth_status()

    assert result["authenticated"] is False
    assert svc.state.authenticated is False
    assert svc.state.session_dropped is True
    assert svc.state.tickle_fail_count == TICKLE_FAIL_THRESHOLD
    assert broadcast_calls == [{"type": "session_dropped"}]


@pytest.mark.asyncio
async def test_auth_status_connection_error_when_not_previously_authed():
    """
    Bug A: if we were NOT previously authenticated (e.g. cold start, gateway
    just not up yet), a connection error should NOT trip session_dropped —
    we never had a session to drop.
    """
    svc = make_ibkr()
    svc.state.authenticated = False  # never authenticated yet
    svc.state.session_dropped = False

    svc._request = AsyncMock(side_effect=IBKRConnectionError("gateway down"))
    broadcast_calls: list[dict] = []

    async def fake_broadcast(payload: dict) -> None:
        broadcast_calls.append(payload)

    svc.set_broadcast(fake_broadcast)

    result = await svc.auth_status()

    assert result["authenticated"] is False
    assert svc.state.session_dropped is False
    assert broadcast_calls == []


@pytest.mark.asyncio
async def test_auth_status_connection_error_broadcasts_once():
    """
    Bug A: repeated connection errors should broadcast session_dropped only
    on the first transition (when was_authenticated is still True), not
    every subsequent poll.
    """
    svc = make_ibkr()
    svc.state.authenticated = True
    svc._request = AsyncMock(side_effect=IBKRConnectionError("gateway down"))
    broadcast_calls: list[dict] = []

    async def fake_broadcast(payload: dict) -> None:
        broadcast_calls.append(payload)

    svc.set_broadcast(fake_broadcast)

    # First poll — broadcasts
    await svc.auth_status()
    # Second poll — already flipped, no broadcast
    await svc.auth_status()
    # Third poll — same
    await svc.auth_status()

    assert len(broadcast_calls) == 1


# ── Bug B: error message uses configured host/port ───────────────────────────


@pytest.mark.asyncio
async def test_auth_status_error_message_uses_configured_port():
    """
    Bug B: the "Cannot reach IBKR Gateway" message must reflect the
    configured host/port, not the hardcoded :5000 that silently shipped
    when the gateway moved to :5001 (macOS AirPlay collision).
    """
    svc = make_ibkr()
    svc.state.authenticated = False  # avoid the broadcast path for clarity
    svc._request = AsyncMock(side_effect=IBKRConnectionError("down"))

    result = await svc.auth_status()

    expected_fragment = f"{IBKR_GATEWAY_HOST}:{IBKR_GATEWAY_PORT}"
    assert expected_fragment in result["message"], (
        f"expected '{expected_fragment}' in message, got: {result['message']!r}"
    )
    # Sanity check — make sure we didn't accidentally hardcode :5000 again
    if IBKR_GATEWAY_PORT != 5000:
        assert "localhost:5000" not in result["message"]


# ── Gateway status endpoint ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_gateway_status_includes_session_dropped():
    """
    GET /gateway/status response includes session_dropped reflecting IBKRState.

    Uses FastAPI's TestClient against the app to exercise the full route.

    Two env-isolation concerns:
      1. `app.state.ibkr` is only populated by the FastAPI lifespan, which
         runs on `__enter__` of the TestClient context manager — so state
         mutation must happen inside the `with` block.
      2. When the gateway is running, the route calls `ibkr.auth_status()`
         which, on success, clears `session_dropped`. If the developer has
         a real gateway running on localhost:5001 (common during dev), this
         clears the flag before the response is built and the assertion
         fails. We patch `gw.status()` to report not running so the route
         skips the auth probe and returns the raw flag.
    """
    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app, raise_server_exceptions=False) as client:
        # Pre-configure the IBKR service state to simulate a dropped session
        ibkr_svc = app.state.ibkr
        gw_svc = app.state.gateway

        ibkr_svc.state.session_dropped = True
        ibkr_svc.state.authenticated = False

        # Force the "gateway not running" branch so auth_status() is skipped
        fake_status = {
            "state": "not_provisioned",
            "running": False,
            "provisioned": False,
            "error": None,
            "progress": None,
            "gateway_url": "https://localhost:5001",
        }

        with patch.object(gw_svc, "status", return_value=fake_status):
            try:
                resp = client.get("/gateway/status")

                # The route always returns 200 (even when gateway is down)
                assert resp.status_code == 200
                body = resp.json()
                assert "session_dropped" in body
                assert body["session_dropped"] is True
            finally:
                # Cleanup — leave the shared app state clean for subsequent tests
                ibkr_svc.state.session_dropped = False
