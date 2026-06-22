"""
Synthetic but realistic fixture data for eval harness snapshots.

Each scenario function returns a dict usable as **kwargs to build_indicator_context:
  {
      "symbol": str,
      "timeframe": str,
      "candles": list[CandleData],
      "indicators": list[IndicatorResult],
  }

All values are fixed so snapshots stay deterministic across runs.
"""
from __future__ import annotations

from models import CandleData, IndicatorResult, IndicatorValue

_T0 = 1_700_000_000  # 2023-11-14 (arbitrary anchor)
_DAY = 86_400


def _candle(close: float, open_: float, high: float, low: float, volume: float, i: int) -> CandleData:
    return CandleData(
        time=_T0 + i * _DAY,
        open=open_, high=high, low=low, close=close, volume=volume,
    )


def _iv(value: float, i: int) -> IndicatorValue:
    return IndicatorValue(time=_T0 + i * _DAY, value=value)


def _indicator(name: str, values: list[float], *, offset: int = 0, **params) -> IndicatorResult:
    return IndicatorResult(
        name=name, type="overlay",
        values=[_iv(v, offset + i) for i, v in enumerate(values)],
        params=params,
    )


# ── Scenario A: TSM — Bullish extension, RSI overbought ─────────────────────

def tsm_extension() -> dict:
    """
    TSM daily — 25 bars of steady uptrend; RSI stretched to ~72; EMA stack
    bullish; volume confirming.  Fact layer should emit:
      - ema.stack_bullish
      - rsi.overbought (or approaching)
      - volume.above_avg
    """
    closes = [
        145.0, 145.8, 147.2, 148.5, 149.0, 150.3, 151.5, 152.0, 153.4,
        154.1, 155.0, 156.3, 157.2, 158.0, 158.9, 159.8, 161.0, 161.7,
        162.5, 163.0, 163.8, 164.5, 165.0, 165.8, 166.2,
    ]
    candles = [
        _candle(
            close=c,
            open_=c - 0.6,
            high=c + 1.2,
            low=c - 1.1,
            volume=8_500_000 + i * 50_000,
            i=i,
        )
        for i, c in enumerate(closes)
    ]

    # EMA stack (all sloping up, 9 > 21 > 50 > 200-equivalent)
    ema9_vals = [c - 0.8 for c in closes]
    ema21_vals = [c - 2.5 for c in closes]
    ema50_vals = [c - 6.0 for c in closes]
    ema200_vals = [c - 18.0 for c in closes]

    # RSI — rising into overbought territory (last = 72.5)
    rsi_vals = [
        52.0, 53.5, 55.0, 57.2, 58.8, 60.1, 61.4, 62.8, 64.0, 65.3,
        66.5, 67.8, 68.5, 69.2, 70.0, 70.8, 71.2, 71.6, 72.0, 72.5,
        72.8, 73.0, 72.5, 72.8, 73.2,
    ]

    # Volume facts are built from candles directly (build_volume_facts),
    # not from a passed IndicatorResult — no need to include here.
    indicators = [
        _indicator("ema_9", ema9_vals, period=9),
        _indicator("ema_21", ema21_vals, period=21),
        _indicator("ema_50", ema50_vals, period=50),
        _indicator("ema_200", ema200_vals, period=200),
        _indicator("rsi", rsi_vals, period=14),
    ]

    return {"symbol": "TSM", "timeframe": "D", "candles": candles, "indicators": indicators}


# ── Scenario B: AAPL — In-swing (Fib 38.2%–61.8% zone) ─────────────────────

