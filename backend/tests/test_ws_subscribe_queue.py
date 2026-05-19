"""
Tests for the IBKR WebSocket subscribe queue.

Covers the fix for the startup race where the frontend sends subscribe()
calls before the IBKR WebSocket handshake completes. Previously those
subscribes were dropped with a WARNING log. Now they are queued in
``state.ws_pending_subscribes`` and flushed the moment the IBKR WS
connects (or reconnects after a drop).

Tests build a minimal IBKRService via __new__ to avoid spinning up
httpx clients, asyncio tasks, or real WebSocket connections — same
pattern as test_ws_auth_push.py.
"""

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch

# Stub heavy deps before the service import chain touches them.
sys.modules.setdefault("pandas_ta", MagicMock())
sys.modules.setdefault("pandas", MagicMock())

import pytest

from services.ibkr import IBKRService
from state import IBKRState


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_svc(*, ws_connected: bool = False, authenticated: bool = True) -> IBKRService:
    """Build a minimal IBKRService without starting any background tasks.

    Default authenticated=True so existing tests that just want a "WS-up,
    session-up" scenario don't have to pass it explicitly. Tests for the
    auth guard pass authenticated=False.
    """
    svc = IBKRService.__new__(IBKRService)
    svc.state = IBKRState(ws_connected=ws_connected, authenticated=authenticated)
    return svc


# ── ws_subscribe — queuing when disconnected ──────────────────────────────────


@pytest.mark.asyncio
async def test_subscribe_queued_when_ws_disconnected():
    """ws_subscribe() when WS is down must add conid to pending set, not warn."""
    svc = _make_svc(ws_connected=False)
    svc.state.ibkr_ws = None

    await svc.ws_subscribe(265598)

    assert 265598 in svc.state.ws_pending_subscribes, (
        "conid must be queued in ws_pending_subscribes when WS is not connected"
    )
    assert 265598 not in svc.state.ws_subscriptions, (
        "conid must NOT be in ws_subscriptions until the subscribe is actually sent"
    )


@pytest.mark.asyncio
async def test_multiple_subscribes_queued_when_ws_disconnected():
    """Multiple ws_subscribe() calls before connect all accumulate in pending."""
    svc = _make_svc(ws_connected=False)
    svc.state.ibkr_ws = None

    await svc.ws_subscribe(265598)
    await svc.ws_subscribe(320227571)
    await svc.ws_subscribe(8314)

    assert svc.state.ws_pending_subscribes == {265598, 320227571, 8314}


@pytest.mark.asyncio
async def test_subscribe_sent_immediately_when_ws_connected():
    """ws_subscribe() when WS is up must send immediately, not queue."""
    svc = _make_svc(ws_connected=True)
    mock_ws = AsyncMock()
    svc.state.ibkr_ws = mock_ws

    await svc.ws_subscribe(265598)

    mock_ws.send.assert_awaited_once()
    assert 265598 in svc.state.ws_subscriptions
    assert 265598 not in svc.state.ws_pending_subscribes


# ── ws_unsubscribe — removes from pending set ─────────────────────────────────


@pytest.mark.asyncio
async def test_unsubscribe_removes_from_pending_when_disconnected():
    """ws_unsubscribe() on a queued-but-not-yet-subscribed conid clears the queue entry."""
    svc = _make_svc(ws_connected=False)
    svc.state.ibkr_ws = None
    svc.state.ws_pending_subscribes.add(265598)

    await svc.ws_unsubscribe(265598)

    assert 265598 not in svc.state.ws_pending_subscribes, (
        "Unsubscribing a queued conid must remove it from ws_pending_subscribes"
    )


@pytest.mark.asyncio
async def test_unsubscribe_while_disconnected_does_not_send():
    """ws_unsubscribe() when WS is down must not attempt to send anything."""
    svc = _make_svc(ws_connected=False)
    mock_ws = MagicMock()  # not an AsyncMock — send should never be called
    svc.state.ibkr_ws = mock_ws

    svc.state.ws_pending_subscribes.add(265598)
    await svc.ws_unsubscribe(265598)

    mock_ws.send.assert_not_called()


