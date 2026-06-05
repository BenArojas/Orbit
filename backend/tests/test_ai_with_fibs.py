"""
Tests for Branch 5: AI analysis consumes the chart's active fib state.

Covers:
  - AnalyzeRequest accepts frontend fib snapshots
  - Prompt builder renders primary + locked fibs in stack order
  - Timeframe-specific fib snapshots only apply to matching TFs
  - Empty fib snapshots fall back to backend auto-compute
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from models import AnalyzeRequest, CandleData, FibonacciSnapshot
from routers.ai import _fetch_timeframe_data
from services.prompt_builder import build_indicator_context


def make_candle(close: float = 110.0, time: int = 1_700_000_000) -> CandleData:
    return CandleData(
        time=time,
        open=close - 1.0,
        high=close + 2.0,
        low=close - 2.0,
        close=close,
        volume=1_000_000,
    )


def make_snapshot(
    *,
    source: str = "auto",
    is_primary: bool = False,
    timeframe: str | None = None,
    swing_low: float = 100.0,
    swing_high: float = 120.0,
    score: float | None = 78.0,
) -> FibonacciSnapshot:
    return FibonacciSnapshot(
        source=source,
        swing_high=swing_high,
        swing_low=swing_low,
        swing_high_time=1_700_000_000,
        swing_low_time=1_699_900_000,
        direction="up",
        score=score,
        is_primary=is_primary,
        timeframe=timeframe,
        note=None,
    )


class TestAnalyzeRequestWithFibs:
    def test_accepts_fibs_field(self):
        req = AnalyzeRequest(
            conid=265598,
            symbol="AAPL",
            timeframes=["D"],
            indicators=["Fibonacci"],
            fibs=[
                make_snapshot(source="auto", is_primary=True),
                make_snapshot(source="locked", swing_low=90.0, swing_high=130.0),
            ],
        )

        assert len(req.fibs) == 2
        assert req.fibs[0].is_primary is True
        assert req.fibs[1].source == "locked"


class TestPromptBuilderWithFibs:
    def test_prompt_includes_primary_and_locked_fibs_in_order(self):
        """Fact layer emits D.fibonacci.* IDs for primary and locked snapshots."""
        candles = [make_candle(close=110.0 + i, time=1_700_000_000 + i * 86400) for i in range(10)]
        context = build_indicator_context(
            symbol="AAPL",
            timeframe="D",
            candles=candles,
            indicators=[],
            fibs=[
                make_snapshot(source="manual", is_primary=True, score=84.0),
                make_snapshot(source="locked", swing_low=92.0, swing_high=126.0, score=67.0),
            ],
        )

        # Fact layer uses structured IDs — no legacy "Primary fib" / "Source:" labels
        assert "Primary fib" not in context
        assert "Source: MANUAL" not in context
        assert "Source: LOCKED" not in context
        # At least one fibonacci fact must have been emitted
        assert "D.fibonacci." in context


class TestFetchTimeframeDataWithFibs:
    @pytest.mark.asyncio
    async def test_timeframe_specific_fib_only_applies_to_matching_tf(self):
        ibkr = AsyncMock()
        ibkr.history.return_value = {
            "data": [{"t": 1_700_000_000_000, "o": 100.0, "h": 120.0, "l": 95.0, "c": 110.0, "v": 1000}],
        }
        compute_mock = MagicMock(return_value=(["rsi"], "AUTO_FIB"))

        with patch("routers.ai._indicator_service.compute", compute_mock):
            result = await _fetch_timeframe_data(
                conid=265598,
                timeframe="D",
                indicators=["rsi", "fibonacci"],
                ibkr=ibkr,
                fib_snapshots=[make_snapshot(source="locked", timeframe="W")],
            )

        assert result["fibs"] == []
        assert result["fibonacci"] == "AUTO_FIB"
        assert compute_mock.call_args.kwargs["indicators"] == ["rsi", "fibonacci"]

    @pytest.mark.asyncio
    async def test_matching_fibs_override_auto_compute_for_prompt(self):
        ibkr = AsyncMock()
        ibkr.history.return_value = {
            "data": [{"t": 1_700_000_000_000, "o": 100.0, "h": 120.0, "l": 95.0, "c": 110.0, "v": 1000}],
        }
        compute_mock = MagicMock(return_value=(["rsi"], "AUTO_FIB"))
        fib = make_snapshot(source="auto", is_primary=True)

        with patch("routers.ai._indicator_service.compute", compute_mock):
            result = await _fetch_timeframe_data(
                conid=265598,
                timeframe="D",
                indicators=["rsi", "fibonacci"],
                ibkr=ibkr,
                fib_snapshots=[fib],
            )

        assert result["fibonacci"] is None
        assert result["fibs"] == [fib]
        assert compute_mock.call_args.kwargs["indicators"] == ["rsi"]

    @pytest.mark.asyncio
    async def test_empty_fibs_falls_back_to_auto_compute(self):
        ibkr = AsyncMock()
        ibkr.history.return_value = {
            "data": [{"t": 1_700_000_000_000, "o": 100.0, "h": 120.0, "l": 95.0, "c": 110.0, "v": 1000}],
        }
        compute_mock = MagicMock(return_value=(["rsi"], "AUTO_FIB"))

        with patch("routers.ai._indicator_service.compute", compute_mock):
            result = await _fetch_timeframe_data(
                conid=265598,
                timeframe="D",
                indicators=["rsi", "fibonacci"],
                ibkr=ibkr,
                fib_snapshots=[],
            )

        assert result["fibs"] == []
        assert result["fibonacci"] == "AUTO_FIB"
        assert compute_mock.call_args.kwargs["indicators"] == ["rsi", "fibonacci"]
