"""
Parallax configuration — all settings in one place.
No .env file needed for v1 (everything is local).
"""

import os

# IBKR Client Portal Gateway
IBKR_GATEWAY_HOST = os.getenv("IBKR_GATEWAY_HOST", "localhost")
IBKR_GATEWAY_PORT = int(os.getenv("IBKR_GATEWAY_PORT", "5000"))
IBKR_GATEWAY_BASE_URL = f"https://{IBKR_GATEWAY_HOST}:{IBKR_GATEWAY_PORT}"
IBKR_API_BASE_URL = f"{IBKR_GATEWAY_BASE_URL}/v1/api"

# Parallax backend
BACKEND_HOST = os.getenv("BACKEND_HOST", "localhost")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

# Tauri dev server (for CORS)
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:1420")

# Ollama (local AI)
# The Ollama server runs locally and exposes a REST API.
# Model selection is stored in SQLite settings (user picks from what they have).
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# Gateway provisioning
# Where the managed JRE + Gateway live on disk
GATEWAY_HOME = os.path.expanduser(
    os.getenv("PARALLAX_GATEWAY_HOME", "~/.parallax/gateway")
)
GATEWAY_JRE_VERSION = "17"

# IBKR Gateway zip download URL (official)
GATEWAY_ZIP_URL = os.getenv(
    "GATEWAY_ZIP_URL",
    "https://download2.interactivebrokers.com/portal/clientportal.gw.zip",
)

# Adoptium Temurin JRE API (resolves to platform-specific archive)
ADOPTIUM_API_BASE = "https://api.adoptium.net/v3/binary/latest"

# SQLite
SQLITE_DB_PATH = os.getenv("SQLITE_DB_PATH", "parallax.db")

# Session keep-alive interval (seconds)
IBKR_TICKLE_INTERVAL = int(os.getenv("IBKR_TICKLE_INTERVAL", "55"))
