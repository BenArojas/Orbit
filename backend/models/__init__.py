"""
Pydantic models for all request/response types in the Orbit sidecar API.

Most contracts currently serve the Parallax module; MoonMarket and Inflect
should add their contracts here as they join the shared sidecar.

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

from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Any, Literal, Optional


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
    bidSize: Optional[float] = None              # Shares/contracts bid at the best bid
    askSize: Optional[float] = None              # Shares/contracts offered at the best ask
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
#  Orbit integration: This is the shared instrument lookup table.
#  Parallax writes to it (via market search/conid resolution).
#  MoonMarket and Inflect read from it to resolve conid → symbol.
# ═══════════════════════════════════════════════════════════════


class InstrumentResponse(BaseModel):
    """
    A cached instrument from the local instruments table.
    conid is the universal key across the entire Orbit.
    """
    conid: int                   # IBKR's unique contract ID — the universal key
    symbol: str                  # Ticker (AAPL, SPY, QQQ)
    company_name: str = ""       # Full company name
    sec_type: str = "STK"        # STK, ETF, OPT, FUT, etc.
    cached_at: str = ""          # When this was last refreshed from IBKR


# ═══════════════════════════════════════════════════════════════
#  MoonMarket Portfolio
# ═══════════════════════════════════════════════════════════════


class MoonMarketAccount(BaseModel):
    """One IBKR account available to MoonMarket."""
    account_id: str
    label: str
    selected: bool = False
    is_paper: bool = False


class MoonMarketAccountsResponse(BaseModel):
    """Response from GET /moonmarket/accounts."""
    accounts: list[MoonMarketAccount]
    selected_account_id: Optional[str] = None


TradingSafetyAction = Literal["place", "reply", "cancel", "modify"]
TradingSafetyMode = Literal["paper_allowed", "live_confirmation_required", "rejected"]


class TradingSafetyConfirmation(BaseModel):
    """Confirmation copy for an order action safety decision."""
    required: bool
    title: Optional[str] = None
    message: Optional[str] = None
    confirm_label: Optional[str] = None


class TradingSafetyDecision(BaseModel):
    """Trading Safety policy decision for one account action."""
    account_id: str
    action: TradingSafetyAction
    allowed: bool
    mode: TradingSafetyMode
    confirmation: TradingSafetyConfirmation

    @model_validator(mode="after")
    def _mode_and_confirmation_align(self) -> "TradingSafetyDecision":
        if self.mode == "rejected":
            if self.allowed:
                raise ValueError("rejected decisions must not be allowed")
        elif self.mode == "live_confirmation_required":
            if not self.allowed:
                raise ValueError("live_confirmation_required decisions must be allowed")
            if not self.confirmation.required:
                raise ValueError("live_confirmation_required decisions need confirmation.required")
            if not self.confirmation.message or not self.confirmation.confirm_label:
                raise ValueError(
                    "live_confirmation_required decisions need confirmation message and confirm_label"
                )
        elif self.mode == "paper_allowed":
            if not self.allowed:
                raise ValueError("paper_allowed decisions must be allowed")
            if self.confirmation.required:
                raise ValueError("paper_allowed decisions must not require confirmation")
        return self


class MoonMarketAccountFunds(BaseModel):
    """Normalized buying-power / cash snapshot for one account."""
    account_id: str
    buying_power: Optional[float] = None
    available_funds: Optional[float] = None
    cash: Optional[float] = None
    currency: str = "USD"


class MoonMarketPosition(BaseModel):
    """One normalized portfolio position keyed by IBKR conid."""
    conid: int
    symbol: str
    description: str = ""
    # Full IBKR contract descriptor for options (e.g.
    # "ORCL NOV2026 270 C [ORCL 261120C00270000 100]"). Only populated for
    # OPT positions; lets the frontend render strike/expiry/right.
    contract_desc: Optional[str] = None
    asset_class: str = ""
    quantity: float = 0.0
    last_price: Optional[float] = None
    average_cost: Optional[float] = None
    market_value: float = 0.0
    unrealized_pnl: float = 0.0
    daily_pnl: Optional[float] = None
    pnl_percent: Optional[float] = None
    daily_pnl_percent: Optional[float] = None
    currency: str = "USD"


class MoonMarketAllocationItem(BaseModel):
    """One chart allocation row derived from a position."""
    conid: int
    symbol: str
    label: str
    # Full IBKR contract descriptor for options, mirrored from the position so
    # charts can render the strike/expiry/right without a second lookup.
    contract_desc: Optional[str] = None
    value: float
    percent: float
    asset_class: str = ""
    unrealized_pnl: float = 0.0
    daily_pnl: Optional[float] = None
    pnl_percent: Optional[float] = None
    daily_pnl_percent: Optional[float] = None


class MoonMarketPortfolioResponse(BaseModel):
    """Response from GET /moonmarket/portfolio."""
    account_id: str
    total_market_value: float
    total_unrealized_pnl: float
    positions: list[MoonMarketPosition]
    allocation: list[MoonMarketAllocationItem]


class MoonMarketSeries(BaseModel):
    """A dated numeric series normalized from IBKR performance payloads."""
    dates: list[str]
    values: list[float]


class MoonMarketPerformanceResponse(BaseModel):
    """Response from GET /moonmarket/performance."""
    account_id: str
    period: str
    nav: MoonMarketSeries
    cumulative_return: MoonMarketSeries
    period_return: MoonMarketSeries


class MoonMarketTrade(BaseModel):
    """One normalized execution/fill from IBKR, keyed by execution id and conid."""
    execution_id: str
    account_id: str
    conid: int
    symbol: Optional[str] = None
    description: Optional[str] = None
    side: Literal["BUY", "SELL"]
    quantity: float
    price: Optional[float] = None
    net_amount: Optional[float] = None
    commission: Optional[float] = None
    sec_type: Optional[str] = None
    trade_time: str
    trade_time_ms: Optional[int] = None


class MoonMarketTradeSummary(BaseModel):
    """Derived summary for the selected recent trade window."""
    total_trades: int
    total_volume: float
    total_commissions: float
    net_cash: float
    buy_count: int
    sell_count: int


class MoonMarketTradesResponse(BaseModel):
    """Response from GET /moonmarket/trades."""
    account_id: str
    days: int
    trades: list[MoonMarketTrade]
    summary: MoonMarketTradeSummary


class MoonMarketLiveOrder(BaseModel):
    """One normalized read-only live order row from IBKR."""
    order_id: str
    conid: Optional[int] = None
    symbol: Optional[str] = None
    description: Optional[str] = None
    side: str
    order_type: Optional[str] = None
    quantity: Optional[float] = None
    remaining_quantity: Optional[float] = None
    limit_price: Optional[float] = None
    aux_price: Optional[float] = None
    trailing_type: Optional[str] = None
    trailing_amt: Optional[float] = None
    outside_rth: bool = False
    tif: Optional[str] = None
    status: Optional[str] = None


class MoonMarketLiveOrdersResponse(BaseModel):
    """Response from GET /moonmarket/live-orders."""
    account_id: str
    orders: list[MoonMarketLiveOrder]


class MoonMarketPositionsRevalidateResponse(BaseModel):
    """Response from POST /moonmarket/accounts/{account_id}/positions/revalidate."""
    account_id: str
    positions: list[dict[str, Any]]


class MoonMarketOrderRulesResponse(BaseModel):
    """Raw IBKR contract order rules scoped to an account, conid, and side."""
    account_id: str
    conid: int
    side: Literal["BUY", "SELL"]
    rules: dict[str, Any]


OptionRight = Literal["C", "P"]
OptionType = Literal["call", "put"]


class MoonMarketOptionContract(BaseModel):
    """One option contract returned by MoonMarket's lazy chain loader."""
    contract_id: int = Field(alias="contractId")
    underlying_conid: int = Field(alias="underlyingConid")
    expiration: str
    strike: float
    right: OptionRight
    type: OptionType
    symbol: str = ""
    last_price: Optional[float] = Field(default=None, alias="lastPrice")
    bid: Optional[float] = None
    ask: Optional[float] = None
    volume: Optional[float] = None
    delta: Optional[float] = None
    bid_size: Optional[float] = Field(default=None, alias="bidSize")
    ask_size: Optional[float] = Field(default=None, alias="askSize")

    model_config = ConfigDict(populate_by_name=True)


