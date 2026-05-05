"""
IBKR /iserver/marketdata/history — canonical (period, bar) combinations.

Each entry maps a frontend timeframe string to the IBKR period and bar
parameters used when calling IBKRService.history().

Design decisions:
  - Every combination respects the IBKR step-size table (certain bar sizes
    are only valid within specific period windows).
  - All combinations stay well under the 1000-bar hard cap IBKR enforces.
  - `est_max_bars` is a sanity ceiling — the router raises
    IBKRBarLimitExceededError when a live response exceeds it, protecting
    against silent truncation from bad (period, bar) combos.

Source: IBKR Client Portal Web API documentation.

Note on 15m / 1w period:
  IBKR caps 15-minute bars at approximately a 1-week history window.
  Requesting a longer period with 15-minute bars silently returns fewer
  bars or errors — "1w" is the safe ceiling.
"""

from typing import Literal, NamedTuple

Timeframe = Literal["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"]

VALID_TIMEFRAMES: tuple[str, ...] = ("1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M")


class HistorySpec(NamedTuple):
    period: str        # IBKR period string ("1d", "5d", "1m", "1y", etc.)
    bar: str           # IBKR bar string ("1min", "5min", "1h", "1d", "1w", "1m")
    est_max_bars: int  # Sanity ceiling — raise IBKRBarLimitExceededError above this


TIMEFRAME_SPEC: dict[str, HistorySpec] = {
    "1m":  HistorySpec(period="1d",  bar="1min",  est_max_bars=400),
    "5m":  HistorySpec(period="5d",  bar="5min",  est_max_bars=400),
    "15m": HistorySpec(period="1w",  bar="15min", est_max_bars=110),
    "1h":  HistorySpec(period="1m",  bar="1h",    est_max_bars=160),
    "4h":  HistorySpec(period="6m",  bar="4h",    est_max_bars=240),
    "1D":  HistorySpec(period="1y",  bar="1d",    est_max_bars=260),
    "1W":  HistorySpec(period="5y",  bar="1w",    est_max_bars=270),
    "1M":  HistorySpec(period="15y", bar="1m",    est_max_bars=200),
}

# Hard cap documented by IBKR — responses never legally exceed this.
IBKR_BAR_LIMIT = 1000