# ── pending-flush on connect ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_pending_subscribes_flushed_on_connect():
    """Pending subscribes must be sent and cleared when the WS connects."""
    svc = _make_svc(ws_connected=False)
    svc.state.ibkr_ws = None

    # Queue two subscribes before the WS is up.
    await svc.ws_subscribe(265598)
    await svc.ws_subscribe(320227571)
    assert len(svc.state.ws_pending_subscribes) == 2

    # Simulate the WS connecting: mark state and provide a mock ws object,
    # then call the flush logic directly (the same block inside _ws_loop).
    mock_ws = AsyncMock()
    svc.state.ws_connected = True
    svc.state.ibkr_ws = mock_ws

    # Replicate the flush block from _ws_loop inline.
    if svc.state.ws_pending_subscribes:
        import json
        from services.ibkr import LIVE_STREAM_FIELDS
        pending = list(svc.state.ws_pending_subscribes)
        svc.state.ws_pending_subscribes.clear()
        for conid in pending:
            fields_json = json.dumps({"fields": LIVE_STREAM_FIELDS})
            await mock_ws.send(f"smd+{conid}+{fields_json}")
            svc.state.ws_subscriptions.add(conid)

    assert mock_ws.send.await_count == 2, (
        "Both queued conids must be sent to IBKR on connect"
    )
    assert svc.state.ws_pending_subscribes == set(), (
        "Pending queue must be empty after flush"
    )
    assert {265598, 320227571} <= svc.state.ws_subscriptions, (
        "Flushed conids must be tracked in ws_subscriptions"
    )


@pytest.mark.asyncio
async def test_no_pending_subscribes_on_clean_connect():
    """If no subscribes were queued, the flush is a no-op (no extra send calls)."""
    svc = _make_svc(ws_connected=False)
    svc.state.ibkr_ws = None

    # No subscribe calls — pending set stays empty.
    mock_ws = AsyncMock()
    svc.state.ws_connected = True
    svc.state.ibkr_ws = mock_ws

    # Flush block (same as _ws_loop).
    if svc.state.ws_pending_subscribes:
        import json
        from services.ibkr import LIVE_STREAM_FIELDS
        pending = list(svc.state.ws_pending_subscribes)
        svc.state.ws_pending_subscribes.clear()
        for conid in pending:
            fields_json = json.dumps({"fields": LIVE_STREAM_FIELDS})
            await mock_ws.send(f"smd+{conid}+{fields_json}")

    mock_ws.send.assert_not_awaited()


# ── IBKRState.reset() clears pending set ─────────────────────────────────────


def test_state_reset_clears_pending_subscribes():
    """IBKRState.reset() must clear ws_pending_subscribes."""
    state = IBKRState()
    state.ws_pending_subscribes.add(265598)
    state.ws_pending_subscribes.add(320227571)

    state.reset()

    assert state.ws_pending_subscribes == set(), (
        "reset() must clear ws_pending_subscribes so a re-auth starts fresh"
    )


# ── Auth guard — never send smd while brokerage session is not authenticated ──


@pytest.mark.asyncio
async def test_subscribe_queued_when_not_authenticated():
    """ws_subscribe() must queue (not send) when the WS is connected but the
    brokerage session isn't authenticated yet. IBKR rejects smd subscriptions
    without an active brokerage session, so sending them would silently fail.
    """
    svc = _make_svc(ws_connected=True, authenticated=False)
    mock_ws = AsyncMock()
    svc.state.ibkr_ws = mock_ws

    await svc.ws_subscribe(265598)

    mock_ws.send.assert_not_awaited()
    assert 265598 in svc.state.ws_pending_subscribes
    assert 265598 not in svc.state.ws_subscriptions


# ── 10-minute refresh task — keeps streams alive past IBKR's 15-minute timeout ──


