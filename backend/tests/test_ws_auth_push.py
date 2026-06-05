"""
Tests for Phase 8 / Task 2.5 — WebSocket auth-state push.

Verifies two behaviours in IBKRService._handle_sts_message():

  1. IBKR sts message → broadcaster emits {"type":"auth_state",...} to
     every connected frontend WebSocket client.
  2. True → False auth flip invalidates the Task 1.7 auth-state cache
     (IBKRService._auth_cache) so the next /gateway/status or
     /health/details poll re-probes IBKR rather than serving a stale
     "authenticated: True" answer.

Tests build a minimal IBKRService via __new__ to avoid spinning up
httpx clients, asyncio tasks, or real WebSocket connections.
"""

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock

# Stub pandas_ta / pandas before any service chain import touches them.
sys.modules.setdefault("pandas_ta", MagicMock())
sys.modules.setdefault("pandas", MagicMock())

import pytest

from services.ibkr import IBKRService
from state import IBKRState


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_svc(
    *,
    authenticated: bool = False,
    session_dropped: bool = False,
    broadcast: AsyncMock | None = None,
) -> IBKRService:
    """Build a minimal IBKRService without starting any background tasks.

    Uses __new__ so we don't construct an httpx.AsyncClient or create
    asyncio.Tasks — only the attributes that _handle_sts_message touches
    are initialised.
    """
    svc = IBKRService.__new__(IBKRService)
    svc.state = IBKRState(authenticated=authenticated, session_dropped=session_dropped)

    # Task 1.7 auth cache — start populated (warm) so we can detect
    # invalidation as a transition to None / stale timestamp.
    svc._auth_cache = {
        "authenticated": authenticated,
        "message": "Mocked.",
        "ws_ready": True,
    }
    svc._auth_cache_at = 9_999_999_999.0  # far future — won't expire naturally
    svc._auth_cache_lock = asyncio.Lock()

    if broadcast is not None:
        svc._broadcast = broadcast

    return svc


def _sts_msg(authenticated: bool, *, nested: bool = True) -> dict:
    """Build a synthetic IBKR sts WebSocket message.

    nested=True  → {"topic":"sts", "args": {"authenticated": ...}}  (canonical)
    nested=False → {"topic":"sts", "authenticated": ...}            (flat form)
    """
    if nested:
        return {"topic": "sts", "args": {"authenticated": authenticated}}
    return {"topic": "sts", "authenticated": authenticated}


# ── Test 1: broadcast payload ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sts_message_broadcasts_auth_state_to_frontend():
    """IBKR sts push → _broadcast called with type='auth_state' payload.

    Covers the primary user-visible effect of Task 2.5: the frontend is
    notified of an auth change within the WS frame latency (~1s) instead
    of waiting for the next 2s polling cycle.
    """
    broadcast = AsyncMock()
    svc = _make_svc(authenticated=True, broadcast=broadcast)

    # Simulate IBKR pushing "session expired" (True → False flip).
    await svc._handle_sts_message(_sts_msg(authenticated=False))

    broadcast.assert_called_once()
    payload = broadcast.call_args[0][0]

    assert payload["type"] == "auth_state", (
        "broadcast payload must have type='auth_state'"
    )
    assert payload["authenticated"] is False, (
        "broadcast must reflect the new auth state (False after logout push)"
    )
    assert "session_dropped" in payload, (
        "broadcast must include session_dropped so the frontend can show a re-auth prompt"
    )
    assert payload["session_dropped"] is True, (
        "session_dropped must be True after a True→False auth flip"
    )


@pytest.mark.asyncio
async def test_sts_message_broadcasts_reauth_to_frontend():
    """False → True flip also broadcasts so the frontend can resume."""
    broadcast = AsyncMock()
    svc = _make_svc(authenticated=False, session_dropped=True, broadcast=broadcast)

    await svc._handle_sts_message(_sts_msg(authenticated=True))

    broadcast.assert_called_once()
    payload = broadcast.call_args[0][0]

    assert payload["type"] == "auth_state"
    assert payload["authenticated"] is True
    assert payload["session_dropped"] is False, (
        "session_dropped must be cleared on a re-authentication push"
    )