class MoonMarketOptionExpirationsResponse(BaseModel):
    """Available option expirations for one underlying conid."""
    underlying_conid: int
    symbol: str
    expirations: list[str]


class MoonMarketOptionChainResponse(BaseModel):
    """Strike skeleton for one underlying and expiration."""
    underlying_conid: int
    expiration: str
    all_strikes: list[float]
    chain: dict[str, dict[str, MoonMarketOptionContract]] = Field(default_factory=dict)


class MoonMarketSingleOptionStrikeResponse(BaseModel):
    """Lazy-loaded call/put contracts for one strike."""
    strike: float
    data: dict[str, MoonMarketOptionContract]


class MoonMarketOptionWindowResponse(BaseModel):
    """Batch of call/put contract pairs for a strike window, loaded in one request.

    The frontend fires one window request for the auto-load strike window instead
    of one request per strike. ``strikes`` is keyed by the strike formatted as
    ``"%.2f"`` so the client can match preloaded pairs back to its strike rows.
    """
    underlying_conid: int
    expiration: str
    strikes: dict[str, dict[str, MoonMarketOptionContract]] = Field(default_factory=dict)


OrderSide = Literal["BUY", "SELL"]
OrderType = Literal["MKT", "LMT", "STP", "STP_LIMIT", "TRAIL", "TRAILLMT"]
TimeInForce = Literal["DAY", "GTC", "IOC"]
OrderAssetClass = Literal["STK", "OPT"]
TrailingType = Literal["amt", "%"]


