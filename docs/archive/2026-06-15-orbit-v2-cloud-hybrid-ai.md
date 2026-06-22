# Orbit v2 Cloud + Hybrid AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional cloud AI and hybrid local/cloud inference while preserving Orbit's local-first default, current Ollama behavior, and no-autonomous-trading safety boundary.

**Architecture:** The provider boundary, local metadata path, OS-keychain enablement, cloud adapters, routing, usage controls, and provider-aware session flow are implemented on the feature branch. Cloud provider instances are request-scoped and never stored in the singleton registry.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / httpx / SQLite / pytest (backend); React 19 / TypeScript / Zustand / TanStack Query / Vitest + Testing Library (frontend); Ollama local provider first, cloud providers through mocked `httpx` tests before any manual key smoke test.

**Branch:** `feature/orbit-v2-cloud-hybrid-ai-spec`. Design spec: `docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md`.

---

## Readiness Verdict

Slices 1 through 7 are implemented on `feature/orbit-v2-cloud-hybrid-ai-spec`. PR #30 remains draft while review remediation and verification complete. Slice 8 manual provider smoke tests remain a human review gate and have not been claimed complete.

Provider-controls remediation on this branch supersedes the earlier settings and
cost-cap assumptions in this plan: Analysis now owns persistent
provider/model/fallback selection, Settings owns OS-keychain credential
management only, and Orbit surfaces preview/receipt cost metadata without
enforcing aggregate provider-account budgets or caps.

## API Key Storage Decision

Locked decision:

Orbit v2 cloud AI uses OS keychain storage only. SQLite stores provider configuration and an opaque `api_key_ref`, never plaintext or encrypted API key material. If the OS keychain is unavailable, cloud providers cannot be enabled and the app falls back to local Ollama. No encrypted SQLite fallback is implemented in this slice.

## Policy Impact

Policy impact is already approved in branch docs: `AGENTS.md` and `CLAUDE.md` allow optional cloud AI only when explicitly enabled, require OS-keychain-only API key storage, and ban AI from mutating execution state. SQLite stores only opaque `api_key_ref` values. Pause if any task needs to send raw account/order payloads to a cloud model, add AI tool/function calling, or weaken local-first defaults.

## Existing Context To Preserve

- `backend/services/ai.py` owns sessions, prompt construction, signal parsing, non-streaming analysis, streaming analysis, follow-up chat, and warmup.
- `backend/routers/ai.py` owns `/ai/status`, `/ai/models`, `/ai/models/select`, `/ai/setup-guide`, `/ai/refresh`, `/ai/warmup`, `/ai/analyze`, `/ai/analyze/stream`, `/ai/chat`, and `/ai/chat/stream`.
- `backend/services/ollama.py` owns local Ollama lifecycle, selected model, recommended model list, and model discovery.
- `backend/services/ollama_context.py` owns current local model budget lookup.
- `backend/services/db.py` owns all SQLite access; writes and reads must go through `_run_write` / `_run_read`.
- `src/modules/parallax/api.ts` owns Parallax-facing frontend contracts.
- `src/hooks/useAiStatus.ts`, `src/hooks/useAiAnalyzeStream.ts`, `src/hooks/useAiStream.ts`, and `src/store/ai.ts` own the current AI panel data flow.

## Current Review Gate

Do not merge or push PR #30 until focused AI verification, build, policy drift, Ruff, and full backend/frontend suites have been run and branch-introduced failures are fixed. Manual provider smoke tests require user-supplied keys and remain a separate HITL gate.

| Slice | Status |
|---|---|
| 1. Ollama provider boundary | Implemented |
| 2. Local provider metadata | Implemented |
| 3. Provider settings shell | Implemented |
| 4. OS-keychain enablement | Implemented |
| 5. OpenRouter analysis and fallback | Implemented |
| 6. Usage ledger and receipt costs; Orbit caps removed | Implemented |
| 7. Direct cloud adapters | Implemented |
| 8. Manual provider smoke tests | Pending HITL verification |

---

## File Structure

### Backend

- Create `backend/services/ai_providers.py` — provider protocol, request/response dataclasses, Ollama provider adapter, provider registry.
- Modify `backend/services/ai.py` — keep public methods stable, delegate `chat`, `chat_structured`, `chat_stream`, and `warmup` through the active provider.
- Modify `backend/main.py` — construct `OllamaLLMProvider` and `AIProviderRegistry`, then pass the registry to `AiService`.
- Modify `backend/deps.py` — expose registry/settings dependencies when provider endpoints arrive.
- Modify `backend/models/__init__.py` — add provider status, routing policy, usage, and settings contracts.
- Modify `backend/routers/ai.py` — add provider/routing endpoints and route analysis through provider metadata without changing existing request URLs.
- Modify `backend/services/db.py` — add provider config, usage log, and router event tables plus service methods.
- Create `backend/services/ai_settings.py` — provider config persistence, routing policy persistence, and cost cap reads/writes.
- Create `backend/services/ai_keystore.py` — OS keychain-backed secret storage with redaction helpers.
- Create `backend/services/ai_router.py` — hybrid task policy, routing decisions, fallback guardrails.
- Create `backend/services/ai_usage.py` — local usage ledger and cost cap checks.
- Create `backend/services/ai_cloud_adapters.py` — OpenRouter first, then OpenAI, Anthropic, Gemini, and Grok adapters using `httpx`; all provider network tests use mocked transports.
- Add tests:
  - `backend/tests/test_ai_provider_registry.py`
  - `backend/tests/test_ai_provider_routes.py`
  - `backend/tests/test_ai_settings_service.py`
  - `backend/tests/test_ai_keystore.py`
  - `backend/tests/test_ai_router_policy.py`
  - `backend/tests/test_ai_usage_ledger.py`
  - `backend/tests/test_ai_cloud_adapters.py`

### Frontend

- Modify `src/modules/parallax/api.ts` — add provider, routing, usage, and metadata contracts plus API calls.
- Modify `src/store/ai.ts` — store provider metadata, routing mode, fallback/cost metadata, and cloud disabled state.
- Modify `src/hooks/useAiStatus.ts` — hydrate provider/routing state through TanStack Query.
- Modify `src/hooks/useAiAnalyzeStream.ts` — preserve current SSE behavior and record provider/model/cost metadata from final `done` events.
- Modify `src/hooks/useAiStream.ts` — preserve follow-up streaming; later normalize structured chat stream metadata if backend changes the format.
- Create `src/components/ai/AiProviderBadge.tsx` — compact local/cloud/fallback/cost badge for analysis surfaces.
- Create `src/components/ai/AiProvidersSettings.tsx` — provider settings surface for Ollama, OpenRouter, OpenAI, Anthropic, Gemini, and Grok.
- Modify `src/components/ai/AiChatPanel.tsx` — show provider badge and cloud disabled state without changing existing analysis controls in Slice 2.
- Add tests:
  - `src/components/ai/__tests__/AiProviderBadge.test.tsx`
  - `src/components/ai/__tests__/AiProvidersSettings.test.tsx`
  - `src/hooks/__tests__/useAiAnalyzeStream.test.ts`
  - existing `src/components/ai/__tests__/AiChatPanel.test.tsx`

---

# Revised Vertical Slice Execution Order

This section supersedes the original backend-first Slice 2 through Slice 10 ordering below. The older task notes remain as reference material only; do not execute them directly unless they have been folded into one of these revised vertical slices.

## Revised Slice 2: AFK — Local Provider Metadata End-to-End

**Proof target:** A local Ollama analysis exposes provider metadata from the Python sidecar through the stream final event, frontend API/types, Zustand state, stream hook, and AI panel badge. This proves the current local path can carry provider/model/fallback/cost metadata before any cloud provider, key storage, or DB settings work begins.

**Files:**
- Modify: `backend/models/__init__.py`
- Modify: `backend/routers/ai.py`
- Test: `backend/tests/test_ai_provider_routes.py`
- Modify: `src/modules/parallax/api.ts`
- Modify: `src/store/ai.ts`
- Modify: `src/hooks/useAiStatus.ts`
- Modify: `src/hooks/useAiAnalyzeStream.ts`
- Create: `src/components/ai/AiProviderBadge.tsx`
- Modify: `src/components/ai/AiChatPanel.tsx`
- Test: `src/components/ai/__tests__/AiProviderBadge.test.tsx`
- Test: `src/hooks/__tests__/useAiAnalyzeStream.test.ts`
- Test: existing `src/components/ai/__tests__/AiChatPanel.test.tsx`

- [ ] **Step 1: Write failing backend provider contract tests**

Add `backend/tests/test_ai_provider_routes.py` coverage that proves:

```python
def test_get_ai_providers_returns_local_ollama_default():
    ...
    resp = client.get("/ai/providers")
    assert resp.status_code == 200
    assert resp.json()["active_provider"] == "ollama"
    assert resp.json()["routing_mode"] == "local_only"
    assert resp.json()["cloud_enabled"] is False
    assert resp.json()["providers"][0]["provider_name"] == "ollama"
    assert resp.json()["providers"][0]["kind"] == "local"
```

Add stream-route coverage that consumes `/ai/analyze/stream` and proves the final `done` frame contains:

```json
{
  "provider": {
    "provider_name": "ollama",
    "kind": "local",
    "model": "gemma4:26b",
    "estimated_cost": null,
    "actual_cost": null,
    "fallback_used": false
  }
}
```

- [ ] **Step 2: Run backend tests red**

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_routes.py -q
```

Expected: FAIL because `/ai/providers` and stream provider metadata do not exist.

- [ ] **Step 3: Add backend models and local-only provider metadata**

Add provider response models in `backend/models/__init__.py`:

```python
AIProviderName = Literal["ollama", "openai", "anthropic", "gemini", "grok", "openrouter"]
AIProviderKind = Literal["local", "cloud"]
AIRoutingMode = Literal["local_only", "cloud_manual", "hybrid_auto", "cloud_with_local_fallback"]


class AIProviderStatus(BaseModel):
    provider_name: AIProviderName
    display_name: str
    kind: AIProviderKind
    enabled: bool
    ready: bool
    selected_model: Optional[str] = None
    has_key: bool = False
    error: Optional[str] = None


