"""
Canonical IBKR scanner FILTER_CATALOGUE — single source of truth.

Every `code` in this file has been grep-verified against the raw
`/iserver/scanner/params` dump IBKR returns. Never add a code that does
not appear in that dump — IBKR silently ignores unknown codes, which
causes filters to appear to "work" while returning unfiltered rows.

This catalogue drives both:
  - The Ollama AI prompt (backend/services/screener_ai.py imports from here)
  - The screener filter bar UI (frontend fetches via GET /screener/filter-catalogue)

Schema per entry:
  code          — IBKR filter code (verified present in scanner/params)
  label         — human-readable label shown in UI
  direction     — "above" or "below" (which bound of a range this code is)
  unit          — "$M", "%", "$", or None
  example       — example numeric value (string) for Ollama prompts
  category      — "fundamental" | "technical" | "analyst" | "short_ownership"
  popular       — True  → shown as an always-visible quick-pick chip
  notes         — short natural-language description (sent to Ollama only)
  paired_code   — the opposite-direction IBKR code for this filter
                  ("" when no opposite exists, e.g. volumeAbove has no volumeBelow)
"""

from typing import Literal, TypedDict


class FilterEntry(TypedDict):
    code: str
    label: str
    direction: Literal["above", "below"]
    unit: str | None
    example: str
    category: Literal["fundamental", "technical", "analyst", "short_ownership"]
    popular: bool
    notes: str | None
    paired_code: str


