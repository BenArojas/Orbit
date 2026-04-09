"""
Screener AI service — translates natural language queries into IBKR filter codes.

Flow:
  1. User types "oversold large caps with high earnings growth"
  2. We build a prompt with the curated IBKR filter catalogue
  3. Ollama returns structured JSON: [{code, value, display_label, reasoning}]
  4. Frontend wires filters into the filter bar

Uses Ollama's structured output (format parameter) for guaranteed valid JSON.
"""

import json
import logging
from typing import Any

import httpx

from config import OLLAMA_HOST
from exceptions import AIError

log = logging.getLogger("parallax.screener_ai")

# ── Curated filter catalogue ──────────────────────────────────
# Subset of IBKR filter codes we surface in the UI.
# Each entry includes the code, human label, example value, and unit.
# This is embedded in the AI prompt so the model knows what's available.

FILTER_CATALOGUE = [
    # Fundamental
    {"code": "marketCapAbove1e6", "label": "Market Cap ≥ X ($M)", "example": "10000", "unit": "$M", "notes": "Large cap = 10000+, Mid = 2000-10000, Small = 300-2000, Micro < 300"},
    {"code": "marketCapBelow1e6", "label": "Market Cap ≤ X ($M)", "example": "2000", "unit": "$M"},
    {"code": "minPeRatio", "label": "P/E ≥ X", "example": "10"},
    {"code": "maxPeRatio", "label": "P/E ≤ X", "example": "25", "notes": "Value stocks typically < 15, growth > 30"},
    {"code": "minROE", "label": "ROE ≥ X (%)", "example": "15"},
    {"code": "maxROE", "label": "ROE ≤ X (%)", "example": "50"},
    {"code": "minOperatingMargin", "label": "Operating Margin ≥ X (%)", "example": "10"},
    {"code": "maxOperatingMargin", "label": "Operating Margin ≤ X (%)", "example": "50"},
    {"code": "minNetMargin", "label": "Net Margin ≥ X (%)", "example": "5"},
    {"code": "maxNetMargin", "label": "Net Margin ≤ X (%)", "example": "30"},
    {"code": "minRevenueChangePercentTTM", "label": "Revenue Growth TTM ≥ X (%)", "example": "10", "notes": "Strong growth > 20%"},
    {"code": "maxRevenueChangePercentTTM", "label": "Revenue Growth TTM ≤ X (%)", "example": "5"},
    {"code": "minRevenuePctChange5Y", "label": "Revenue Growth 5Y ≥ X (%)", "example": "10"},
    {"code": "minEpsChangePercent", "label": "EPS Growth TTM ≥ X (%)", "example": "10", "notes": "Strong = 20%+"},
    {"code": "maxEpsChangePercent", "label": "EPS Growth TTM ≤ X (%)", "example": "-10", "notes": "Negative for declining earnings"},
    {"code": "minPriceBook", "label": "Price/Book ≥ X", "example": "1"},
    {"code": "maxPriceBook", "label": "Price/Book ≤ X", "example": "3", "notes": "Value < 1, growth stocks often > 5"},
    {"code": "minQuickRatio", "label": "Quick Ratio ≥ X", "example": "1", "notes": "Healthy = 1+"},
    {"code": "maxQuickRatio", "label": "Quick Ratio ≤ X", "example": "0.5"},
    {"code": "wshEarningsDate", "label": "Earnings within X days", "example": "5", "notes": "WSH calendar — stocks with upcoming earnings"},
    # Technical
    {"code": "priceAbove", "label": "Price ≥ $X", "example": "5", "notes": "Penny stocks < $1, institutional quality > $5"},
    {"code": "priceBelow", "label": "Price ≤ $X", "example": "100"},
    {"code": "changePercAbove", "label": "Day Change ≥ X (%)", "example": "3", "notes": "Big movers > 5%"},
    {"code": "changePercBelow", "label": "Day Change ≤ X (%)", "example": "-3", "notes": "Big losers < -5%"},
    {"code": "volumeAbove", "label": "Volume ≥ X", "example": "1000000"},
    {"code": "volumeBelow", "label": "Volume ≤ X", "example": "500000"},
    {"code": "priceVsEMA20Above", "label": "Price vs EMA(20) ≥ X (%)", "example": "0", "notes": "Above EMA = bullish, 0 = at EMA"},
    {"code": "priceVsEMA20Below", "label": "Price vs EMA(20) ≤ X (%)", "example": "0", "notes": "Below EMA = bearish"},
    {"code": "priceVsEMA50Above", "label": "Price vs EMA(50) ≥ X (%)", "example": "0"},
    {"code": "priceVsEMA50Below", "label": "Price vs EMA(50) ≤ X (%)", "example": "0"},
    {"code": "priceVsEMA200Above", "label": "Price vs EMA(200) ≥ X (%)", "example": "0", "notes": "Long-term uptrend"},
    {"code": "priceVsEMA200Below", "label": "Price vs EMA(200) ≤ X (%)", "example": "0", "notes": "Long-term downtrend"},
    {"code": "macdHistAbove", "label": "MACD Histogram ≥ X", "example": "0", "notes": "Positive histogram = bullish momentum"},
    {"code": "macdHistBelow", "label": "MACD Histogram ≤ X", "example": "0"},
    {"code": "ivRankAbove", "label": "IV Rank 52W ≥ X (%)", "example": "50", "notes": "High IV = options expensive, potential mean reversion"},
    {"code": "ivRankBelow", "label": "IV Rank 52W ≤ X (%)", "example": "30", "notes": "Low IV = cheap options"},
    # Analyst
    {"code": "avgRatingAbove", "label": "Analyst Rating ≥ X (1=Strong Buy, 5=Strong Sell)", "example": "2"},
    {"code": "avgRatingBelow", "label": "Analyst Rating ≤ X", "example": "2.5"},
    {"code": "numRatingsAbove", "label": "# Analyst Ratings ≥ X", "example": "5"},
    {"code": "avgTargetPriceAbove", "label": "Avg Price Target ≥ $X", "example": "50"},
    {"code": "targetPriceRatioAbove", "label": "Target/Current Price ≥ X", "example": "1.1", "notes": "1.2 means analysts expect 20% upside"},
    {"code": "targetPriceRatioBelow", "label": "Target/Current Price ≤ X", "example": "0.9"},
    # Short Interest
    {"code": "shortableSharesAbove", "label": "Short Utilization ≥ X (%)", "example": "50"},
    {"code": "shortableSharesBelow", "label": "Short Utilization ≤ X (%)", "example": "20"},
    {"code": "rebateRateAbove", "label": "Borrow Fee Rate ≥ X (%)", "example": "1"},
    {"code": "insiderOwnershipAbove", "label": "Insider Ownership ≥ X (%)", "example": "10"},
    {"code": "insiderOwnershipBelow", "label": "Insider Ownership ≤ X (%)", "example": "5"},
    {"code": "institutionalOwnershipAbove", "label": "Institutional Ownership ≥ X (%)", "example": "50"},
    {"code": "institutionalOwnershipBelow", "label": "Institutional Ownership ≤ X (%)", "example": "20"},
]