class AIProviderMetadata(BaseModel):
    provider_name: AIProviderName
    kind: AIProviderKind
    model: Optional[str] = None
    estimated_cost: Optional[float] = None
    actual_cost: Optional[float] = None
    fallback_used: bool = False


class AIProvidersResponse(BaseModel):
    providers: list[AIProviderStatus]
    active_provider: AIProviderName
    routing_mode: AIRoutingMode
    cloud_enabled: bool
```

Add `GET /ai/providers` in `backend/routers/ai.py` using the existing `OllamaLifecycle.status()`. Add the same `AIProviderMetadata` payload to the final `done` event for `/ai/analyze/stream`. Do not add DB settings or cloud provider rows in this slice.

- [ ] **Step 4: Run backend tests green**

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_routes.py tests/test_ai_provider_registry.py tests/test_ai_timeout.py tests/test_ai_warmup.py -q
```

Expected: PASS.

- [ ] **Step 5: Write failing frontend tests**

Add `src/components/ai/__tests__/AiProviderBadge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import AiProviderBadge from "../AiProviderBadge";

it("renders local Ollama provider metadata", () => {
  render(
    <AiProviderBadge
      providerName="ollama"
      model="gemma4:26b"
      kind="local"
      fallbackUsed={false}
      estimatedCost={null}
      actualCost={null}
    />,
  );

  expect(screen.getByText("Local")).toBeInTheDocument();
  expect(screen.getByText("Ollama")).toBeInTheDocument();
  expect(screen.getByText("gemma4:26b")).toBeInTheDocument();
});

it("renders fallback metadata when present", () => {
  render(
    <AiProviderBadge
      providerName="ollama"
      model="gemma4:26b"
      kind="local"
      fallbackUsed
      estimatedCost={null}
      actualCost={null}
    />,
  );

  expect(screen.getByText("Fallback")).toBeInTheDocument();
});
```

Add `src/hooks/__tests__/useAiAnalyzeStream.test.ts` coverage that feeds a final SSE `done` event with the provider metadata shown above and asserts `useAiStore.getState().lastProviderMetadata` is set.

- [ ] **Step 6: Run frontend tests red**

```bash
npm test -- src/components/ai/__tests__/AiProviderBadge.test.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts
```

Expected: FAIL because the badge and stream metadata storage do not exist.

- [ ] **Step 7: Add frontend provider contract and badge**

In `src/modules/parallax/api.ts`, add provider/routing/metadata types and `aiProviders()`.

In `src/store/ai.ts`, add:

```ts
providers: AIProviderStatus[];
activeProvider: AIProviderName;
routingMode: AIRoutingMode;
cloudEnabled: boolean;
lastProviderMetadata: AIProviderMetadata | null;
setProvidersStatus: (status: AIProvidersResponse) => void;
setLastProviderMetadata: (metadata: AIProviderMetadata | null) => void;
```

In `src/hooks/useAiStatus.ts`, fetch `/ai/providers` and call `setProvidersStatus`.

In `src/hooks/useAiAnalyzeStream.ts`, parse optional `provider` from the `done` event and call `setLastProviderMetadata`.

Create `src/components/ai/AiProviderBadge.tsx` and render it in `src/components/ai/AiChatPanel.tsx` near the existing response-time badge when metadata exists.

- [ ] **Step 8: Run revised Slice 2 verification**

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_routes.py tests/test_ai_provider_registry.py tests/test_ai_timeout.py tests/test_ai_warmup.py -q
npm test -- src/components/ai/__tests__/AiProviderBadge.test.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts src/components/ai/__tests__/AiChatPanel.test.tsx
npm run typecheck
```

Expected: PASS. If typecheck fails on unrelated baseline issues, capture the exact existing failure and still require the focused tests to pass.

- [ ] **Step 9: Commit**

```bash
git add backend/models/__init__.py backend/routers/ai.py backend/tests/test_ai_provider_routes.py src/modules/parallax/api.ts src/store/ai.ts src/hooks/useAiStatus.ts src/hooks/useAiAnalyzeStream.ts src/components/ai/AiProviderBadge.tsx src/components/ai/AiChatPanel.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts
git commit -m "feat: show local ai provider metadata end to end"
```

Historical Slice 2 checkpoint completed. The authoritative current status is the table above.

## Revised Slice 3: HITL — Provider Settings Shell End-to-End, No Secrets

**Proof target:** The Settings screen can display provider cards, routing mode, local fallback preference, and cost caps from SQLite-backed API state. Cloud provider cards exist but remain disabled unless key storage later enables them. No API key input or keychain code is implemented in this slice.

**Vertical path:** `ai_provider_configs` / `ai_routing_policy` persistence -> `/ai/providers` and `/ai/routing-policy` -> `parallaxApi` -> Zustand state -> `AiProvidersSettings` in `SettingsPage`.

**Required tests:**
- Backend DB/settings service tests prove provider config and routing policy persist through `DatabaseService` and route contracts.
- Frontend settings tests prove provider cards render `Ollama`, `OpenRouter`, `OpenAI`, `Anthropic`, `Gemini`, and `Grok`, with cloud providers disabled and no secret fields present.

**Stop condition:** Settings UI can round-trip non-secret routing/cost settings and still leaves cloud execution disabled.

## Revised Slice 4: HITL — OS-Keychain Provider Enablement End-to-End

**Proof target:** A cloud provider can be enabled only by saving an API key into OS keychain. SQLite stores only provider config and opaque `api_key_ref`. If keychain is unavailable, the backend returns a typed 503 and the UI leaves the provider disabled while local Ollama remains available.

**Vertical path:** `AIKeyStore` -> key save/delete routes -> provider config row with `api_key_ref` -> settings UI enable/disable state -> redaction tests.

**Required tests:**
- `backend/tests/test_ai_keystore.py` proves secret redaction, save/delete, and keychain-unavailable typed errors.
- `backend/tests/test_ai_provider_routes.py` proves save/delete responses never include secret material and fail closed.
- `src/components/ai/__tests__/AiProvidersSettings.test.tsx` proves the UI displays key-present/disabled/error states without rendering the key.

**Stop condition:** One fake cloud provider can be marked key-present through OS keychain plumbing, but no cloud inference runs yet.

## Revised Slice 5: HITL — First Mock Cloud Analysis End-to-End With OpenRouter

**Proof target:** OpenRouter is the first cloud adapter because it gives Orbit one API-compatible surface for many model providers and returns usage/cost metadata. With mocked `httpx`, a read-only analysis can route to OpenRouter, stream or return a response, display provider/model/cost metadata in the AI panel, and fall back to local Ollama on typed provider failure.

**Vertical path:** `OpenRouterProvider` -> `HybridInferenceRouter` for analysis-only tasks -> mocked key retrieval -> `/ai/analyze` and `/ai/analyze/stream` -> frontend provider metadata -> AI panel badge.

**Constraints:**
- Do not make `openrouter/fusion` the default.
- Add Fusion only as a gated `deep_review` / "Deep Review" model option that is disabled by default.
- Do not add AI tool/function calling.
- Use provider request bodies that contain only the sanitized analysis prompt already allowed by the design spec.

**Required tests:**
- Adapter tests prove OpenRouter request/response normalization, stream parsing, usage/cost parsing, and typed errors.
- Router tests prove execution-sensitive tasks cannot route to cloud.
- Frontend tests prove cloud provider/model/cost/fallback metadata renders.

**Stop condition:** Mocked OpenRouter analysis works end-to-end without a real API key, and local fallback is visible when the mock cloud provider fails.

## Revised Slice 6: HITL — Cost Estimate, Actual Cost, and Caps End-to-End

**Proof target:** Before a paid cloud call, the UI shows a simple estimate or max-cost warning. After the call, the UI records and shows actual cost. Per-call and monthly caps block safely before making a cloud request.

**Vertical path:** provider pricing snapshot/cache -> pre-call estimate -> route cap check -> provider response usage metadata -> `ai_usage_log` -> AI panel and settings spend display.

**OpenRouter-specific rule:** For dynamic routers like `openrouter/auto` and `openrouter/fusion`, show an estimate range or configured max cap before the call, then reconcile to exact post-call cost from response `usage.cost` or `/api/v1/generation`.

**Required tests:**
- Backend usage ledger tests prove estimated and actual cost are recorded separately.
- Route tests prove over-cap requests return a typed error before cloud network calls.
- Frontend tests prove the AI panel shows `Estimated`, `Actual`, and monthly spend states.

**Stop condition:** Cost control is user-visible and enforced before any non-mocked/manual cloud smoke.

## Revised Slice 7: HITL — Additional Direct Provider Adapters

**Proof target:** Direct OpenAI, Anthropic, Gemini, and Grok adapters can run the same read-only analysis contract as OpenRouter through mocked network tests and the same UI metadata path.

**Vertical path:** provider adapter -> router -> analysis route -> usage metadata -> AI panel badge/settings status.

**Required tests:** Mocked `httpx` tests for each adapter, plus one shared provider contract test suite that each adapter must satisfy.

**Stop condition:** Direct provider adapters are interchangeable behind the `LLMProvider` interface and do not require frontend special cases beyond provider display labels.

## Revised Slice 8: HITL — Manual Provider Smoke Tests

**Proof target:** With user-supplied keys pasted only into the app UI, each approved cloud provider can run a read-only analysis without exposing keys or touching execution paths.

**Checklist:**
1. Run local-only regression first.
2. Save one provider key in Settings.
3. Run provider test.
4. Run one read-only analysis on non-account ticker context.
5. Verify provider/model/actual-cost metadata appears.
6. Verify usage row appears.
7. Verify no API key appears in backend logs, frontend UI, request logs, or SQLite config rows.
8. Disable provider and verify `local_only` still works.

Record only provider names, model names, date, pass/fail, and typed errors. Do not record prompts, responses, API keys, account data, or provider request bodies.

# Completed Preparatory Slice 1: AFK — Ollama Behind Provider Boundary, No Cloud

**Proof target:** Existing AI analysis and streaming analysis still work through a provider registry with only local Ollama registered. No frontend behavior, DB schema, key storage, or cloud adapter is changed in this slice.

**Status:** Implemented before the vertical-slice revision. This slice proved the backend provider seam, but it is not vertical enough to use as the pattern for later execution.

## Task 1.1: Backend provider protocol and non-streaming analysis compatibility

**Files:**
- Create: `backend/services/ai_providers.py`
- Modify: `backend/services/ai.py`
- Test: `backend/tests/test_ai_provider_registry.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ai_provider_registry.py`:

```python
from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest

