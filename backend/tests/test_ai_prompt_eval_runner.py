from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest

from models import AIProviderMetadata
from services.ai_cloud_adapters import AIProviderTextResult

FAKE_KEY = "sk-or-fake-secret-value"


class FakeProvider:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.closed = False

    async def chat_with_metadata(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
    ) -> AIProviderTextResult:
        self.calls.append({"model": model, "messages": messages})
        return AIProviderTextResult(
            content=(
                '{"direction":"NEUTRAL","confidence":20,'
                '"description":"Insufficient evidence [D.bbands.percent_b_0_20]; single verified fact.",'
                '"entry":{"price":null,"source_fact_id":null,"note":"No grounded level"},'
                '"stop":{"price":null,"source_fact_id":null,"note":"No grounded level"},'
                '"target":{"price":null,"source_fact_id":null,"note":"No grounded level"},'
                '"confirmations":[],"cautions":["Single verified fact","Insufficient evidence"],'
                '"meta":{"risk_reward":null,"score":"2/10","adx_trend":null,"volume_signal":null}}'
            ),
            metadata=AIProviderMetadata(
                provider_name="openrouter",
                kind="cloud",
                model=model,
                actual_cost=float(Decimal("0.0010")),
                input_tokens=500,
                output_tokens=100,
                duration_ms=800,
            ),
            provider_request_id="req_test",
        )

    async def aclose(self) -> None:
        self.closed = True


class MissingTelemetryProvider(FakeProvider):
    async def chat_with_metadata(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
    ) -> AIProviderTextResult:
        await asyncio.sleep(0.01)
        self.calls.append({"model": model, "messages": messages})
        return AIProviderTextResult(
            content=(
                '{"direction":"NEUTRAL","confidence":20,'
                '"description":"Insufficient evidence [D.bbands.percent_b_0_20]; single verified fact.",'
                '"entry":{"price":null,"source_fact_id":null,"note":"No grounded level"},'
                '"stop":{"price":null,"source_fact_id":null,"note":"No grounded level"},'
                '"target":{"price":null,"source_fact_id":null,"note":"No grounded level"},'
                '"confirmations":[],"cautions":["Single verified fact","Insufficient evidence"],'
                '"meta":{"risk_reward":null,"score":"2/10","adx_trend":null,"volume_signal":null}}'
            ),
            metadata=AIProviderMetadata(
                provider_name="openrouter",
                kind="cloud",
                model=model,
                actual_cost=None,
                input_tokens=500,
                output_tokens=100,
                duration_ms=None,
            ),
            provider_request_id="req_missing",
        )


@pytest.mark.asyncio
async def test_runner_executes_all_cases_offline():
    from scripts.evaluate_ai_prompt import run_prompt_eval

    provider = FakeProvider()

    summary = await run_prompt_eval(
        model="z-ai/glm-5.2",
        candidate="baseline",
        repetitions=1,
        provider=provider,
    )

    assert summary.cases_run == 6
    assert len(provider.calls) == 6
    assert provider.closed is True


@pytest.mark.asyncio
async def test_runner_never_leaks_api_key():
    from scripts.evaluate_ai_prompt import run_prompt_eval

    provider = FakeProvider()

    summary = await run_prompt_eval(
        model="z-ai/glm-5.2",
        candidate="baseline",
        repetitions=1,
        provider=provider,
        api_key=FAKE_KEY,
    )

    assert FAKE_KEY not in summary.model_dump_json()
    assert FAKE_KEY not in str(summary)


@pytest.mark.asyncio
async def test_runner_uses_wall_clock_latency_and_preserves_missing_cost():
    from scripts.evaluate_ai_prompt import run_prompt_eval

    provider = MissingTelemetryProvider()

    summary = await run_prompt_eval(
        model="z-ai/glm-5.2",
        candidate="baseline",
        repetitions=1,
        provider=provider,
    )

    assert summary.mean_actual_cost_usd is None
    assert summary.mean_latency_ms is not None
    assert summary.mean_latency_ms > 0


@pytest.mark.asyncio
async def test_runner_rejects_out_of_range_repetitions():
    from scripts.evaluate_ai_prompt import run_prompt_eval

    provider = FakeProvider()

    with pytest.raises(ValueError, match="repetitions"):
        await run_prompt_eval(
            model="z-ai/glm-5.2",
            candidate="baseline",
            repetitions=4,
            provider=provider,
        )
