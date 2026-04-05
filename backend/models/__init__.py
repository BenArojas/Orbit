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
#  Instruments Cache
#
#  Hub integration: This is the shared instrument lookup table.
#  Parallax writes to it (via market search/conid resolution).
#  MoonMarket and Inflect read from it to resolve conid → symbol.
# ═══════════════════════════════════════════════════════════════


class InstrumentResponse(BaseModel):
    """
    A cached instrument from the local instruments table.
    conid is the universal key across the entire IBKR Hub.
    """
    conid: int                   # IBKR's unique contract ID — the universal key
    symbol: str                  # Ticker (AAPL, SPY, QQQ)
    company_name: str = ""       # Full company name
    sec_type: str = "STK"        # STK, ETF, OPT, FUT, etc.
    cached_at: str = ""          # When this was last refreshed from IBKR


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


# ═══════════════════════════════════════════════════════════════
#  Sectors (Phase 3 — tasks 3.3, 3.4)
# ═══════════════════════════════════════════════════════════════


class SectorPerformance(BaseModel):
    """
    YTD performance for one sector ETF.
    Used in the Sector Performance bar chart on the dashboard.
    """
    symbol: str                              # ETF ticker (XLK, XLV, etc.)
    name: str                                # Sector name ("Technology", etc.)
    conid: int                               # IBKR contract ID
    lastPrice: Optional[float] = None        # Current price
    changePercent: Optional[float] = None    # Day's % change
    ytdPercent: Optional[float] = None       # Year-to-date % change


class RRGDataPoint(BaseModel):
    """
    One data point on the Relative Rotation Graph.

    RS-Ratio: measures relative trend strength vs benchmark (SPY).
      > 100 = outperforming, < 100 = underperforming.
    RS-Momentum: measures rate of change of RS-Ratio.
      > 100 = improving, < 100 = weakening.

    The 4 quadrants:
      Leading   (Ratio > 100, Momentum > 100) — strong and getting stronger
      Weakening (Ratio > 100, Momentum < 100) — strong but fading
      Lagging   (Ratio < 100, Momentum < 100) — weak and getting weaker
      Improving (Ratio < 100, Momentum > 100) — weak but recovering
    """
    symbol: str
    name: str
    rs_ratio: float                          # Relative strength ratio (centered at 100)
    rs_momentum: float                       # Rate of change of RS-Ratio (centered at 100)
    quadrant: str                            # "leading", "weakening", "lagging", "improving"
    # Trail: last N data points for animated tail
    trail: list[dict[str, float]] = []       # [{"rs_ratio": ..., "rs_momentum": ...}, ...]


class SectorOverviewResponse(BaseModel):
    """Full sector data for the dashboard — performance bars + RRG."""
    performance: list[SectorPerformance]
    rrg: list[RRGDataPoint]


# ═══════════════════════════════════════════════════════════════
#  Watchlists (Phase 3 — task 3.5)
#
#  Watchlists live in IBKR — we don't store them locally.
#  We fetch them fresh from IBKR each time.
# ═══════════════════════════════════════════════════════════════


class WatchlistInfo(BaseModel):
    """Summary of one IBKR watchlist (just ID + name)."""
    id: str
    name: str


class WatchlistItemResponse(BaseModel):
    """
    One instrument in a watchlist, enriched with live quote data.
    conid is the universal key — same as everywhere else in the Hub.
    """
    conid: int
    symbol: str = ""
    companyName: str = ""
    lastPrice: Optional[float] = None
    changePercent: Optional[float] = None
    changeAmount: Optional[float] = None


class WatchlistResponse(BaseModel):
    """Full watchlist with items and live quotes."""
    id: str
    name: str
    items: list[WatchlistItemResponse]


# ═══════════════════════════════════════════════════════════════
#  AI Analysis (Phase 4 — tasks 4.9–4.12)
# ═══════════════════════════════════════════════════════════════


class AnalyzeRequest(BaseModel):
    """
    Request to run an AI technical analysis on a stock.

    The frontend sends this when the user clicks "Run Analysis" in the AI panel.
    It includes which timeframes and indicators to analyze.

    Example: "Analyze AAPL on 4H and D timeframes using RSI, MACD, EMA Stack"
    """
    conid: int                                          # IBKR contract ID
    symbol: str                                         # Ticker for display
    timeframes: list[str] = Field(
        default=["4H", "D"],
        description="Timeframes to analyze: 1H, 4H, D, W",
    )
    indicators: list[str] = Field(
        default=["rsi", "macd", "ema_50", "ema_200"],
        description="Indicator names to include in analysis",
    )
    session_id: Optional[str] = None                    # Resume existing session or None for new


