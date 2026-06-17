from __future__ import annotations

import pytest

from services.db import DatabaseService


@pytest.mark.asyncio
async def test_ai_usage_ledger_records_estimated_and_actual_cost_separately():
    from services.ai_usage import AIUsageLedger

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    ledger = AIUsageLedger(db)

    row = await ledger.record_usage(
        provider_name="openrouter",
        model="openrouter/auto",
        task_type="analysis",
        routing_mode="cloud_manual",
        input_tokens=120,
        output_tokens=80,
        estimated_cost=0.02,
        actual_cost=0.0123,
        status="success",
        provider_request_id="gen-123",
        error_code=None,
    )

    assert row["provider_name"] == "openrouter"
    assert row["estimated_cost"] == 0.02
    assert row["actual_cost"] == 0.0123
    assert row["status"] == "success"

    rows = await ledger.list_recent_usage(limit=10)
    assert rows == [row]

    await db.close()


@pytest.mark.asyncio
async def test_ai_usage_ledger_monthly_spend_uses_actual_cost_only():
    from services.ai_usage import AIUsageLedger

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    ledger = AIUsageLedger(db)

    await ledger.record_usage(
        provider_name="openrouter",
        model="openrouter/auto",
        task_type="analysis",
        routing_mode="cloud_manual",
        input_tokens=None,
        output_tokens=None,
        estimated_cost=0.50,
        actual_cost=0.10,
        status="success",
        provider_request_id=None,
        error_code=None,
    )
    await ledger.record_usage(
        provider_name="openrouter",
        model="openrouter/auto",
        task_type="analysis",
        routing_mode="cloud_manual",
        input_tokens=None,
        output_tokens=None,
        estimated_cost=0.50,
        actual_cost=None,
        status="blocked",
        provider_request_id=None,
        error_code="ai_cost_limit_exceeded",
    )

    summary = await ledger.monthly_spend_summary()

    assert summary == {
        "monthly_actual_cost_usd": 0.10,
        "monthly_estimated_cost_usd": 1.0,
    }

    await db.close()


@pytest.mark.asyncio
async def test_ai_usage_ledger_effective_spend_counts_actual_or_successful_estimate_only():
    from services.ai_usage import AIUsageLedger

    db = DatabaseService(db_path=":memory:")
    await db.initialize()
    ledger = AIUsageLedger(db)

    await ledger.record_usage(
        provider_name="openrouter",
        model="openrouter/auto",
        task_type="analysis",
        routing_mode="cloud_manual",
        input_tokens=None,
        output_tokens=None,
        estimated_cost=0.50,
        actual_cost=0.10,
        status="success",
        provider_request_id=None,
        error_code=None,
    )
    await ledger.record_usage(
        provider_name="openrouter",
        model="openrouter/auto",
        task_type="analysis",
        routing_mode="cloud_manual",
        input_tokens=None,
        output_tokens=None,
        estimated_cost=0.25,
        actual_cost=None,
        status="failed",
        provider_request_id=None,
        error_code="ai_provider_network_error",
    )
    await ledger.record_usage(
        provider_name="openrouter",
        model="openrouter/auto",
        task_type="analysis",
        routing_mode="cloud_manual",
        input_tokens=None,
        output_tokens=None,
        estimated_cost=0.40,
        actual_cost=0.05,
        status="failed",
        provider_request_id=None,
        error_code="ai_provider_timeout_error",
    )
    await ledger.record_usage(
        provider_name="openrouter",
        model="openrouter/auto",
        task_type="analysis",
        routing_mode="cloud_manual",
        input_tokens=None,
        output_tokens=None,
        estimated_cost=0.75,
        actual_cost=None,
        status="blocked",
        provider_request_id=None,
        error_code="ai_cost_limit_exceeded",
    )

    assert await ledger.monthly_effective_spend_usd() == pytest.approx(0.15)

    await db.close()
