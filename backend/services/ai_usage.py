"""Local AI usage and spend ledger."""
from __future__ import annotations

from typing import Any

from services.db import DatabaseService


class AIUsageLedger:
    """Small public interface for recording and reading local AI usage."""

    def __init__(self, db: DatabaseService) -> None:
        self._db = db

    async def record_usage(
        self,
        *,
        provider_name: str,
        model: str | None,
        task_type: str,
        routing_mode: str,
        input_tokens: int | None,
        output_tokens: int | None,
        estimated_cost: float | None,
        actual_cost: float | None,
        status: str,
        provider_request_id: str | None,
        error_code: str | None,
    ) -> dict[str, Any]:
        return await self._db.insert_ai_usage_log(
            provider_name=provider_name,
            model=model,
            task_type=task_type,
            routing_mode=routing_mode,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost=estimated_cost,
            actual_cost=actual_cost,
            status=status,
            provider_request_id=provider_request_id,
            error_code=error_code,
        )

    async def list_recent_usage(self, *, limit: int = 50) -> list[dict[str, Any]]:
        return await self._db.list_ai_usage_log(limit=limit)

    async def monthly_spend_summary(self) -> dict[str, float]:
        return await self._db.get_ai_usage_monthly_totals()