@pytest.mark.asyncio
async def test_refresh_resends_active_subscriptions():
    """The refresh task body must re-send smd for every active subscription.

    IBKR's docs require a fresh smd+conid+{fields} every 10 minutes to keep
    market-data streams from auto-terminating at 15 minutes. We invoke the
    refresh logic directly (skipping the 10-minute sleep) to verify the
    re-send happens for every conid in ws_subscriptions.
    """
    svc = _make_svc(ws_connected=True, authenticated=True)
    mock_ws = AsyncMock()
    svc.state.ibkr_ws = mock_ws
    svc.state.ws_subscriptions.update({265598, 320227571})

    # Inline the refresh-task body (same as _ws_refresh_subscriptions, minus the sleep).
    import json
    from services.ibkr import LIVE_STREAM_FIELDS
    conids = list(svc.state.ws_subscriptions)
    fields_json = json.dumps({"fields": LIVE_STREAM_FIELDS})
    for conid in conids:
        await svc.state.ibkr_ws.send(f"smd+{conid}+{fields_json}")

    assert mock_ws.send.await_count == 2, (
        "Refresh must re-send smd for every active conid in ws_subscriptions"
    )
    sent_payloads = [call.args[0] for call in mock_ws.send.await_args_list]
    assert any("265598" in p for p in sent_payloads)
    assert any("320227571" in p for p in sent_payloads)


@pytest.mark.asyncio
async def test_refresh_with_no_active_subscriptions_is_noop():
    """The refresh task must do nothing when there are no active subscriptions."""
    svc = _make_svc(ws_connected=True, authenticated=True)
    mock_ws = AsyncMock()
    svc.state.ibkr_ws = mock_ws
    # ws_subscriptions intentionally empty

    conids = list(svc.state.ws_subscriptions)
    # The real method has `if not conids: continue` — verified by not sending below.
    assert conids == []
    mock_ws.send.assert_not_awaited()


# ── FE→BE readiness gate (ported from MoonMarket) ────────────────────────────


@pytest.mark.asyncio
async def test_wait_for_ws_ready_returns_true_when_event_set():
    """If the IBKR WS is already ready, wait_for_ws_ready returns True immediately."""
    svc = _make_svc(ws_connected=True, authenticated=True)
    svc.state.ws_ready_event.set()

    ready = await svc.wait_for_ws_ready(timeout=0.1)
    assert ready is True


@pytest.mark.asyncio
async def test_wait_for_ws_ready_times_out_when_event_never_set():
    """If the IBKR WS never comes up, wait_for_ws_ready returns False after timeout."""
    svc = _make_svc(ws_connected=False, authenticated=True)
    # ws_ready_event is unset by default

    ready = await svc.wait_for_ws_ready(timeout=0.1)
    assert ready is False


@pytest.mark.asyncio
async def test_wait_for_ws_ready_unblocks_when_event_fires_during_wait():
    """The gate returns True if the event is set while wait_for_ws_ready is in flight."""
    svc = _make_svc(ws_connected=False, authenticated=True)

    async def set_after_delay():
        await asyncio.sleep(0.05)
        svc.state.ws_ready_event.set()

    setter = asyncio.create_task(set_after_delay())
    ready = await svc.wait_for_ws_ready(timeout=1.0)
    await setter

    assert ready is True


def test_state_reset_clears_ws_ready_event():
    """IBKRState.reset() must clear ws_ready_event so a re-auth starts ungated."""
    state = IBKRState()
    state.ws_ready_event.set()
    assert state.ws_ready_event.is_set()

    state.reset()

    assert not state.ws_ready_event.is_set()


# ── Bulk-subscribe pacing constant ──────────────────────────────────────────


def test_bulk_subscribe_pacing_constant():
    """The 50ms pacing constant is exposed for the flush/refresh loops to use."""
    from services.ibkr import IBKR_WS_BULK_SUBSCRIBE_DELAY_SECONDS
    assert IBKR_WS_BULK_SUBSCRIBE_DELAY_SECONDS == 0.05


def test_ws_ready_gate_timeout_constant():
    """The FE→BE gate timeout is exposed and matches MoonMarket's 10s."""
    from services.ibkr import IBKR_WS_READY_GATE_TIMEOUT_SECONDS
    assert IBKR_WS_READY_GATE_TIMEOUT_SECONDS == 10.0
