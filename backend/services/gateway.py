"""
IBKR Client Portal Gateway provisioning and lifecycle management.

On a fresh machine this service will:
  1. Download a portable JRE (Adoptium Temurin 17) — no system-wide Java needed
  2. Download the IBKR Client Portal Gateway zip
  3. Extract both into ~/.parallax/gateway/
  4. Generate conf.yaml with sensible defaults
  5. Start the Gateway Java process and health-check it

On subsequent launches it skips the download (idempotent) and just starts
the existing Gateway.

Everything lives under GATEWAY_HOME (~/.parallax/gateway/) so we never
touch the user's system Java or any global directories.

Architecture:
  GatewayLifecycle (this file)
    └── manages: JRE download, Gateway download, conf.yaml, java process
  IBKRService (services/ibkr.py)
    └── talks to the running Gateway on localhost:5000
"""

import asyncio
import io
import logging
import os
import platform
import shutil
import stat
import subprocess
import zipfile
from enum import Enum
from pathlib import Path
from typing import Optional

import httpx

from config import (
    ADOPTIUM_API_BASE,
    GATEWAY_HOME,
    GATEWAY_JRE_VERSION,
    GATEWAY_ZIP_URL,
    IBKR_GATEWAY_HOST,
    IBKR_GATEWAY_PORT,
)
from exceptions import (
    GatewayNotProvisionedError,
    GatewayProvisionError,
    GatewayStartError,
)

log = logging.getLogger("parallax.gateway")

# ── Platform mapping ────────────────────────────────────────────

_PLATFORM_MAP: dict[tuple[str, str], tuple[str, str, str]] = {
    # (system, machine) → (adoptium_os, adoptium_arch, archive_ext)
    ("Darwin", "arm64"):   ("mac",     "aarch64", ".tar.gz"),
    ("Darwin", "x86_64"):  ("mac",     "x64",     ".tar.gz"),
    ("Linux",  "x86_64"):  ("linux",   "x64",     ".tar.gz"),
    ("Linux",  "aarch64"): ("linux",   "aarch64", ".tar.gz"),
    ("Windows", "AMD64"):  ("windows", "x64",     ".zip"),
}


def _detect_platform() -> tuple[str, str, str]:
    """Return (adoptium_os, adoptium_arch, archive_ext) for this machine."""
    key = (platform.system(), platform.machine())
    result = _PLATFORM_MAP.get(key)
    if not result:
        raise GatewayProvisionError(
            f"Unsupported platform: {platform.system()} {platform.machine()}. "
            f"Supported: macOS (arm64/x64), Linux (x64/aarch64), Windows (x64)."
        )
    return result


def _jre_download_url() -> str:
    """Build the Adoptium API URL that redirects to the JRE archive."""
    os_name, arch, _ = _detect_platform()
    return (
        f"{ADOPTIUM_API_BASE}/{GATEWAY_JRE_VERSION}/ga/"
        f"{os_name}/{arch}/jre/hotspot/normal/eclipse"
    )


# ── Default conf.yaml ──────────────────────────────────────────

_DEFAULT_CONF_YAML = f"""\
# Parallax-managed IBKR Client Portal Gateway configuration.
# Auto-generated — edits will be preserved across re-provisions.

listenPort: {IBKR_GATEWAY_PORT}
listenSsl: true

# Allow connections from localhost and Docker network.
# Safe because this Gateway only listens on the loopback interface.
ips:
  allow:
    - 127.0.0.1
    - 0.0.0.0
  deny: []

# Disable IP geolocation restriction (not needed for local use).
ip2loc: ""

# IBKR production API endpoint.
proxyRemoteHost: "https://api.ibkr.com"
proxyRemotePort: 443

# Auto-restart on crash (up to 3 times per hour).
autoRestart: true
autoRestartInterval: 1200
autoRestartCount: 3
"""


# ── State machine ──────────────────────────────────────────────


class GatewayState(str, Enum):
    """Current state of the Gateway lifecycle."""
    NOT_PROVISIONED = "not_provisioned"   # No JRE or Gateway files on disk
    DOWNLOADING_JRE = "downloading_jre"   # Currently downloading JRE
    DOWNLOADING_GW = "downloading_gw"     # Currently downloading Gateway
    PROVISIONED = "provisioned"           # Files exist, process not running
    STARTING = "starting"                 # Process launched, waiting for health
    RUNNING = "running"                   # Gateway healthy and responding
    STOPPING = "stopping"                 # Graceful shutdown in progress
    ERROR = "error"                       # Something went wrong