# ── Fundamental ─────────────────────────────────────────────
FUNDAMENTAL: list[FilterEntry] = [
    # Market Cap
    {
        "code": "marketCapAbove1e6",
        "label": "Market Cap",
        "direction": "above",
        "unit": "$M",
        "example": "1000",
        "category": "fundamental",
        "popular": True,
        "notes": "Market capitalization in millions. 10000 = $10B (large cap), 2000 = $2B (mid cap), 300 = $300M (small cap).",
        "paired_code": "marketCapBelow1e6",
    },
    {
        "code": "marketCapBelow1e6",
        "label": "Market Cap",
        "direction": "below",
        "unit": "$M",
        "example": "10000",
        "category": "fundamental",
        "popular": False,
        "notes": "Market capitalization ceiling in millions.",
        "paired_code": "marketCapAbove1e6",
    },
    # P/E Ratio
    {
        "code": "minPeRatio",
        "label": "P/E Ratio",
        "direction": "above",
        "unit": None,
        "example": "10",
        "category": "fundamental",
        "popular": True,
        "notes": "Trailing P/E lower bound. Value investors often use ≤ 15.",
        "paired_code": "maxPeRatio",
    },
    {
        "code": "maxPeRatio",
        "label": "P/E Ratio",
        "direction": "below",
        "unit": None,
        "example": "15",
        "category": "fundamental",
        "popular": False,
        "notes": "Trailing P/E upper bound. Use ≤ 15 to find value stocks.",
        "paired_code": "minPeRatio",
    },
    # ROE
    {
        "code": "minRetnOnEq",
        "label": "ROE",
        "direction": "above",
        "unit": "%",
        "example": "15",
        "category": "fundamental",
        "popular": False,
        "notes": "Return on Equity %. 15+ indicates efficient capital use.",
        "paired_code": "maxRetnOnEq",
    },
    {
        "code": "maxRetnOnEq",
        "label": "ROE",
        "direction": "below",
        "unit": "%",
        "example": "50",
        "category": "fundamental",
        "popular": False,
        "notes": "Return on Equity upper bound.",
        "paired_code": "minRetnOnEq",
    },
    # Operating Margin TTM
    {
        "code": "operatingMarginTTMAbove",
        "label": "Operating Margin TTM",
        "direction": "above",
        "unit": "%",
        "example": "15",
        "category": "fundamental",
        "popular": False,
        "notes": "Operating margin trailing 12 months %. 15+ is healthy.",
        "paired_code": "operatingMarginTTMBelow",
    },
    {
        "code": "operatingMarginTTMBelow",
        "label": "Operating Margin TTM",
        "direction": "below",
        "unit": "%",
        "example": "40",
        "category": "fundamental",
        "popular": False,
        "notes": "Operating margin TTM upper bound.",
        "paired_code": "operatingMarginTTMAbove",
    },
    # Net Margin TTM
    {
        "code": "netProfitMarginTTMAbove",
        "label": "Net Margin TTM",
        "direction": "above",
        "unit": "%",
        "example": "10",
        "category": "fundamental",
        "popular": False,
        "notes": "Net profit margin TTM %. 10+ is good for most industries.",
        "paired_code": "netProfitMarginTTMBelow",
    },
    {
        "code": "netProfitMarginTTMBelow",
        "label": "Net Margin TTM",
        "direction": "below",
        "unit": "%",
        "example": "30",
        "category": "fundamental",
        "popular": False,
        "notes": "Net margin TTM upper bound.",
        "paired_code": "netProfitMarginTTMAbove",
    },
    # Revenue Chg TTM
    {
        "code": "revChangeAbove",
        "label": "Revenue Chg TTM",
        "direction": "above",
        "unit": "%",
        "example": "15",
        "category": "fundamental",
        "popular": False,
        "notes": "Revenue growth TTM %. 15+ indicates rapid growth.",
        "paired_code": "revChangeBelow",
    },
    {
        "code": "revChangeBelow",
        "label": "Revenue Chg TTM",
        "direction": "below",
        "unit": "%",
        "example": "50",
        "category": "fundamental",
        "popular": False,
        "notes": "Revenue growth TTM upper bound.",
        "paired_code": "revChangeAbove",
    },
    # Revenue Growth 5Y
    {
        "code": "revGrowthRate5YAbove",
        "label": "Revenue Growth 5Y",
        "direction": "above",
        "unit": "%",
        "example": "10",
        "category": "fundamental",
        "popular": False,
        "notes": "5-year revenue CAGR %. Secular growth signal.",
        "paired_code": "revGrowthRate5YBelow",
    },
    {
        "code": "revGrowthRate5YBelow",
        "label": "Revenue Growth 5Y",
        "direction": "below",
        "unit": "%",
        "example": "40",
        "category": "fundamental",
        "popular": False,
        "notes": "5-year revenue CAGR upper bound.",
        "paired_code": "revGrowthRate5YAbove",
    },
    # EPS Chg TTM
    {
        "code": "epsChangeTTMAbove",
        "label": "EPS Chg TTM",
        "direction": "above",
        "unit": "%",
        "example": "15",
        "category": "fundamental",
        "popular": False,
        "notes": "EPS growth TTM %. Pair with revenue growth for quality growth.",
        "paired_code": "epsChangeTTMBelow",
    },
    {
        "code": "epsChangeTTMBelow",
        "label": "EPS Chg TTM",
        "direction": "below",
        "unit": "%",
        "example": "100",
        "category": "fundamental",
        "popular": False,
        "notes": "EPS growth TTM upper bound.",
        "paired_code": "epsChangeTTMAbove",
    },
    # Price/Book
    {
        "code": "minPrice2Bk",
        "label": "Price/Book",
        "direction": "above",
        "unit": None,
        "example": "1",
        "category": "fundamental",
        "popular": False,
        "notes": "Price-to-book ratio lower bound.",
        "paired_code": "maxPrice2Bk",
    },
    {
        "code": "maxPrice2Bk",
        "label": "Price/Book",
        "direction": "below",
        "unit": None,
        "example": "2",
        "category": "fundamental",
        "popular": False,
        "notes": "Price-to-book ratio upper bound. ≤ 2 is classic value territory.",
        "paired_code": "minPrice2Bk",
    },
    # Quick Ratio
    {
        "code": "minQuickRatio",
        "label": "Quick Ratio",
        "direction": "above",
        "unit": None,
        "example": "1",
        "category": "fundamental",
        "popular": False,
        "notes": "Quick ratio lower bound. ≥ 1 = can cover short-term liabilities.",
        "paired_code": "maxQuickRatio",
    },
    {
        "code": "maxQuickRatio",
        "label": "Quick Ratio",
        "direction": "below",
        "unit": None,
        "example": "5",
        "category": "fundamental",
        "popular": False,
        "notes": "Quick ratio upper bound.",
        "paired_code": "minQuickRatio",
    },
]


