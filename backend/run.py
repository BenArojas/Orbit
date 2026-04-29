"""
Parallax backend — PyInstaller entry point.

This script is used when the backend is bundled as a standalone
executable by PyInstaller (the packaged Tauri app's externalBin).
It sets up the user-data directory for SQLite, installs
signal handlers so the IBKR Gateway is killed even on unusual
exit paths, and starts the FastAPI server via uvicorn.

Do NOT use this for development. Use instead:
    cd backend && ./scripts/dev-backend.sh
which traps signals and cleans up any stale gateway pid before
exec-ing `uv run uvicorn main:app --reload --port 8000`.
"""

import logging
import os
import signal
import sys
from pathlib import Path

log = logging.getLogger("parallax.run")


def _ensure_data_dir() -> Path:
    """Return ~/.parallax/, creating it if it doesn't exist."""
    data_dir = Path.home() / ".parallax"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _install_signal_handlers() -> None:
    """
    Best-effort handlers for signals uvicorn doesn't catch by default.

    Why this exists:
      - uvicorn handles SIGINT and SIGTERM out of the box → graceful shutdown
        runs lifespan → gateway.shutdown() kills the JVM.
      - SIGHUP is sent by macOS/Linux when the controlling terminal closes.
        Python's default action is to *terminate immediately*, so lifespan
        never runs and the JVM is left as an orphan.

    This handler converts SIGHUP into SIGTERM so uvicorn's graceful shutdown
    fires for that case too. Doesn't help against SIGKILL or hard crashes —
    those rely on the next-launch orphan recovery (services/gateway.py).

    Windows has no SIGHUP, so this is a POSIX-only safety net.
    """
    if sys.platform == "win32":
        return

    def _on_sighup(signum: int, frame) -> None:  # noqa: ARG001
        log.info("SIGHUP received — converting to SIGTERM for graceful shutdown")
        os.kill(os.getpid(), signal.SIGTERM)

    try:
        signal.signal(signal.SIGHUP, _on_sighup)
    except (ValueError, OSError) as e:
        # Can happen when run.py is imported from a non-main thread
        # (some test runners do this). Non-fatal — packaged builds always
        # run on the main thread.
        log.debug("Could not install SIGHUP handler: %s", e)


if __name__ == "__main__":
    import uvicorn

    # Point SQLite at ~/.parallax/ so the database persists across app
    # reinstalls and is never buried inside PyInstaller's temp extraction dir.
    data_dir = _ensure_data_dir()
    os.environ.setdefault("SQLITE_DB_PATH", str(data_dir / "parallax.db"))

    # Tauri webview uses tauri://localhost as the request origin in production.
    os.environ.setdefault("FRONTEND_ORIGIN", "tauri://localhost")

    # Catch SIGHUP so the Gateway JVM doesn't outlive a terminal close.
    _install_signal_handlers()

    # Must import AFTER env vars are set so config.py picks them up.
    from config import BACKEND_PORT  # noqa: E402
    from main import app  # noqa: E402

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=BACKEND_PORT,
        log_level="info",
        # Single worker required — backend uses in-process singletons
        # (IBKRService, GatewayService, scanner asyncio task).
        workers=1,
    )
