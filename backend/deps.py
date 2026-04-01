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
from services.sectors import SectorService


def get_ibkr(request: Request) -> IBKRService:
    """Get the IBKR service singleton stashed on app.state during lifespan."""
    return request.app.state.ibkr


def get_db(request: Request) -> DatabaseService:
    """Get the database service singleton stashed on app.state during lifespan."""
    return request.app.state.db


def get_sectors(request: Request) -> SectorService:
    """Get the sector service singleton stashed on app.state during lifespan."""
    return request.app.state.sectors