# ── Technical ───────────────────────────────────────────────
TECHNICAL: list[FilterEntry] = [
    # Price
    {
        "code": "priceAbove",
        "label": "Price",
        "direction": "above",
        "unit": "$",
        "example": "10",
        "category": "technical",
        "popular": True,
        "notes": "Last trade price lower bound. Filters out penny stocks.",
        "paired_code": "priceBelow",
    },
    {
        "code": "priceBelow",
        "label": "Price",
        "direction": "below",
        "unit": "$",
        "example": "500",
        "category": "technical",
        "popular": False,
        "notes": "Last trade price upper bound.",
        "paired_code": "priceAbove",
    },
    # Day Change %
    {
        "code": "changePercAbove",
        "label": "Day Change %",
        "direction": "above",
        "unit": "%",
        "example": "2",
        "category": "technical",
        "popular": True,
        "notes": "Today's % change lower bound. Positive = gainers.",
        "paired_code": "changePercBelow",
    },
    {
        "code": "changePercBelow",
        "label": "Day Change %",
        "direction": "below",
        "unit": "%",
        "example": "-2",
        "category": "technical",
        "popular": False,
        "notes": "Today's % change upper bound. Negative value → losers.",
        "paired_code": "changePercAbove",
    },
    # Volume (above only — IBKR has no volumeBelow)
    {
        "code": "volumeAbove",
        "label": "Volume",
        "direction": "above",
        "unit": None,
        "example": "1000000",
        "category": "technical",
        "popular": True,
        "notes": "Today's share volume lower bound. 1M = liquid; 5M = very liquid.",
        "paired_code": "",
    },
    # Price vs EMA(20)
    {
        "code": "lastVsEMAChangeRatio20Above",
        "label": "Price vs EMA(20)",
        "direction": "above",
        "unit": "%",
        "example": "5",
        "category": "technical",
        "popular": False,
        "notes": "Last price vs 20-day EMA %. Positive = price above EMA20; ≥ 5 often flags overbought.",
        "paired_code": "lastVsEMAChangeRatio20Below",
    },
    {
        "code": "lastVsEMAChangeRatio20Below",
        "label": "Price vs EMA(20)",
        "direction": "below",
        "unit": "%",
        "example": "-5",
        "category": "technical",
        "popular": False,
        "notes": "Last price vs 20-day EMA %. ≤ -5 often flags oversold.",
        "paired_code": "lastVsEMAChangeRatio20Above",
    },
    # Price vs EMA(50)
    {
        "code": "lastVsEMAChangeRatio50Above",
        "label": "Price vs EMA(50)",
        "direction": "above",
        "unit": "%",
        "example": "0",
        "category": "technical",
        "popular": False,
        "notes": "Last price vs 50-day EMA %. Above 0 = intermediate-term uptrend.",
        "paired_code": "lastVsEMAChangeRatio50Below",
    },
    {
        "code": "lastVsEMAChangeRatio50Below",
        "label": "Price vs EMA(50)",
        "direction": "below",
        "unit": "%",
        "example": "0",
        "category": "technical",
        "popular": False,
        "notes": "Last price vs 50-day EMA %. Below 0 = intermediate-term downtrend.",
        "paired_code": "lastVsEMAChangeRatio50Above",
    },
    # Price vs EMA(100)
    {
        "code": "lastVsEMAChangeRatio100Above",
        "label": "Price vs EMA(100)",
        "direction": "above",
        "unit": "%",
        "example": "0",
        "category": "technical",
        "popular": False,
        "notes": "Last price vs 100-day EMA %.",
        "paired_code": "lastVsEMAChangeRatio100Below",
    },
    {
        "code": "lastVsEMAChangeRatio100Below",
        "label": "Price vs EMA(100)",
        "direction": "below",
        "unit": "%",
        "example": "0",
        "category": "technical",
        "popular": False,
        "notes": "Last price vs 100-day EMA %.",
        "paired_code": "lastVsEMAChangeRatio100Above",
    },
    # Price vs EMA(200)
    {
        "code": "lastVsEMAChangeRatio200Above",
        "label": "Price vs EMA(200)",
        "direction": "above",
        "unit": "%",
        "example": "0",
        "category": "technical",
        "popular": False,
        "notes": "Last price vs 200-day EMA %. Above 0 = long-term uptrend.",
        "paired_code": "lastVsEMAChangeRatio200Below",
    },
    {
        "code": "lastVsEMAChangeRatio200Below",
        "label": "Price vs EMA(200)",
        "direction": "below",
        "unit": "%",
        "example": "0",
        "category": "technical",
        "popular": False,
        "notes": "Last price vs 200-day EMA %. Below 0 = long-term downtrend.",
        "paired_code": "lastVsEMAChangeRatio200Above",
    },
    # MACD Histogram
    {
        "code": "curMACDDistAbove",
        "label": "MACD Histogram",
        "direction": "above",
        "unit": None,
        "example": "0",
        "category": "technical",
        "popular": False,
        "notes": "Current MACD histogram value. Above 0 = bullish momentum.",
        "paired_code": "curMACDDistBelow",
    },
    {
        "code": "curMACDDistBelow",
        "label": "MACD Histogram",
        "direction": "below",
        "unit": None,
        "example": "0",
        "category": "technical",
        "popular": False,
        "notes": "Current MACD histogram value. Below 0 = bearish momentum.",
        "paired_code": "curMACDDistAbove",
    },
    # IV Rank 52W
    {
        "code": "ivRank52wAbove",
        "label": "IV Rank 52W",
        "direction": "above",
        "unit": "%",
        "example": "70",
        "category": "technical",
        "popular": False,
        "notes": "Implied-vol rank over 52 weeks. 70+ = IV rich (good for option sellers).",
        "paired_code": "ivRank52wBelow",
    },
    {
        "code": "ivRank52wBelow",
        "label": "IV Rank 52W",
        "direction": "below",
        "unit": "%",
        "example": "30",
        "category": "technical",
        "popular": False,
        "notes": "Implied-vol rank over 52 weeks. 30- = IV cheap (good for option buyers).",
        "paired_code": "ivRank52wAbove",
    },
]