# JSON schema for structured Ollama output
AI_FILTER_SCHEMA = {
    "type": "object",
    "properties": {
        "reasoning": {
            "type": "string",
            "description": "Chain of thought: how you interpreted the query and selected filters"
        },
        "filters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "value": {"type": "string"},
                    "display_label": {"type": "string"},
                    "reasoning": {"type": "string"}
                },
                "required": ["code", "value", "display_label", "reasoning"]
            }
        },
        "summary": {
            "type": "string",
            "description": "One sentence summary of the filter set"
        }
    },
    "required": ["reasoning", "filters", "summary"]
}


def _build_catalogue_text() -> str:
    """Format the filter catalogue as a concise reference table for the prompt."""
    lines = []
    for f in FILTER_CATALOGUE:
        notes = f" // {f['notes']}" if f.get("notes") else ""
        unit = f" ({f['unit']})" if f.get("unit") else ""
        lines.append(f"  {f['code']}{unit} — {f['label']}, e.g. value={f['example']!r}{notes}")
    return "\n".join(lines)


SYSTEM_PROMPT = f"""You are a stock screener assistant for a professional trading application.
Your job is to translate a user's natural language query into IBKR scanner filter codes.

## Available Filter Codes

{_build_catalogue_text()}

## Rules

1. Only use filter codes from the list above — never invent new codes.
2. Values must be strings (the API expects strings, not numbers).
3. Choose 2–6 filters that best capture the user's intent. Don't over-filter.
4. For ambiguous terms, use sensible trading defaults:
   - "large cap" → marketCapAbove1e6 ≥ 10000 ($10B)
   - "mid cap" → marketCapAbove1e6 ≥ 2000, marketCapBelow1e6 ≤ 10000
   - "small cap" → marketCapAbove1e6 ≥ 300, marketCapBelow1e6 ≤ 2000
   - "oversold" → priceVsEMA20Below ≤ -5 (price more than 5% below 20 EMA)
   - "overbought" → priceVsEMA20Above ≥ 5
   - "momentum" → changePercAbove ≥ 2 AND volumeAbove ≥ 1000000
   - "value" → maxPeRatio ≤ 15 AND maxPriceBook ≤ 2
   - "growth" → minRevenueChangePercentTTM ≥ 15 AND minEpsChangePercent ≥ 15
   - "high volume" → volumeAbove ≥ 2000000
   - "institutional interest" → institutionalOwnershipAbove ≥ 60
5. display_label must be human-readable, e.g. "Market Cap ≥ $10B", "P/E ≤ 15".
6. reasoning per filter should be 1 sentence explaining why you chose that code + value.
7. summary should be one sentence describing the overall filter set.
8. If the query cannot be mapped to any filters, return an empty filters array and explain in summary.
"""