class MoonMarketOrderDraft(BaseModel):
    """One normalized order request accepted by Orbit."""
    conid: int
    asset_class: OrderAssetClass = Field(default="STK", alias="assetClass")
    side: OrderSide
    quantity: float = Field(gt=0)
    order_type: OrderType = Field(alias="orderType")
    tif: TimeInForce = "DAY"
    price: Optional[float] = Field(default=None, gt=0)
    aux_price: Optional[float] = Field(default=None, alias="auxPrice", gt=0)
    trailing_type: Optional[TrailingType] = Field(default=None, alias="trailingType")
    trailing_amt: Optional[float] = Field(default=None, alias="trailingAmt", gt=0)
    outside_rth: bool = Field(default=False, alias="outsideRTH")
    client_order_id: Optional[str] = Field(default=None, alias="cOID")
    parent_id: Optional[str] = Field(default=None, alias="parentId")
    is_single_group: bool = Field(default=False, alias="isSingleGroup")

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _validate_trailing(self) -> "MoonMarketOrderDraft":
        if self.order_type in ("TRAIL", "TRAILLMT"):
            if self.tif == "IOC":
                raise ValueError("Trailing orders require DAY or GTC time-in-force")
            if self.trailing_amt is None or self.trailing_type is None:
                raise ValueError("Trailing orders require trailingAmt and trailingType")
            if self.order_type == "TRAILLMT" and self.price is None:
                raise ValueError("TRAILLMT orders require a limit price")
            if self.order_type == "TRAILLMT" and self.aux_price is None:
                raise ValueError("TRAILLMT orders require auxPrice")
        if self.order_type == "STP" and self.aux_price is None and self.price is None:
            raise ValueError("STP orders require a stop price (auxPrice)")
        if self.order_type == "STP_LIMIT":
            if self.price is None:
                raise ValueError("STP_LIMIT orders require a limit price")
            if self.aux_price is None:
                raise ValueError("STP_LIMIT orders require a stop price (auxPrice)")
        return self


class MoonMarketOrderPreviewRequest(BaseModel):
    """Request body for POST /moonmarket/orders/preview."""
    account_id: str
    order: MoonMarketOrderDraft


class MoonMarketOrdersRequest(BaseModel):
    """Request body for POST /moonmarket/orders."""
    account_id: str
    orders: list[MoonMarketOrderDraft] = Field(min_length=1, max_length=3)


class MoonMarketOrderReplyRequest(BaseModel):
    """Request body for POST /moonmarket/orders/{account_id}/reply/{reply_id}."""
    confirmed: bool


class MoonMarketOrderActionResponse(BaseModel):
    """Normalized wrapper around an IBKR order mutation response."""
    account_id: str
    result: dict[str, object] | list[dict[str, object]]


# ═══════════════════════════════════════════════════════════════
#  Trigger Rules
# ═══════════════════════════════════════════════════════════════


class TriggerConditionPayload(BaseModel):
    """A single condition inside a multi-condition rule."""
    indicator: str
    condition: Literal["above", "below", "crosses_above", "crosses_below", "fires"]
    threshold: Optional[float] = None
    news_candle_method: Optional[Literal["volume_spike", "range_spike", "gap", "long_wick"]] = None

    @model_validator(mode="after")
    def _validate_news_candle(self) -> "TriggerConditionPayload":
        if self.indicator == "news_candle":
            if self.news_candle_method is None:
                raise ValueError("news_candle_method required for news_candle indicator")
            if self.condition != "fires":
                raise ValueError("news_candle condition must be 'fires'")
        return self


class TriggerRuleCreate(BaseModel):
    """Create a new multi-condition trigger rule."""
    name: str
    watchlist_name: Optional[str] = None
    conid: Optional[int] = None
    symbol: Optional[str] = None
    template_id: Optional[int] = None
    ibkr_mirror_target: Optional[str] = None
    timeframe: str = "1D"
    scan_interval_seconds: int = 300
    enabled: bool = True
    conditions: list[TriggerConditionPayload]

    @model_validator(mode="after")
    def _validate_scope_and_conditions(self) -> "TriggerRuleCreate":
        if self.watchlist_name is None and self.conid is None:
            raise ValueError("Rule must have either watchlist_name or conid")
        if not self.conditions:
            raise ValueError("Rule must have at least one condition")
        return self


class TriggerRuleUpdate(BaseModel):
    """Partial update — fields not sent stay as-is."""
    name: Optional[str] = None
    enabled: Optional[bool] = None
    timeframe: Optional[str] = None
    scan_interval_seconds: Optional[int] = None
    watchlist_name: Optional[str] = None
    conid: Optional[int] = None
    symbol: Optional[str] = None
    ibkr_mirror_target: Optional[str] = None
    conditions: Optional[list[TriggerConditionPayload]] = None


