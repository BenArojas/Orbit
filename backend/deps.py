"""
FastAPI dependency injection helpers.
Pulls singleton services from app.state so routers stay thin.
"""

from fastapi import Request

from services.ibkr import IBKRService


def get_ibkr(request: Request) -> IBKRService:
    """Get the IBKR service singleton stashed on app.state during lifespan."""
    return request.app.state.ibkr
