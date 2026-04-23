"""
Screener service — scan instruments using IBKR Scanner with native filters.

Flow:
  1. POST /iserver/scanner/run with instrument, scan_type, location, and
     native IBKR filter codes (e.g. marketCapAbove1e6, minPeRatio).
     IBKR pre-filters server-side — no local indicator computation.
  2. Batch-fetch snapshot quotes for each returned conid.
  3. Return enriched rows (price, chg%, volume, market cap).

Performance notes:
  - All filtering happens in IBKR — no candle fetches, no indicator computation.
  - Sorting is done client-side in the frontend (zustand store) — the backend
    does NOT sort results. Keeping compute out of the backend keeps scans fast
    and avoids reshaping rows only to re-sort them in the browser anyway.
    The `sort_field` / `sort_direction` params on ScanRequest are still
    accepted for backward-compat but the frontend no longer sends them.
  - Snapshot calls are batched (25 conids per call).
  - max_results caps how many conids we process.

TODO (next pass): "Search next 50" / cumulative paging
  IBKR /iserver/scanner/run returns ~50 contracts per call and does not
  expose a documented offset/startAt. To support fetching more than 50
  results we need to either:
    (a) test whether startAt is honored on /iserver/scanner/run (undocumented),
    (b) switch to /hmds/scanner which documents startAt, or
    (c) slice/filter differently (e.g. different scan_type).
  Once the frontend has a "Search next 50" button, this service needs an
  `offset` param that flows into scanner_run and appends to the frontend
  zustand store via `appendResults`.
"""

import asyncio
import logging
import math
from typing import Any

from constants import (
    FIELD_CHANGE_PCT,
    FIELD_COMPANY_NAME,
    FIELD_LAST_PRICE,
    FIELD_SYMBOL,
    FIELD_VOLUME,
)

# Fields that MUST be present before the snapshot poll exits.
#
# Phase 5C revision (2026-04-23): we previously required 7289 (market cap) and
# even added a contract_info fallback. Turned out field 7289 isn't on IBKR's
# official market-data-fields list at all — the poll was waiting ~18s for a
# value that was never going to arrive. See backend/docs/ibkr_market_data_fields.md
# for the canonical list. Market cap column was removed from the screener to
# keep scans fast; we can bring it back later using /trsrv/secdef or fundamentals
# endpoints if needed.
SNAPSHOT_REQUIRED_FIELDS = [
    FIELD_LAST_PRICE,   # 31
    FIELD_SYMBOL,       # 55
    FIELD_CHANGE_PCT,   # 83
    FIELD_VOLUME,       # 7762
]

# Per-batch snapshot timeouts.
#  - First pass: short — only the four fast fields are required now.
#  - Stragglers retry: even shorter; these conids already failed once.
SNAPSHOT_TIMEOUT_FIRST = 8.0
SNAPSHOT_TIMEOUT_RETRY = 3.0
from exceptions import IBKRError
from models import IbkrFilterItem, ScreenerResultRow, ScanResponse
from services.ibkr import IBKRService

log = logging.getLogger("parallax.screener")

# Baseline liquidity floor applied to scanners that previously returned IBKR's
# "Finished: EMPTY response is received." 500 on slow tapes (52W/13W highs+lows,
# US small caps). The floor (any-price ≥ $1, volume ≥ 100k) is loose enough not
# to skew the screen but blocks penny-stock noise that IBKR's empty-set quirk
# triggers on. Pre-market scanners use the EMPTY-catch in scanner_run instead
# (filters won't help when the gating issue is time-of-day, not liquidity).
_BASELINE_LIQUIDITY_FILTERS: list[dict[str, str]] = [
    {"code": "priceAbove", "value": "1"},
    {"code": "volumeAbove", "value": "100000"},
]

