"""
Tests for the Phase 8 gateway reset endpoints.

Covers:
  - GatewayLifecycle.clear_session_files() filesystem behaviour
  - POST /gateway/reset-session orchestration (stop tickle/WS, restart gw)
  - POST /gateway/factory-reset orchestration (+ session file cleanup)
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.gateway import GatewayLifecycle


# ── Unit tests for clear_session_files ───────────────────────────────────────


class TestClearSessionFiles:
    """
    clear_session_files() removes session-state artefacts under root/ without
    touching binaries (bin/, dist/) or conf.yaml. Safe to call at any time.
    """

    def _mk_gateway(self, tmp_path: Path) -> GatewayLifecycle:
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        # Pretend the gateway has been provisioned and run at least once
        gw.root_dir.mkdir(parents=True, exist_ok=True)
        return gw

    def test_removes_logs_dir(self, tmp_path):
        gw = self._mk_gateway(tmp_path)
        logs = gw.root_dir / "logs"
        logs.mkdir()
        (logs / "ibgateway.log").write_text("stale")

        removed = gw.clear_session_files()

        assert not logs.exists()
        assert str(logs) in removed

    def test_removes_jts_dir(self, tmp_path):
        gw = self._mk_gateway(tmp_path)
        jts = gw.root_dir / "Jts"
        jts.mkdir()
        (jts / "login.xml").write_text("<session/>")

        removed = gw.clear_session_files()

        assert not jts.exists()
        assert str(jts) in removed

    def test_removes_cookie_and_session_files(self, tmp_path):
        gw = self._mk_gateway(tmp_path)
        cookie = gw.root_dir / "auth.cookie"
        session = gw.root_dir / "ibkr.session"
        cookie.write_text("c")
        session.write_text("s")

        removed = gw.clear_session_files()

        assert not cookie.exists()
        assert not session.exists()
        assert str(cookie) in removed
        assert str(session) in removed

    def test_removes_process_log(self, tmp_path):
        gw = self._mk_gateway(tmp_path)
        gw.log_path.write_text("old stdout\n")

        removed = gw.clear_session_files()

        assert not gw.log_path.exists()
        assert str(gw.log_path) in removed

    def test_preserves_conf_yaml_and_binaries(self, tmp_path):
        gw = self._mk_gateway(tmp_path)

        conf = gw.root_dir / "conf.yaml"
        conf.write_text("listenPort: 5001\n")
        # Binaries live outside root/ — must be preserved
        dist = tmp_path / "dist"
        dist.mkdir()
        jar = dist / "gw.jar"
        jar.write_bytes(b"PK\x03\x04")
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        run = bin_dir / "run.sh"
        run.write_text("#!/bin/sh\n")

        # And a session artefact so there's something to remove
        (gw.root_dir / "auth.cookie").write_text("c")

        gw.clear_session_files()

        assert conf.exists()
        assert conf.read_text() == "listenPort: 5001\n"
        assert jar.exists()
        assert run.exists()

    def test_missing_root_dir_returns_empty(self, tmp_path):
        # No provisioning — root/ does not exist
        gw = GatewayLifecycle(gateway_home=str(tmp_path / "never_run"))
        assert not gw.root_dir.exists()

        removed = gw.clear_session_files()

        assert removed == []

    def test_nothing_to_clean_returns_empty(self, tmp_path):
        gw = self._mk_gateway(tmp_path)
        # root_dir exists but contains no session artefacts
        (gw.root_dir / "conf.yaml").write_text("listenPort: 5001\n")

        removed = gw.clear_session_files()

        assert removed == []
        assert (gw.root_dir / "conf.yaml").exists()


# ── Route-level tests for /gateway/reset-session and /gateway/factory-reset ──


@pytest.fixture
def client():
    """FastAPI TestClient with lifespan-populated app.state."""
    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c, app


_RUNNING_STATUS = {
    "state": "running",
    "running": True,
    "provisioned": True,
    "error": None,
    "progress": None,
    "gateway_url": "https://localhost:5001",
}


def _dirty_state(ibkr) -> None:
    """Seed IBKRState with values that reset() should clear."""
    ibkr.state.authenticated = True
    ibkr.state.session_dropped = True
    ibkr.state.tickle_fail_count = 5
    ibkr.state.ws_connected = True
    ibkr.state.accounts_fetched = True
    ibkr.state.accounts = ["U123"]


def _assert_state_cleared(ibkr) -> None:
    """Assert IBKRState.reset() ran: all disconnect/auth fields are clean."""
    assert ibkr.state.authenticated is False
    assert ibkr.state.session_dropped is False
    assert ibkr.state.tickle_fail_count == 0
    assert ibkr.state.ws_connected is False
    assert ibkr.state.accounts_fetched is False
    assert ibkr.state.accounts == []


class TestResetSessionRoute:
    """POST /gateway/reset-session → R2-full restart without touching files."""

    def test_orchestrates_stop_then_start(self, client):
        c, app = client
        gw = app.state.gateway
        ibkr = app.state.ibkr
        _dirty_state(ibkr)

        with (
            patch.object(ibkr, "_stop_tickle", new=AsyncMock()) as mock_stop_tickle,
            patch.object(ibkr, "stop_ibkr_websocket", new=AsyncMock()) as mock_stop_ws,
            patch.object(gw, "stop", new=AsyncMock()) as mock_stop,
            patch.object(gw, "start", new=AsyncMock()) as mock_start,
            patch.object(gw, "status", return_value=dict(_RUNNING_STATUS)),
            # clear_session_files MUST NOT be called on reset-session
            patch.object(gw, "clear_session_files") as mock_clear,
        ):
            resp = c.post("/gateway/reset-session")

        assert resp.status_code == 200
        body = resp.json()
        assert body["reset"] == "session"
        # No files_removed key on session reset
        assert "files_removed" not in body

        mock_stop_tickle.assert_awaited_once()
        mock_stop_ws.assert_awaited_once()
        mock_stop.assert_awaited_once()
        mock_start.assert_awaited_once()
        mock_clear.assert_not_called()
        _assert_state_cleared(ibkr)

    def test_enriched_status_fields_present(self, client):
        c, app = client
        gw = app.state.gateway
        ibkr = app.state.ibkr

        with (
            patch.object(ibkr, "_stop_tickle", new=AsyncMock()),
            patch.object(ibkr, "stop_ibkr_websocket", new=AsyncMock()),
            patch.object(gw, "stop", new=AsyncMock()),
            patch.object(gw, "start", new=AsyncMock()),
            patch.object(gw, "status", return_value=dict(_RUNNING_STATUS)),
        ):
            resp = c.post("/gateway/reset-session")

        body = resp.json()
        # _enrich_status defaults
        assert body["authenticated"] is False
        assert body["auth_required"] is True  # running + not authenticated
        assert body["auth_message"] == ""


class TestFactoryResetRoute:
    """POST /gateway/factory-reset → R3-surgical: reset + wipe session files."""

    def test_calls_clear_session_files(self, client):
        c, app = client
        gw = app.state.gateway
        ibkr = app.state.ibkr
        _dirty_state(ibkr)

        fake_removed = ["/fake/root/logs", "/fake/root/Jts", "/fake/root/auth.cookie"]

        with (
            patch.object(ibkr, "_stop_tickle", new=AsyncMock()) as mock_stop_tickle,
            patch.object(ibkr, "stop_ibkr_websocket", new=AsyncMock()) as mock_stop_ws,
            patch.object(gw, "stop", new=AsyncMock()) as mock_stop,
            patch.object(gw, "start", new=AsyncMock()) as mock_start,
            patch.object(gw, "clear_session_files", return_value=fake_removed) as mock_clear,
            patch.object(gw, "status", return_value=dict(_RUNNING_STATUS)),
        ):
            resp = c.post("/gateway/factory-reset")

        assert resp.status_code == 200
        body = resp.json()
        assert body["reset"] == "factory"
        assert body["files_removed"] == fake_removed

        mock_stop_tickle.assert_awaited_once()
        mock_stop_ws.assert_awaited_once()
        mock_stop.assert_awaited_once()
        mock_clear.assert_called_once()
        mock_start.assert_awaited_once()
        _assert_state_cleared(ibkr)

    def test_clear_happens_between_stop_and_start(self, client):
        """
        Ordering guard: clear_session_files() must run AFTER stop() (so no
        process is holding file handles) and BEFORE start() (so the gateway
        boots against a clean state).
        """
        c, app = client
        gw = app.state.gateway
        ibkr = app.state.ibkr

        call_order: list[str] = []

        async def fake_stop():
            call_order.append("stop")

        async def fake_start():
            call_order.append("start")

        def fake_clear():
            call_order.append("clear")
            return []

        with (
            patch.object(ibkr, "_stop_tickle", new=AsyncMock()),
            patch.object(ibkr, "stop_ibkr_websocket", new=AsyncMock()),
            patch.object(gw, "stop", new=AsyncMock(side_effect=fake_stop)),
            patch.object(gw, "start", new=AsyncMock(side_effect=fake_start)),
            patch.object(gw, "clear_session_files", side_effect=fake_clear),
            patch.object(gw, "status", return_value=dict(_RUNNING_STATUS)),
        ):
            resp = c.post("/gateway/factory-reset")

        assert resp.status_code == 200
        assert call_order == ["stop", "clear", "start"]
