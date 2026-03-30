"""
IBKR Client Portal service — the single gateway to Interactive Brokers.
All IBKR communication goes through this class. Nothing else talks to IBKR directly.

Ported from MoonMarket with improvements:
  - Typed exceptions (no bare except)
  - Clean separation of auth logic
  - Prepared for WebSocket handler (Phase 1.6)
"""

import asyncio
import logging

import httpx

from config import IBKR_API_BASE_URL, IBKR_TICKLE_INTERVAL
from exceptions import (
    IBKRAuthError,
    IBKRConnectionError,
    IBKRRateLimitError,
    IBKRRequestError,
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

            except httpx.ConnectError as exc:
                log.error(
                    "IBKR connection error (attempt %d/%d): %s",
                    attempt + 1, max_retries, exc,
                )
                if attempt >= max_retries - 1:
                    raise IBKRConnectionError(
                        f"Cannot reach IBKR Gateway at {self.base_url}"
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
            except Exception as exc:
                log.error("Tickle loop error: %s", exc)
                await asyncio.sleep(5)  # Brief pause before retry

    # ── Lifecycle ────────────────────────────────────────────

    async def shutdown(self) -> None:
        """Clean shutdown — cancel background tasks, close HTTP client."""
        log.info("Shutting down IBKR service...")
        self.state.shutdown_event.set()
        await self._stop_tickle()
        # WebSocket shutdown will be added in step 1.6
        if self._ws_task and not self._ws_task.done():
            self._ws_task.cancel()
            try:
                await self._ws_task
            except asyncio.CancelledError:
                pass
        await self.http.aclose()
        log.info("IBKR service shut down.")