# Default scanner presets exposed to the frontend.
#
# Grouped for the UI combobox:
#   - "popular" (6): always visible in the preset dropdown.
#   - "niche"   (10): under a collapsible "More screens" section.
#
# Every `scan_type` + `location` pair has been grep-verified against the
# raw `/iserver/scanner/params` dump (backend/ibkr_scanner_params.json).
DEFAULT_PRESETS: list[dict[str, Any]] = [
    # ── Popular ────────────────────────────────────────────────
    {
        "instrument": "STK",
        "scan_type": "MOST_ACTIVE",
        "location": "STK.US.MAJOR",
        "display_name": "Most Active — US Stocks",
        "category": "popular",
    },
    {
        "instrument": "STK",
        "scan_type": "TOP_PERC_GAIN",
        "location": "STK.US.MAJOR",
        "display_name": "Top % Gainers — US Stocks",
        "category": "popular",
    },
    {
        "instrument": "STK",
        "scan_type": "TOP_PERC_LOSE",
        "location": "STK.US.MAJOR",
        "display_name": "Top % Losers — US Stocks",
        "category": "popular",
    },
    {
        "instrument": "STK",
        "scan_type": "HOT_BY_VOLUME",
        "location": "STK.US.MAJOR",
        "display_name": "Hot by Volume — US Stocks",
        "category": "popular",
    },
    {
        "instrument": "STK",
        "scan_type": "HIGH_VS_52W_HL",
        "location": "STK.US.MAJOR",
        "display_name": "52-Week Highs — US Stocks",
        "category": "popular",
        "default_filters": _BASELINE_LIQUIDITY_FILTERS,
    },
    {
        "instrument": "STK",
        "scan_type": "LOW_VS_52W_HL",
        "location": "STK.US.MAJOR",
        "display_name": "52-Week Lows — US Stocks",
        "category": "popular",
        "default_filters": _BASELINE_LIQUIDITY_FILTERS,
    },
    # ── More screens (niche) ───────────────────────────────────
    {
        "instrument": "STK",
        "scan_type": "TOP_PERC_GAIN",
        "location": "STK.US.MINOR",
        "display_name": "Top % Gainers — US Small Cap",
        "category": "niche",
        "default_filters": _BASELINE_LIQUIDITY_FILTERS,
    },
    {
        "instrument": "ETF.EQ.US",
        "scan_type": "MOST_ACTIVE",
        "location": "ETF.EQ.US.MAJOR",
        "display_name": "Most Active — US Equity ETFs",
        "category": "niche",
    },
    {
        "instrument": "STK",
        "scan_type": "TOP_OPEN_PERC_GAIN",
        "location": "STK.US.MAJOR",
        "display_name": "Pre-Market Gainers",
        "category": "niche",
        "subtitle": "Pre-market only",
    },
    {
        "instrument": "STK",
        "scan_type": "TOP_OPEN_PERC_LOSE",
        "location": "STK.US.MAJOR",
        "display_name": "Pre-Market Losers",
        "category": "niche",
        "subtitle": "Pre-market only",
    },
    {
        "instrument": "STK",
        "scan_type": "HIGH_VS_13W_HL",
        "location": "STK.US.MAJOR",
        "display_name": "13-Week Highs",
        "category": "niche",
        "default_filters": _BASELINE_LIQUIDITY_FILTERS,
    },
    {
        "instrument": "STK",
        "scan_type": "LOW_VS_13W_HL",
        "location": "STK.US.MAJOR",
        "display_name": "13-Week Lows",
        "category": "niche",
        "default_filters": _BASELINE_LIQUIDITY_FILTERS,
    },
    {
        "instrument": "STK",
        "scan_type": "HIGH_DIVIDEND_YIELD_IB",
        "location": "STK.US.MAJOR",
        "display_name": "High Dividend Yield",
        "category": "niche",
    },
    {
        "instrument": "STK",
        "scan_type": "HIGH_OPT_IMP_VOLAT",
        "location": "STK.US.MAJOR",
        "display_name": "High Implied Vol",
        "category": "niche",
    },
    {
        "instrument": "STK",
        "scan_type": "OPT_VOLUME_MOST_ACTIVE",
        "location": "STK.US.MAJOR",
        "display_name": "Top Options Volume",
        "category": "niche",
    },
    {
        "instrument": "STK",
        "scan_type": "HIGH_GROWTH_RATE",
        "location": "STK.US.MAJOR",
        "display_name": "High Growth Rate",
        "category": "niche",
    },
]

# Snapshot fields for screener results.
# Market cap intentionally NOT requested — see SNAPSHOT_REQUIRED_FIELDS note.
SCREENER_SNAPSHOT_FIELDS = ",".join([
    FIELD_LAST_PRICE,   # 31 — last price
    FIELD_SYMBOL,       # 55 — ticker
    FIELD_CHANGE_PCT,   # 83 — % change
    FIELD_VOLUME,       # 7762 — volume
    FIELD_COMPANY_NAME, # 7051 — company name
])

# IBKR allows up to ~50 conids per snapshot call
SNAPSHOT_BATCH_SIZE = 25


