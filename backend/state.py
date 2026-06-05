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
    # Subscribes requested while the IBKR WS was not yet connected. Flushed
    # on connect (see _ws_loop). Prevents lost-tick scenarios on first paint
    # when the frontend hits us before IBKR is ready.
    ws_pending_subscribes: set[int] = Field(default_factory=set)
    # Readiness signal — set when the IBKR WebSocket is fully connected and
    # has flushed initial subscribes; cleared on disconnect. The frontend WS
    # endpoint waits on this before accepting the browser connection so the
    # FE never sees an intermediate "connected to backend, not to IBKR" state.
    ws_ready_event: asyncio.Event = Field(default_factory=asyncio.Event)

    # Accounts
    # `accounts` is the raw list of account IDs from /iserver/accounts (e.g.
    # ["DU1234567"]). `selected_account` mirrors the response's
    # `selectedAccount` field — IBKR uses it implicitly for any order /
    # snapshot endpoint that doesn't take an explicit acctId.
    accounts_fetched: bool = False
    accounts: list[str] = Field(default_factory=list)
    selected_account: Optional[str] = None
    accounts_payload: dict[str, Any] = Field(default_factory=dict)

    # Snapshot pre-flight bookkeeping (Phase 8 / Task 1.3).
    # IBKR's first /iserver/marketdata/snapshot for a fresh conid returns
    # empty fields — the call is a "pre-flight" that primes IBKR's cache.
    # `warmed_conids` tracks conids we've already pre-flighted in this
    # session; subsequent snapshots for these conids skip the pre-flight.
    # `preflight_locks` is a per-conid asyncio.Lock so that 5 concurrent
    # callers for a fresh conid only run one pre-flight.
    # Both are wiped by `state.reset()` so a logout / session-drop forces
    # a fresh pre-flight on the next snapshot.
    warmed_conids: set[int] = Field(default_factory=set)
    preflight_locks: Any = Field(default_factory=dict)  # dict[int, asyncio.Lock]

    # Secdef pre-warm bookkeeping (Phase 8 / Task 1.4).
    # IBKR's snapshot doc states: "For derivative contracts the endpoint
    # /iserver/secdef/search must be called first." We extend this to all
    # non-STK/ETF asset classes empirically (BTC, USD.ILS, VIX historically
    # time out without the warm-up). `conid_asset_class` is populated
    # during `get_conid()` so we have the (symbol, asset_class) needed to
    # call /iserver/secdef/search at snapshot time. `secdef_warmed` tracks
    # conids we've already pre-warmed (success OR failure — we don't retry
    # 4xx responses every snapshot). `secdef_locks` coalesces concurrent
    # first-time callers. All three are wiped by `state.reset()`.
    conid_asset_class: Any = Field(default_factory=dict)  # dict[int, tuple[str, str]]
    secdef_warmed: set[int] = Field(default_factory=set)
    secdef_locks: Any = Field(default_factory=dict)  # dict[int, asyncio.Lock]

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
        self.ws_pending_subscribes.clear()
        self.ws_ready_event.clear()
        self.accounts_fetched = False
        self.accounts.clear()
        self.selected_account = None
        self.accounts_payload.clear()
        self.warmed_conids.clear()
        self.preflight_locks.clear()
        self.conid_asset_class.clear()
        self.secdef_warmed.clear()
        self.secdef_locks.clear()
