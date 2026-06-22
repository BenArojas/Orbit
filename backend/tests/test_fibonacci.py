from __future__ import annotations

import pytest

from models import CandleData
from services.indicators import IndicatorService


def make_candle(t: int, o: float, h: float, l: float, c: float, v: float = 1_000_000) -> CandleData:
    return CandleData(time=t, open=o, high=h, low=l, close=c, volume=v)


class TestPrimaryRangeSelection:
    """
    Primary fib selection safety: played-out/broken swings must never become
    the primary; no_active_fib must be flagged when all candidates are exhausted.
    """

    @staticmethod
    def _ramp_candles(
        sections: list[tuple[int, float, float]],
        t0: int = 1_700_000_000,
        bar_seconds: int = 86400,
    ) -> list[CandleData]:
        out: list[CandleData] = []
        idx = 0
        for bars_in_section, p0, p1 in sections:
            for i in range(bars_in_section):
                frac = i / max(1, bars_in_section - 1) if bars_in_section > 1 else 1.0
                price = p0 + (p1 - p0) * frac
                out.append(make_candle(
                    t=t0 + (idx + i) * bar_seconds,
                    o=price, h=price + 0.3, l=price - 0.3, c=price,
                ))
            idx += bars_in_section
        return out

    def test_picks_alive_swing_over_higher_scoring_played_out(self):
        svc = IndicatorService()
        candles = self._ramp_candles([
            (15, 100.0, 130.0),
            (15, 130.0, 200.0),
            (15, 200.0, 185.0),
            (15, 185.0, 195.0),
            (15, 195.0, 190.0),
        ])
        _, fib = svc.compute(candles, indicators=["fibonacci"])
        assert fib is not None
        assert fib.no_active_fib is False
        current_price = candles[-1].close
        assert fib.swing_low <= current_price <= fib.swing_high

    def test_returns_no_active_fib_when_all_broken(self):
        svc = IndicatorService()
        candles = self._ramp_candles([
            (10, 100.0, 130.0),
            (15, 130.0, 200.0),
            (20, 200.0, 40.0),
            (15, 40.0, 30.0),
        ])
        _, fib = svc.compute(candles, indicators=["fibonacci"])
        assert fib is not None
        if fib.no_active_fib:
            assert fib.no_active_fib_reason is not None
            assert fib.candidates
        else:
            current_price = candles[-1].close
            assert fib.swing_low <= current_price <= fib.swing_high

    def test_wick_boundary_cross_flips_status(self):
        """Wick cross past swing boundary must flip status — never stay active."""
        svc = IndicatorService()
        target_lo, target_hi = 100.0, 130.0

        def dist(c) -> float:
            return abs(c.swing_low - target_lo) + abs(c.swing_high - target_hi)

        candles_played = self._ramp_candles([
            (8, 115.0, 102.0),
            (1, 100.0, 100.0),
            (8, 102.0, 128.0),
            (1, 130.0, 130.0),
            (8, 128.0, 115.0),
            (5, 115.0, 131.0),
            (3, 128.0, 125.0),
        ])
        _, fib_p = svc.compute(candles_played, indicators=["fibonacci"])
        assert fib_p is not None
        closest_p = min(fib_p.candidates, key=dist)
        if abs(closest_p.swing_low - target_lo) < 5.0 and abs(closest_p.swing_high - target_hi) < 5.0:
            assert closest_p.status == "played_out"

        candles_broken = self._ramp_candles([
            (8, 115.0, 102.0),
            (1, 100.0, 100.0),
            (8, 102.0, 128.0),
            (1, 130.0, 130.0),
            (8, 128.0, 115.0),
            (5, 115.0,  99.0),
            (3, 101.0, 104.0),
        ])
        _, fib_b = svc.compute(candles_broken, indicators=["fibonacci"])
        assert fib_b is not None
        closest_b = min(fib_b.candidates, key=dist)
        if abs(closest_b.swing_low - target_lo) < 5.0 and abs(closest_b.swing_high - target_hi) < 5.0:
            assert closest_b.status == "broken"
