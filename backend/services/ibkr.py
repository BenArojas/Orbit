"""
IBKR Client Portal service — the single gateway to Interactive Brokers.
All IBKR communication goes through this class. Nothing else talks to IBKR directly.

Ported from MoonMarket with improvements:
  - Typed exceptions (no bare except)
  - Clean separation of auth logic
  - Prepared for WebSocket handler (Phase 1.6)
"""

import asyncio
import json
import logging
import ssl
import time
from typing import Any, Awaitable, Callable

import httpx
import websockets

from cache import cached
from config import IBKR_API_BASE_URL, IBKR_GATEWAY_BASE_URL, IBKR_TICKLE_INTERVAL
from constants import DEFAULT_QUOTE_FIELDS_STR, LIVE_STREAM_FIELDS
from exceptions import (
    IBKRAuthError,
    IBKRConnectionError,
    IBKRRateLimitError,
    IBKRRequestError,
    SymbolNotFoundError,
)
from rate_control import paced
from state import IBKRState

log = logging.getLogger("parallax.ibkr")


class IBKRService:
    """
    Singleton service that owns the IBKR Client Portal connection.
    Created once in FastAPI lifespan, injected into routes via deps.py.
    """

    def __init__(self, base_url: str = IBKR_API_BASE_URL) -> None:
        self.base_url = base_url.rstrip("/")
        self.state = IBKRState()
        self.http = httpx.AsyncClient(
            base_url=self.base_url,
            verify=False,  # IBKR gateway uses self-signed cert
            timeout=httpx.Timeout(30.0),
        )
        self._tickle_task: asyncio.Task | None = None
        self._ws_task: asyncio.Task | None = None

    # ── Core HTTP helper ─────────────────────────────────────

    @paced("dynamic")
    async def _request(self, method: str, endpoint: str, **kwargs) -> dict:
        """
        Send a request to the IBKR Client Portal API.
        Handles retries for transient errors (404/503) and typed exceptions.
        """
        max_retries = 3
        base_delay = 0.5

        for attempt in range(max_retries):
            delay = base_delay * (2 ** attempt)
            try:
                resp = await self.http.request(method, endpoint, **kwargs)

                # Transient errors — retry
                if resp.status_code in (404, 503) and attempt < max_retries - 1:
                    log.warning(
                        "IBKR %s %s -> %d (attempt %d/%d, retrying in %.1fs)",
                        method, endpoint, resp.status_code,
                        attempt + 1, max_retries, delay,
                    )
                    await asyncio.sleep(delay)
                    continue

                # Auth failure
                if resp.status_code == 401:
                    self.state.authenticated = False
                    self.state.session_token = None
                    raise IBKRAuthError(
                        f"IBKR returned 401 on {method} {endpoint}"
                    )

                # Rate limit
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", "15"))
                    raise IBKRRateLimitError(endpoint, retry_after)

                # Other HTTP errors
                if resp.status_code >= 400:
                    raise IBKRRequestError(
                        status_code=resp.status_code,
                        detail=resp.text[:200],
                    )

                return resp.json()

            except httpx.TimeoutException as exc:
                log.warning(
                    "IBKR request timed out (attempt %d/%d): %s %s",
                    attempt + 1, max_retries, method, endpoint,
                )
                if attempt >= max_retries - 1:
                    raise IBKRConnectionError(
                        f"IBKR Gateway timed out on {method} {endpoint}. "
                        "Gateway may be starting up or overloaded."
                    ) from exc
                await asyncio.sleep(delay)

            except httpx.ConnectError as exc:
                log.error(
                    "IBKR connection error (attempt %d/%d): %s",
                    attempt + 1, max_retries, exc,
                )
                if attempt >= max_retries - 1:
                    raise IBKRConnectionError(
                        f"Cannot reach IBKR Gateway at {self.base_url}. "
                        "Check /gateway/status — the Gateway may not be running or provisioned."
                    ) from exc
                await asyncio.sleep(delay)

            except (IBKRAuthError, IBKRRateLimitError, IBKRRequestError):
                raise  # Don't retry these — they're intentional

        raise IBKRConnectionError("Request failed after all retries")

    # ── Auth Methods ─────────────────────────────────────────

    async def auth_status(self) -> dict:
        """
        Check if the IBKR session is authenticated and connected.
        This is the first call the frontend makes on app launch.
        """
        try:
            data = await self._request("POST", "/iserver/auth/status")
            is_authenticated = data.get("authenticated", False)
            is_connected = data.get("connected", False)
            is_valid = is_authenticated and is_connected

            self.state.authenticated = is_valid
            if not is_valid:
                self.state.session_token = None

            return {
                "authenticated": is_valid,
                "ws_ready": self.state.ws_connected,
                "message": data.get("message", "Status checked."),
            }
        except IBKRAuthError:
            # 401 on /iserver/auth/status is normal when the user hasn't
            # logged in yet — not an error, just "not authenticated".
            self.state.authenticated = False
            self.state.session_token = None
            return {
                "authenticated": False,
                "ws_ready": False,
                "message": "Session not authenticated. Please log in via the IBKR Gateway.",
            }
        except IBKRConnectionError:
            self.state.authenticated = False
            return {
                "authenticated": False,
                "ws_ready": False,
                "message": "Cannot reach IBKR Gateway. Is it running on localhost:5000?",
            }

    async def tickle(self) -> bool:
        """
        Keep the IBKR session alive. Call periodically.
        Returns True if session is still valid.
        """
        try:
            data = await self._request("POST", "/tickle")
            self.state.session_token = data.get("session")
            self.state.authenticated = True
            return True
        except (IBKRAuthError, IBKRConnectionError):
            self.state.authenticated = False
            return False

    async def sso_validate(self) -> bool:
        """Validate the SSO session. Returns True if valid."""
        try:
            await self._request("GET", "/sso/validate")
            return True
        except IBKRAuthError:
            return False

    async def ensure_accounts(self) -> None:
        """Fetch and cache the list of brokerage accounts."""
        if self.state.accounts_fetched:
            return
        data = await self._request("GET", "/iserver/accounts")
        accounts = data.get("accounts", [])
        self.state.accounts = accounts
        self.state.accounts_fetched = True
        log.info("Fetched %d IBKR account(s)", len(accounts))

    async def logout(self) -> dict:
        """Log out of the IBKR session and clean up state."""
        try:
            log.info("Logging out of IBKR session...")
            response = await self._request("POST", "/logout")
            log.info("IBKR logout successful.")
            return response
        except IBKRConnectionError as exc:
            log.warning("Could not reach IBKR for logout: %s", exc)
            return {"message": "Logged out locally (gateway unreachable)."}
        finally:
            self.state.reset()
            await self._stop_tickle()

    # ── Session Keep-Alive ───────────────────────────────────

    async def start_tickle_loop(self) -> None:
        """Start the background tickle loop to keep IBKR session alive."""
        if self._tickle_task and not self._tickle_task.done():
            return  # Already running
        self._tickle_task = asyncio.create_task(self._tickle_loop())
        log.info("Tickle loop started (interval: %ds)", IBKR_TICKLE_INTERVAL)

    async def _stop_tickle(self) -> None:
        """Cancel the tickle loop."""
        if self._tickle_task and not self._tickle_task.done():
            self._tickle_task.cancel()
            try:
                await self._tickle_task
            except asyncio.CancelledError:
                pass
            self._tickle_task = None
            log.info("Tickle loop stopped.")

    async def _tickle_loop(self) -> None:
        """Background loop — calls tickle every N seconds."""
        while True:
            try:
                await asyncio.sleep(IBKR_TICKLE_INTERVAL)
                success = await self.tickle()
                if not success:
                    log.warning("Tickle failed — IBKR session may have expired.")
            except asyncio.CancelledError:
                break
            except (OSError, ConnectionError, IBKRConnectionError) as exc:
                log.error("Tickle loop error: %s", exc)
                await asyncio.sleep(5)  # Brief pause before retry

    # ── Market Data Methods (Step 1.5) ──────────────────────

    @cached(ttl=3600)
    async def search(self, symbol: str, sec_type: str = "") -> list[dict]:
        """
        Search for securities by symbol.
        Returns a list of matches with conid, symbol, companyHeader, secType.
        """
        params: dict[str, str] = {"symbol": symbol}
        if sec_type:
            params["secType"] = sec_type
        return await self._request("GET", "/iserver/secdef/search", params=params)

    @cached(ttl=3600)
    async def get_conid(self, symbol: str) -> int:
        """
        Resolve a ticker symbol to an IBKR conid.
        Raises SymbolNotFoundError if not found.
        """
        results = await self.search(symbol, sec_type="STK")
        for item in results:
            conid = item.get("conid")
            if conid:
                return int(conid)
        raise SymbolNotFoundError(symbol)

    async def snapshot(
        self,
        conids: list[int],
        fields: str = DEFAULT_QUOTE_FIELDS_STR,
        timeout: float = 5.0,
        poll_interval: float = 1.0,
    ) -> list[dict]:
        """
        Get a market data snapshot for one or more conids.
        Polls until all requested fields are present or timeout is reached.
        IBKR requires calling snapshot twice — first call "warms up" the data.
        """
        await self.ensure_accounts()
        params = {
            "conids": ",".join(str(c) for c in conids),
            "fields": fields,
        }
        requested_fields = fields.split(",")
        start = time.monotonic()
        response = []

        while time.monotonic() - start < timeout:
            response = await self._request(
                "GET", "/iserver/marketdata/snapshot", params=params
            )
            if response and isinstance(response, list):
                # Check if all conids have all requested fields
                conids_in_resp = {str(item.get("conid")) for item in response}
                all_conids_present = set(str(c) for c in conids).issubset(conids_in_resp)
                all_fields_present = all(
                    all(f in item for f in requested_fields)
                    for item in response
                )
                if all_conids_present and all_fields_present:
                    return response

            await asyncio.sleep(poll_interval)

        # Return whatever we have after timeout
        log.warning("Snapshot timed out for conids %s after %.1fs", conids, timeout)
        return response if isinstance(response, list) else []

    @cached(ttl=300)
    async def history(
        self,
        conid: int,
        period: str = "1m",
        bar: str = "30min",
    ) -> dict:
        """
        Get historical OHLCV candle data.
        Returns raw IBKR response with 'data' list of bars.
        """
        await self.ensure_accounts()
        params = {
            "conid": conid,
            "period": period,
            "bar": bar,
            "outsideRth": "true",
        }
        return await self._request(
            "GET", "/iserver/marketdata/history", params=params
        )

    @cached(ttl=3600)
    async def contract_info(self, conid: int) -> dict:
        """
        Fetch full contract details for a conid.
        Returns exchange, currency, sector, industry, etc.
        Used by the screener quick-peek slide-over.
        """
        await self.ensure_accounts()
        return await self._request("GET", f"/iserver/contract/{conid}/info")

    # ── Watchlist Methods (Step 3.5) ───────────────────────────

    @cached(ttl=60)
    async def get_watchlists(self) -> list[dict]:
        """
        Fetch all IBKR watchlists for the authenticated user.
        Returns list of {id, name} dicts.
        """
        await self.ensure_accounts()
        data = await self._request("GET", "/iserver/watchlists")
        # IBKR returns: {"data": [{"id": "...", "name": "...", ...}, ...]}
        # or sometimes just a list
        if isinstance(data, dict):
            return data.get("data", data.get("user_lists", []))
        return data if isinstance(data, list) else []

    async def get_watchlist_items(self, watchlist_id: str) -> list[dict]:
        """
        Fetch instruments in a specific IBKR watchlist.
        Returns raw IBKR response with instrument rows.
        """
        await self.ensure_accounts()
        data = await self._request(
            "GET", "/iserver/watchlist", params={"id": watchlist_id}
        )
        # IBKR returns: {"id": "...", "hash": "...", "data": {"instruments": [...]}}
        # or {"instruments": [...]}
        if isinstance(data, dict):
            instruments_data = data.get("data", data)
            if isinstance(instruments_data, dict):
                return instruments_data.get("instruments", [])
            return []
        return []

    # ── Scanner Methods (Step 5.6) ────────────────────────────

    @cached(ttl=3600)
    async def scanner_params(self) -> dict:
        """
        Fetch available scanner parameters from IBKR.
        Returns instruments, locations, scan types, and filter codes
        the user can build scans from.
        """
        await self.ensure_accounts()
        return await self._request("GET", "/iserver/scanner/params")

    async def scanner_run(
        self,
        instrument: str,
        scan_type: str,
        location: str,
        filters: list[dict] | None = None,
        sort: str = "",
    ) -> list[dict]:
        """
        Run an IBKR market scanner.

        Args:
            instrument: Security type — "STK", "FUT", "IND", etc.
            scan_type: Scanner preset — "TOP_PERC_GAIN", "MOST_ACTIVE", etc.
            location: Market location — "STK.US.MAJOR", "STK.EU", etc.
            filters: Optional price/volume filters, e.g.:
                     [{"code": "priceAbove", "value": 5}]
            sort: Optional sort code (e.g., "changePercAbove")

        Returns:
            List of scanner result dicts with conid, symbol, etc.
        """
        await self.ensure_accounts()
        body: dict = {
            "instrument": instrument,
            "type": scan_type,
            "location": location,
        }
        if filters:
            body["filter"] = filters
        if sort:
            body["sort"] = sort

        data = await self._request("POST", "/iserver/scanner/run", json=body)

        # IBKR returns: {"Contracts": {"Contract": [...]}} or a list
        if isinstance(data, dict):
            contracts = data.get("Contracts", data)
            if isinstance(contracts, dict):
                return contracts.get("Contract", [])
            return contracts if isinstance(contracts, list) else []
        return data if isinstance(data, list) else []

    # ── WebSocket (Step 1.6) ─────────────────────────────────
    # The IBKR WebSocket streams real-time market data.
    # Frontend connects to our FastAPI /ws endpoint.
    # We relay data from IBKR WS → our WS → frontend.

    def set_broadcast(self, callback: Callable[[dict], Awaitable[None]]) -> None:
        """Set the callback that sends data to all connected frontend clients."""
        self._broadcast = callback

    async def start_ibkr_websocket(self) -> None:
        """Start the background IBKR WebSocket connection loop."""
        if self._ws_task and not self._ws_task.done():
            log.info("IBKR WebSocket already running.")
            return
        if not self.state.session_token:
            log.warning("Cannot start WebSocket — no session token.")
            return
        self._ws_task = asyncio.create_task(self._ws_loop())
        log.info("IBKR WebSocket loop started.")

    async def stop_ibkr_websocket(self) -> None:
        """Stop the IBKR WebSocket connection."""
        if not self._ws_task or self._ws_task.done():
            return
        self.state.shutdown_event.set()
        if self.state.ibkr_ws:
            await self.state.ibkr_ws.close(code=1000, reason="Shutting down")
        try:
            await asyncio.wait_for(self._ws_task, timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            self._ws_task.cancel()
        self._ws_task = None
        log.info("IBKR WebSocket stopped.")

    async def ws_subscribe(self, conid: int) -> None:
        """Subscribe to real-time market data for a conid."""
        ws = self.state.ibkr_ws
        if not ws or not self.state.ws_connected:
            log.warning("Cannot subscribe — WebSocket not connected.")
            return
        fields_json = json.dumps({"fields": LIVE_STREAM_FIELDS})
        cmd = f"smd+{conid}+{fields_json}"
        await ws.send(cmd)
        self.state.ws_subscriptions.add(conid)
        log.info("Subscribed to conid %d", conid)

    async def ws_unsubscribe(self, conid: int) -> None:
        """Unsubscribe from real-time market data for a conid."""
        ws = self.state.ibkr_ws
        if not ws or not self.state.ws_connected:
            return
        await ws.send(f"umd+{conid}+{{}}")
        self.state.ws_subscriptions.discard(conid)
        log.info("Unsubscribed from conid %d", conid)

    async def _ws_loop(self) -> None:
        """
        Persistent WebSocket connection to IBKR gateway.
        Auto-reconnects on disconnect (unless shutdown is signaled).
        """
        gateway_ws_url = IBKR_GATEWAY_BASE_URL.replace("https", "wss")
        uri = f"{gateway_ws_url}/v1/api/ws"
        ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

        while not self.state.shutdown_event.is_set():
            heartbeat_task = None
            try:
                cookie = f'api={{"session":"{self.state.session_token}"}}'
                log.info("Connecting to IBKR WebSocket...")

                async with websockets.connect(
                    uri,
                    ssl=ssl_ctx,
                    compression=None,
                    ping_interval=None,
                    additional_headers=[("Cookie", cookie)],
                ) as ws:
                    self.state.ws_connected = True
                    self.state.ibkr_ws = ws
                    log.info("IBKR WebSocket connected.")

                    # Start heartbeat
                    heartbeat_task = asyncio.create_task(self._ws_heartbeat())

                    # Re-subscribe to any active subscriptions after reconnect
                    for conid in list(self.state.ws_subscriptions):
                        fields_json = json.dumps({"fields": LIVE_STREAM_FIELDS})
                        await ws.send(f"smd+{conid}+{fields_json}")

                    # Main receive loop
                    async for raw_msg in ws:
                        await self._process_ws_message(raw_msg)

            except websockets.exceptions.ConnectionClosed as exc:
                log.warning("IBKR WebSocket closed: %s", exc)
            except (OSError, ConnectionError, asyncio.TimeoutError) as exc:
                log.error("IBKR WebSocket error: %s", exc)
            finally:
                self.state.ws_connected = False
                self.state.ibkr_ws = None
                if heartbeat_task and not heartbeat_task.done():
                    heartbeat_task.cancel()

                if not self.state.shutdown_event.is_set():
                    log.info("Reconnecting IBKR WebSocket in 10s...")
                    await asyncio.sleep(10)

        log.info("IBKR WebSocket loop exited (shutdown signaled).")

    async def _ws_heartbeat(self) -> None:
        """Send 'tic' every 30s to keep the IBKR WebSocket alive."""
        while self.state.ws_connected:
            try:
                await asyncio.sleep(30)
                if self.state.ibkr_ws:
                    await self.state.ibkr_ws.send("tic")
            except (asyncio.CancelledError, websockets.exceptions.ConnectionClosed):
                break

    async def _process_ws_message(self, raw: str | bytes) -> None:
        """Parse an IBKR WebSocket message and broadcast to frontend."""
        if isinstance(raw, bytes):
            raw = raw.decode()
        try:
            msgs = json.loads(raw)
            if not isinstance(msgs, list):
                msgs = [msgs]

            for msg in msgs:
                if not isinstance(msg, dict):
                    continue
                topic = msg.get("topic", "")

                # Market data update (smd+{conid})
                if topic.startswith("smd+"):
                    await self._dispatch_market_data(msg)

        except (json.JSONDecodeError, UnicodeDecodeError):
            pass  # Heartbeat or malformed message — safe to ignore

    async def _dispatch_market_data(self, msg: dict) -> None:
        """
        Transform an IBKR smd message into a clean market data update
        and broadcast it to all connected frontend clients.
        """
        topic = msg.get("topic", "")
        try:
            conid = int(topic.split("+")[1])
        except (IndexError, ValueError):
            return

        # Extract price fields — IBKR uses string field codes as keys
        last_price = msg.get("31")
        if last_price is None:
            return  # No price update in this message

        # Build a clean update payload for the frontend
        update: dict[str, Any] = {
            "type": "market_data",
            "conid": conid,
            "timestamp": int(time.time()),
            "last": _safe_float(last_price),
            "bid": _safe_float(msg.get("84")),
            "ask": _safe_float(msg.get("86")),
            "change_pct": _safe_float(msg.get("83")),
            "change_amt": _safe_float(msg.get("82")),
            "high": _safe_float(msg.get("70")),
            "low": _safe_float(msg.get("71")),
            "volume": _safe_float(msg.get("7762")),
        }

        # Remove None values to keep payload clean
        update = {k: v for k, v in update.items() if v is not None}

        if hasattr(self, "_broadcast") and self._broadcast:
            await self._broadcast(update)

    # ── Lifecycle ────────────────────────────────────────────

    async def shutdown(self) -> None:
        """Clean shutdown — cancel background tasks, close HTTP client."""
        log.info("Shutting down IBKR service...")
        self.state.shutdown_event.set()
        await self._stop_tickle()
        await self.stop_ibkr_websocket()
        await self.http.aclose()
        log.info("IBKR service shut down.")


# ── Module-level helpers ─────────────────────────────────────


def _safe_float(value: Any) -> float | None:
    """Convert an IBKR field value to float, or None if invalid."""
    if value is None:
        return None
    try:
        result = float(value)
        # IBKR sometimes sends NaN
        if result != result:  # NaN check
            return None
        return result
    except (ValueError, TypeError):
        return None
