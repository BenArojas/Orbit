# Orbit v2 Cloud + Hybrid AI Design

> Status: Draft for user review
> Branch: `feature/orbit-v2-cloud-hybrid-ai-spec`
> Date: 2026-06-05

## Goal

Add optional cloud AI and hybrid local/cloud inference to Orbit while preserving
the local-first product model. The cloud path improves analysis quality and
reasoning depth for users who explicitly opt in. It must not create any path for
AI to place, arm, modify, or cancel orders.

## Approved Policy

- Orbit remains local-first by default.
- Optional cloud AI is allowed only when explicitly enabled by the user.
- API keys stay local, encrypted, and never logged.
- Local Ollama remains the default and fallback provider.
- AI may draft analysis, trade-management ideas, and risk/reward variants.
- AI cannot mutate execution state or call order-placement paths.
- TWS Execution Assistant design is separate and belongs on its own branch/spec.

## Providers

v2 starts with these provider families:

- Ollama: local default and fallback.
- OpenAI: cloud frontier/reasoning provider.
- Anthropic: cloud frontier/reasoning provider.
- Gemini: cloud frontier/reasoning provider.
- Grok/xAI: cloud frontier/reasoning provider.

Model names, prices, limits, supported features, and SDK details must be loaded
from provider configuration or refreshed against official docs during
implementation. The architecture must not hardcode a single model as permanent.

Reference docs checked for this spec:

- OpenAI Responses API: https://developers.openai.com/api/reference/resources/responses/methods/create
- Anthropic API overview: https://platform.claude.com/docs/en/api/overview
- Gemini generate content API: https://ai.google.dev/api/generate-content
- xAI chat completions and model docs: https://docs.x.ai/developers/model-capabilities/legacy/chat-completions and https://docs.x.ai/developers/models

## Non-Goals

- No TWS implementation in this branch.
- No autonomous trading.
- No provider-specific prompt rewrites unless needed by adapter format.
- No cloud-only mode. Local Ollama remains usable without cloud setup.
- No exact long-term model/pricing table in source. Pricing changes too often.
- No raw uncontrolled app state sent to cloud models.

## Architecture

Cloud support is added behind a provider abstraction in the Python sidecar.
Frontend still talks only to FastAPI. Provider adapters are isolated from
routers and prompt builders.

Core backend services:

- `LLMProvider`: protocol for `chat`, `chat_stream`, `chat_structured`,
  `count_tokens` or token estimation, `list_models`, and `health_check`.
