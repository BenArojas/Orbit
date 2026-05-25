"""
Ollama lifecycle management — detect, start, list models, guide the user.

Philosophy: We NEVER download or install anything for the user.
We detect what's on their machine, start the Ollama server if installed,
list what models they already have, and guide them if something is missing.

The user controls their own machine:
  - They install Ollama themselves (we provide the link)
  - They pull models themselves (we suggest which ones and show the command)
  - They choose which model to use (we list what's available)

This service handles:
  1. Detect if Ollama binary is installed
  2. Start the Ollama server if installed (lightweight — no downloads)
  3. List all locally available models with size and metadata
  4. Report status so the frontend can show appropriate setup guidance
  5. Stop the server cleanly on app shutdown

The Ollama server runs on localhost:11434 and exposes a REST API.
Our AI service (services/ai.py) talks to that API for inference.
"""

import asyncio
import logging
import os
import platform
import shutil
import subprocess
from enum import Enum
from typing import Optional

import httpx

from config import OLLAMA_HOST

log = logging.getLogger("parallax.ollama")


# ── Known Ollama binary locations ──────────────────────────
# Ollama installs itself to different paths depending on platform
# and install method. On macOS, the .app bundle puts the binary
# somewhere PATH doesn't always see.

OLLAMA_BINARY_PATHS: list[str] = [
    "/usr/local/bin/ollama",                                  # Linux installer + macOS Homebrew
    "/usr/bin/ollama",                                         # Some Linux distros
    os.path.expanduser("~/.local/bin/ollama"),                 # Linux user install
    "/Applications/Ollama.app/Contents/Resources/ollama",     # macOS .app bundle
    "/Applications/Ollama.app/Contents/MacOS/ollama",         # macOS alt path
    "C:\\Program Files\\Ollama\\ollama.exe",                   # Windows default
    os.path.expanduser("~/AppData/Local/Programs/Ollama/ollama.exe"),  # Windows user
]


# ── Recommended models table ──────────────────────────────
# Shown to users who don't have any models yet.
# Ordered from lightest to heaviest.

RECOMMENDED_MODELS: list[dict] = [
    {
        "name": "gemma4:e2b",
        "display_name": "Gemma 4 E2B",
        "size_gb": 1.8,
        "min_ram_gb": 4,
        "description": "Ultra-light. Basic analysis capability. For very old or low-end machines.",
        "pull_command": "ollama pull gemma4:e2b",
        "tier": "minimal",
    },
    {
        "name": "gemma4:e4b",
        "display_name": "Gemma 4 E4B",
        "size_gb": 4,
        "min_ram_gb": 8,
        "description": "Lightweight and fast. Good for quick signal checks. Works on most laptops.",
        "pull_command": "ollama pull gemma4:e4b",
        "tier": "light",
    },
    {
        "name": "gemma4:26b",
        "display_name": "Gemma 4 26B (Recommended)",
        "size_gb": 16,
        "min_ram_gb": 16,
        "description": "Best analysis quality. Only 4B params active per request so it's fast despite the size. Ideal for Apple Silicon or 16GB+ machines.",
        "pull_command": "ollama pull gemma4:26b",
        "tier": "recommended",
    },
    {
        "name": "gemma4:31b",
        "display_name": "Gemma 4 31B",
        "size_gb": 20,
        "min_ram_gb": 32,
        "description": "Highest quality. Needs a powerful machine with 32GB+ RAM or a dedicated GPU.",
        "pull_command": "ollama pull gemma4:31b",
        "tier": "heavy",
    },
]


class OllamaState(str, Enum):
    """Current state of the Ollama lifecycle."""
    NOT_INSTALLED = "not_installed"       # Binary not found anywhere
    INSTALLED = "installed"               # Binary found but server not running
    STARTING = "starting"                 # Server process launched, waiting for health
    RUNNING = "running"                   # Server healthy and responding
    NO_MODELS = "no_models"              # Server running but user has no models
    READY = "ready"                       # Server running + user has selected a model
    ERROR = "error"                       # Something went wrong


class OllamaModelInfo:
    """Info about one locally available model."""
    def __init__(self, name: str, size_bytes: int, family: str, parameter_size: str,
                 quantization: str, modified_at: str):
        self.name = name
        self.size_bytes = size_bytes
        self.size_gb = round(size_bytes / (1024 ** 3), 1)
        self.family = family
        self.parameter_size = parameter_size
        self.quantization = quantization
        self.modified_at = modified_at

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "size_bytes": self.size_bytes,
            "size_gb": self.size_gb,
            "family": self.family,
            "parameter_size": self.parameter_size,
            "quantization": self.quantization,
            "modified_at": self.modified_at,
        }