from services.ai import AiService


INLINE_JSON_NARRATIVE = (
    "AAPL is holding above the 21 EMA.\n\n"
    "```json\n"
    "{\n"
    '  "direction": "LONG", "confidence": 72, "description": "Trend continuation",\n'
    '  "entry": {"price": 180.0, "note": "pullback hold"},\n'
    '  "stop": {"price": 175.0, "note": "below structure"},\n'
    '  "target": {"price": 192.0, "note": "prior high"},\n'
    '  "confirmations": ["EMA support"], "cautions": [],\n'
    '  "meta": {"risk_reward": "1:2.4", "score": "7/10", "adx_trend": "Firm", "volume_signal": "Normal"}\n'
    "}\n"
    "```"
)


@dataclass
class FakeProvider:
    name: str = "ollama"
    calls: list[dict] | None = None

    async def chat(self, *, messages: list[dict[str, str]], model: str, think: bool | None = None) -> str:
        if self.calls is None:
            self.calls = []
        self.calls.append({"kind": "chat", "messages": messages, "model": model, "think": think})
        return INLINE_JSON_NARRATIVE

    async def chat_structured(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        json_schema: dict,
        think: bool | None = None,
    ) -> dict:
        raise AssertionError("chat_structured should not be used by one-shot analyze")

    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> AsyncIterator[str]:
        if False:
            yield ""

    async def warmup(self, *, model: str) -> None:
        return None


