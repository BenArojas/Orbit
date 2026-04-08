"""
Screener service — scan instruments using IBKR Scanner presets + indicator filters.

Flow:
  1. Run IBKR scanner preset to get a universe of instruments (conids)
  2. Fetch snapshot quotes for each instrument
  3. Fetch candle data + compute indicators for matching instruments
  4. Apply user's indicator filters
  5. Return sorted results

The scanner presets come from IBKR's /iserver/scanner/run endpoint.
Indicator filters are applied locally after computation.

Performance notes:
  - IBKR rate limits are the bottleneck. We batch snapshot calls and
    cap max_results to avoid hammering the API.
  - Indicator computation happens per-instrument (reuses IndicatorService).
  - Results are not persisted — each scan is fresh.
"""

import asyncio
import logging
import math
from typing import Any

from constants import PERIOD_BAR
from exceptions import ScannerFilterError, ScannerUnavailableError
from models import (
    CandleData,
    ScreenerFilterItem,
    ScreenerResultRow,
    ScanResponse,
)
from services.ibkr import IBKRService
from services.indicators import IndicatorService

log = logging.getLogger("parallax.screener")

# ── Default scanner presets ─────────────────────────────────
# Common presets users will want. The frontend can also fetch
# the full list from IBKR via GET /screener/presets.

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
        "scan_type": "TOP_PERC_GAIN",
        "location": "STK.US.MINOR",
        "display_name": "Top % Gainers — US Small Cap",
    },
    {
        "instrument": "STK",
        "scan_type": "MOST_ACTIVE",
        "location": "STK.EU",
        "display_name": "Most Active — Europe",
    },
    {
        "instrument": "ETF.EQ.US",
        "scan_type": "MOST_ACTIVE",
        "location": "STK.US.MAJOR",
        "display_name": "Most Active — US ETFs",
    },
]

# Screener always uses daily bars for indicator computation.
# Intraday screener would be too slow (too many API calls per instrument).
SCREENER_PERIOD = "3M"
SCREENER_IBKR_PERIOD = "3m"
SCREENER_IBKR_BAR = "1d"

# Max concurrent IBKR history requests (stay well under rate limit)
MAX_CONCURRENT_HISTORY = 5

# Snapshot batch size — IBKR allows up to ~50 conids per snapshot call
SNAPSHOT_BATCH_SIZE = 25


