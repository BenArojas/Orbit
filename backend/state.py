"""
In-memory state for the IBKR service.
Tracks session status, WebSocket state, and subscription tracking.
"""

import asyncio
from typing import Any, Optional
from pydantic import BaseModel, Field


class IBKRState(BaseModel):
    """
    Mutable state bag for the IBKR service singleton.
    Lives in memory — wiped on app restart (that's fine, IBKR sessions
    are re-established on launch anyway).
    """

    # Auth
    authenticated: bool = False
    session_token: Optional[str] = None

    # Disconnect detection
    # Set to True after TICKLE_FAIL_THRESHOLD consecutive tickle failures while
    # previously authenticated. Cleared when the user re-authenticates.
    session_dropped: bool = False
    tickle_fail_count: int = 0

    # WebSocket — IBKR gateway connection
    ws_connected: bool = False
    ibkr_ws: Any = None  # websockets.WebSocketClientProtocol (Any to avoid import)
    ws_subscriptions: set[int] = Field(default_factory=set)  # conids we're subscribed to

    # Accounts
    # `accounts` is the raw list of account IDs from /iserver/accounts (e.g.
    # ["DU1234567"]). `selected_account` mirrors the response's
    # `selectedAccount` field — IBKR uses it implicitly for any order /
    # snapshot endpoint that doesn't take an explicit acctId.
    accounts_fetched: bool = False
    accounts: list[str] = Field(default_factory=list)
    selected_account: Optional[str] = None

    # Lifecycle
    shutdown_event: asyncio.Event = Field(default_factory=asyncio.Event)

    class Config:
        arbitrary_types_allowed = True

    def reset(self) -> None:
        """Clear all session state (on logout or disconnect)."""
        self.authenticated = False
        self.session_token = None
        self.session_dropped = False
        self.tickle_fail_count = 0
        self.ws_connected = False
        self.ibkr_ws = None
        self.ws_subscriptions.clear()
        self.accounts_fetched = False
        self.accounts.clear()
        self.selected_account = None
