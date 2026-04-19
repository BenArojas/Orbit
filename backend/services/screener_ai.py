"""
Screener AI service — translates natural language queries into IBKR filter codes.

Flow:
  1. User types "oversold large caps with high earnings growth"
  2. We build a prompt with the curated IBKR filter catalogue
  3. Ollama returns structured JSON: [{code, value, display_label, reasoning}]
  4. Frontend wires filters into the filter bar

Uses Ollama's structured output (format parameter) for guaranteed valid JSON.

The filter catalogue is imported from `constants.ibkr_filters` — the single
source of truth. Every code in that file has been grep-verified against
the raw IBKR `/iserver/scanner/params` dump.
"""

import json
import logging
from typing import Any

import httpx

from config import OLLAMA_HOST
from constants.ibkr_filters import FILTER_CATALOGUE, FILTER_CODES
from exceptions import AIError

log = logging.getLogger("parallax.screener_ai")

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
    """
    Format the canonical filter catalogue as a concise reference table.

    One line per code. Direction is rendered as ≥ (above) or ≤ (below).
    Ollama-only `notes` are appended after ` // `; dropped when None.
    """
    lines: list[str] = []
    for f in FILTER_CATALOGUE:
        arrow = "≥" if f["direction"] == "above" else "≤"
        unit = f" ({f['unit']})" if f.get("unit") else ""
        notes = f" // {f['notes']}" if f.get("notes") else ""
        lines.append(
            f"  {f['code']}{unit} — {f['label']} {arrow} X, "
            f"e.g. value={f['example']!r}{notes}"
        )
    return "\n".join(lines)


SYSTEM_PROMPT = f"""You are a stock screener assistant for a professional trading application.
Your job is to translate a user's natural language query into IBKR scanner filter codes.

## Available Filter Codes

{_build_catalogue_text()}

## Rules

1. Only use filter codes from the list above — never invent new codes.
2. Values must be strings (the API expects strings, not numbers).
3. Choose 2–6 filters that best capture the user's intent. Don't over-filter.
4. For ambiguous terms, use these sensible trading defaults (every code below is
   a valid IBKR scanner filter):
   - "large cap"           → marketCapAbove1e6 ≥ 10000 ($10B)
   - "mid cap"             → marketCapAbove1e6 ≥ 2000 AND marketCapBelow1e6 ≤ 10000
   - "small cap"           → marketCapAbove1e6 ≥ 300  AND marketCapBelow1e6 ≤ 2000
   - "oversold"            → lastVsEMAChangeRatio20Below ≤ -5
   - "overbought"          → lastVsEMAChangeRatio20Above ≥ 5
   - "momentum"            → changePercAbove ≥ 2 AND volumeAbove ≥ 1000000
   - "value"               → maxPeRatio ≤ 15 AND maxPrice2Bk ≤ 2
   - "growth"              → revChangeAbove ≥ 15 AND epsChangeTTMAbove ≥ 15
   - "high volume"         → volumeAbove ≥ 2000000
   - "high IV"             → ivRank52wAbove ≥ 70
   - "short squeeze"       → utilizationAbove ≥ 90 AND feeRateAbove ≥ 10
   - "institutional"       → iiInstitutionalOfFloatPercAbove ≥ 60
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

            # Validate: only keep filters with codes that exist in our catalogue.
            # FILTER_CODES is a frozenset built from the canonical catalogue
            # (constants/ibkr_filters.py) — single source of truth.
            suggested = result.get("filters", [])
            validated_filters = [
                f for f in suggested if f.get("code") in FILTER_CODES
            ]

            dropped_codes = [
                f.get("code", "<missing>")
                for f in suggested
                if f.get("code") not in FILTER_CODES
            ]
            if dropped_codes:
                log.warning(
                    "AI suggested %d/%d filter(s) with unknown codes — dropped: %s",
                    len(dropped_codes),
                    len(suggested),
                    ", ".join(dropped_codes),
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
