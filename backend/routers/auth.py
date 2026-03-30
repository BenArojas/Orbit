"""
Auth routes — check IBKR session status and manage login/logout.

Note: The user authenticates directly on the IBKR Gateway web UI
(https://localhost:5000). These routes just CHECK and MAINTAIN
that session — they don't handle username/password.
"""

import logging

from fastapi import APIRouter, Depends

from deps import get_ibkr
from models import AuthStatusResponse
from services.ibkr import IBKRService

log = logging.getLogger("parallax.routers.auth")

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatusResponse)
async def get_auth_status(ibkr: IBKRService = Depends(get_ibkr)):
    """
    Check if we have a valid IBKR session.
    Frontend calls this on app launch and after re-auth.
    If authenticated, starts the tickle keep-alive loop.
    """
    status = await ibkr.auth_status()

    # Auto-start tickle loop if we're authenticated
    if status["authenticated"]:
        await ibkr.start_tickle_loop()

    return AuthStatusResponse(**status)


@router.post("/logout", response_model=AuthStatusResponse)
async def logout(ibkr: IBKRService = Depends(get_ibkr)):
    """Log out of the IBKR session."""
    await ibkr.logout()
    return AuthStatusResponse(
        authenticated=False,
        ws_ready=False,
        message="Logged out successfully.",
    )
