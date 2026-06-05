"""
Tests for /health/details ⊇ /gateway/status shape parity (Phase 8 / Task 2.4).

Goal: the /health/details response must be a strict superset of /gateway/status.
Every key that /gateway/status returns must appear in /health/details with an
identical value for the shared subset.  This lets the frontend drop the
/gateway/status polling clock and poll /health/details only (Task 3.6).

Auth state in both endpoints now comes from IBKRService.auth_status() (Task 1.7
cache), so no extra IBKR probe is issued by /health/details.
"""

import sys
from unittest.mock import AsyncMock, MagicMock

# Stub pandas_ta before any service chain imports it.
sys.modules.setdefault("pandas_ta", MagicMock())
sys.modules.setdefault("pandas", MagicMock())

import pytest
from httpx import AsyncClient, ASGITransport


# ── Mock factories ────────────────────────────────────────────────────────────


def _make_gateway(
    running: bool = True,
    state_value: str = "running",
    provisioned: bool = True,
) -> MagicMock:
    """Return a GatewayLifecycle mock whose .status() shape matches production."""
    gw = MagicMock()
    gw.status.return_value = {
        "state": state_value,
        "provisioned": provisioned,
        "running": running,
        "gateway_url": "https://localhost:5001",
        "gateway_home": "/home/user/.parallax/gateway",
        "error": None,
        "platform": "Linux x86_64",
    }
    return gw


def _make_ibkr(
    authenticated: bool = True,
    session_dropped: bool = False,
    auth_message: str = "Authenticated.",
) -> MagicMock:
    ibkr = MagicMock()
    ibkr.state.authenticated = authenticated
    ibkr.state.session_dropped = session_dropped
    # All async methods need AsyncMock so the gateway router can await them.
    ibkr.auth_status = AsyncMock(return_value={
        "authenticated": authenticated,
        "message": auth_message,
        "ws_ready": True,
    })
    ibkr.start_tickle_loop = AsyncMock()
    ibkr.ensure_accounts = AsyncMock()
    return ibkr


def _make_ollama(state: str = "ready", model: str = "gemma4:26b") -> MagicMock:
    ollama = MagicMock()
    ollama.status.return_value = {"state": state, "selected_model": model}
    return ollama


def _make_scanner() -> MagicMock:
    scanner = MagicMock()
    scanner.status.return_value = {"running": True, "waiting_for_auth": False, "last_run_at": None}
    return scanner


def _make_db() -> AsyncMock:
    db = AsyncMock()
    db.get_setting.return_value = "300"
    db.get_trigger_rules.return_value = []
    return db


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _get_health(app) -> dict:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/health/details")
    assert r.status_code == 200, f"/health/details returned {r.status_code}: {r.text}"
    return r.json()


async def _get_gateway_status(app) -> dict:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/gateway/status")
    assert r.status_code == 200, f"/gateway/status returned {r.status_code}: {r.text}"
    return r.json()


# ── Tests ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health_details_is_superset_of_gateway_status_authenticated():
    """/health/details contains every key from /gateway/status, same values.

    Both endpoints are called with the same mock state so the underlying
    data is identical — any divergence is a shape bug.
    """
    from main import app

    gw = _make_gateway()
    ibkr = _make_ibkr(authenticated=True)

    app.state.gateway = gw
    app.state.ibkr = ibkr
    app.state.ollama = _make_ollama()
    app.state.scanner = _make_scanner()
    app.state.db = _make_db()

    health = await _get_health(app)
    gw_status = await _get_gateway_status(app)

    missing = [k for k in gw_status if k not in health]
    assert not missing, (
        f"/health/details is missing keys that /gateway/status has: {missing}"
    )

    diverged = {
        k: {"gateway_status": gw_status[k], "health_details": health[k]}
        for k in gw_status
        if health.get(k) != gw_status[k]
    }
    assert not diverged, (
        f"Values differ between /gateway/status and /health/details for: {diverged}"
    )


@pytest.mark.asyncio
async def test_health_details_is_superset_of_gateway_status_not_authenticated():
    """Shape parity holds when gateway is running but not authenticated."""
    from main import app

    gw = _make_gateway()
    ibkr = _make_ibkr(authenticated=False, auth_message="Login required.")

    app.state.gateway = gw
    app.state.ibkr = ibkr
    app.state.ollama = _make_ollama()
    app.state.scanner = _make_scanner()
    app.state.db = _make_db()

    health = await _get_health(app)
    gw_status = await _get_gateway_status(app)

    missing = [k for k in gw_status if k not in health]
    assert not missing, f"Missing keys: {missing}"

    diverged = {
        k: {"gateway_status": gw_status[k], "health_details": health[k]}
        for k in gw_status
        if health.get(k) != gw_status[k]
    }
    assert not diverged, f"Diverged values: {diverged}"


@pytest.mark.asyncio
async def test_health_details_is_superset_of_gateway_status_not_running():
    """Shape parity holds when gateway is not running."""
    from main import app

    gw = _make_gateway(running=False, state_value="provisioned")
    ibkr = _make_ibkr(authenticated=False)

    app.state.gateway = gw
    app.state.ibkr = ibkr
    app.state.ollama = _make_ollama()
    app.state.scanner = _make_scanner()
    app.state.db = _make_db()

    health = await _get_health(app)
    gw_status = await _get_gateway_status(app)

    missing = [k for k in gw_status if k not in health]
    assert not missing, f"Missing keys: {missing}"

    diverged = {
        k: {"gateway_status": gw_status[k], "health_details": health[k]}
        for k in gw_status
        if health.get(k) != gw_status[k]
    }
    assert not diverged, f"Diverged values: {diverged}"


@pytest.mark.asyncio
async def test_health_details_retains_its_own_fields():
    """/health/details still has its own checks/overall/generated_at fields."""
    from main import app

    app.state.gateway = _make_gateway()
    app.state.ibkr = _make_ibkr()
    app.state.ollama = _make_ollama()
    app.state.scanner = _make_scanner()
    app.state.db = _make_db()

    health = await _get_health(app)

    assert "overall" in health
    assert "checks" in health
    assert "generated_at" in health
    assert isinstance(health["checks"], list)
    assert len(health["checks"]) == 5


@pytest.mark.asyncio
async def test_session_dropped_propagates_correctly():
    """session_dropped=True is reflected identically in both endpoints."""
    from main import app

    gw = _make_gateway()
    ibkr = _make_ibkr(authenticated=True, session_dropped=True)

    app.state.gateway = gw
    app.state.ibkr = ibkr
    app.state.ollama = _make_ollama()
    app.state.scanner = _make_scanner()
    app.state.db = _make_db()

    health = await _get_health(app)
    gw_status = await _get_gateway_status(app)

    assert health["session_dropped"] is True
    assert gw_status["session_dropped"] is True
    assert health["session_dropped"] == gw_status["session_dropped"]