@pytest.mark.asyncio
async def test_ai_service_analyze_routes_through_provider_registry():
    from services.ai_providers import AIProviderRegistry

    provider = FakeProvider()
    registry = AIProviderRegistry({"ollama": provider})
    svc = AiService(provider_registry=registry)

    result = await svc.analyze(
        symbol="AAPL",
        timeframe_data={"D": {"candles": [], "indicators": [], "fibonacci": None}},
        indicators_display=["EMA Stack"],
        indicator_names=["ema_9", "ema_21", "ema_50", "ema_200"],
        model="gemma4:26b",
    )

    assert result["session_id"]
    assert result["signal"]["direction"] == "LONG"
    assert result["message"] == "AAPL is holding above the 21 EMA."
    assert provider.calls == [
        {
            "kind": "chat",
            "messages": provider.calls[0]["messages"],
            "model": "gemma4:26b",
            "think": None,
        }
    ]
    assert provider.calls[0]["messages"][0]["role"] == "system"
    assert provider.calls[0]["messages"][1]["role"] == "user"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_registry.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'services.ai_providers'` or `TypeError: AiService.__init__() got an unexpected keyword argument 'provider_registry'`.

- [ ] **Step 3: Create the provider protocol and registry**

Create `backend/services/ai_providers.py`:

```python
"""LLM provider boundary for Orbit AI.

The provider layer hides provider-specific request formats behind the existing
AiService prompt/session logic. v2 starts with only Ollama registered; cloud
providers are added in later slices after key storage and routing policy are
approved.
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Protocol

import httpx

from config import OLLAMA_HOST

log = logging.getLogger("parallax.ai.providers")


class LLMProvider(Protocol):
    name: str

    async def chat(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> str:
        ...

    async def chat_structured(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        json_schema: dict,
        think: bool | None = None,
    ) -> dict:
        ...

    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> AsyncIterator[str]:
        ...

    async def warmup(self, *, model: str) -> None:
        ...


class AIProviderRegistry:
    """Resolve active LLM providers by stable provider name."""

    def __init__(self, providers: dict[str, LLMProvider]) -> None:
        self._providers = dict(providers)

    def require(self, name: str) -> LLMProvider:
        provider = self._providers.get(name)
        if provider is None:
            raise KeyError(f"AI provider is not registered: {name}")
        return provider

    def names(self) -> list[str]:
        return sorted(self._providers)


class OllamaLLMProvider:
    """Provider adapter for the existing local Ollama `/api/chat` contract."""

    name = "ollama"

    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._http = http_client or httpx.AsyncClient(
            base_url=OLLAMA_HOST,
            timeout=httpx.Timeout(120.0, connect=10.0),
        )

    async def chat(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> str:
        payload = self._base_payload(messages=messages, model=model, stream=False)
        if think is not None:
            payload["think"] = think
        try:
            resp = await self._http.post("/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("message", {}).get("content", "")
        except httpx.ConnectError:
            raise ConnectionError("Cannot connect to Ollama server")
        except httpx.TimeoutException:
            raise TimeoutError("Ollama request timed out (>120s)")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Ollama returned error: {e.response.status_code}")

    async def chat_structured(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        json_schema: dict,
        think: bool | None = None,
    ) -> dict:
        payload = self._base_payload(messages=messages, model=model, stream=False)
        payload["format"] = json_schema
        payload["options"]["temperature"] = 0.2
        if think is not None:
            payload["think"] = think
        try:
            resp = await self._http.post("/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            return json.loads(content)
        except httpx.ConnectError:
            raise ConnectionError("Cannot connect to Ollama server")
        except httpx.TimeoutException:
            raise TimeoutError("Ollama request timed out (>120s)")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Ollama returned error: {e.response.status_code}")
        except json.JSONDecodeError as e:
            log.warning("Structured output returned invalid JSON: %s", e)
            raise ValueError(f"Model returned invalid JSON despite schema: {e}")

    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> AsyncIterator[str]:
        payload = self._base_payload(messages=messages, model=model, stream=True)
        if think is not None:
            payload["think"] = think
        try:
            async with self._http.stream(
                "POST",
                "/api/chat",
                json=payload,
                timeout=httpx.Timeout(connect=10.0, read=180.0, write=180.0, pool=180.0),
            ) as response:
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield content
                    if data.get("done", False):
                        return
        except httpx.ConnectError:
            yield "\n\n[Error: Cannot connect to Ollama server]"
        except httpx.TimeoutException:
            yield "\n\n[Error: Request timed out]"

    async def warmup(self, *, model: str) -> None:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
            "keep_alive": "20m",
            "options": {"num_predict": 1},
        }
        try:
            resp = await self._http.post("/api/chat", json=payload, timeout=30.0)
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as e:
            log.debug("Warmup request failed (non-fatal): %s", e)

    @staticmethod
    def _base_payload(
        *,
        messages: list[dict[str, str]],
        model: str,
        stream: bool,
    ) -> dict:
        return {
            "model": model,
            "messages": messages,
            "stream": stream,
            "keep_alive": "20m",
            "options": {
                "temperature": 0.3,
                "num_predict": 4096,
            },
        }
```

- [ ] **Step 4: Delegate AiService non-streaming calls through the registry**

In `backend/services/ai.py`, import the registry:

```python
from services.ai_providers import AIProviderRegistry, OllamaLLMProvider
```

Update `AiService.__init__`:

```python
    def __init__(
        self,
        context_service: "OllamaContextService | None" = None,
        provider_registry: AIProviderRegistry | None = None,
    ) -> None:
        self._context_service = context_service
        self._provider_registry = provider_registry or AIProviderRegistry({
            "ollama": OllamaLLMProvider(),
        })
        self.sessions: OrderedDict[str, ChatSession] = OrderedDict()
```

Replace the body of `chat()` with:

```python
        provider = self._provider_registry.require("ollama")
        return await provider.chat(messages=messages, model=model, think=think)
```

Replace the body of `chat_structured()` with:

```python
        provider = self._provider_registry.require("ollama")
        return await provider.chat_structured(
            messages=messages,
            model=model,
            json_schema=json_schema,
            think=think,
        )
```

Keep method signatures unchanged so existing callers and tests remain stable.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_registry.py tests/test_ai_timeout.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/ai_providers.py backend/services/ai.py backend/tests/test_ai_provider_registry.py
git commit -m "refactor: route ollama analysis through ai provider registry"
```

## Task 1.2: Streaming and warmup compatibility through the provider

**Files:**
- Modify: `backend/services/ai.py`
- Modify: `backend/tests/test_ai_provider_registry.py`
- Test: `backend/tests/test_ai_warmup.py`

- [ ] **Step 1: Add failing streaming and warmup tests**

Append to `backend/tests/test_ai_provider_registry.py`:

```python
@dataclass
class StreamingFakeProvider(FakeProvider):
    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> AsyncIterator[str]:
        if self.calls is None:
            self.calls = []
        self.calls.append({"kind": "stream", "model": model, "think": think})
        for token in ["Streamed narrative. ", INLINE_JSON_NARRATIVE]:
            yield token

    async def warmup(self, *, model: str) -> None:
        if self.calls is None:
            self.calls = []
        self.calls.append({"kind": "warmup", "model": model})


@pytest.mark.asyncio
async def test_ai_service_analyze_stream_routes_through_provider_registry():
    from services.ai_providers import AIProviderRegistry

    provider = StreamingFakeProvider()
    svc = AiService(provider_registry=AIProviderRegistry({"ollama": provider}))

    events = []
    async for event in svc.analyze_stream(
        symbol="AAPL",
        timeframe_data={"D": {"candles": [], "indicators": [], "fibonacci": None}},
        indicators_display=["EMA Stack"],
        indicator_names=["ema_9", "ema_21", "ema_50", "ema_200"],
        model="gemma4:26b",
    ):
        events.append(event)

    assert [event["type"] for event in events].count("token") == 2
    assert events[-1]["type"] == "done"
    assert events[-1]["signal"]["direction"] == "LONG"
    assert provider.calls[0]["kind"] == "stream"


@pytest.mark.asyncio
async def test_ai_service_warmup_routes_through_provider_registry():
    from services.ai_providers import AIProviderRegistry

    provider = StreamingFakeProvider()
    svc = AiService(provider_registry=AIProviderRegistry({"ollama": provider}))

    await svc.warmup("gemma4:26b")

    assert provider.calls == [{"kind": "warmup", "model": "gemma4:26b"}]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_registry.py::test_ai_service_analyze_stream_routes_through_provider_registry tests/test_ai_provider_registry.py::test_ai_service_warmup_routes_through_provider_registry -q
```

Expected: FAIL because `chat_stream()` and `warmup()` still use the old direct HTTP client.

- [ ] **Step 3: Delegate streaming and warmup**

In `backend/services/ai.py`, replace `chat_stream()` internals with:

```python
        provider = self._provider_registry.require("ollama")
        async for token in provider.chat_stream(
            messages=messages,
            model=model,
            think=think,
        ):
            yield token
```

Replace `warmup()` internals with:

```python
        provider = self._provider_registry.require("ollama")
        await provider.warmup(model=model)
```

Remove the now-unused `self._http` initialization from `AiService.__init__` only after all direct references are gone.

- [ ] **Step 4: Run focused compatibility tests**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_registry.py tests/test_ai_timeout.py tests/test_ai_warmup.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/ai.py backend/tests/test_ai_provider_registry.py
git commit -m "refactor: preserve ai streaming through provider registry"
```

## Task 1.3: Startup wiring uses an explicit local provider registry

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_ai_provider_registry.py`

- [ ] **Step 1: Add a construction smoke test**

Append to `backend/tests/test_ai_provider_registry.py`:

```python
def test_default_registry_exposes_local_ollama_provider():
    from services.ai_providers import AIProviderRegistry, OllamaLLMProvider

    registry = AIProviderRegistry({"ollama": OllamaLLMProvider()})

    assert registry.names() == ["ollama"]
    assert registry.require("ollama").name == "ollama"
```

- [ ] **Step 2: Run the smoke test**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_registry.py::test_default_registry_exposes_local_ollama_provider -q
```

Expected: PASS.

- [ ] **Step 3: Wire the provider registry in app startup**

In `backend/main.py`, add:

```python
from services.ai_providers import AIProviderRegistry, OllamaLLMProvider
```

Replace the current `AiService` construction:

```python
    ollama_context = OllamaContextService(ollama)
    ai_provider_registry = AIProviderRegistry({
        "ollama": OllamaLLMProvider(),
    })
    app.state.ai_provider_registry = ai_provider_registry
    ai = AiService(
        context_service=ollama_context,
        provider_registry=ai_provider_registry,
    )
    app.state.ai = ai
```

- [ ] **Step 4: Run Slice 1 backend checks**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_registry.py tests/test_ai_timeout.py tests/test_ai_warmup.py tests/test_ollama_context.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_ai_provider_registry.py
git commit -m "refactor: wire local ai provider registry at startup"
```

## Slice 1 Verification Gate

- [ ] Run backend focused checks:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_registry.py tests/test_ai_timeout.py tests/test_ai_warmup.py tests/test_ollama.py tests/test_ollama_context.py -q
```

Expected: PASS.

- [ ] Run formatting/lint if available locally:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_registry.py -q
```

Expected: PASS.

- [ ] Report:
  - Provider boundary exists.
  - Existing `AiService.analyze()` and `AiService.analyze_stream()` still produce parsed signals.
  - No cloud calls, DB changes, UI changes, or key-storage behavior were added.
  - Ask before moving to Slice 2.

---

# Appendix A: Superseded Backend-First Notes — Do Not Execute Directly

The original Slice 2 through Slice 10 notes below were written before Slice 1 revealed that the plan was too backend-heavy. They remain only as implementation reference. If a task below is useful, fold it into the revised vertical slice currently approved for execution.

## Superseded Slice 2: AFK — Provider Status Contracts and Local-Only UI Metadata

**Proof target:** The app can describe its AI provider state through backend contracts and show "Local Ollama" metadata without changing analysis behavior.

## Task 2.1: Backend provider status endpoint

**Files:**
- Modify: `backend/models/__init__.py`
- Modify: `backend/deps.py`
- Modify: `backend/routers/ai.py`
- Test: `backend/tests/test_ai_provider_routes.py`

- [ ] **Step 1: Write failing route tests**

Create `backend/tests/test_ai_provider_routes.py`:

```python
from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _client(ollama_status: dict) -> TestClient:
    from deps import get_ollama
    from routers.ai import router

    class FakeOllama:
        selected_model = ollama_status.get("selected_model")

        def status(self) -> dict:
            return ollama_status

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_ollama] = lambda: FakeOllama()
    return TestClient(app)


def test_get_ai_providers_returns_local_ollama_default():
    client = _client({
        "state": "ready",
        "ready": True,
        "selected_model": "gemma4:26b",
        "error": None,
        "platform": "darwin",
    })

    resp = client.get("/ai/providers")

    assert resp.status_code == 200
    assert resp.json() == {
        "providers": [
            {
                "provider_name": "ollama",
                "display_name": "Ollama",
                "kind": "local",
                "enabled": True,
                "ready": True,
                "selected_model": "gemma4:26b",
                "has_key": False,
                "error": None,
            }
        ],
        "active_provider": "ollama",
        "routing_mode": "local_only",
        "cloud_enabled": False,
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_routes.py -q
```

Expected: FAIL with 404 for `/ai/providers`.

- [ ] **Step 3: Add models**

In `backend/models/__init__.py`, add near the AI models:

```python
AIProviderName = Literal["ollama", "openai", "anthropic", "gemini", "grok"]
AIProviderKind = Literal["local", "cloud"]
AIRoutingMode = Literal[
    "local_only",
    "cloud_manual",
    "hybrid_auto",
    "cloud_with_local_fallback",
]


class AIProviderStatus(BaseModel):
    provider_name: AIProviderName
    display_name: str
    kind: AIProviderKind
    enabled: bool
    ready: bool
    selected_model: Optional[str] = None
    has_key: bool = False
    error: Optional[str] = None


class AIProvidersResponse(BaseModel):
    providers: list[AIProviderStatus]
    active_provider: AIProviderName
    routing_mode: AIRoutingMode
    cloud_enabled: bool
```

- [ ] **Step 4: Add endpoint**

In `backend/routers/ai.py`, import `AIProvidersResponse` and `AIProviderStatus`, then add:

```python
@router.get("/providers", response_model=AIProvidersResponse)
async def providers(
    ollama: OllamaLifecycle = Depends(get_ollama),
):
    """Return provider status. Slice 2 is local-only; cloud providers are added later."""
    status = ollama.status()
    return AIProvidersResponse(
        providers=[
            AIProviderStatus(
                provider_name="ollama",
                display_name="Ollama",
                kind="local",
                enabled=True,
                ready=bool(status.get("ready")),
                selected_model=status.get("selected_model"),
                has_key=False,
                error=status.get("error"),
            )
        ],
        active_provider="ollama",
        routing_mode="local_only",
        cloud_enabled=False,
    )
```

- [ ] **Step 5: Run test**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_routes.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/models/__init__.py backend/routers/ai.py backend/tests/test_ai_provider_routes.py
git commit -m "feat: expose local ai provider status"
```

## Task 2.2: Frontend provider metadata contract and local badge

**Files:**
- Modify: `src/modules/parallax/api.ts`
- Modify: `src/store/ai.ts`
- Modify: `src/hooks/useAiStatus.ts`
- Create: `src/components/ai/AiProviderBadge.tsx`
- Modify: `src/components/ai/AiChatPanel.tsx`
- Test: `src/components/ai/__tests__/AiProviderBadge.test.tsx`

- [ ] **Step 1: Write failing badge tests**

Create `src/components/ai/__tests__/AiProviderBadge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import AiProviderBadge from "../AiProviderBadge";

it("renders local Ollama provider metadata", () => {
  render(
    <AiProviderBadge
      providerName="ollama"
      model="gemma4:26b"
      kind="local"
      fallbackUsed={false}
      estimatedCost={null}
    />,
  );

  expect(screen.getByText("Local")).toBeInTheDocument();
  expect(screen.getByText("Ollama")).toBeInTheDocument();
  expect(screen.getByText("gemma4:26b")).toBeInTheDocument();
});

it("renders fallback metadata when present", () => {
  render(
    <AiProviderBadge
      providerName="ollama"
      model="gemma4:26b"
      kind="local"
      fallbackUsed
      estimatedCost={null}
    />,
  );

  expect(screen.getByText("Fallback")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/components/ai/__tests__/AiProviderBadge.test.tsx
```

Expected: FAIL because `AiProviderBadge` does not exist.

- [ ] **Step 3: Add frontend contract types**

In `src/modules/parallax/api.ts`, add:

```ts
export type AIProviderName = "ollama" | "openai" | "anthropic" | "gemini" | "grok";
export type AIProviderKind = "local" | "cloud";
export type AIRoutingMode =
  | "local_only"
  | "cloud_manual"
  | "hybrid_auto"
  | "cloud_with_local_fallback";

export interface AIProviderStatus {
  provider_name: AIProviderName;
  display_name: string;
  kind: AIProviderKind;
  enabled: boolean;
  ready: boolean;
  selected_model: string | null;
  has_key: boolean;
  error: string | null;
}

export interface AIProvidersResponse {
  providers: AIProviderStatus[];
  active_provider: AIProviderName;
  routing_mode: AIRoutingMode;
  cloud_enabled: boolean;
}

export interface AIRoutingPolicyResponse {
  routing_mode: AIRoutingMode;
  active_provider: AIProviderName;
  local_fallback_enabled: boolean;
  per_analysis_cost_cap: number | null;
  monthly_cost_cap: number | null;
  cloud_enabled: boolean;
}
```

Add API call:

```ts
aiProviders: () =>
  sidecarRequest<AIProvidersResponse>("GET", "/ai/providers"),
```

- [ ] **Step 4: Add provider state**

In `src/store/ai.ts`, import `AIProvidersResponse` and `AIProviderStatus`. Add state:

```ts
providers: AIProviderStatus[];
activeProvider: string;
routingMode: string;
cloudEnabled: boolean;
setProvidersStatus: (status: AIProvidersResponse) => void;
```

Initialize:

```ts
providers: [],
activeProvider: "ollama",
routingMode: "local_only",
cloudEnabled: false,
```

Add action:

```ts
setProvidersStatus: (status) =>
  set({
    providers: status.providers,
    activeProvider: status.active_provider,
    routingMode: status.routing_mode,
    cloudEnabled: status.cloud_enabled,
  }),
```

- [ ] **Step 5: Hydrate provider status**

In `src/hooks/useAiStatus.ts`, add a query:

```ts
const providersQuery = useQuery({
  queryKey: ["ai", "providers"],
  queryFn: () => parallaxApi.aiProviders(),
  staleTime: isReady ? 30_000 : 5_000,
  refetchInterval: isReady ? POLL_INTERVAL_READY : POLL_INTERVAL_SETUP,
});

useEffect(() => {
  if (providersQuery.data) {
    useAiStore.getState().setProvidersStatus(providersQuery.data);
  }
}, [providersQuery.data]);
```

- [ ] **Step 6: Create badge component**

Create `src/components/ai/AiProviderBadge.tsx`:

```tsx
import type { AIProviderKind, AIProviderName } from "@/modules/parallax/api";

const DISPLAY: Record<AIProviderName, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  grok: "Grok",
};

interface AiProviderBadgeProps {
  providerName: AIProviderName;
  model: string | null;
  kind: AIProviderKind;
  fallbackUsed: boolean;
  estimatedCost: number | null;
}

export default function AiProviderBadge({
  providerName,
  model,
  kind,
  fallbackUsed,
  estimatedCost,
}: AiProviderBadgeProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[9px] font-medium text-[var(--text-3)]">
      <span className="rounded border border-[var(--border)] px-1.5 py-0.5 uppercase">
        {kind === "local" ? "Local" : "Cloud"}
      </span>
      <span>{DISPLAY[providerName]}</span>
      {model && <span className="font-mono">{model}</span>}
      {fallbackUsed && (
        <span className="rounded border border-[var(--clr-amber)] px-1.5 py-0.5 text-[var(--clr-amber)]">
          Fallback
        </span>
      )}
      {estimatedCost != null && (
        <span className="font-mono">${estimatedCost.toFixed(4)}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run frontend focused tests**

Run:

```bash
npm test -- src/components/ai/__tests__/AiProviderBadge.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/parallax/api.ts src/store/ai.ts src/hooks/useAiStatus.ts src/components/ai/AiProviderBadge.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx
git commit -m "feat: expose local ai provider metadata in frontend state"
```

---

## Superseded Slice 3: HITL — Provider Settings Persistence Without Secrets

**Proof target:** Provider enablement, selected model, routing mode, fallback preference, and cost caps persist locally. API keys are not implemented in this slice.

## Task 3.1: Add provider config and usage tables

**Files:**
- Modify: `backend/services/db.py`
- Test: `backend/tests/test_ai_settings_service.py`
- Test: `backend/tests/test_db_migrations.py`

- [ ] **Step 1: Write failing DB tests**

Create `backend/tests/test_ai_settings_service.py`:

```python
import pytest

from services.db import DatabaseService


@pytest.mark.asyncio
async def test_ai_provider_config_round_trip(tmp_path):
    db = DatabaseService(str(tmp_path / "orbit.db"))
    await db.initialize()

    await db.upsert_ai_provider_config(
        provider_name="openai",
        display_name="OpenAI",
        enabled=True,
        selected_model="gpt-example",
        api_key_ref=None,
        routing_role="manual",
        settings_json='{"monthly_cap": 25}',
    )

    rows = await db.list_ai_provider_configs()

    assert rows == [
        {
            "id": rows[0]["id"],
            "provider_name": "openai",
            "display_name": "OpenAI",
            "enabled": 1,
            "selected_model": "gpt-example",
            "api_key_ref": None,
            "routing_role": "manual",
            "settings_json": '{"monthly_cap": 25}',
            "created_at": rows[0]["created_at"],
            "updated_at": rows[0]["updated_at"],
        }
    ]
    await db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_settings_service.py -q
```

Expected: FAIL because `upsert_ai_provider_config` and provider tables do not exist.

- [ ] **Step 3: Add tables**

In `backend/services/db.py` `_create_tables()`, add:

```sql
CREATE TABLE IF NOT EXISTS ai_provider_configs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_name  TEXT NOT NULL UNIQUE,
    display_name   TEXT NOT NULL,
    enabled        INTEGER NOT NULL DEFAULT 0,
    selected_model TEXT,
    api_key_ref    TEXT,
    routing_role   TEXT NOT NULL DEFAULT 'manual',
    settings_json  TEXT NOT NULL DEFAULT '{}',
    created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_usage_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_name       TEXT NOT NULL,
    model               TEXT NOT NULL,
    task_type           TEXT NOT NULL,
    routing_mode        TEXT NOT NULL,
    input_tokens        INTEGER,
    output_tokens       INTEGER,
    estimated_cost      REAL,
    currency            TEXT NOT NULL DEFAULT 'USD',
    status              TEXT NOT NULL,
    provider_request_id TEXT,
    error_code          TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_router_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type         TEXT NOT NULL,
    selected_provider TEXT NOT NULL,
    selected_model    TEXT,
    reason            TEXT NOT NULL,
    fallback_used     INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 4: Add DB methods**

In `backend/services/db.py`, add:

```python
    async def list_ai_provider_configs(self) -> list[dict[str, Any]]:
        return await self._run_read(
            lambda: self._fetchall(
                """
                SELECT *
                FROM ai_provider_configs
                ORDER BY provider_name ASC
                """
            )
        )

    async def upsert_ai_provider_config(
        self,
        *,
        provider_name: str,
        display_name: str,
        enabled: bool,
        selected_model: str | None,
        api_key_ref: str | None,
        routing_role: str,
        settings_json: str,
    ) -> None:
        def _do() -> None:
            assert self._conn is not None
            with self._conn:
                self._conn.execute(
                    """
                    INSERT INTO ai_provider_configs (
                        provider_name, display_name, enabled, selected_model,
                        api_key_ref, routing_role, settings_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(provider_name) DO UPDATE SET
                        display_name = excluded.display_name,
                        enabled = excluded.enabled,
                        selected_model = excluded.selected_model,
                        api_key_ref = excluded.api_key_ref,
                        routing_role = excluded.routing_role,
                        settings_json = excluded.settings_json,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        provider_name,
                        display_name,
                        1 if enabled else 0,
                        selected_model,
                        api_key_ref,
                        routing_role,
                        settings_json,
                    ),
                )

        await self._run_write(_do)
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_settings_service.py tests/test_db_migrations.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/db.py backend/tests/test_ai_settings_service.py backend/tests/test_db_migrations.py
git commit -m "feat: persist ai provider configuration"
```

## Task 3.2: Settings service and routing policy endpoints

**Files:**
- Create: `backend/services/ai_settings.py`
- Modify: `backend/models/__init__.py`
- Modify: `backend/routers/ai.py`
- Test: `backend/tests/test_ai_provider_routes.py`

- [ ] **Step 1: Add route tests**

Append to `backend/tests/test_ai_provider_routes.py`:

```python
def test_routing_policy_defaults_to_local_only():
    client = _client({
        "state": "ready",
        "ready": True,
        "selected_model": "gemma4:26b",
        "error": None,
        "platform": "darwin",
    })

    resp = client.get("/ai/routing-policy")

    assert resp.status_code == 200
    assert resp.json()["routing_mode"] == "local_only"
    assert resp.json()["local_fallback_enabled"] is True


