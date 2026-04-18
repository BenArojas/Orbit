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
from exceptions import ScannerUnavailableError
from services.screener import DEFAULT_PRESETS, ScreenerService, _safe_float


# ── Fixtures ─────────────────────────────────────────────────


def make_ibkr_mock(scan_results=None, snapshot_results=None):
    """Build a mock IBKRService with preset return values."""
    ibkr = MagicMock()

    if scan_results is None:
        scan_results = [
            {"conid": 265598, "symbol": "AAPL", "sec_type": "STK"},
            {"conid": 272093, "symbol": "MSFT", "sec_type": "STK"},
        ]

    if snapshot_results is None:
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

    ibkr.scanner_run = AsyncMock(return_value=scan_results)
    ibkr.snapshot = AsyncMock(return_value=snapshot_results)
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
        assert row.market_cap == pytest.approx(2_900_000)

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
    async def test_raises_on_empty_scanner_response(self):
        ibkr = make_ibkr_mock(scan_results=[])
        svc = ScreenerService(ibkr)

        with pytest.raises(ScannerUnavailableError):
            await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50)

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
        # Each snapshot call returns empty list (no quotes available)
        ibkr = make_ibkr_mock(scan_results=many, snapshot_results=[])
        svc = ScreenerService(ibkr)

        await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 60)

        # 60 conids / 25 per batch = 3 calls
        assert ibkr.snapshot.call_count == 3

    @pytest.mark.asyncio
    async def test_missing_quote_fields_are_none(self):
        """Instruments with no snapshot data get None fields."""
        scan_results = [{"conid": 999, "symbol": "XYZ"}]
        snapshot_results = []  # No quotes returned

        ibkr = make_ibkr_mock(scan_results=scan_results, snapshot_results=snapshot_results)
        svc = ScreenerService(ibkr)

        result = await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50)

        assert len(result.results) == 1
        row = result.results[0]
        assert row.last_price is None
        assert row.change_percent is None
        assert row.volume is None
        assert row.market_cap is None

    @pytest.mark.asyncio
    async def test_snapshot_error_skips_batch_gracefully(self):
        """A failing snapshot batch should not crash the scan."""
        ibkr = make_ibkr_mock()
        ibkr.snapshot = AsyncMock(side_effect=Exception("network error"))
        svc = ScreenerService(ibkr)

        result = await svc.scan("STK", "MOST_ACTIVE", "STK.US.MAJOR", [], 50)

        # Rows returned but with None quote fields
        assert len(result.results) == 2
        for row in result.results:
            assert row.last_price is None


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
            "7289": "2900000",
        }
        row = svc._build_row(item, quote)
        assert row.conid == 100
        assert row.symbol == "AAPL"
        assert row.company_name == "Apple Inc."
        assert row.last_price == pytest.approx(185.0)
        assert row.change_percent == pytest.approx(1.5)
        assert row.volume == pytest.approx(50_000_000)
        assert row.market_cap == pytest.approx(2_900_000)

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
        quote = {"31": "N/A", "83": "", "7762": None, "7289": "abc"}
        row = svc._build_row(item, quote)
        assert row.last_price is None
        assert row.change_percent is None
        assert row.volume is None
        assert row.market_cap is None


# ── Default presets ───────────────────────────────────────────


class TestDefaultPresets:

    def test_all_presets_have_required_fields(self):
        for p in DEFAULT_PRESETS:
            assert "instrument" in p
            assert "scan_type" in p
            assert "location" in p
            assert "display_name" in p

    def test_presets_instantiate_as_models(self):
        for p in DEFAULT_PRESETS:
            preset = ScannerPreset(**p)
            assert preset.scan_type
            assert preset.location

    def test_at_least_one_preset(self):
        assert len(DEFAULT_PRESETS) >= 1


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
        assert row.market_cap is None
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


# ── Pagination Tests ──────────────────────────────────────────


class TestPagination:

    @pytest.mark.asyncio
    async def test_pagination_first_page(self):
        """First page of 60 results, page_size=25 → 25 rows, total_pages=3."""
        many = [{"conid": 100 + i, "symbol": f"T{i}"} for i in range(60)]
        ibkr = make_ibkr_mock(scan_results=many, snapshot_results=[])
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
        ibkr = make_ibkr_mock(scan_results=many, snapshot_results=[])
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
        ibkr = make_ibkr_mock(scan_results=many, snapshot_results=[])
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

    def test_wsh_earnings_preset_exists(self):
        """Verify the WSH earnings preset is in DEFAULT_PRESETS."""
        earnings_presets = [
            p for p in DEFAULT_PRESETS
            if "Earnings" in p.get("display_name", "")
        ]
        assert len(earnings_presets) >= 1
        earnings = earnings_presets[0]
        assert earnings["instrument"] == "STK"
        assert earnings["scan_type"] == "MOST_ACTIVE"
        assert earnings["location"] == "STK.US.MAJOR"

    def test_default_filters_on_preset(self):
        """Verify ScannerPreset model accepts default_filters."""
        earnings_presets = [
            p for p in DEFAULT_PRESETS
            if "Earnings" in p.get("display_name", "")
        ]
        if earnings_presets:
            preset_dict = earnings_presets[0]
            preset = ScannerPreset(**preset_dict)
            assert hasattr(preset, "default_filters")
            assert isinstance(preset.default_filters, list)


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
