"""
Tests for the screener service + IBKR scanner_run — critical-promise subset.

Covers:
  - External failures stop safely: snapshot errors don't crash scan(); IBKR 500
    "EMPTY response" is caught and returns []; unrelated 500s and 400s still raise.
  - Main user workflows: scanner_run always sends filter array (prevents 400 regression),
    response parsing handles both real IBKR shapes.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.ibkr import IBKRService

from models import ScanResponse
from exceptions import IBKRError, IBKRRequestError
from services.screener import ScreenerService


# ── Fixtures ─────────────────────────────────────────────────


def _synthesize_snapshot_from_scan(scan_results):
    """Build a minimal full-field snapshot response from scanner output."""
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
    """Build a mock IBKRService with preset return values."""
    ibkr = MagicMock()

    if scan_results is None:
        scan_results = [
            {"conid": 265598, "symbol": "AAPL", "sec_type": "STK"},
            {"conid": 272093, "symbol": "MSFT", "sec_type": "STK"},
        ]

    if snapshot_results is None:
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
    ibkr.contract_info = AsyncMock(
        return_value=contract_info if contract_info is not None
        else {"marketCap": "1500000"}
    )
    return ibkr


def _make_ibkr_svc() -> IBKRService:
    """Return a bare IBKRService with _request and ensure_accounts mocked."""
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = MagicMock()
    svc.state.accounts_fetched = True
    svc.http = AsyncMock()
    svc._tickle_task = None
    svc._ws_task = None
    return svc


# ── Regression: IBKR scanner_run always sends filter array ────


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
        for time-of-day-gated scanners. scanner_run must catch this specific
        500 and return [] instead of bubbling the error up.
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


# ── ScreenerService.scan error handling ──────────────────────


class TestScreenerServiceScan:

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