class TriggerRuleResponse(BaseModel):
    """A trigger rule as returned by the API, with conditions inlined."""
    id: int
    name: str
    enabled: bool
    timeframe: str
    scan_interval_seconds: int
    watchlist_name: Optional[str] = None
    conid: Optional[int] = None
    symbol: Optional[str] = None
    template_id: Optional[int] = None
    ibkr_mirror_target: Optional[str] = None
    conditions: list[TriggerConditionPayload]
    created_at: str
    updated_at: str


class TriggerConditionValue(BaseModel):
    """One condition's measured value at fire time."""
    indicator: str
    condition: str
    threshold: Optional[float] = None
    actual_value: float
    news_candle_method: Optional[str] = None


class TriggerHitResponse(BaseModel):
    id: int
    rule_id: int
    rule_name: Optional[str] = None
    conid: int
    symbol: str
    triggered_at: str
    watchlist_name: Optional[str] = None
    condition_values: list[TriggerConditionValue]
    dismissed_at: Optional[str] = None
    snoozed_until: Optional[str] = None
    # IBKR mirror tracking (populated only when ibkr_mirror_target was set)
    source_watchlist: Optional[str] = None
    target_watchlist: Optional[str] = None
    moved_back: bool = False
    expires_at: Optional[str] = None


class RuleTemplateResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    category: str
    is_builtin: bool
    default_timeframe: str
    conditions: list[TriggerConditionPayload]
    created_at: str


class RuleTemplateCreate(BaseModel):
    """Save a custom template (is_builtin always 0)."""
    name: str
    description: Optional[str] = None
    category: str = "custom"
    default_timeframe: str = "1D"
    conditions: list[TriggerConditionPayload]


class SnoozeHitRequest(BaseModel):
    duration_minutes: int = Field(gt=0, description="Minutes from now to suppress this hit")


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

    conid:     IBKR's unique ID for the stock
    timeframe: Frontend timeframe string — the router maps this to a
               canonical (period, bar) pair via TIMEFRAME_SPEC.
               Valid values: "1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"
    indicators: Which indicators to compute — use their short names:
               "rsi", "macd", "ema_9", "ema_21", "ema_50", "ema_200",
               "bbands", "vwap", "atr", "stoch", "obv", "adx",
               "volume", "fibonacci"

    Deprecated:
    period:    Legacy period string ("3M", "1Y", etc.). Kept for backwards
               compatibility — new callers must use `timeframe` instead.
               Ignored when `timeframe` is provided.
    """
    conid: int
    timeframe: Literal["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"] = "1D"
    indicators: list[str] = Field(
        default=["rsi", "macd", "ema_50", "ema_200"],
        description="List of indicator names to compute",
    )
    # Deprecated — kept for backwards compat, remove in next release
    period: Optional[str] = None
    # Optional override for the IBKR history fetch window.
    # When set, overrides the period from TIMEFRAME_SPEC while keeping the bar size.
    # Accepts the same labels as the frontend 'defaultPeriod' setting:
    # '1M', '3M', '6M', '1Y', '2Y', '5Y'.
    history_period: Optional[str] = None


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
    A single Fibonacci level (retracement OR extension).

    Levels are horizontal lines on a chart at specific percentages of a
    swing range. Traders watch them for reactions (bounces, rejections,
    breakouts).

    Retracement levels used in Parallax: 0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0.
    The 0.618 / 0.65 / 0.716 band is the "golden pocket" — the primary
    reaction zone for most setups. 0.236 and 0.786 are intentionally NOT
    rendered — they are not part of Ofek's methodology.

    Extension levels: 1.272, 1.414, 1.5, 1.618, 1.786, 2, 2.618, 3, 3.618, 4, 4.618.
    """
    level: float              # Ratio (e.g., 0.618, 1.618)
    price: float              # Actual price at this level
    label: str                # Display label (e.g., "0.618", "Golden Pocket")
    kind: str                 # "retracement" or "extension"
    golden_pocket: bool = False  # True for 0.618 / 0.65 / 0.716


class FibonacciCandidate(BaseModel):
    """
    A swing candidate the algorithm considered.

    The top-scoring candidate becomes the active fib; lower-scoring
    candidates are returned for transparency (so the LLM and the user
    can see what else was in play).

    `status` indicates whether the swing is currently tradeable:
      - "active"     — current price is still inside the swing range
                       (with INSIDE_TOLERANCE band). Eligible to become
                       the primary fib.
      - "played_out" — price has decisively moved beyond the 1.0
                       boundary (target side). Useful historical context,
                       not an entry candidate.
      - "broken"     — price has decisively moved beyond the 0 boundary
                       (invalidation side). The swing is invalidated.
    """
    swing_high: float
    swing_low: float
    swing_high_time: int
    swing_low_time: int
    direction: str                # "up" or "down"
    score: float                  # 0-100 composite confidence
    swing_clarity: float          # 0-1 — clean V-shape vs choppy
    multi_touch_count: int        # touches of golden pocket levels after swing
    rejection_intensity: float    # 0-1 — max reaction strength at fib levels
    stretched_penalty: float      # 0-1 — 0=far from price (penalized), 1=close
    recency: float                # 0-1 — 1=most recent, 0=oldest
    is_nested: bool = False       # True if entirely inside a higher-scoring candidate
    parent_index: Optional[int] = None  # Index of parent candidate if nested
    status: Literal["active", "played_out", "broken"] = "active"


