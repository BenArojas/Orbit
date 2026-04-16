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
import re
import shutil
import signal
import socket
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

def _default_conf_yaml(port: int) -> str:
    """
    Build the default conf.yaml content for the given port.

    Mirrors the MoonMarket configuration that's known to work end-to-end
    (proper 302 redirect after 2FA instead of a 200-back-to-login loop).
    Kept intentionally minimal — every extra property the IBKR Gateway
    doesn't recognise causes a hard crash on startup.

    Called at write-time (not import-time) so tests that monkeypatch
    IBKR_GATEWAY_PORT always get the correct value in brand-new conf files.
    """
    return f"""\
# Parallax-managed IBKR Client Portal Gateway configuration.
# Auto-generated on every start — do not edit manually.

# We're running locally, no need to restrict based on IP location
ip2loc: false

# Listen on this port for API requests
listenPort: {port}
listenSsl: true

# Default values for the self-signed certificate provided by IBKR
sslCert: "vertx.jks"
sslPwd: "mywebapi"

# Required properties (empty/default) to prevent startup errors
proxyRemoteHost: "https://api.ibkr.com"
svcEnvironment: "v1"
portalBaseURL: ""

# Allow API requests from any IP — the Gateway only listens on localhost.
ips:
  allow:
    - "*"
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
        # IBKR Gateway zip extracts flat — no wrapper dir.
        # Layout: ~/.parallax/gateway/{bin,build,dist,doc,root}/
        self.root_dir = self.home / "root"
        self.conf_path = self.root_dir / "conf.yaml"
        # Gateway stdout/stderr land here instead of a PIPE.
        # PIPE buffers (~64 KB) fill quickly with Java logs, causing Gateway
        # to block on write and never become healthy.  A log file has no limit.
        self.log_path = self.home / "gateway.log"
        self.state: GatewayState = GatewayState.NOT_PROVISIONED
        self.error_message: str = ""
        self.progress = ProvisionProgress()
        self._process: Optional[subprocess.Popen] = None
        # process-group id — set to the child's pgid on POSIX so we can
        # kill the entire Java process tree on stop(), not just the shell.
        self._process_pgid: Optional[int] = None
        self._http: httpx.AsyncClient = httpx.AsyncClient(
            verify=False,  # Gateway uses self-signed cert
            timeout=httpx.Timeout(10.0, connect=5.0),
        )

    # ── Detection ──────────────────────────────────────────────

    def _find_java_binary(self) -> Optional[Path]:
        """
        Find the java binary inside our managed JRE.

        Adoptium tar.gz layout differs by platform:
          - Linux:   jdk-17.0.x+y-jre/bin/java
          - macOS:   jdk-17.0.x+y-jre/Contents/Home/bin/java  (Apple bundle)
          - Windows: jdk-17.0.x+y-jre/bin/java.exe
        """
        if not self.jre_dir.exists():
            return None

        java_name = "java.exe" if platform.system() == "Windows" else "java"

        for child in self.jre_dir.iterdir():
            if not child.is_dir() or not child.name.startswith("jdk-"):
                continue

            # Candidate paths in priority order
            candidates = [
                child / "bin" / java_name,                      # Linux / Windows
                child / "Contents" / "Home" / "bin" / java_name, # macOS bundle
            ]
            for path in candidates:
                if path.is_file():
                    return path

        return None

    def _find_gateway_jar(self) -> Optional[Path]:
        """
        Find the Gateway runnable jar.

        IBKR Gateway zip extracts flat into GATEWAY_HOME:
          ~/.parallax/gateway/dist/*.jar   ← jar lives here
          ~/.parallax/gateway/root/        ← conf.yaml, run.sh live here
          ~/.parallax/gateway/jre/         ← our managed JRE
        """
        dist = self.home / "dist"
        if dist.exists():
            jars = list(dist.glob("*.jar"))
            if jars:
                return jars[0]
        return None

    def _find_run_script(self) -> Optional[Path]:
        """Return the correct run script based on the operating system."""
        # Windows MUST use run.bat; macOS/Linux use run.sh
        if platform.system() == "Windows":
            script = self.home / "bin" / "run.bat"
        else:
            script = self.home / "bin" / "run.sh"
        return script if script.is_file() else None

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

        Uses a browser User-Agent — some CDNs (including IBKR's) block
        automated requests without one.
        """
        self.progress.step = step_name
        self.progress.bytes_downloaded = 0
        self.progress.bytes_total = 0

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "*/*",
        }

        log.info("Downloading %s from %s", step_name, url)
        buf = io.BytesIO()

        try:
            async with self._http.stream(
                "GET", url, follow_redirects=True, headers=headers
            ) as resp:
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
        manual_zip = self.home / "clientportal.gw.zip"

        if jar and not force:
            log.info("Gateway already provisioned at %s", jar)
        else:
            self.state = GatewayState.DOWNLOADING_GW
            try:
                if manual_zip.exists() and not force:
                    # User manually placed the zip — skip download
                    log.info("Using manually placed Gateway zip at %s", manual_zip)
                    gw_data = manual_zip.read_bytes()
                else:
                    try:
                        gw_data = await self._download_file(
                            GATEWAY_ZIP_URL,
                            "IBKR Client Portal Gateway",
                        )
                    except GatewayProvisionError as e:
                        raise GatewayProvisionError(
                            f"{e.message}. "
                            f"You can manually download {GATEWAY_ZIP_URL} and save it as "
                            f"{manual_zip} , then click Set Up Gateway again."
                        ) from e

                # Clear old gateway dirs if re-provisioning.
                # Preserve jre/ — that's our managed JRE, not part of the Gateway zip.
                _GW_DIRS = ("bin", "build", "dist", "doc", "root")
                for d in _GW_DIRS:
                    target = self.home / d
                    if target.exists():
                        shutil.rmtree(target)
                # Gateway zip extracts a top-level "clientportal.gw" folder
                # We extract to self.home so it becomes self.home/clientportal.gw/
                self._extract_zip(gw_data, self.home)

                jar = self._find_gateway_jar()
                if not jar:
                    raise GatewayProvisionError("Gateway extracted but jar not found")
                log.info("Gateway extracted to %s", jar)

                # Clean up manual zip after successful extraction
                if manual_zip.exists():
                    manual_zip.unlink()

            except GatewayProvisionError:
                self.state = GatewayState.ERROR
                raise

        # Step 3: conf.yaml — always overwrite after a fresh extraction.
        # The IBKR zip ships its own root/conf.yaml with broken defaults
        # (ip2loc: "US", restrictive ips.allow) that cause login resets.
        # User edits are preserved on subsequent starts via _ensure_conf_yaml().
        self.reset_conf_yaml()

        self.state = GatewayState.PROVISIONED
        self.progress.step = "done"
        log.info("Gateway provisioning complete")

    def reset_conf_yaml(self) -> Path:
        """
        Overwrite conf.yaml with the current defaults regardless of what's on disk.

        Use this to recover from a broken or stale config (e.g. leftover ip2loc
        restriction, wrong ips.allow list, missing svcEnvironment) without
        requiring the user to manually delete the file.

        Returns the path of the written file.
        """
        self.root_dir.mkdir(parents=True, exist_ok=True)
        conf_file = self.root_dir / "conf.yaml"
        conf_file.write_text(_default_conf_yaml(IBKR_GATEWAY_PORT))
        log.info("Reset conf.yaml to defaults at %s", conf_file)
        return conf_file

    # ── Process lifecycle ──────────────────────────────────────

    async def _is_gateway_healthy(self) -> bool:
        """
        Check if the Gateway servlet is responding.

        Uses POST /iserver/auth/status — the correct HTTP method for this
        endpoint.  Any non-connection-error response means the Gateway is up:
          - 200 → authenticated
          - 401 → up but session not authenticated yet
          - 500 → Gateway internal error (still up, Java is running)
        A ConnectError / timeout means the port is dark.
        """
        try:
            url = f"https://{IBKR_GATEWAY_HOST}:{IBKR_GATEWAY_PORT}/v1/api/iserver/auth/status"
            resp = await self._http.post(
                url,
                timeout=httpx.Timeout(1.0, connect=0.25),
            )
            return resp.status_code in (200, 401, 500)
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    def _kill_process_group(self) -> None:
        """
        Kill the Gateway process and all its children (e.g. the Java JVM).

        On POSIX we stored the process-group id at launch (start_new_session=True
        ensures the shell and the Java child share a pgid).  Sending SIGTERM to
        the group terminates everything; SIGKILL follows if they don't exit.

        On Windows we use taskkill /T /F to forcibly kill the process tree.
        """
        if not self._process:
            return

        if platform.system() == "Windows":
            try:
                subprocess.run(
                    ["taskkill", "/T", "/F", "/PID", str(self._process.pid)],
                    capture_output=True,
                )
            except OSError as e:
                log.warning("taskkill failed: %s", e)
        else:
            pgid = self._process_pgid or self._process.pid
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(pgid, sig)
                except ProcessLookupError:
                    break  # already gone
                except OSError as e:
                    log.warning("killpg(%d, %s): %s", pgid, sig, e)
                    break

        # Reap the process entry so it doesn't become a zombie
        try:
            self._process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass  # SIGKILL was sent — OS will clean up

        self._process = None
        self._process_pgid = None

    def _is_port_in_use(self, host: str, port: int) -> bool:
        """Return True if something else is already listening on the target port."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            return sock.connect_ex((host, port)) == 0

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

        # Keep the Gateway config aligned with current app settings even when
        # the install already exists from a previous run.
        self.reset_conf_yaml()

        java = self._find_java_binary()
        if not java:
            raise GatewayStartError("Cannot find java binary in managed JRE")

        if self._is_port_in_use(IBKR_GATEWAY_HOST, IBKR_GATEWAY_PORT):
            self.state = GatewayState.ERROR
            self.error_message = (
                f"Port {IBKR_GATEWAY_PORT} is already in use on {IBKR_GATEWAY_HOST}. "
                "Another app is blocking the IBKR Gateway."
            )
            raise GatewayStartError(self.error_message)

        # Use IBKR's own run.sh / run.bat — it sets the correct classpath.
        # The jar is NOT a fat jar and cannot be launched with java -jar directly.
        run_script = self._find_run_script()
        if not run_script:
            raise GatewayStartError(
                "Cannot find Gateway run script (bin/run.sh or bin/run.bat)"
            )

        self.state = GatewayState.STARTING
        self.error_message = ""

        # Point JAVA_HOME at our managed JRE so run.sh uses it.
        # The script checks JAVA_HOME before falling back to PATH.
        java_home = java.parent.parent  # bin/java → parent → Contents/Home or jdk-*/
        # macOS bundle: .../jdk-17-jre/Contents/Home/bin/java → JAVA_HOME = .../jdk-17-jre/Contents/Home
        # Linux/Windows: .../jdk-17-jre/bin/java → JAVA_HOME = .../jdk-17-jre
        env = os.environ.copy()
        env["JAVA_HOME"] = str(java_home)

        # Rotate the log file so each start is clean and debuggable.
        self.home.mkdir(parents=True, exist_ok=True)
        log_file = open(self.log_path, "w", buffering=1)  # noqa: WPS515

        try:
            log.info(
                "Starting Gateway via %s (JAVA_HOME=%s, log=%s)",
                run_script, java_home, self.log_path,
            )
            # run.sh requires the conf.yaml path as its only argument.
            # It must be relative to cwd (self.home), so just "root/conf.yaml".
            conf_arg = str(Path("root") / "conf.yaml")
            cmd = (
                ["cmd", "/c", str(run_script), conf_arg]
                if platform.system() == "Windows"
                else ["/bin/sh", str(run_script), conf_arg]
            )

            # ── A1: process-group isolation ─────────────────────────────
            # run.sh forks Java as a child.  Without a separate process group,
            # terminate() kills the shell but leaves Java running as a zombie.
            # start_new_session=True calls setsid() so the entire group
            # (shell + Java + any GC threads) can be signalled together.
            kwargs: dict = dict(
                cwd=str(self.home),
                # ── A2: log file instead of PIPE ────────────────────────
                # PIPE buffers (~64 KB) fill quickly with Java output and
                # block the Gateway process, preventing it from becoming healthy.
                stdout=log_file,
                stderr=log_file,
                env=env,
            )
            if platform.system() != "Windows":
                kwargs["start_new_session"] = True  # POSIX: new session/pgid
            else:
                kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

            self._process = subprocess.Popen(cmd, **kwargs)
            self._process_pgid = (
                os.getpgid(self._process.pid)
                if platform.system() != "Windows"
                else None
            )
        except OSError as e:
            log_file.close()
            self.state = GatewayState.ERROR
            self.error_message = f"Failed to launch Gateway: {e}"
            raise GatewayStartError(self.error_message) from e

        # Wait for Gateway to become healthy (up to 45 seconds — it's Java)
        for attempt in range(45):
            await asyncio.sleep(1)

            if self._process.poll() is not None:
                # Read the last 1000 chars of the log for a useful error snippet
                try:
                    log_tail = self.log_path.read_text()[-1000:]
                except OSError:
                    log_tail = "unavailable"
                self.state = GatewayState.ERROR
                self.error_message = (
                    f"Gateway process exited unexpectedly. "
                    f"Check {self.log_path} for details. Tail: {log_tail[-300:]}"
                )
                raise GatewayStartError(self.error_message)

            if await self._is_gateway_healthy():
                self.state = GatewayState.RUNNING
                log.info("Gateway healthy after %ds", attempt + 1)
                # E1: warm-up request — IBKR's servlet is slow on the very
                # first request after JVM startup (JIT, class loading).
                # Fire one background GET on the root so the user's browser
                # gets a fast response when they click "Open IBKR Login".
                asyncio.ensure_future(self._warmup_gateway())
                return

        # Timeout — kill the whole process group so Java doesn't linger
        self._kill_process_group()
        self.state = GatewayState.ERROR
        self.error_message = (
            f"Gateway did not become healthy within 45 seconds. "
            f"Check {self.log_path} for details."
        )
        raise GatewayStartError(self.error_message)

    async def _warmup_gateway(self) -> None:
        """
        Fire a background request to the Gateway root page to warm up the JVM.

        IBKR's servlet is cold on first access after startup — JIT compilation
        and class loading add 5-10 s to the first page load.  Hitting the root
        now means the user gets a fast response when they click "Open IBKR Login".
        """
        try:
            url = f"https://{IBKR_GATEWAY_HOST}:{IBKR_GATEWAY_PORT}/"
            await self._http.get(
                url,
                timeout=httpx.Timeout(15.0, connect=5.0),
                follow_redirects=True,
            )
            log.info("Gateway warm-up request complete")
        except Exception as e:  # noqa: BLE001
            log.debug("Gateway warm-up request failed (non-fatal): %s", e)

    async def stop(self) -> None:
        """
        Stop the Gateway and its entire Java process tree.

        Uses _kill_process_group() so the JVM child (spawned by run.sh)
        is also terminated — not just the shell wrapper.
        """
        if not self._process or self._process.poll() is not None:
            log.info("No managed Gateway process to stop")
            if self.is_provisioned():
                self.state = GatewayState.PROVISIONED
            return

        self.state = GatewayState.STOPPING
        log.info("Stopping Gateway process group (pid=%d)...", self._process.pid)
        # _kill_process_group handles SIGTERM→SIGKILL escalation and reaping
        self._kill_process_group()
        log.info("Gateway stopped")
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

        Bug C: if we think we're RUNNING but the managed subprocess has died
        (user killed java in Activity Monitor, OOM, crash, etc.), detect it
        here and transition back to PROVISIONED so the UI reflects reality
        on the very next poll. Without this the state would stay RUNNING
        until something else tried to talk to the gateway and failed.
        """
        # Reconcile state with the actual process before reporting
        if (
            self.state == GatewayState.RUNNING
            and self._process is not None
            and self._process.poll() is not None
        ):
            exit_code = self._process.returncode
            log.warning(
                "Gateway process exited unexpectedly (code=%s) — "
                "transitioning RUNNING → PROVISIONED",
                exit_code,
            )
            self._process = None
            self._process_pgid = None
            self.state = GatewayState.PROVISIONED

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
