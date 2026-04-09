"""
FastAPI dependency injection helpers.
Pulls singleton services from app.state so routers stay thin.

Each service is created once during app startup (in main.py lifespan)
and stashed on app.state. These helpers let any router grab them
without knowing how they were created.
"""

from fastapi import Request

from services.db import DatabaseService
from services.ibkr import IBKRService
from services.screener import ScreenerService
from services.sectors import SectorService
from services.ai import AiService
from services.gateway import GatewayLifecycle
from services.ollama import OllamaLifecycle


def get_ibkr(request: Request) -> IBKRService:
    """Get the IBKR service singleton stashed on app.state during lifespan."""
    return request.app.state.ibkr


def get_db(request: Request) -> DatabaseService:
    """Get the database service singleton stashed on app.state during lifespan."""
    return request.app.state.db


def get_sectors(request: Request) -> SectorService:
    """Get the sector service singleton stashed on app.state during lifespan."""
    return request.app.state.sectors


def get_ai(request: Request) -> AiService:
    """Get the AI service singleton stashed on app.state during lifespan."""
    return request.app.state.ai


def get_ollama(request: Request) -> OllamaLifecycle:
    """Get the Ollama lifecycle manager from app.state during lifespan."""
    return request.app.state.ollama


def get_screener(request: Request) -> ScreenerService:
    """Get the screener service singleton stashed on app.state during lifespan."""
    return request.app.state.screener


def get_gateway(request: Request) -> GatewayLifecycle:
    """Get the Gateway lifecycle manager from app.state during lifespan."""
    return request.app.state.gateway