@pytest.mark.asyncio
async def test_sts_message_flat_form_also_broadcasts():
    """Flat message form (no 'args' wrapper) is handled identically."""
    broadcast = AsyncMock()
    svc = _make_svc(authenticated=True, broadcast=broadcast)

    await svc._handle_sts_message(_sts_msg(authenticated=False, nested=False))

    broadcast.assert_called_once()
    assert broadcast.call_args[0][0]["type"] == "auth_state"


@pytest.mark.asyncio
async def test_sts_message_missing_authenticated_field_is_ignored():
    """Messages without an 'authenticated' field must not broadcast or mutate state."""
    broadcast = AsyncMock()
    svc = _make_svc(authenticated=True, broadcast=broadcast)

    await svc._handle_sts_message({"topic": "sts", "args": {}})

    broadcast.assert_not_called()
    assert svc.state.authenticated is True, "state must be unchanged for malformed sts messages"


# ── Test 2: auth cache invalidation ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_true_to_false_flip_invalidates_auth_cache():
    """True → False auth flip must wipe the Task 1.7 auth-state cache.

    This is the core correctness requirement: without cache invalidation,
    the first /gateway/status or /health/details poll after a logout push
    could serve a stale 'authenticated: True' response for up to
    AUTH_STATUS_TTL_SEC (5s), which would leave the frontend unaware that
    re-authentication is required.
    """
    svc = _make_svc(authenticated=True)

    # Precondition: cache is warm.
    assert svc._auth_cache is not None, "test setup: cache should be warm before the flip"

    await svc._handle_sts_message(_sts_msg(authenticated=False))

    assert svc._auth_cache is None, (
        "auth cache must be None after True→False sts push — "
        "next poll must re-probe IBKR"
    )
    assert svc._auth_cache_at == 0.0, (
        "_auth_cache_at must be reset to 0.0 so the cache appears fully expired"
    )


@pytest.mark.asyncio
async def test_false_to_true_flip_also_invalidates_auth_cache():
    """False → True flip must also wipe the cache.

    After a re-authentication push we don't want the stale 'not
    authenticated' answer to be served — the next probe should confirm
    the fresh auth state from IBKR directly.
    """
    svc = _make_svc(authenticated=False, session_dropped=True)
    # Override the cache to hold a stale "not authenticated" entry.
    svc._auth_cache = {"authenticated": False, "message": "stale", "ws_ready": False}

    await svc._handle_sts_message(_sts_msg(authenticated=True))

    assert svc._auth_cache is None, (
        "auth cache must be invalidated on False→True sts push so the "
        "next probe confirms re-auth rather than serving a stale 'False'"
    )


@pytest.mark.asyncio
async def test_no_flip_does_not_invalidate_cache():
    """If auth state does not change, the cache must be left intact.

    IBKR may send periodic sts messages that repeat the current state.
    These must not cause spurious cache misses.
    """
    svc = _make_svc(authenticated=True)
    sentinel_cache = {"authenticated": True, "message": "ok", "ws_ready": True}
    svc._auth_cache = sentinel_cache
    svc._auth_cache_at = 9_999_999_999.0

    # Same state as current — no flip.
    await svc._handle_sts_message(_sts_msg(authenticated=True))

    assert svc._auth_cache is sentinel_cache, (
        "cache must NOT be invalidated when sts push repeats the current auth state"
    )


@pytest.mark.asyncio
async def test_session_dropped_set_on_true_to_false_flip():
    """state.session_dropped becomes True on the first True→False flip."""
    svc = _make_svc(authenticated=True, session_dropped=False)

    await svc._handle_sts_message(_sts_msg(authenticated=False))

    assert svc.state.session_dropped is True


@pytest.mark.asyncio
async def test_session_dropped_cleared_on_false_to_true_flip():
    """state.session_dropped is cleared when the session re-authenticates."""
    svc = _make_svc(authenticated=False, session_dropped=True)

    await svc._handle_sts_message(_sts_msg(authenticated=True))

    assert svc.state.session_dropped is False