def test_routing_policy_can_be_updated():
    client = _client_with_temp_db()

    resp = client.put(
        "/ai/routing-policy",
        json={
            "routing_mode": "hybrid_auto",
            "active_provider": "openai",
            "local_fallback_enabled": True,
            "per_analysis_cost_cap": 1.25,
            "monthly_cost_cap": 25.0,
            "cloud_enabled": True,
        },
    )

    assert resp.status_code == 200
    assert resp.json()["routing_mode"] == "hybrid_auto"
    assert client.get("/ai/routing-policy").json()["active_provider"] == "openai"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_routes.py::test_routing_policy_defaults_to_local_only -q
```

Expected: FAIL with 404.

- [ ] **Step 3: Add models**

In `backend/models/__init__.py`, add:

```python
class AIRoutingPolicyResponse(BaseModel):
    routing_mode: AIRoutingMode = "local_only"
    active_provider: AIProviderName = "ollama"
    local_fallback_enabled: bool = True
    per_analysis_cost_cap: Optional[float] = None
    monthly_cost_cap: Optional[float] = None
    cloud_enabled: bool = False
```

- [ ] **Step 4: Add service**

Create `backend/services/ai_settings.py`:

```python
"""AI provider settings and routing policy persistence."""
from __future__ import annotations

import json

from models import AIRoutingPolicyResponse
from services.db import DatabaseService


class AISettingsService:
    def __init__(self, db: DatabaseService) -> None:
        self._db = db

    async def get_routing_policy(self) -> AIRoutingPolicyResponse:
        raw = await self._db.get_setting("ai_routing_policy")
        if raw is None:
            return AIRoutingPolicyResponse()
        data = json.loads(raw)
        return AIRoutingPolicyResponse(**data)

    async def save_routing_policy(self, policy: AIRoutingPolicyResponse) -> AIRoutingPolicyResponse:
        await self._db.set_setting("ai_routing_policy", policy.model_dump_json())
        return policy
```

- [ ] **Step 5: Add endpoint**

In `backend/routers/ai.py`, add:

```python
from models import AIRoutingPolicyResponse
from services.ai_settings import AISettingsService
```

Add route:

```python
@router.get("/routing-policy", response_model=AIRoutingPolicyResponse)
async def routing_policy(db: DatabaseService = Depends(get_db)):
    return await AISettingsService(db).get_routing_policy()


@router.put("/routing-policy", response_model=AIRoutingPolicyResponse)
async def update_routing_policy(
    request: AIRoutingPolicyResponse,
    db: DatabaseService = Depends(get_db),
):
    return await AISettingsService(db).save_routing_policy(request)
