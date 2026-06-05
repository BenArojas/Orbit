"""
Tests for _compute_bollinger_bands — column-name resilience.

Covers:
  - Standard pandas-ta output (BBL_20_2.0) is parsed correctly.
  - Non-standard float suffix (BBL_20_2) is still found via prefix match.
  - Completely unexpected columns trigger a warning and return empty values.
  - Result carries the correct value/upper/lower fields.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch
import pandas as pd
import pytest

from services.indicators import IndicatorService
from models import CandleData


# ── Helpers ───────────────────────────────────────────────────

def _make_candles(n: int = 30) -> list[CandleData]:
    """Build n minimal candles (price 100 with small spread)."""
    return [
        CandleData(
            time=1700000000 + i * 86400,
            open=100.0,
            high=101.0,
            low=99.0,
            close=100.0 + (i % 3) * 0.5,  # slight variation so std > 0
            volume=1000.0,
        )
        for i in range(n)
    ]


def _make_bb_df(col_suffix: str) -> pd.DataFrame:
    """Return a fake bbands DataFrame with the given suffix (e.g. '2.0' or '2')."""
    n = 30
    data = {
        f"BBL_20_{col_suffix}": [99.0] * n,
        f"BBM_20_{col_suffix}": [100.0] * n,
        f"BBU_20_{col_suffix}": [101.0] * n,
        f"BBB_20_{col_suffix}": [2.0] * n,   # bandwidth — ignored
        f"BBP_20_{col_suffix}": [0.5] * n,   # percent — ignored
    }
    # First 19 rows NaN (warmup period)
    df = pd.DataFrame(data, dtype=float)
    df.iloc[:19] = float("nan")
    return df


# ── Tests ─────────────────────────────────────────────────────

class TestBollingerBandColumns:
    """IndicatorService._compute_bollinger_bands column-detection resilience."""

    def test_standard_column_suffix_2_0(self):
        """Standard pandas-ta output (BBL_20_2.0) returns non-empty values."""
        svc = IndicatorService()
        candles = _make_candles(30)

        with patch("services.indicators.ta.bbands", return_value=_make_bb_df("2.0")):
            result = svc._compute_bollinger_bands(
                svc._candles_to_dataframe(candles)
            )

        assert result.name == "bbands"
        assert len(result.values) > 0
        # Spot-check first non-NaN value
        v = result.values[0]
        assert v.value == pytest.approx(100.0)
        assert v.upper == pytest.approx(101.0)
        assert v.lower == pytest.approx(99.0)

    def test_non_standard_column_suffix_integer(self):
        """Non-standard suffix (BBL_20_2 without decimal) still resolved by prefix."""
        svc = IndicatorService()
        candles = _make_candles(30)

        with patch("services.indicators.ta.bbands", return_value=_make_bb_df("2")):
            result = svc._compute_bollinger_bands(
                svc._candles_to_dataframe(candles)
            )

        assert len(result.values) > 0

    def test_unexpected_columns_returns_empty_with_warning(self, caplog):
        """If pandas-ta returns completely unexpected columns, return empty + warn."""
        import logging
        svc = IndicatorService()
        candles = _make_candles(30)

        # Return a df with no BBL_/BBM_/BBU_ columns at all
        bad_df = pd.DataFrame({"GARBAGE_COL": [1.0] * 30})

        with patch("services.indicators.ta.bbands", return_value=bad_df):
            with caplog.at_level(logging.WARNING, logger="parallax.indicators"):
                result = svc._compute_bollinger_bands(
                    svc._candles_to_dataframe(candles)
                )

        assert result.values == []
        assert any("unexpected column" in r.message for r in caplog.records)

    def test_none_from_ta_returns_empty(self):
        """If pandas-ta returns None, return empty IndicatorResult."""
        svc = IndicatorService()
        candles = _make_candles(30)

        with patch("services.indicators.ta.bbands", return_value=None):
            result = svc._compute_bollinger_bands(
                svc._candles_to_dataframe(candles)
            )

        assert result.values == []

    def test_full_compute_pipeline_includes_bbands(self):
        """End-to-end: compute() with 'bbands' in the list produces an overlay result."""
        svc = IndicatorService()
        candles = _make_candles(40)  # enough bars to warm up pandas-ta

        results, _fib = svc.compute(candles, ["bbands"])

        assert any(r.name == "bbands" for r in results), (
            "Expected a 'bbands' IndicatorResult in the output"
        )
        bb = next(r for r in results if r.name == "bbands")
        assert bb.type == "overlay"
        # With 40 bars and period=20 there must be at least 1 non-NaN value
        assert len(bb.values) > 0
