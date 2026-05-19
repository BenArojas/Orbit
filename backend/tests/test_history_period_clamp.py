"""
Tests for clamp_period_to_bar — backstop that prevents the indicators
router from sending invalid (period, bar) combos to IBKR.

IBKR's /iserver/marketdata/history consistently 503s when the requested
period exceeds the bar's quota (e.g. 2y of 15min bars). These tests pin
the per-timeframe ceilings so a typo in the table fails loudly.
"""

import sys
from unittest.mock import MagicMock

sys.modules.setdefault("pandas_ta", MagicMock())
sys.modules.setdefault("pandas", MagicMock())

import pytest

from constants.ibkr_history import clamp_period_to_bar, TIMEFRAME_SPEC


# ── Below-ceiling: passes through unchanged ─────────────────────────────────


def test_3m_at_15m_is_clamped_to_1m():
    """3m of 15min bars is too much — clamp to 1m."""
    effective, clamped = clamp_period_to_bar("3m", "15m")
    assert clamped is True
    assert effective == "1m"


def test_2y_at_15m_is_clamped_to_1m():
    """2y of 15min bars is the actual production bug — must clamp."""
    effective, clamped = clamp_period_to_bar("2y", "15m")
    assert clamped is True
    assert effective == "1m"


def test_5y_at_1m_bars_is_clamped_to_2d():
    """5y of 1-minute bars is absurd — clamp to the 1m timeframe's ceiling (2d)."""
    effective, clamped = clamp_period_to_bar("5y", "1m")
    assert clamped is True
    assert effective == "2d"


# ── At-ceiling: passes through unchanged ────────────────────────────────────


def test_period_at_ceiling_is_not_clamped():
    """Asking exactly for the ceiling period is fine."""
    effective, clamped = clamp_period_to_bar("1m", "15m")
    assert clamped is False
    assert effective == "1m"


def test_period_under_ceiling_is_not_clamped():
    """Modest periods below the ceiling pass through."""
    effective, clamped = clamp_period_to_bar("1w", "15m")
    assert clamped is False
    assert effective == "1w"


# ── 1D timeframe is forgiving ───────────────────────────────────────────────


def test_2y_at_1d_is_not_clamped():
    """2y of daily bars is well within IBKR's quota — should pass."""
    effective, clamped = clamp_period_to_bar("2y", "1D")
    assert clamped is False
    assert effective == "2y"


def test_5y_at_1d_is_not_clamped():
    """5y is exactly the ceiling for 1D bars."""
    effective, clamped = clamp_period_to_bar("5y", "1D")
    assert clamped is False
    assert effective == "5y"


# ── Edge cases: unknown periods and timeframes ──────────────────────────────


def test_unknown_period_passes_through():
    """If we can't parse the period, leave it alone — let downstream handle it."""
    effective, clamped = clamp_period_to_bar("garbage", "15m")
    assert clamped is False
    assert effective == "garbage"


def test_unknown_timeframe_passes_through():
    """Unknown timeframes don't get clamped — caller will route to the spec fallback."""
    effective, clamped = clamp_period_to_bar("2y", "weirdtimeframe")
    assert clamped is False
    assert effective == "2y"


def test_case_insensitive():
    """Period strings are case-normalized."""
    effective, clamped = clamp_period_to_bar("2Y", "15m")
    assert clamped is True
    assert effective == "1m"


# ── Spec table contract: every timeframe has a max_period ───────────────────


@pytest.mark.parametrize("timeframe", list(TIMEFRAME_SPEC.keys()))
def test_every_timeframe_declares_a_max_period(timeframe):
    """Every TIMEFRAME_SPEC entry must declare max_period — the clamp depends on it."""
    spec = TIMEFRAME_SPEC[timeframe]
    assert spec.max_period, f"{timeframe} is missing max_period"


@pytest.mark.parametrize("timeframe,max_period", [
    ("1m", "2d"),
    ("5m", "5d"),
    ("15m", "1m"),
    ("1h", "6m"),
    ("4h", "1y"),
    ("1D", "5y"),
    ("1W", "15y"),
    ("1M", "15y"),
])
def test_max_period_values_match_ibkr_quotas(timeframe, max_period):
    """Pin the production-tuned ceilings so a regression fails loudly."""
    assert TIMEFRAME_SPEC[timeframe].max_period == max_period
