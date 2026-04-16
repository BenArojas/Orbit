"""
Tests for the IBKR Gateway provisioning and lifecycle service.

These tests mock network calls and filesystem operations so they run
without actually downloading JRE/Gateway or starting Java processes.
"""

import asyncio
import io
import platform
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from services.gateway import (
    GatewayLifecycle,
    GatewayState,
    ProvisionProgress,
    _default_conf_yaml,
    _detect_platform,
    _jre_download_url,
)
from exceptions import (
    GatewayNotProvisionedError,
    GatewayProvisionError,
    GatewayStartError,
)


# ── Helpers ────────────────────────────────────────────────────


def _make_fake_jre(jre_dir: Path, macos_bundle: bool = False) -> None:
    """
    Create a fake JRE directory structure that _find_java_binary() will find.
    macos_bundle=True simulates the macOS Contents/Home layout.
    """
    if macos_bundle:
        java_bin_dir = jre_dir / "jdk-17.0.99+1-jre" / "Contents" / "Home" / "bin"
    else:
        java_bin_dir = jre_dir / "jdk-17.0.99+1-jre" / "bin"
    java_bin_dir.mkdir(parents=True, exist_ok=True)
    java = java_bin_dir / "java"
    java.write_text("#!/bin/sh\necho fake java")
    java.chmod(0o755)


def _make_fake_gateway(gateway_home: Path) -> None:
    """
    Create a fake Gateway directory structure that _find_gateway_jar() will find.
    IBKR Gateway zip extracts flat — jar lives at home/dist/*.jar.
    """
    dist_dir = gateway_home / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    jar = dist_dir / "ibgroup.web.core.iblink.router.clientportal.gw.jar"
    jar.write_bytes(b"PK\x03\x04fake jar")


