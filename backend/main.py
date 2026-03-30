"""
Parallax backend — FastAPI application entrypoint.

This is the Python sidecar that Tauri launches automatically.
It owns all communication with IBKR, Ollama, and SQLite.
The React frontend talks exclusively to this server.

Run in dev mode:
    cd backend
    uv run uvicorn main:app --reload --port 8000
"""

import logging

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from config import FRONTEND_ORIGIN
from exceptions import (
    IBKRAuthError,
    IBKRConnectionError,
    IBKRRateLimitError,
    IBKRRequestError,
    ParallaxError,
)
from services.ibkr import IBKRService

# ── Logging setup (must be first) ────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
log = logging.getLogger("parallax")

# ── App version ──────────────────────────────────────────────

APP_VERSION = "0.1.0"


# ── Lifespan (startup / shutdown) ────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Creates the IBKR service singleton on startup.
    Cleans everything up on shutdown.
    """
    log.info("Parallax backend starting (v%s)...", APP_VERSION)

    # Create the IBKR service and stash it on app.state
    ibkr = IBKRService()
    app.state.ibkr = ibkr

    # SQLite init will go here (Step 1.4)
    # Ollama lifecycle will go here (Step 4.12)

    log.info("Backend ready. Waiting for frontend connections.")
    yield

    # Shutdown
    log.info("Parallax backend shutting down...")
    await ibkr.shutdown()
    log.info("Shutdown complete.")


# ── FastAPI app ──────────────────────────────────────────────

app = FastAPI(
    title="Parallax",
    version=APP_VERSION,
    lifespan=lifespan,
)


# ── CORS ─────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Exception handlers ───────────────────────────────────────
# These turn our typed exceptions into proper HTTP responses.


@app.exception_handler(IBKRAuthError)
async def ibkr_auth_error_handler(request: Request, exc: IBKRAuthError):
    return JSONResponse(
        status_code=401,
        content={
            "error": "ibkr_auth_error",
            "message": exc.message,
        },
    )


@app.exception_handler(IBKRConnectionError)
async def ibkr_connection_error_handler(request: Request, exc: IBKRConnectionError):
    return JSONResponse(
        status_code=502,
        content={
            "error": "ibkr_connection_error",
            "message": exc.message,
        },
    )


@app.exception_handler(IBKRRateLimitError)
async def ibkr_rate_limit_error_handler(request: Request, exc: IBKRRateLimitError):
    headers = {}
    if exc.retry_after:
        headers["Retry-After"] = str(exc.retry_after)
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limit_exceeded",
            "message": exc.message,
            "endpoint": exc.endpoint,
            "retry_after": exc.retry_after,
        },
        headers=headers,
    )


@app.exception_handler(IBKRRequestError)
async def ibkr_request_error_handler(request: Request, exc: IBKRRequestError):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "ibkr_request_error",
            "message": exc.message,
        },
    )


@app.exception_handler(ParallaxError)
async def parallax_error_handler(request: Request, exc: ParallaxError):
    """Catch-all for any ParallaxError subclass not handled above."""
    return JSONResponse(
        status_code=500,
        content={
            "error": "parallax_error",
            "message": exc.message,
        },
    )


# ── Routers ──────────────────────────────────────────────────

from routers.auth import router as auth_router

app.include_router(auth_router)

# Future routers (uncomment as they're built):
# from routers.market import router as market_router
# from routers.screener import router as screener_router
# from routers.indicators import router as indicators_router
# from routers.watchlist import router as watchlist_router
# from routers.triggers import router as triggers_router
# from routers.ai import router as ai_router


# ── Health endpoint ──────────────────────────────────────────

@app.get("/health")
async def health(request: Request):
    """
    Health check — frontend calls this to verify the backend is alive.
    Also reports IBKR connection status so the UI can show appropriate state.
    """
    ibkr: IBKRService = request.app.state.ibkr
    return {
        "status": "ok" if ibkr.state.authenticated else "degraded",
        "ibkr_connected": ibkr.state.authenticated,
        "ibkr_authenticated": ibkr.state.authenticated,
        "ws_ready": ibkr.state.ws_connected,
        "version": APP_VERSION,
    }
