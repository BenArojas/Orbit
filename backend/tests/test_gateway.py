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
    _DEFAULT_CONF_YAML,
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


def _make_fake_gateway(gw_dir: Path) -> None:
    """Create a fake Gateway directory structure that _find_gateway_jar() will find."""
    dist_dir = gw_dir / "root" / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    jar = dist_dir / "ibgroup.web.core.iblink.router.clientportal.gw.jar"
    jar.write_bytes(b"PK\x03\x04fake jar")


def _make_fake_zip(inner_dir_name: str = "clientportal.gw") -> bytes:
    """Create a zip archive containing a fake directory structure."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            f"{inner_dir_name}/root/dist/ibgroup.web.core.iblink.router.clientportal.gw.jar",
            b"PK\x03\x04fake jar",
        )
        zf.writestr(f"{inner_dir_name}/root/conf.yaml", "listenPort: 5000\n")
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
        _make_fake_gateway(gw.gw_dir)
        assert gw.is_provisioned()

    def test_only_jre_not_provisioned(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        assert not gw.is_provisioned()

    def test_only_gateway_not_provisioned(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_gateway(gw.gw_dir)
        assert not gw.is_provisioned()

    def test_provisioned_with_macos_bundle_layout(self, tmp_path):
        """macOS JREs use Contents/Home/bin/java — ensure detection works."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir, macos_bundle=True)
        _make_fake_gateway(gw.gw_dir)
        assert gw.is_provisioned()
        java = gw._find_java_binary()
        assert java is not None
        assert "Contents" in str(java)


# ── GatewayLifecycle — conf.yaml ───────────────────────────────


class TestConfYaml:
    """Tests for conf.yaml generation."""

    def test_creates_conf_when_missing(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        root_dir = gw.gw_dir / "root"
        root_dir.mkdir(parents=True)
        gw._ensure_conf_yaml()
        conf = root_dir / "conf.yaml"
        assert conf.exists()
        content = conf.read_text()
        assert "listenPort: 5000" in content

    def test_preserves_existing_conf(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        root_dir = gw.gw_dir / "root"
        root_dir.mkdir(parents=True)
        conf = root_dir / "conf.yaml"
        conf.write_text("custom: config\n")
        gw._ensure_conf_yaml()
        assert conf.read_text() == "custom: config\n"


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
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        with pytest.raises(GatewayNotProvisionedError):
            await gw.start()

    @pytest.mark.asyncio
    async def test_start_detects_external_gateway(self, tmp_path):
        """If Gateway is already running (Docker/manual), just report RUNNING."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        gw._http = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        gw._http.get = AsyncMock(return_value=mock_resp)

        await gw.start()
        assert gw.state == GatewayState.RUNNING

    @pytest.mark.asyncio
    async def test_stop_no_process_is_noop(self, tmp_path):
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.gw_dir)
        await gw.stop()
        assert gw.state == GatewayState.PROVISIONED


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
        _make_fake_gateway(gw.gw_dir)
        await gw.startup(auto_start=False)
        assert gw.state == GatewayState.PROVISIONED

    @pytest.mark.asyncio
    async def test_startup_provisioned_autostart_fails_gracefully(self, tmp_path):
        """auto_start=True should not crash if start fails."""
        gw = GatewayLifecycle(gateway_home=str(tmp_path))
        _make_fake_jre(gw.jre_dir)
        _make_fake_gateway(gw.gw_dir)
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
        _make_fake_gateway(gw.gw_dir)
        # conf.yaml dir must exist for _ensure_conf_yaml
        (gw.gw_dir / "root").mkdir(parents=True, exist_ok=True)

        await gw.provision(force=False)
        assert gw.state == GatewayState.PROVISIONED

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