class FibonacciResult(BaseModel):
    """
    Fibonacci analysis for one timeframe.

    The service auto-detects the highest-scoring swing, computes BOTH
    retracement and extension levels from it, and reports every candidate
    swing it considered along with the full scoring breakdown. The LLM
    reads this to build narrative analysis; the frontend renders the
    active fib on the chart.

    This result is fib-only — it does NOT reach into EMAs, watchlists, or
    other indicators. Cross-indicator confluence (fib sitting on an EMA,
    watchlist framing) happens in the AI prompt layer, not here.
    """
    tool_mode: str = "retracement"  # "retracement" or "extension" (which is primary)
    swing_high: float
    swing_low: float
    swing_high_time: int            # Unix timestamp (seconds)
    swing_low_time: int             # Unix timestamp (seconds)
    direction: str                  # "up" (low→high) or "down" (high→low)
    levels: list[FibonacciLevel]         # Retracement levels
    extensions: list[FibonacciLevel]     # Extension levels
    score: float                    # 0-100 confidence of the active swing
    swing_clarity: float            # 0-1
    timeframe_clarity: str          # "clean" or "choppy"
    candidates: list[FibonacciCandidate]  # All considered swings (sorted by score desc)
    convergence_zones: list[dict] = []    # Cross-TF fib-to-fib convergences (populated post-hoc)
    is_nested: bool = False         # Active fib is nested inside a larger parent
    parent_fib_id: Optional[str] = None   # Future hook for locked-parent linking
    reasoning: str                  # Human-readable explanation for the LLM
    source: str = "auto"            # "auto", "manual", or "locked"

    # When no candidate is currently inside any detected swing (with
    # INSIDE_TOLERANCE band), `no_active_fib` is True. In that state the
    # swing/levels fields carry placeholder values (typically copied from
    # the highest-scored historical candidate) and MUST NOT be rendered as
    # an authoritative fib on the chart. The Candidates panel still gets
    # populated so the user can pick a historical swing to study.
    no_active_fib: bool = False
    no_active_fib_reason: Optional[str] = None


class FibonacciSnapshot(BaseModel):
    """
    Snapshot of one fib currently active on the user's chart.

    This is the lightweight contract the frontend sends to the AI
    endpoint so the prompt can reflect the exact fibs the trader chose
    to keep visible, without leaking candidate-panel history.
    """
    source: Literal["auto", "manual", "locked"]
    swing_high: float
    swing_low: float
    swing_high_time: int
    swing_low_time: int
    direction: Literal["up", "down"]
    score: Optional[float] = None
    is_primary: bool = False
    timeframe: Optional[str] = None
    note: Optional[str] = None


class IndicatorComputeResponse(BaseModel):
    """
    Full response from POST /indicators/compute.

    Contains all the indicators the frontend requested, plus Fibonacci
    levels if requested. Also echoes back the candle data so the frontend
    has everything it needs in one response.
    """
    conid: int
    timeframe: str                                     # Echoed from request for cache verification
    period: str                                        # Deprecated — kept for backwards compat
    candles: list[CandleData]                          # The raw price data used
    indicators: list[IndicatorResult]                  # Computed indicator values
    fibonacci: Optional[FibonacciResult] = None        # Fibonacci levels (if requested)


# ═══════════════════════════════════════════════════════════════
#  Fibonacci Config — user-editable scoring weights (Branch 3)
# ═══════════════════════════════════════════════════════════════
#
# The Fibonacci scoring algorithm combines five weighted factors. v1
# shipped with hardcoded defaults. Branch 3 makes the weights
# user-editable so traders can emphasize the factors that matter most
# for their style. Weights are stored in the existing `settings` table
# under key="fib_weights" as a JSON blob — no new table is needed.
#
# A future v2 learning algorithm (parallax-v2-roadmap) will adjust
# these weights automatically based on subsequent price action. Until
# then they are purely user-controlled.


class FibConfig(BaseModel):
    """
    Full Fibonacci tool configuration exposed to the frontend.

    The frontend fetches this once on app mount (cached with
    staleTime: Infinity) and uses it for: rendering glossary tooltips,
    plugging weights into the score-breakdown explainer, and computing
    candidate-override level prices on the client without a round-trip.
    """
    ratios: list[float]              # Retracement ratios: [0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0]
    extension_ratios: list[float]    # Extension ratios: [1.272 ... 4.618]
    weights: dict[str, float]        # Factor name → weight. Sum is normalized to 1.0.


class UpdateFibConfigRequest(BaseModel):
    """
    PUT /fibonacci/config body — currently only the weights are
    user-editable. Ratios are fixed (Ofek's methodology) and not exposed
    to user editing.

    Validation happens server-side (in the router/db layer):
      - Each weight must be 0 ≤ w ≤ 1.
      - Sum must be within [0.95, 1.05] and is normalized to exactly 1.0.
      - Factor names must match the canonical set.
    Violations raise InvalidFibWeightsError → HTTP 400.
    """
    weights: dict[str, float]


