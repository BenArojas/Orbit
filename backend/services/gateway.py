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
import psutil

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
        # PID file — survives the backend process so the next launch can
        # detect orphaned Java JVMs left behind by a hard kill (terminal
        # closed, OS crash, uvicorn --reload watcher dropping signals).
        # Without this we'd see "port 5001 in use" forever and the only
        # recovery would be Factory Reset.
        self.pid_path = self.home / "gateway.pid"
        self.state: GatewayState = GatewayState.NOT_PROVISIONED
        self.error_message: str = ""
        self.progress = ProvisionProgress()
        self._process: Optional[subprocess.Popen] = None
        # process-group id — set to the child's pgid on POSIX so we can
        # kill the entire Java process tree on stop(), not just the shell.
        # Also populated when we adopt an orphan from a previous run; in
        # that case `_process` stays None (Popen can't adopt) but pgid
        # alone is enough to terminate the JVM via os.killpg.
        self._process_pgid: Optional[int] = None
        # Adopted PID — set when we recover an orphan from a previous run.
        # Mutually exclusive with _process: if we spawned the JVM ourselves,
        # we have a Popen handle; if we adopted it, we have only a pid.
        self._adopted_pid: Optional[int] = None
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

    # ── PID file + orphan recovery ─────────────────────────────
    #
    # Why: in dev mode (uvicorn --reload + 2 terminals), `Ctrl+C` runs
    # lifespan shutdown reliably, but **closing the terminal window**
    # sends SIGHUP only to the foreground process group.  Java is in a
    # separate POSIX session (start_new_session=True) so it survives,
    # ending up reparented to launchd/init as a zombie holding port 5001.
    #
    # Without recovery the next launch sees "port already in use" and the
    # user's only recourse is Factory Reset (re-download or wipe).
    # The pid file lets us detect "this Java is mine, not a foreign tool"
    # and decide: adopt-and-keep, kill-and-respawn, or leave-alone.

    def _is_managed_gateway_process(self, pid: int) -> bool:
        """
        Return True iff `pid` belongs to a process that looks like our Gateway.

        Defence-in-depth: refuse to send signals to anything we can't positively
        identify as ours.  Without this a stale or PID-recycled entry could
        lead us to kill an unrelated process (the user's editor, an IDE, etc).

        The fingerprint is the absolute path to our gateway home directory —
        it appears in cmdline both during the brief shell phase
        (`/bin/sh /home/.parallax/gateway/bin/run.sh ...`) and after run.sh
        execs Java (`java -classpath /home/.parallax/gateway/dist/*.jar ...`).
        We deliberately don't accept the `ibgroup.web.core` class name alone,
        because a Docker-hosted Gateway running outside our home directory
        would match it but isn't ours to manage.
        """
        try:
            proc = psutil.Process(pid)
            cmdline = " ".join(proc.cmdline())
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            return False

        if not cmdline:
            return False

        return str(self.home) in cmdline

    def _write_pid_file(self, pid: int, pgid: Optional[int]) -> None:
        """Persist the spawned process's pid (+ pgid on POSIX) to disk."""
        try:
            self.home.mkdir(parents=True, exist_ok=True)
            content = f"pid={pid}\n"
            if pgid is not None:
                content += f"pgid={pgid}\n"
            self.pid_path.write_text(content)
        except OSError as e:
            log.warning("Failed to write pid file %s: %s", self.pid_path, e)

    def _read_pid_file(self) -> tuple[Optional[int], Optional[int]]:
        """
        Return (pid, pgid) recorded in the pid file, or (None, None)
        if the file is missing or unreadable.
        """
        if not self.pid_path.exists():
            return (None, None)
        try:
            text = self.pid_path.read_text()
        except OSError as e:
            log.warning("Failed to read pid file %s: %s", self.pid_path, e)
            return (None, None)

        pid: Optional[int] = None
        pgid: Optional[int] = None
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("pid="):
                try:
                    pid = int(line.split("=", 1)[1])
                except ValueError:
                    pass
            elif line.startswith("pgid="):
                try:
                    pgid = int(line.split("=", 1)[1])
                except ValueError:
                    pass
        return (pid, pgid)

    def _clear_pid_file(self) -> None:
        """Best-effort delete of the pid file. Safe to call when missing."""
        try:
            self.pid_path.unlink(missing_ok=True)
        except OSError as e:
            log.debug("Failed to remove pid file %s: %s", self.pid_path, e)

    def _scan_for_orphan_gateway(self) -> Optional[int]:
        """
        System-wide scan for an orphaned Gateway process.

        Used as a fallback when the pid file is missing or stale (PID died
        or got recycled) but the user reports port 5001 in use — meaning a
        Java process is still bound somewhere we don't know about.

        Returns the first pid whose cmdline matches our fingerprint, or
        None if nothing relevant is running.
        """
        try:
            for proc in psutil.process_iter(["pid", "cmdline"]):
                try:
                    cmdline = " ".join(proc.info.get("cmdline") or [])
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
                if not cmdline:
                    continue
                if str(self.home) in cmdline:
                    return proc.info["pid"]
        except psutil.Error as e:
            log.debug("psutil.process_iter failed during orphan scan: %s", e)
        return None

    async def _recover_existing_process(self) -> bool:
        """
        Try to adopt a Gateway process left running from a previous launch.

        Returns True if an orphan was found and adopted (state set to RUNNING,
        no spawn needed). Returns False if there's nothing to adopt — the
        caller should proceed to a fresh `start()`.

        The pid file is the primary source. As a fallback we walk the process
        list looking for an `ibgroup.web.core` cmdline (covers the case where
        the shell exited and Java got reparented under a different pid that
        we never recorded).
        """
        pid, pgid = self._read_pid_file()

        if pid is not None and self._is_managed_gateway_process(pid):
            log.info("Found managed Gateway at pid=%s — verifying health", pid)
        else:
            # PID file missing, stale, or pointing at something that isn't us.
            # Clear the bad file before scanning so we don't trip over it twice.
            self._clear_pid_file()
            scanned_pid = self._scan_for_orphan_gateway()
            if scanned_pid is None:
                return False
            log.info(
                "Discovered orphan Gateway via cmdline scan at pid=%s", scanned_pid,
            )
            pid = scanned_pid
            try:
                pgid = (
                    os.getpgid(pid) if platform.system() != "Windows" else None
                )
            except (ProcessLookupError, OSError):
                return False

        # Confirm the orphan is actually responding before declaring victory.
        if not await self._is_gateway_healthy():
            log.warning(
                "Orphan pid=%s exists but port %s isn't responding — abandoning recovery",
                pid, IBKR_GATEWAY_PORT,
            )
            return False

        # Adopt: track pid + pgid so stop()/status() can manage it like a
        # process we spawned ourselves, but leave _process as None (we have
        # no Popen handle for a process we didn't start).
        self._adopted_pid = pid
        self._process_pgid = pgid
        self._process = None
        self.state = GatewayState.RUNNING
        # Refresh the pid file with the verified pgid so subsequent recoveries
        # find a clean record even if the original was scanned-not-read.
        self._write_pid_file(pid, pgid)
        log.info(
            "Adopted existing Gateway (pid=%s, pgid=%s) — skipping spawn", pid, pgid,
        )
        return True

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

        Handles two cases:
          1. We spawned the JVM ourselves → `self._process` is a Popen.
             We have a child pid + pgid and can `wait()` on the handle.
          2. We adopted an orphan from a previous run → `self._process` is
             None, but `self._adopted_pid` and `self._process_pgid` are set.
             We still know enough to signal it; we just can't `wait()`.

        On POSIX we stored the process-group id at launch (start_new_session=True
        ensures the shell and the Java child share a pgid).  Sending SIGTERM to
        the group terminates everything; SIGKILL follows if they don't exit.

        On Windows we use taskkill /T /F to forcibly kill the process tree.
        """
        target_pid: Optional[int] = (
            self._process.pid if self._process else self._adopted_pid
        )
        if target_pid is None:
            # Nothing to kill — neither spawned nor adopted.
            self._clear_pid_file()
            return

        if platform.system() == "Windows":
            try:
                subprocess.run(
                    ["taskkill", "/T", "/F", "/PID", str(target_pid)],
                    capture_output=True,
                )
            except OSError as e:
                log.warning("taskkill failed: %s", e)
        else:
            pgid = self._process_pgid or target_pid
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(pgid, sig)
                except ProcessLookupError:
                    break  # already gone
                except OSError as e:
                    log.warning("killpg(%d, %s): %s", pgid, sig, e)
                    break

        # Reap our spawned process so it doesn't become a zombie.
        # Adopted orphans were already reparented to init/launchd at
        # the OS level, so the OS reaps them — we just wait for them
        # to actually exit before clearing local state.
        if self._process is not None:
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass  # SIGKILL was sent — OS will clean up
        elif target_pid is not None:
            # Best-effort poll: wait up to 5 s for the adopted pid to die.
            for _ in range(50):
                try:
                    if not psutil.pid_exists(target_pid):
                        break
                except psutil.Error:
                    break
                # busy-wait in 100 ms slices — total ≤ 5 s
                # (no async context here; this is intentionally synchronous
                # so callers can rely on the process being gone on return)
                import time as _time  # local import keeps top of file clean
                _time.sleep(0.1)

        self._process = None
        self._process_pgid = None
        self._adopted_pid = None
        self._clear_pid_file()

    def _is_port_in_use(self, host: str, port: int) -> bool:
        """Return True if something else is already listening on the target port."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            return sock.connect_ex((host, port)) == 0

    async def start(self) -> None:
        """
        Start the Gateway process.

        Order of operations:
          1. If we already think a process is alive (Popen handle, adopted pid,
             or a healthy responder on the port) — short-circuit.
          2. Try to adopt an orphan from a previous run via the pid file
             (and a system-wide cmdline scan as fallback).
          3. Otherwise: provisioning check, port check, spawn run.sh.
        """
        # Already running under our control?
        if (self._process and self._process.poll() is None) or self._adopted_pid:
            log.info("Gateway already managed by this process")
            return

        # Already running externally?  Could be Docker, a manual launch, or
        # an orphan we haven't adopted yet.  If so, try to adopt it so we
        # can manage it (kill cleanly on shutdown, surface "Restart Gateway"
        # in the UI, etc).  Adoption is best-effort — if it fails we still
        # report RUNNING because the user can use the gateway either way.
        if await self._is_gateway_healthy():
            log.info("Gateway already responding on port %s", IBKR_GATEWAY_PORT)
            adopted = await self._recover_existing_process()
            if not adopted:
                # External (Docker, manual) — we don't own its lifecycle.
                self.state = GatewayState.RUNNING
            return

        # Nothing on the port — but maybe a stale pid file points at a dead
        # process.  Clear it before we try to spawn so we don't carry it
        # forward into the new run.
        self._clear_pid_file()

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
            # Persist the pid so the next launch can recover this process
            # if our backend exits without running shutdown (terminal closed,
            # uvicorn --reload watcher missed signal, OS crash, etc).
            self._write_pid_file(self._process.pid, self._process_pgid)
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

    async def logout(self) -> dict:
        """
        Soft session reset — POST to the Gateway's /v1/api/logout endpoint.

        Drops the IBKR-side session without touching the JVM.  This is the
        cheapest of the three recovery levels: takes ~1 s vs ~10 s for a
        Java restart, and keeps the user from waiting for cold-start JIT
        on every wedged-session recovery.

        Returns the IBKR response shape `{"status": bool}` on success, or
        raises GatewayStartError if the gateway isn't reachable. The caller
        is responsible for resetting any IBKR-side state (tickle loop,
        websocket, ibkr.state) — this method is intentionally narrow.
        """
        url = f"https://{IBKR_GATEWAY_HOST}:{IBKR_GATEWAY_PORT}/v1/api/logout"
        try:
            resp = await self._http.post(
                url,
                json={},
                timeout=httpx.Timeout(10.0, connect=2.0),
            )
        except httpx.ConnectError as e:
            raise GatewayStartError(
                f"Cannot reach Gateway at {IBKR_GATEWAY_HOST}:{IBKR_GATEWAY_PORT}: {e}"
            ) from e
        except httpx.TimeoutException as e:
            raise GatewayStartError(
                f"Gateway logout timed out: {e}"
            ) from e

        # IBKR's /logout returns 200 with {"status": true} on success.
        # 401 is technically possible if no session existed in the first place;
        # treat that as a no-op success since the user is, in fact, logged out.
        if resp.status_code in (200, 401):
            try:
                data = resp.json()
            except ValueError:
                data = {"status": True}
            log.info("Gateway logout succeeded: %s", data)
            return data

        raise GatewayStartError(
            f"Gateway logout failed: HTTP {resp.status_code} {resp.text[:200]}"
        )

    async def stop(self) -> None:
        """
        Stop the Gateway and its entire Java process tree.

        Handles three states:
          1. We spawned the JVM and the Popen handle is alive → kill via pgid.
          2. We adopted an orphan from a previous run (`_adopted_pid` is set)
             → kill via pgid (or pid on Windows).
          3. Nothing is managed → no-op, just demote state.

        Always clears the pid file on exit so a future launch starts clean.
        """
        spawned_alive = (
            self._process is not None and self._process.poll() is None
        )
        adopted_alive = (
            self._adopted_pid is not None
            and psutil.pid_exists(self._adopted_pid)
        )

        if not spawned_alive and not adopted_alive:
            log.info("No managed Gateway process to stop")
            self._clear_pid_file()
            self._process = None
            self._process_pgid = None
            self._adopted_pid = None
            if self.is_provisioned():
                self.state = GatewayState.PROVISIONED
            return

        self.state = GatewayState.STOPPING
        target_pid = (
            self._process.pid if spawned_alive else self._adopted_pid
        )
        log.info("Stopping Gateway process group (pid=%s)...", target_pid)
        # _kill_process_group handles SIGTERM→SIGKILL escalation, reaping,
        # and pid-file cleanup for both spawned and adopted cases.
        self._kill_process_group()
        log.info("Gateway stopped")
        self.state = GatewayState.PROVISIONED

    # ── Factory reset helpers ───────────────────────────────────
    #
    # A "factory reset" nukes the IBKR Gateway's on-disk session state while
    # preserving the managed JRE and the Gateway binaries (so we don't have
    # to re-download ~100 MB on every reset).
    #
    # What we delete (surgical):
    #   - root/logs/         → Jetty + gateway server logs
    #   - root/Jts/          → IBKR Trader Workstation session dir (if present)
    #   - root/*.cookie      → any cookie files the gateway persisted
    #   - root/*.session     → any session artefacts
    #
    # What we KEEP:
    #   - jre/                 (our managed JRE — reprovision-only territory)
    #   - bin/, build/, dist/, doc/  (IBKR binaries)
    #   - root/conf.yaml       (our generated config — gateway needs it to start)
    #   - root/webapps/, root/etc/  (jetty config/webapps that ship in the zip)
    #
    # If the surgical cleanup proves insufficient in the field, the fallback
    # is /gateway/reprovision which nukes and redownloads everything.

    def clear_session_files(self) -> list[str]:
        """
        Delete IBKR session state files from root/ without touching binaries
        or conf.yaml. Safe to call while the gateway process is stopped.

        Returns a list of absolute paths that were actually removed — useful
        for logging and for tests to assert against.
        """
        removed: list[str] = []

        if not self.root_dir.exists():
            log.info("clear_session_files: root_dir missing — nothing to clean")
            return removed

        # Known session-state subdirs
        for subdir in ("logs", "Jts"):
            target = self.root_dir / subdir
            if target.exists() and target.is_dir():
                try:
                    shutil.rmtree(target)
                    removed.append(str(target))
                    log.info("clear_session_files: removed dir %s", target)
                except OSError as exc:
                    log.warning(
                        "clear_session_files: failed to remove %s: %s",
                        target, exc,
                    )

        # Cookie/session files at the top level of root/
        for pattern in ("*.cookie", "*.session"):
            for path in self.root_dir.glob(pattern):
                try:
                    path.unlink()
                    removed.append(str(path))
                    log.info("clear_session_files: removed file %s", path)
                except OSError as exc:
                    log.warning(
                        "clear_session_files: failed to remove %s: %s",
                        path, exc,
                    )

        # Process stdout/stderr log — not session state, but users expect a
        # factory reset to clear stale log output too. Safe to remove — the
        # next start() will recreate it.
        if self.log_path.exists():
            try:
                self.log_path.unlink()
                removed.append(str(self.log_path))
                log.info("clear_session_files: removed log %s", self.log_path)
            except OSError as exc:
                log.warning(
                    "clear_session_files: failed to remove %s: %s",
                    self.log_path, exc,
                )

        return removed

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
        # Reconcile state with the actual process before reporting.
        # Two ways the JVM can die under our nose:
        #   1. We spawned it (Popen) and it exited — `_process.poll()` is set.
        #   2. We adopted an orphan and the OS reaped it — `psutil.pid_exists`
        #      goes False.
        # In either case demote the state so the UI reflects reality on the
        # very next /gateway/status poll, without waiting for a downstream
        # IBKR call to fail.
        spawned_dead = (
            self._process is not None and self._process.poll() is not None
        )
        adopted_dead = (
            self._adopted_pid is not None
            and not psutil.pid_exists(self._adopted_pid)
        )
        if self.state == GatewayState.RUNNING and (spawned_dead or adopted_dead):
            if spawned_dead:
                log.warning(
                    "Gateway process exited unexpectedly (code=%s) — "
                    "transitioning RUNNING → PROVISIONED",
                    self._process.returncode if self._process else None,
                )
            else:
                log.warning(
                    "Adopted Gateway pid=%s no longer exists — "
                    "transitioning RUNNING → PROVISIONED",
                    self._adopted_pid,
                )
            self._process = None
            self._process_pgid = None
            self._adopted_pid = None
            self._clear_pid_file()
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