- `OllamaProvider`: wraps the existing local Ollama client.
- `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `GrokProvider`:
  cloud adapters with provider-specific auth, request format, streaming, and
  structured-output behavior.
- `AIProviderRegistry`: resolves active providers and validates capabilities.
- `AISettingsService`: stores enabled providers, selected models, routing mode,
  cost limits, and fallback preferences.
- `AIKeyStore`: stores local encrypted key references and returns secrets only
  to provider adapters at call time.
- `HybridInferenceRouter`: chooses local or cloud per task using policy,
  privacy level, expected cost, latency, context size, and required reasoning.
- `AIUsageLedger`: records provider, model, tokens, cost estimate, status, and
  provider request id when available.

The existing prompt-fact layer remains the boundary between Orbit data and LLM
input. Cloud providers receive structured facts, user-visible analysis context,
and explicit task instructions. They do not receive DB dumps, raw account state,
or order mutation tools.

## Routing Modes

Users can choose:

- `local_only`: Ollama only. No cloud calls.
- `cloud_manual`: user chooses a provider/model per analysis.
- `hybrid_auto`: router chooses local or cloud by task policy.
- `cloud_with_local_fallback`: cloud first, Ollama fallback on allowed failures.

Default after upgrade is `local_only`.

Hybrid task policy:

- Local-only tasks:
  - schema validation
  - prompt-fact rendering
  - cheap summaries of cached market context
  - account/order/execution-adjacent data shaping
  - any task marked private or execution-sensitive
- Cloud-eligible tasks:
  - deep technical-analysis narrative
  - trade thesis critique
  - risk/reward variant generation
  - multi-timeframe synthesis
  - follow-up chat over user-approved analysis context
- Cloud-blocked tasks:
  - placing orders
  - arming execution plans
  - modifying active plans
  - cancelling orders
  - increasing risk after a plan is armed

## Data Flow

1. User enables cloud AI in settings.
2. User adds provider key. The key is encrypted locally and never displayed
   again after save.
3. User selects provider/model defaults and optional cost caps.
4. Analysis request enters the existing `/ai/analyze` or streaming flow.
5. Backend builds structured prompt facts using existing services.
6. `HybridInferenceRouter` chooses provider according to mode and policy.
7. Provider adapter sends the request and streams or returns the response.
8. Backend validates structured output when required.
9. Usage is logged locally with request metadata and estimated cost.
10. Frontend displays provider/model/cost metadata in the AI panel.

## Storage

All database access remains inside `DatabaseService`; writes must use the
existing write-lock invariant.

Additive schema:

- `ai_provider_configs`
  - `id`
  - `provider_name`
  - `display_name`
  - `enabled`
  - `selected_model`
  - `api_key_ref`
  - `routing_role`
  - `settings_json`
  - `created_at`
  - `updated_at`
- `ai_usage_log`
  - `id`
  - `provider_name`
  - `model`
  - `task_type`
  - `routing_mode`
  - `input_tokens`
  - `output_tokens`
  - `estimated_cost`
  - `currency`
  - `status`
  - `provider_request_id`
  - `error_code`
  - `created_at`
- `ai_router_events`
  - `id`
  - `task_type`
  - `selected_provider`
  - `selected_model`
  - `reason`
  - `fallback_used`
  - `created_at`

Key material must not be stored in plaintext SQLite. Preferred design is OS
keychain storage with SQLite holding only `api_key_ref`. If implementation needs
an encrypted SQLite fallback, it must define key derivation and recovery before
code is written.

## Backend API

New or expanded endpoints:

- `GET /ai/providers`: provider status, enabled flags, selected models.
- `PUT /ai/providers/{provider_name}`: enable/disable provider and settings.
- `POST /ai/providers/{provider_name}/key`: save or replace API key.
- `DELETE /ai/providers/{provider_name}/key`: remove API key.
- `POST /ai/providers/{provider_name}/test`: validate auth and basic request.
- `GET /ai/providers/{provider_name}/models`: list configured/available models.
- `GET /ai/routing-policy`: read hybrid routing mode and task policy.
- `PUT /ai/routing-policy`: update mode, fallback, caps, and task overrides.
- `GET /ai/usage`: local usage/cost log for settings UI.

Existing `/ai/analyze`, `/ai/analyze_stream`, and AI chat endpoints should route
through the registry instead of calling Ollama directly.

## Frontend UX

Add an AI Providers settings surface:

- local-first status at the top
- provider cards for Ollama, OpenAI, Anthropic, Gemini, Grok
- explicit cloud enable switch
- API key save/remove/test controls
- selected model control per provider
- routing mode control
- local fallback toggle
- per-analysis and monthly cost cap controls
- usage table with provider/model/cost/status

AI analysis surfaces should show:

- provider and model used
- local/cloud badge
- estimated cost when cloud is used
- fallback indicator when fallback happened
- clear disabled state when cloud is not enabled

No execution screen should expose a model output as armed or executable.

## Error Handling

Use typed errors and map them to clear UI states:

- `AICloudDisabledError`
- `AIProviderAuthError`
- `AIProviderRateLimitError`
- `AIProviderNetworkError`
- `AIProviderTimeoutError`
- `AIProviderSchemaError`
- `AIProviderModelUnavailableError`
- `AIProviderCostLimitError`
- `AIProviderQuotaError`

Fallback to Ollama is allowed only for read-only analysis tasks and only when the
user enabled fallback. Do not fallback silently for tasks where provider choice
changes privacy expectations.

## Privacy and Logging

- Redact API keys from logs, exceptions, traces, and UI.
- Never log full prompts by default when cloud is enabled.
- Store usage metadata locally.
- Keep a user-visible "what will be sent" preview for cloud analysis when
  practical.
- Do not send raw executions, order payloads, or unbounded account data to cloud
  providers.
- Cloud calls for trade-planning ideas must receive only structured facts and
  user-approved risk context.

## Testing

Required test coverage:

- provider protocol conformance with fake providers
- key redaction in logs and errors
- settings persistence through `DatabaseService`
- router selection for all routing modes
- cloud-blocked task enforcement
- fallback behavior
- usage ledger writes
- cost cap blocking
- structured output validation per adapter
- streaming adapter event normalization
- frontend settings controls
- AI panel provider/cost/fallback display

Network calls must be mocked in tests. No test should require real provider keys.

## Implementation Order

1. Policy/docs update and spec approval.
2. Provider protocol and registry.
3. Ollama adapter migration to prove no behavior regression.
4. Settings storage and key-store abstraction.
5. Provider adapters for OpenAI, Anthropic, Gemini, and Grok with mocked tests.
6. Hybrid router and task-policy enforcement.
7. Usage ledger and cost cap enforcement.
8. Settings UI.
9. AI panel metadata display.
10. Manual provider smoke tests with user-supplied keys.

## Deferred

- TWS Execution Assistant.
- Provider-side tools/function calling beyond schema-constrained read-only output.
- Fine-tuning, batch APIs, files APIs, managed agents, or cloud sandboxes.
- Exact model recommendation UX beyond configurable defaults.
- Team/shared cloud credentials.
