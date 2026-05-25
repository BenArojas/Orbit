# models.py
import logging
from pydantic import BaseModel, ConfigDict, Field
from typing import Dict, Any, List, Literal, Optional
from pydantic.alias_generators import to_camel

log = logging.getLogger("models")  # dedicate a channel for WS payloads

# =============================================================================
#  Core Infrastructure & Generic Models
# =============================================================================
class AuthStatusDTO(BaseModel):
    authenticated: bool
    websocket_ready: bool
    message: str
    
class AuthStatus(BaseModel):
    authenticated: bool
    session_active: Optional[bool] = None
    session_id_short: Optional[str] = None
    user_id: Optional[str] = None
    iserver_status: Optional[Dict[str, Any]] = None
    websocket_ready: Optional[bool] = None  # True if IBKR WS connection is active
    message: Optional[str] = None
    error: Optional[str] = None

class WebSocketRequest(BaseModel):
    action: str  # e.g., "subscribe_stock", "unsubscribe_stock", "subscribe_portfolio"
    conid: Optional[int] = None
    account_id: Optional[str] = None

# =============================================================================
#  Frontend WebSocket Message Models (Server -> Client)
# =============================================================================

class FrontendMessageBase(BaseModel):
    """Base class for all messages sent to the frontend WebSocket."""
    type: str

class FrontendMarketDataUpdate(FrontendMessageBase):
    type: str = "market_data"

    # ── identifiers ───────────────────────────────────────────────
    conid: int
    symbol: str

    # ── dynamic prices ────────────────────────────────────────────
    last_price: float
    daily_change_percent: Optional[float] = None
    daily_change_amount: Optional[float] = None

    # ── static / optional position data ───────────────────────────
    quantity: Optional[float] = None
    avg_bought_price: Optional[float] = None
    value: Optional[float] = None
    unrealized_pnl: Optional[float] = None

    # ----------------------------------------------------------------
    @classmethod
    def from_position_row(cls, row: dict) -> "FrontendMarketDataUpdate":
        """
        Build a *snapshot* object from the IBKR /portfolio/positions row.
        This fills all optional fields so the front end starts fully hydrated.
        """
        return cls(
            conid=row["conid"],
            symbol=row["fullName"],
            last_price=row["mktPrice"],
            quantity=row["position"],
            avg_bought_price=row["avgPrice"],
            value=row["mktValue"],
            unrealized_pnl=row["unrealizedPnl"],
        )

class FrontendAccountSummaryUpdate(FrontendMessageBase):
    type: str = "account_summary"
    data: Dict[str, Any]  # Matches your frontend's expectation

class WatchlistMessage(FrontendMessageBase):
    type: str = "watchlists"
    data: Dict[str, Any]

class LedgerUpdate(FrontendMessageBase):
    type: str = "ledger"
    data: "LedgerDTO" # Forward reference to LedgerDTO defined later

class PnlRow(BaseModel):
    rowType: int
    dpl: float  # daily realised
    nl: float   # net liquidity
    upl: float  # unrealised
    uel: float  # excess liquidity (un-rounded)
    mv: float   # margin value

class PnlUpdate(FrontendMessageBase):
    type: Literal["pnl"]
    data: Dict[str, PnlRow]  # keyed by "U1234567.Core"


# =============================================================================
#  Account & Portfolio DTOs (Data Transfer Objects from IBKR)
# =============================================================================

# --- Account Details & Permissions ---
class OwnerInfoDTO(BaseModel):
    userName: str
    entityName: str
    roleId: str

class AccountInfoDTO(BaseModel):
    accountId: str
    accountTitle: str
    accountType: str
    tradingType: str
    baseCurrency: str
    ibEntity: str
    clearingStatus: str
    isPaper: bool

class PermissionsDTO(BaseModel):
    allowFXConv: bool
    allowCrypto: bool
    allowEventTrading: bool
    supportsFractions: bool

class AccountDetailsDTO(BaseModel):
    owner: OwnerInfoDTO
    account: AccountInfoDTO
    permissions: PermissionsDTO

class BriefAccountInfoDTO(BaseModel):
    accountId: str
    accountTitle: str
    displayName: str

class AccountPermissions(BaseModel):
    canTrade: bool
    allowOptionsTrading: bool
    allowCryptoTrading: bool
    isMarginAccount: bool
    supportsFractions: bool

# --- Account Summary & Ledger ---
class AccountSummaryData(BaseModel):
    # Define specific fields you expect from IBKR summary, e.g.,
    net_liquidation: Optional[float] = None
    total_cash_value: Optional[float] = None
    buying_power: Optional[float] = None
    # Allow dynamic fields from IBKR
    additional_details: Dict[str, Any] = {}

class LedgerEntry(BaseModel):
    model_config = ConfigDict(extra='ignore')
    secondkey: str
    cashbalance: float = Field(default=0.0)
    settledcash: float = Field(default=0.0)
    unrealizedpnl: float = Field(default=0.0)
    dividends: float = Field(default=0.0)
    exchangerate: float = Field(default=1.0)
    currency: Optional[str] = None

class LedgerDTO(BaseModel):
    baseCurrency: str
    ledgers: List[LedgerEntry]

# --- Portfolio Allocation ---
class _LongShort(BaseModel):
    long: Dict[str, float]   # {"STK": 12345.67, "OPT": 9876.00}
    short: Dict[str, float]  # ditto (may be empty)

