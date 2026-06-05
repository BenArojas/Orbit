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

# Fields the screener treats as the "core quote" for a row. Used to detect
# stragglers (rows missing core fields) so pass 2 can re-fetch them.
#
# Phase 8 / Task 1.3 (2026-04-30): IBKRService.snapshot() no longer accepts
# `required_fields` — the documented pre-flight pattern (call once + sleep
# 750ms + call again) replaces the old field-gated poll loop. The screener
# still uses this list as a post-snapshot quality check: any conid whose
# response is missing one of these fields is queued for pass 2.
#
# Phase 5C history (2026-04-23): 7289 (market cap) was previously required;
# turned out it isn't on IBKR's documented market-data fields list at all
# and the poll waited ~18s for a value that never arrived. Use the
# contract endpoint (/iserver/contract/{conid}/info → `marketCap`) for
# market cap instead. See backend/docs/ibkr_market_data_fields.md.
SNAPSHOT_REQUIRED_FIELDS = [
    FIELD_LAST_PRICE,   # 31
    FIELD_SYMBOL,       # 55
    FIELD_CHANGE_PCT,   # 83
    FIELD_VOLUME,       # 7762
]
from constants.scan_types import (
    CATEGORY_ORDER,
    CURATED_SCAN_TYPES,
    NO_QUOTE_SCAN_TYPES,
    SCAN_TYPE_BY_CODE,
    categorize_scan_type,
)
from constants.scan_locations import (
    CURATED_LOCATIONS,
    DEFAULT_LOCATION_CODE,
)
from exceptions import IBKRError
from models import (
    IbkrFilterItem,
    ScannerLocation,
    ScannerPreset,
    ScannerScanType,
    ScreenerResultRow,
    ScanResponse,
)
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

# Scan types whose default_filters need the baseline liquidity floor
# (priceAbove=1, volumeAbove=100000) to dodge IBKR's "Finished: EMPTY
# response is received." 500 quirk on slow tapes. The 13W/52W high+low
# scanners are the worst offenders.
_BASELINE_GATED_SCAN_TYPES: frozenset[str] = frozenset({
    "HIGH_VS_52W_HL",
    "LOW_VS_52W_HL",
    "HIGH_VS_13W_HL",
    "LOW_VS_13W_HL",
})

# The single ETF preset is bundled separately because it has its own
# instrument code (ETF.EQ.US, not STK). The Location dropdown is disabled
# for this preset — the bundled location is the only one that works.
_ETF_PRESET: dict[str, Any] = {
    "instrument": "ETF.EQ.US",
    "scan_type": "MOST_ACTIVE",
    "location": "ETF.EQ.US.MAJOR",
    "display_name": "Most Active — US ETFs",
    "category": "niche",
    "group": "etfs",
}


# (DEFAULT_PRESETS used to be a hardcoded list here. It's now built from
# CURATED_SCAN_TYPES (constants/scan_types.py) joined with the live IBKR
# scan_type_list at request time — see ScreenerService.list_presets().
# Every preset's `instruments` array now comes from IBKR directly, so the
# Location dropdown's compatibility filtering stays correct as IBKR
# evolves its catalogue.)
#
# Below is the legacy DEFAULT_PRESETS list, kept for backward-compat
# imports + the EMPTY-state cards lookup (frontend matches by
# scan_type+location+instrument). Do NOT edit by hand — derived from
# CURATED_SCAN_TYPES so the two never drift.
def _build_static_preset_list() -> list[dict[str, Any]]:
    """
    Build the legacy preset dict list from CURATED_SCAN_TYPES + the bundled
    ETF preset. The result has no `instruments` array — that's enriched at
    request time by ScreenerService.list_presets() using live IBKR data.
    Kept as a module-level list (DEFAULT_PRESETS below) so existing imports
    and tests keep working without touching every call site.
    """
    presets: list[dict[str, Any]] = []
    for entry in CURATED_SCAN_TYPES:
        preset: dict[str, Any] = {
            "instrument": "STK",
            "scan_type": entry["code"],
            "location": DEFAULT_LOCATION_CODE,
            "display_name": entry["display_name"],
            "category": "popular" if entry.get("popular") else "niche",
            "group": entry["category"],
        }
        if entry.get("subtitle"):
            preset["subtitle"] = entry["subtitle"]
        if entry["code"] in _BASELINE_GATED_SCAN_TYPES:
            preset["default_filters"] = list(_BASELINE_LIQUIDITY_FILTERS)
        presets.append(preset)
    presets.append(_ETF_PRESET)
    return presets


