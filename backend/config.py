"""
Orbit backend configuration — all settings in one place.
No .env file needed for v1 (everything is local).
"""

import os

# IBKR Client Portal Gateway
IBKR_GATEWAY_HOST = os.getenv("IBKR_GATEWAY_HOST", "localhost")
# 5001 across all OSes — port 5000 collides with macOS AirPlay Receiver and
# we want a single mental model for docs, tests, and ports-in-use checks.
IBKR_GATEWAY_PORT = int(os.getenv("IBKR_GATEWAY_PORT", "5001"))
IBKR_GATEWAY_BASE_URL = f"https://{IBKR_GATEWAY_HOST}:{IBKR_GATEWAY_PORT}"
IBKR_API_BASE_URL = f"{IBKR_GATEWAY_BASE_URL}/v1/api"

# Orbit backend
BACKEND_HOST = os.getenv("BACKEND_HOST", "localhost")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

# Tauri dev server (for CORS in development)
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:1420")

# Tauri production webview origin — requests come from tauri://localhost when
# the app is packaged. run.py sets FRONTEND_ORIGIN to this value at startup,
# but we keep it here as a constant so main.py can always allow both origins.
TAURI_ORIGIN = "tauri://localhost"

# Ollama (local AI)
# The Ollama server runs locally and exposes a REST API.
# Model selection is stored in SQLite settings (user picks from what they have).
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# Gateway provisioning. PARALLAX_* env names are retained for compatibility
# with the existing sidecar and user data paths.
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

# SQLite. The default filename remains parallax.db until the storage migration
# is handled as a release-packaging task.
SQLITE_DB_PATH = os.getenv("SQLITE_DB_PATH", "parallax.db")

# Session keep-alive interval (seconds)
IBKR_TICKLE_INTERVAL = int(os.getenv("IBKR_TICKLE_INTERVAL", "55"))

# Auth-status cache TTL (Phase 8 / Task 1.7).
# Multiple polling clocks (`/gateway/status` every 2s while not logged in,
# `/auth/status` on app launch / after re-auth) all currently trigger an
# IBKR `POST /iserver/auth/status`.  Cache the result for this many
# seconds so all callers in a short window share one IBKR probe.
# Default 5s — short enough that the user feels reactive after a manual
# re-login, long enough to drop steady-state IBKR pressure from
# ~12 POSTs/min to ~2/min.  Set to 0 to disable (always probe).
AUTH_STATUS_TTL_SEC = float(os.getenv("PARALLAX_AUTH_STATUS_TTL_SEC", "5"))

# Snapshot pre-flight delay (Phase 8 / Task 1.3).
# IBKR's /iserver/marketdata/snapshot returns empty fields on the first
# call for a fresh conid — the call itself is a "pre-flight" that primes
# IBKR's market-data cache. We wait `PREFLIGHT_DELAY_MS` between the
# pre-flight and the real call so IBKR has a chance to populate fields.
# Default 750ms — IBKR docs don't pin a number; this is the empirical
# midpoint that worked for STK conids in MoonMarket. If derivative-class
# conids still time out (CASH/FUT/OPT/etc.), bisect upward (1500ms,
# 3000ms) and document the result. See the Phase-8 plan's "Open
# questions" section for the bisection protocol.
PREFLIGHT_DELAY_MS = int(os.getenv("PARALLAX_PREFLIGHT_DELAY_MS", "750"))

# Sectors result cache TTL (Phase 8 / Task 2.3).
# Each /sectors/* endpoint fans out to ~11 IBKR history calls and takes
# 30–43s on a cold start.  Cache the result server-side so a second page
# load within this window is served instantly from memory.  Frontend polls
# at 5-minute cadence anyway, so 60s gives meaningful relief without
# serving stale data to users who are actively watching.
# Set to 0 to disable caching (always compute fresh).
SECTORS_CACHE_TTL_SEC = int(os.getenv("PARALLAX_SECTORS_CACHE_TTL_SEC", "60"))

# Request-logging middleware toggle (Phase 8 / Task 4.2).
# When enabled, RequestLoggingMiddleware writes every HTTP + WS event to
# backend/logs/requests.log (rotating JSONL, 10 MB × 5 backups).
# Useful for dev tuning (HAR-style analysis without a browser); wasteful
# in packaged production builds where disk writes serve no purpose.
#
# Default: on when BACKEND_PORT == 8000 (standard dev server), off otherwise.
# Override by setting PARALLAX_REQUEST_LOG=1 (force on) or =0 (force off).
def _default_request_log() -> bool:
    explicit = os.getenv("PARALLAX_REQUEST_LOG")
    if explicit is not None:
        return explicit.strip() not in ("0", "false", "False", "no", "")
    return BACKEND_PORT == 8000

REQUEST_LOG_ENABLED: bool = _default_request_log()