class AllocationDTO(BaseModel):
    assetClass: _LongShort
    sector: _LongShort
    group: _LongShort

# --- Combo Positions ---
class ComboLegDTO(BaseModel):
    conid: int
    ratio: int

class ComboPositionLegDTO(BaseModel):
    acctId: str
    conid: int
    contractDesc: str
    position: float
    mktPrice: float
    mktValue: float
    currency: str
    avgCost: float
    avgPrice: float
    realizedPnl: float
    unrealizedPnl: float
    assetClass: str

class ComboDTO(BaseModel):
    name: str
    description: str
    legs: List[ComboLegDTO]
    positions: List[ComboPositionLegDTO]

# =============================================================================
#  Market Data & Instrument Models
# =============================================================================

# --- Generic Instrument & Quote Models ---
class SearchResult(BaseModel):
    conid: int
    symbol: Optional[str] = None
    companyName: Optional[str] = None
    secType: Optional[str] = None

class StaticInfo(BaseModel):
    conid: int
    ticker: str
    companyName: str
    exchange: Optional[str] = None
    secType: Optional[str] = None
    currency: Optional[str] = None

class QuoteInfo(BaseModel):
    lastPrice: Optional[float] = None
    bid: Optional[float] = None
    ask: Optional[float] = None
    changePercent: Optional[float] = None
    changeAmount: Optional[float] = None
    dayHigh: Optional[float] = None
    dayLow: Optional[float] = None

class PositionInfo(BaseModel):
    position: float
    avgCost: float
    unrealizedPnl: float
    mktValue: float
    name: Optional[str] = None
    daysToExpire: Optional[int] = None

class StockDetailsResponse(BaseModel):
    staticInfo: StaticInfo
    quote: QuoteInfo
    positionInfo: Optional[PositionInfo] = None
    optionPositions: Optional[List[PositionInfo]] = None

# --- Charting ---
class ChartDataPoint(BaseModel):
    time: int  # UNIX timestamp in seconds
    value: float

class ChartDataBars(BaseModel):
    time: int  # UNIX timestamp in seconds
    open: float
    volume: float
    high: float
    low: float
    close: float

# --- Options Chain ---
class ConidResponse(BaseModel):
    conid: int
    companyName: str

class OptionsChainResponse(BaseModel):
    expirations: Dict[str, List[float]]  # e.g., {"AUG25": [150.0, 155.0, ...]}

class OptionContract(BaseModel):
    contractId: int
    strike: float
    type: Literal["call", "put"]
    lastPrice: Optional[float] = None
    bid: Optional[float] = None
    ask: Optional[float] = None
    volume: Optional[float] = None
    delta: Optional[float] = None
    bidSize: Optional[float] = None
    askSize: Optional[float] = None

class FullChainResponse(BaseModel):
    # e.g., { "60.0": { "call": OptionContract, "put": OptionContract } }
    chain: Dict[str, Dict[str, Optional[OptionContract]]]

class FilteredChainResponse(BaseModel):
    all_strikes: List[float]
    chain: Dict[str, Any]  # The chain data is now a partial map

class SingleContractResponse(BaseModel):
    strike: float
    data: Dict[str, Optional[OptionContract]]
    
# --- Scanner ---

class ScannerFilter(BaseModel):
    code: str
    value: float

class ScannerRequest(BaseModel):
    instrument: str
    type: str
    location: str
    filter: Optional[List[ScannerFilter]] = []

class ScannerResponse(BaseModel):
    contracts: List[Dict[str, Any]]
    scan_data_column_name: Optional[str] = None

class ScannerParamsResponse(BaseModel):
    scan_type_list: List[Dict[str, Any]]
    instrument_list: List[Dict[str, Any]]
    filter_list: List[Dict[str, Any]]
    location_tree: List[Dict[str, Any]]
    
# --- Watchlist ---

class Instrument(BaseModel):
    ticker: str
    conid: int | str
    name: str | None = None
    assetClass: str | None = None

class WatchlistDetail(BaseModel):
    id: str
    name: str
    instruments: List[Instrument]
    
class HistoricalReq(BaseModel):
    tickers: List[str] = Field(..., min_items=1)
    sec_types: Dict[str, str] | None = None 
    timeRange: Literal['1D', '7D', '1M', '3M', '6M', '1Y']

class HistoricalPoint(BaseModel):
    date: int     # unix seconds
    price: float

class StockHistorical(BaseModel):
    ticker: str
    historical: List[HistoricalPoint]
# =============================================================================
#  API Action & External Service Models
# =============================================================================

# --- Order Placement ---
class Order(BaseModel):
    conid: int
    orderType: str
    side: Literal["BUY", "SELL"]
    quantity: float
    tif: str = "DAY"
    price: Optional[float] = None
    auxPrice: float | None = None
    cOID: str | None = None
    parentId: str | None = None
    isSingleGroup: bool | None = None

# --- Sentiment Analysis ---
class TweetInfo(BaseModel):
    url: str
    text: str
    score: float
    likes: int
    retweets: int

class SentimentResponse(BaseModel):
    sentiment: str
    score: float
    score_label: str
    tweets_analyzed: int
    top_positive_tweet: TweetInfo | None
    top_negative_tweet: TweetInfo | None