class ScreenerService:
    """
    Scans instruments using IBKR scanner presets with native filter codes.
    Stateless — create one instance and reuse across requests.
    """

    def __init__(self, ibkr: IBKRService) -> None:
        self.ibkr = ibkr

    async def scan(
        self,
        instrument: str,
        scan_type: str,
        location: str,
        filters: list[IbkrFilterItem],
        max_results: int = 200,
        sort_field: str = "",
        sort_direction: str = "desc",
        page: int = 1,
        page_size: int = 25,
    ) -> ScanResponse:
        """
        Run a screener scan.

        1. Call IBKR scanner with native filters
        2. Batch-fetch snapshot quotes
        3. Paginate results
        4. Return enriched rows
        """
        # Build IBKR filter array
        ibkr_filters = (
            [{"code": f.code, "value": f.value} for f in filters]
            if filters else None
        )

        # Build sort code if provided
        sort_code = ""
        if sort_field:
            sort_code = sort_field
            if sort_direction == "asc":
                sort_code += "Asc"

        log.info(
            "Running scanner: %s / %s / %s  filters=%d sort=%s",
            instrument, scan_type, location, len(filters), sort_code,
        )

        raw_results = await self.ibkr.scanner_run(
            instrument=instrument,
            scan_type=scan_type,
            location=location,
            filters=ibkr_filters,
            sort=sort_code,
        )

        # An empty raw result is a valid outcome — IBKR scanners can legitimately
        # match zero rows (52W highs on a slow tape, pre-market screens outside
        # pre-market hours). Frontend handles the empty state by re-showing the
        # quick-pick cards. No exception, no error banner.
        if not raw_results:
            log.info(
                "Scanner %s/%s returned 0 contracts — empty ScanResponse",
                scan_type, location,
            )
            return ScanResponse(
                results=[],
                total_scanned=0,
                total_matched=0,
                scan_type=scan_type,
                location=location,
                page=page,
                page_size=page_size,
                total_pages=1,
            )

        universe = self._parse_scanner_results(raw_results, max_results)
        total_scanned = len(universe)
        log.info("Scanner returned %d instruments", total_scanned)

        if not universe:
            return ScanResponse(
                results=[],
                total_scanned=0,
                total_matched=0,
                scan_type=scan_type,
                location=location,
                page=page,
                page_size=page_size,
                total_pages=1,
            )

        # Fetch snapshot quotes for all conids (two-pass — see _batch_snapshots).
        conid_list = [u["conid"] for u in universe]
        quotes = await self._batch_snapshots(conid_list)

        # Build result rows
        rows = [
            self._build_row(item, quotes.get(item["conid"], {}))
            for item in universe
        ]

        # Drop ticker-only rows: if IBKR returned NEITHER price nor volume for
        # this conid, the row is useless (illiquid, delisted, no data
        # subscription). Showing them as blank cells made the table look broken.
        rows = [
            r for r in rows
            if r.last_price is not None or r.volume is not None
        ]

        # Paginate results
        total_pages = max(1, math.ceil(len(rows) / page_size))
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_rows = rows[start_idx:end_idx]

        return ScanResponse(
            results=paginated_rows,
            total_scanned=total_scanned,
            total_matched=len(rows),
            scan_type=scan_type,
            location=location,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    def _parse_scanner_results(
        self, raw: list[dict], max_results: int
    ) -> list[dict[str, Any]]:
        """
        Extract conid + metadata from IBKR scanner response.
        Handles both flat and nested response formats.
        """
        results: list[dict[str, Any]] = []
        for item in raw[:max_results]:
            conid = item.get("conid") or item.get("con_id") or item.get("conId")
            if not conid:
                contract = item.get("contract", {})
                conid = contract.get("conid") or contract.get("con_id")

            if not conid:
                continue

            try:
                conid = int(conid)
            except (ValueError, TypeError):
                continue

            results.append({
                "conid": conid,
                "symbol": (
                    item.get("symbol", "")
                    or item.get("contractDescription", "")
                    or item.get("contract", {}).get("symbol", "")
                ),
                "company_name": item.get("company_name", ""),
                "sec_type": item.get("sec_type", item.get("secType", "")),
            })

        return results

    async def _batch_snapshots(
        self, conids: list[int]
    ) -> dict[int, dict[str, Any]]:
        """
        Fetch market data snapshots in batches of SNAPSHOT_BATCH_SIZE.
        Returns {conid: quote_data} mapping.

        Two-pass strategy (Phase 5C, revised 2026-04-23):
          Pass 1 — request all conids in parallel batches (asyncio.gather) with
                   the fast required-field gate (price, symbol, change, volume).
                   Running batches concurrently roughly halves wall time vs
                   serial.
          Pass 2 — for any conid still missing required fields after pass 1,
                   re-call snapshot with a shorter timeout. These are usually
                   IBKR-side misses (illiquid, halted, no subscription); we
                   give them one more chance but cap the wait at ~3s.

        Previous version required field 7289 (market cap) and used a long 18s
        pass-1 timeout. Field 7289 isn't on IBKR's documented market data
        fields list — the poll was waiting for a value that was never coming.
        See backend/docs/ibkr_market_data_fields.md.
        """
        quotes: dict[int, dict[str, Any]] = {}

        # ── Pass 1: parallel batches ──────────────────────────────
        pass_1_batches = [
            conids[i : i + SNAPSHOT_BATCH_SIZE]
            for i in range(0, len(conids), SNAPSHOT_BATCH_SIZE)
        ]

        async def _fetch_batch(
            batch: list[int], timeout: float
        ) -> list[dict] | Exception:
            """Fetch one batch; return exception object instead of raising so
            `asyncio.gather` doesn't short-circuit on a single bad batch."""
            try:
                return await self.ibkr.snapshot(
                    batch,
                    fields=SCREENER_SNAPSHOT_FIELDS,
                    timeout=timeout,
                    required_fields=SNAPSHOT_REQUIRED_FIELDS,
                )
            except IBKRError as exc:
                return exc

        pass_1_results = await asyncio.gather(
            *(_fetch_batch(b, SNAPSHOT_TIMEOUT_FIRST) for b in pass_1_batches),
            return_exceptions=False,  # we're already returning exc objects
        )
        for idx, result in enumerate(pass_1_results):
            if isinstance(result, Exception):
                log.warning(
                    "Snapshot batch failed (batch %d, size %d): %s",
                    idx, len(pass_1_batches[idx]), result,
                )
                continue
            for item in result:
                cid = item.get("conid")
                if cid:
                    quotes[int(cid)] = item

        # ── Pass 2: retry stragglers (parallel) ───────────────────
        # A "straggler" is a conid that either never appeared in pass-1 quotes
        # or whose quote is missing one or more required fields.
        stragglers = [
            c for c in conids
            if c not in quotes
            or not all(f in quotes[c] for f in SNAPSHOT_REQUIRED_FIELDS)
        ]
        if stragglers:
            log.info(
                "Snapshot pass 2: re-fetching %d stragglers (of %d total)",
                len(stragglers), len(conids),
            )
            pass_2_batches = [
                stragglers[i : i + SNAPSHOT_BATCH_SIZE]
                for i in range(0, len(stragglers), SNAPSHOT_BATCH_SIZE)
            ]
            pass_2_results = await asyncio.gather(
                *(_fetch_batch(b, SNAPSHOT_TIMEOUT_RETRY) for b in pass_2_batches),
            )
            for idx, result in enumerate(pass_2_results):
                if isinstance(result, Exception):
                    log.warning(
                        "Snapshot retry batch failed (batch %d, size %d): %s",
                        idx, len(pass_2_batches[idx]), result,
                    )
                    continue
                for item in result:
                    cid = item.get("conid")
                    if cid:
                        # Merge — pass-2 fields take precedence but we don't
                        # blow away anything pass-1 already filled in.
                        existing = quotes.get(int(cid), {})
                        quotes[int(cid)] = {**existing, **item}

        return quotes

    def _build_row(
        self, item: dict[str, Any], quote: dict[str, Any]
    ) -> ScreenerResultRow:
        """Build a ScreenerResultRow from scanner metadata + snapshot quote."""
        conid = item["conid"]

        # Prefer snapshot symbol/name — more reliable than scanner metadata
        symbol = quote.get("55") or item.get("symbol", "")
        company_name = quote.get("7051") or item.get("company_name", "")

        return ScreenerResultRow(
            conid=conid,
            symbol=symbol,
            company_name=company_name,
            sec_type=item.get("sec_type", ""),
            last_price=_safe_float(quote.get("31")),
            change_percent=_safe_float(quote.get("83")),
            volume=_safe_float(quote.get("7762")),
        )


def _safe_float(value: Any) -> float | None:
    """Convert a value to float, or None if invalid/NaN."""
    if value is None:
        return None
    try:
        result = float(value)
        return None if result != result else result  # NaN check
    except (ValueError, TypeError):
        return None
