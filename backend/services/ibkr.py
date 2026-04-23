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
    IBKR_API_BASE_URL,
    IBKR_GATEWAY_BASE_URL,
    IBKR_GATEWAY_HOST,
    IBKR_GATEWAY_PORT,
    IBKR_TICKLE_INTERVAL,
)
from constants import DEFAULT_QUOTE_FIELDS_STR, LIVE_STREAM_FIELDS
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
            if is_valid:
                # Clear any prior disconnect flag — user successfully re-authed
                self.state.session_dropped = False
                self.state.tickle_fail_count = 0
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

    @cached(ttl=3600)
    async def get_conid(self, symbol: str, sec_type: str = "") -> int:
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

        Implementation notes:
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

        candidates: list[tuple[tuple[int, int, int], int]] = []
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
            for idx, preferred in enumerate(preferred_sec_types):
                if preferred in item_sec_types:
                    sec_rank = idx
                    break

            score = (
                0 if item_symbol == symbol_upper else 1,
                sec_rank,
                _exchange_rank(item),
            )
            candidates.append((score, conid))

        if not candidates:
            raise SymbolNotFoundError(symbol)

        return min(candidates, key=lambda item: item[0])[1]

    async def snapshot(
        self,
        conids: list[int],
        fields: str = DEFAULT_QUOTE_FIELDS_STR,
        timeout: float = 5.0,
        poll_interval: float = 1.0,
        required_fields: list[str] | None = None,
    ) -> list[dict]:
        """
        Get a market data snapshot for one or more conids.
        Polls until all *required* fields are present or timeout is reached.

        Args:
            conids: IBKR contract IDs to fetch.
            fields: Comma-separated field codes to request (all sent to IBKR).
            timeout: Max seconds to poll before returning partial data.
            poll_interval: Seconds between polls.
            required_fields: Field codes that MUST be present before returning.
                If None, ALL requested fields are required (original behaviour).
                Pass a subset (e.g. ["31","55","83","7762"]) to treat slower
                fields like market cap (7289) as best-effort.

        ────────────────────────────────────────────────────────────
        SAMPLE RESPONSE (from /iserver/marketdata/snapshot, fields=31,55,83,7762,7289,7051):
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
            "7762": "52.1M",             # volume (STRING, may carry K/M/B suffix)
            "7289": "3285420"            # market cap (STRING, value in MILLIONS)
          },
          ...
        ]

        Field notes:
          - ALL values come back as STRINGS — must _safe_float on read.
          - "7762" (volume) sometimes arrives as "52.1M" / "900K" — `_parse_volume`
            in screener.py handles the suffix.
          - "7289" (market cap) is quoted in MILLIONS (so 3285420 = $3.285T).
            Frequently MISSING on first snapshot for illiquid names — this is
            why the screener reruns a pass-2 retry and then falls back to
            /iserver/contract/{conid}/info (see contract_info below).
          - Partial responses are common: IBKR may return the row with only
            55 + 6509 filled while it warms its cache. The poll loop above
            waits through this and returns once `required_fields` are all set.
        """
        await self.ensure_accounts()
        params = {
            "conids": ",".join(str(c) for c in conids),
            "fields": fields,
        }
        # Determine which fields are required for the "done" check
        gate_fields = required_fields if required_fields is not None else fields.split(",")
        start = time.monotonic()
        response = []

        while time.monotonic() - start < timeout:
            response = await self._request(
                "GET", "/iserver/marketdata/snapshot", params=params
            )
            if response and isinstance(response, list):
                # Check if all conids have all *required* fields
                conids_in_resp = {str(item.get("conid")) for item in response}
                all_conids_present = set(str(c) for c in conids).issubset(conids_in_resp)
                all_fields_present = all(
                    all(f in item for f in gate_fields)
                    for item in response
                )
                if all_conids_present and all_fields_present:
                    dump_if_first("marketdata_snapshot", response)
                    return response

            await asyncio.sleep(poll_interval)

        # Return whatever we have after timeout
        log.warning("Snapshot timed out for conids %s after %.1fs", conids, timeout)
        dump_if_first("marketdata_snapshot", response)
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
        result = await self._request(
            "GET", "/iserver/marketdata/history", params=params
        )
        dump_if_first("marketdata_history", result)
        return result

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
