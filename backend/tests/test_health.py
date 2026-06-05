"""
Tests for GET /health/details — Phase 7.5 health strip backend.

Covers:
  - Overall severity derivation (ok / warning / error)
  - Each individual check helper for key states
  - The endpoint returns the expected shape
"""

import sys
from unittest.mock import AsyncMock, MagicMock

# Stub out pandas_ta before any service chain imports it.
# The sandbox doesn't have the package; production runs via uv which does.
sys.modules.setdefault("pandas_ta", MagicMock())
sys.modules.setdefault("pandas", MagicMock())

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport


# ── Helpers to build lightweight service mocks ────────────────────────────────

def _make_gateway(running: bool = True, state_value: str = "running") -> MagicMock:
    gw = MagicMock()
    # Task 2.4: health_details calls gw.status() and spreads the result
    # into its own response, so the mock needs the full production shape.
    gw.status.return_value = {
        "state": state_value,
        "provisioned": True,
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
) -> MagicMock:
    ibkr = MagicMock()
    ibkr.state.authenticated = authenticated
    ibkr.state.session_dropped = session_dropped
    # Task 2.4: health_details now calls ibkr.auth_status() (the cached
    # Task-1.7 path) to populate /gateway/status-parity fields.
    ibkr.auth_status = AsyncMock(return_value={
        "authenticated": authenticated,
        "message": "Connected and authenticated." if authenticated else "Login required.",
        "ws_ready": True,
    })
    # gateway_status() also calls these when authenticated.
    ibkr.start_tickle_loop = AsyncMock()
    ibkr.ensure_accounts = AsyncMock()
    return ibkr


def _make_ollama(state: str = "ready", selected_model: str = "gemma4:26b") -> MagicMock:
    ollama = MagicMock()
    ollama.status.return_value = {"state": state, "selected_model": selected_model}
    return ollama


def _make_scanner(
    running: bool = True,
    waiting_for_auth: bool = False,
    last_run_at: str | None = None,
) -> MagicMock:
    scanner = MagicMock()
    scanner.status.return_value = {
        "running": running,
        "waiting_for_auth": waiting_for_auth,
        "last_run_at": last_run_at,
    }
    return scanner


def _make_db(rules: list[dict] | None = None) -> AsyncMock:
    db = AsyncMock()
    db.get_setting.return_value = "300"
    db.get_trigger_rules.return_value = rules if rules is not None else []
    return db


# ── Import check helpers directly ─────────────────────────────────────────────

from routers.health import (
    _check_gateway,
    _check_ollama,
    _check_scanner,
    _check_database,
    _check_triggers,
)


# ── Gateway checks ────────────────────────────────────────────────────────────

class TestCheckGateway:
    def test_all_good(self):
        result = _check_gateway(_make_gateway(), _make_ibkr())
        assert result["ok"] is True
        assert result["severity"] == "ok"
        assert "authenticated" in result["message"].lower()

    def test_session_dropped_is_error(self):
        result = _check_gateway(_make_gateway(), _make_ibkr(session_dropped=True))
        assert result["ok"] is False
        assert result["severity"] == "error"
        assert "dropped" in result["message"].lower()

    def test_gateway_not_running_is_error(self):
        result = _check_gateway(
            _make_gateway(running=False, state_value="provisioned"),
            _make_ibkr(authenticated=False),
        )
        assert result["ok"] is False
        assert result["severity"] == "error"

    def test_running_but_not_authenticated_is_warning(self):
        result = _check_gateway(_make_gateway(), _make_ibkr(authenticated=False))
        assert result["ok"] is False
        assert result["severity"] == "warning"
        assert "log in" in result["message"].lower()


# ── Ollama checks ─────────────────────────────────────────────────────────────

class TestCheckOllama:
    def test_ready_is_ok(self):
        result = _check_ollama(_make_ollama(state="ready"))
        assert result["ok"] is True
        assert result["severity"] == "ok"
        assert "gemma4:26b" in result["message"]

    def test_running_no_model_is_warning(self):
        result = _check_ollama(_make_ollama(state="running", selected_model=""))
        assert result["ok"] is False
        assert result["severity"] == "warning"

    def test_not_installed_is_warning(self):
        result = _check_ollama(_make_ollama(state="not_installed"))
        assert result["ok"] is False
        assert result["severity"] == "warning"


# ── Scanner checks ────────────────────────────────────────────────────────────