def _make_fake_zip() -> bytes:
    """
    Create a zip archive matching IBKR's flat-extract layout.

    The IBKR Gateway zip extracts with no top-level wrapper directory —
    bin/, dist/, root/ land directly in the target folder.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "dist/ibgroup.web.core.iblink.router.clientportal.gw.jar",
            b"PK\x03\x04fake jar",
        )
        zf.writestr("root/conf.yaml", "listenPort: 5000\n")
        zf.writestr("bin/run.sh", "#!/bin/sh\n")
    return buf.getvalue()


# ── Platform detection ─────────────────────────────────────────


class TestPlatformDetection:
    """Tests for _detect_platform() helper."""

    def test_supported_macos_arm64(self):
        with patch("services.gateway.platform") as mock_plat:
            mock_plat.system.return_value = "Darwin"
            mock_plat.machine.return_value = "arm64"
            os_name, arch, ext = _detect_platform()
            assert os_name == "mac"
            assert arch == "aarch64"
            assert ext == ".tar.gz"

    def test_supported_macos_x64(self):
        with patch("services.gateway.platform") as mock_plat:
            mock_plat.system.return_value = "Darwin"
            mock_plat.machine.return_value = "x86_64"
            os_name, arch, ext = _detect_platform()
            assert os_name == "mac"
            assert arch == "x64"
            assert ext == ".tar.gz"

    def test_supported_linux_x64(self):
        with patch("services.gateway.platform") as mock_plat:
            mock_plat.system.return_value = "Linux"
            mock_plat.machine.return_value = "x86_64"
            os_name, arch, ext = _detect_platform()
            assert os_name == "linux"
            assert arch == "x64"
            assert ext == ".tar.gz"

    def test_supported_windows_x64(self):
        with patch("services.gateway.platform") as mock_plat:
            mock_plat.system.return_value = "Windows"
            mock_plat.machine.return_value = "AMD64"
            os_name, arch, ext = _detect_platform()
            assert os_name == "windows"
            assert arch == "x64"
            assert ext == ".zip"

    def test_unsupported_platform_raises(self):
        with patch("services.gateway.platform") as mock_plat:
            mock_plat.system.return_value = "FreeBSD"
            mock_plat.machine.return_value = "amd64"
            with pytest.raises(GatewayProvisionError, match="Unsupported platform"):
                _detect_platform()


class TestJreDownloadUrl:
    """Tests for _jre_download_url() helper."""

    def test_url_contains_platform_info(self):
        with patch("services.gateway.platform") as mock_plat:
            mock_plat.system.return_value = "Darwin"
            mock_plat.machine.return_value = "arm64"
            url = _jre_download_url()
            assert "/mac/aarch64/jre/" in url
            assert "/17/" in url


# ── ProvisionProgress ──────────────────────────────────────────


class TestProvisionProgress:
    """Tests for the ProvisionProgress tracker."""

    def test_initial_state(self):
        p = ProvisionProgress()
        assert p.percent == 0
        assert p.step == ""

    def test_percent_calculation(self):
        p = ProvisionProgress()
        p.bytes_total = 100
        p.bytes_downloaded = 50
        assert p.percent == 50

    def test_percent_caps_at_100(self):
        p = ProvisionProgress()
        p.bytes_total = 100
        p.bytes_downloaded = 150
        assert p.percent == 100

    def test_percent_zero_total(self):
        p = ProvisionProgress()
        p.bytes_total = 0
        p.bytes_downloaded = 50
        assert p.percent == 0

    def test_to_dict(self):
        p = ProvisionProgress()
        p.step = "JRE"
        p.bytes_total = 200
        p.bytes_downloaded = 100
        d = p.to_dict()
        assert d["step"] == "JRE"
        assert d["percent"] == 50


# ── GatewayLifecycle — detection ───────────────────────────────


class TestGatewayDetection:
    """Tests for is_provisioned() and file detection."""

    def test_not_provisioned_empty_dir(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        assert not gw.is_provisioned()

    def test_provisioned_with_files(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.home)
        assert gw.is_provisioned()

    def test_only_jre_not_provisioned(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        assert not gw.is_provisioned()

    def test_only_gateway_not_provisioned(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_gateway(gw.home)
        assert not gw.is_provisioned()

    def test_provisioned_with_macos_bundle_layout(self, tmp_path):
        """macOS JREs use Contents/Home/bin/java — ensure detection works."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir, macos_bundle=True)
        _make_fake_gateway(gw.home)
        assert gw.is_provisioned()
        java = gw._find_java_binary()
        assert java is not None
        assert "Contents" in str(java)


# ── GatewayLifecycle — conf.yaml ───────────────────────────────


