"""
Parallax backend — PyInstaller entry point.

This script is used ONLY when the backend is bundled as a standalone
executable by PyInstaller. It sets up the user-data directory for SQLite
and starts the FastAPI server via uvicorn.

Do NOT use this for development. Use instead:
    cd backend && uv run uvicorn main:app --reload --port 8000
"""

import os
from pathlib import Path


def _ensure_data_dir() -> Path:
    """Return ~/.parallax/, creating it if it doesn't exist."""
    data_dir = Path.home() / ".parallax"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


if __name__ == "__main__":
    import uvicorn

    # Point SQLite at ~/.parallax/ so the database persists across app
    # reinstalls and is never buried inside PyInstaller's temp extraction dir.
    data_dir = _ensure_data_dir()
    os.environ.setdefault("SQLITE_DB_PATH", str(data_dir / "parallax.db"))

    # Tauri webview uses tauri://localhost as the request origin in production.
    os.environ.setdefault("FRONTEND_ORIGIN", "tauri://localhost")

    # Must import AFTER env vars are set so config.py picks them up.
    from main import app  # noqa: E402

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
        # Single worker required — backend uses in-process singletons
        # (IBKRService, GatewayService, scanner asyncio task).
        workers=1,
    )
