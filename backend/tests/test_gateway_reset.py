from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.gateway import GatewayLifecycle


@pytest.fixture
def client():
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
    ibkr.state.authenticated = True
    ibkr.state.session_dropped = True
    ibkr.state.tickle_fail_count = 5
    ibkr.state.ws_connected = True
    ibkr.state.accounts_fetched = True
    ibkr.state.accounts = ["U123"]


def _assert_state_cleared(ibkr) -> None:
    assert ibkr.state.authenticated is False
    assert ibkr.state.session_dropped is False
    assert ibkr.state.tickle_fail_count == 0
    assert ibkr.state.ws_connected is False
    assert ibkr.state.accounts_fetched is False
    assert ibkr.state.accounts == []


class TestFactoryResetRoute:
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
        """Ordering: clear_session_files() must run AFTER stop() and BEFORE start()."""
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


class TestLogoutRoute:
    def test_calls_logout_method_and_resets_state(self, client):
        c, app = client
        gw = app.state.gateway
        ibkr = app.state.ibkr
        _dirty_state(ibkr)

        with (
            patch.object(ibkr, "_stop_tickle", new=AsyncMock()) as mock_stop_tickle,
            patch.object(ibkr, "stop_ibkr_websocket", new=AsyncMock()) as mock_stop_ws,
            patch.object(
                gw, "logout", new=AsyncMock(return_value={"status": True}),
            ) as mock_logout,
            patch.object(gw, "status", return_value=dict(_RUNNING_STATUS)),
            patch.object(gw, "stop", new=AsyncMock()) as mock_stop,
            patch.object(gw, "start", new=AsyncMock()) as mock_start,
        ):
            resp = c.post("/gateway/logout")

        assert resp.status_code == 200
        body = resp.json()
        assert body["reset"] == "logout"
        assert body["logout_response"] == {"status": True}

        mock_stop_tickle.assert_awaited_once()
        mock_stop_ws.assert_awaited_once()
        mock_logout.assert_awaited_once()
        mock_stop.assert_not_awaited()
        mock_start.assert_not_awaited()
        _assert_state_cleared(ibkr)

    def test_propagates_gateway_unreachable(self, client):
        c, app = client
        gw = app.state.gateway
        ibkr = app.state.ibkr

        from exceptions import GatewayStartError

        with (
            patch.object(ibkr, "_stop_tickle", new=AsyncMock()),
            patch.object(ibkr, "stop_ibkr_websocket", new=AsyncMock()),
            patch.object(
                gw, "logout",
                new=AsyncMock(side_effect=GatewayStartError("connect refused")),
            ),
            patch.object(gw, "status", return_value=dict(_RUNNING_STATUS)),
        ):
            resp = c.post("/gateway/logout")

        assert resp.status_code == 502
        body = resp.json()
        assert body["error"] == "gateway_error"


class TestLogoutMethod:
    @pytest.mark.asyncio
    async def test_treats_401_as_already_logged_out(self, tmp_path):
        from services.gateway import GatewayLifecycle

        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.json.return_value = {}
        gw._http = AsyncMock()
        gw._http.post = AsyncMock(return_value=mock_resp)

        result = await gw.logout()
        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_raises_on_connect_error(self, tmp_path):
        import httpx
        from exceptions import GatewayStartError
        from services.gateway import GatewayLifecycle

        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        gw._http = AsyncMock()
        gw._http.post = AsyncMock(side_effect=httpx.ConnectError("refused"))

        with pytest.raises(GatewayStartError):
            await gw.logout()