# ── Analyst ─────────────────────────────────────────────────
ANALYST: list[FilterEntry] = [
    {
        "code": "avgRatingAbove",
        "label": "Avg Rating",
        "direction": "above",
        "unit": None,
        "example": "3",
        "category": "analyst",
        "popular": False,
        "notes": "Average analyst rating lower bound. Scale: 1=Strong Buy, 5=Strong Sell.",
        "paired_code": "avgRatingBelow",
    },
    {
        "code": "avgRatingBelow",
        "label": "Avg Rating",
        "direction": "below",
        "unit": None,
        "example": "2",
        "category": "analyst",
        "popular": False,
        "notes": "Average analyst rating upper bound. ≤ 2 ≈ Buy consensus.",
        "paired_code": "avgRatingAbove",
    },
    {
        "code": "numRatingsAbove",
        "label": "# Analyst Ratings",
        "direction": "above",
        "unit": None,
        "example": "5",
        "category": "analyst",
        "popular": False,
        "notes": "Minimum analyst coverage. Higher = more credible consensus.",
        "paired_code": "numRatingsBelow",
    },
    {
        "code": "numRatingsBelow",
        "label": "# Analyst Ratings",
        "direction": "below",
        "unit": None,
        "example": "40",
        "category": "analyst",
        "popular": False,
        "notes": "Maximum analyst coverage.",
        "paired_code": "numRatingsAbove",
    },
    {
        "code": "avgPriceTargetAbove",
        "label": "Avg Price Target",
        "direction": "above",
        "unit": "$",
        "example": "50",
        "category": "analyst",
        "popular": False,
        "notes": "Average analyst price target lower bound ($).",
        "paired_code": "avgPriceTargetBelow",
    },
    {
        "code": "avgPriceTargetBelow",
        "label": "Avg Price Target",
        "direction": "below",
        "unit": "$",
        "example": "500",
        "category": "analyst",
        "popular": False,
        "notes": "Average analyst price target upper bound ($).",
        "paired_code": "avgPriceTargetAbove",
    },
    {
        "code": "avgAnalystTarget2PriceRatioAbove",
        "label": "Target / Price Ratio",
        "direction": "above",
        "unit": None,
        "example": "1.1",
        "category": "analyst",
        "popular": False,
        "notes": "Analyst target ÷ current price. > 1 means analysts expect upside.",
        "paired_code": "avgAnalystTarget2PriceRatioBelow",
    },
    {
        "code": "avgAnalystTarget2PriceRatioBelow",
        "label": "Target / Price Ratio",
        "direction": "below",
        "unit": None,
        "example": "1",
        "category": "analyst",
        "popular": False,
        "notes": "Analyst target ÷ current price. < 1 = priced above consensus.",
        "paired_code": "avgAnalystTarget2PriceRatioAbove",
    },
]