class OllamaLifecycle:
    """
    Manages Ollama detection and server lifecycle. Does NOT install or pull anything.

    Created once during app startup (main.py lifespan) and stashed on app.state.
    The user's selected model is stored in SQLite via the settings table.
    """

    def __init__(self) -> None:
        self.state: OllamaState = OllamaState.NOT_INSTALLED
        self.selected_model: Optional[str] = None  # Set from SQLite settings on startup
        self.error_message: str = ""
        self._server_process: Optional[subprocess.Popen] = None
        self._http: httpx.AsyncClient = httpx.AsyncClient(
            base_url=OLLAMA_HOST,
            timeout=httpx.Timeout(10.0, connect=5.0),
        )

    # ── Detection ───────────────────────────────────────────────

    def _get_binary_path(self) -> Optional[str]:
        """
        Find the ollama binary.

        Checks PATH first (handles user-managed installs), then falls back to
        a list of known install locations for each platform. This covers:
          - macOS .app bundle (not on PATH by default)
          - Linux user installs (~/.local/bin)
          - Windows default install paths
        """
        path_result = shutil.which("ollama")
        if path_result:
            return path_result

        for candidate in OLLAMA_BINARY_PATHS:
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate

        return None

    def is_installed(self) -> bool:
        """Check if the ollama binary exists anywhere on this machine."""
        return self._get_binary_path() is not None

    # ── Server management ───────────────────────────────────────

    async def is_server_running(self) -> bool:
        """Check if the Ollama server is responding."""
        try:
            resp = await self._http.get("/api/tags")
            return resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    async def start_server(self) -> bool:
        """
        Start the Ollama server if it isn't already running.

        If the user has the Ollama desktop app or it's running as a
        system service, we detect that and skip starting our own process.
        """
        if await self.is_server_running():
            log.info("Ollama server already running (external)")
            self.state = OllamaState.RUNNING
            return True

        self.state = OllamaState.STARTING
        binary = self._get_binary_path()
        if not binary:
            self.state = OllamaState.ERROR
            self.error_message = "Ollama binary not found"
            return False

        try:
            log.info("Starting Ollama server from: %s", binary)
            self._server_process = subprocess.Popen(
                [binary, "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )

            # Wait for server to become healthy (up to 30 seconds)
            for attempt in range(30):
                await asyncio.sleep(1)
                if await self.is_server_running():
                    log.info("Ollama server started (took %ds)", attempt + 1)
                    self.state = OllamaState.RUNNING
                    return True

                if self._server_process.poll() is not None:
                    stderr = self._server_process.stderr
                    err_msg = stderr.read().decode()[:500] if stderr else "unknown"
                    self.state = OllamaState.ERROR
                    self.error_message = f"Ollama server exited: {err_msg}"
                    log.error("Ollama server died: %s", self.error_message)
                    return False

            self.state = OllamaState.ERROR
            self.error_message = "Ollama server did not respond within 30 seconds"
            return False

        except OSError as e:
            self.state = OllamaState.ERROR
            self.error_message = f"Failed to start Ollama: {e}"
            log.error("Ollama start failed: %s", e)
            return False

    async def stop_server(self) -> None:
        """Stop the Ollama server subprocess if WE started it."""
        if self._server_process and self._server_process.poll() is None:
            log.info("Stopping Ollama server (we started it)...")
            self._server_process.terminate()
            try:
                self._server_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                log.warning("Ollama didn't stop gracefully, killing...")
                self._server_process.kill()
            self._server_process = None
        self.state = OllamaState.INSTALLED if self.is_installed() else OllamaState.NOT_INSTALLED

    # ── Model listing ───────────────────────────────────────────

    async def list_models(self) -> list[OllamaModelInfo]:
        """
        Get all models the user has already pulled.
        Returns rich metadata from Ollama's /api/tags endpoint.
        """
        try:
            resp = await self._http.get("/api/tags")
            if resp.status_code != 200:
                return []

            data = resp.json()
            models: list[OllamaModelInfo] = []
            for m in data.get("models", []):
                details = m.get("details", {})
                models.append(OllamaModelInfo(
                    name=m.get("name", "unknown"),
                    size_bytes=m.get("size", 0),
                    family=details.get("family", ""),
                    parameter_size=details.get("parameter_size", ""),
                    quantization=details.get("quantization_level", ""),
                    modified_at=m.get("modified_at", ""),
                ))
            return models

        except (httpx.ConnectError, httpx.TimeoutException):
            return []

    async def list_model_names(self) -> list[str]:
        """Get just the names of available models."""
        models = await self.list_models()
        return [m.name for m in models]

    async def is_model_available(self, model: str) -> bool:
        """Check if a specific model is pulled locally."""
        names = await self.list_model_names()
        return any(n == model or n.startswith(f"{model}-") for n in names)

    # ── Startup sequence ────────────────────────────────────────

    async def startup(self, saved_model: Optional[str] = None) -> None:
        """
        Run the startup sequence: detect → start server → check models.

        This does NOT install or download anything. It just:
        1. Checks if Ollama binary exists
        2. Starts the server (if binary found)
        3. Lists available models
        4. Sets state appropriately so the frontend can guide the user

        saved_model: the model name from SQLite settings (user's previous choice)
        """
        log.info("Ollama startup — detect and start only (no downloads)...")

        # Step 1: Detect binary
        if not self.is_installed():
            self.state = OllamaState.NOT_INSTALLED
            log.info("Ollama not installed — frontend will show install guide")
            return

        self.state = OllamaState.INSTALLED
        binary = self._get_binary_path()
        log.info("Ollama binary found at: %s", binary)

        # Step 2: Start server
        if not await self.start_server():
            log.warning("Could not start Ollama server: %s", self.error_message)
            return

        # Step 3: Check if user has any models
        models = await self.list_models()
        if not models:
            self.state = OllamaState.NO_MODELS
            log.info("Ollama running but no models found — frontend will show model guide")
            return

        log.info("Found %d local model(s): %s", len(models), [m.name for m in models])

        # Step 4: Validate saved model selection
        model_names = [m.name for m in models]
        if saved_model and saved_model in model_names:
            self.selected_model = saved_model
            self.state = OllamaState.READY
            log.info("Using saved model: %s", saved_model)
        elif len(models) == 1:
            # Only one model available — use it automatically
            self.selected_model = models[0].name
            self.state = OllamaState.READY
            log.info("Auto-selected only available model: %s", self.selected_model)
        else:
            # Multiple models, no saved preference — user needs to choose
            self.selected_model = None
            self.state = OllamaState.RUNNING
            log.info("Multiple models available — waiting for user to select one")

    async def show_model(self, model: str) -> dict | None:
        """Fetch model metadata via /api/show. Returns model_info dict or None.

        The payload key must be "model" (per Ollama docs). Returns None on
        network failure, 404, or missing model_info.
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(
                    f"{OLLAMA_HOST}/api/show",
                    json={"model": model},
                )
            if resp.status_code != 200:
                return None
            body = resp.json()
            return body.get("model_info")
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError):
            return None

    def select_model(self, model_name: str) -> None:
        """
        Set the active model for AI analysis.
        Called when user picks a model from the dropdown.
        The caller (router) is responsible for saving to SQLite settings.
        """
        self.selected_model = model_name
        if self.state in (OllamaState.RUNNING, OllamaState.NO_MODELS, OllamaState.READY):
            self.state = OllamaState.READY
        log.info("Model selected: %s", model_name)

    # ── Cleanup ─────────────────────────────────────────────────

    async def shutdown(self) -> None:
        """Clean shutdown — stop server, close HTTP client."""
        await self.stop_server()
        await self._http.aclose()
        log.info("Ollama lifecycle shut down")

    # ── Status report ───────────────────────────────────────────

    def status(self) -> dict:
        """
        Return current lifecycle state for the /ai/status endpoint.

        The frontend uses this to decide what to show:
          - not_installed → "Install Ollama" guide with download link
          - installed/error → "Could not start Ollama" message
          - no_models → "Pull a model" guide with recommended commands
          - running → "Select a model" dropdown
          - ready → AI features fully available
        """
        return {
            "state": self.state.value,
            "selected_model": self.selected_model,
            "error": self.error_message if self.state == OllamaState.ERROR else None,
            "ready": self.state == OllamaState.READY,
            "platform": platform.system().lower(),
        }

    @staticmethod
    def get_setup_guide() -> dict:
        """
        Return setup guidance for the frontend.
        Includes install link, recommended models, and pull commands.
        """
        system = platform.system().lower()
        if system == "darwin":
            install_url = "https://ollama.com/download/mac"
            install_note = "Download the macOS app, drag it to Applications, and open it once."
        elif system == "windows":
            install_url = "https://ollama.com/download/windows"
            install_note = "Download and run the Windows installer."
        else:
            install_url = "https://ollama.com/download/linux"
            install_note = "Run: curl -fsSL https://ollama.com/install.sh | sh"

        return {
            "install_url": install_url,
            "install_note": install_note,
            "models_url": "https://ollama.com/library",
            "recommended_models": RECOMMENDED_MODELS,
            "pull_example": "ollama pull gemma4:26b",
        }
