"""
FastAPI dependency injection helpers.
Pulls singleton services from app.state so routers stay thin.

Each service is created once during app startup (in main.py lifespan)
and stashed on app.state. These helpers let any router grab them
without knowing how they were created.
"""

from fastapi import Depends, HTTPException, Request, status

from services.db import DatabaseService
from services.ibkr import IBKRService
from services.screener import ScreenerService
from services.sectors import SectorService
from services.ai import AiService
from services.ai_keystore import AIKeyStore
from services.ai_settings import AISettingsService
from services.gateway import GatewayLifecycle
from services.instrument_identity import InstrumentIdentityService
from services.ollama import OllamaLifecycle
from services.scanner import ScannerService


def get_ibkr(request: Request) -> IBKRService:
    """Get the IBKR service singleton stashed on app.state during lifespan."""
    return request.app.state.ibkr


def get_db(request: Request) -> DatabaseService:
    """Get the database service singleton stashed on app.state during lifespan."""
    return request.app.state.db


def get_instrument_identity(
    db: DatabaseService = Depends(get_db),
) -> InstrumentIdentityService:
    """Get an instrument identity service for the active database dependency."""
    return InstrumentIdentityService(db)


def get_sectors(request: Request) -> SectorService:
    """Get the sector service singleton stashed on app.state during lifespan."""
    return request.app.state.sectors


def get_ai(request: Request) -> AiService:
    """Get the AI service singleton stashed on app.state during lifespan."""
    return request.app.state.ai


def get_ai_settings(db: DatabaseService = Depends(get_db)) -> AISettingsService:
    """Get the AI settings service for the active database dependency."""
    return AISettingsService(db)


def get_ai_keystore(request: Request) -> AIKeyStore:
    """Get the OS-keychain backed AI key store."""
    key_store = getattr(request.app.state, "ai_keystore", None)
    if key_store is None:
        key_store = AIKeyStore()
        request.app.state.ai_keystore = key_store
    return key_store


def get_ollama(request: Request) -> OllamaLifecycle:
    """Get the Ollama lifecycle manager from app.state during lifespan."""
    return request.app.state.ollama


def get_screener(request: Request) -> ScreenerService:
    """Get the screener service singleton stashed on app.state during lifespan."""
    return request.app.state.screener


def get_gateway(request: Request) -> GatewayLifecycle:
    """Get the Gateway lifecycle manager from app.state during lifespan."""
    return request.app.state.gateway


def get_scanner(request: Request) -> ScannerService:
    """Get the background scanner singleton stashed on app.state during lifespan."""
    return request.app.state.scanner


async def require_ibkr_auth(ibkr: IBKRService = Depends(get_ibkr)) -> IBKRService:
    """
    Dependency that gates IBKR-backed routes behind authentication.

    Returns the IBKRService if authenticated.
    Raises 503 (not 401) so the frontend can distinguish "not yet authed"
    from "bad credentials" — 401 is reserved for token expiry mid-session.

    Usage:
        @router.get("/my-route")
        async def my_route(ibkr: IBKRService = Depends(require_ibkr_auth)):
            ...
    """
    if not ibkr.state.authenticated:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "ibkr_not_authenticated",
                "message": (
                    "IBKR session is not authenticated. "
                    "Start and log into the Gateway first."
                ),
            },
        )
    return ibkr
