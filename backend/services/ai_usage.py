"""Local AI usage and spend ledger."""
from __future__ import annotations

from typing import Any
from uuid import uuid4

from models import AIRunAttempt, AIRunReceipt
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
        run_id: str | None = None,
        requested_provider_name: str | None = None,
        requested_model: str | None = None,
        resolved_model: str | None = None,
        fallback_reason: str | None = None,
        duration_ms: int | None = None,
        reasoning_tokens: int | None = None,
        cached_tokens: int | None = None,
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
            run_id=run_id or str(uuid4()),
            requested_provider_name=requested_provider_name or provider_name,
            requested_model=requested_model if requested_model is not None else model,
            resolved_model=resolved_model,
            fallback_reason=fallback_reason,
            duration_ms=duration_ms,
            reasoning_tokens=reasoning_tokens,
            cached_tokens=cached_tokens,
        )

    async def list_recent_usage(self, *, limit: int = 50) -> list[dict[str, Any]]:
        return await self._db.list_ai_usage_log(limit=limit)

    async def monthly_spend_summary(self) -> dict[str, float]:
        return await self._db.get_ai_usage_monthly_totals()

    async def monthly_effective_spend_usd(self) -> float:
        return await self._db.get_ai_usage_monthly_effective_spend()

    async def list_run_receipts(self, *, limit: int = 50) -> list[AIRunReceipt]:
        rows = await self._db.list_ai_run_attempts(limit=limit)
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in reversed(rows):
            grouped.setdefault(row["run_id"], []).append(row)

        receipts: list[AIRunReceipt] = []
        for run_id, attempts_rows in reversed(grouped.items()):
            attempts = [
                AIRunAttempt(
                    provider_name=row["provider_name"],
                    requested_model=row["requested_model"],
                    resolved_model=row["resolved_model"],
                    status=row["status"],
                    provider_request_id=row["provider_request_id"],
                    input_tokens=row["input_tokens"],
                    output_tokens=row["output_tokens"],
                    reasoning_tokens=row["reasoning_tokens"],
                    cached_tokens=row["cached_tokens"],
                    estimated_cost_usd=row["estimated_cost"],
                    actual_cost_usd=row["actual_cost"],
                    duration_ms=row["duration_ms"],
                    error_code=row["error_code"],
                )
                for row in attempts_rows
            ]
            final = attempts_rows[-1]
            fallback_used = any(row["status"] == "fallback_success" for row in attempts_rows)
            receipts.append(AIRunReceipt(
                run_id=run_id,
                requested_provider=attempts_rows[0]["requested_provider_name"],
                requested_model=attempts_rows[0]["requested_model"],
                executed_provider=(
                    final["provider_name"]
                    if final["status"] in {"success", "fallback_success"}
                    else None
                ),
                resolved_model=final["resolved_model"],
                fallback_used=fallback_used,
                fallback_reason=next(
                    (row["fallback_reason"] for row in attempts_rows if row["fallback_reason"]),
                    None,
                ),
                status=final["status"],
                attempts=attempts,
                created_at=attempts_rows[0]["created_at"],
            ))
        return receipts