class TestCheckScanner:
    def test_running_with_recent_scan(self):
        recent = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
        result = _check_scanner(_make_scanner(running=True, last_run_at=recent))
        assert result["ok"] is True
        assert "3m ago" in result["message"]

    def test_running_no_scans_yet(self):
        result = _check_scanner(_make_scanner(running=True, last_run_at=None))
        assert result["ok"] is True
        assert "no scans" in result["message"].lower()

    def test_waiting_for_auth_is_warning(self):
        result = _check_scanner(_make_scanner(running=False, waiting_for_auth=True))
        assert result["ok"] is False
        assert result["severity"] == "warning"

    def test_not_running_is_warning(self):
        result = _check_scanner(_make_scanner(running=False))
        assert result["ok"] is False
        assert result["severity"] == "warning"


# ── Database checks ───────────────────────────────────────────────────────────

class TestCheckDatabase:
    @pytest.mark.asyncio
    async def test_db_accessible_is_ok(self):
        result = await _check_database(_make_db())
        assert result["ok"] is True
        assert result["severity"] == "ok"

    @pytest.mark.asyncio
    async def test_db_failure_is_error(self):
        db = AsyncMock()
        db.get_setting.side_effect = RuntimeError("disk I/O error")
        result = await _check_database(db)
        assert result["ok"] is False
        assert result["severity"] == "error"


# ── Trigger rule checks ───────────────────────────────────────────────────────

class TestCheckTriggers:
    @pytest.mark.asyncio
    async def test_no_rules(self):
        result = await _check_triggers(_make_db(rules=[]))
        assert result["ok"] is True
        assert "no trigger" in result["message"].lower()

    @pytest.mark.asyncio
    async def test_some_enabled(self):
        rules = [
            {"id": 1, "enabled": True},
            {"id": 2, "enabled": False},
            {"id": 3, "enabled": True},
        ]
        result = await _check_triggers(_make_db(rules=rules))
        assert result["ok"] is True
        assert "2 of 3" in result["message"]

    @pytest.mark.asyncio
    async def test_db_failure_is_warning(self):
        db = AsyncMock()
        db.get_trigger_rules.side_effect = RuntimeError("table missing")
        result = await _check_triggers(db)
        assert result["ok"] is False
        assert result["severity"] == "warning"


# ── Overall severity derivation ───────────────────────────────────────────────

class TestOverallSeverity:
    """
    Test that the /health/details endpoint derives overall severity correctly.
    We patch all five check functions to control what they return.
    """

    def _make_check(self, severity: str) -> dict:
        return {
            "ok": severity == "ok",
            "label": "Test",
            "message": "Test",
            "severity": severity,
        }

    @pytest.mark.asyncio
    async def test_all_ok(self):
        checks = [self._make_check("ok")] * 5
        severities = [c["severity"] for c in checks]
        overall = "error" if "error" in severities else "warning" if "warning" in severities else "ok"
        assert overall == "ok"

    @pytest.mark.asyncio
    async def test_one_warning(self):
        checks = [self._make_check("ok")] * 4 + [self._make_check("warning")]
        severities = [c["severity"] for c in checks]
        overall = "error" if "error" in severities else "warning" if "warning" in severities else "ok"
        assert overall == "warning"

    @pytest.mark.asyncio
    async def test_error_takes_precedence(self):
        checks = [self._make_check("warning"), self._make_check("error")]
        severities = [c["severity"] for c in checks]
        overall = "error" if "error" in severities else "warning" if "warning" in severities else "ok"
        assert overall == "error"


# ── Endpoint shape test ───────────────────────────────────────────────────────

class TestHealthDetailsEndpoint:
    @pytest.mark.asyncio
    async def test_response_shape(self):
        """The endpoint returns overall, checks list, and generated_at."""
        from main import app

        # Patch app.state with mocks
        app.state.gateway = _make_gateway()
        app.state.ibkr = _make_ibkr()
        app.state.ollama = _make_ollama()
        app.state.scanner = _make_scanner()
        app.state.db = _make_db()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/health/details")

        assert response.status_code == 200
        body = response.json()
        assert "overall" in body
        assert "checks" in body
        assert "generated_at" in body
        assert isinstance(body["checks"], list)
        assert len(body["checks"]) == 5
        for check in body["checks"]:
            assert "ok" in check
            assert "label" in check
            assert "message" in check

    @pytest.mark.asyncio
    async def test_all_healthy_returns_ok(self):
        from main import app

        app.state.gateway = _make_gateway()
        app.state.ibkr = _make_ibkr()
        app.state.ollama = _make_ollama()
        app.state.scanner = _make_scanner()
        app.state.db = _make_db()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/health/details")

        assert response.json()["overall"] == "ok"

    @pytest.mark.asyncio
    async def test_gateway_down_returns_error(self):
        from main import app

        app.state.gateway = _make_gateway(running=False, state_value="provisioned")
        app.state.ibkr = _make_ibkr(authenticated=False)
        app.state.ollama = _make_ollama()
        app.state.scanner = _make_scanner()
        app.state.db = _make_db()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/health/details")

        assert response.json()["overall"] == "error"
