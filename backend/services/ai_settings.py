"""Non-secret AI provider settings for Orbit v2.

This service deliberately excludes API key storage. Cloud provider rows may hold
only an opaque `api_key_ref` once the OS-keychain slice lands; plaintext or
encrypted key material must never be persisted in SQLite.
"""
from __future__ import annotations

from typing import Any

from services.db import DatabaseService


class AISettingsService:
    """Small public interface for AI provider configuration and routing policy."""

    def __init__(self, db: DatabaseService) -> None:
        self._db = db

    async def list_provider_configs(self) -> list[dict[str, Any]]:
        return await self._db.list_ai_provider_configs()

    async def get_routing_policy(self) -> dict[str, Any]:
        return await self._db.get_ai_routing_policy()

    async def update_routing_policy(
        self,
        *,
        active_provider: str,
        routing_mode: str,
        local_fallback_enabled: bool,
        per_call_cost_cap_usd: float,
        monthly_cost_cap_usd: float,
    ) -> dict[str, Any]:
        return await self._db.update_ai_routing_policy(
            active_provider=active_provider,
            routing_mode=routing_mode,
            local_fallback_enabled=local_fallback_enabled,
            per_call_cost_cap_usd=per_call_cost_cap_usd,
            monthly_cost_cap_usd=monthly_cost_cap_usd,
        )

    async def set_provider_key_ref(
        self,
        *,
        provider_name: str,
        api_key_ref: str,
    ) -> dict[str, Any]:
        """Enable a cloud provider using an opaque OS-keychain reference."""
        return await self._db.update_ai_provider_key_ref(
            provider_name=provider_name,
            api_key_ref=api_key_ref,
            enabled=True,
        )

    async def clear_provider_key_ref(self, *, provider_name: str) -> dict[str, Any]:
        """Disable a cloud provider and remove its opaque key reference."""
        return await self._db.update_ai_provider_key_ref(
            provider_name=provider_name,
            api_key_ref=None,
            enabled=False,
        )

    async def set_provider_model(
        self,
        *,
        provider_name: str,
        model: str,
    ) -> dict[str, Any]:
        """Persist a model only after the route validates it against the catalog."""
        return await self._db.update_ai_provider_model(
            provider_name=provider_name,
            model=model,
        )