class ChatMessage(BaseModel):
    """A single message in a chat conversation."""
    role: str                                           # "user", "assistant", or "system"
    content: str                                        # Message text


class ChatRequest(BaseModel):
    """
    Request to send a follow-up message in an existing analysis session.

    The frontend sends this when the user types a question in the AI chat
    after an initial analysis has been run.

    session_id links to the conversation started by AnalyzeRequest.
    """
    session_id: str                                     # Must match an active session
    message: str                                        # The user's follow-up question


class SignalLevel(BaseModel):
    """One price level in the signal card (Entry, Stop, or Target)."""
    label: str                                          # "Entry", "Stop", "Target"
    value: str                                          # Formatted price string
    sub: str                                            # Brief note
    color: Optional[str] = None                         # "green" for target, "red" for stop


class SignalCheck(BaseModel):
    """One confirmation or caution item in the signal card."""
    text: str                                           # Description text
    type: str                                           # "confirm" or "caution"


class SignalMeta(BaseModel):
    """Meta info row in the signal card."""
    label: str                                          # "R:R", "Score", "ADX", "Vol"
    value: str                                          # Display value


class SignalData(BaseModel):
    """
    The structured trading signal displayed in the Action Signal card.

    This is the AI's recommendation after analyzing a stock's technicals.
    Direction indicates the overall bias, confidence is how sure the AI is.
    """
    direction: str                                      # "STRONG LONG", "LONG", "NEUTRAL", "SHORT", "STRONG SHORT"
    description: str                                    # 1-2 sentence summary
    confidence: int                                     # 0-100
    levels: list[SignalLevel]                            # Entry, Stop, Target
    meta: list[SignalMeta]                               # R:R, Score, ADX, Vol
    checks: list[SignalCheck]                            # Confirmations + cautions


class AnalyzeResponse(BaseModel):
    """
    Response from POST /ai/analyze — the AI's trading signal and analysis.

    signal: The structured data for the Action Signal card (null if parsing failed)
    message: The full AI response text (always present)
    session_id: ID for follow-up questions in this conversation
    """
    session_id: str
    signal: Optional[SignalData] = None
    message: str


class ChatResponse(BaseModel):
    """
    Response from POST /ai/chat — AI's reply to a follow-up question.

    signal: Updated signal (only present if AI revised its recommendation)
    message: The AI's response text
    """
    session_id: str
    signal: Optional[SignalData] = None
    message: str


class AiStatusResponse(BaseModel):
    """
    Response from GET /ai/status — Ollama lifecycle state.

    The frontend uses this to decide which UI to show:
      - "not_installed" → Install guide with download link
      - "no_models"     → Model guide with pull commands
      - "running"       → Model picker dropdown (multiple models, no selection)
      - "ready"         → AI features fully available
      - "error"         → Error message with retry option
    """
    state: str                                          # "not_installed", "installed", "running", "no_models", "ready", "error"
    selected_model: Optional[str] = None                # Currently selected model name (null if none)
    ready: bool                                         # True = AI features fully available
    error: Optional[str] = None                         # Error message if state is "error"
    platform: str = ""                                  # "darwin", "windows", "linux"


class OllamaModelResponse(BaseModel):
    """One locally available model from Ollama."""
    name: str                                           # e.g. "gemma4:26b"
    size_bytes: int                                     # Raw size in bytes
    size_gb: float                                      # Size in GB (rounded to 1 decimal)
    family: str                                         # Model family (e.g. "gemma4")
    parameter_size: str                                 # e.g. "26B"
    quantization: str                                   # e.g. "Q4_K_M"
    modified_at: str                                    # ISO timestamp


class RecommendedModel(BaseModel):
    """A model we recommend to users based on their hardware."""
    name: str                                           # Ollama model name for pull
    display_name: str                                   # User-friendly name
    size_gb: float                                      # Download size in GB
    min_ram_gb: int                                     # Minimum RAM to run it
    description: str                                    # Why to choose this model
    pull_command: str                                   # Terminal command to pull it
    tier: str                                           # "minimal", "light", "recommended", "heavy"


class SetupGuideResponse(BaseModel):
    """
    Setup guide for users who need to install Ollama or pull a model.
    Gives the frontend everything it needs to show a helpful guide page.
    """
    install_url: str                                    # Platform-specific download URL
    install_note: str                                   # Brief install instruction
    models_url: str                                     # Link to Ollama model library
    recommended_models: list[RecommendedModel]          # Suggested models by tier
    pull_example: str                                   # Example pull command


class ModelSelectRequest(BaseModel):
    """Request to select which model the AI should use."""
    model: str                                          # Ollama model name