# ── Short Interest & Ownership ──────────────────────────────
# Coverage may be sparse on some mid/small-caps — IBKR returns null,
# which the scanner treats as non-matching. UI should label accordingly.
SHORT_OWNERSHIP: list[FilterEntry] = [
    {
        "code": "utilizationAbove",
        "label": "Short Utilization",
        "direction": "above",
        "unit": "%",
        "example": "90",
        "category": "short_ownership",
        "popular": False,
        "notes": "% of shortable inventory currently borrowed. 90+ = extremely tight borrow, squeeze candidate.",
        "paired_code": "utilizationBelow",
    },
    {
        "code": "utilizationBelow",
        "label": "Short Utilization",
        "direction": "below",
        "unit": "%",
        "example": "50",
        "category": "short_ownership",
        "popular": False,
        "notes": "Short utilization upper bound.",
        "paired_code": "utilizationAbove",
    },
    {
        "code": "feeRateAbove",
        "label": "Borrow Fee Rate",
        "direction": "above",
        "unit": "%",
        "example": "10",
        "category": "short_ownership",
        "popular": False,
        "notes": "Annualized fee to borrow the stock %. 10+ = expensive to short (squeeze signal).",
        "paired_code": "feeRateBelow",
    },
    {
        "code": "feeRateBelow",
        "label": "Borrow Fee Rate",
        "direction": "below",
        "unit": "%",
        "example": "5",
        "category": "short_ownership",
        "popular": False,
        "notes": "Borrow fee rate upper bound.",
        "paired_code": "feeRateAbove",
    },
    {
        "code": "ihInsiderOfFloatPercAbove",
        "label": "Insider % of Float",
        "direction": "above",
        "unit": "%",
        "example": "10",
        "category": "short_ownership",
        "popular": False,
        "notes": "Insider holdings as % of float. May be unavailable on some instruments.",
        "paired_code": "ihInsiderOfFloatPercBelow",
    },
    {
        "code": "ihInsiderOfFloatPercBelow",
        "label": "Insider % of Float",
        "direction": "below",
        "unit": "%",
        "example": "50",
        "category": "short_ownership",
        "popular": False,
        "notes": "Insider holdings upper bound.",
        "paired_code": "ihInsiderOfFloatPercAbove",
    },
    {
        "code": "iiInstitutionalOfFloatPercAbove",
        "label": "Institutional % of Float",
        "direction": "above",
        "unit": "%",
        "example": "70",
        "category": "short_ownership",
        "popular": False,
        "notes": "Institutional holdings as % of float. High = heavy smart-money presence.",
        "paired_code": "iiInstitutionalOfFloatPercBelow",
    },
    {
        "code": "iiInstitutionalOfFloatPercBelow",
        "label": "Institutional % of Float",
        "direction": "below",
        "unit": "%",
        "example": "30",
        "category": "short_ownership",
        "popular": False,
        "notes": "Institutional holdings upper bound.",
        "paired_code": "iiInstitutionalOfFloatPercAbove",
    },
]


# ── Canonical catalogue (concatenation order is stable; UI groups by `category`) ──
FILTER_CATALOGUE: list[FilterEntry] = (
    FUNDAMENTAL + TECHNICAL + ANALYST + SHORT_OWNERSHIP
)

# Fast membership test — used by screener_ai.py to drop unknown codes.
FILTER_CODES: frozenset[str] = frozenset(f["code"] for f in FILTER_CATALOGUE)