DEFAULT_PRESETS: list[dict[str, Any]] = _build_static_preset_list()


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
        # Cached IBKR scanner_params (instruments, scan_type_list, locations,
        # filters). Refreshes every _PARAMS_CACHE_TTL seconds — IBKR's
        # catalogue rarely changes within a session, and the rate limiter
        # already gates this endpoint to once per 15 min.
        self._params_cache: dict[str, Any] | None = None
        self._params_cache_at: float = 0.0

    # ── Live IBKR params caching ────────────────────────────────

    _PARAMS_CACHE_TTL: float = 60 * 60  # 1 hour

    async def _get_scanner_params(self) -> dict[str, Any]:
        """
        Fetch /iserver/scanner/params with a 1-hour in-memory cache.
        On error, returns the last cached value (or {} if never fetched).
        """
        import time
        now = time.monotonic()
        fresh = (
            self._params_cache is not None
            and (now - self._params_cache_at) < self._PARAMS_CACHE_TTL
        )
        if fresh:
            return self._params_cache  # type: ignore[return-value]
        try:
            self._params_cache = await self.ibkr.scanner_params()
            self._params_cache_at = now
        except IBKRError as exc:
            log.warning(
                "scanner_params fetch failed (%s); reusing last cached value", exc,
            )
            if self._params_cache is None:
                self._params_cache = {}
        return self._params_cache

    # ── Curated presets — joined with live IBKR data ────────────

    async def list_presets(self) -> list[ScannerPreset]:
        """
        Return curated scanner presets enriched with live IBKR `instruments`
        compatibility info.

        Joins CURATED_SCAN_TYPES (constants/scan_types.py — our naming and
        ordering) against IBKR's live `scan_type_list` (which markets each
        scan type supports). The Location dropdown uses each preset's
        `instruments` array to disable markets the scan can't run in.

        Curated entries that aren't in IBKR's live catalogue are dropped
        with a warning — that means IBKR retired the scan type and we
        should remove it from our list too.
        """
        params = await self._get_scanner_params()
        scan_type_index: dict[str, dict[str, Any]] = {
            st.get("code", ""): st
            for st in params.get("scan_type_list", [])
        }

        presets: list[ScannerPreset] = []
        for entry in CURATED_SCAN_TYPES:
            live = scan_type_index.get(entry["code"])
            if not live:
                log.warning(
                    "Curated scan type %r not in IBKR scan_type_list — skipping",
                    entry["code"],
                )
                continue
            presets.append(ScannerPreset(
                instrument="STK",
                scan_type=entry["code"],
                location=DEFAULT_LOCATION_CODE,
                display_name=entry["display_name"],
                category="popular" if entry.get("popular") else "niche",
                default_filters=[
                    IbkrFilterItem(**f) for f in _BASELINE_LIQUIDITY_FILTERS
                ] if entry["code"] in _BASELINE_GATED_SCAN_TYPES else [],
                subtitle=entry.get("subtitle"),
                instruments=list(live.get("instruments", [])),
                group=entry["category"],
            ))

        # Bundled ETF preset — separate instrument code, location dropdown
        # is disabled for it, so the bundled location is the only one used.
        etf_live = scan_type_index.get(_ETF_PRESET["scan_type"], {})
        presets.append(ScannerPreset(
            instrument=_ETF_PRESET["instrument"],
            scan_type=_ETF_PRESET["scan_type"],
            location=_ETF_PRESET["location"],
            display_name=_ETF_PRESET["display_name"],
            category=_ETF_PRESET["category"],
            instruments=list(etf_live.get("instruments", [])),
            group=_ETF_PRESET["group"],
        ))

        return presets

    # ── Curated locations — instrument+location pairs ───────────

    def list_locations(self) -> list[ScannerLocation]:
        """
        Return the curated Location dropdown options. Each entry pairs an
        IBKR `instrument` code with its valid `location` code so the scan
        request can use the right pair regardless of which preset is
        selected. See constants/scan_locations.py.
        """
        return [ScannerLocation(**loc) for loc in CURATED_LOCATIONS]

    # ── Full IBKR catalogue — for the Browse all scans panel ─────

    async def list_all_scan_types(self) -> list[ScannerScanType]:
        """
        Return EVERY scan type IBKR exposes in /iserver/scanner/params,
        bucketed into our category keys (with "other" as the fallback).

        The Browse all scans panel uses this to give power users access
        to the full ~60-scan IBKR catalogue without expanding our curated
        preset list. Curated codes are flagged with `is_curated=True` so
        the panel can mark them differently (these also appear in the
        main preset dropdown).

        Sorted by category (CATEGORY_ORDER), then alphabetically by
        display_name within each category — stable and predictable.
        """
        params = await self._get_scanner_params()
        raw_list = params.get("scan_type_list", [])

        items: list[ScannerScanType] = []
        for st in raw_list:
            code = st.get("code") or ""
            if not code:
                continue
            items.append(ScannerScanType(
                code=code,
                display_name=st.get("display_name") or code,
                instruments=list(st.get("instruments", [])),
                group=categorize_scan_type(code),
                is_curated=code in SCAN_TYPE_BY_CODE,
            ))

        # Sort by (category index, display_name)
        cat_index = {cat: i for i, cat in enumerate(CATEGORY_ORDER)}
        items.sort(key=lambda it: (
            cat_index.get(it.group, len(CATEGORY_ORDER)),
            it.display_name.lower(),
        ))
        return items

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

        # Capture scan_data column header from the IBKR response — used as
        # the price-column FALLBACK label on rows where last_price is None
        # (FIRST_TRADE_DATE_ASC etc.). The list/dict shape of raw_results
        # varies across endpoints; the column name lives on the parent
        # response, which we lost when the IBKR layer flattened to a list.
        # For now we leave scan_data_label per-row to whatever the row
        # carries (IBKR sometimes echoes "scan_data_column_name" in each
        # contract). Future: thread the header through the IBKR layer.
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

        # ── No-quote scan types (FIRST_TRADE_DATE_ASC etc.) ──────
        # Some scan types return rows for instruments that haven't traded
        # yet (upcoming IPOs). Snapshot quotes don't exist for them, so
        # we skip the snapshot batch entirely (saves 5-10s of doomed API
        # calls) AND skip the ticker-only filter (otherwise every row is
        # dropped). The frontend uses scan_data as the price-column
        # fallback to show meaningful info ("First trade: 2026-05-12").
        is_no_quote = scan_type in NO_QUOTE_SCAN_TYPES
        if is_no_quote:
            log.info(
                "No-quote scan type %s — skipping snapshot batch + ticker-only filter",
                scan_type,
            )
            quotes: dict[int, dict[str, Any]] = {}
        else:
            # Fetch snapshot quotes for all conids (two-pass — see _batch_snapshots)
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
        # Exception: NO_QUOTE_SCAN_TYPES (IPOs) — we WANT to show all rows even
        # though they have no price/volume; scan_data carries the meaningful info.
        if not is_no_quote:
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
        Extract conid + metadata + scan_data from IBKR scanner response.
        Handles both flat and nested response formats.

        scan_data is IBKR's per-row "ranking metric" — for TOP_PERC_GAIN it's
        the % change as a string, for FIRST_TRADE_DATE_ASC it's the next
        first-trade date. The frontend uses it as a fallback in the price
        column when last_price is None (e.g. for IPO rows).
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

            # IBKR's scan_data field — sometimes a raw string, sometimes a
            # number, sometimes nested. Capture defensively as Optional[str].
            raw_scan_data = item.get("scan_data")
            scan_data: str | None = None
            if raw_scan_data is not None:
                scan_data = str(raw_scan_data).strip() or None

            scan_data_label = (
                item.get("scan_data_column_name")
                or item.get("scan_data_label")
                or None
            )

            results.append({
                "conid": conid,
                "symbol": (
                    item.get("symbol", "")
                    or item.get("contractDescription", "")
                    or item.get("contract", {}).get("symbol", "")
                ),
                "company_name": item.get("company_name", ""),
                "sec_type": item.get("sec_type", item.get("secType", "")),
                "scan_data": scan_data,
                "scan_data_label": scan_data_label,
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

        async def _fetch_batch(batch: list[int]) -> list[dict] | Exception:
            """Fetch one batch; return exception object instead of raising so
            `asyncio.gather` doesn't short-circuit on a single bad batch.

            Phase 8 / Task 1.3: snapshot() now does pre-flight + delay + real
            call internally. Stragglers are detected post-call below by
            comparing each row to SNAPSHOT_REQUIRED_FIELDS.
            """
            try:
                return await self.ibkr.snapshot(
                    batch,
                    fields=SCREENER_SNAPSHOT_FIELDS,
                )
            except IBKRError as exc:
                return exc

        pass_1_results = await asyncio.gather(
            *(_fetch_batch(b) for b in pass_1_batches),
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
                *(_fetch_batch(b) for b in pass_2_batches),
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
            # scan_data flows through from _parse_scanner_results — used by
            # the frontend as a price-column fallback when last_price is None.
            scan_data=item.get("scan_data"),
            scan_data_label=item.get("scan_data_label"),
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
