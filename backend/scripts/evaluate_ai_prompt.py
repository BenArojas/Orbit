from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models import AIProviderMetadata
from services.ai_cloud_adapters import (
    AIProviderAuthError,
    AIProviderModelUnavailableError,
    AIProviderNetworkError,
    AIProviderRateLimitError,
    AIProviderRequestError,
    AIProviderTextResult,
    AIProviderTimeoutError,
    OpenRouterProvider,
)
from services.ai_keystore import AIKeyStore, AIKeyStoreUnavailableError
from services.ai_prompt_eval import PromptEvalSummary, grade_prompt_output
from services.ai_settings import AISettingsService
from services.db import DatabaseService
from services.prompt_builder import (
    build_analysis_user_message,
    build_full_prompt_context,
    build_system_prompt,
)
from tests.fixtures.ai_prompt_eval_cases import EVAL_CASES, PromptEvalCase

_MIN_REPETITIONS = 1
_MAX_REPETITIONS = 3
_INDICATOR_DISPLAY = {
    "adx": "ADX",
    "atr": "ATR",
    "bbands": "Bollinger Bands",
    "ema": "EMA Stack",
    "fibonacci": "Fibonacci Retracement",
    "macd": "MACD",
    "obv": "OBV",
    "rsi": "RSI",
    "stoch": "Stochastic",
    "volume": "Volume",
    "vwap": "VWAP",
}
_INDICATOR_ORDER = (
    "fibonacci",
    "ema",
    "rsi",
    "macd",
    "volume",
    "bbands",
    "vwap",
    "atr",
    "stoch",
    "obv",
    "adx",
)


@dataclass(frozen=True)
class RunnerSummary:
    candidate: str
    weighted_mean: float
    per_case_scores: dict[str, float]
    hard_gate_failures: int
    mean_actual_cost_usd: float
    mean_latency_ms: float
    mean_input_tokens: float
    mean_output_tokens: float
    cases_run: int

    def to_prompt_eval_summary(self) -> PromptEvalSummary:
        return PromptEvalSummary(
            candidate=self.candidate,
            weighted_mean=self.weighted_mean,
            per_case_scores=self.per_case_scores,
            hard_gate_failures=self.hard_gate_failures,
            mean_actual_cost_usd=self.mean_actual_cost_usd,
            mean_latency_ms=self.mean_latency_ms,
        )

    def model_dump_json(self) -> str:
        return json.dumps(asdict(self), sort_keys=True)

    def __str__(self) -> str:
        return self.model_dump_json()


async def run_prompt_eval(
    *,
    model: str,
    candidate: str,
    repetitions: int,
    provider: object,
    api_key: str | None = None,
) -> RunnerSummary:
    if not (_MIN_REPETITIONS <= repetitions <= _MAX_REPETITIONS):
        raise ValueError(
            f"repetitions must be between {_MIN_REPETITIONS} and {_MAX_REPETITIONS}"
        )

    del api_key  # ponytail: keep the secret out of all returned state

    per_case_scores: dict[str, float] = {}
    hard_failures = 0
    costs: list[Decimal] = []
    latencies: list[float] = []
    input_tokens: list[int] = []
    output_tokens: list[int] = []

    try:
        for case in EVAL_CASES:
            messages = _build_messages(case)
            scores: list[int] = []
            for _ in range(repetitions):
                response = await provider.chat_with_metadata(model=model, messages=messages)
                content, metadata = _unpack_response(response)
                result = grade_prompt_output(case, content)
                if not result.eligible:
                    hard_failures += 1
                scores.append(result.weighted_score)
                if metadata.actual_cost is not None:
                    costs.append(Decimal(str(metadata.actual_cost)))
                if metadata.duration_ms is not None:
                    latencies.append(float(metadata.duration_ms))
                if metadata.input_tokens is not None:
                    input_tokens.append(metadata.input_tokens)
                if metadata.output_tokens is not None:
                    output_tokens.append(metadata.output_tokens)
            per_case_scores[case.case_id] = sum(scores) / len(scores)
    finally:
        close = getattr(provider, "aclose", None)
        if close is not None:
            await close()

    return RunnerSummary(
        candidate=candidate,
        weighted_mean=(
            sum(per_case_scores.values()) / len(per_case_scores) if per_case_scores else 0.0
        ),
        per_case_scores=per_case_scores,
        hard_gate_failures=hard_failures,
        mean_actual_cost_usd=_mean_decimal(costs),
        mean_latency_ms=_mean(latencies),
        mean_input_tokens=_mean(input_tokens),
        mean_output_tokens=_mean(output_tokens),
        cases_run=len(per_case_scores),
    )


