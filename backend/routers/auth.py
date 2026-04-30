"""
Auth routes — check IBKR session status and manage login/logout.

Note: The user authenticates directly on the IBKR Gateway web UI
(https://localhost:5000). These routes just CHECK and MAINTAIN
that session — they don't handle username/password.
"""

import logging

from fastapi import APIRouter, Depends

from deps import get_ibkr
from exceptions import IBKRRequestError
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
        # Belt-and-suspenders: auth_status() bootstraps accounts on the first
        # False -> True transition, but if a prior probe partially populated
        # state and accounts_fetched is still False, retry here so the
        # response below is the last opportunity before the frontend fires
        # its first /market/quote call.
        if not ibkr.state.accounts_fetched:
            try:
                await ibkr.ensure_accounts()
            except IBKRRequestError as exc:
                log.warning(
                    "ensure_accounts() failed at /auth/status response: %s",
                    exc,
                )

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
