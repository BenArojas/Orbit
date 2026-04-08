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
  - Snapshot calls are batched (25 conids per call).
  - max_results caps how many conids we process.
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
from exceptions import ScannerUnavailableError
from models import IbkrFilterItem, ScreenerResultRow, ScanResponse
from services.ibkr import IBKRService

log = logging.getLogger("parallax.screener")

# Default scanner presets exposed to the frontend
DEFAULT_PRESETS: list[dict[str, str]] = [
    {
        "instrument": "STK",
        "scan_type": "MOST_ACTIVE",
        "location": "STK.US.MAJOR",
        "display_name": "Most Active — US Stocks",
    },
    {
        "instrument": "STK",
        "scan_type": "TOP_PERC_GAIN",
        "location": "STK.US.MAJOR",
        "display_name": "Top % Gainers — US Stocks",
    },
    {
        "instrument": "STK",
        "scan_type": "TOP_PERC_LOSE",
        "location": "STK.US.MAJOR",
        "display_name": "Top % Losers — US Stocks",
    },
    {
        "instrument": "STK",
        "scan_type": "HOT_BY_VOLUME",
        "location": "STK.US.MAJOR",
        "display_name": "Hot by Volume — US Stocks",
    },
    {
        "instrument": "STK",
        "scan_type": "HIGH_VS_52W_HL",
        "location": "STK.US.MAJOR",
        "display_name": "52-Week Highs — US Stocks",
    },
    {
        "instrument": "STK",
        "scan_type": "LOW_VS_52W_HL",
        "location": "STK.US.MAJOR",
        "display_name": "52-Week Lows — US Stocks",
    },
    {
        "instrument": "STK",
        "scan_type": "TOP_PERC_GAIN",
        "location": "STK.US.MINOR",
        "display_name": "Top % Gainers — US Small Cap",
    },
    {
        "instrument": "ETF.EQ.US",
        "scan_type": "MOST_ACTIVE",
        "location": "ETF.EQ.US.MAJOR",
        "display_name": "Most Active — US Equity ETFs",
    },
    {
        "instrument": "STK",
        "scan_type": "MOST_ACTIVE",
        "location": "STK.EU.IBIS",
        "display_name": "Most Active — Germany",
    },
    {
        "instrument": "STOCK.HK",
        "scan_type": "MOST_ACTIVE",
        "location": "STK.HK.SEHK",
        "display_name": "Most Active — Hong Kong",
    },
    {
        "instrument": "STK",
        "scan_type": "MOST_ACTIVE",
        "location": "STK.US.MAJOR",
        "display_name": "Earnings This Week — US Stocks",
        "default_filters": [{"code": "wshEarningsDate", "value": "5"}],
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

        if not raw_results:
            raise ScannerUnavailableError(
                f"Scanner '{scan_type}' returned no results for {location}"
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

        # Fetch snapshot quotes for all conids
        conid_list = [u["conid"] for u in universe]
        quotes = await self._batch_snapshots(conid_list)

        # Build result rows
        rows = [
            self._build_row(item, quotes.get(item["conid"], {}))
            for item in universe
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
        """
        quotes: dict[int, dict[str, Any]] = {}

        for i in range(0, len(conids), SNAPSHOT_BATCH_SIZE):
            batch = conids[i : i + SNAPSHOT_BATCH_SIZE]
            try:
                raw = await self.ibkr.snapshot(
                    batch,
                    fields=SCREENER_SNAPSHOT_FIELDS,
                    timeout=8.0,
                )
                for item in raw:
                    cid = item.get("conid")
                    if cid:
                        quotes[int(cid)] = item
            except Exception as exc:
                log.warning(
                    "Snapshot batch failed (batch %d, size %d): %s",
                    i // SNAPSHOT_BATCH_SIZE, len(batch), exc,
                )

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
