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
import re
from typing import Any, Awaitable, Callable

# After this many consecutive tickle failures we declare the session dropped
# and broadcast a WS event so the frontend can prompt re-auth immediately.
TICKLE_FAIL_THRESHOLD = 3

import httpx
import websockets

from cache import cached
from config import (
    AUTH_STATUS_TTL_SEC,
    IBKR_API_BASE_URL,
    IBKR_GATEWAY_BASE_URL,
    IBKR_GATEWAY_HOST,
    IBKR_GATEWAY_PORT,
    IBKR_TICKLE_INTERVAL,
    PREFLIGHT_DELAY_MS,
)
from constants import DEFAULT_QUOTE_FIELDS_STR, LIVE_STREAM_FIELDS, SNAPSHOT_BATCH_SIZE
from exceptions import (
    IBKRAuthError,
    IBKRConnectionError,
    IBKRRateLimitError,
    IBKRRequestError,
    SymbolNotFoundError,
)
from ibkr_dumper import dump_if_first
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
        # Phase 8 / Task 1.5: optional SQLite cache for conid resolution.
        # Wired by main.py lifespan via set_db() after both services are
        # constructed. None when not wired — get_conid() degrades to the
        # current "always hit IBKR" path so tests that build a bare
        # IBKRService.__new__(IBKRService) don't break.
        self.db: Any = None
        # Per-(symbol, sec_type) lock to coalesce concurrent first-time
        # callers (5 simultaneous get_conid("AAPL") -> one IBKR search,
        # not five). Same pattern as the snapshot pre-flight locks.
        self._conid_resolve_locks: dict[tuple[str, str], asyncio.Lock] = {}
        # Phase 8 / Task 1.6: server-side request coalescing for hot
        # market-data endpoints. When N concurrent callers ask for the
        # same conid (or batch / history bar), only the first caller
        # actually hits IBKR — the rest await a shared asyncio.Future
        # and receive the same response. Self-cleaning: each future is
        # popped from the dict in the request's `finally` block, so a
        # subsequent call after the future resolves issues a fresh
        # IBKR request (no stale pinning).
        #
        #   * batch  — keyed by (sorted-conid-tuple, fields). Coalesces
        #              identical batch snapshots (e.g. two sector
        #              panels asking for the same 11 ETF conids).
        #   * single — keyed by (conid, fields). Coalesces single-conid
        #              fetches via the new `get_snapshot()` wrapper
        #              (Layer 1 of Task 1.6). Used by routes that
        #              fetch one conid at a time.
        #   * history — keyed by (conid, period, bar). Coalesces
        #              concurrent history fetches that miss the
        #              `@cached(ttl=300)` decorator (cold cache or
        #              first call after expiry).
        self._snapshot_batch_futures: dict[
            tuple[tuple[int, ...], str], asyncio.Future
        ] = {}
        self._snapshot_single_futures: dict[
            tuple[int, str], asyncio.Future
        ] = {}
        self._history_futures: dict[
            tuple[int, str, str], asyncio.Future
        ] = {}

        # Phase 8 / Task 1.7: server-side cache for /iserver/auth/status.
        # /gateway/status polls every 2s while not authenticated and each
        # poll currently fires an IBKR auth probe.  Cache the result for
        # AUTH_STATUS_TTL_SEC so concurrent / repeated callers in the same
        # window share a single probe.  Cache holds the FULL response dict
        # (`{"authenticated", "ws_ready", "message"}`) so callers see
        # bit-for-bit the same payload they'd get from a fresh probe.
        #
        # Invalidation:
        #   * `invalidate_auth_cache()` clears it explicitly.
        #   * `state.reset()` (logout / reset-session / factory-reset) clears
        #     it via the same helper called from the lifecycle paths.
        #   * The tickle loop calls invalidate_auth_cache() on every failure
        #     so the next poll re-probes IBKR instead of trusting a stale
        #     "authenticated: True" answer.
        #   * A True -> False auth flip inside auth_status() invalidates
        #     itself so the cached "False" doesn't linger past a re-auth.
        self._auth_cache: dict | None = None
        self._auth_cache_at: float = 0.0
        # Single-flight lock around the actual IBKR probe — prevents two
        # concurrent callers from both seeing a stale cache and both firing
        # a probe.  The cache check itself is outside the lock so the hot
        # path is lock-free.
        self._auth_cache_lock: asyncio.Lock = asyncio.Lock()

    def set_db(self, db: Any) -> None:
        """Wire a DatabaseService for the SQLite conid cache.

        Called by main.py lifespan after `db.initialize()`. Service
        keeps working without it (cache is opt-in). `Any` typed to
        avoid a circular import with services.db.
        """
        self.db = db

    def _ensure_auth_cache_attrs(self) -> None:
        """Lazy-init guard for tests that bypass __init__ via __new__.

        Mirrors the same pattern used by the snapshot-coalescing dicts in
        Task 1.6 — keeps existing fixtures (which build a bare service
        with `IBKRService.__new__(IBKRService)`) working without each one
        having to know about the new fields.
        """
        if not hasattr(self, "_auth_cache"):
            self._auth_cache = None
            self._auth_cache_at = 0.0
        if not hasattr(self, "_auth_cache_lock"):
            self._auth_cache_lock = asyncio.Lock()

    def invalidate_auth_cache(self) -> None:
        """Drop the cached auth-status payload.

        Called by:
          * the tickle loop on any failed tickle (so the next probe sees
            IBKR's actual state, not a stale "authenticated: True"),
          * `state.reset()` lifecycle paths (logout / reset-session /
            factory-reset) — wired below,
          * any future code path that knows the IBKR auth answer just
            changed under it.
        """
        self._ensure_auth_cache_attrs()
        self._auth_cache = None
        self._auth_cache_at = 0.0

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

        Phase 8 / Task 1.7: results are cached for AUTH_STATUS_TTL_SEC.
        Concurrent / repeated callers within the TTL share one IBKR probe.
        Cache invalidation: see `invalidate_auth_cache()`.
        """
        self._ensure_auth_cache_attrs()

        # Lock-free fast path: serve fresh cache without acquiring the lock.
        # AUTH_STATUS_TTL_SEC == 0 is the explicit opt-out (always probe).
        if AUTH_STATUS_TTL_SEC > 0 and self._auth_cache is not None:
            age = time.monotonic() - self._auth_cache_at
            if age < AUTH_STATUS_TTL_SEC:
                return dict(self._auth_cache)  # defensive copy

        # Slow path: lock so concurrent callers don't double-probe.  The
        # second arrival re-checks the cache after acquiring the lock —
        # if the first caller just populated it, we serve from cache and
        # skip the IBKR probe entirely.
        async with self._auth_cache_lock:
            if AUTH_STATUS_TTL_SEC > 0 and self._auth_cache is not None:
                age = time.monotonic() - self._auth_cache_at
                if age < AUTH_STATUS_TTL_SEC:
                    return dict(self._auth_cache)

            result = await self._probe_auth_status_uncached()

            # Only cache successful structured responses.  We skip caching
            # ConnectionError responses so the next poll can detect a
            # gateway-recovery quickly (5s feels long when the gateway
            # just came back up).  Auth-False results from IBKR (logged
            # out, 401) ARE cached — they're stable for 5s and dominate
            # the polling cost while needsLogin is true.
            if AUTH_STATUS_TTL_SEC > 0 and not result.get("_no_cache"):
                self._auth_cache = dict(result)
                self._auth_cache_at = time.monotonic()
            # Strip the internal flag before returning to callers.
            result.pop("_no_cache", None)
            return result

    async def _probe_auth_status_uncached(self) -> dict:
        """Actually hit IBKR for auth status — bypasses cache entirely.

        Extracted from `auth_status()` so the cache wrapper above stays
        readable.  This is the original Task 1.2 / Bug A logic, unchanged
        in behavior except for one addition: when the gateway is
        unreachable we tag the response with `_no_cache: True` so the
        cache wrapper above doesn't pin a "gateway down" answer for 5s
        (the user might recover the gateway in less time than that).
        """
        try:
            data = await self._request("POST", "/iserver/auth/status")
            is_authenticated = data.get("authenticated", False)
            is_connected = data.get("connected", False)
            is_valid = is_authenticated and is_connected

            was_authenticated = self.state.authenticated
            self.state.authenticated = is_valid
            if is_valid:
                # Clear any prior disconnect flag — user successfully re-authed
                self.state.session_dropped = False
                self.state.tickle_fail_count = 0
                # Cold-start protocol: IBKR requires /iserver/accounts to be
                # called before /iserver/marketdata/snapshot and order
                # endpoints respond correctly. Bootstrap on the first
                # False -> True transition (or anytime accounts haven't been
                # fetched yet — covers state.reset() between probes).
                # ensure_accounts is idempotent and self-caches.
                if not was_authenticated or not self.state.accounts_fetched:
                    try:
                        await self.ensure_accounts()
                    except IBKRRequestError as exc:
                        # Don't block auth on a transient /iserver/accounts
                        # failure — log + carry on. The next auth probe (or
                        # any market-data call) will retry via the same
                        # idempotent path.
                        log.warning(
                            "ensure_accounts() failed during auth bootstrap: %s",
                            exc,
                        )
            else:
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
            # Bug A: if we were previously authenticated, flip the session_dropped
            # flag and broadcast a WS event so the frontend reacts immediately
            # — don't wait for the slow tickle loop to eventually trip the
            # threshold (~165s). This covers the case where the user kills the
            # gateway mid-session: the next /gateway/status poll will try
            # auth_status, which fails here, and we announce the drop.
            was_authenticated = self.state.authenticated
            self.state.authenticated = False
            if was_authenticated and not self.state.session_dropped:
                self.state.session_dropped = True
                self.state.tickle_fail_count = TICKLE_FAIL_THRESHOLD
                log.warning(
                    "auth_status: gateway unreachable while previously authenticated"
                    " — declaring session_dropped and broadcasting."
                )
                if hasattr(self, "_broadcast") and self._broadcast:
                    try:
                        await self._broadcast({"type": "session_dropped"})
                    except (OSError, ConnectionError) as exc:
                        log.warning("Failed to broadcast session_dropped: %s", exc)
            return {
                "authenticated": False,
                "ws_ready": False,
                "message": (
                    f"Cannot reach IBKR Gateway. "
                    f"Is it running on {IBKR_GATEWAY_HOST}:{IBKR_GATEWAY_PORT}?"
                ),
                # Task 1.7: don't cache "gateway unreachable" — the user
                # may bring the gateway back up in <5s and we want the
                # next poll to discover that immediately.
                "_no_cache": True,
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
        """Fetch and cache the list of brokerage accounts.

        IBKR requires /iserver/accounts to be called before /iserver/marketdata
        /snapshot and the order endpoints will respond correctly. Idempotent
        once `state.accounts_fetched` is True; cleared by `state.reset()`.
        Stores both the account-id list and the response's `selectedAccount`
        (used implicitly by IBKR for endpoints that omit an explicit acctId).

        Phase 8 hotfix (2026-05-02): IBKR sometimes returns 200 OK with an
        empty `accounts: []` body when the brokerage session is freshly
        authenticated but not yet fully attached. Previously we marked the
        cache "fetched" anyway and never retried — leaving downstream
        snapshot calls running against an account list that never
        populated. Now we only mark fetched when the response actually
        contains at least one account ID. An empty/missing response is
        logged and left unfetched so the next auth probe retries.
        """
        if self.state.accounts_fetched:
            return
        data = await self._request("GET", "/iserver/accounts")
        # Defensive copy: state.reset() calls self.accounts.clear() which
        # mutates the list in place. Without copying, that clears the
        # caller's response dict too — tests with fixture closures get
        # silently emptied between probes.
        accounts = list(data.get("accounts") or [])
        selected = data.get("selectedAccount")
        if not accounts:
            # Don't pin a permanent empty cache — IBKR's brokerage session
            # may still be attaching. Caller (auth_status) will probe
            # again on the next /gateway/status or /auth/status tick.
            log.warning(
                "ensure_accounts(): /iserver/accounts returned empty list "
                "(selected=%s) — leaving accounts_fetched=False to retry "
                "on next probe",
                selected,
            )
            return
        self.state.accounts = accounts
        self.state.selected_account = selected
        self.state.accounts_fetched = True
        log.info(
            "Fetched %d IBKR account(s); selected=%s",
            len(accounts),
            self.state.selected_account,
        )

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
            # Task 1.7: drop cached "authenticated: True" so the next probe
            # sees the actual logged-out state, not a stale cache.
            self.invalidate_auth_cache()
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
        """Background loop — calls tickle every N seconds.

        Consecutive failures increment state.tickle_fail_count.  Once the count
        reaches TICKLE_FAIL_THRESHOLD we mark the session as dropped and
        broadcast a ``session_dropped`` WS event so the frontend can prompt
        the user to re-authenticate immediately (no polling delay).
        """
        while True:
            try:
                await asyncio.sleep(IBKR_TICKLE_INTERVAL)
                success = await self.tickle()
                if success:
                    # Reset failure tracking on any successful tickle
                    self.state.tickle_fail_count = 0
                    self.state.session_dropped = False
                else:
                    self.state.tickle_fail_count += 1
                    # Task 1.7: a failed tickle means IBKR's view of our
                    # session may have changed.  Drop any cached
                    # "authenticated: True" so the next /gateway/status
                    # poll re-probes IBKR and gets the truth.
                    self.invalidate_auth_cache()
                    log.warning(
                        "Tickle failed (%d/%d) — IBKR session may have expired.",
                        self.state.tickle_fail_count,
                        TICKLE_FAIL_THRESHOLD,
                    )
                    if (
                        self.state.tickle_fail_count >= TICKLE_FAIL_THRESHOLD
                        and not self.state.session_dropped
                    ):
                        self.state.session_dropped = True
                        log.error(
                            "IBKR session declared dropped after %d consecutive"
                            " tickle failures. Broadcasting session_dropped event.",
                            self.state.tickle_fail_count,
                        )
                        if hasattr(self, "_broadcast") and self._broadcast:
                            await self._broadcast({"type": "session_dropped"})
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

    async def get_conid(
        self,
        symbol: str,
        sec_type: str = "",
        force_refresh: bool = False,
    ) -> int:
        """
        Resolve a ticker symbol to an IBKR conid.
        Raises SymbolNotFoundError if not found.

        Args:
          symbol:   The ticker to resolve (e.g. "GLD", "USD.ILS", "XAUUSD").
          sec_type: Optional IBKR secType hint. When provided, we only
                    consider matches whose `sections[].secType` contains
                    this value — e.g. pass "STK" to prevent GLD matching
                    the Hong Kong Gold Futures contract (marked IND).
                    Must be one of IBKR's searchable secTypes ("STK",
                    "IND", "BOND") or "" to apply no filter.
          force_refresh: When True, bypass the SQLite conid cache and
                    re-resolve from IBKR (still writes the result back
                    so the next call uses the fresh value). Intended for
                    one-off scripts / admin endpoints — production code
                    should never set this.

        Phase 8 / Task 1.5: results are persisted in SQLite via
        `db.upsert_cached_conid` so a fresh app start pays ~1ms instead
        of the 10–13s IBKR resolution cost. Concurrent first-time
        callers for the same (symbol, sec_type) coalesce on a per-key
        asyncio.Lock so only one IBKR search runs.
        """
        symbol_upper = symbol.upper()
        sec_type_upper = sec_type.upper()

        def _populate_state(conid: int, asset_class: str) -> None:
            """Mirror cached/resolved (symbol, asset_class) into state so
            the snapshot pre-warm path (Task 1.4) has it without a DB
            round-trip on every snapshot."""
            if asset_class:
                self.state.conid_asset_class[conid] = (
                    symbol_upper,
                    asset_class.upper(),
                )

        # Fast path: SQLite cache hit, no lock needed.
        if not force_refresh and self.db is not None:
            cached = await self.db.get_cached_conid(symbol_upper, sec_type_upper)
            if cached:
                conid = int(cached["conid"])
                _populate_state(conid, cached["asset_class"] or "")
                return conid

        # Coalesce concurrent first-time callers on a per-key lock so 5
        # simultaneous get_conid("AAPL") -> 1 IBKR search, not 5.
        key = (symbol_upper, sec_type_upper)
        lock = self._conid_resolve_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._conid_resolve_locks[key] = lock

        async with lock:
            # Re-check inside the lock — another caller may have just
            # resolved this same (symbol, sec_type).
            if not force_refresh and self.db is not None:
                cached = await self.db.get_cached_conid(symbol_upper, sec_type_upper)
                if cached:
                    conid = int(cached["conid"])
                    _populate_state(conid, cached["asset_class"] or "")
                    return conid

            conid, asset_class = await self._resolve_conid_from_ibkr(
                symbol, sec_type
            )

            # Write SQLite cache so the next session skips IBKR entirely.
            if self.db is not None:
                await self.db.upsert_cached_conid(
                    symbol=symbol_upper,
                    sec_type=sec_type_upper,
                    conid=conid,
                    asset_class=asset_class,
                )

            _populate_state(conid, asset_class)
            return conid

    async def _resolve_conid_from_ibkr(
        self, symbol: str, sec_type: str = ""
    ) -> tuple[int, str]:
        """
        Phase 8 / Task 1.5: extracted from the original `get_conid` body.
        Always hits IBKR (no caching) and returns the chosen
        (conid, asset_class). The public `get_conid` wraps this with a
        SQLite cache + per-key lock-coalescing layer.

        Implementation notes (unchanged from prior get_conid):
          - IBKR search responses are mixed: dict rows, bare strings, and
            sometimes error envelopes. We only consider dict candidates
            with a valid top-level conid.
          - When the caller provides an explicit sec_type hint, we honour
            it strictly and require that section type to appear on the match.
          - Without a hint, we do one unfiltered search and rank matches by:
              1. exact symbol match
              2. inferred asset-class preference for known patterns
                 (e.g. BTC → CRYPTO, XAUUSD → CMDTY, USD.ILS → CASH)
              3. preferred exchange for common stock/ETF symbols
        """
        preferred_exchanges = (
            "ARCA",
            "NASDAQ",
            "NYSE",
            "CBOE",
            "BATS",
            "AMEX",
            "IDEALPRO",
            "PAXOS",
        )
        symbol_upper = symbol.upper()

        def _section_sec_types(item: dict[str, Any]) -> set[str]:
            out: set[str] = set()
            sections = item.get("sections")
            if isinstance(sections, list):
                for sec in sections:
                    if not isinstance(sec, dict):
                        continue
                    sec_value = sec.get("secType")
                    if isinstance(sec_value, str) and sec_value:
                        out.add(sec_value.upper())
            top_level = item.get("secType")
            if isinstance(top_level, str) and top_level:
                out.add(top_level.upper())
            return out

        def _normalize_conid(raw: Any) -> int | None:
            try:
                value = int(raw)
            except (TypeError, ValueError):
                return None
            return value if value > 0 else None

        def _infer_preferred_sec_types() -> tuple[str, ...]:
            if sec_type:
                return (sec_type.upper(),)
            if symbol_upper in {"BTC", "ETH"}:
                return ("CRYPTO", "STK")
            if symbol_upper in {"XAUUSD", "XAGUSD"}:
                return ("CMDTY",)
            if symbol_upper in {"SPX", "VIX", "NDX", "RUT", "DXY"}:
                return ("IND", "STK")
            if re.fullmatch(r"[A-Z]{3}\.[A-Z]{3}", symbol_upper):
                return ("CASH",)
            return ("STK", "IND", "BOND")

        def _exchange_rank(item: dict[str, Any]) -> int:
            values: list[str] = []
            description = item.get("description")
            if isinstance(description, str) and description:
                values.append(description.upper())
            sections = item.get("sections")
            if isinstance(sections, list):
                for sec in sections:
                    if not isinstance(sec, dict):
                        continue
                    exchange = sec.get("exchange")
                    if isinstance(exchange, str) and exchange:
                        values.extend(part.upper() for part in exchange.split(";") if part)
            for rank, exchange in enumerate(preferred_exchanges):
                if exchange in values:
                    return rank
            return len(preferred_exchanges)

        preferred_sec_types = _infer_preferred_sec_types()
        search_results = await self.search(symbol, sec_type=sec_type.upper())
        if not isinstance(search_results, list):
            raise SymbolNotFoundError(symbol)

        # Track each candidate's chosen asset_class alongside its conid so
        # we can populate state.conid_asset_class for the winner. The
        # asset_class is the first preferred secType that matched (or, if
        # no preferences matched, any secType the section reports).
        candidates: list[tuple[tuple[int, int, int], int, str]] = []
        for item in search_results:
            if not isinstance(item, dict):
                continue
            conid = _normalize_conid(item.get("conid"))
            if conid is None:
                continue
            item_symbol = str(item.get("symbol") or "").upper()
            item_sec_types = _section_sec_types(item)
            if sec_type and sec_type.upper() not in item_sec_types:
                continue

            sec_rank = len(preferred_sec_types)
            chosen_class = ""
            for idx, preferred in enumerate(preferred_sec_types):
                if preferred in item_sec_types:
                    sec_rank = idx
                    chosen_class = preferred
                    break
            if not chosen_class and item_sec_types:
                # No preferred match — pick any reported secType so we
                # still have an asset_class label for secdef pre-warm.
                chosen_class = next(iter(item_sec_types))

            score = (
                0 if item_symbol == symbol_upper else 1,
                sec_rank,
                _exchange_rank(item),
            )
            candidates.append((score, conid, chosen_class))

        if not candidates:
            raise SymbolNotFoundError(symbol)

        winner = min(candidates, key=lambda c: c[0])
        chosen_conid = winner[1]
        chosen_asset_class = (winner[2] or "").upper()
        # State and SQLite cache population happens in the public
        # `get_conid` wrapper — this helper only resolves and returns.
        return chosen_conid, chosen_asset_class

    # Asset classes that require /iserver/secdef/search before snapshot
    # subscriptions succeed. The IBKR docs literally cover only "derivative
    # contracts" (OPT/FOP/WAR/FUT in IBKR's vocabulary), but empirical
    # observation shows CASH (forex), CRYPTO, IND, BOND, FUND also fail to
    # populate snapshot fields without the warm-up. STK and ETF are the
    # documented happy path and are excluded.
    #
    # Note: the /iserver/secdef/search doc lists only {STK, IND, BOND} as
    # documented `secType` values. We pass the broader set anyway and
    # rely on graceful failure handling in `_ensure_secdef` if IBKR
    # rejects an undocumented value. See Phase 8 plan, Task 1.4 footnote.
    _SECDEF_PREWARM_CLASSES: frozenset[str] = frozenset({
        "CASH",   # forex
        "FUT",    # futures
        "OPT",    # options
        "FOP",    # futures options
        "WAR",    # warrants
        "BOND",   # bonds
        "FUND",   # mutual funds
        "IND",    # indices (e.g. VIX)
        "CRYPTO", # crypto pairs
    })

    async def _ensure_secdef(
        self,
        conid: int,
        symbol: str,
        asset_class: str,
    ) -> None:
        """Pre-warm IBKR's security-definition cache for a non-STK contract.

        Per IBKR docs (Snapshot endpoint): "For derivative contracts the
        endpoint /iserver/secdef/search must be called first."

        Behavior:
          - No-op if `asset_class` is STK/ETF/empty (documented happy path).
          - No-op if `conid` is already in `state.secdef_warmed` — even if
            the previous attempt 4xx'd, we don't retry every snapshot.
          - Coalesces concurrent first-time callers via per-conid lock.
          - On IBKRRequestError (e.g. 4xx for an undocumented secType
            value), logs a warning and marks the conid warmed anyway so
            the failure doesn't repeat. The downstream snapshot pre-flight
            (Task 1.3) still runs — secdef-warm is best-effort.
        """
        if asset_class.upper() not in self._SECDEF_PREWARM_CLASSES:
            return
        if conid in self.state.secdef_warmed:
            return

        lock = self.state.secdef_locks.get(conid)
        if lock is None:
            lock = asyncio.Lock()
            self.state.secdef_locks[conid] = lock

        async with lock:
            if conid in self.state.secdef_warmed:
                return
            try:
                await self._request(
                    "GET",
                    "/iserver/secdef/search",
                    params={
                        "symbol": symbol,
                        "secType": asset_class.upper(),
                    },
                )
            except IBKRRequestError as exc:
                # Undocumented secType values (CASH, CRYPTO, OPT, etc.)
                # may be rejected by IBKR — log + carry on so the
                # snapshot pre-flight still runs. Mark warmed to avoid
                # retrying the same failing call on every snapshot.
                log.warning(
                    "secdef pre-warm failed for conid=%d symbol=%s class=%s: %s",
                    conid, symbol, asset_class, exc,
                )
            self.state.secdef_warmed.add(conid)

    def _ensure_coalescing_dicts(self) -> None:
        """Lazy-init the Task 1.6 coalescing dicts.

        Existing tests build `IBKRService.__new__(IBKRService)` and set
        only a handful of attributes. To avoid breaking every such test
        fixture each time we add a new coalescing dict, we lazy-init
        here at the entry point of every coalesced method. Cheap (3
        `hasattr` checks per call) and keeps test surface minimal.
        """
        if not hasattr(self, "_snapshot_batch_futures"):
            self._snapshot_batch_futures = {}
        if not hasattr(self, "_snapshot_single_futures"):
            self._snapshot_single_futures = {}
        if not hasattr(self, "_history_futures"):
            self._history_futures = {}

    async def _preflight_snapshot(self, conid: int, fields: str) -> None:
        """Run IBKR's documented "pre-flight" snapshot for a fresh conid.

        Per IBKR docs (Snapshot endpoint): "A pre-flight request must be
        made prior to ever receiving data. For some fields, it may take
        more than a few moments to receive information."

        Behavior:
          - Idempotent: if `conid` is already in `state.warmed_conids`, return
            immediately without issuing any IBKR call.
          - Coalesced: a per-conid asyncio.Lock ensures that 5 concurrent
            callers for a fresh conid only run one pre-flight (the other 4
            await the lock, then re-check `warmed_conids` and skip).
          - Marks the conid as warmed AFTER the pre-flight request returns
            and we have slept `PREFLIGHT_DELAY_MS` so IBKR has time to
            populate the cache.
        """
        if conid in self.state.warmed_conids:
            return

        # Lazily allocate a per-conid lock so concurrent callers for the
        # same fresh conid only run one pre-flight. The dict lives on
        # state and is cleared by state.reset().
        lock = self.state.preflight_locks.get(conid)
        if lock is None:
            lock = asyncio.Lock()
            self.state.preflight_locks[conid] = lock

        async with lock:
            # Re-check inside the lock — another caller may have just
            # warmed this conid while we waited.
            if conid in self.state.warmed_conids:
                return
            await self._request(
                "GET",
                "/iserver/marketdata/snapshot",
                params={"conids": str(conid), "fields": fields},
            )
            await asyncio.sleep(PREFLIGHT_DELAY_MS / 1000.0)
            self.state.warmed_conids.add(conid)

    async def snapshot(
        self,
        conids: list[int],
        fields: str = DEFAULT_QUOTE_FIELDS_STR,
    ) -> list[dict]:
        """
        Get a market data snapshot for one or more conids.

        Cold-start protocol (Phase 8 / Task 1.3):
          1. For each conid in `conids` not yet in `state.warmed_conids`,
             run a pre-flight (one IBKR call + PREFLIGHT_DELAY_MS sleep).
             Concurrent callers for the same fresh conid coalesce via a
             per-conid asyncio.Lock so only one pre-flight runs.
          2. Issue ONE real /iserver/marketdata/snapshot call for the full
             `conids` list and return the response.

        Args:
            conids: IBKR contract IDs to fetch.
            fields: Comma-separated field codes to request.

        Note (Phase 8 follow-up): the previous version of this method took
        `timeout`, `poll_interval`, and `required_fields` and looped until
        IBKR populated the requested fields. That pattern is replaced by
        the documented pre-flight + delay above. `required_fields` may be
        re-introduced in a future task as a post-call quality validator
        (see Phase 8 plan, Task 1.3 footnote) — pre-flight handles cache
        warm-up; `required_fields` would handle "row still has missing
        fields after pre-flight" diagnostics. For now, callers that need
        that guarantee (e.g. screener) own the check themselves.

        ────────────────────────────────────────────────────────────
        SAMPLE RESPONSE (from /iserver/marketdata/snapshot, fields=31,55,83,7762,7051):
        ────────────────────────────────────────────────────────────
        [
          {
            "server_id": "q0",
            "conid": 265598,
            "conidEx": "265598",
            "_updated": 1719446872109,
            "6119": "q0",
            "6509": "RB",                # market-data availability flag
            "55": "AAPL",                # symbol
            "7051": "APPLE INC",         # company name
            "31": "214.29",              # last price (STRING — parse to float)
            "83": "+1.42",               # % change (STRING, may start with + or -)
            "7762": "52100000"           # volume long (STRING, high precision)
          },
          ...
        ]

        Field notes:
          - ALL values come back as STRINGS — must _safe_float on read.
          - "87" (formatted volume) arrives as "52.1M" / "900K". Prefer "7762"
            for parsing.
          - "7289" (market cap) is NOT on IBKR's documented fields list. Don't
            put it in `fields`. Use the contract endpoint
            (/iserver/contract/{conid}/info → `marketCap`) instead.
            See backend/docs/ibkr_market_data_fields.md.
        """
        await self.ensure_accounts()
        self._ensure_coalescing_dicts()

        # Cold-start protocol order (Phase 8):
        #   1. /iserver/secdef/search for non-STK conids whose asset_class
        #      is in _SECDEF_PREWARM_CLASSES (Task 1.4) — best-effort,
        #      failures don't block.
        #   2. /iserver/marketdata/snapshot pre-flight + sleep (Task 1.3).
        #   3. Real bulk snapshot call (Task 1.6 coalesces this layer).
        # Each step is per-conid lock-coalesced, so concurrent snapshot()
        # callers for the same fresh conid only run one of each step.
        cold = [c for c in conids if c not in self.state.warmed_conids]

        # Step 1: secdef pre-warm for any cold non-STK conid we have an
        # asset_class for. Conids with no cached asset_class fall through
        # (treated as STK / unknown — _ensure_secdef is a no-op for STK).
        secdef_targets = []
        for c in cold:
            mapping = self.state.conid_asset_class.get(c)
            if mapping is None:
                continue
            sym, cls = mapping
            secdef_targets.append((c, sym, cls))
        if secdef_targets:
            await asyncio.gather(
                *(self._ensure_secdef(c, sym, cls) for c, sym, cls in secdef_targets)
            )

        # Step 2: snapshot pre-flight for every cold conid (regardless of
        # asset class). Runs in parallel; per-conid lock coalesces.
        if cold:
            await asyncio.gather(
                *(self._preflight_snapshot(c, fields) for c in cold)
            )

        # Step 3: real bulk call(s) after every cold conid has been warmed.
        # Phase 8 / Task 2.1 — chunk into ≤ SNAPSHOT_BATCH_SIZE per IBKR
        # call. IBKR's documented hard cap is 50; larger requests risk
        # silent truncation. Chunks fire in parallel via asyncio.gather
        # and results are concatenated in input order.
        if len(conids) <= SNAPSHOT_BATCH_SIZE:
            return await self._snapshot_chunk_request(conids, fields)

        chunks = [
            conids[i : i + SNAPSHOT_BATCH_SIZE]
            for i in range(0, len(conids), SNAPSHOT_BATCH_SIZE)
        ]
        chunk_results = await asyncio.gather(
            *(self._snapshot_chunk_request(chunk, fields) for chunk in chunks)
        )
        # Flatten chunk responses preserving order.
        return [row for sublist in chunk_results for row in sublist]

    async def _snapshot_chunk_request(
        self,
        conids: list[int],
        fields: str,
    ) -> list[dict]:
        """One IBKR /iserver/marketdata/snapshot call for ≤50 conids.

        Task 1.6 — batch coalescing: when 5 concurrent callers ask for
        the *same* (sorted conids, fields) tuple, only the first fires
        the real /iserver/marketdata/snapshot request; the other 4
        await the shared asyncio.Future and receive the same list back.
        The future is popped in the `finally` block so the next call
        after it resolves issues a fresh IBKR request (no stale pin).
        Chunks with different conid sets do NOT coalesce — that's the
        Layer 1 case handled by `get_snapshot()` (singular).

        Caller (`snapshot()`) is responsible for pre-flight + warming;
        this helper only executes the real bulk call.
        """
        batch_key = (tuple(sorted(conids)), fields)
        existing_fut = self._snapshot_batch_futures.get(batch_key)
        if existing_fut is not None:
            return await existing_fut

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._snapshot_batch_futures[batch_key] = fut

        try:
            params = {
                "conids": ",".join(str(c) for c in conids),
                "fields": fields,
            }
            response = await self._request(
                "GET", "/iserver/marketdata/snapshot", params=params
            )
            if not isinstance(response, list):
                response = []
            dump_if_first("marketdata_snapshot", response)
            if not fut.done():
                fut.set_result(response)
            return response
        except BaseException as exc:
            # Propagate the exception to every awaiter, then let the
            # finally block clear the dict entry so future callers
            # retry fresh (no stale failure pinned).
            if not fut.done():
                fut.set_exception(exc)
            raise
        finally:
            # Pop only if the dict still points at our future — defensive
            # against any future swap-in scenarios. Suppresses the
            # "Future exception was never retrieved" log if no other
            # caller awaited a failed future.
            current = self._snapshot_batch_futures.get(batch_key)
            if current is fut:
                self._snapshot_batch_futures.pop(batch_key, None)
            if fut.done() and fut.exception() is not None:
                # Touch the exception so asyncio doesn't log
                # "Future exception was never retrieved" when no
                # waiter joined this future.
                try:
                    fut.exception()
                except (asyncio.InvalidStateError, asyncio.CancelledError):
                    pass

    async def get_snapshot(
        self,
        conid: int,
        fields: str = DEFAULT_QUOTE_FIELDS_STR,
    ) -> dict | None:
        """Coalesce concurrent single-conid snapshot fetches (Phase 8 / Task 1.6, Layer 1).

        Layer 1 (singular) of the request-coalescing pattern: when 10
        callers each ask `get_snapshot(99)` simultaneously, only one of
        them actually invokes the underlying `snapshot([99])` — the
        others await a shared `asyncio.Future` keyed by `(conid, fields)`
        and receive the same row. Useful for routes that fetch one conid
        at a time (e.g. `/market/quote/:id`) where the dashboard mount
        can hammer the same conid from MarketPulse + Watchlist + Trigger
        within the same 200ms window.

        Returns the row matching `conid` from the IBKR response, or
        `None` if IBKR didn't include it (unusual — typically means a
        bad conid or a still-cold derivative contract that even the
        Task 1.4 secdef pre-warm couldn't rescue).

        Note: the underlying `snapshot([conid], fields)` call goes
        through Layer 2 batch coalescing too. So a single-conid future
        + a batch-of-one future may both exist briefly, but in steady
        state only one IBKR call leaves the box.
        """
        self._ensure_coalescing_dicts()
        single_key = (conid, fields)
        existing_fut = self._snapshot_single_futures.get(single_key)
        if existing_fut is not None:
            return await existing_fut

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._snapshot_single_futures[single_key] = fut

        try:
            rows = await self.snapshot([conid], fields)
            # IBKR responses sometimes lack `conid` on rows (early
            # pre-flight returns) — tolerate by checking str/int.
            match: dict | None = None
            for row in rows:
                row_conid = row.get("conid")
                try:
                    if row_conid is not None and int(row_conid) == conid:
                        match = row
                        break
                except (TypeError, ValueError):
                    continue
            if not fut.done():
                fut.set_result(match)
            return match
        except BaseException as exc:
            if not fut.done():
                fut.set_exception(exc)
            raise
        finally:
            current = self._snapshot_single_futures.get(single_key)
            if current is fut:
                self._snapshot_single_futures.pop(single_key, None)
            if fut.done() and fut.exception() is not None:
                try:
                    fut.exception()
                except (asyncio.InvalidStateError, asyncio.CancelledError):
                    pass

    @cached(ttl=300)
    async def history(
        self,
        conid: int,
        period: str = "1m",
        bar: str = "30min",
    ) -> dict:
        """Get historical OHLCV candle data.

        Returns raw IBKR response with 'data' list of bars.

        Phase 8 / Task 1.6 — request coalescing layered with `@cached`:

          1. The outer `@cached(ttl=300)` decorator handles warm-cache
             hits: the second call within 5 minutes returns instantly.
          2. On cache MISS, the body below coalesces concurrent first
             callers via a `(conid, period, bar)` future. 5 simultaneous
             callers for the same fresh `(conid, "5d", "5min")` issue
             ONE IBKR call; the other 4 await the shared future and
             receive the same response.
          3. The future is popped in the `finally` block so a fresh
             call after it resolves issues a new request (no stale pin).

        Failures propagate the same exception to every awaiter, but
        the future is cleared so the next call retries fresh.
        """
        await self.ensure_accounts()
        self._ensure_coalescing_dicts()

        history_key = (conid, period, bar)
        existing_fut = self._history_futures.get(history_key)
        if existing_fut is not None:
            return await existing_fut

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._history_futures[history_key] = fut

        try:
            params = {
                "conid": conid,
                "period": period,
                "bar": bar,
                "outsideRth": "true",
            }
            result = await self._request(
                "GET", "/iserver/marketdata/history", params=params
            )
            dump_if_first("marketdata_history", result)
            if not fut.done():
                fut.set_result(result)
            return result
        except BaseException as exc:
            if not fut.done():
                fut.set_exception(exc)
            raise
        finally:
            current = self._history_futures.get(history_key)
            if current is fut:
                self._history_futures.pop(history_key, None)
            if fut.done() and fut.exception() is not None:
                try:
                    fut.exception()
                except (asyncio.InvalidStateError, asyncio.CancelledError):
                    pass

    @cached(ttl=3600)
    async def contract_info(self, conid: int) -> dict:
        """
        Fetch full contract details for a conid.
        Returns exchange, currency, sector, industry, etc.
        Used by the screener quick-peek slide-over AND as the market-cap
        fallback when /iserver/marketdata/snapshot field 7289 is missing.

        ────────────────────────────────────────────────────────────
        SAMPLE RESPONSE (from /iserver/contract/{conid}/info for AAPL):
        ────────────────────────────────────────────────────────────
        {
          "conid": 265598,
          "company_name": "APPLE INC",
          "company_header": "APPLE INC - NASDAQ",
          "exchange": "NASDAQ",
          "listing_exchange": "NASDAQ",
          "symbol": "AAPL",
          "instrument_type": "STK",
          "currency": "USD",
          "category": "Computers",
          "industry": "Computer Hardware",
          "rule": true,
          "valid_exchanges": "SMART,AMEX,NYSE,CBOE,...",
          "allow_sell_long": true,
          "is_zero_commission_security": false,
          "contract_clarification_type": null,
          "underConid": 0,
          "r_t_h": true,
          "marketCap": "3285420"          # STRING, in MILLIONS — same unit as snapshot 7289
        }

        Field notes:
          - `marketCap` is a STRING in MILLIONS (so "3285420" = $3.285T). Parse
            with `_safe_float` and keep as-is — the frontend already formats
            millions for display.
          - Values are cached by IBKR at ~1h granularity; our @cached(ttl=3600)
            matches. This is more stable than snapshot 7289 which is derived
            live and frequently drops fields.
          - Not every instrument has `marketCap` (indices, some ETFs, futures).
            Missing value ⇒ `_safe_float` returns None ⇒ row just keeps None.
        """
        await self.ensure_accounts()
        result = await self._request("GET", f"/iserver/contract/{conid}/info")
        dump_if_first("contract_info", result)
        return result

    # ── Watchlist Methods (Step 3.5) ───────────────────────────

    @cached(ttl=60)
    async def get_watchlists(self) -> list[dict]:
        """
        Fetch all IBKR watchlists for the authenticated user.
        Returns list of {id, name} dicts.

        IBKR Client Portal /iserver/watchlists returns:
          {
            "data": {
              "scanners_only": false,
              "show_scanners": false,
              "bulk_delete": false,
              "user_lists": [ { "id": "...", "name": "...", "type": "..." }, ... ]
            },
            "action": "content",
            "MID": "..."
          }

        We defensively handle older / alternate shapes too:
          - {"user_lists": [...]}        (flat, no "data" wrapper)
          - {"data": [...]}              (simplified, list under "data")
          - [...]                        (direct list)

        Any non-dict entries are filtered out so downstream code can safely
        call `.get()` on every item (fixes the 'str has no attribute .get' 500).
        """
        await self.ensure_accounts()
        data = await self._request("GET", "/iserver/watchlists")

        # Unwrap to a list of watchlist dicts
        lists: list = []
        if isinstance(data, dict):
            inner = data.get("data", data)
            if isinstance(inner, dict):
                lists = inner.get("user_lists", []) or []
            elif isinstance(inner, list):
                lists = inner
        elif isinstance(data, list):
            lists = data

        # Defense in depth: filter out any non-dict items (strings, None, etc.)
        return [wl for wl in lists if isinstance(wl, dict)]

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

    # ── Watchlist Mutation Methods (Phase 6.3) ────────────────
    #
    # IBKR has no atomic "add one item" endpoint.  The only way to modify a
    # watchlist is the read → modify → delete → recreate pattern:
    #
    #   1.  GET  /iserver/watchlists          → find ID by name
    #   2.  GET  /iserver/watchlist?id=<id>   → read current rows
    #   3.  Modify the rows list in-memory
    #   4.  DELETE /iserver/watchlist?id=<id> → remove the old list
    #   5.  POST /iserver/watchlist            → recreate with new rows
    #
    # IBKR assigns a new ID on every POST, so we always look up watchlists
    # by *name*, never by ID across calls.  The get_watchlists() cache is
    # invalidated after every mutation so the next lookup gets fresh IDs.

    async def resolve_watchlist_id(self, name: str) -> str | None:
        """
        Find an IBKR watchlist's numeric ID by its display name.
        Returns None if no watchlist with that name exists.

        Bypasses the @cached TTL by re-fetching if a fresh lookup is needed
        — call after any mutation to get the new IDs.
        """
        watchlists = await self.get_watchlists()
        for wl in watchlists:
            if wl.get("name") == name:
                return str(wl.get("id", ""))
        return None

    async def get_watchlist_raw(self, watchlist_id: str) -> dict:
        """
        Fetch a single watchlist's full raw response.
        Used internally before mutations — not cached so reads are always fresh.
        """
        await self.ensure_accounts()
        return await self._request(
            "GET", "/iserver/watchlist", params={"id": watchlist_id}
        )

    @staticmethod
    def _extract_rows_from_raw(raw: dict) -> list[dict]:
        """
        Convert a raw GET /iserver/watchlist response into the POST rows format.

        IBKR row types:
          {"C": <conid_int>}  — a security (C = Contract)
          {"H": "<text>"}     — a section header/divider

        Supports two response shapes:
          Newer API: {"rows": [...]}
          Older API: {"data": {"instruments": [{"conid": 265598, ...}, ...]}}
        """
        # Newer API: rows key at top level
        if "rows" in raw:
            return list(raw["rows"])

        # Older API: data.instruments
        data = raw.get("data", {})
        if isinstance(data, dict):
            instruments = data.get("instruments", [])
            rows = []
            for inst in instruments:
                conid = inst.get("conid")
                if conid is not None:
                    rows.append({"C": int(conid)})
            return rows

        return []

    async def _overwrite_watchlist(
        self,
        watchlist_id: str,
        name: str,
        rows: list[dict],
    ) -> None:
        """
        Replace a watchlist's contents by deleting it and recreating it.

        Because IBKR assigns a new ID on POST, the old ID is dead after this
        call.  Always re-resolve by name when you need the ID afterward.
        Invalidates the get_watchlists() cache so the next lookup is fresh.
        """
        from cache import cache as _cache

        # Step 1: delete the old watchlist (best-effort — may already be gone)
        try:
            await self._request(
                "DELETE", "/iserver/watchlist", params={"id": watchlist_id}
            )
        except IBKRRequestError as exc:
            if exc.status_code == 404:
                pass  # already gone — proceed to recreate
            else:
                raise  # propagate 5xx and other unexpected errors

        # Step 2: recreate with the modified rows
        await self._request(
            "POST",
            "/iserver/watchlist",
            json={"id": watchlist_id, "name": name, "rows": rows},
        )

        # Step 3: invalidate the watchlist cache so the next lookup is fresh
        await _cache.delete("get_watchlists")
        log.debug("Watchlist '%s' overwritten — cache invalidated", name)

    async def add_to_watchlist(
        self,
        watchlist_id: str,
        name: str,
        conid: int,
    ) -> bool:
        """
        Add a conid to an IBKR watchlist.

        Returns True if the conid was added, False if it was already present
        (idempotent — safe to call multiple times).
        """
        raw = await self.get_watchlist_raw(watchlist_id)
        rows = self._extract_rows_from_raw(raw)

        existing = {int(r["C"]) for r in rows if "C" in r}
        if conid in existing:
            log.debug("conid %d already in watchlist '%s' — skipping add", conid, name)
            return False

        rows.append({"C": conid})
        await self._overwrite_watchlist(watchlist_id, name, rows)
        log.info("Added conid %d to watchlist '%s'", conid, name)
        return True

    async def remove_from_watchlist(
        self,
        watchlist_id: str,
        name: str,
        conid: int,
    ) -> bool:
        """
        Remove a conid from an IBKR watchlist.

        Returns True if removed, False if the conid wasn't in the list.
        Section headers (H rows) are preserved.
        """
        raw = await self.get_watchlist_raw(watchlist_id)
        rows = self._extract_rows_from_raw(raw)

        new_rows = [r for r in rows if not ("C" in r and int(r["C"]) == conid)]
        if len(new_rows) == len(rows):
            log.debug("conid %d not found in watchlist '%s' — skipping remove", conid, name)
            return False

        await self._overwrite_watchlist(watchlist_id, name, new_rows)
        log.info("Removed conid %d from watchlist '%s'", conid, name)
        return True

    async def move_between_watchlists(
        self,
        conid: int,
        source_name: str,
        target_name: str,
    ) -> bool:
        """
        Move a conid from one IBKR watchlist to another.

        Steps:
          1. Resolve source + target names → current IDs
          2. Add conid to target first (stock always lives somewhere)
          3. Remove conid from source

        Raises IBKRRequestError (status 404) if either watchlist name doesn't exist.
        Returns True when the move completes.
        """
        source_id = await self.resolve_watchlist_id(source_name)
        if source_id is None:
            raise IBKRRequestError(
                status_code=404,
                detail=f"Source watchlist '{source_name}' not found",
            )

        target_id = await self.resolve_watchlist_id(target_name)
        if target_id is None:
            raise IBKRRequestError(
                status_code=404,
                detail=f"Target watchlist '{target_name}' not found",
            )

        # Add to target before removing from source — stock is always visible
        # in at least one watchlist during the two-step operation.
        try:
            await self.add_to_watchlist(target_id, target_name, conid)
        except (IBKRAuthError, IBKRConnectionError, IBKRRateLimitError, IBKRRequestError):
            # Add failed — source is untouched; re-raise so the caller can decide.
            log.error(
                "move_between_watchlists: add to '%s' failed for conid %d — source '%s' unchanged",
                target_name, conid, source_name,
            )
            raise

        # Source ID resolved before the add; the target overwrite invalidated
        # the watchlist cache but did NOT change source's ID — safe to reuse.
        try:
            await self.remove_from_watchlist(source_id, source_name, conid)
        except (IBKRAuthError, IBKRConnectionError, IBKRRateLimitError, IBKRRequestError):
            # Remove failed — conid is now in BOTH lists. Log with detail so
            # ops can identify the duplicate and manually clean up.
            log.error(
                "move_between_watchlists: remove from '%s' FAILED after adding to '%s' "
                "— conid %d is now in both lists. Manual cleanup may be needed.",
                source_name, target_name, conid,
            )
            raise

        log.info(
            "Moved conid %d: '%s' → '%s'",
            conid, source_name, target_name,
        )
        return True

    # ── Scanner Methods (Step 5.6) ────────────────────────────

    @cached(ttl=3600)
    async def scanner_params(self) -> dict:
        """
        Fetch available scanner parameters from IBKR.
        Returns instruments, locations, scan types, and filter codes
        the user can build scans from.
        """
        await self.ensure_accounts()
        result = await self._request("GET", "/iserver/scanner/params")
        dump_if_first("scanner_params", result)
        return result

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
        # IBKR requires "filter" to always be an array — omitting the key
        # causes a 400 "filter must be an array" error even for no-filter scans.
        body["filter"] = filters if filters is not None else []
        if sort:
            body["sort"] = sort

        # IBKR quirk: when a scanner matches zero rows server-side it returns
        # HTTP 500 with body {"error":"Finished: EMPTY response is received."}
        # instead of an empty contracts array. This happens for time-of-day
        # gated scanners (52W highs on a slow tape, pre-market scanners outside
        # pre-market hours, 13W highs/lows on quiet days). Treat as "no matches"
        # rather than a real failure so the UI shows the empty state instead of
        # an error banner.
        try:
            data = await self._request("POST", "/iserver/scanner/run", json=body)
        except IBKRRequestError as exc:
            if exc.status_code == 500 and "EMPTY response" in str(exc):
                log.info(
                    "Scanner %s/%s/%s returned EMPTY (IBKR 500) — treating as no matches",
                    instrument, scan_type, location,
                )
                return []
            raise
        dump_if_first("scanner_run", data)

        # /iserver/scanner/run returns {"contracts": [...], "scan_data_column_name": "..."}
        # The HMDS /hmds/scanner endpoint uses {"Contracts": {"Contract": [...]}} —
        # keep that as a fallback so this parser is safe for both shapes.
        if isinstance(data, dict):
            lower = data.get("contracts")
            if isinstance(lower, list):
                return lower
            upper = data.get("Contracts")
            if isinstance(upper, dict):
                return upper.get("Contract", [])
            if isinstance(upper, list):
                return upper
            return []
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