class ScreenerService:
    """
    Scans instruments using IBKR scanner presets and applies indicator filters.
    Stateless — create one instance and reuse.
    """

    def __init__(self, ibkr: IBKRService) -> None:
        self.ibkr = ibkr
        self._indicators = IndicatorService()

    async def scan(
        self,
        instrument: str,
        scan_type: str,
        location: str,
        filters: list[ScreenerFilterItem],
        indicators: list[str],
        max_results: int = 50,
    ) -> ScanResponse:
        """
        Run a full screener scan.

        1. Run IBKR scanner to get universe
        2. Fetch quotes for all results
        3. Compute indicators for each (capped by max_results)
        4. Apply user filters
        5. Return matches
        """
        # Step 1: Get universe from IBKR scanner
        log.info(
            "Running scanner: %s / %s / %s",
            instrument, scan_type, location,
        )
        raw_results = await self.ibkr.scanner_run(
            instrument=instrument,
            scan_type=scan_type,
            location=location,
        )

        if not raw_results:
            raise ScannerUnavailableError(
                f"Scanner '{scan_type}' returned no results for {location}"
            )

        # Extract conids from scanner results
        universe = self._parse_scanner_results(raw_results, max_results)
        total_scanned = len(universe)
        log.info("Scanner returned %d instruments (capped at %d)", total_scanned, max_results)

        if not universe:
            return ScanResponse(
                results=[],
                total_scanned=0,
                total_matched=0,
                scan_type=scan_type,
                location=location,
            )

        # Step 2: Fetch snapshot quotes for all instruments (batched)
        conid_list = [u["conid"] for u in universe]
        quotes = await self._batch_snapshots(conid_list)

        # Step 3: Compute indicators for each instrument (concurrency-limited)
        rows = await self._compute_all_indicators(
            universe, quotes, indicators
        )

        # Step 4: Apply user filters
        if filters:
            rows = self._apply_filters(rows, filters)

        return ScanResponse(
            results=rows,
            total_scanned=total_scanned,
            total_matched=len(rows),
            scan_type=scan_type,
            location=location,
        )

    def _parse_scanner_results(
        self, raw: list[dict], max_results: int
    ) -> list[dict[str, Any]]:
        """
        Extract conid + symbol + metadata from IBKR scanner response.
        Scanner response format varies — handle both flat and nested.
        """
        results: list[dict[str, Any]] = []
        for item in raw[:max_results]:
            conid = item.get("conid") or item.get("con_id") or item.get("conId")
            if not conid:
                # Nested format: item might have a "contract_id" or nested "contract"
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
        Fetch market data snapshots in batches.
        Returns {conid: quote_data} dict.
        """
        quotes: dict[int, dict[str, Any]] = {}

        for i in range(0, len(conids), SNAPSHOT_BATCH_SIZE):
            batch = conids[i : i + SNAPSHOT_BATCH_SIZE]
            try:
                raw = await self.ibkr.snapshot(batch, timeout=8.0)
                for item in raw:
                    cid = item.get("conid")
                    if cid:
                        quotes[int(cid)] = item
            except Exception as exc:
                log.warning("Snapshot batch failed (conids %d-%d): %s", i, i + len(batch), exc)

        return quotes

    async def _compute_all_indicators(
        self,
        universe: list[dict[str, Any]],
        quotes: dict[int, dict[str, Any]],
        indicators: list[str],
    ) -> list[ScreenerResultRow]:
        """
        Fetch candles and compute indicators for all instruments.
        Uses a semaphore to limit concurrent IBKR history calls.
        """
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_HISTORY)
        tasks = [
            self._compute_one(item, quotes, indicators, semaphore)
            for item in universe
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        rows: list[ScreenerResultRow] = []
        for result in results:
            if isinstance(result, ScreenerResultRow):
                rows.append(result)
            elif isinstance(result, Exception):
                log.debug("Skipped instrument in scan: %s", result)

        return rows

    async def _compute_one(
        self,
        item: dict[str, Any],
        quotes: dict[int, dict[str, Any]],
        indicators: list[str],
        semaphore: asyncio.Semaphore,
    ) -> ScreenerResultRow:
        """
        Compute indicators for a single instrument.
        Returns a ScreenerResultRow with latest indicator values.
        """
        conid = item["conid"]
        quote = quotes.get(conid, {})

        # Extract basic quote info
        last_price = _safe_float(quote.get("31"))
        change_pct = _safe_float(quote.get("83"))
        volume = _safe_float(quote.get("7762"))
        symbol = item.get("symbol", "") or quote.get("55", "")
        company_name = item.get("company_name", "") or quote.get("7051", "")

        # Fetch candles and compute indicators
        indicator_values: dict[str, float | None] = {}

        async with semaphore:
            try:
                raw = await self.ibkr.history(
                    conid,
                    period=SCREENER_IBKR_PERIOD,
                    bar=SCREENER_IBKR_BAR,
                )
                bars = raw.get("data", [])
                candles = [
                    CandleData(
                        time=bar["t"] // 1000,
                        open=bar["o"],
                        high=bar["h"],
                        low=bar["l"],
                        close=bar["c"],
                        volume=bar.get("v", 0),
                    )
                    for bar in bars
                    if "t" in bar
                ]

                if candles:
                    computed, _fib = self._indicators.compute(
                        candles=candles,
                        indicators=indicators,
                    )
                    indicator_values = self._extract_latest_values(computed)

            except Exception as exc:
                log.debug("Failed to compute indicators for conid %d: %s", conid, exc)

        return ScreenerResultRow(
            conid=conid,
            symbol=symbol,
            company_name=company_name,
            sec_type=item.get("sec_type", ""),
            last_price=last_price,
            change_percent=change_pct,
            volume=volume,
            indicator_values=indicator_values,
        )

    def _extract_latest_values(
        self, computed: list
    ) -> dict[str, float | None]:
        """
        Pull the most recent value from each indicator result.
        For multi-value indicators (MACD, BBands), extract the primary value.
        """
        latest: dict[str, float | None] = {}
        for ind in computed:
            name = ind.name
            if not ind.values:
                latest[name] = None
                continue

            last_val = ind.values[-1]
            latest[name] = last_val.value

            # MACD: also expose signal and histogram
            if name == "macd" and last_val.signal is not None:
                latest["macd_signal"] = last_val.signal
                latest["macd_histogram"] = last_val.histogram

            # Bollinger: expose upper/lower
            if name == "bbands":
                latest["bbands_upper"] = last_val.upper
                latest["bbands_lower"] = last_val.lower

            # Stochastic: expose K and D
            if name == "stoch" and last_val.signal is not None:
                latest["stoch_d"] = last_val.signal

        return latest

    def _apply_filters(
        self,
        rows: list[ScreenerResultRow],
        filters: list[ScreenerFilterItem],
    ) -> list[ScreenerResultRow]:
        """
        Filter rows by user-defined indicator criteria.
        A row must pass ALL filters (AND logic).
        """
        matched: list[ScreenerResultRow] = []

        for row in rows:
            if self._row_passes_all(row, filters):
                matched.append(row)

        return matched

    def _row_passes_all(
        self,
        row: ScreenerResultRow,
        filters: list[ScreenerFilterItem],
    ) -> bool:
        """Check if a single row passes all filter criteria."""
        for f in filters:
            actual = self._resolve_value(row, f.indicator)
            if actual is None:
                return False  # Missing data → exclude

            if not self._eval_op(actual, f.op, f.value, f.value2):
                return False

        return True

    def _resolve_value(
        self, row: ScreenerResultRow, indicator: str
    ) -> float | None:
        """
        Resolve an indicator name to a numeric value from the row.
        Special names like 'price', 'volume', 'change_percent' map to
        quote fields. Everything else looks up indicator_values.
        """
        if indicator == "price":
            return row.last_price
        if indicator == "volume":
            return row.volume
        if indicator == "change_percent":
            return row.change_percent
        return row.indicator_values.get(indicator)

    def _eval_op(
        self,
        actual: float,
        op: str,
        value: float,
        value2: float | None,
    ) -> bool:
        """Evaluate a single filter operation."""
        if math.isnan(actual):
            return False

        if op == "gt":
            return actual > value
        if op == "lt":
            return actual < value
        if op == "between":
            if value2 is None:
                raise ScannerFilterError(
                    "Filter op 'between' requires value2"
                )
            low, high = sorted([value, value2])
            return low <= actual <= high
        # cross_above / cross_below need historical context — for now
        # we treat them as gt/lt on the latest value. Full crossover
        # detection requires comparing previous bar, which we can add
        # when the frontend needs it.
        if op == "cross_above":
            return actual > value
        if op == "cross_below":
            return actual < value

        raise ScannerFilterError(f"Unknown filter operator: {op}")


def _safe_float(value: Any) -> float | None:
    """Convert a value to float, or None if invalid."""
    if value is None:
        return None
    try:
        result = float(value)
        if result != result:  # NaN check
            return None
        return result
    except (ValueError, TypeError):
        return None