```

Update route test client helper to override `get_db` with an initialized temp DB when testing routing policy.

- [ ] **Step 6: Run tests**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_routes.py tests/test_ai_settings_service.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/models/__init__.py backend/routers/ai.py backend/services/ai_settings.py backend/tests/test_ai_provider_routes.py
git commit -m "feat: add ai routing policy defaults"
```

---

## Superseded Slice 4: HITL — Key Storage and Provider Enablement

**Proof target:** A cloud provider can be enabled only after a key is saved to OS keychain. Keys are redacted from logs, responses, exceptions, and database rows.

Locked storage rule: use OS keychain only. SQLite stores `api_key_ref` and provider settings, never plaintext or encrypted API key material. If the keychain is unavailable, return a typed provider/key-storage error and leave cloud providers disabled while local Ollama remains available. Do not add an encrypted SQLite fallback.

## Task 4.1: OS keychain-backed key store

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/exceptions.py`
- Create: `backend/services/ai_keystore.py`
- Test: `backend/tests/test_ai_keystore.py`

- [ ] **Step 1: Add failing redaction and storage tests**

Create `backend/tests/test_ai_keystore.py`:

```python
from __future__ import annotations

from unittest.mock import MagicMock

import keyring
import pytest

from exceptions import AIKeyStoreUnavailableError
from services.ai_keystore import AIKeyStore, redact_secret


def test_redact_secret_masks_full_value():
    assert redact_secret("sk-test-123456") == "sk-t...3456"
    assert redact_secret("abcd") == "****"


def test_key_store_saves_reference_not_plaintext():
    backend = MagicMock()
    store = AIKeyStore(keyring_backend=backend)

    ref = store.save_key("openai", "sk-test-123456")

    assert ref == "orbit-ai/openai/api-key"
    backend.set_password.assert_called_once_with("orbit-ai", "openai/api-key", "sk-test-123456")


def test_key_store_unavailable_raises_typed_error():
    backend = MagicMock()
    backend.set_password.side_effect = keyring.errors.NoKeyringError("no backend")
    store = AIKeyStore(keyring_backend=backend)

    with pytest.raises(AIKeyStoreUnavailableError):
        store.save_key("openai", "sk-test-123456")
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_keystore.py -q
```

Expected: FAIL because `services.ai_keystore` does not exist.

- [ ] **Step 3: Add dependency**

In `backend/pyproject.toml`, add:

```toml
"keyring>=25.0.0",
```

- [ ] **Step 4: Add typed key-store error**

In `backend/exceptions.py`, add under the AI errors section:

```python
class AIKeyStoreUnavailableError(AIError):
    """OS keychain is unavailable, so cloud AI keys cannot be stored safely."""

    def __init__(self, message: str = "OS keychain is unavailable"):
        super().__init__(message)
```

- [ ] **Step 5: Add keystore**

Create `backend/services/ai_keystore.py`:

```python
"""Local secret storage for cloud AI provider API keys."""
from __future__ import annotations

import keyring

from exceptions import AIKeyStoreUnavailableError


SERVICE_NAME = "orbit-ai"


def redact_secret(value: str) -> str:
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}...{value[-4:]}"


class AIKeyStore:
    def __init__(self, keyring_backend=keyring) -> None:
        self._keyring = keyring_backend

    def save_key(self, provider_name: str, api_key: str) -> str:
        account = f"{provider_name}/api-key"
        try:
            self._keyring.set_password(SERVICE_NAME, account, api_key)
        except keyring.errors.KeyringError as exc:
            raise AIKeyStoreUnavailableError(
                "OS keychain is unavailable; cloud AI providers cannot be enabled."
            ) from exc
        return f"{SERVICE_NAME}/{account}"

    def get_key(self, provider_name: str) -> str | None:
        try:
            return self._keyring.get_password(SERVICE_NAME, f"{provider_name}/api-key")
        except keyring.errors.KeyringError as exc:
            raise AIKeyStoreUnavailableError(
                "OS keychain is unavailable; cloud AI providers cannot be used."
            ) from exc

    def delete_key(self, provider_name: str) -> None:
        try:
            self._keyring.delete_password(SERVICE_NAME, f"{provider_name}/api-key")
        except keyring.errors.PasswordDeleteError:
            return None
        except keyring.errors.KeyringError as exc:
            raise AIKeyStoreUnavailableError(
                "OS keychain is unavailable; cloud AI provider key was not removed."
            ) from exc
```

- [ ] **Step 6: Run tests**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_keystore.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/pyproject.toml backend/exceptions.py backend/services/ai_keystore.py backend/tests/test_ai_keystore.py
git commit -m "feat: add os keychain storage for ai provider keys"
```

## Task 4.2: Key save/delete endpoints

**Files:**
- Modify: `backend/models/__init__.py`
- Modify: `backend/deps.py`
- Modify: `backend/routers/ai.py`
- Test: `backend/tests/test_ai_provider_routes.py`

- [ ] **Step 1: Write endpoint tests**

Append to `backend/tests/test_ai_provider_routes.py`:

```python
import anyio


def test_save_provider_key_response_never_contains_secret():
    client = _client_with_db_and_keystore()

    resp = client.post("/ai/providers/openai/key", json={"api_key": "sk-test-123456"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["provider_name"] == "openai"
    assert body["has_key"] is True
    assert "sk-test" not in str(body)


def test_save_provider_key_fails_closed_when_keychain_unavailable():
    client, db = _client_with_unavailable_key_store()

    resp = client.post("/ai/providers/openai/key", json={"api_key": "sk-test-123456"})

    assert resp.status_code == 503
    assert resp.json()["detail"]["error"] == "ai_key_store_unavailable"
    rows = anyio.run(db.list_ai_provider_configs)
    assert rows == []
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_routes.py::test_save_provider_key_response_never_contains_secret -q
```

Expected: FAIL because the endpoint does not exist.

- [ ] **Step 3: Add request/response models**

In `backend/models/__init__.py`, add:

```python
class AIProviderKeySaveRequest(BaseModel):
    api_key: str = Field(min_length=8)


class AIProviderKeyResponse(BaseModel):
    provider_name: AIProviderName
    has_key: bool
    api_key_ref: Optional[str] = None
```

- [ ] **Step 4: Add key-store dependency**

In `backend/deps.py`, add:

```python
from services.ai_keystore import AIKeyStore


def get_ai_key_store() -> AIKeyStore:
    """Get the OS-keychain backed AI key store."""
    return AIKeyStore()
```

- [ ] **Step 5: Add route**

In `backend/routers/ai.py`, update imports:

```python
from fastapi import APIRouter, Depends, HTTPException, status

from deps import get_ai_key_store
from exceptions import AIKeyStoreUnavailableError
from services.ai_keystore import AIKeyStore
```

Add:

```python
@router.post("/providers/{provider_name}/key", response_model=AIProviderKeyResponse)
async def save_provider_key(
    provider_name: AIProviderName,
    request: AIProviderKeySaveRequest,
    db: DatabaseService = Depends(get_db),
    key_store: AIKeyStore = Depends(get_ai_key_store),
):
    try:
        key_ref = key_store.save_key(provider_name, request.api_key)
    except AIKeyStoreUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "ai_key_store_unavailable",
                "message": exc.message,
            },
        ) from exc

    await db.upsert_ai_provider_config(
        provider_name=provider_name,
        display_name=provider_name.title(),
        enabled=True,
        selected_model=None,
        api_key_ref=key_ref,
        routing_role="manual",
        settings_json="{}",
    )
    return AIProviderKeyResponse(
        provider_name=provider_name,
        has_key=True,
        api_key_ref=key_ref,
    )


@router.delete("/providers/{provider_name}/key", response_model=AIProviderKeyResponse)
async def delete_provider_key(
    provider_name: AIProviderName,
    db: DatabaseService = Depends(get_db),
    key_store: AIKeyStore = Depends(get_ai_key_store),
):
    try:
        key_store.delete_key(provider_name)
    except AIKeyStoreUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "ai_key_store_unavailable",
                "message": exc.message,
            },
        ) from exc

    await db.upsert_ai_provider_config(
        provider_name=provider_name,
        display_name=provider_name.title(),
        enabled=False,
        selected_model=None,
        api_key_ref=None,
        routing_role="manual",
        settings_json="{}",
    )
    return AIProviderKeyResponse(
        provider_name=provider_name,
        has_key=False,
        api_key_ref=None,
    )
```

- [ ] **Step 6: Run tests**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_keystore.py tests/test_ai_provider_routes.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/models/__init__.py backend/deps.py backend/routers/ai.py backend/tests/test_ai_provider_routes.py
git commit -m "feat: add cloud ai provider key endpoints"
```

---

## Superseded Slice 5: AFK — Hybrid Router Policy With Fake Providers

**Proof target:** Router blocks execution-sensitive tasks from cloud, chooses local by default, and only falls back on read-only analysis tasks when fallback is enabled.

## Task 5.1: Router policy service

**Files:**
- Create: `backend/services/ai_router.py`
- Test: `backend/tests/test_ai_router_policy.py`

- [ ] **Step 1: Write failing policy tests**

Create `backend/tests/test_ai_router_policy.py`:

```python
import pytest

from models import AIRoutingPolicyResponse
from services.ai_router import AICloudBlockedError, HybridInferenceRouter


def test_local_only_always_selects_ollama():
    router = HybridInferenceRouter(AIRoutingPolicyResponse(routing_mode="local_only"))

    decision = router.select_provider(task_type="deep_analysis", privacy_level="market")

    assert decision.provider_name == "ollama"
    assert decision.reason == "routing_mode_local_only"


def test_cloud_blocked_task_raises_even_in_hybrid():
    router = HybridInferenceRouter(AIRoutingPolicyResponse(routing_mode="hybrid_auto", cloud_enabled=True))

    with pytest.raises(AICloudBlockedError):
        router.select_provider(task_type="place_order", privacy_level="execution_sensitive")


