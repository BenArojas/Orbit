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

import logging
import math
from typing import Any

from constants import (
    FIELD_CHANGE_PCT,
    FIELD_COMPANY_NAME,
    FIELD_LAST_PRICE,
    FIELD_MARKET_CAP,
    FIELD_SYMBOL,
    FIELD_VOLUME,
)

# Fields that MUST be present before the snapshot poll exits.
# Phase 5C update: market cap (7289) was previously best-effort because it's a
# slow-fill field on /iserver/marketdata/snapshot. We now ASK for it as required
# (longer poll timeout absorbs the latency) AND fall back to /iserver/contract/
# {conid}/info → `marketCap` for any conid that still has no value after the
# snapshot returns. Belt-and-braces — neither path alone was reliable enough.
SNAPSHOT_REQUIRED_FIELDS = [
    FIELD_LAST_PRICE,   # 31
    FIELD_SYMBOL,       # 55
    FIELD_CHANGE_PCT,   # 83
    FIELD_VOLUME,       # 7762
    FIELD_MARKET_CAP,   # 7289 — required so the poll waits for it
]

# Per-batch snapshot timeouts.
#  - First pass: longer than the prior 12s because we now require 7289 (slow).
#  - Stragglers retry: shorter — these conids already failed once, no point
#    holding the whole scan hostage on them.
SNAPSHOT_TIMEOUT_FIRST = 18.0
SNAPSHOT_TIMEOUT_RETRY = 6.0
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

# Snapshot fields for screener results
SCREENER_SNAPSHOT_FIELDS = ",".join([
    FIELD_LAST_PRICE,   # 31 — last price
    FIELD_SYMBOL,       # 55 — ticker
    FIELD_CHANGE_PCT,   # 83 — % change
    FIELD_VOLUME,       # 7762 — volume
    FIELD_COMPANY_NAME, # 7051 — company name
    FIELD_MARKET_CAP,   # 7289 — market cap ($M)
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

        # Fallback enrichment for any row still missing market_cap.
        rows = await self._enrich_market_caps(rows)

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

        Two-pass strategy (Phase 5C):
          Pass 1 — request all conids with the full required-field gate
                   (price, symbol, change, volume, market cap).
          Pass 2 — for any conid still missing required fields after pass 1,
                   re-call snapshot in a smaller batch with a shorter timeout.
                   IBKR's first call often primes the cache without returning
                   complete data; the second call comes back cleaner.
        """
        quotes: dict[int, dict[str, Any]] = {}

        # ── Pass 1: full batch ────────────────────────────────────
        for i in range(0, len(conids), SNAPSHOT_BATCH_SIZE):
            batch = conids[i : i + SNAPSHOT_BATCH_SIZE]
            try:
                raw = await self.ibkr.snapshot(
                    batch,
                    fields=SCREENER_SNAPSHOT_FIELDS,
                    timeout=SNAPSHOT_TIMEOUT_FIRST,
                    required_fields=SNAPSHOT_REQUIRED_FIELDS,
                )
                for item in raw:
                    cid = item.get("conid")
                    if cid:
                        quotes[int(cid)] = item
            except IBKRError as exc:
                log.warning(
                    "Snapshot batch failed (batch %d, size %d): %s",
                    i // SNAPSHOT_BATCH_SIZE, len(batch), exc,
                )

        # ── Pass 2: retry stragglers ──────────────────────────────
        # A "straggler" is a conid that either never appeared in pass-1 quotes
        # or whose quote is missing one or more required fields. The second
        # call benefits from IBKR's now-warm cache.
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
            for i in range(0, len(stragglers), SNAPSHOT_BATCH_SIZE):
                batch = stragglers[i : i + SNAPSHOT_BATCH_SIZE]
                try:
                    raw = await self.ibkr.snapshot(
                        batch,
                        fields=SCREENER_SNAPSHOT_FIELDS,
                        timeout=SNAPSHOT_TIMEOUT_RETRY,
                        required_fields=SNAPSHOT_REQUIRED_FIELDS,
                    )
                    for item in raw:
                        cid = item.get("conid")
                        if cid:
                            # Merge — pass-2 fields take precedence but we don't
                            # blow away anything pass-1 already filled in.
                            existing = quotes.get(int(cid), {})
                            quotes[int(cid)] = {**existing, **item}
                except IBKRError as exc:
                    log.warning(
                        "Snapshot retry batch failed (batch %d, size %d): %s",
                        i // SNAPSHOT_BATCH_SIZE, len(batch), exc,
                    )

        return quotes

    async def _enrich_market_caps(
        self,
        rows: list[ScreenerResultRow],
    ) -> list[ScreenerResultRow]:
        """
        Fallback enrichment for rows whose `market_cap` is still None after the
        two snapshot passes. Calls /iserver/contract/{conid}/info per missing
        conid and pulls the `marketCap` field.

        Why a separate pass?
          IBKR snapshot field 7289 is unreliable on /iserver/marketdata/snapshot
          for many instruments. The contract endpoint returns a stable, cached
          marketCap value (1h cache via @cached(ttl=3600)) that's been our
          ground truth in MoonMarket. We only call it for stragglers so a
          successful snapshot scan stays as fast as before.
        """
        missing = [r for r in rows if r.market_cap is None]
        if not missing:
            return rows

        log.info("Market-cap enrichment: %d rows need fallback", len(missing))

        for row in missing:
            try:
                info = await self.ibkr.contract_info(row.conid)
                mc = _safe_float(info.get("marketCap"))
                if mc is not None:
                    # Pydantic model — copy with the new value
                    row.market_cap = mc
            except IBKRError as exc:
                log.debug(
                    "contract_info enrichment failed for conid %d: %s",
                    row.conid, exc,
                )

        return rows

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
            market_cap=_safe_float(quote.get("7289")),
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
