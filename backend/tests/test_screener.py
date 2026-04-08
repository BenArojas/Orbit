"""
Tests for the screener service + router (Phase 5 — tasks 5.3, 5.4, 5.6).

Tests mock the IBKR service and IndicatorService to avoid live API calls
and pandas-ta dependency.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── Ensure backend root is on sys.path ─────────────────────
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from models import (
    CandleData,
    IndicatorResult,
    IndicatorValue,
    ScannerPreset,
    ScanRequest,
    ScanResponse,
    ScreenerFilterItem,
    ScreenerResultRow,
    ScannerParamsResponse,
)
from exceptions import ScannerFilterError, ScannerUnavailableError


# ── Helpers ─────────────────────────────────────────────────


def make_candle_series(bars: int = 60, base: float = 100.0) -> list[dict]:
    """Create synthetic IBKR-format candle data (ms timestamps)."""
    out = []
    t0 = 1_700_000_000_000
    price = base
    for i in range(bars):
        delta = 0.5 * (1 if i % 3 != 0 else -1)
        price += delta
        out.append({
            "t": t0 + i * 86_400_000,
            "o": round(price - 0.2, 2),
            "h": round(price + 1.0, 2),
            "l": round(price - 1.0, 2),
            "c": round(price, 2),
            "v": 1_000_000 + i * 10_000,
        })
    return out


def make_scanner_results(count: int = 5) -> list[dict]:
    return [
        {
            "conid": 1000 + i,
            "symbol": f"TST{i}",
            "company_name": f"Test Corp {i}",
            "sec_type": "STK",
        }
        for i in range(count)
    ]


def make_snapshot_response(conids: list[int]) -> list[dict]:
    return [
        {
            "conid": cid,
            "31": str(100.0 + cid % 10),
            "55": f"TST{cid - 1000}",
            "83": str(1.5 + cid % 5),
            "7762": str(1_000_000 + cid),
            "7051": f"Test Corp {cid - 1000}",
        }
        for cid in conids
    ]


def make_mock_indicator_results() -> tuple[list[IndicatorResult], None]:
    """Return fake indicator compute results."""
    return (
        [
            IndicatorResult(
                name="rsi",
                type="oscillator",
                values=[
                    IndicatorValue(time=1, value=55.0),
                    IndicatorValue(time=2, value=58.0),
                ],
            ),
            IndicatorResult(
                name="ema_50",
                type="overlay",
                values=[
                    IndicatorValue(time=1, value=102.0),
                    IndicatorValue(time=2, value=103.0),
                ],
            ),
        ],
        None,  # fibonacci
    )


def make_mock_ibkr() -> MagicMock:
    ibkr = MagicMock()
    ibkr.ensure_accounts = AsyncMock()
    ibkr.scanner_run = AsyncMock(return_value=make_scanner_results(5))

    async def mock_snapshot(conids, **kwargs):
        return make_snapshot_response(conids)
    ibkr.snapshot = AsyncMock(side_effect=mock_snapshot)

    ibkr.history = AsyncMock(return_value={"data": make_candle_series(60)})

    ibkr.scanner_params = AsyncMock(return_value={
        "instrument_list": [{"type": "STK", "display_name": "Stocks"}],
        "location_tree": [{"type": "STK.US.MAJOR", "display_name": "US Major"}],
        "scan_type_list": [{"type": "MOST_ACTIVE", "display_name": "Most Active"}],
        "filter_list": [{"code": "priceAbove", "display_name": "Price Above"}],
    })

    return ibkr


# ── Import ScreenerService with mocked IndicatorService ─────

# We need to mock IndicatorService before importing ScreenerService
# because IndicatorService imports pandas_ta at module level.

_mock_indicator_service = MagicMock()
_mock_indicator_service.compute = MagicMock(return_value=make_mock_indicator_results())

with patch.dict(sys.modules, {"pandas_ta": MagicMock(), "pandas": MagicMock()}):
    from services.screener import (
        DEFAULT_PRESETS,
        ScreenerService,
        _safe_float,
    )


# ═══════════════════════════════════════════════════════════════
#  ScreenerService unit tests
# ═══════════════════════════════════════════════════════════════


class TestScreenerService:

    @pytest.fixture
    def ibkr(self):
        return make_mock_ibkr()

    @pytest.fixture
    def service(self, ibkr):
        svc = ScreenerService(ibkr)
        # Replace the real IndicatorService with our mock
        svc._indicators = _mock_indicator_service
        return svc

    # ── Basic scan flow ─────────────────────────────────────

    @pytest.mark.asyncio
    async def test_scan_returns_results(self, service, ibkr):
        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            indicators=["rsi"],
            max_results=50,
        )

        assert isinstance(result, ScanResponse)
        assert result.total_scanned == 5
        assert result.total_matched == 5
        assert result.scan_type == "MOST_ACTIVE"
        assert result.location == "STK.US.MAJOR"
        assert len(result.results) == 5

    @pytest.mark.asyncio
    async def test_scan_result_has_indicator_values(self, service):
        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            indicators=["rsi", "ema_50"],
            max_results=50,
        )

        for row in result.results:
            assert isinstance(row, ScreenerResultRow)
            assert row.conid > 0
            assert "rsi" in row.indicator_values
            assert row.indicator_values["rsi"] == 58.0  # Latest from mock

    @pytest.mark.asyncio
    async def test_scan_respects_max_results(self, service, ibkr):
        ibkr.scanner_run.return_value = make_scanner_results(100)

        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            indicators=["rsi"],
            max_results=10,
        )

        assert result.total_scanned == 10

    @pytest.mark.asyncio
    async def test_scan_empty_scanner_raises(self, service, ibkr):
        ibkr.scanner_run.return_value = []

        with pytest.raises(ScannerUnavailableError):
            await service.scan(
                instrument="STK",
                scan_type="MOST_ACTIVE",
                location="STK.US.MAJOR",
                filters=[],
                indicators=["rsi"],
            )

    # ── Filter logic ────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_filter_gt_excludes(self, service):
        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[
                ScreenerFilterItem(indicator="price", op="gt", value=999.0),
            ],
            indicators=["rsi"],
        )
        assert result.total_matched == 0

    @pytest.mark.asyncio
    async def test_filter_lt_includes(self, service):
        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[
                ScreenerFilterItem(indicator="price", op="lt", value=999.0),
            ],
            indicators=["rsi"],
        )
        assert result.total_matched == 5

    @pytest.mark.asyncio
    async def test_filter_between(self, service):
        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[
                ScreenerFilterItem(indicator="price", op="between", value=90.0, value2=200.0),
            ],
            indicators=["rsi"],
        )
        assert result.total_matched == 5

    @pytest.mark.asyncio
    async def test_filter_between_requires_value2(self, service):
        with pytest.raises(ScannerFilterError):
            await service.scan(
                instrument="STK",
                scan_type="MOST_ACTIVE",
                location="STK.US.MAJOR",
                filters=[
                    ScreenerFilterItem(indicator="price", op="between", value=50.0),
                ],
                indicators=["rsi"],
            )

    @pytest.mark.asyncio
    async def test_multiple_filters_and_logic(self, service):
        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[
                ScreenerFilterItem(indicator="price", op="gt", value=50.0),
                ScreenerFilterItem(indicator="price", op="lt", value=200.0),
            ],
            indicators=["rsi"],
        )
        assert result.total_matched == 5

    @pytest.mark.asyncio
    async def test_filter_on_indicator_value(self, service):
        """RSI mock returns 58.0 — filter gt 50 should pass."""
        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[
                ScreenerFilterItem(indicator="rsi", op="gt", value=50.0),
            ],
            indicators=["rsi"],
        )
        assert result.total_matched == 5

    @pytest.mark.asyncio
    async def test_filter_on_indicator_excludes(self, service):
        """RSI mock returns 58.0 — filter gt 60 should exclude all."""
        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[
                ScreenerFilterItem(indicator="rsi", op="gt", value=60.0),
            ],
            indicators=["rsi"],
        )
        assert result.total_matched == 0

    # ── Edge cases ──────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_scan_handles_history_failure_gracefully(self, service, ibkr):
        call_count = 0

        async def failing_history(conid, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("IBKR timeout")
            return {"data": make_candle_series(60)}

        ibkr.history = AsyncMock(side_effect=failing_history)

        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            indicators=["rsi"],
        )
        # All 5 should still come back (failed one has empty indicators but valid quote data)
        assert len(result.results) == 5

    @pytest.mark.asyncio
    async def test_scan_with_no_indicators(self, service):
        result = await service.scan(
            instrument="STK",
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
            filters=[],
            indicators=[],
        )
        assert len(result.results) == 5
        for row in result.results:
            assert row.last_price is not None

    # ── Scanner result parsing ──────────────────────────────

    def test_parse_flat(self, service):
        raw = [{"conid": 123, "symbol": "ABC"}]
        parsed = service._parse_scanner_results(raw, 50)
        assert len(parsed) == 1
        assert parsed[0]["conid"] == 123
        assert parsed[0]["symbol"] == "ABC"

    def test_parse_nested(self, service):
        raw = [{"contract": {"conid": 456, "symbol": "DEF"}}]
        parsed = service._parse_scanner_results(raw, 50)
        assert len(parsed) == 1
        assert parsed[0]["conid"] == 456

    def test_parse_skips_missing_conid(self, service):
        raw = [{"symbol": "NOCONID"}, {"conid": 789, "symbol": "OK"}]
        parsed = service._parse_scanner_results(raw, 50)
        assert len(parsed) == 1
        assert parsed[0]["conid"] == 789

    def test_parse_caps_at_max(self, service):
        raw = make_scanner_results(20)
        parsed = service._parse_scanner_results(raw, 5)
        assert len(parsed) == 5

    # ── Value extraction ────────────────────────────────────

    def test_extract_latest_rsi(self, service):
        results = [
            IndicatorResult(
                name="rsi", type="oscillator",
                values=[IndicatorValue(time=1, value=30.0), IndicatorValue(time=2, value=55.0)],
            )
        ]
        latest = service._extract_latest_values(results)
        assert latest["rsi"] == 55.0

    def test_extract_latest_macd(self, service):
        results = [
            IndicatorResult(
                name="macd", type="oscillator",
                values=[IndicatorValue(time=1, value=1.5, signal=1.2, histogram=0.3)],
            )
        ]
        latest = service._extract_latest_values(results)
        assert latest["macd"] == 1.5
        assert latest["macd_signal"] == 1.2
        assert latest["macd_histogram"] == 0.3

    def test_extract_latest_bbands(self, service):
        results = [
            IndicatorResult(
                name="bbands", type="overlay",
                values=[IndicatorValue(time=1, value=100.0, upper=110.0, lower=90.0)],
            )
        ]
        latest = service._extract_latest_values(results)
        assert latest["bbands"] == 100.0
        assert latest["bbands_upper"] == 110.0
        assert latest["bbands_lower"] == 90.0

    def test_extract_latest_empty(self, service):
        results = [IndicatorResult(name="rsi", type="oscillator", values=[])]
        latest = service._extract_latest_values(results)
        assert latest["rsi"] is None

    # ── Filter evaluation ───────────────────────────────────

    def test_eval_op_gt(self, service):
        assert service._eval_op(50.0, "gt", 30.0, None) is True
        assert service._eval_op(20.0, "gt", 30.0, None) is False

    def test_eval_op_lt(self, service):
        assert service._eval_op(20.0, "lt", 30.0, None) is True
        assert service._eval_op(50.0, "lt", 30.0, None) is False

    def test_eval_op_between(self, service):
        assert service._eval_op(50.0, "between", 30.0, 70.0) is True
        assert service._eval_op(80.0, "between", 30.0, 70.0) is False
        assert service._eval_op(50.0, "between", 70.0, 30.0) is True  # reversed

    def test_eval_op_cross_above(self, service):
        assert service._eval_op(50.0, "cross_above", 30.0, None) is True

    def test_eval_op_unknown(self, service):
        with pytest.raises(ScannerFilterError):
            service._eval_op(50.0, "invalid_op", 30.0, None)

    def test_eval_op_nan(self, service):
        assert service._eval_op(float("nan"), "gt", 30.0, None) is False

    # ── Resolve value ───────────────────────────────────────

    def test_resolve_price(self, service):
        row = ScreenerResultRow(conid=1, last_price=150.0)
        assert service._resolve_value(row, "price") == 150.0

    def test_resolve_volume(self, service):
        row = ScreenerResultRow(conid=1, volume=5_000_000.0)
        assert service._resolve_value(row, "volume") == 5_000_000.0

    def test_resolve_change_percent(self, service):
        row = ScreenerResultRow(conid=1, change_percent=2.5)
        assert service._resolve_value(row, "change_percent") == 2.5

    def test_resolve_indicator(self, service):
        row = ScreenerResultRow(conid=1, indicator_values={"rsi": 45.0})
        assert service._resolve_value(row, "rsi") == 45.0

    def test_resolve_missing(self, service):
        row = ScreenerResultRow(conid=1)
        assert service._resolve_value(row, "nonexistent") is None


# ═══════════════════════════════════════════════════════════════
#  Default presets
# ═══════════════════════════════════════════════════════════════


class TestDefaultPresets:

    def test_not_empty(self):
        assert len(DEFAULT_PRESETS) > 0

    def test_have_required_keys(self):
        for p in DEFAULT_PRESETS:
            assert "instrument" in p
            assert "scan_type" in p
            assert "location" in p
            assert "display_name" in p

    def test_validate_as_models(self):
        for p in DEFAULT_PRESETS:
            preset = ScannerPreset(**p)
            assert preset.display_name


# ═══════════════════════════════════════════════════════════════
#  safe_float helper
# ═══════════════════════════════════════════════════════════════


class TestSafeFloat:

    def test_valid_float(self):
        assert _safe_float("42.5") == 42.5

    def test_none(self):
        assert _safe_float(None) is None

    def test_nan(self):
        assert _safe_float(float("nan")) is None

    def test_invalid_string(self):
        assert _safe_float("not_a_number") is None

    def test_int(self):
        assert _safe_float(100) == 100.0


# ═══════════════════════════════════════════════════════════════
#  Pydantic model validation
# ═══════════════════════════════════════════════════════════════


class TestScreenerModels:

    def test_scan_request_defaults(self):
        req = ScanRequest()
        assert req.instrument == "STK"
        assert req.scan_type == "MOST_ACTIVE"
        assert req.location == "STK.US.MAJOR"
        assert req.max_results == 50
        assert len(req.filters) == 0

    def test_scan_request_with_filters(self):
        req = ScanRequest(
            instrument="STK",
            scan_type="TOP_PERC_GAIN",
            location="STK.EU",
            filters=[
                ScreenerFilterItem(indicator="rsi", op="lt", value=30.0),
                ScreenerFilterItem(indicator="price", op="between", value=5.0, value2=100.0),
            ],
            max_results=25,
        )
        assert len(req.filters) == 2
        assert req.filters[0].indicator == "rsi"

    def test_scan_request_max_results_bounds(self):
        ScanRequest(max_results=1)
        ScanRequest(max_results=200)

        with pytest.raises(Exception):
            ScanRequest(max_results=0)

        with pytest.raises(Exception):
            ScanRequest(max_results=201)

    def test_screener_result_row(self):
        row = ScreenerResultRow(
            conid=265598,
            symbol="AAPL",
            company_name="Apple Inc",
            last_price=178.5,
            change_percent=1.2,
            volume=50_000_000.0,
            indicator_values={"rsi": 55.0, "ema_50": 175.0},
        )
        assert row.indicator_values["rsi"] == 55.0

    def test_scan_response(self):
        resp = ScanResponse(
            results=[],
            total_scanned=50,
            total_matched=0,
            scan_type="MOST_ACTIVE",
            location="STK.US.MAJOR",
        )
        assert resp.total_scanned == 50
        assert resp.total_matched == 0

    def test_filter_item_ops(self):
        """All expected filter ops should be valid."""
        for op in ["gt", "lt", "between", "cross_above", "cross_below"]:
            f = ScreenerFilterItem(indicator="rsi", op=op, value=30.0)
            assert f.op == op
