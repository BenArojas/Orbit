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
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# SQLite
SQLITE_DB_PATH = os.getenv("SQLITE_DB_PATH", "parallax.db")

# Session keep-alive interval (seconds)
IBKR_TICKLE_INTERVAL = int(os.getenv("IBKR_TICKLE_INTERVAL", "55"))
