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
    period: str            # IBKR period string ("1d", "5d", "1m", "1y", etc.)
    bar: str               # IBKR bar string ("1min", "5min", "1h", "1d", "1w", "1m")
    est_max_bars: int      # Sanity ceiling — raise IBKRBarLimitExceededError above this
    max_period: str        # Largest period IBKR will serve at this bar size — frontend
                           # history_period overrides are clamped to this. Asking for a
                           # longer period at this bar size causes IBKR to respond 503
                           # consistently (not transient), so the request is invalid by
                           # construction — clamp before sending instead of retrying.


# Period ordering for clamping comparisons. Ascending. Any period parser must
# resolve to one of these (case-insensitive). Order matters: keep this aligned
# with the frontend's PERIOD_LADDER.
PERIOD_ORDER: tuple[str, ...] = (
    "1d", "2d", "5d", "1w", "1m", "3m", "6m", "139d", "150d",
    "1y", "2y", "5y", "10y", "15y",
)


TIMEFRAME_SPEC: dict[str, HistorySpec] = {
    # est_max_bars reflects what IBKR actually delivers at the *max_period*
    # for each bar size — empirically calibrated against the 1000-bar hard
    # cap. Numbers below 1000 mean IBKR returns less than the cap (e.g. 1D
    # bars over 5y = ~260 trading days * 5 ≈ 1300, capped at 1000). Numbers
    # at 1000 mean the response saturates the cap and we still get useful
    # data — not a real problem.
    "1m":  HistorySpec(period="1d",  bar="1min",  est_max_bars=400,  max_period="2d"),
    "5m":  HistorySpec(period="5d",  bar="5min",  est_max_bars=1000, max_period="5d"),
    "15m": HistorySpec(period="1w",  bar="15min", est_max_bars=1000, max_period="1m"),
    "1h":  HistorySpec(period="1m",  bar="1h",    est_max_bars=1000, max_period="6m"),
    "4h":  HistorySpec(period="6m",  bar="4h",    est_max_bars=1000, max_period="1y"),
    "1D":  HistorySpec(period="1y",  bar="1d",    est_max_bars=1000, max_period="5y"),
    "1W":  HistorySpec(period="5y",  bar="1w",    est_max_bars=270,  max_period="15y"),
    "1M":  HistorySpec(period="15y", bar="1m",    est_max_bars=200,  max_period="15y"),
}

# Hard cap documented by IBKR — responses never legally exceed this.
IBKR_BAR_LIMIT = 1000


def _period_index(period: str) -> int:
    """Return the position of `period` in PERIOD_ORDER, or -1 if unknown."""
    p = period.lower()
    try:
        return PERIOD_ORDER.index(p)
    except ValueError:
        return -1


def clamp_period_to_bar(requested_period: str, timeframe: str) -> tuple[str, bool]:
    """Clamp a requested history period to what IBKR can serve at this bar size.

    IBKR's /iserver/marketdata/history endpoint quietly enforces a maximum
    history window per bar size. Asking for 2y of 15min data, for example,
    consistently returns 503 — it's not transient, it's a malformed request.
    The frontend's period-escalation ladder is bar-size-agnostic and can
    push past these limits when the user pans far back at a fine timeframe;
    this helper is the backstop.

    Returns (effective_period, was_clamped). `was_clamped` is True when
    the requested period exceeded the bar's max and we trimmed it down,
    so the caller can log it.
    """
    spec = TIMEFRAME_SPEC.get(timeframe)
    if spec is None:
        return requested_period, False
    requested_idx = _period_index(requested_period)
    max_idx = _period_index(spec.max_period)
    if requested_idx == -1 or max_idx == -1:
        # Unknown period string — leave it alone, let downstream handle it.
        return requested_period, False
    if requested_idx > max_idx:
        return spec.max_period, True
    return requested_period.lower(), False
