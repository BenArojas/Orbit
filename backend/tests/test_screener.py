"""
Tests for the screener service + router (Phase 5 — tasks 5.3, 5.4, 5.6).

All tests mock the IBKRService — no live API calls, no pandas-ta dependency.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.ibkr import IBKRService

from models import (
    ContractInfoResponse,
    IbkrFilterItem,
    ScannerPreset,
    ScanRequest,
    ScanResponse,
    ScreenerResultRow,
    ScannerParamsResponse,
)
from exceptions import IBKRError, IBKRRequestError
from services.screener import (
    DEFAULT_PRESETS,
    ScreenerService,
    _BASELINE_LIQUIDITY_FILTERS,
    _safe_float,
)


# ── Fixtures ─────────────────────────────────────────────────


def _synthesize_snapshot_from_scan(scan_results):
    """Build a minimal full-field snapshot response from scanner output.

    Ensures rows survive the ticker-only filter (price+volume present) and the
    SNAPSHOT_REQUIRED_FIELDS gate (includes 7289). Used when tests don't care
    about the specific quote values but need rows to pass through the pipeline.
    """
    return [
        {
            "conid": r["conid"],
            "55": r.get("symbol", f"T{r['conid']}"),
            "7051": r.get("company_name", ""),
            "31": "10.00",
            "83": "0.00",
            "7762": "1000000",
            "7289": "500000",
        }
        for r in scan_results
    ]


def make_ibkr_mock(scan_results=None, snapshot_results=None, contract_info=None):
    """Build a mock IBKRService with preset return values.

    When `snapshot_results=None`, synthesizes full-field snapshots from
    `scan_results` so rows survive the ticker-only filter + required-fields
    gate. Pass `snapshot_results=[]` explicitly to simulate a dead snapshot.
    """
    ibkr = MagicMock()

    if scan_results is None:
        scan_results = [
            {"conid": 265598, "symbol": "AAPL", "sec_type": "STK"},
            {"conid": 272093, "symbol": "MSFT", "sec_type": "STK"},
        ]

    if snapshot_results is None:
        # Use AAPL/MSFT realistic defaults for the default scan, otherwise
        # auto-synthesize from the custom scan_results.
        default_conids = {265598, 272093}
        if {r["conid"] for r in scan_results} == default_conids:
            snapshot_results = [
                {
                    "conid": 265598,
                    "55": "AAPL",
                    "7051": "Apple Inc.",
                    "31": "185.50",
                    "83": "1.23",
                    "7762": "52000000",
                    "7289": "2900000",
                },
                {
                    "conid": 272093,
                    "55": "MSFT",
                    "7051": "Microsoft Corp.",
                    "31": "415.00",
                    "83": "-0.45",
                    "7762": "21000000",
                    "7289": "3100000",
                },
            ]
        else:
            snapshot_results = _synthesize_snapshot_from_scan(scan_results)

    ibkr.scanner_run = AsyncMock(return_value=scan_results)
    ibkr.snapshot = AsyncMock(return_value=snapshot_results)
    # contract_info defaults to a usable marketCap so enrichment paths don't
    # explode in tests that don't care about it.
    ibkr.contract_info = AsyncMock(
        return_value=contract_info if contract_info is not None
        else {"marketCap": "1500000"}
    )
    return ibkr


# ── ScreenerService.scan ──────────────────────────────────────


class TestScreenerServiceScan:

    @pytest.mark.asyncio
    async def test_basic_scan_returns_rows(self):
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)

        result = await svc.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            max_results=50,
        )

        assert isinstance(result, ScanResponse)
        assert len(result.results) == 2
        assert result.scan_type == "MOST_ACTIVE"
        assert result.location == "STK.US.MAJOR"
        assert result.total_scanned == 2

    @pytest.mark.asyncio
    async def test_result_row_fields(self):
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)

        result = await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50)

        row = result.results[0]
        assert row.conid == 265598
        assert row.symbol == "AAPL"
        assert row.company_name == "Apple Inc."
        assert row.last_price == pytest.approx(185.50)
        assert row.change_percent == pytest.approx(1.23)
        assert row.volume == pytest.approx(52_000_000)

    @pytest.mark.asyncio
    async def test_native_filters_passed_to_ibkr(self):
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)

        filters = [
            IbkrFilterItem(code="marketCapAbove1e6", value="1000"),
            IbkrFilterItem(code="minPeRatio", value="5"),
        ]

        await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", filters, 50)

        ibkr.scanner_run.assert_called_once()
        call_kwargs = ibkr.scanner_run.call_args
        passed_filters = call_kwargs.kwargs.get("filters") or call_kwargs.args[3] if len(call_kwargs.args) > 3 else call_kwargs.kwargs.get("filters")
        assert passed_filters is not None
        assert {"code": "marketCapAbove1e6", "value": "1000"} in passed_filters
        assert {"code": "minPeRatio", "value": "5"} in passed_filters

    @pytest.mark.asyncio
    async def test_empty_filters_passes_none_to_ibkr(self):
        """Screener passes filters=None to scanner_run when no filters given."""
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)

        await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50)

        call_kwargs = ibkr.scanner_run.call_args.kwargs
        assert call_kwargs.get("filters") is None

    @pytest.mark.asyncio
    async def test_no_sort_field_passes_empty_sort_to_ibkr(self):
        """
        Regression (8.3): the frontend no longer sends sort_field / sort_direction
        because sorting moved to the client (zustand). Backend must still accept
        the no-sort path and pass sort="" to scanner_run without crashing.
        """
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)

        await svc.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            max_results=50,
            # sort_field / sort_direction intentionally omitted
        )

        call_kwargs = ibkr.scanner_run.call_args.kwargs
        # Either not present OR empty string — both mean "no sort" to IBKR.
        assert call_kwargs.get("sort", "") == ""

    @pytest.mark.asyncio
    async def test_returns_empty_scan_response_on_empty_scanner(self):
        """
        Behaviour change (Phase 5C): an IBKR scanner returning 0 contracts is a
        legitimate "no matches right now" — surface it as an empty ScanResponse,
        not an error. The frontend re-shows the quick-pick cards in this state.
        """
        ibkr = make_ibkr_mock(scan_results=[])
        svc = ScreenerService(ibkr)

        result = await svc.scan(
            "STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50,
        )

        assert isinstance(result, ScanResponse)
        assert result.results == []
        assert result.total_scanned == 0
        assert result.total_matched == 0
        assert result.scan_type == "MOST_ACTIVE"
        assert result.location == "STK.US.MAJOR"

    @pytest.mark.asyncio
    async def test_max_results_caps_universe(self):
        many = [{"conid": 100 + i, "symbol": f"T{i}"} for i in range(100)]
        ibkr = make_ibkr_mock(scan_results=many, snapshot_results=[])
        svc = ScreenerService(ibkr)

        result = await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 10)

        assert result.total_scanned == 10

    @pytest.mark.asyncio
    async def test_snapshot_batch_called_once_for_small_universe(self):
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)

        await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50)

        # 2 conids → 1 batch call
        assert ibkr.snapshot.call_count == 1

    @pytest.mark.asyncio
    async def test_snapshot_batching_for_large_universe(self):
        many = [{"conid": 100 + i, "symbol": f"T{i}"} for i in range(60)]
        # Mock auto-synthesizes full-field snapshots → no stragglers → no pass 2.
        ibkr = make_ibkr_mock(scan_results=many)
        svc = ScreenerService(ibkr)

        await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 60)

        # 60 conids / 25 per batch = 3 calls (pass 1 only)
        assert ibkr.snapshot.call_count == 3

    @pytest.mark.asyncio
    async def test_partial_quote_fields_preserved_as_none(self):
        """
        Row with SOME quote data (e.g. price but no change%/volume) survives
        the ticker-only filter and missing fields come back as None.
        """
        scan_results = [{"conid": 999, "symbol": "XYZ"}]
        # Snapshot has price only — no change%, no volume
        snapshot_results = [{"conid": 999, "55": "XYZ", "31": "12.34"}]

        ibkr = make_ibkr_mock(
            scan_results=scan_results,
            snapshot_results=snapshot_results,
        )
        svc = ScreenerService(ibkr)

        result = await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50)

        assert len(result.results) == 1
        row = result.results[0]
        assert row.last_price == 12.34
        assert row.change_percent is None
        assert row.volume is None

    @pytest.mark.asyncio
    async def test_ticker_only_rows_are_dropped(self):
        """
        Row with NO price AND NO volume (IBKR gave us just a ticker) is hidden.
        Ticker-only rows made the table look broken — dropping them is cleaner
        than showing a row full of em-dashes.
        """
        scan_results = [{"conid": 999, "symbol": "XYZ"}]
        snapshot_results = []  # No quotes at all

        ibkr = make_ibkr_mock(
            scan_results=scan_results,
            snapshot_results=snapshot_results,
        )
        svc = ScreenerService(ibkr)

        result = await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50)

        assert result.results == []
        assert result.total_scanned == 1  # pre-filter count still counts it
        assert result.total_matched == 0

    @pytest.mark.asyncio
    async def test_snapshot_error_skips_batch_gracefully(self):
        """A failing snapshot batch (IBKRError) doesn't crash — rows with no
        data become ticker-only and get filtered out. scan() still returns a
        valid (empty) ScanResponse instead of propagating the error."""
        ibkr = make_ibkr_mock()
        ibkr.snapshot = AsyncMock(side_effect=IBKRError("network error"))
        svc = ScreenerService(ibkr)

        result = await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50)

        assert isinstance(result, ScanResponse)
        # Both AAPL & MSFT had no snapshot data → dropped as ticker-only
        assert result.results == []
        assert result.total_scanned == 2


# ── _parse_scanner_results ────────────────────────────────────


class TestParseResults:

    def test_flat_conid_format(self):
        svc = ScreenerService(MagicMock())
        raw = [{"conid": 100, "symbol": "AAPL"}, {"conid": 200, "symbol": "MSFT"}]
        parsed = svc._parse_scanner_results(raw, 10)
        assert len(parsed) == 2
        assert parsed[0]["conid"] == 100

    def test_nested_contract_format(self):
        svc = ScreenerService(MagicMock())
        raw = [{"contract": {"conid": 999, "symbol": "XYZ"}}]
        parsed = svc._parse_scanner_results(raw, 10)
        assert len(parsed) == 1
        assert parsed[0]["conid"] == 999

    def test_con_id_alias(self):
        svc = ScreenerService(MagicMock())
        raw = [{"con_id": 555, "symbol": "ABC"}]
        parsed = svc._parse_scanner_results(raw, 10)
        assert parsed[0]["conid"] == 555

    def test_skips_missing_conid(self):
        svc = ScreenerService(MagicMock())
        raw = [{"symbol": "NOCONID"}, {"conid": 100, "symbol": "OK"}]
        parsed = svc._parse_scanner_results(raw, 10)
        assert len(parsed) == 1
        assert parsed[0]["conid"] == 100

    def test_respects_max_results(self):
        svc = ScreenerService(MagicMock())
        raw = [{"conid": i + 1} for i in range(100)]  # start at 1 (0 is falsy)
        parsed = svc._parse_scanner_results(raw, 5)
        assert len(parsed) == 5

    def test_string_conid_cast_to_int(self):
        svc = ScreenerService(MagicMock())
        raw = [{"conid": "12345", "symbol": "STR"}]
        parsed = svc._parse_scanner_results(raw, 10)
        assert parsed[0]["conid"] == 12345

    def test_invalid_conid_skipped(self):
        svc = ScreenerService(MagicMock())
        raw = [{"conid": "not_a_number"}, {"conid": 100}]
        parsed = svc._parse_scanner_results(raw, 10)
        assert len(parsed) == 1


# ── _build_row ────────────────────────────────────────────────


class TestBuildRow:

    def test_builds_from_quote(self):
        svc = ScreenerService(MagicMock())
        item = {"conid": 100, "symbol": "AAPL", "sec_type": "STK", "company_name": ""}
        quote = {
            "55": "AAPL",
            "7051": "Apple Inc.",
            "31": "185.00",
            "83": "1.5",
            "7762": "50000000",
        }
        row = svc._build_row(item, quote)
        assert row.conid == 100
        assert row.symbol == "AAPL"
        assert row.company_name == "Apple Inc."
        assert row.last_price == pytest.approx(185.0)
        assert row.change_percent == pytest.approx(1.5)
        assert row.volume == pytest.approx(50_000_000)

    def test_falls_back_to_scanner_metadata(self):
        svc = ScreenerService(MagicMock())
        item = {"conid": 100, "symbol": "AAPL", "company_name": "Apple", "sec_type": "STK"}
        quote = {}  # No snapshot data
        row = svc._build_row(item, quote)
        assert row.symbol == "AAPL"
        assert row.company_name == "Apple"

    def test_invalid_price_is_none(self):
        svc = ScreenerService(MagicMock())
        item = {"conid": 100, "symbol": "X", "company_name": "", "sec_type": "STK"}
        quote = {"31": "N/A", "83": "", "7762": None}
        row = svc._build_row(item, quote)
        assert row.last_price is None
        assert row.change_percent is None
        assert row.volume is None


# ── Default presets ───────────────────────────────────────────


class TestDefaultPresets:

    def test_all_presets_have_required_fields(self):
        for p in DEFAULT_PRESETS:
            assert "instrument" in p
            assert "scan_type" in p
            assert "location" in p
            assert "display_name" in p
            assert "category" in p

    def test_presets_instantiate_as_models(self):
        for p in DEFAULT_PRESETS:
            preset = ScannerPreset(**p)
            assert preset.scan_type
            assert preset.location
            assert preset.category in ("popular", "niche")

    def test_at_least_one_preset(self):
        assert len(DEFAULT_PRESETS) >= 1

    def test_preset_grouping_counts(self):
        """6 popular + 21 niche = 27 total. (Was 15 before Path B added 12
        scan types from MoonMarket: MOST_ACTIVE_USD, TOP_TRADE_COUNT,
        HIGH_STVOLUME_5MIN, TOP_AFTER_HOURS_PERC_GAIN/LOSE, HIGH/LOW_OPEN_GAP,
        LOW_OPT_IMP_VOLAT, TOP_OPT_IMP_VOLAT_GAIN/LOSE, HALTED, FIRST_TRADE_DATE_ASC.)
        """
        popular = [p for p in DEFAULT_PRESETS if p["category"] == "popular"]
        niche = [p for p in DEFAULT_PRESETS if p["category"] == "niche"]
        assert len(popular) == 6
        assert len(niche) == 21
        assert len(DEFAULT_PRESETS) == 27

    def test_popular_presets_match_spec(self):
        """The 6 popular presets are region-agnostic — region now comes from
        the Location dropdown in the UI, so the display names dropped their
        '— US Stocks' suffix. 'Most Active' was renamed to 'Most Active (Shares)'
        to disambiguate from 'Most Active (Dollar Volume)' (new niche preset)."""
        popular_names = {
            p["display_name"] for p in DEFAULT_PRESETS
            if p["category"] == "popular"
        }
        assert popular_names == {
            "Most Active (Shares)",
            "Top % Gainers",
            "Top % Losers",
            "Hot by Volume",
            "52-Week Highs",
            "52-Week Lows",
        }

    def test_niche_presets_include_new_screens(self):
        """Spec §3 additions must be present in the niche group."""
        niche_scan_types = {
            p["scan_type"] for p in DEFAULT_PRESETS
            if p["category"] == "niche"
        }
        # All 8 new scan types / location variants from spec §3
        required = {
            "TOP_OPEN_PERC_GAIN",      # Pre-Market Gainers
            "TOP_OPEN_PERC_LOSE",      # Pre-Market Losers
            "HIGH_VS_13W_HL",          # 13-Week Highs
            "LOW_VS_13W_HL",           # 13-Week Lows
            "HIGH_DIVIDEND_YIELD_IB",  # High Dividend Yield
            "HIGH_OPT_IMP_VOLAT",      # High Implied Vol
            "OPT_VOLUME_MOST_ACTIVE",  # Top Options Volume
            "HIGH_GROWTH_RATE",        # High Growth Rate
        }
        assert required.issubset(niche_scan_types)


# ── Models ────────────────────────────────────────────────────


class TestScreenerModels:

    def test_ibkr_filter_item(self):
        f = IbkrFilterItem(code="marketCapAbove1e6", value="1000")
        assert f.code == "marketCapAbove1e6"
        assert f.value == "1000"

    def test_scan_request_defaults(self):
        req = ScanRequest()
        assert req.instrument == "STK"
        assert req.scan_type == "MOST_ACTIVE"
        assert req.location == "STK.US.MAJOR"
        assert req.filters == []
        assert req.max_results == 200
        assert req.sort_field == ""
        assert req.sort_direction == "desc"
        assert req.page == 1
        assert req.page_size == 25

    def test_scan_request_with_filters(self):
        req = ScanRequest(
            filters=[IbkrFilterItem(code="minPeRatio", value="5")]
        )
        assert len(req.filters) == 1
        assert req.filters[0].code == "minPeRatio"

    def test_scan_request_max_results_bounds(self):
        with pytest.raises(Exception):
            ScanRequest(max_results=0)
        with pytest.raises(Exception):
            ScanRequest(max_results=501)

    def test_screener_result_row_optional_fields(self):
        row = ScreenerResultRow(conid=123)
        assert row.last_price is None
        assert row.change_percent is None
        assert row.volume is None

    def test_scan_response_structure(self):
        resp = ScanResponse(
            results=[],
            total_scanned=0,
            total_matched=0,
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
        )
        assert resp.total_scanned == 0


# ── _safe_float ───────────────────────────────────────────────


class TestSafeFloat:

    def test_numeric_string(self):
        assert _safe_float("185.50") == pytest.approx(185.50)

    def test_integer(self):
        assert _safe_float(42) == pytest.approx(42.0)

    def test_none_returns_none(self):
        assert _safe_float(None) is None

    def test_empty_string_returns_none(self):
        assert _safe_float("") is None

    def test_non_numeric_returns_none(self):
        assert _safe_float("N/A") is None
        assert _safe_float("n/a") is None

    def test_nan_returns_none(self):
        assert _safe_float(float("nan")) is None


# ── Snapshot two-pass (Phase 5C) ──────────────────────────────


class TestSnapshotTwoPass:
    """
    Phase 5C: `_batch_snapshots` runs a second pass for any conid missing a
    required field after pass 1. Pass-2 fields merge on top of pass-1 without
    wiping fields pass-1 already filled.
    """

    @pytest.mark.asyncio
    async def test_pass_two_merges_with_pass_one(self):
        """
        Pass 1 returns AAPL with price + symbol + chg%, but no volume.
        Pass 2 returns AAPL with volume only.
        Final merged quote has ALL required fields.
        (Side-effect test only — we don't spy on call counts.)
        """
        scan_results = [{"conid": 265598, "symbol": "AAPL"}]
        pass_1 = [{"conid": 265598, "55": "AAPL", "31": "185.50", "83": "1.23"}]
        pass_2 = [{"conid": 265598, "7762": "52000000"}]

        ibkr = make_ibkr_mock(scan_results=scan_results)
        ibkr.snapshot = AsyncMock(side_effect=[pass_1, pass_2])
        svc = ScreenerService(ibkr)

        result = await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50)

        assert len(result.results) == 1
        row = result.results[0]
        # Pass 1 values survived
        assert row.last_price == 185.50
        assert row.change_percent == 1.23
        # Pass 2 filled the straggler
        assert row.volume == 52000000.0


# ── Pagination Tests ──────────────────────────────────────────


class TestPagination:

    @pytest.mark.asyncio
    async def test_pagination_first_page(self):
        """First page of 60 results, page_size=25 → 25 rows, total_pages=3."""
        many = [{"conid": 100 + i, "symbol": f"T{i}"} for i in range(60)]
        ibkr = make_ibkr_mock(scan_results=many)
        svc = ScreenerService(ibkr)

        result = await svc.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            max_results=200,
            sort_field="",
            sort_direction="desc",
            page=1,
            page_size=25,
        )

        assert len(result.results) == 25
        assert result.total_pages == 3
        assert result.page == 1
        assert result.page_size == 25
        assert result.total_matched == 60

    @pytest.mark.asyncio
    async def test_pagination_last_page(self):
        """Last page of 60 results, page_size=25 → 10 rows."""
        many = [{"conid": 100 + i, "symbol": f"T{i}"} for i in range(60)]
        ibkr = make_ibkr_mock(scan_results=many)
        svc = ScreenerService(ibkr)

        result = await svc.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            max_results=200,
            sort_field="",
            sort_direction="desc",
            page=3,
            page_size=25,
        )

        assert len(result.results) == 10
        assert result.total_pages == 3
        assert result.page == 3

    @pytest.mark.asyncio
    async def test_pagination_out_of_range(self):
        """Out-of-range page → 0 rows."""
        many = [{"conid": 100 + i, "symbol": f"T{i}"} for i in range(60)]
        ibkr = make_ibkr_mock(scan_results=many)
        svc = ScreenerService(ibkr)

        result = await svc.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            max_results=200,
            sort_field="",
            sort_direction="desc",
            page=5,
            page_size=25,
        )

        assert len(result.results) == 0
        assert result.page == 5
        assert result.total_pages == 3


# ── Sort Field Tests ──────────────────────────────────────────


class TestSortField:

    @pytest.mark.asyncio
    async def test_sort_field_passed_to_ibkr(self):
        """Verify sort field is passed through to scanner_run."""
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)

        await svc.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            max_results=50,
            sort_field="changePercAbove",
            sort_direction="desc",
            page=1,
            page_size=25,
        )

        ibkr.scanner_run.assert_called_once()
        call_kwargs = ibkr.scanner_run.call_args.kwargs
        assert call_kwargs.get("sort") == "changePercAbove"

    @pytest.mark.asyncio
    async def test_sort_field_asc_appends_asc(self):
        """Verify sort direction adds 'Asc' suffix."""
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)

        await svc.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            max_results=50,
            sort_field="price",
            sort_direction="asc",
            page=1,
            page_size=25,
        )

        call_kwargs = ibkr.scanner_run.call_args.kwargs
        assert call_kwargs.get("sort") == "priceAsc"

    @pytest.mark.asyncio
    async def test_empty_sort_field_passes_empty_string(self):
        """Empty sort_field → empty sort passed to IBKR."""
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)

        await svc.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            max_results=50,
            sort_field="",
            sort_direction="desc",
            page=1,
            page_size=25,
        )

        call_kwargs = ibkr.scanner_run.call_args.kwargs
        assert call_kwargs.get("sort") == ""


# ── Contract Info Tests ───────────────────────────────────────


class TestContractInfo:

    @pytest.mark.asyncio
    async def test_contract_info_endpoint(self):
        """Verify contract_info endpoint calls ibkr service."""
        ibkr = make_ibkr_mock()
        ibkr.contract_info = AsyncMock(return_value={
            "symbol": "AAPL",
            "companyName": "Apple Inc.",
            "exchange": "NASDAQ",
            "currency": "USD",
            "industry": "Technology",
            "category": "Large Cap",
            "avgVolume": "50000000",
            "marketCap": "2900000",
            "week52hi": "200.00",
            "week52lo": "150.00",
            "peRatio": "25.5",
            "dividendYield": "0.5",
        })
        svc = ScreenerService(ibkr)

        # Simulate endpoint behavior
        raw = await svc.ibkr.contract_info(265598)
        assert raw["symbol"] == "AAPL"
        ibkr.contract_info.assert_called_once_with(265598)


# ── Preset Tests ──────────────────────────────────────────────


class TestPresets:

    def test_no_wsh_earnings_preset(self):
        """Earnings This Week preset removed — requires paid WSH subscription."""
        earnings_presets = [
            p for p in DEFAULT_PRESETS
            if "Earnings" in p.get("display_name", "")
        ]
        assert len(earnings_presets) == 0

    def test_no_germany_preset(self):
        """Germany preset removed — focus is US equities/ETFs."""
        germany_presets = [
            p for p in DEFAULT_PRESETS
            if "Germany" in p.get("display_name", "")
        ]
        assert len(germany_presets) == 0

    def test_no_hong_kong_preset(self):
        """Hong Kong preset removed — focus is US equities/ETFs."""
        hk_presets = [
            p for p in DEFAULT_PRESETS
            if "Hong Kong" in p.get("display_name", "")
        ]
        assert len(hk_presets) == 0

    def test_default_filters_on_preset(self):
        """Verify ScannerPreset model accepts default_filters field."""
        # Build a synthetic preset dict with default_filters to test the model
        preset_dict = {
            "instrument": "STK",
            "scan_type": "MOST_ACTIVE",
            "location": "STK.US.MAJOR",
            "display_name": "Test Preset",
            "default_filters": [{"code": "priceAbove", "value": "5"}],
        }
        preset = ScannerPreset(**preset_dict)
        assert hasattr(preset, "default_filters")
        assert isinstance(preset.default_filters, list)

    def test_baseline_liquidity_filters_on_gated_presets(self):
        """
        IBKR's 'Finished: EMPTY response is received.' 500 quirk hits hardest
        on the 5 liquidity-gated scanners. Each one must ship with the baseline
        priceAbove=1 + volumeAbove=100000 floor so users don't see error banners
        on slow tapes.
        """
        # Note: TOP_PERC_GAIN+STK.US.MINOR was previously in this list (the
        # "US Small Cap" preset) but that preset was removed in favor of the
        # generic "Top % Gainers" + Location: US OTC combo. The 4 gated
        # scanners that remain still need the baseline floor.
        gated = {
            ("HIGH_VS_52W_HL", "STK.US.MAJOR"),
            ("LOW_VS_52W_HL", "STK.US.MAJOR"),
            ("HIGH_VS_13W_HL", "STK.US.MAJOR"),
            ("LOW_VS_13W_HL", "STK.US.MAJOR"),
        }
        for p in DEFAULT_PRESETS:
            key = (p["scan_type"], p["location"])
            if key in gated:
                assert p.get("default_filters") == _BASELINE_LIQUIDITY_FILTERS, (
                    f"Preset {p['display_name']} missing baseline liquidity filters"
                )

    def test_baseline_filter_codes_and_values(self):
        """Baseline floor is priceAbove=1 + volumeAbove=100000 (locked)."""
        codes = {f["code"]: f["value"] for f in _BASELINE_LIQUIDITY_FILTERS}
        assert codes == {"priceAbove": "1", "volumeAbove": "100000"}

    def test_premarket_presets_carry_subtitle(self):
        """Pre-market scanners must surface a 'Pre-market only' subtitle so the
        UI can warn users why a scan returns 0 outside trading hours."""
        premarket_scan_types = {"TOP_OPEN_PERC_GAIN", "TOP_OPEN_PERC_LOSE"}
        seen = set()
        for p in DEFAULT_PRESETS:
            if p["scan_type"] in premarket_scan_types:
                seen.add(p["scan_type"])
                assert p.get("subtitle") == "Pre-market only", (
                    f"Pre-market preset {p['display_name']} missing subtitle"
                )
        assert seen == premarket_scan_types

    def test_non_gated_presets_have_no_default_filters(self):
        """Most Active / Top Gainers etc. should NOT carry baseline filters —
        they get plenty of contracts naturally and the floor would skew them."""
        non_gated = {
            ("MOST_ACTIVE", "STK.US.MAJOR"),
            ("TOP_PERC_GAIN", "STK.US.MAJOR"),
            ("TOP_PERC_LOSE", "STK.US.MAJOR"),
            ("HOT_BY_VOLUME", "STK.US.MAJOR"),
        }
        for p in DEFAULT_PRESETS:
            key = (p["scan_type"], p["location"])
            if key in non_gated:
                assert not p.get("default_filters"), (
                    f"Preset {p['display_name']} should not carry baseline filters"
                )


# ── FILTER_CATALOGUE + GET /screener/filter-catalogue ─────────


class TestFilterCatalogue:
    """Canonical IBKR filter catalogue lives in constants/ibkr_filters.py."""

    def test_catalogue_is_non_empty(self):
        """FILTER_CATALOGUE must contain entries across every category."""
        from constants.ibkr_filters import FILTER_CATALOGUE

        assert len(FILTER_CATALOGUE) > 0
        categories = {f["category"] for f in FILTER_CATALOGUE}
        assert categories == {
            "fundamental",
            "technical",
            "analyst",
            "short_ownership",
        }

    def test_every_code_is_unique(self):
        """Duplicate codes would break the AI dedupe and UI filter-bar keys."""
        from constants.ibkr_filters import FILTER_CATALOGUE

        codes = [f["code"] for f in FILTER_CATALOGUE]
        assert len(codes) == len(set(codes)), (
            "Duplicate filter codes present"
        )

    def test_popular_chips_match_d5_spec(self):
        """The 5 always-visible quick-pick chips are locked by the D5 spec."""
        from constants.ibkr_filters import FILTER_CATALOGUE

        popular = {f["code"] for f in FILTER_CATALOGUE if f["popular"]}
        assert popular == {
            "marketCapAbove1e6",
            "priceAbove",
            "volumeAbove",
            "changePercAbove",
            "minPeRatio",
        }

    @pytest.mark.asyncio
    async def test_endpoint_returns_catalogue_with_description(self):
        """
        GET /screener/filter-catalogue must return one entry per FILTER_CATALOGUE
        code and carry the `description` field (shown as a UI tooltip AND sent
        to Ollama — single field, two surfaces).
        """
        from constants.ibkr_filters import FILTER_CATALOGUE
        from routers.screener import filter_catalogue

        result = await filter_catalogue()
        # One entry per code, same order as FILTER_CATALOGUE
        assert len(result) == len(FILTER_CATALOGUE)
        # The old Ollama-only `notes` field is gone — renamed to `description`.
        # `description` IS exposed (same string the AI prompt sees).
        for entry in result:
            assert not hasattr(entry, "notes")
            assert hasattr(entry, "description")
            # Required keys are present and populated
            assert entry.code
            assert entry.label
            assert entry.direction in ("above", "below")
            assert entry.category in (
                "fundamental",
                "technical",
                "analyst",
                "short_ownership",
            )
        # At least one entry in our catalogue has a populated description —
        # lock that contract so a future empty catalogue doesn't slip through.
        assert any(entry.description for entry in result)


# ── Regression: IBKR scanner_run always sends filter array ────
# Bug: omitting the "filter" key caused IBKR to return 400
# "filter must be an array" even for presets with no filters.
# Fix: ibkr.scanner_run now always sets body["filter"] = filters or [].


def _make_ibkr_svc() -> IBKRService:
    """Return a bare IBKRService with _request and ensure_accounts mocked."""
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = MagicMock()
    svc.state.accounts_fetched = True  # skip ensure_accounts
    svc.http = AsyncMock()
    svc._tickle_task = None
    svc._ws_task = None
    return svc


class TestScannerRunFilterAlwaysArray:
    """Regression tests for the 400 'filter must be an array' IBKR bug."""

    @pytest.mark.asyncio
    async def test_no_filters_sends_empty_array(self):
        """scanner_run with filters=None must still send filter: [] in body."""
        svc = _make_ibkr_svc()
        captured_body: dict = {}

        async def fake_request(method, path, **kwargs):
            captured_body.update(kwargs.get("json", {}))
            return {"contracts": []}

        svc._request = fake_request
        svc.ensure_accounts = AsyncMock()

        await svc.scanner_run(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=None,
        )

        assert "filter" in captured_body, (
            "IBKR body must always contain 'filter' key — omitting it causes 400"
        )
        assert captured_body["filter"] == [], (
            "filter must be [] when no filters provided, not None or missing"
        )

    @pytest.mark.asyncio
    async def test_with_filters_sends_filter_array(self):
        """scanner_run with filters provided sends them verbatim."""
        svc = _make_ibkr_svc()
        captured_body: dict = {}

        async def fake_request(method, path, **kwargs):
            captured_body.update(kwargs.get("json", {}))
            return {"contracts": []}

        svc._request = fake_request
        svc.ensure_accounts = AsyncMock()

        filters = [{"code": "priceAbove", "value": 5}]
        await svc.scanner_run(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=filters,
        )

        assert captured_body["filter"] == filters

    @pytest.mark.asyncio
    async def test_empty_list_filters_sends_empty_array(self):
        """scanner_run with filters=[] must send filter: [] (not omit key)."""
        svc = _make_ibkr_svc()
        captured_body: dict = {}

        async def fake_request(method, path, **kwargs):
            captured_body.update(kwargs.get("json", {}))
            return {"contracts": []}

        svc._request = fake_request
        svc.ensure_accounts = AsyncMock()

        await svc.scanner_run(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
        )

        assert "filter" in captured_body
        assert captured_body["filter"] == []


# ── Regression: scanner_run response parser ──────────────────
# Bug: parser looked for capital-C {"Contracts": {"Contract": [...]}}
# (the HMDS format), but /iserver/scanner/run returns
# {"contracts": [...], "scan_data_column_name": "..."} — a flat
# array under lowercase "contracts". Result: 0 contracts parsed
# → ScannerUnavailableError → 422 on every scan.


class TestScannerRunResponseParsing:
    """Regression tests for parsing the /iserver/scanner/run response shape."""

    @pytest.mark.asyncio
    async def test_parses_lowercase_contracts_flat_array(self):
        """Real /iserver/scanner/run shape: {"contracts": [...]}."""
        svc = _make_ibkr_svc()
        svc.ensure_accounts = AsyncMock()

        fake_response = {
            "contracts": [
                {"server_id": "0", "symbol": "AMD", "conid": 4391},
                {"server_id": "1", "symbol": "NVDA", "conid": 4815},
            ],
            "scan_data_column_name": "Trades",
        }

        async def fake_request(method, path, **kwargs):
            return fake_response

        svc._request = fake_request

        results = await svc.scanner_run(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
        )

        assert len(results) == 2
        assert results[0]["symbol"] == "AMD"
        assert results[1]["conid"] == 4815

    @pytest.mark.asyncio
    async def test_parses_hmds_capital_nested_shape(self):
        """HMDS fallback shape: {"Contracts": {"Contract": [...]}}."""
        svc = _make_ibkr_svc()
        svc.ensure_accounts = AsyncMock()

        fake_response = {
            "Contracts": {
                "Contract": [
                    {"contractID": "431424315", "inScanTime": "20231214"},
                ],
            },
            "total": "1",
        }

        async def fake_request(method, path, **kwargs):
            return fake_response

        svc._request = fake_request

        results = await svc.scanner_run(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
        )

        assert len(results) == 1
        assert results[0]["contractID"] == "431424315"

    @pytest.mark.asyncio
    async def test_empty_contracts_array_returns_empty_list(self):
        """Empty array under 'contracts' key → empty list (not an error)."""
        svc = _make_ibkr_svc()
        svc.ensure_accounts = AsyncMock()

        async def fake_request(method, path, **kwargs):
            return {"contracts": [], "scan_data_column_name": "Trades"}

        svc._request = fake_request

        results = await svc.scanner_run(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
        )

        assert results == []

    @pytest.mark.asyncio
    async def test_ibkr_500_empty_response_is_caught(self):
        """
        IBKR returns HTTP 500 with body
        {"error":"Finished: EMPTY response is received."}
        for time-of-day-gated scanners (52W highs on a slow tape, pre-market
        scanners outside hours). scanner_run must catch this specific 500 and
        return [] instead of bubbling the error up.
        """
        svc = _make_ibkr_svc()
        svc.ensure_accounts = AsyncMock()

        async def fake_request(method, path, **kwargs):
            raise IBKRRequestError(
                500, detail='{"error":"Finished: EMPTY response is received."}',
            )

        svc._request = fake_request

        results = await svc.scanner_run(
            instrument="STK",
            scan_type="HIGH_VS_52W_HL",
            location="STK.US.MAJOR",
        )

        assert results == []

    @pytest.mark.asyncio
    async def test_ibkr_500_unrelated_body_still_raises(self):
        """A 500 with a different body (real failure) must still propagate."""
        svc = _make_ibkr_svc()
        svc.ensure_accounts = AsyncMock()

        async def fake_request(method, path, **kwargs):
            raise IBKRRequestError(500, detail="Internal server error")

        svc._request = fake_request

        with pytest.raises(IBKRRequestError):
            await svc.scanner_run(
                instrument="STK",
                scan_type="MOST_ACTIVE",
                location="STK.US.MAJOR",
            )

    @pytest.mark.asyncio
    async def test_ibkr_400_still_raises(self):
        """Non-500 errors (e.g. 400 bad filter) must still propagate."""
        svc = _make_ibkr_svc()
        svc.ensure_accounts = AsyncMock()

        async def fake_request(method, path, **kwargs):
            raise IBKRRequestError(400, detail="bad filter code")

        svc._request = fake_request

        with pytest.raises(IBKRRequestError):
            await svc.scanner_run(
                instrument="STK",
                scan_type="MOST_ACTIVE",
                location="STK.US.MAJOR",
            )


# ── Phase C: required_fields param on snapshot() ─────────────
# snapshot() now accepts required_fields to decouple which fields are
# *requested* from IBKR from which must be present before returning.
# This lets market cap (7289) be best-effort while core fields gate the poll.


class TestSnapshotRequiredFields:
    """Tests for the required_fields parameter added to IBKRService.snapshot()."""

    @pytest.mark.asyncio
    async def test_required_fields_subset_gates_poll(self):
        """
        When required_fields is a subset of fields, polling stops as soon as
        the required subset is present — even if other fields (e.g. 7289) are missing.
        """
        svc = _make_ibkr_svc()
        svc.ensure_accounts = AsyncMock()

        # Response has core fields but NOT 7289 (market cap)
        partial_response = [
            {
                "conid": 265598,
                "31": "185.50",   # last price
                "55": "AAPL",     # symbol
                "83": "1.23",     # change %
                "7762": "52000000",  # volume
                # 7289 intentionally absent
            }
        ]

        call_count = 0

        async def fake_request(method, path, **kwargs):
            nonlocal call_count
            call_count += 1
            return partial_response

        svc._request = fake_request

        result = await svc.snapshot(
            conids=[265598],
            fields="31,55,83,7762,7289",
            timeout=5.0,
            required_fields=["31", "55", "83", "7762"],  # 7289 not required
        )

        # Should return on first poll (required fields satisfied)
        assert call_count == 1
        assert result == partial_response

    @pytest.mark.asyncio
    async def test_no_required_fields_uses_all_requested(self):
        """
        When required_fields is None (default), ALL requested fields must be
        present — original behaviour preserved.
        """
        svc = _make_ibkr_svc()
        svc.ensure_accounts = AsyncMock()

        # First call: missing 7289; second call: all fields present
        full_response = [
            {
                "conid": 265598,
                "31": "185.50",
                "55": "AAPL",
                "83": "1.23",
                "7762": "52000000",
                "7289": "2900000",
            }
        ]
        partial_response = [{k: v for k, v in full_response[0].items() if k != "7289"}]

        responses = iter([partial_response, full_response])

        async def fake_request(method, path, **kwargs):
            return next(responses)

        svc._request = fake_request

        result = await svc.snapshot(
            conids=[265598],
            fields="31,55,83,7762,7289",
            timeout=5.0,
            poll_interval=0.0,  # instant re-poll for the test
            required_fields=None,  # all fields required
        )

        assert result == full_response

    @pytest.mark.asyncio
    async def test_required_fields_empty_list_returns_immediately(self):
        """
        If required_fields=[] (no fields required), should return on first
        non-empty response without polling.
        """
        svc = _make_ibkr_svc()
        svc.ensure_accounts = AsyncMock()

        response = [{"conid": 265598}]
        call_count = 0

        async def fake_request(method, path, **kwargs):
            nonlocal call_count
            call_count += 1
            return response

        svc._request = fake_request

        result = await svc.snapshot(
            conids=[265598],
            fields="31",
            timeout=5.0,
            required_fields=[],
        )

        assert call_count == 1
        assert result == response


# ── Phase E: contract endpoint enrichment ────────────────────
# GET /screener/contract/{conid} now returns perf_*, w52_* fields
# computed from 1y daily history.


class TestContractEnrichment:
    """
    Tests for the enrichment logic in GET /screener/contract/{conid}.

    We test the enrichment helper functions directly rather than via the FastAPI
    router to avoid the pandas_ta import chain triggered by deps.py.
    """

    def _make_bars(self, n: int, base_close: float = 100.0) -> list[dict]:
        """Generate synthetic daily bars (epoch ms timestamps, sequential days)."""
        import datetime
        bars = []
        start_ts = int(
            (datetime.datetime.now() - datetime.timedelta(days=n)).timestamp() * 1000
        )
        for i in range(n):
            ts = start_ts + i * 86_400_000  # 1 day in ms
            close = base_close * (1 + i * 0.001)  # slowly rising
            bars.append({
                "t": ts,
                "o": close - 0.5,
                "h": close + 1.0,
                "l": close - 1.0,
                "c": close,
                "v": 1_000_000,
            })
        return bars

    def _compute_enrichment(self, bars: list[dict]) -> dict:
        """
        Replicate the enrichment logic from routers/screener.py contract_info
        without importing the router (avoids deps → pandas_ta chain).
        """
        import datetime

        closes = [b.get("c") for b in bars if b.get("c") is not None]
        timestamps = [b.get("t") for b in bars if b.get("t") is not None]

        perf_5d = perf_1m = perf_3m = perf_ytd = None
        w52_pct_from_high = w52_pct_from_low = None
        w52_days_since_high = None

        if not closes or len(closes) < 2:
            return {}

        last_close = closes[-1]
        now_ts = datetime.datetime.now(tz=datetime.timezone.utc)

        def _perf(n_bars: int):
            if len(closes) > n_bars:
                base = closes[-(n_bars + 1)]
                if base and base != 0:
                    return round((last_close - base) / base * 100, 2)
            return None

        perf_5d = _perf(5)
        perf_1m = _perf(21)
        perf_3m = _perf(63)

        year_start = datetime.datetime(now_ts.year, 1, 1, tzinfo=datetime.timezone.utc)
        ytd_bars = [
            (t, c) for t, c in zip(timestamps, closes)
            if t is not None and datetime.datetime.fromtimestamp(
                t / 1000, tz=datetime.timezone.utc
            ) >= year_start
        ]
        if ytd_bars:
            ytd_base = ytd_bars[0][1]
            if ytd_base and ytd_base != 0:
                perf_ytd = round((last_close - ytd_base) / ytd_base * 100, 2)

        year_bars = bars[-252:]
        year_highs = [b.get("h") for b in year_bars if b.get("h") is not None]
        year_lows = [b.get("l") for b in year_bars if b.get("l") is not None]

        if year_highs:
            w52_high = max(year_highs)
            if w52_high and w52_high != 0:
                w52_pct_from_high = round((last_close - w52_high) / w52_high * 100, 2)

            year_closes = [(b.get("t"), b.get("c")) for b in year_bars if b.get("c") is not None]
            if year_closes:
                max_close = max(c for _, c in year_closes)
                high_bar_ts = next(
                    (t for t, c in reversed(year_closes) if c == max_close), None
                )
                if high_bar_ts is not None:
                    high_dt = datetime.datetime.fromtimestamp(
                        high_bar_ts / 1000, tz=datetime.timezone.utc
                    )
                    w52_days_since_high = (now_ts - high_dt).days

        if year_lows:
            w52_low = min(year_lows)
            if w52_low and w52_low != 0:
                w52_pct_from_low = round((last_close - w52_low) / w52_low * 100, 2)

        return {
            "perf_5d": perf_5d,
            "perf_1m": perf_1m,
            "perf_3m": perf_3m,
            "perf_ytd": perf_ytd,
            "w52_pct_from_high": w52_pct_from_high,
            "w52_pct_from_low": w52_pct_from_low,
            "w52_days_since_high": w52_days_since_high,
        }

    def test_perf_5d_computed_from_history(self):
        """perf_5d is % change from 5 bars ago to latest close."""
        bars = self._make_bars(30, base_close=100.0)
        expected_base = bars[-6]["c"]
        expected_last = bars[-1]["c"]
        expected = round((expected_last - expected_base) / expected_base * 100, 2)

        result = self._compute_enrichment(bars)

        assert result["perf_5d"] is not None
        assert abs(result["perf_5d"] - expected) < 0.01

    def test_perf_ytd_uses_first_bar_in_current_year(self):
        """perf_ytd is % change from the first bar of this calendar year."""
        import datetime
        bars = self._make_bars(252, base_close=50.0)
        # Force the first bar's timestamp into this calendar year
        now = datetime.datetime.now(tz=datetime.timezone.utc)
        year_start_ts = int(
            datetime.datetime(now.year, 1, 2, tzinfo=datetime.timezone.utc).timestamp() * 1000
        )
        bars[0]["t"] = year_start_ts

        result = self._compute_enrichment(bars)
        assert result["perf_ytd"] is not None

    def test_w52_pct_from_high_is_negative_when_below_high(self):
        """w52_pct_from_high < 0 when current price is below 52W high."""
        bars = self._make_bars(252, base_close=100.0)
        # Inject a high spike earlier in the year; last close stays ~100
        bars[50]["h"] = 250.0
        result = self._compute_enrichment(bars)
        assert result["w52_pct_from_high"] is not None
        assert result["w52_pct_from_high"] < 0

    def test_w52_pct_from_low_is_positive_when_above_low(self):
        """w52_pct_from_low > 0 when current price is above 52W low."""
        bars = self._make_bars(252, base_close=100.0)
        # Inject a very low bar earlier
        bars[10]["l"] = 10.0
        result = self._compute_enrichment(bars)
        assert result["w52_pct_from_low"] is not None
        assert result["w52_pct_from_low"] > 0

    def test_w52_days_since_high_is_non_negative(self):
        """days_since_high is always ≥ 0."""
        bars = self._make_bars(252, base_close=100.0)
        result = self._compute_enrichment(bars)
        assert result["w52_days_since_high"] is not None
        assert result["w52_days_since_high"] >= 0

    def test_insufficient_bars_returns_none_perfs(self):
        """With < 6 bars we cannot compute perf_5d — should be None."""
        bars = self._make_bars(3, base_close=100.0)
        result = self._compute_enrichment(bars)
        assert result.get("perf_5d") is None

    def test_empty_bars_returns_empty(self):
        """Empty bar list → empty enrichment dict (no KeyError)."""
        result = self._compute_enrichment([])
        assert result == {}


# ── Path B: live-params-joined presets, locations, scan_data ────


class TestListPresets:
    """ScreenerService.list_presets() joins CURATED_SCAN_TYPES with live
    IBKR scan_type_list to enrich each preset with the real `instruments`
    array (which markets/instruments support the scan)."""

    @pytest.mark.asyncio
    async def test_returns_one_preset_per_curated_entry_plus_etf(self):
        ibkr = make_ibkr_mock()
        # Live params returns instruments for every curated scan type
        ibkr.scanner_params = AsyncMock(return_value={
            "scan_type_list": [
                {"code": "TOP_PERC_GAIN", "instruments": ["STK", "STOCK.HK", "STOCK.EU"]},
                {"code": "TOP_PERC_LOSE", "instruments": ["STK", "STOCK.HK"]},
                {"code": "MOST_ACTIVE", "instruments": ["STK", "ETF.EQ.US", "STOCK.EU"]},
                {"code": "HOT_BY_VOLUME", "instruments": ["STK"]},
                {"code": "MOST_ACTIVE_USD", "instruments": ["STK"]},
                {"code": "TOP_TRADE_COUNT", "instruments": ["STK"]},
                {"code": "HIGH_STVOLUME_5MIN", "instruments": ["STK"]},
                {"code": "HIGH_VS_52W_HL", "instruments": ["STK"]},
                {"code": "LOW_VS_52W_HL", "instruments": ["STK"]},
                {"code": "HIGH_VS_13W_HL", "instruments": ["STK"]},
                {"code": "LOW_VS_13W_HL", "instruments": ["STK"]},
                {"code": "TOP_OPEN_PERC_GAIN", "instruments": ["STK"]},
                {"code": "TOP_OPEN_PERC_LOSE", "instruments": ["STK"]},
                {"code": "TOP_AFTER_HOURS_PERC_GAIN", "instruments": ["STK"]},
                {"code": "TOP_AFTER_HOURS_PERC_LOSE", "instruments": ["STK"]},
                {"code": "HIGH_OPEN_GAP", "instruments": ["STK"]},
                {"code": "LOW_OPEN_GAP", "instruments": ["STK"]},
                {"code": "HIGH_OPT_IMP_VOLAT", "instruments": ["STK"]},
                {"code": "LOW_OPT_IMP_VOLAT", "instruments": ["STK"]},
                {"code": "TOP_OPT_IMP_VOLAT_GAIN", "instruments": ["STK"]},
                {"code": "TOP_OPT_IMP_VOLAT_LOSE", "instruments": ["STK"]},
                {"code": "OPT_VOLUME_MOST_ACTIVE", "instruments": ["STK"]},
                {"code": "HIGH_DIVIDEND_YIELD_IB", "instruments": ["STK"]},
                {"code": "HIGH_GROWTH_RATE", "instruments": ["STK"]},
                {"code": "HALTED", "instruments": ["STK"]},
                {"code": "FIRST_TRADE_DATE_ASC", "instruments": ["STK"]},
            ],
        })
        svc = ScreenerService(ibkr)
        presets = await svc.list_presets()
        # 26 curated + 1 ETF bundled
        assert len(presets) == 27

    @pytest.mark.asyncio
    async def test_each_preset_carries_instruments_from_live(self):
        ibkr = make_ibkr_mock()
        ibkr.scanner_params = AsyncMock(return_value={
            "scan_type_list": [
                {"code": "TOP_PERC_GAIN", "instruments": ["STK", "STOCK.HK", "STOCK.EU"]},
            ],
        })
        svc = ScreenerService(ibkr)
        presets = await svc.list_presets()
        gainers = next(p for p in presets if p.scan_type == "TOP_PERC_GAIN")
        assert gainers.instruments == ["STK", "STOCK.HK", "STOCK.EU"]
        # Group from CURATED_SCAN_TYPES, not from IBKR
        assert gainers.group == "movers"

    @pytest.mark.asyncio
    async def test_drops_curated_codes_missing_from_live(self, caplog):
        """If IBKR removes a scan type from their catalogue, we drop it from
        our preset list (and warn)."""
        import logging
        ibkr = make_ibkr_mock()
        # Only TOP_PERC_GAIN is in IBKR's response; the other 25 are missing
        ibkr.scanner_params = AsyncMock(return_value={
            "scan_type_list": [
                {"code": "TOP_PERC_GAIN", "instruments": ["STK"]},
            ],
        })
        svc = ScreenerService(ibkr)
        with caplog.at_level(logging.WARNING, logger="parallax.screener"):
            presets = await svc.list_presets()

        # Only TOP_PERC_GAIN survives + ETF (which keys on MOST_ACTIVE — not in
        # the mock above, so its instruments will be empty but it's still added)
        scan_types = [p.scan_type for p in presets]
        assert "TOP_PERC_GAIN" in scan_types
        # And we logged warnings for the 25 missing ones
        assert any("not in IBKR" in r.getMessage() for r in caplog.records)

    @pytest.mark.asyncio
    async def test_etf_preset_uses_bundled_instrument_and_location(self):
        ibkr = make_ibkr_mock()
        ibkr.scanner_params = AsyncMock(return_value={
            "scan_type_list": [
                {"code": "MOST_ACTIVE", "instruments": ["STK", "ETF.EQ.US"]},
            ],
        })
        svc = ScreenerService(ibkr)
        presets = await svc.list_presets()
        etf = next(p for p in presets if p.display_name == "Most Active — US ETFs")
        assert etf.instrument == "ETF.EQ.US"
        assert etf.location == "ETF.EQ.US.MAJOR"
        assert etf.group == "etfs"

    @pytest.mark.asyncio
    async def test_baseline_gated_presets_carry_default_filters(self):
        ibkr = make_ibkr_mock()
        ibkr.scanner_params = AsyncMock(return_value={
            "scan_type_list": [
                {"code": "HIGH_VS_52W_HL", "instruments": ["STK"]},
            ],
        })
        svc = ScreenerService(ibkr)
        presets = await svc.list_presets()
        gated = next(p for p in presets if p.scan_type == "HIGH_VS_52W_HL")
        assert len(gated.default_filters) == 2
        codes = {f.code for f in gated.default_filters}
        assert codes == {"priceAbove", "volumeAbove"}


class TestListLocations:
    """list_locations() returns the curated instrument+location pairs."""

    def test_returns_curated_list(self):
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)
        locations = svc.list_locations()
        assert len(locations) >= 10
        # First entry is the default — US Listed/NASDAQ
        assert locations[0].location == "STK.US.MAJOR"
        assert locations[0].instrument == "STK"

    def test_each_location_pairs_instrument_correctly(self):
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)
        locations = svc.list_locations()
        # Verify a sample of known instrument/location pairs from the curated list.
        # These map to IBKR's location_tree top-level instruments.
        pair_index = {l.location: l.instrument for l in locations}
        assert pair_index["STK.US.MAJOR"] == "STK"
        assert pair_index["STK.HK.TSE_JPN"] == "STOCK.HK"  # Japan under HK tree
        assert pair_index["STK.EU.LSE"] == "STOCK.EU"      # UK under EU tree
        assert pair_index["STK.NA.CANADA"] == "STOCK.NA"


class TestNoQuoteScanTypes:
    """For FIRST_TRADE_DATE_ASC (and any future no-quote scan types), the
    snapshot batch is skipped entirely AND the ticker-only filter is bypassed
    so all rows survive even without price/volume."""

    @pytest.mark.asyncio
    async def test_first_trade_date_skips_snapshot_call(self):
        # Provide raw scanner output with scan_data populated but no quotes
        scan_results = [
            {
                "conid": 999001,
                "symbol": "NEWIPO",
                "company_name": "Newly Public Inc.",
                "scan_data": "2026-05-12",
                "scan_data_column_name": "First Trade Date",
            },
        ]
        ibkr = make_ibkr_mock(scan_results=scan_results)
        # Spy on snapshot to confirm it's NOT called
        ibkr.snapshot = AsyncMock(return_value=[])
        svc = ScreenerService(ibkr)

        resp = await svc.scan(
            instrument="STK",
            scan_type="FIRST_TRADE_DATE_ASC",
            location="STK.US.MAJOR",
            filters=[],
        )

        ibkr.snapshot.assert_not_called()
        assert len(resp.results) == 1
        # Row survives without price/volume because the ticker-only filter
        # is bypassed for no-quote scan types
        assert resp.results[0].last_price is None
        assert resp.results[0].volume is None
        # scan_data flows through for the price-column fallback
        assert resp.results[0].scan_data == "2026-05-12"
        assert resp.results[0].scan_data_label == "First Trade Date"

    @pytest.mark.asyncio
    async def test_regular_scan_still_calls_snapshot(self):
        ibkr = make_ibkr_mock()
        svc = ScreenerService(ibkr)
        await svc.scan(
            instrument="STK",
            scan_type="TOP_PERC_GAIN",
            location="STK.US.MAJOR",
            filters=[],
        )
        ibkr.snapshot.assert_called()


class TestScanDataPropagation:
    """scan_data + scan_data_label must flow from IBKR's response through
    _parse_scanner_results → _build_row → ScreenerResultRow on regular scans
    too (the frontend uses it as a generic 'ranking metric' fallback)."""

    @pytest.mark.asyncio
    async def test_scan_data_captured_on_regular_scan(self):
        # Regular scan returns rows with price (so they survive the filter)
        # AND scan_data populated
        scan_results = [
            {
                "conid": 100,
                "symbol": "AAA",
                "company_name": "A Corp",
                "scan_data": "+12.5",
                "scan_data_column_name": "% Change",
            },
        ]
        ibkr = make_ibkr_mock(scan_results=scan_results)
        svc = ScreenerService(ibkr)
        resp = await svc.scan(
            instrument="STK",
            scan_type="TOP_PERC_GAIN",
            location="STK.US.MAJOR",
            filters=[],
        )
        assert resp.results[0].scan_data == "+12.5"
        assert resp.results[0].scan_data_label == "% Change"

    @pytest.mark.asyncio
    async def test_missing_scan_data_yields_none(self):
        # IBKR sometimes omits scan_data for older scan types
        scan_results = [
            {"conid": 100, "symbol": "AAA"},
        ]
        ibkr = make_ibkr_mock(scan_results=scan_results)
        svc = ScreenerService(ibkr)
        resp = await svc.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
        )
        assert resp.results[0].scan_data is None
        assert resp.results[0].scan_data_label is None


class TestScannerParamsCache:
    """list_presets() caches /iserver/scanner/params for 1 hour."""

    @pytest.mark.asyncio
    async def test_two_calls_hit_ibkr_only_once(self):
        ibkr = make_ibkr_mock()
        ibkr.scanner_params = AsyncMock(return_value={
            "scan_type_list": [{"code": "TOP_PERC_GAIN", "instruments": ["STK"]}],
        })
        svc = ScreenerService(ibkr)
        await svc.list_presets()
        await svc.list_presets()
        assert ibkr.scanner_params.call_count == 1

    @pytest.mark.asyncio
    async def test_falls_back_to_empty_dict_on_first_failure(self):
        ibkr = make_ibkr_mock()
        ibkr.scanner_params = AsyncMock(side_effect=IBKRError("boom"))
        svc = ScreenerService(ibkr)
        # Should not raise — fallback to empty cache, so curated entries get
        # dropped (no live data to join against)
        presets = await svc.list_presets()
        # Only the bundled ETF preset survives (it has hardcoded fields and
        # scan_type_index lookup misses are tolerated)
        assert all(p.instruments == [] for p in presets)
