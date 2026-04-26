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
import re
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


# Strips ```json ... ``` (or plain ``` ... ```) wrappers some models add
# even when given a `format` schema. Pre-compiled at import time.
_MARKDOWN_FENCE_RE = re.compile(
    r"^\s*```(?:json|JSON)?\s*\n?(.*?)\n?\s*```\s*$",
    re.DOTALL,
)


def _strip_markdown_fences(content: str) -> str:
    """
    Remove ```json ... ``` markdown wrapping from a model response.

    Some models (Gemma 4 included) ignore Ollama's `format` schema and wrap
    their structured output in markdown fences anyway. Without stripping,
    `json.loads()` dies at char 0 on the leading backtick.

    No-op when no fence is detected.
    """
    match = _MARKDOWN_FENCE_RE.match(content)
    if match:
        return match.group(1).strip()
    return content.strip()


def _build_catalogue_text() -> str:
    """
    Format the canonical filter catalogue as a concise reference table.

    One line per code. Direction is rendered as ≥ (above) or ≤ (below).
    The `description` field is appended after ` // `; dropped when None.
    """
    lines: list[str] = []
    for f in FILTER_CATALOGUE:
        arrow = "≥" if f["direction"] == "above" else "≤"
        unit = f" ({f['unit']})" if f.get("unit") else ""
        desc = f" // {f['description']}" if f.get("description") else ""
        lines.append(
            f"  {f['code']}{unit} — {f['label']} {arrow} X, "
            f"e.g. value={f['example']!r}{desc}"
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
9. Output raw JSON only — DO NOT wrap the response in markdown code fences
   (no ```json, no ```), no commentary before or after. The response must
   start with `{{` and end with `}}`.
"""


class ScreenerAiService:
    """
    Translates natural language screener queries into IBKR filter codes using Ollama.
    Stateless — no sessions needed (one-shot structured output).
    """

    def __init__(self) -> None:
        # Timeout bumped to 120s — even with think=False, structured output
        # over an ~80-filter catalogue can take 30-60s on a 26B model.
        self._http = httpx.AsyncClient(
            base_url=OLLAMA_HOST,
            timeout=httpx.Timeout(120.0, connect=10.0),
        )

    async def generate_filters(
        self,
        query: str,
        model: str,
        preset_context: str = "",
        *,
        think: bool = False,
    ) -> dict:
        """
        Translate a natural language query into IBKR filter codes.

        Args:
            query: Natural language query from the user.
            model: Ollama model tag (e.g. "gemma4:26b").
            preset_context: Optional name of the currently selected scanner preset.
            think: Whether to allow the model to use its `thinking` channel.
                Defaults to False — thinking models (Gemma 4, Qwen3) burn tokens
                on chain-of-thought before producing the structured JSON, which
                blew past the httpx timeout in production. The screener UX wants
                fast structured output, not reasoning. The Analysis chat keeps
                thinking on (passes think=None / True there).

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
            "think": think,
            "format": AI_FILTER_SCHEMA,
            "options": {
                "temperature": 0.2,
                # 2048 leaves room for full structured output (filters + reasoning
                # + summary) even on the largest catalogue. With think=False the
                # model uses very few tokens before emitting JSON.
                "num_predict": 2048,
            },
        }

        try:
            resp = await self._http.post("/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            message = data.get("message", {}) or {}
            content = message.get("content", "")
            done_reason = data.get("done_reason", "")

            # Truncation guard — Ollama returns done_reason="length" when
            # num_predict is exhausted. Content is usually empty or partial JSON
            # in that case; surface it as a clear, typed error rather than a
            # cryptic JSONDecodeError.
            if done_reason == "length":
                log.warning(
                    "Ollama truncated response (done_reason=length, "
                    "content_len=%d, model=%s)",
                    len(content), model,
                )
                raise AIError(
                    "AI response was truncated before completing — "
                    "try a simpler query or a smaller model."
                )

            # Empty-content guard — happens when a thinking model put everything
            # into `thinking` and ran out of room before emitting `content`.
            # Without think=False this is the most common failure mode.
            if not content.strip():
                thinking_len = len(message.get("thinking", "") or "")
                log.warning(
                    "Ollama returned empty content (thinking_len=%d, "
                    "done_reason=%s, model=%s, think=%s)",
                    thinking_len, done_reason, model, think,
                )
                raise AIError(
                    "AI returned empty response — the model may be in "
                    "thinking mode without leaving room for output."
                )

            # Diagnostic log — capture exactly what Ollama returned so when
            # json.loads fails we can see whether it was non-JSON text
            # (model ignored the format schema) vs malformed JSON.
            log.info(
                "Ollama response (model=%s, think=%s, done_reason=%s, "
                "content_len=%d, content_preview=%r)",
                model, think, done_reason, len(content), content[:300],
            )

            # Strip ```json ... ``` wrappers some models add despite the
            # `format` schema. No-op when content is already raw JSON.
            cleaned = _strip_markdown_fences(content)
            if cleaned != content.strip():
                log.info(
                    "Stripped markdown fences from Ollama response "
                    "(original_len=%d, cleaned_len=%d)",
                    len(content), len(cleaned),
                )

            result = json.loads(cleaned)

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
