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
    AIError,
    GatewayError,
    IBKRAuthError,
    IBKRConnectionError,
    IBKRRateLimitError,
    IBKRRequestError,
    OllamaConnectionError,
    ParallaxError,
    ScreenerError,
)
from services.db import DatabaseService
from services.gateway import GatewayLifecycle
from services.ibkr import IBKRService
from services.screener import ScreenerService
from services.sectors import SectorService
from services.ai import AiService
from services.ollama import OllamaLifecycle

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

    # Gateway lifecycle — provision JRE + IBKR Gateway, manage process
    # Must start before IBKRService since IBKR talks to the running Gateway.
    # On first launch with no provisioned files, it stays in NOT_PROVISIONED
    # and the frontend triggers /gateway/provision to show progress UI.
    gateway = GatewayLifecycle()
    app.state.gateway = gateway
    try:
        await gateway.startup(auto_start=True)
        log.info("Gateway state: %s", gateway.state.value)
    except GatewayError as e:
        log.warning("Gateway startup: %s (non-fatal, user can set up later)", e.message)

    # Create the IBKR service and stash it on app.state
    ibkr = IBKRService()
    app.state.ibkr = ibkr

    # Initialize SQLite database (Step 1.4)
    db = DatabaseService()
    await db.initialize()
    await db.seed_defaults()
    app.state.db = db

    # Create the sector service singleton (Step 3.3–3.4)
    # Must be a singleton so the conid cache persists across requests
    app.state.sectors = SectorService(ibkr)

    # Screener service (Phase 5)
    app.state.screener = ScreenerService(ibkr)

    # Ollama lifecycle — detect binary, start server, list models (Step 4.12)
    # This NEVER downloads or installs anything. It detects what the user
    # already has, starts the Ollama server if present, and lists models.
    # If Ollama isn't installed, the frontend shows a setup guide with links.
    ollama = OllamaLifecycle()
    app.state.ollama = ollama

    # Run startup: detect → start server → check models → restore selection.
    # This is fast (no downloads) so we run it inline, not in background.
    saved_model = await db.get_setting("ai_model")
    try:
        await ollama.startup(saved_model=saved_model)
        if ollama.status()["ready"]:
            log.info("Ollama ready — AI features available (model: %s)", ollama.selected_model)
        else:
            log.info("Ollama state: %s — frontend will guide setup", ollama.state.value)
    except (OllamaConnectionError, AIError, OSError) as e:
        log.error("Ollama startup failed: %s", e)

    # AI service — stateless wrapper for Ollama chat/analysis.
    # The model name is passed per-request from ollama.selected_model.
    ai = AiService()
    app.state.ai = ai

    log.info("Backend ready. Waiting for frontend connections.")
    yield

    # Shutdown
    log.info("Parallax backend shutting down...")
    await ai.shutdown()
    await ollama.shutdown()
    await db.close()
    await ibkr.shutdown()
    await gateway.shutdown()
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


@app.exception_handler(OllamaConnectionError)
async def ollama_connection_error_handler(request: Request, exc: OllamaConnectionError):
    return JSONResponse(
        status_code=503,
        content={
            "error": "ollama_connection_error",
            "message": exc.message,
        },
    )


@app.exception_handler(AIError)
async def ai_error_handler(request: Request, exc: AIError):
    return JSONResponse(
        status_code=500,
        content={
            "error": "ai_error",
            "message": exc.message,
        },
    )


@app.exception_handler(ScreenerError)
async def screener_error_handler(request: Request, exc: ScreenerError):
    return JSONResponse(
        status_code=422,
        content={
            "error": "screener_error",
            "message": exc.message,
        },
    )


@app.exception_handler(GatewayError)
async def gateway_error_handler(request: Request, exc: GatewayError):
    return JSONResponse(
        status_code=502,
        content={
            "error": "gateway_error",
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
from routers.indicators import router as indicators_router
from routers.market import router as market_router
from routers.sectors import router as sectors_router
from routers.watchlist import router as watchlist_router
from routers.ws import router as ws_router

app.include_router(auth_router)
app.include_router(indicators_router)
app.include_router(market_router)
app.include_router(sectors_router)
app.include_router(watchlist_router)
app.include_router(ws_router)

from routers.triggers import router as triggers_router
from routers.ai import router as ai_router
from routers.fibonacci import router as fibonacci_router

app.include_router(triggers_router)
app.include_router(ai_router)
app.include_router(fibonacci_router)

from routers.screener import router as screener_router
app.include_router(screener_router)

from routers.gateway import router as gateway_router
app.include_router(gateway_router)


# ── Health endpoint ──────────────────────────────────────────

@app.get("/health")
async def health(request: Request):
    """
    Health check — frontend calls this to verify the backend is alive.
    Also reports IBKR connection status so the UI can show appropriate state.
    """
    ibkr: IBKRService = request.app.state.ibkr
    gw: GatewayLifecycle = request.app.state.gateway
    return {
        "status": "ok" if ibkr.state.authenticated else "degraded",
        "ibkr_connected": ibkr.state.authenticated,
        "ibkr_authenticated": ibkr.state.authenticated,
        "ws_ready": ibkr.state.ws_connected,
        "gateway_running": gw.state.value == "running",
        "gateway_state": gw.state.value,
        "version": APP_VERSION,
    }