def aapl_in_swing() -> dict:
    """
    AAPL daily — 25 bars; price pulled back from 195→175 and is now
    consolidating at ~178 (≈50% Fib retracement from 165→195).
    EMA 21 is nearby; RSI neutral ~52.  Fact layer should emit:
      - fibonacci.near_level (38.2 or 50%)
    """
    # Swing: high=195 at bar 14, low=165 at bar 0
    # Fib levels: 38.2%=176.5, 50%=180.0, 61.8%=183.5
    closes = [
        165.0, 168.5, 172.0, 176.5, 180.0, 183.5, 187.0, 190.0, 193.5,
        194.8, 195.0, 192.0, 188.5, 184.0, 180.0, 177.5, 175.2, 176.0,
        177.8, 178.5, 178.2, 179.0, 178.8, 179.5, 180.0,
    ]
    candles = [
        _candle(
            close=c,
            open_=c + (0.5 if i < 14 else -0.5),
            high=c + 1.5,
            low=c - 1.5,
            volume=55_000_000,
            i=i,
        )
        for i, c in enumerate(closes)
    ]

    ema9_vals = [
        165.5, 167.8, 170.6, 173.8, 177.2, 180.5, 183.4, 186.2, 189.1,
        191.3, 192.7, 192.0, 190.5, 188.2, 185.4, 182.7, 180.2, 179.0,
        178.8, 178.6, 178.5, 178.8, 178.7, 179.0, 179.3,
    ]
    ema21_vals = [c - 3.0 for c in closes]

    rsi_vals = [
        45.0, 48.2, 51.5, 54.8, 57.0, 59.3, 61.5, 63.8, 65.5,
        67.2, 68.0, 64.2, 59.8, 55.5, 52.0, 49.8, 48.5, 49.0,
        50.2, 51.5, 51.0, 52.0, 51.5, 52.3, 52.8,
    ]

    from models import FibonacciSnapshot

    primary_fib = FibonacciSnapshot(
        source="auto",
        swing_high=195.0,
        swing_low=165.0,
        swing_high_time=_T0 + 10 * _DAY,
        swing_low_time=_T0,
        direction="up",
        score=81.0,
        is_primary=True,
        timeframe="D",
        note=None,
    )

    indicators = [
        _indicator("ema_9", ema9_vals, period=9),
        _indicator("ema_21", ema21_vals, period=21),
        _indicator("rsi", rsi_vals, period=14),
    ]

    return {
        "symbol": "AAPL",
        "timeframe": "D",
        "candles": candles,
        "indicators": indicators,
        "fibs": [primary_fib],
    }


# ── Scenario C: NVDA — Powerful EMA stack breakout ──────────────────────────

def nvda_ema_stack() -> dict:
    """
    NVDA daily — 25 bars of explosive rally; EMA 9 >> 21 >> 50 >> 200;
    RSI sustained at 74-78 (strong trend, not yet reversing).
    Fact layer should emit:
      - ema.stack_bullish
      - ema.stack_separation (large spread)
      - rsi.overbought
    """
    closes = [
        480.0, 492.0, 505.5, 518.0, 530.0, 542.5, 555.0, 567.8, 580.0,
        592.0, 603.5, 615.0, 626.0, 636.5, 647.0, 658.0, 668.5, 678.0,
        687.5, 696.0, 704.0, 711.5, 718.0, 724.5, 730.0,
    ]
    candles = [
        _candle(
            close=c,
            open_=c - 4.0,
            high=c + 6.5,
            low=c - 5.0,
            volume=45_000_000 + i * 200_000,
            i=i,
        )
        for i, c in enumerate(closes)
    ]

    # Very wide separation between EMAs — hallmark of a strong stack
    ema9_vals = [c - 5.0 for c in closes]
    ema21_vals = [c - 20.0 for c in closes]
    ema50_vals = [c - 55.0 for c in closes]
    ema200_vals = [c - 200.0 for c in closes]

    rsi_vals = [
        62.0, 64.5, 66.0, 68.0, 69.8, 71.5, 72.8, 74.0, 74.5,
        75.0, 75.5, 76.0, 76.5, 76.2, 75.8, 75.5, 75.0, 74.8,
        74.5, 74.0, 74.2, 74.5, 75.0, 75.5, 76.0,
    ]

    indicators = [
        _indicator("ema_9", ema9_vals, period=9),
        _indicator("ema_21", ema21_vals, period=21),
        _indicator("ema_50", ema50_vals, period=50),
        _indicator("ema_200", ema200_vals, period=200),
        _indicator("rsi", rsi_vals, period=14),
    ]

    return {"symbol": "NVDA", "timeframe": "D", "candles": candles, "indicators": indicators}
