"""
Pydantic models for all request/response types in the Parallax API.

These models are "contracts" — they define the exact shape of data
flowing between frontend and backend. If data doesn't match the
contract, it gets rejected immediately instead of causing bugs later.

Organized by domain:
  - Health / Auth  — app status and IBKR session
  - Market Data    — quotes, candles, search results
  - Trigger Rules  — alert conditions (e.g., "RSI below 30")
  - Trigger Hits   — log of fired alerts
  - Settings       — app preferences
  - Indicators     — technical indicator computation requests/responses

Note: Watchlists are managed in IBKR — no local models needed.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional


# ═══════════════════════════════════════════════════════════════
#  Health / Auth
# ═══════════════════════════════════════════════════════════════


class HealthResponse(BaseModel):
    """Response from GET /health — is the backend alive and connected?"""
    status: str                  # "ok" or "degraded"
    ibkr_connected: bool         # Can we reach the IBKR gateway?
    ibkr_authenticated: bool     # Is the session logged in?
    ws_ready: bool               # Is the WebSocket streaming data?
    version: str                 # App version (e.g., "0.1.0")


class AuthStatusResponse(BaseModel):
    """Response from GET /auth/status — IBKR session state."""
    authenticated: bool
    ws_ready: bool
    message: str


# ═══════════════════════════════════════════════════════════════
#  Market Data
# ═══════════════════════════════════════════════════════════════


class QuoteResponse(BaseModel):
    """
    A full market data snapshot for one stock.
    This is what you see on a typical stock ticker:
    price, bid/ask, high/low, volume, etc.
    """
    conid: int                                   # IBKR's unique ID for this security
    symbol: str = ""                             # Ticker symbol (AAPL, SPY, etc.)
    companyName: str = ""                        # Full company name
    lastPrice: Optional[float] = None            # Most recent trade price
    bid: Optional[float] = None                  # Highest price someone will pay right now
    ask: Optional[float] = None                  # Lowest price someone will sell for right now
    open: Optional[float] = None                 # Price at market open today
    high: Optional[float] = None                 # Highest price today
    low: Optional[float] = None                  # Lowest price today
    previousClose: Optional[float] = None        # Yesterday's closing price
    changePercent: Optional[float] = None        # % change from yesterday
    changeAmount: Optional[float] = None         # $ change from yesterday
    volume: Optional[float] = None               # Number of shares traded today


class CandleData(BaseModel):
    """
    One candle (bar) on a chart.

    A "candle" represents price action over a time period (1 minute, 1 day, etc.).
    - open: price at the start of the period
    - high: highest price during the period
    - low: lowest price during the period
    - close: price at the end of the period
    - volume: how many shares were traded

    The "time" is a Unix timestamp (seconds since January 1, 1970).
    TradingView Lightweight Charts expects this format.
    """
    time: int                   # Unix timestamp in seconds
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class SearchResult(BaseModel):
    """One result from a symbol search (GET /market/search)."""
    conid: Optional[int] = None
    symbol: Optional[str] = None
    companyName: str = ""
    secType: str = ""            # Security type: STK, ETF, OPT, etc.


class ConidResponse(BaseModel):
    """Response from GET /market/conid/{symbol} — resolves ticker to IBKR ID."""
    conid: int
    symbol: str


# ═══════════════════════════════════════════════════════════════
#  Trigger Rules
# ═══════════════════════════════════════════════════════════════


class TriggerRuleCreate(BaseModel):
    """
    Request body to create a trigger rule.
    Each rule targets one specific stock.

    When the trigger fires, the stock is MOVED between IBKR watchlists:
      source_watchlist → target_watchlist

    If auto_expire_days is set, the stock moves back automatically
    after that many days. If not set, you remove it manually.

    Example: "When AAPL touches the 9 EMA weekly, move it to 'EMA 9 Hits'"
      → name="AAPL EMA 9 Weekly", conid=265598, symbol="AAPL",
        indicator="ema_9", condition="crosses_below", threshold=0,
        target_watchlist="EMA 9 Hits", source_watchlist="My Stocks",
        timeframe="1W", auto_expire_days=5
    """
    name: str                                       # Human-readable name
    conid: int                                       # IBKR's unique ID for the stock
    symbol: str                                      # Ticker for display (AAPL, SPY, etc.)
    indicator: str                                   # "rsi", "ema_50", "macd", etc.
    condition: str                                   # "above", "below", "crosses_above", "crosses_below"
    threshold: float                                 # The value to compare against
    target_watchlist: str                            # IBKR watchlist to move the stock INTO
    source_watchlist: str                            # IBKR watchlist to move the stock OUT OF
    timeframe: str = "1D"                            # Chart timeframe to evaluate
    auto_expire_days: Optional[int] = None           # NULL = manual removal. N = auto-move back after N days


class TriggerRuleUpdate(BaseModel):
    """Request body to update a trigger rule (all fields optional)."""
    name: Optional[str] = None
    indicator: Optional[str] = None
    condition: Optional[str] = None
    threshold: Optional[float] = None
    conid: Optional[int] = None
    symbol: Optional[str] = None
    timeframe: Optional[str] = None
    target_watchlist: Optional[str] = None
    source_watchlist: Optional[str] = None
    auto_expire_days: Optional[int] = None
    enabled: Optional[bool] = None


class TriggerRuleResponse(BaseModel):
    """A trigger rule as returned by the API."""
    id: int
    name: str
    conid: int
    symbol: str
    indicator: str
    condition: str
    threshold: float
    timeframe: str
    target_watchlist: str
    source_watchlist: str
    auto_expire_days: Optional[int] = None
    enabled: bool
    created_at: str
    updated_at: str


# ═══════════════════════════════════════════════════════════════
#  Trigger Hits
# ═══════════════════════════════════════════════════════════════


class TriggerHitResponse(BaseModel):
    """
    A logged trigger event — "this rule fired at this time."

    actual_value = what the indicator was when the trigger fired.
    E.g., if your rule is "RSI below 30" and RSI hit 27.3,
    then threshold=30.0 and actual_value=27.3.

    The stock was moved from source_watchlist → target_watchlist.
    If expires_at is set, the stock will be moved back automatically.
    moved_back = True means it's already been returned.
    """
    id: int
    rule_id: int
    conid: int
    symbol: str
    indicator: str
    condition: str
    threshold: float
    actual_value: float
    target_watchlist: str
    source_watchlist: str
    triggered_at: str
    expires_at: Optional[str] = None
    moved_back: bool = False
    acknowledged: bool


# ═══════════════════════════════════════════════════════════════
#  Settings
# ═══════════════════════════════════════════════════════════════


class SettingUpdate(BaseModel):
    """Request body to update a single setting."""
    value: str


class SettingResponse(BaseModel):
    """A single setting key-value pair."""
    key: str
    value: str


# ═══════════════════════════════════════════════════════════════
#  Indicators
# ═══════════════════════════════════════════════════════════════


class IndicatorRequest(BaseModel):
    """
    Request to compute one or more technical indicators for a stock.

    The frontend sends this when showing a chart or running the screener.
    Example: "Compute RSI and MACD for AAPL on the 1D timeframe"

    conid:      IBKR's unique ID for the stock
    period:     How much history to load: "1D", "5D", "1M", "3M", "6M", "1Y"
    indicators: Which indicators to compute — use their short names:
                "rsi", "macd", "ema_9", "ema_21", "ema_50", "ema_200",
                "bbands", "vwap", "atr", "stoch", "obv", "adx",
                "volume", "fibonacci"
    """
    conid: int
    period: str = "3M"
    indicators: list[str] = Field(
        default=["rsi", "macd", "ema_50", "ema_200"],
        description="List of indicator names to compute",
    )


class IndicatorValue(BaseModel):
    """
    A single data point for an indicator at a specific time.

    For simple indicators (RSI, EMA, ATR, OBV, ADX), only 'value' is set.
    For complex indicators, extra fields are used:
      - MACD: value=MACD line, signal=signal line, histogram=histogram
      - Bollinger Bands: value=middle, upper=upper band, lower=lower band
      - Stochastic: value=K line, signal=D line
    """
    time: int                                    # Unix timestamp (seconds)
    value: Optional[float] = None                # Main indicator value
    signal: Optional[float] = None               # Signal/secondary line (MACD, Stochastic)
    histogram: Optional[float] = None            # MACD histogram bar
    upper: Optional[float] = None                # Upper band (Bollinger)
    lower: Optional[float] = None                # Lower band (Bollinger)


class IndicatorResult(BaseModel):
    """
    Computed values for one indicator.

    name:    Which indicator this is (e.g., "rsi")
    type:    How to display it: "overlay" (on the chart), "oscillator" (below),
             "histogram" (as bars), "value" (just a number), "line" (separate line)
    values:  The computed data points
    params:  The parameters used (e.g., {"period": 14} for RSI)
    """
    name: str
    type: str                                    # "overlay", "oscillator", "histogram", "value", "line"
    values: list[IndicatorValue]
    params: dict[str, float | int | str] = {}    # Parameters used for computation


class FibonacciLevel(BaseModel):
    """
    A single Fibonacci retracement level.

    Fibonacci levels are horizontal lines on a chart at specific percentages
    between a swing high (peak) and swing low (bottom). Traders use them
    to predict where price might bounce or reverse.

    Standard levels: 0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%
    """
    level: float        # The percentage (0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0)
    price: float        # The actual price at this level
    label: str          # Display label (e.g., "61.8%")


class FibonacciResult(BaseModel):
    """
    Fibonacci retracement analysis for a stock.

    swing_high / swing_low:  The peak and bottom the levels are drawn between
    swing_high_time / swing_low_time:  When those peaks occurred
    levels:  The calculated price levels
    trend:   "up" (low→high) or "down" (high→low)
    """
    swing_high: float
    swing_low: float
    swing_high_time: int         # Unix timestamp
    swing_low_time: int          # Unix timestamp
    levels: list[FibonacciLevel]
    trend: str                   # "up" or "down"


class IndicatorComputeResponse(BaseModel):
    """
    Full response from POST /indicators/compute.

    Contains all the indicators the frontend requested, plus Fibonacci
    levels if requested. Also echoes back the candle data so the frontend
    has everything it needs in one response.
    """
    conid: int
    period: str
    candles: list[CandleData]                          # The raw price data used
    indicators: list[IndicatorResult]                  # Computed indicator values
    fibonacci: Optional[FibonacciResult] = None        # Fibonacci levels (if requested)