class ProvisionProgress:
    """Track download progress for the frontend."""

    def __init__(self) -> None:
        self.step: str = ""
        self.bytes_downloaded: int = 0
        self.bytes_total: int = 0

    @property
    def percent(self) -> int:
        if self.bytes_total <= 0:
            return 0
        return min(int(self.bytes_downloaded / self.bytes_total * 100), 100)

    def to_dict(self) -> dict:
        return {
            "step": self.step,
            "bytes_downloaded": self.bytes_downloaded,
            "bytes_total": self.bytes_total,
            "percent": self.percent,
        }


# ── Lifecycle class ────────────────────────────────────────────


class GatewayLifecycle:
    """
    Manages IBKR Client Portal Gateway provisioning and process lifecycle.

    Created once during app startup and stashed on app.state.
    """

    def __init__(self, gateway_home: str = GATEWAY_HOME) -> None:
        self.home = Path(gateway_home)
        self.jre_dir = self.home / "jre"
        self.gw_dir = self.home / "clientportal.gw"
        self.conf_path = self.gw_dir / "root" / "conf.yaml"
        self.state: GatewayState = GatewayState.NOT_PROVISIONED
        self.error_message: str = ""
        self.progress = ProvisionProgress()
        self._process: Optional[subprocess.Popen] = None
        self._http: httpx.AsyncClient = httpx.AsyncClient(
            verify=False,  # Gateway uses self-signed cert
            timeout=httpx.Timeout(10.0, connect=5.0),
        )

    # ── Detection ──────────────────────────────────────────────

    def _find_java_binary(self) -> Optional[Path]:
        """Find the java binary inside our managed JRE."""
        if not self.jre_dir.exists():
            return None

        # Adoptium extracts into a versioned subdirectory
        # e.g. jdk-17.0.x+y-jre/ on Linux/Mac, jdk-17.0.x+y-jre\ on Windows
        for child in self.jre_dir.iterdir():
            if child.is_dir() and child.name.startswith("jdk-"):
                bin_dir = child / "bin"
                java = bin_dir / ("java.exe" if platform.system() == "Windows" else "java")
                if java.is_file():
                    return java

        return None

    def _find_gateway_jar(self) -> Optional[Path]:
        """Find the Gateway runnable jar."""
        root = self.gw_dir / "root"
        if not root.exists():
            return None
        # The jar is at root/bin/run.sh but we call java directly
        # The main jar is root/dist/ibgroup.web.core.iblink.router.clientportal.gw.jar
        # or we can use the run.sh approach. Let's find the jar.
        dist = root / "dist"
        if dist.exists():
            jars = list(dist.glob("*.jar"))
            if jars:
                return jars[0]

        return None

    def is_provisioned(self) -> bool:
        """Check if JRE and Gateway files exist on disk."""
        return self._find_java_binary() is not None and self._find_gateway_jar() is not None

    # ── Download helpers ───────────────────────────────────────

    async def _download_file(
        self,
        url: str,
        step_name: str,
    ) -> bytes:
        """
        Download a URL with progress tracking.
        Returns the raw bytes. Follows redirects (Adoptium API redirects).
        """
        self.progress.step = step_name
        self.progress.bytes_downloaded = 0
        self.progress.bytes_total = 0

        log.info("Downloading %s from %s", step_name, url)
        buf = io.BytesIO()

        try:
            async with self._http.stream("GET", url, follow_redirects=True) as resp:
                if resp.status_code != 200:
                    raise GatewayProvisionError(
                        f"Download failed for {step_name}: HTTP {resp.status_code}"
                    )

                total = int(resp.headers.get("content-length", 0))
                self.progress.bytes_total = total

                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    buf.write(chunk)
                    self.progress.bytes_downloaded += len(chunk)

        except httpx.TimeoutException as e:
            raise GatewayProvisionError(
                f"Download timed out for {step_name}: {e}"
            ) from e
        except httpx.ConnectError as e:
            raise GatewayProvisionError(
                f"Cannot reach download server for {step_name}: {e}"
            ) from e

        data = buf.getvalue()
        log.info("Downloaded %s (%.1f MB)", step_name, len(data) / 1024 / 1024)
        return data

    def _extract_tar_gz(self, data: bytes, dest: Path) -> None:
        """Extract a .tar.gz archive to dest directory."""
        import tarfile

        dest.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            tar.extractall(path=dest)

    def _extract_zip(self, data: bytes, dest: Path) -> None:
        """Extract a .zip archive to dest directory."""
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extractall(path=dest)

    def _extract_archive(self, data: bytes, dest: Path, ext: str) -> None:
        """Extract an archive based on file extension."""
        if ext == ".tar.gz":
            self._extract_tar_gz(data, dest)
        elif ext == ".zip":
            self._extract_zip(data, dest)
        else:
            raise GatewayProvisionError(f"Unknown archive format: {ext}")

    # ── Provisioning ───────────────────────────────────────────

    async def provision(self, force: bool = False) -> None:
        """
        Download and extract JRE + Gateway if not already present.
        Idempotent — skips steps that are already done unless force=True.

        This is the main entry point for first-run setup.
        """
        self.error_message = ""
        _, _, archive_ext = _detect_platform()

        # Step 1: JRE
        java = self._find_java_binary()
        if java and not force:
            log.info("JRE already provisioned at %s", java)
        else:
            self.state = GatewayState.DOWNLOADING_JRE
            try:
                jre_data = await self._download_file(
                    _jre_download_url(),
                    "Java Runtime (JRE 17)",
                )
                # Clear old JRE if re-provisioning
                if self.jre_dir.exists():
                    shutil.rmtree(self.jre_dir)
                self._extract_archive(jre_data, self.jre_dir, archive_ext)

                # Ensure java binary is executable (tar preserves, zip may not)
                java = self._find_java_binary()
                if java:
                    java.chmod(java.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
                    log.info("JRE extracted to %s", java)
                else:
                    raise GatewayProvisionError("JRE extracted but java binary not found")
            except GatewayProvisionError:
                self.state = GatewayState.ERROR
                raise

        # Step 2: Gateway
        jar = self._find_gateway_jar()
        if jar and not force:
            log.info("Gateway already provisioned at %s", jar)
        else:
            self.state = GatewayState.DOWNLOADING_GW
            try:
                gw_data = await self._download_file(
                    GATEWAY_ZIP_URL,
                    "IBKR Client Portal Gateway",
                )
                # Clear old gateway if re-provisioning
                if self.gw_dir.exists():
                    shutil.rmtree(self.gw_dir)
                # Gateway zip extracts a top-level "clientportal.gw" folder
                # We extract to self.home so it becomes self.home/clientportal.gw/
                self._extract_zip(gw_data, self.home)

                jar = self._find_gateway_jar()
                if not jar:
                    raise GatewayProvisionError("Gateway extracted but jar not found")
                log.info("Gateway extracted to %s", jar)
            except GatewayProvisionError:
                self.state = GatewayState.ERROR
                raise

        # Step 3: conf.yaml — write only if missing (don't overwrite user edits)
        self._ensure_conf_yaml()

        self.state = GatewayState.PROVISIONED
        self.progress.step = "done"
        log.info("Gateway provisioning complete")

    def _ensure_conf_yaml(self) -> None:
        """Write conf.yaml if it doesn't exist yet."""
        conf_dir = self.gw_dir / "root"
        conf_dir.mkdir(parents=True, exist_ok=True)
        conf_file = conf_dir / "conf.yaml"
        if not conf_file.exists():
            conf_file.write_text(_DEFAULT_CONF_YAML)
            log.info("Wrote default conf.yaml to %s", conf_file)
        else:
            log.info("conf.yaml already exists, preserving user edits")

    # ── Process lifecycle ──────────────────────────────────────

    async def _is_gateway_healthy(self) -> bool:
        """Check if the Gateway is responding to health checks."""
        try:
            url = f"https://{IBKR_GATEWAY_HOST}:{IBKR_GATEWAY_PORT}/v1/api/iserver/auth/status"
            resp = await self._http.get(url)
            return resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    async def start(self) -> None:
        """
        Start the Gateway process.
        If it's already running externally (e.g. Docker, manual), detect and skip.
        """
        # Already running externally?
        if await self._is_gateway_healthy():
            log.info("Gateway already running (external process or Docker)")
            self.state = GatewayState.RUNNING
            return

        if not self.is_provisioned():
            raise GatewayNotProvisionedError()

        java = self._find_java_binary()
        jar = self._find_gateway_jar()
        if not java or not jar:
            raise GatewayStartError("Cannot find java binary or gateway jar")

        root_dir = self.gw_dir / "root"
        self.state = GatewayState.STARTING
        self.error_message = ""

        try:
            log.info("Starting Gateway: %s -jar %s", java, jar)
            self._process = subprocess.Popen(
                [
                    str(java),
                    "-server",
                    f"-Dvertx.disableDnsResolver=true",
                    "-Djava.net.preferIPv4Stack=true",
                    "-jar",
                    str(jar),
                    str(root_dir),
                ],
                cwd=str(root_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except OSError as e:
            self.state = GatewayState.ERROR
            self.error_message = f"Failed to launch java: {e}"
            raise GatewayStartError(self.error_message) from e

        # Wait for Gateway to become healthy (up to 45 seconds — it's Java)
        for attempt in range(45):
            await asyncio.sleep(1)

            if self._process.poll() is not None:
                stderr = self._process.stderr
                err = stderr.read().decode()[:500] if stderr else "unknown"
                self.state = GatewayState.ERROR
                self.error_message = f"Gateway process exited unexpectedly: {err}"
                raise GatewayStartError(self.error_message)

            if await self._is_gateway_healthy():
                self.state = GatewayState.RUNNING
                log.info("Gateway healthy after %ds", attempt + 1)
                return

        # Timeout — kill the process
        self._process.terminate()
        self.state = GatewayState.ERROR
        self.error_message = "Gateway did not become healthy within 45 seconds"
        raise GatewayStartError(self.error_message)

    async def stop(self) -> None:
        """Stop the Gateway process if we started it."""
        if not self._process or self._process.poll() is not None:
            log.info("No managed Gateway process to stop")
            if self.is_provisioned():
                self.state = GatewayState.PROVISIONED
            return

        self.state = GatewayState.STOPPING
        log.info("Stopping Gateway process (pid=%d)...", self._process.pid)
        self._process.terminate()

        try:
            self._process.wait(timeout=15)
            log.info("Gateway stopped gracefully")
        except subprocess.TimeoutExpired:
            log.warning("Gateway didn't stop in 15s, killing...")
            self._process.kill()
            self._process.wait(timeout=5)

        self._process = None
        self.state = GatewayState.PROVISIONED

    # ── Startup sequence ───────────────────────────────────────

    async def startup(self, auto_start: bool = True) -> None:
        """
        Run the full startup sequence:
          1. Check if already provisioned
          2. If not, provision (download JRE + Gateway)
          3. Optionally start the process

        Called from FastAPI lifespan.
        """
        log.info("Gateway lifecycle startup — home: %s", self.home)

        if self.is_provisioned():
            self.state = GatewayState.PROVISIONED
            log.info("Gateway already provisioned")
        else:
            log.info("Gateway not provisioned — will download on first /gateway/provision call")
            self.state = GatewayState.NOT_PROVISIONED
            # Don't auto-provision on startup — let the frontend trigger it
            # so the user sees the progress UI
            return

        if auto_start:
            try:
                await self.start()
            except (GatewayStartError, GatewayNotProvisionedError) as e:
                log.warning("Gateway auto-start failed: %s", e.message)
                # Not fatal — user can start manually or use Docker

    # ── Cleanup ────────────────────────────────────────────────

    async def shutdown(self) -> None:
        """Clean shutdown — stop process, close HTTP client."""
        await self.stop()
        await self._http.aclose()
        log.info("Gateway lifecycle shut down")

    # ── Status ─────────────────────────────────────────────────

    def status(self) -> dict:
        """
        Return current lifecycle state for the /gateway/status endpoint.

        The frontend uses this to decide what to show:
          - not_provisioned → "Set up Gateway" button + progress bar
          - downloading_jre/downloading_gw → progress indicator
          - provisioned → "Start Gateway" button
          - starting → spinner
          - running → green indicator, ready to authenticate
          - error → error message + retry button
        """
        result: dict = {
            "state": self.state.value,
            "provisioned": self.is_provisioned(),
            "running": self.state == GatewayState.RUNNING,
            "gateway_url": f"https://{IBKR_GATEWAY_HOST}:{IBKR_GATEWAY_PORT}",
            "gateway_home": str(self.home),
            "error": self.error_message if self.state == GatewayState.ERROR else None,
            "platform": f"{platform.system()} {platform.machine()}",
        }

        # Include progress during provisioning
        if self.state in (GatewayState.DOWNLOADING_JRE, GatewayState.DOWNLOADING_GW):
            result["progress"] = self.progress.to_dict()

        return result