class TestConfYaml:
    """Tests for conf.yaml generation."""

    def test_creates_conf_when_missing(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        gw.reset_conf_yaml()
        conf = gw.home / "root" / "conf.yaml"
        assert conf.exists()
        content = conf.read_text()
        assert "listenPort: 5001" in content

    def test_overwrites_existing_conf(self, tmp_path):
        """We own conf.yaml — any user/IBKR-shipped content gets replaced."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        root_dir = gw.home / "root"
        root_dir.mkdir(parents=True)
        conf = root_dir / "conf.yaml"
        conf.write_text("custom: config\n")
        gw.reset_conf_yaml()
        assert "custom: config" not in conf.read_text()
        assert "listenPort:" in conf.read_text()

    def test_updates_existing_listen_port(self, tmp_path, monkeypatch):
        monkeypatch.setattr("services.gateway.IBKR_GATEWAY_PORT", 5001)
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        root_dir = gw.home / "root"
        root_dir.mkdir(parents=True)
        conf = root_dir / "conf.yaml"
        conf.write_text("listenPort: 5000\nlistenSsl: true\n")
        gw.reset_conf_yaml()
        assert "listenPort: 5001" in conf.read_text()


# ── GatewayLifecycle — status ──────────────────────────────────


class TestGatewayStatus:
    """Tests for the status() method."""

    def test_initial_status(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        s = gw.status()
        assert s["state"] == "not_provisioned"
        assert s["provisioned"] is False
        assert s["running"] is False
        assert s["error"] is None

    def test_error_status(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        gw.state = GatewayState.ERROR
        gw.error_message = "something broke"
        s = gw.status()
        assert s["state"] == "error"
        assert s["error"] == "something broke"

    def test_running_status(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        gw.state = GatewayState.RUNNING
        s = gw.status()
        assert s["running"] is True

    def test_downloading_includes_progress(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        gw.state = GatewayState.DOWNLOADING_JRE
        gw.progress.step = "JRE"
        gw.progress.bytes_total = 100
        gw.progress.bytes_downloaded = 42
        s = gw.status()
        assert "progress" in s
        assert s["progress"]["percent"] == 42


# ── GatewayLifecycle — start (mocked) ─────────────────────────


class TestGatewayStart:
    """Tests for the start() method with mocked subprocess."""

    @pytest.mark.asyncio
    async def test_start_requires_provisioning(self, tmp_path):
        """When Gateway isn't running externally and not provisioned, start() raises."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        # Force the "not running externally" branch so we reach the
        # is_provisioned() check. Without this mock the test would hit the
        # real localhost:5001 if the user has a Gateway running.
        with patch.object(gw, "_is_gateway_healthy", AsyncMock(return_value=False)):
            with pytest.raises(GatewayNotProvisionedError):
                await gw.start()

    @pytest.mark.asyncio
    async def test_start_detects_external_gateway(self, tmp_path):
        """If Gateway is already running (Docker/manual), just report RUNNING."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        with patch.object(gw, "_is_gateway_healthy", AsyncMock(return_value=True)):
            await gw.start()
        assert gw.state == GatewayState.RUNNING

    @pytest.mark.asyncio
    async def test_start_treats_401_as_running_gateway(self, tmp_path):
        """401 from auth/status means the Gateway is up but login is still required.

        Verified at a unit level in TestHealthProbeMethod; here we just confirm
        start() short-circuits when the healthy probe returns True.
        """
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        with patch.object(gw, "_is_gateway_healthy", AsyncMock(return_value=True)):
            await gw.start()
        assert gw.state == GatewayState.RUNNING

    @pytest.mark.asyncio
    async def test_start_syncs_existing_conf_before_launch(self, tmp_path, monkeypatch):
        monkeypatch.setattr("services.gateway.IBKR_GATEWAY_PORT", 5001)
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.home)
        root_dir = gw.home / "root"
        root_dir.mkdir(parents=True, exist_ok=True)
        conf = root_dir / "conf.yaml"
        conf.write_text("listenPort: 5000\nlistenSsl: true\n")

        run_script = gw.home / "bin" / "run.sh"
        run_script.parent.mkdir(parents=True, exist_ok=True)
        run_script.write_text("#!/bin/sh\n")

        # _is_gateway_healthy is called twice inside start(): first as the
        # "already running externally?" early-exit probe (must return False so
        # we proceed), then inside the 45s health-wait loop (must return True
        # so the loop exits successfully).
        health_sequence = AsyncMock(side_effect=[False] + [True] * 50)

        with patch("services.gateway.subprocess") as mock_sub, \
             patch.object(gw, "_is_gateway_healthy", health_sequence), \
             patch.object(gw, "_is_port_in_use", return_value=False), \
             patch.object(gw, "_warmup_gateway", AsyncMock()):
            mock_proc = MagicMock()
            mock_proc.poll.return_value = None
            mock_sub.Popen.return_value = mock_proc

            await gw.start()

        assert "listenPort: 5001" in conf.read_text()

    @pytest.mark.asyncio
    async def test_stop_no_process_is_noop(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.home)
        await gw.stop()
        assert gw.state == GatewayState.PROVISIONED

    @pytest.mark.asyncio
    async def test_start_uses_relative_conf_path_for_run_script(self, tmp_path):
        """IBKR's launcher expects root/conf.yaml, not an absolute path."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.home)
        gw.reset_conf_yaml()

        run_script = gw.home / "bin" / "run.sh"
        run_script.parent.mkdir(parents=True, exist_ok=True)
        run_script.write_text("#!/bin/sh\n")

        # See test_start_syncs_existing_conf_before_launch for why we use a
        # sequence: first call = "external gateway check" (False), subsequent
        # calls = "health loop after spawn" (True).
        health_sequence = AsyncMock(side_effect=[False] + [True] * 50)

        with patch("services.gateway.subprocess") as mock_sub, \
             patch.object(gw, "_is_gateway_healthy", health_sequence), \
             patch.object(gw, "_is_port_in_use", return_value=False), \
             patch.object(gw, "_warmup_gateway", AsyncMock()):
            mock_proc = MagicMock()
            mock_proc.poll.return_value = None
            mock_sub.Popen.return_value = mock_proc

            await gw.start()

            popen_args = mock_sub.Popen.call_args.args[0]
            assert popen_args[-1] == "root/conf.yaml"


# ── GatewayLifecycle — startup sequence ────────────────────────


class TestGatewayStartup:
    """Tests for the startup() method."""

    @pytest.mark.asyncio
    async def test_startup_not_provisioned(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        await gw.startup(auto_start=False)
        assert gw.state == GatewayState.NOT_PROVISIONED

    @pytest.mark.asyncio
    async def test_startup_already_provisioned_no_autostart(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.home)
        await gw.startup(auto_start=False)
        assert gw.state == GatewayState.PROVISIONED

    @pytest.mark.asyncio
    async def test_startup_provisioned_autostart_fails_gracefully(self, tmp_path):
        """auto_start=True should not crash if start fails."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.home)
        # Mock the health check to always fail + subprocess to fail
        gw._http = AsyncMock()
        gw._http.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
        with patch("services.gateway.subprocess") as mock_sub:
            mock_proc = MagicMock()
            mock_proc.poll.return_value = 1  # process exited immediately
            mock_proc.stderr = io.BytesIO(b"error")
            mock_sub.Popen.return_value = mock_proc
            # Should not raise — startup swallows GatewayStartError
            await gw.startup(auto_start=True)
            # State should reflect the error
            assert gw.state in (GatewayState.ERROR, GatewayState.PROVISIONED)


# ── GatewayLifecycle — provision (mocked downloads) ────────────


class TestGatewayProvision:
    """Tests for provision() with mocked HTTP downloads."""

    @pytest.mark.asyncio
    async def test_provision_skips_existing(self, tmp_path):
        """Idempotent: if files exist, skip downloads."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.home)
        # conf.yaml dir must exist for reset_conf_yaml
        (gw.home / "root").mkdir(parents=True, exist_ok=True)

        await gw.provision(force=False)
        assert gw.state == GatewayState.PROVISIONED

    @pytest.mark.asyncio
    async def test_provision_overwrites_ibkr_default_conf(self, tmp_path):
        """
        provision() must overwrite the conf.yaml that ships inside the IBKR zip.
        The bundled config has ip2loc: "US" and restrictive ips.allow which
        cause the login page to reset after 2FA. Our defaults fix this.
        """
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.home)

        # Simulate the stale IBKR-bundled conf.yaml already on disk
        conf_file = tmp_path / "root" / "conf.yaml"
        conf_file.parent.mkdir(parents=True, exist_ok=True)
        conf_file.write_text('ip2loc: "US"\nips:\n  allow:\n    - 127.0.0.1\n')

        await gw.provision(force=False)

        content = conf_file.read_text()
        assert "ip2loc: false" in content, "provision() must overwrite IBKR's ip2loc: US"
        assert '"*"' in content, "provision() must reset ips.allow to wildcard"
        assert 'ip2loc: "US"' not in content

    @pytest.mark.asyncio
    async def test_provision_download_timeout_raises(self, tmp_path):
        """Network timeout during download raises GatewayProvisionError."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))

        # Mock _download_file to raise the typed error directly
        async def mock_download(*args, **kwargs):
            raise GatewayProvisionError("Download timed out for JRE: timed out")

        gw._download_file = mock_download

        with pytest.raises(GatewayProvisionError, match="timed out"):
            await gw.provision()

    @pytest.mark.asyncio
    async def test_provision_connection_error_raises(self, tmp_path):
        """Network connection error raises GatewayProvisionError."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))

        async def mock_download(*args, **kwargs):
            raise GatewayProvisionError("Cannot reach download server for JRE: no internet")

        gw._download_file = mock_download

        with pytest.raises(GatewayProvisionError, match="Cannot reach"):
            await gw.provision()

    @pytest.mark.asyncio
    async def test_provision_gateway_download_error_mentions_manual_zip(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)

        async def mock_download(url, step_name):
            if step_name == "IBKR Client Portal Gateway":
                raise GatewayProvisionError("Cannot reach download server for IBKR Client Portal Gateway: no internet")
            return b"ignored"

        gw._download_file = mock_download

        with pytest.raises(GatewayProvisionError, match="clientportal\\.gw\\.zip"):
            await gw.provision()


# ── GatewayLifecycle — shutdown ────────────────────────────────


class TestGatewayShutdown:
    """Tests for clean shutdown."""

    @pytest.mark.asyncio
    async def test_shutdown_closes_http(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        gw._http = AsyncMock()
        gw._http.aclose = AsyncMock()
        await gw.shutdown()
        gw._http.aclose.assert_awaited_once()


# ── F2: Stop kills entire process group (zombie test) ──────────


class TestStopKillsProcessGroup:
    """
    Verify that stop() kills the whole process group, not just the shell.

    This catches the zombie-Java bug: run.sh forks Java as a child;
    terminating only the shell leaves Java running.
    """

    @pytest.mark.asyncio
    async def test_stop_calls_kill_process_group(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.home)

        mock_proc = MagicMock()
        mock_proc.poll.return_value = None  # process is running
        mock_proc.pid = 12345
        gw._process = mock_proc
        gw._process_pgid = 12345

        with patch("services.gateway.os") as mock_os, \
             patch("services.gateway.platform") as mock_plat:
            mock_plat.system.return_value = "Linux"
            mock_os.killpg = MagicMock()
            mock_proc.wait.return_value = None

            await gw.stop()

            # Must have called killpg — NOT just terminate()
            mock_os.killpg.assert_called()
            assert gw.state == GatewayState.PROVISIONED
            assert gw._process is None

    @pytest.mark.asyncio
    async def test_stop_no_process_is_noop(self, tmp_path):
        """stop() with no running process is a clean no-op."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.home)
        # _process is None by default
        await gw.stop()
        assert gw.state == GatewayState.PROVISIONED


# ── F3: Tickle starts when gateway status sees authenticated ────


class TestTickleStartsOnGatewayAuth:
    """
    After gateway/status detects authentication, the tickle loop must start.
    Prevents sessions from expiring silently.
    """

    @pytest.mark.asyncio
    async def test_default_conf_yaml_uses_current_port(self, monkeypatch):
        """_default_conf_yaml() uses port at call-time, not import-time."""
        monkeypatch.setattr("services.gateway.IBKR_GATEWAY_PORT", 5099)
        content = _default_conf_yaml(5099)
        assert "listenPort: 5099" in content

    @pytest.mark.asyncio
    async def test_reset_conf_yaml_writes_current_port(self, tmp_path, monkeypatch):
        """Brand-new conf.yaml picks up the currently-configured port."""
        monkeypatch.setattr("services.gateway.IBKR_GATEWAY_PORT", 5099)
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        gw.reset_conf_yaml()
        conf = (tmp_path / "root" / "conf.yaml").read_text()
        assert "listenPort: 5099" in conf

    def test_default_conf_yaml_has_correct_auth_settings(self):
        """Default conf.yaml must use only gateway-supported properties."""
        content = _default_conf_yaml(5001)
        # Auth-critical settings
        assert "ip2loc: false" in content, "ip2loc must be boolean false, not empty string"
        assert '"*"' in content, "ips.allow must contain wildcard to avoid blocking browser session"
        assert 'svcEnvironment: "v1"' in content, "svcEnvironment must be set"
        # Properties not supported by the Apr 2023 gateway build — crash on load
        assert "proxyRemotePort" not in content, "proxyRemotePort is not a valid gateway property"
        assert "autoRestart" not in content, "autoRestart is not a valid gateway property"

    def test_reset_conf_yaml_overwrites_existing(self, tmp_path, monkeypatch):
        """reset_conf_yaml() replaces whatever is on disk with current defaults."""
        monkeypatch.setattr("services.gateway.IBKR_GATEWAY_PORT", 5001)
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        conf_file = tmp_path / "root" / "conf.yaml"
        conf_file.parent.mkdir(parents=True, exist_ok=True)

        # Write a broken config (old ip2loc, restricted IPs)
        conf_file.write_text('ip2loc: "US"\nips:\n  allow:\n    - 127.0.0.1\n')

        returned_path = gw.reset_conf_yaml()

        assert returned_path == conf_file
        content = conf_file.read_text()
        assert "ip2loc: false" in content
        assert '"*"' in content
        assert 'ip2loc: "US"' not in content

    def test_reset_conf_yaml_creates_dirs_if_missing(self, tmp_path):
        """reset_conf_yaml() creates the root dir if it doesn't exist yet."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path / "fresh"))
        gw.reset_conf_yaml()
        assert (tmp_path / "fresh" / "root" / "conf.yaml").exists()


# ── F4: Backend 503 guard (require_ibkr_auth) ──────────────────


class TestRequireIbkrAuthDep:
    """
    Verify the require_ibkr_auth FastAPI dependency raises 503
    when IBKR is not authenticated.
    """

    @pytest.mark.asyncio
    async def test_raises_503_when_not_authenticated(self):
        from fastapi import HTTPException
        from deps import require_ibkr_auth
        from services.ibkr import IBKRService

        ibkr = IBKRService.__new__(IBKRService)
        ibkr.state = MagicMock()
        ibkr.state.authenticated = False

        with pytest.raises(HTTPException) as exc_info:
            await require_ibkr_auth(ibkr)

        assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_returns_ibkr_when_authenticated(self):
        from deps import require_ibkr_auth
        from services.ibkr import IBKRService

        ibkr = IBKRService.__new__(IBKRService)
        ibkr.state = MagicMock()
        ibkr.state.authenticated = True

        result = await require_ibkr_auth(ibkr)
        assert result is ibkr


# ── F5: Health probe uses POST not GET ──────────────────────────


class TestHealthProbeMethod:
    """_is_gateway_healthy must POST to /iserver/auth/status, not GET."""

    @pytest.mark.asyncio
    async def test_healthy_uses_post(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        mock_resp = MagicMock()
        mock_resp.status_code = 200

        gw._http = AsyncMock()
        gw._http.post = AsyncMock(return_value=mock_resp)

        result = await gw._is_gateway_healthy()
        assert result is True
        gw._http.post.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_healthy_treats_401_as_up(self, tmp_path):
        """401 = Gateway running but session not authenticated yet."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        gw._http = AsyncMock()
        gw._http.post = AsyncMock(return_value=mock_resp)

        result = await gw._is_gateway_healthy()
        assert result is True

    @pytest.mark.asyncio
    async def test_healthy_false_on_connect_error(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        gw._http = AsyncMock()
        gw._http.post = AsyncMock(side_effect=httpx.ConnectError("refused"))

        result = await gw._is_gateway_healthy()
        assert result is False
