"""
IBKR Client Portal API constants.
Field codes, period/bar mappings, and default snapshot fields.
Ported from MoonMarket — these are stable IBKR API constants.

This package also hosts:
  - constants.ibkr_filters: canonical FILTER_CATALOGUE for the screener
    and AI translation layer (single source of truth for filter codes).
"""

# ── IBKR Snapshot Field Codes ────────────────────────────────
# Full reference: IBKR Client Portal API docs
# These are the numeric codes you pass to /iserver/marketdata/snapshot

FIELD_LAST_PRICE = "31"
FIELD_SYMBOL = "55"
FIELD_BID = "84"
FIELD_ASK = "86"
FIELD_CHANGE_PCT = "83"
FIELD_CHANGE_AMT = "82"
FIELD_HIGH = "70"
FIELD_LOW = "71"
FIELD_COMPANY_NAME = "7051"
FIELD_VOLUME = "7762"
FIELD_PRIOR_CLOSE = "7741"
FIELD_MARKET_DATA_AVAIL = "6509"
FIELD_OPEN = "7295"
FIELD_MARKET_CAP = "7289"       # Market cap in $M

# Default fields for a standard quote snapshot
DEFAULT_QUOTE_FIELDS = [
    FIELD_LAST_PRICE,
    FIELD_SYMBOL,
    FIELD_BID,
    FIELD_ASK,
    FIELD_CHANGE_PCT,
    FIELD_CHANGE_AMT,
    FIELD_HIGH,
    FIELD_LOW,
    FIELD_COMPANY_NAME,
    FIELD_VOLUME,
    FIELD_PRIOR_CLOSE,
    FIELD_OPEN,
]
DEFAULT_QUOTE_FIELDS_STR = ",".join(DEFAULT_QUOTE_FIELDS)

# Max conids per single /iserver/marketdata/snapshot HTTP call.
# Phase 8 / Task 2.1: bundled `/market/quotes` chunks larger requests
# into ≤ this many conids per IBKR call. IBKR's documented hard cap
# is 50 — going above risks silent truncation.
SNAPSHOT_BATCH_SIZE = 50

# Minimal fields for live WebSocket streaming
LIVE_STREAM_FIELDS = [
    FIELD_LAST_PRICE,
    FIELD_BID,
    FIELD_ASK,
    FIELD_CHANGE_PCT,
    FIELD_CHANGE_AMT,
    FIELD_HIGH,
    FIELD_LOW,
    FIELD_VOLUME,
]


# ── Period → Bar Mappings (DEPRECATED) ──────────────────────
# Maps legacy period labels to IBKR (period, bar) format.
# Used only by the /market/candles endpoint (which uses a different
# period vocabulary from the indicator router's timeframe vocabulary).
#
# The indicator router now uses TIMEFRAME_SPEC from constants.ibkr_history.
# Do not add new callers of PERIOD_BAR.

PERIOD_BAR: dict[str, tuple[str, str]] = {
    "1D": ("1d", "1min"),      # 1 day, 1-minute bars (intraday)
    "5D": ("5d", "5min"),      # 5 days, 5-minute bars
    "1M": ("1m", "30min"),     # 1 month, 30-minute bars
    "3M": ("3m", "1d"),        # 3 months, daily bars
    "6M": ("6m", "1d"),        # 6 months, daily bars
    "1Y": ("1y", "1d"),        # 1 year, daily bars
    "5Y": ("5y", "1w"),        # 5 years, weekly bars
}


# ── Sector ETFs (SPDR Select Sector) ───────────────────────
# The 11 S&P 500 sector ETFs + SPY as benchmark.
# Conids are resolved at runtime via IBKR search — these are just tickers and names.

SECTOR_ETFS: list[dict[str, str]] = [
    {"symbol": "XLK", "name": "Technology"},
    {"symbol": "XLV", "name": "Healthcare"},
    {"symbol": "XLF", "name": "Financials"},
    {"symbol": "XLE", "name": "Energy"},
    {"symbol": "XLI", "name": "Industrials"},
    {"symbol": "XLY", "name": "Consumer Disc."},
    {"symbol": "XLP", "name": "Consumer Staples"},
    {"symbol": "XLU", "name": "Utilities"},
    {"symbol": "XLRE", "name": "Real Estate"},
    {"symbol": "XLC", "name": "Comm. Services"},
    {"symbol": "XLB", "name": "Materials"},
]

SECTOR_BENCHMARK = "SPY"  # S&P 500 benchmark for RRG calculations

# RRG (Relative Rotation Graph) parameters — standard JdK method
RRG_RS_EMA_PERIOD = 10       # EMA smoothing period for RS-Ratio
RRG_MOMENTUM_PERIOD = 10     # Rate-of-change period for RS-Momentum
RRG_LOOKBACK_DAYS = 252      # ~1 year of daily data for RRG calculation

# ── Offensive vs Defensive sector groupings ────────────────
# Used by the Sector Rotation arc gauge (Phase 8 / Task 8.9).
# Offensive = cyclical sectors that lead in risk-on environments.
# Defensive = low-beta sectors that lead when markets de-risk.
SECTORS_OFFENSIVE = ["XLK", "XLY", "XLC", "XLF"]
SECTORS_DEFENSIVE = ["XLP", "XLU", "XLV"]

# Market breadth / rotation parameters
BREADTH_EMA_PERIOD = 50                # "% above 50-day EMA" breadth proxy
ROTATION_LOOKBACK_DAYS = 21            # ~1 month of trading days (offensive − defensive perf)
ROTATION_RANGE_PCT = 5.0               # ± this % maps to 0/100 on the rotation gauge