def test_cloud_eligible_task_can_select_active_cloud_provider():
    router = HybridInferenceRouter(
        AIRoutingPolicyResponse(
            routing_mode="hybrid_auto",
            cloud_enabled=True,
            active_provider="openai",
        )
    )

    decision = router.select_provider(task_type="deep_analysis", privacy_level="market")

    assert decision.provider_name == "openai"
    assert decision.reason == "cloud_eligible_high_reasoning"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_router_policy.py -q
```

Expected: FAIL because `services.ai_router` does not exist.

- [ ] **Step 3: Add router policy**

Create `backend/services/ai_router.py`:

```python
from __future__ import annotations

from dataclasses import dataclass

from exceptions import AIError
from models import AIRoutingPolicyResponse, AIProviderName


class AICloudBlockedError(AIError):
    def __init__(self, task_type: str):
        self.task_type = task_type
        super().__init__(f"Cloud AI is blocked for task type: {task_type}")


@dataclass(frozen=True)
class AIRoutingDecision:
    provider_name: AIProviderName
    reason: str
    fallback_allowed: bool


LOCAL_ONLY_TASKS = {
    "schema_validation",
    "prompt_fact_rendering",
    "cached_market_summary",
    "account_data_shaping",
}

CLOUD_ELIGIBLE_TASKS = {
    "deep_analysis",
    "trade_thesis_critique",
    "risk_reward_variants",
    "multi_timeframe_synthesis",
    "follow_up_chat",
}

CLOUD_BLOCKED_TASKS = {
    "place_order",
    "arm_execution_plan",
    "modify_active_plan",
    "cancel_order",
    "increase_armed_plan_risk",
}


class HybridInferenceRouter:
    def __init__(self, policy: AIRoutingPolicyResponse) -> None:
        self._policy = policy

    def select_provider(self, *, task_type: str, privacy_level: str) -> AIRoutingDecision:
        if task_type in CLOUD_BLOCKED_TASKS or privacy_level == "execution_sensitive":
            raise AICloudBlockedError(task_type)
        if self._policy.routing_mode == "local_only" or task_type in LOCAL_ONLY_TASKS:
            return AIRoutingDecision(
                provider_name="ollama",
                reason="routing_mode_local_only",
                fallback_allowed=False,
            )
        if (
            self._policy.cloud_enabled
            and self._policy.routing_mode in {"hybrid_auto", "cloud_manual", "cloud_with_local_fallback"}
            and task_type in CLOUD_ELIGIBLE_TASKS
        ):
            return AIRoutingDecision(
                provider_name=self._policy.active_provider,
                reason="cloud_eligible_high_reasoning",
                fallback_allowed=self._policy.local_fallback_enabled,
            )
        return AIRoutingDecision(
            provider_name="ollama",
            reason="cloud_not_enabled",
            fallback_allowed=False,
        )
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_router_policy.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/ai_router.py backend/tests/test_ai_router_policy.py
git commit -m "feat: add hybrid ai routing policy"
```

---

## Superseded Slice 6: HITL — Cloud Provider Adapters With Mocked Network

**Proof target:** Provider adapters normalize OpenAI, Anthropic, Gemini, and Grok responses/streams behind the same provider protocol. No real keys or network calls are used in tests.

Before this slice, refresh official docs for the exact current API shapes:

- OpenAI Responses API: `https://platform.openai.com/docs/api-reference/responses/create`
- Anthropic Messages API: `https://docs.anthropic.com/en/api/messages`
- Gemini generate content API: `https://ai.google.dev/api/generate-content`
- xAI chat completions/models: `https://docs.x.ai/docs`

If any API shape differs from the adapter request bodies below, stop and update this plan before coding the adapters.

## Task 6.1: Cloud adapter request/response normalization

**Files:**
- Create: `backend/services/ai_cloud_adapters.py`
- Test: `backend/tests/test_ai_cloud_adapters.py`

- [ ] **Step 1: Write mocked adapter tests**

Create `backend/tests/test_ai_cloud_adapters.py`:

```python
import httpx
import pytest


@pytest.mark.asyncio
async def test_openai_adapter_normalizes_text_response():
    from services.ai_cloud_adapters import OpenAIProvider

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer sk-test"
        return httpx.Response(
            200,
            json={
                "id": "resp_123",
                "output": [
                    {
                        "content": [
                            {"type": "output_text", "text": "OpenAI narrative"}
                        ]
                    }
                ],
                "usage": {"input_tokens": 10, "output_tokens": 5},
            },
        )

    provider = OpenAIProvider(
        api_key_getter=lambda: "sk-test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    text = await provider.chat(
        messages=[{"role": "user", "content": "Analyze AAPL"}],
        model="configured-openai-model",
    )

    assert text == "OpenAI narrative"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_cloud_adapters.py -q
```

Expected: FAIL because `services.ai_cloud_adapters` does not exist.

- [ ] **Step 3: Add first adapter**

Create `backend/services/ai_cloud_adapters.py` with `OpenAIProvider` only first:

```python
from __future__ import annotations

from collections.abc import Callable

import httpx


class OpenAIProvider:
    name = "openai"

    def __init__(
        self,
        *,
        api_key_getter: Callable[[], str | None],
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key_getter = api_key_getter
        self._http = http_client or httpx.AsyncClient(base_url="https://api.openai.com/v1")

    async def chat(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        think: bool | None = None,
    ) -> str:
        api_key = self._api_key_getter()
        if not api_key:
            raise PermissionError("OpenAI API key is not configured")
        resp = await self._http.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "input": messages,
                "temperature": 0.3,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        parts: list[str] = []
        for item in data.get("output", []):
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    parts.append(content.get("text", ""))
        return "".join(parts)
```

- [ ] **Step 4: Add one mocked test per provider**

Extend `backend/tests/test_ai_cloud_adapters.py` with one test for `AnthropicProvider`, `GeminiProvider`, and `GrokProvider`. Each test asserts:

- auth header/query is present
- user message content is included
- adapter returns normalized plain text
- no real network call is made because `httpx.MockTransport` handles the request

- [ ] **Step 5: Implement remaining adapters**

In `backend/services/ai_cloud_adapters.py`, add:

- `AnthropicProvider`
- `GeminiProvider`
- `GrokProvider`

Each class must implement at least `chat(...)`. Add `chat_stream(...)` and `chat_structured(...)` only with mocked tests in this same task; do not expose streaming routes through cloud until streaming normalization tests pass.

- [ ] **Step 6: Run tests**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_cloud_adapters.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/ai_cloud_adapters.py backend/tests/test_ai_cloud_adapters.py
git commit -m "feat: add mocked cloud ai provider adapters"
```

---

## Superseded Slice 7: AFK — Usage Ledger and Cost Caps

**Proof target:** Every AI call can record provider/model/token/cost/status metadata locally, and cost caps block cloud calls before a provider request is sent.

## Task 7.1: Usage ledger service

**Files:**
- Create: `backend/services/ai_usage.py`
- Modify: `backend/services/db.py`
- Test: `backend/tests/test_ai_usage_ledger.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_ai_usage_ledger.py`:

```python
import pytest

from services.db import DatabaseService
from services.ai_usage import AIUsageLedger


@pytest.mark.asyncio
async def test_usage_ledger_records_ai_call(tmp_path):
    db = DatabaseService(str(tmp_path / "orbit.db"))
    await db.initialize()
    ledger = AIUsageLedger(db)

    await ledger.record(
        provider_name="openai",
        model="configured-openai-model",
        task_type="deep_analysis",
        routing_mode="hybrid_auto",
        input_tokens=100,
        output_tokens=50,
        estimated_cost=0.0123,
        status="success",
        provider_request_id="resp_123",
        error_code=None,
    )

    rows = await db.list_ai_usage(limit=10)
    assert rows[0]["provider_name"] == "openai"
    assert rows[0]["estimated_cost"] == 0.0123
    await db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_usage_ledger.py -q
```

Expected: FAIL because `AIUsageLedger` and `list_ai_usage` do not exist.

- [ ] **Step 3: Add DB methods and service**

Add `insert_ai_usage(...)` and `list_ai_usage(limit: int)` to `backend/services/db.py`, both using `_run_write` / `_run_read`.

Create `backend/services/ai_usage.py`:

```python
from __future__ import annotations

from services.db import DatabaseService


class AIUsageLedger:
    def __init__(self, db: DatabaseService) -> None:
        self._db = db

    async def record(
        self,
        *,
        provider_name: str,
        model: str,
        task_type: str,
        routing_mode: str,
        input_tokens: int | None,
        output_tokens: int | None,
        estimated_cost: float | None,
        status: str,
        provider_request_id: str | None,
        error_code: str | None,
    ) -> None:
        await self._db.insert_ai_usage(
            provider_name=provider_name,
            model=model,
            task_type=task_type,
            routing_mode=routing_mode,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost=estimated_cost,
            status=status,
            provider_request_id=provider_request_id,
            error_code=error_code,
        )
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_usage_ledger.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/db.py backend/services/ai_usage.py backend/tests/test_ai_usage_ledger.py
git commit -m "feat: record local ai usage metadata"
```

---

## Superseded Slice 8: HITL — Provider Settings UI

**Proof target:** User can view provider cards, see local-first status, enable/disable cloud providers, save/remove/test keys, choose models, configure routing mode, and view usage logs. No execution screen exposes model output as armed/executable.

## Task 8.1: AI providers settings component

**Files:**
- Create: `src/components/ai/AiProvidersSettings.tsx`
- Modify: `src/modules/parallax/api.ts`
- Modify: `src/pages/SettingsPage.tsx`
- Test: `src/components/ai/__tests__/AiProvidersSettings.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/components/ai/__tests__/AiProvidersSettings.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import AiProvidersSettings from "../AiProvidersSettings";

