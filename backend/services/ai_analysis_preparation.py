"""Ephemeral exact-payload snapshots for reviewed cloud analysis."""
from __future__ import annotations

import json
import uuid
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from models import AICostQuote, AIDataDisclosure, AIModelOption, AnalyzeRequest


class AIAnalysisSnapshotNotFoundError(KeyError):
    pass


class AIAnalysisSnapshotExpiredError(KeyError):
    pass


class AIAnalysisContextLimitError(ValueError):
    pass


@dataclass(frozen=True)
class PreparedAnalysisSnapshot:
    snapshot_id: str
    expires_at: datetime
    provider_name: str
    model: AIModelOption
    messages: list[dict[str, str]]
    request_body: dict
    disclosure: AIDataDisclosure
    cost: AICostQuote
    fallback_enabled: bool
    local_model: str | None
    request: AnalyzeRequest


class AIAnalysisPreparationService:
    def __init__(
        self,
        *,
        clock: Callable[[], datetime] | None = None,
        token_estimator: Callable[[list[dict[str, str]]], int] | None = None,
        ttl: timedelta = timedelta(minutes=10),
        max_snapshots: int = 20,
    ) -> None:
        self._clock = clock or (lambda: datetime.now(UTC))
        self._estimate_tokens = token_estimator or self._default_token_estimate
        self._ttl = ttl
        self._max_snapshots = max_snapshots
        self._snapshots: OrderedDict[str, PreparedAnalysisSnapshot] = OrderedDict()

    async def prepare(
        self,
        request: AnalyzeRequest,
        *,
        provider_name: str,
        model: AIModelOption,
        messages: list[dict[str, str]],
        fallback_enabled: bool,
        local_model: str | None = None,
    ) -> PreparedAnalysisSnapshot:
        now = self._clock()
        expires_at = now + self._ttl
        input_tokens = self._estimate_tokens(messages)
        if input_tokens >= model.context_length:
            raise AIAnalysisContextLimitError(
                "Prepared analysis exceeds the selected model context window"
            )
        max_tokens = min(
            4096,
            model.max_completion_tokens,
            model.context_length - input_tokens,
        )
        expected_tokens = min(1024, max_tokens)
        prompt_price = Decimal(model.prompt_price_per_token)
        completion_price = Decimal(model.completion_price_per_token)
        request_price = Decimal(model.request_price)
        base_cost = Decimal(input_tokens) * prompt_price + request_price
        cost = AICostQuote(
            estimated_input_tokens=input_tokens,
            expected_output_tokens=expected_tokens,
            max_output_tokens=max_tokens,
            estimated_cost_usd=base_cost + Decimal(expected_tokens) * completion_price,
            maximum_cost_usd=base_cost + Decimal(max_tokens) * completion_price,
        )
        body = {
            "model": model.id,
            "messages": messages,
            "stream": True,
            "max_tokens": max_tokens,
        }
        snapshot_id = str(uuid.uuid4())
        snapshot = PreparedAnalysisSnapshot(
            snapshot_id=snapshot_id,
            expires_at=expires_at,
            provider_name=provider_name,
            model=model,
            messages=messages,
            request_body=body,
            disclosure=AIDataDisclosure(
                sent_to_cloud=[
                    "selected symbol and timeframes",
                    "technical indicators and chart context",
                    "visible Fibonacci snapshots",
                    "optional selected watchlist context",
                ],
                kept_local=[
                    "IBKR credentials",
                    "API keys",
                    "account, portfolio, order, and execution data",
                    "SQLite rows and arbitrary app state",
                ],
                exact_payload_available_until=expires_at,
            ),
            cost=cost,
            fallback_enabled=fallback_enabled,
            local_model=local_model,
            request=request,
        )
        self._evict_expired(now)
        self._snapshots[snapshot_id] = snapshot
        while len(self._snapshots) > self._max_snapshots:
            self._snapshots.popitem(last=False)
        return snapshot

    def get_snapshot(self, snapshot_id: str) -> PreparedAnalysisSnapshot:
        snapshot = self._snapshots.get(snapshot_id)
        if snapshot is None:
            raise AIAnalysisSnapshotNotFoundError(snapshot_id)
        if snapshot.expires_at <= self._clock():
            del self._snapshots[snapshot_id]
            raise AIAnalysisSnapshotExpiredError(snapshot_id)
        return snapshot

    def _evict_expired(self, now: datetime) -> None:
        for snapshot_id, snapshot in list(self._snapshots.items()):
            if snapshot.expires_at <= now:
                del self._snapshots[snapshot_id]

    @staticmethod
    def _default_token_estimate(messages: list[dict[str, str]]) -> int:
        return max(1, (len(json.dumps(messages, separators=(",", ":"))) + 3) // 4)