def _build_messages(case: PromptEvalCase) -> list[dict[str, str]]:
    scenario = case.candles if isinstance(case.candles, dict) else {}
    symbol = str(scenario.get("symbol") or case.case_id.upper())
    timeframe = str(scenario.get("timeframe") or "D")
    indicator_names = _indicator_names(case, scenario)
    indicators_display = [
        _INDICATOR_DISPLAY[name]
        for name in indicator_names
        if name in _INDICATOR_DISPLAY
    ]
    timeframe_data = {
        timeframe: {
            "candles": scenario.get("candles", []),
            "indicators": scenario.get("indicators", []),
            "fibs": scenario.get("fibs", []),
            "fibonacci": scenario.get("fibonacci"),
        }
    }
    context = build_full_prompt_context(
        symbol=symbol,
        timeframe_data=timeframe_data,
        indicator_priority=[],
        budget_tokens=3500,
    )
    return [
        {
            "role": "system",
            "content": build_system_prompt(
                indicators_display=indicators_display,
                indicator_names=indicator_names,
            ),
        },
        {
            "role": "user",
            "content": build_analysis_user_message(
                symbol=symbol,
                context=context,
                timeframes=[timeframe],
                indicators_requested=indicators_display,
            ),
        },
    ]


def _indicator_names(case: PromptEvalCase, scenario: dict[str, Any]) -> list[str]:
    names: set[str] = set()

    for indicator in scenario.get("indicators", []):
        raw_name = str(getattr(indicator, "name", "")).lower()
        if not raw_name:
            continue
        names.add("fibonacci" if raw_name == "fib" else raw_name)

    for fact_id in case.allowed_fact_ids:
        family = fact_id.split(".", 1)[0].lower()
        if family == "close":
            continue
        names.add("fibonacci" if family == "fib" else family)

    return [name for name in _INDICATOR_ORDER if name in names]


def _unpack_response(response: AIProviderTextResult | dict[str, Any]) -> tuple[str, AIProviderMetadata]:
    if isinstance(response, AIProviderTextResult):
        return response.content, response.metadata

    metadata = AIProviderMetadata(
        provider_name="openrouter",
        kind="cloud",
        model=None,
        actual_cost=float(response["actual_cost_usd"]) if response.get("actual_cost_usd") is not None else None,
        input_tokens=response.get("input_tokens"),
        output_tokens=response.get("output_tokens"),
        duration_ms=int(response["latency_ms"]) if response.get("latency_ms") is not None else None,
    )
    return str(response["content"]), metadata


def _mean(values: list[int] | list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _mean_decimal(values: list[Decimal]) -> float:
    return float(sum(values) / len(values)) if values else 0.0


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="HITL OpenRouter prompt evaluation")
    parser.add_argument("--model", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--repetitions", type=int, default=1)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--confirm-cost", action="store_true")
    return parser.parse_args(argv)


async def _load_live_provider() -> tuple[DatabaseService, OpenRouterProvider, str]:
    db = DatabaseService()
    await db.connect()
    settings = AISettingsService(db)
    config = next(
        (
            item
            for item in await settings.list_provider_configs()
            if item["provider_name"] == "openrouter"
        ),
        None,
    )
    if config is None or not config.get("api_key_ref"):
        await db.close()
        raise SystemExit("OpenRouter is not configured for live evaluation")

    key_store = AIKeyStore()
    api_key = await key_store.get_provider_key("openrouter", config["api_key_ref"])
    return db, OpenRouterProvider(api_key=api_key), api_key


async def _main(args: argparse.Namespace) -> None:
    if not args.live:
        raise SystemExit("Refusing to run: live evaluation requires --live")

    print(
        f"Model={args.model} cases={len(EVAL_CASES)} repetitions={args.repetitions} "
        f"max_estimated_cost_usd~=<= {len(EVAL_CASES) * args.repetitions} calls"
    )
    if not args.confirm_cost:
        answer = input("Proceed with live spend? type 'yes': ").strip().lower()
        if answer != "yes":
            raise SystemExit("Aborted before any live call")

    db, provider, api_key = await _load_live_provider()
    try:
        summary = await run_prompt_eval(
            model=args.model,
            candidate=args.candidate,
            repetitions=args.repetitions,
            provider=provider,
            api_key=api_key,
        )
    finally:
        await db.close()

    _print_report(summary)


def _print_report(summary: RunnerSummary) -> None:
    print(f"cases_run={summary.cases_run} weighted_mean={summary.weighted_mean:.1f}")
    for case_id, score in summary.per_case_scores.items():
        print(f"  {case_id}: {score:.1f}")
    print(
        f"hard_gate_failures={summary.hard_gate_failures} "
        f"mean_input_tokens={summary.mean_input_tokens:.1f} "
        f"mean_output_tokens={summary.mean_output_tokens:.1f} "
        f"mean_cost_usd={summary.mean_actual_cost_usd:.4f} "
        f"mean_latency_ms={summary.mean_latency_ms:.0f}"
    )


def main() -> None:
    args = _parse_args()
    try:
        asyncio.run(_main(args))
    except (
        AIKeyStoreUnavailableError,
        AIProviderAuthError,
        AIProviderModelUnavailableError,
        AIProviderNetworkError,
        AIProviderRateLimitError,
        AIProviderRequestError,
        AIProviderTimeoutError,
    ) as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