# ═══════════════════════════════════════════════════════════════
#  Fibonacci Locked Drawings (Phase 4 — task 4.4)
# ═══════════════════════════════════════════════════════════════


class LockFibonacciRequest(BaseModel):
    """
    Lock a fib drawing so it persists across app restarts and shows on
    ALL timeframes (per Ofek's spec: "locked fibs show on all TFs").
    """
    conid: int
    timeframe: str                    # Timeframe this fib was drawn on
    tool_type: str = "retracement"    # "retracement" or "extension"
    swing_high_price: float
    swing_high_time: int
    swing_low_price: float
    swing_low_time: int
    direction: str                    # "up" or "down"
    user_note: Optional[str] = None   # Optional annotation


class LockedFibonacciResponse(BaseModel):
    """A locked fib drawing as returned from the DB."""
    id: int
    conid: int
    timeframe: str
    tool_type: str
    swing_high_price: float
    swing_high_time: int
    swing_low_price: float
    swing_low_time: int
    direction: str
    user_note: Optional[str] = None
    locked_at: str


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
    conid is the universal key — same as everywhere else in Orbit.
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


class WatchlistAddRequest(BaseModel):
    """Request body for adding an instrument to a watchlist by conid."""
    conid: int


class WatchlistCreateRequest(BaseModel):
    """Create a new IBKR watchlist."""
    name: str


class WatchlistMembershipResponse(BaseModel):
    """Watchlist IDs that contain the queried conid."""
    conid: int
    watchlist_ids: list[str]


# ═══════════════════════════════════════════════════════════════
#  AI Analysis (Phase 4 — tasks 4.9–4.12)
# ═══════════════════════════════════════════════════════════════


