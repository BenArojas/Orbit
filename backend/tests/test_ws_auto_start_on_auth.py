"""
Tests pinning the auth → IBKR-WS auto-start contract.

The bug these tests prevent: the frontend WS endpoint at routers/ws.py
only calls start_ibkr_websocket() once at connection time. If the FE
connects before the IBKR session is authenticated (the typical cold-boot
case: gateway is starting up, auth takes ~30-100s to flip to True), the
backend skips the start call and never retries. Result: FE is connected
but no IBKR WebSocket is ever running, no live ticks, ever.

Fix: tickle() — which is the call that actually populates the session
token — kicks off start_ibkr_websocket() in its success branch. Combined
with start_tickle_loop() doing an immediate tickle on entry, this means
the IBKR WS task is guaranteed to start the moment auth becomes valid,
regardless of when the FE connected.

These tests live separately from test_ws_subscribe_queue.py so the
auth-bootstrap contract is pinned independently of the subscribe queue
contract; either could regress without the other noticing.
"""

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock

sys.modules.setdefault("pandas_ta", MagicMock())
sys.modules.setdefault("pandas", MagicMock())

import pytest

from services.ibkr import IBKRService
from state import IBKRState


def _make_svc() -> IBKRService:
    """Build a minimal IBKRService without any real network/background tasks."""
    svc = IBKRService.__new__(IBKRService)
    svc.state = IBKRState()
    svc._ws_task = None
    svc._tickle_task = None
    return svc


# ── tickle() success → WS auto-start ────────────────────────────────


@pytest.mark.asyncio
async def test_tickle_success_starts_ibkr_websocket():
    """tickle() success path must trigger start_ibkr_websocket().

    Before this fix, tickle() only set state.session_token + authenticated.
    The IBKR WS task was started only by the FE /ws endpoint at connect
    time, which means an FE connect-before-auth would permanently miss it.
    """
    svc = _make_svc()
    svc._request = AsyncMock(return_value={"session": "abc123"})
    svc.start_ibkr_websocket = AsyncMock()

    result = await svc.tickle()

    assert result is True
    assert svc.state.session_token == "abc123"
    assert svc.state.authenticated is True
    svc.start_ibkr_websocket.assert_awaited_once()


@pytest.mark.asyncio
async def test_tickle_failure_does_not_start_ibkr_websocket():
    """tickle() failure path must NOT start the IBKR WS task."""
    from exceptions import IBKRAuthError
    svc = _make_svc()
    svc._request = AsyncMock(side_effect=IBKRAuthError("Not authenticated"))
    svc.start_ibkr_websocket = AsyncMock()

    result = await svc.tickle()

    assert result is False
    assert svc.state.authenticated is False
    svc.start_ibkr_websocket.assert_not_awaited()


# ── start_tickle_loop() does an immediate tickle ────────────────────


@pytest.mark.asyncio
async def test_start_tickle_loop_kicks_initial_tickle():
    """start_tickle_loop() must do an immediate tickle before the periodic
    task starts. Otherwise the first WS-startup signal would be delayed
    by IBKR_TICKLE_INTERVAL (~55s) after auth becomes valid."""
    svc = _make_svc()
    svc.tickle = AsyncMock(return_value=True)

    await svc.start_tickle_loop()

    # Cancel the periodic task we just spawned so the test doesn't leak.
    if svc._tickle_task and not svc._tickle_task.done():
        svc._tickle_task.cancel()
        try:
            await svc._tickle_task
        except asyncio.CancelledError:
            pass

    svc.tickle.assert_awaited_once()


@pytest.mark.asyncio
async def test_start_tickle_loop_is_idempotent():
    """Calling start_tickle_loop twice in a row must not spawn two tasks
    or do two initial tickles. Auth bootstrap can fire from multiple paths
    (auth.py + gateway.py) so the guard matters."""
    svc = _make_svc()
    svc.tickle = AsyncMock(return_value=True)

    await svc.start_tickle_loop()
    first_task = svc._tickle_task
    await svc.start_tickle_loop()

    assert svc._tickle_task is first_task

    if svc._tickle_task and not svc._tickle_task.done():
        svc._tickle_task.cancel()
        try:
            await svc._tickle_task
        except asyncio.CancelledError:
            pass

    # The first call did an immediate tickle; the second short-circuited.
    assert svc.tickle.await_count == 1


# ── End-to-end: connect-before-auth scenario ────────────────────────


@pytest.mark.asyncio
async def test_late_auth_still_starts_ws():
    """The headline scenario this entire suite exists to prevent.

    Sequence:
      1. FE connects to /ws while gateway is unauthenticated
         (FE endpoint sees authenticated=False, doesn't call start_ibkr_websocket)
      2. Auth eventually becomes valid via the tickle path
      3. WS task must start without further FE action

    The fix wires step 3 — tickle() success starts the WS task itself.
    """
    svc = _make_svc()
    svc._request = AsyncMock(return_value={"session": "deadbeef"})
    svc.start_ibkr_websocket = AsyncMock()

    # Step 1: FE connect-time auth check fails (no-op, state stays unauthenticated)
    assert svc.state.authenticated is False
    svc.start_ibkr_websocket.assert_not_awaited()

    # Step 2: auth eventually succeeds via the tickle path
    await svc.tickle()

    # Step 3: WS task auto-started
    svc.start_ibkr_websocket.assert_awaited_once()
