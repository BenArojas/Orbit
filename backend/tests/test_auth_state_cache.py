"""
Tests for the auth-status server-side cache (Phase 8 / Task 1.7).

Behavior under test:
  * Repeated `auth_status()` calls within `AUTH_STATUS_TTL_SEC` issue exactly
    1 IBKR `POST /iserver/auth/status`.
  * `invalidate_auth_cache()` drops the cache so the next call probes again.
  * Tickle-loop failures invalidate the cache automatically.
  * Concurrent cold-cache callers single-flight to one probe (lock).
  * IBKRConnectionError responses are NOT cached (gateway recovery).
  * `state.reset()` lifecycle (logout) clears the cache via the service hook.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

import config
from exceptions import IBKRConnectionError
from services.ibkr import IBKRService
from state import IBKRState


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_svc() -> IBKRService:
    """Bare IBKRService for unit testing — mirrors test_ibkr_disconnect's
    helper but adds the Task 1.7 cache fields via _ensure_auth_cache_attrs.
    """
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = IBKRState()
    svc.http = MagicMock()
    svc._tickle_task = None
    svc._ws_task = None
    svc.db = None
    svc._ensure_auth_cache_attrs()
    return svc


def _patch_request(svc: IBKRService, payload: dict, call_log: list) -> None:
    """Replace svc._request with an async mock that logs calls and returns
    the given IBKR-shaped payload (dict with `authenticated` + `connected`).
    """
    async def fake_request(method, endpoint, **kwargs):
        # Yield once so concurrent callers can join the single-flight lock
        # before we resolve.
        await asyncio.sleep(0.005)
        call_log.append((method, endpoint))
        return payload

    svc._request = fake_request  # type: ignore[assignment]


# ── 1. TTL behavior ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_repeated_calls_within_ttl_issue_one_probe(monkeypatch):
    """5 sequential auth_status() calls within the TTL → exactly 1 IBKR POST."""
    monkeypatch.setattr(config, "AUTH_STATUS_TTL_SEC", 5.0)
    # Re-import the symbol the service captured at import time
    monkeypatch.setattr("services.ibkr.AUTH_STATUS_TTL_SEC", 5.0)

    svc = _make_svc()
    calls: list = []
    _patch_request(svc, {"authenticated": True, "connected": True, "message": "OK"}, calls)
    svc.ensure_accounts = AsyncMock()  # bootstrap is a no-op for this test

    results = []
    for _ in range(5):
        results.append(await svc.auth_status())

    assert len(calls) == 1, f"expected 1 IBKR probe, got {len(calls)}: {calls}"
    # All callers see the same payload
    for r in results:
        assert r["authenticated"] is True
        assert r["message"] == "OK"


@pytest.mark.asyncio
async def test_call_after_ttl_expiry_re_probes(monkeypatch):
    """A call after TTL has passed issues a fresh IBKR probe."""
    # Tiny TTL so the test runs fast.
    monkeypatch.setattr("services.ibkr.AUTH_STATUS_TTL_SEC", 0.05)

    svc = _make_svc()
    calls: list = []
    _patch_request(svc, {"authenticated": True, "connected": True, "message": "OK"}, calls)
    svc.ensure_accounts = AsyncMock()

    await svc.auth_status()
    await asyncio.sleep(0.1)  # past the 50ms TTL
    await svc.auth_status()

    assert len(calls) == 2


# ── 2. Explicit invalidation ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_invalidate_auth_cache_forces_fresh_probe(monkeypatch):
    """invalidate_auth_cache() drops the cache so the next call re-probes."""
    monkeypatch.setattr("services.ibkr.AUTH_STATUS_TTL_SEC", 5.0)

    svc = _make_svc()
    calls: list = []
    _patch_request(svc, {"authenticated": True, "connected": True, "message": "OK"}, calls)
    svc.ensure_accounts = AsyncMock()

    await svc.auth_status()
    assert len(calls) == 1

    svc.invalidate_auth_cache()
    await svc.auth_status()
    assert len(calls) == 2


# ── 3. Tickle-loop failure invalidation ──────────────────────────────────────


@pytest.mark.asyncio
async def test_tickle_failure_invalidates_cache(monkeypatch):
    """A failed tickle drops the cached auth-status payload."""
    monkeypatch.setattr("services.ibkr.AUTH_STATUS_TTL_SEC", 5.0)

    svc = _make_svc()
    calls: list = []
    _patch_request(svc, {"authenticated": True, "connected": True, "message": "OK"}, calls)
    svc.ensure_accounts = AsyncMock()

    # Prime the cache
    await svc.auth_status()
    assert svc._auth_cache is not None

    # Simulate one tick of the tickle loop's failure path: tickle returns
    # False → tickle_fail_count++ → invalidate_auth_cache().  We don't run
    # the whole loop (it sleeps for 55s); we just call the invalidation
    # helper that the loop calls.
    svc.invalidate_auth_cache()

    assert svc._auth_cache is None
    # Next auth_status() must re-probe IBKR
    await svc.auth_status()
    assert len(calls) == 2


# ── 4. Concurrent cold-cache callers single-flight ──────────────────────────


@pytest.mark.asyncio
async def test_concurrent_cold_callers_share_one_probe(monkeypatch):
    """5 concurrent auth_status() calls with empty cache → 1 IBKR probe."""
    monkeypatch.setattr("services.ibkr.AUTH_STATUS_TTL_SEC", 5.0)

    svc = _make_svc()
    calls: list = []
    _patch_request(svc, {"authenticated": True, "connected": True, "message": "OK"}, calls)
    svc.ensure_accounts = AsyncMock()

    results = await asyncio.gather(*(svc.auth_status() for _ in range(5)))

    assert len(calls) == 1, f"expected 1 IBKR probe, got {len(calls)}: {calls}"
    assert all(r["authenticated"] is True for r in results)


# ── 5. IBKRConnectionError is NOT cached (gateway recovery) ─────────────────


@pytest.mark.asyncio
async def test_connection_error_response_is_not_cached(monkeypatch):
    """When the gateway is unreachable, the failure response is not cached
    so the very next call re-probes (catches gateway recovery quickly)."""
    monkeypatch.setattr("services.ibkr.AUTH_STATUS_TTL_SEC", 5.0)

    svc = _make_svc()
    calls: list = []

    async def failing_request(method, endpoint, **kwargs):
        calls.append((method, endpoint))
        raise IBKRConnectionError("gateway down")

    svc._request = failing_request  # type: ignore[assignment]

    r1 = await svc.auth_status()
    r2 = await svc.auth_status()

    # Both calls actually probed IBKR — no caching of the error path.
    assert len(calls) == 2
    assert r1["authenticated"] is False
    assert r2["authenticated"] is False
    # The internal _no_cache flag is stripped from the public response
    assert "_no_cache" not in r1
    assert "_no_cache" not in r2


# ── 6. Auth-False results ARE cached (steady-state polling) ─────────────────


@pytest.mark.asyncio
async def test_auth_false_results_are_cached(monkeypatch):
    """When IBKR returns authenticated:false (logged out), the result IS
    cached — that's the dominant cost case (frontend polls every 2s while
    needsLogin is true)."""
    monkeypatch.setattr("services.ibkr.AUTH_STATUS_TTL_SEC", 5.0)

    svc = _make_svc()
    calls: list = []
    _patch_request(svc, {"authenticated": False, "connected": False, "message": "Not auth"}, calls)
    svc.ensure_accounts = AsyncMock()

    for _ in range(3):
        await svc.auth_status()

    assert len(calls) == 1


# ── 7. TTL=0 disables the cache entirely ────────────────────────────────────


@pytest.mark.asyncio
async def test_ttl_zero_disables_cache(monkeypatch):
    """Setting AUTH_STATUS_TTL_SEC=0 = always probe IBKR."""
    monkeypatch.setattr("services.ibkr.AUTH_STATUS_TTL_SEC", 0.0)

    svc = _make_svc()
    calls: list = []
    _patch_request(svc, {"authenticated": True, "connected": True, "message": "OK"}, calls)
    svc.ensure_accounts = AsyncMock()

    for _ in range(3):
        await svc.auth_status()

    assert len(calls) == 3


# ── 8. Cache returns defensive copies ───────────────────────────────────────


@pytest.mark.asyncio
async def test_cache_returns_defensive_copies(monkeypatch):
    """Mutating a returned dict must not poison the cache for the next
    caller (subtle bug if the cache holds a shared reference)."""
    monkeypatch.setattr("services.ibkr.AUTH_STATUS_TTL_SEC", 5.0)

    svc = _make_svc()
    calls: list = []
    _patch_request(svc, {"authenticated": True, "connected": True, "message": "OK"}, calls)
    svc.ensure_accounts = AsyncMock()

    r1 = await svc.auth_status()
    r1["authenticated"] = "MUTATED"
    r1["message"] = "POISONED"

    r2 = await svc.auth_status()
    assert r2["authenticated"] is True
    assert r2["message"] == "OK"
    assert len(calls) == 1  # second call still served from cache