it("shows local-first status and provider cards", () => {
  render(
    <AiProvidersSettings
      providers={[
        {
          provider_name: "ollama",
          display_name: "Ollama",
          kind: "local",
          enabled: true,
          ready: true,
          selected_model: "gemma4:26b",
          has_key: false,
          error: null,
        },
        {
          provider_name: "openai",
          display_name: "OpenAI",
          kind: "cloud",
          enabled: false,
          ready: false,
          selected_model: null,
          has_key: false,
          error: null,
        },
      ]}
      routingMode="local_only"
      cloudEnabled={false}
      onSaveKey={() => undefined}
      onRemoveKey={() => undefined}
      onSetRoutingMode={() => undefined}
    />,
  );

  expect(screen.getByText("Local-first")).toBeInTheDocument();
  expect(screen.getByText("Ollama")).toBeInTheDocument();
  expect(screen.getByText("OpenAI")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/components/ai/__tests__/AiProvidersSettings.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement settings component**

Create `src/components/ai/AiProvidersSettings.tsx` with provider cards, local-first status, routing mode control, key save/remove controls, and a usage table whose rows come from props. Use existing shadcn/ui components from `src/components/ui/`. Do not hardcode secrets into component state after save; clear key input immediately after `onSaveKey` resolves.

- [ ] **Step 4: Wire settings page**

In `src/modules/parallax/api.ts`, add key/routing calls:

```ts
export interface AIProviderKeySaveRequest {
  api_key: string;
}

export interface AIProviderKeyResponse {
  provider_name: AIProviderName;
  has_key: boolean;
  api_key_ref: string;
}
```

Add to `parallaxApi`:

```ts
aiSaveProviderKey: (providerName: AIProviderName, req: AIProviderKeySaveRequest) =>
  sidecarRequest<AIProviderKeyResponse>("POST", `/ai/providers/${providerName}/key`, req),

aiDeleteProviderKey: (providerName: AIProviderName) =>
  sidecarRequest<AIProviderKeyResponse>("DELETE", `/ai/providers/${providerName}/key`),

aiSetRoutingPolicy: (req: AIRoutingPolicyResponse) =>
  sidecarRequest<AIRoutingPolicyResponse>("PUT", "/ai/routing-policy", req),
```

In `src/pages/SettingsPage.tsx`, import the component and mutations:

```tsx
import AiProvidersSettings from "@/components/ai/AiProvidersSettings";
import { useAiStore } from "@/store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parallaxApi, type AIProviderName, type AIRoutingMode } from "@/modules/parallax/api";
```

Inside `SettingsPage()`, read provider state:

```tsx
  const queryClient = useQueryClient();
  const {
    providers,
    routingMode,
    cloudEnabled,
  } = useAiStore();

  const refreshProviders = () => {
    void queryClient.invalidateQueries({ queryKey: ["ai", "providers"] });
    void queryClient.invalidateQueries({ queryKey: ["ai", "routing-policy"] });
  };

  const saveKeyMutation = useMutation({
    mutationFn: ({ providerName, apiKey }: { providerName: AIProviderName; apiKey: string }) =>
      parallaxApi.aiSaveProviderKey(providerName, { api_key: apiKey }),
    onSuccess: refreshProviders,
  });

  const removeKeyMutation = useMutation({
    mutationFn: (providerName: AIProviderName) =>
      parallaxApi.aiDeleteProviderKey(providerName),
    onSuccess: refreshProviders,
  });

  const routingMutation = useMutation({
    mutationFn: (mode: AIRoutingMode) =>
      parallaxApi.aiSetRoutingPolicy({
        routing_mode: mode,
        active_provider: "ollama",
        local_fallback_enabled: true,
        per_analysis_cost_cap: null,
        monthly_cost_cap: null,
        cloud_enabled: mode !== "local_only",
      }),
    onSuccess: refreshProviders,
  });
```

Render a new card after the Market Pulse card:

```tsx
        <SettingsCard title="AI Providers">
          <AiProvidersSettings
            providers={providers}
            routingMode={routingMode}
            cloudEnabled={cloudEnabled}
            onSaveKey={(providerName, apiKey) =>
              saveKeyMutation.mutate({ providerName, apiKey })
            }
            onRemoveKey={(providerName) => removeKeyMutation.mutate(providerName)}
            onSetRoutingMode={(mode) => routingMutation.mutate(mode)}
          />
        </SettingsCard>
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- src/components/ai/__tests__/AiProvidersSettings.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ai/AiProvidersSettings.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx src/modules/parallax/api.ts src/pages/SettingsPage.tsx
git commit -m "feat: add ai providers settings surface"
```

---

## Superseded Slice 9: AFK — AI Panel Provider/Cost/Fallback Metadata

**Proof target:** Analysis surfaces show provider/model/local-cloud/cost/fallback metadata from backend final events and responses.

## Task 9.1: Stream metadata contract

**Files:**
- Modify: `backend/models/__init__.py`
- Modify: `backend/routers/ai.py`
- Modify: `src/hooks/useAiAnalyzeStream.ts`
- Modify: `src/store/ai.ts`
- Test: `src/hooks/__tests__/useAiAnalyzeStream.test.ts`

- [ ] **Step 1: Write failing stream metadata test**

Add a test that feeds a final SSE frame:

```ts
{
  "type": "done",
  "session_id": "s1",
  "signal": null,
  "message": "Done",
  "provider": {
    "provider_name": "ollama",
    "model": "gemma4:26b",
    "kind": "local",
    "estimated_cost": null,
    "fallback_used": false
  }
}
```

Assert the AI store records provider metadata after `startAnalyze(...)`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/hooks/__tests__/useAiAnalyzeStream.test.ts
```

Expected: FAIL because provider metadata is ignored.

- [ ] **Step 3: Add backend final-event metadata**

Update `backend/routers/ai.py` stream final event path so `done` includes provider metadata:

```python
"provider": {
    "provider_name": "ollama",
    "model": model,
    "kind": "local",
    "estimated_cost": None,
    "fallback_used": False,
}
```

Later slices replace these constants with `HybridInferenceRouter` and `AIUsageLedger` metadata.

- [ ] **Step 4: Add frontend metadata storage**

Update `src/store/ai.ts` with `lastProviderMetadata` and `setLastProviderMetadata(...)`. Update `useAiAnalyzeStream.ts` to parse the optional `provider` object from the done event and store it.

- [ ] **Step 5: Render badge**

In `src/components/ai/AiChatPanel.tsx`, render `AiProviderBadge` near `ResponseTimeBadge` when `lastProviderMetadata` exists.

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- src/hooks/__tests__/useAiAnalyzeStream.test.ts src/components/ai/__tests__/AiChatPanel.test.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/routers/ai.py src/store/ai.ts src/hooks/useAiAnalyzeStream.ts src/components/ai/AiChatPanel.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts
git commit -m "feat: show ai provider metadata on analysis results"
```

---

## Superseded Slice 10: HITL — Manual Provider Smoke Tests

**Proof target:** With user-supplied keys, each cloud provider can run a read-only analysis test from settings without exposing keys or touching execution paths.

## Task 10.1: Manual smoke checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md` after smoke results
- Modify: `PROJECT_PLAN.md` after approved completion

- [ ] **Step 1: Confirm user-provided provider keys**

Ask the user which providers to smoke test. Do not ask for keys in chat. The user must paste keys only into the app's provider settings UI.

- [ ] **Step 2: Run local-only regression**

Run:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_registry.py tests/test_ai_router_policy.py tests/test_ai_usage_ledger.py -q
npm test -- src/components/ai/__tests__/AiProviderBadge.test.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Smoke one cloud provider at a time**

For each provider the user enabled:

1. Save key in settings.
2. Click provider test.
3. Run one read-only `deep_analysis` on a non-account ticker context.
4. Verify provider/model metadata appears.
5. Verify usage row appears.
6. Verify no API key appears in backend logs, frontend UI, request logs, or SQLite config rows.
7. Disable provider and verify `local_only` still works.

- [ ] **Step 4: Update docs after smoke**

Record only provider names, model names, date, pass/fail, and any typed error. Do not record prompts, responses, API keys, account data, or provider request bodies.

---

## Final Verification Before Completion

Run after the final approved slice:

```bash
cd backend && uv run python -m pytest tests/test_ai_provider_registry.py tests/test_ai_provider_routes.py tests/test_ai_settings_service.py tests/test_ai_keystore.py tests/test_ai_router_policy.py tests/test_ai_usage_ledger.py tests/test_ai_cloud_adapters.py -q
npm test -- src/components/ai/__tests__/AiProviderBadge.test.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts src/components/ai/__tests__/AiChatPanel.test.tsx
npm run typecheck
npm run build
```

Expected:

- Backend focused AI provider suite passes.
- Frontend focused AI provider suite passes.
- Typecheck passes.
- Build passes or any failure is documented as an unrelated existing baseline with evidence.

## Historical Implementation Handoff Prompt

This prompt records the original kickoff and must not be executed again. Use
the readiness verdict and current review gate above for branch status.

```text
You are implementing Orbit v2 Cloud + Hybrid AI in /Users/benarojasmac/Desktop/Projects/Orbit.

Start on branch feature/orbit-v2-cloud-hybrid-ai-spec. Read:
- AGENTS.md
- docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md
- docs/superpowers/plans/2026-06-15-orbit-v2-cloud-hybrid-ai.md

Use orbit-ai-workflow, parallax-backend, parallax-frontend, and superpowers:executing-plans or superpowers:subagent-driven-development.

Locked key-storage decision:
- Use OS keychain storage only for cloud AI provider API keys.
- SQLite stores provider configuration and opaque api_key_ref only.
- Never store plaintext or encrypted API key material in SQLite.
- If OS keychain is unavailable, cloud providers must stay disabled and local Ollama must remain available.
- Do not add an encrypted SQLite fallback.

Slice 1 has already been implemented. Execute Revised Slice 2 only:
1. Add local provider status contracts on the backend.
2. Add local provider metadata to the final /ai/analyze/stream done event.
3. Add frontend provider API/types, AI store fields, status hydration, and stream metadata parsing.
4. Add AiProviderBadge and render it in the AI panel for local Ollama metadata.
5. Run the Revised Slice 2 backend and frontend verification commands.
6. Stop and report what was proven. Do not implement settings persistence, key storage, cloud adapters, cost caps, OpenRouter calls, or additional providers until the user approves Revised Slice 3.

Follow TDD exactly: write the failing test, run it red, implement minimum code, run green, commit each task.
```