class ScreenerAiService:
    """
    Translates natural language screener queries into IBKR filter codes using Ollama.
    Stateless — no sessions needed (one-shot structured output).
    """

    def __init__(self) -> None:
        self._http = httpx.AsyncClient(
            base_url=OLLAMA_HOST,
            timeout=httpx.Timeout(60.0, connect=10.0),
        )

    async def generate_filters(
        self,
        query: str,
        model: str,
        preset_context: str = "",
    ) -> dict:
        """
        Translate a natural language query into IBKR filter codes.

        Returns a dict matching AiFilterResponse shape:
        {
            "filters": [{"code", "value", "display_label", "reasoning"}, ...],
            "summary": "...",
            "raw_query": "..."
        }
        """
        user_content = f'Screener query: "{query}"'
        if preset_context:
            user_content += f'\nCurrent scanner preset: {preset_context}'

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "format": AI_FILTER_SCHEMA,
            "options": {
                "temperature": 0.2,
                "num_predict": 1024,
            },
        }

        try:
            resp = await self._http.post("/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data.get("message", {}).get("content", "")

            result = json.loads(content)

            # Validate: only keep filters with codes that exist in our catalogue
            valid_codes = {f["code"] for f in FILTER_CATALOGUE}
            validated_filters = [
                f for f in result.get("filters", [])
                if f.get("code") in valid_codes
            ]

            if len(validated_filters) < len(result.get("filters", [])):
                dropped = len(result.get("filters", [])) - len(validated_filters)
                log.warning(
                    "AI suggested %d filter(s) with unknown codes — dropped",
                    dropped,
                )

            return {
                "filters": validated_filters,
                "summary": result.get("summary", ""),
                "raw_query": query,
            }

        except httpx.ConnectError as exc:
            raise AIError("Cannot connect to Ollama server") from exc
        except httpx.TimeoutException as exc:
            raise AIError("Ollama request timed out") from exc
        except httpx.HTTPStatusError as exc:
            raise AIError(
                f"Ollama returned error: {exc.response.status_code}"
            ) from exc
        except (json.JSONDecodeError, KeyError, ValueError) as exc:
            raise AIError(f"AI returned invalid response: {exc}") from exc

    async def shutdown(self) -> None:
        await self._http.aclose()