class AnalyzeRequest(BaseModel):
    """
    Request to run an AI technical analysis on a stock.

    The frontend sends this when the user clicks "Run Analysis" in the AI panel.
    It includes which timeframes and indicators to analyze.

    watchlist is optional — not every ticker comes from a watchlist.
    When present, the prompt builder adds watchlist-specific framing
    to guide the AI's analysis style (e.g., RS Leaders → trend continuation).

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
    watchlist: Optional[str] = None                     # Originating watchlist name (if any)
    indicator_priority: Optional[list[str]] = None      # Ordered list — first = most important. None = let AI decide.

    # Chart context mode — controls what raw price history (if any) is appended
    # to each timeframe section. "none" = indicator values only (default).
    # "summary" = compact recent-closes string + price action blurb (low cost).
    # "ohlcv"   = full OHLCV table for the last context_bars bars (high cost).
    # "patterns" = pre-computed candlestick pattern list (medium cost, no raw flood).
    context_mode: Literal["none", "summary", "ohlcv", "patterns"] = "none"
    context_bars: int = Field(
        default=10,
        ge=5,
        le=30,
        description="Number of bars to include when context_mode != 'none' (5–30).",
    )
    fibs: list[FibonacciSnapshot] = Field(
        default_factory=list,
        description=(
            "User's active fibs on the chart. When non-empty, these override "
            "server-side auto-detection for AI prompting."
        ),
    )


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


# ═══════════════════════════════════════════════════════════════
#  Screener (Phase 5 — tasks 5.3–5.6)
# ═══════════════════════════════════════════════════════════════


class ScannerPreset(BaseModel):
    """
    An available IBKR scanner preset the user can pick from.
    The screener UI shows these in a grouped combobox:
      - popular=True presets are always visible at the top,
      - everything else is grouped under "More screens" by `group`.
    """
    instrument: str                                     # "STK", "ETF.EQ.US", etc.
    scan_type: str                                      # "TOP_PERC_GAIN", "MOST_ACTIVE", etc.
    location: str                                       # Default location (overridable in UI)
    display_name: str                                   # Human-readable name
    category: Literal["popular", "niche"] = "popular"   # Legacy grouping (kept for back-compat)
    default_filters: list["IbkrFilterItem"] = []       # Optional preset filters
    # Optional caveat shown under the preset name in the UI (e.g. "Pre-market only")
    # so users understand why a scanner returns 0 rows outside its operating window.
    subtitle: str | None = None
    # Path B addition: which IBKR top-level instrument codes this scan_type
    # supports. Joined in from the live /iserver/scanner/params response so
    # the Location dropdown can disable markets that aren't compatible.
    instruments: list[str] = []
    # Path B addition: category key from CURATED_SCAN_TYPES (movers,
    # highs_lows, gaps, options_vol, ...). Drives section grouping under
    # "More screens" and in the Browse all scans panel.
    group: str = "movers"


class ScannerLocation(BaseModel):
    """
    One curated location option for the Location dropdown.

    Carries the IBKR `instrument` code that pairs with the location —
    sending the wrong instrument with a non-US location gives 500 "No
    matching locations defined". Source: backend/constants/scan_locations.py.
    """
    instrument: str                                     # e.g. "STOCK.HK"
    location: str                                       # e.g. "STK.HK.TSE_JPN"
    label: str                                          # e.g. "Japan"


class ScannerScanType(BaseModel):
    """
    One scan type entry for the "Browse all scans" panel.

    Sourced from IBKR's live scan_type_list (so as their catalogue grows
    we surface the additions automatically), enriched with our curated
    category bucketing. `is_curated=True` means this scan_type appears as
    a named preset in the main dropdown too — the panel marks them so the
    user can tell "ours" from "long tail".
    """
    code: str                                           # IBKR scan type code
    display_name: str                                   # IBKR's display name
    instruments: list[str]                              # Compatibility — same shape as ScannerPreset
    group: str                                          # Our category key (CATEGORY_LABELS)
    is_curated: bool = False                            # True if also in CURATED_SCAN_TYPES


class IbkrFilterItem(BaseModel):
    """
    One native IBKR scanner filter criterion.

    The code is an IBKR filter code (e.g., "marketCapAbove1e6", "minPeRatio").
    The value is always a string — IBKR scanner API expects string values.

    Examples:
      {"code": "marketCapAbove1e6", "value": "1000"}   # Market cap > $1B
      {"code": "maxPeRatio", "value": "20"}            # P/E < 20
      {"code": "minRetnOnEq", "value": "15"}           # ROE > 15%
      {"code": "changePercAbove", "value": "2"}        # Day change > 2%
    """
    code: str                                           # IBKR filter code
    value: str                                          # Filter value (string)


class ScanRequest(BaseModel):
    """
    Request to run a screener scan.

    The backend passes native IBKR filter codes directly to the scanner endpoint.
    IBKR pre-filters the results server-side — no local indicator computation needed.

    Flow:
      1. POST /iserver/scanner/run with instrument, scan_type, location, filters
      2. Batch-fetch snapshot quotes (price, chg%, volume, market cap)
      3. Return enriched rows
    """
    instrument: str = "STK"                             # Security type
    scan_type: str = "MOST_ACTIVE"                      # IBKR scanner sort/preset
    location: str = "STK.US.MAJOR"                      # Market location
    filters: list[IbkrFilterItem] = []                  # Native IBKR filter codes
    max_results: int = Field(default=200, ge=1, le=500) # Cap results
    sort_field: str = ""                                # IBKR sort code (e.g., "changePercAbove")
    sort_direction: str = "desc"                        # "asc" or "desc"
    page: int = 1                                       # Page number (1-indexed)
    page_size: int = 25                                 # Results per page


class ScreenerResultRow(BaseModel):
    """
    One row in the screener results table.
    Contains instrument info + snapshot quote data.
    """
    conid: int
    symbol: str = ""
    company_name: str = ""
    sec_type: str = ""
    last_price: Optional[float] = None
    change_percent: Optional[float] = None
    volume: Optional[float] = None
    # Note: market cap intentionally NOT part of screener rows. IBKR does not
    # expose mc reliably via /iserver/marketdata/snapshot (field 7289 is absent
    # from the official fields list). See backend/docs/ibkr_market_data_fields.md.
    # The per-contract quick-peek (ContractInfoResponse below) still carries it
    # because that endpoint fetches it from /iserver/contract/{conid}/info.

    # Path B addition: scanner-native ranking metric for this row, captured
    # from IBKR's `scan_data` field. For TOP_PERC_GAIN it's the % change
    # (redundant with change_percent), for FIRST_TRADE_DATE_ASC it's the
    # next first-trade date (the only meaningful field on those rows since
    # they haven't traded yet).
    #
    # The frontend uses scan_data as a price-column FALLBACK when last_price
    # is None — that's how IPO rows show "First Trade: 2026-05-12" instead
    # of an empty cell. See NO_QUOTE_SCAN_TYPES in services/screener.py.
    scan_data: Optional[str] = None
    scan_data_label: Optional[str] = None              # IBKR's column header e.g. "First Trade Date"


class ScanResponse(BaseModel):
    """
    Response from POST /screener/scan.
    """
    results: list[ScreenerResultRow]
    total_scanned: int                                  # How many the scanner returned
    total_matched: int                                  # Same as total_scanned (filters are native)
    scan_type: str                                      # Which preset was used
    location: str                                       # Which market was scanned
    page: int = 1                                       # Current page
    page_size: int = 25                                 # Results per page
    total_pages: int = 1                                # Total number of pages


class ScannerParamsResponse(BaseModel):
    """
    Available scanner parameters from IBKR.
    The frontend uses this to populate the preset/filter pickers.
    """
    instruments: list[dict] = []                        # Available instrument types
    locations: list[dict] = []                          # Available market locations
    scan_types: list[dict] = []                         # Available scan types
    filters: list[dict] = []                            # Available filter codes


class FilterCatalogueEntry(BaseModel):
    """
    One entry in the canonical IBKR filter catalogue exposed to the frontend.

    Mirrors `FilterEntry` in `constants/ibkr_filters.py`. The `description`
    field is served to both surfaces — Ollama (as prompt context) and the
    UI (as a `title` tooltip on the Add Filter menu items).
    """
    code: str                          # IBKR filter code, e.g. "marketCapAbove1e6"
    label: str                         # Human label, e.g. "Market Cap"
    direction: Literal["above", "below"]
    unit: Optional[str] = None         # "$M", "%", "$", or None
    example: str                       # Example value (string) for placeholders
    category: Literal["fundamental", "technical", "analyst", "short_ownership"]
    popular: bool                      # True → shown as an always-visible quick-pick chip
    description: Optional[str] = None  # Short natural-language tooltip / Ollama context
    paired_code: str = ""              # Opposite-direction code (or "" if none)


class AiFilterRequest(BaseModel):
    """Request to generate IBKR filter codes from a natural language query."""
    query: str                        # e.g. "oversold large caps with strong earnings"
    model: str                        # Ollama model name (from user's selection)
    preset_context: Optional[str] = None  # e.g. "Most Active — US Stocks" (helps AI understand universe)


class AiFilterSuggestion(BaseModel):
    """One AI-suggested filter."""
    code: str          # IBKR filter code e.g. "marketCapAbove1e6"
    value: str         # Filter value as string e.g. "10000"
    display_label: str # Human-readable e.g. "Market Cap ≥ $10B"
    reasoning: str     # Why the AI chose this filter


class AiFilterResponse(BaseModel):
    """Response from POST /screener/ai-filters."""
    filters: list[AiFilterSuggestion]
    summary: str       # One sentence summary of what the query translates to
    raw_query: str     # Echoed back for reference


class ContractInfoResponse(BaseModel):
    """Contract details from IBKR — used in screener quick-peek."""
    conid: int
    symbol: str = ""
    company_name: str = ""
    sec_type: str = ""
    exchange: str = ""
    currency: str = ""
    # IBKR `industry` = narrow sub-industry, `category` = broader sector grouping
    industry: str = ""
    category: str = ""
    sector: str = ""          # Alias for category — broader grouping shown in peek panel
    avg_volume: Optional[float] = None
    market_cap: Optional[float] = None
    high_52w: Optional[float] = None
    low_52w: Optional[float] = None
    pe_ratio: Optional[float] = None
    dividend_yield: Optional[float] = None
    # 52-week positioning (derived from history)
    w52_pct_from_high: Optional[float] = None   # % below 52W high (negative = below)
    w52_pct_from_low: Optional[float] = None    # % above 52W low (positive = above)
    w52_days_since_high: Optional[int] = None   # Calendar days since last 52W high close
    # Relative performance vs. period start close (derived from history)
    perf_5d: Optional[float] = None    # 5-day % return
    perf_1m: Optional[float] = None    # 1-month % return
    perf_3m: Optional[float] = None    # 3-month % return
    perf_ytd: Optional[float] = None   # Year-to-date % return


# ═══════════════════════════════════════════════════════════════
#  Chart Drawings  (Branch 1 of drawing-tools-plan.md)
# ═══════════════════════════════════════════════════════════════


class DrawingAnchor(BaseModel):
    """A single anchor point for a chart drawing — position in time + price space."""
    time: int    # Unix seconds (same coordinate system as LW Charts)
    price: float


class DrawingStyle(BaseModel):
    """
    Visual styling for a drawing. All fields are optional — the frontend
    applies defaults from the vendored library when fields are absent.
    """
    line_color: Optional[str] = None           # Hex color e.g. "#2962FF"
    line_width: Optional[int] = None           # 1..4 px
    line_style: Optional[Literal["solid", "dashed", "dotted"]] = None
    fill_color: Optional[str] = None           # Rectangles, position tools
    text: Optional[str] = None                 # Text annotations + trade labels


class CreateDrawingRequest(BaseModel):
    """
    POST /drawings — persist a new drawing for an instrument.

    `kind` mirrors the upstream class name lowercased + underscored:
      horizontal_line, trend_line, ray, rectangle, vertical_line,
      text, long_position, short_position, forecast, bars_pattern
    """
    conid: int
    kind: str
    anchors: list[DrawingAnchor]
    style: Optional[DrawingStyle] = None


class UpdateDrawingRequest(BaseModel):
    """
    PUT /drawings/{id} — partial update.
    Only the fields present in the request body are written; the others
    remain unchanged. (Both can be absent — a no-op update is valid.)
    """
    anchors: Optional[list[DrawingAnchor]] = None
    style: Optional[DrawingStyle] = None


class DrawingResponse(BaseModel):
    """Response shape returned by all /drawings endpoints."""
    id: int
    conid: int
    kind: str
    anchors: list[DrawingAnchor]
    style: Optional[DrawingStyle] = None
    created_at: str
    updated_at: Optional[str] = None
