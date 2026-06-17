# AI Run Inspector and OpenRouter Review Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenRouter analysis selectable, inspectable, cost-bounded, and comparable from the Analysis surface through a permanent user-facing AI Run Inspector.

**Architecture:** Keep credentials and all provider traffic in the FastAPI sidecar. Add an authenticated OpenRouter model-catalog path, an ephemeral analysis-preparation snapshot that owns the exact outbound body, and metadata-only run receipts in the existing usage ledger. The React Analysis panel selects the target and model, reviews the exact payload and cost before cloud execution, then displays the resulting receipt or a same-snapshot local comparison.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, httpx, SQLite, Decimal, pytest; React 19, TypeScript strict mode, Zustand, TanStack Query v5, Tailwind/shadcn Dialog and Tabs, Vitest and Testing Library; OpenRouter Chat Completions and Models APIs.

**Status:** Approved for execution on 2026-06-17. PROJECT_PLAN.md tracks the mission as IN PROGRESS. Execution starts with Slice 1 only.

## Global Constraints

- Orbit remains local-first. A local Ollama analysis stays one-click and makes no cloud request.
- A cloud request occurs only after the user explicitly selects OpenRouter and confirms the inspector preview.
- API keys remain in the OS keychain only. SQLite stores only the existing opaque api_key_ref.
- The frontend never calls OpenRouter, Ollama, or IBKR directly.
- Never send IBKR credentials, cookies, account state, portfolio state, orders, executions, SQLite rows, API keys, or arbitrary app state to OpenRouter.
- Cloud input is limited to the exact structured analysis messages already built from the selected symbol, timeframes, indicators, chart context, visible Fibonacci snapshots, and optional selected watchlist context.
- Exact prompts and outbound JSON are ephemeral. Persist only receipt and usage metadata.
- No AI tool or function calling, web search, file access, order mutation, plan arming, or autonomous trading.
- Use fixed OpenRouter model IDs with known text pricing and enforceable max_tokens. Do not expose openrouter/auto, openrouter/fusion, or other openrouter/* router aliases in this mission.
- OpenRouter requests use the existing httpx adapter. Do not introduce the beta OpenRouter SDK.
- Network tests use mocked httpx transports. No automated test requires a real provider key.
- Every slice is vertical, uses TDD through public routes/hooks/components, and ends with its own commit and verification gate.
- Stop after each slice and report what was proven before continuing.

---

## Readiness Verdict

The product decisions are resolved and the work is ready to execute after this plan is approved.

The current branch already contains provider settings, OS-keychain storage, request-scoped cloud adapters, routing, fallback, usage logging, and cost caps. The missing review workflow caused the observed failure:

~~~text
[stream] Running AI analysis for WULF (532497563) with openrouter/gemma4:e4b
POST https://openrouter.ai/api/v1/chat/completions -> 400 Bad Request
local Ollama fallback then completed
~~~

The frontend used the selected Ollama model as a fallback value for a cloud provider with no selected model. The backend also defaulted an unconfigured cloud route to openrouter/auto. The user could not select a valid OpenRouter model, inspect the outbound body, distinguish cloud success from local fallback, or compare outputs over the same input.

Execution precondition: preserve the current dirty worktree. Do not reset, revert, or overwrite existing remediation. Before the first implementation edit, inspect git status and confirm that the current cloud-AI remediation is intentionally part of this feature branch.

## Resolved Product Contract

### User stories

1. As a user, I can choose Local Ollama or OpenRouter from the Analysis panel before I run analysis.
2. As an OpenRouter user, I can choose only a model that my key and OpenRouter account settings make available.
3. Before a cloud call, I can see the exact model, exact JSON body, data categories leaving the machine, data kept local, expected cost, maximum cost, and fallback behavior.
4. After a run, I can see whether OpenRouter actually succeeded, which concrete model answered, the generation ID, tokens, actual cost, duration, and any fallback reason.
5. I can compare Ollama and OpenRouter using the same prepared messages without fetching or changing the market data between runs.
6. I can review recent metadata-only run receipts after the exact prompt has expired.

### UX ownership

- Settings owns API-key save/remove, provider enablement, default provider/model, and monthly/per-call caps.
- Analysis owns the per-run target, OpenRouter model, fallback choice, preflight review, run receipt, and comparison.
- The AI Run Inspector is a permanent wide Dialog opened from the Analysis panel. It uses four tabs: Summary, Payload, Receipt, Compare.
- Local target: Run Analysis executes immediately.
- OpenRouter target: Run Analysis becomes Review Cloud Run. The inspector opens on Summary; Send to OpenRouter is the only action that performs the cloud call.
- The Analysis header always shows the requested target/model. After completion it also shows the executed provider/model and an explicit Fallback badge when applicable.
- Do not show Hybrid auto. The current implementation has no policy engine that makes a meaningful automatic task decision.
- Cache the authenticated model catalog in TanStack Query for 10 minutes and provide an explicit refresh action. Persisted selection remains the default after restart.

### Routing semantics

- Local target maps to local_only.
- OpenRouter with fallback disabled maps to cloud_manual.
- OpenRouter with fallback enabled maps to cloud_with_local_fallback.
- Existing persisted hybrid_auto rows migrate to cloud_with_local_fallback when local_fallback_enabled is true, otherwise cloud_manual.
- The backend rejects a cloud run with no validated selected model. It never substitutes the local Ollama model and never silently chooses openrouter/auto.

### Payload and retention semantics

- Preview prepares market facts and the exact system/user messages once.
- Preview returns an opaque snapshot_id with a 10-minute TTL.
- The in-memory snapshot cache holds at most 20 snapshots and evicts expired/oldest entries.
- A cloud run requires snapshot_id and executes the exact prepared messages/body. It does not refetch IBKR data or rebuild the prompt.
- The Payload tab shows the exact JSON body, excluding HTTP headers. Authorization is never returned to the frontend.
- The disclosure summary is derived from the prepared request, not manually entered UI copy.
- Snapshot contents are never written to SQLite or logs.
- Historical receipts remain available, but their Payload tab explains that exact prompt content expired by design.

### Cost semantics

- Catalog pricing strings are parsed with Decimal.
- Selectable models must support text input, text output, max_tokens, a positive context window, and numeric non-negative prompt/completion/request pricing.
- Each request sets max_tokens to the lesser of 4096, the model endpoint limit, and remaining model context.
- Estimated cost uses estimated input tokens plus an expected output allowance of min(1024, max_tokens).
- Maximum cost uses estimated input tokens plus the full max_tokens allowance.
- Per-call and projected monthly caps are checked against maximum cost before the request.
- Actual cost and native token counts come from OpenRouter usage in the final response or final SSE chunk.
- UI copy is compact: Estimated ~$0.0032, Max $0.0118. Actual $0.0027 appears after completion.

### Comparison semantics

- Compare runs one local Ollama attempt and one OpenRouter attempt over the same prepared messages.
- The prepared prompt budget remains within the existing 3,500-token Orbit analysis budget so both targets receive identical input.
- Market data is fetched once, not once per model.
- Comparison shows outputs and objective completeness checks only: response completed, signal parsed, entry/stop/target present, checks present, narrative length, latency, and cost.
- Orbit does not claim that one trading opinion is correct, does not auto-score profitability, and does not persist subjective ratings in this mission.

## OpenRouter Documentation Contract

The executor must re-open these official pages before implementing the adapter and cite the checked date in the final implementation report:

- Authenticated model catalog: https://openrouter.ai/docs/api/api-reference/models/list-models-user
- Model fields and pricing: https://openrouter.ai/docs/api/api-reference/models/get-models
- Chat request/response schema: https://openrouter.ai/docs/api/reference/overview
- Usage accounting and final streaming usage: https://openrouter.ai/docs/cookbook/administration/usage-accounting
- Generation metadata: https://openrouter.ai/docs/api/api-reference/generations/get-generation
- Provider logging/privacy: https://openrouter.ai/docs/guides/privacy/provider-logging
- Fusion router behavior and cost: https://openrouter.ai/docs/guides/routing/routers/fusion-router

Implementation rules derived from those docs:

- Fetch GET /api/v1/models/user with bearer authentication so the catalog respects the user's provider preferences, privacy settings, and guardrails.
- Do not send deprecated usage.include or stream_options.include_usage flags; usage is returned automatically.
- Capture id and model from the provider response. The response model is the concrete model that handled the request.
- Parse prompt_tokens, completion_tokens, total_tokens, cost, cached tokens, and reasoning tokens when present.
- The final streaming chunk may have an empty choices array and contains usage exactly once before [DONE].
- The generation endpoint is optional audit enrichment only. Normal receipt completion must not require a second network call.
- OpenRouter provider data-retention and training policies vary. The inspector links to OpenRouter privacy settings and accurately says the authenticated catalog reflects account preferences; Orbit must not promise zero retention unless the selected endpoint guarantees it.
- openrouter/fusion is out of scope because it auto-injects a deliberation tool, invokes multiple models, enables web search/fetch for panel and judge calls, and costs roughly 4-5 times a single completion by default.

## Policy Impact

**Proposed active-design correction; no AGENTS.md or CLAUDE.md rule change expected.**

The existing approved rules already cover local-first behavior, explicit cloud opt-in, keychain-only secrets, no autonomous trading, and no AI tools/order mutation. This plan corrects active design and UI claims:

- Remove hybrid_auto from the supported routing contract until a real task router exists.
- Record that OpenRouter fixed models are supported while dynamic router aliases are deferred.
- Record that exact prompt previews are ephemeral and receipt history is metadata-only.
- Record that openrouter/fusion requires a separate policy/spec review because it introduces tools and web access.

After this plan is approved, use project-plan-update before coding to mark the AI Run Inspector mission IN PROGRESS in PROJECT_PLAN.md and link this plan. In Slice 5, update the active cloud design, active cloud implementation plan, and PROJECT_PLAN.md with the verified final behavior and completion status. Run policy-drift-check. Do not edit mirrored skills unless the merge-gate audit finds an actual rule mismatch.

## Out of Scope

- OpenRouter auto, Fusion, Pareto, free-model, or other dynamic routers.
- Provider-side tools, plugins, web search, web fetch, files, image/audio input, or structured tool calls.
- Direct OpenAI, Anthropic, Gemini, or Grok model catalogs and per-run selectors.
- Persistent prompt/completion storage, prompt logging, screenshots, chart images, or full account data.
- Automated model recommendations, benchmark rankings, profitability scoring, or model quality leaderboards.
- Billing reconciliation beyond OpenRouter response usage and optional generation metadata.
- Changes to signal logic, trading rules, order workflows, or execution safety.

---

## File Structure

### Backend

- Modify backend/models/__init__.py: model catalog, preview, disclosure, receipt, comparison, and expanded provider metadata contracts.
- Modify backend/services/ai_cloud_adapters.py: authenticated model listing, fixed request body, final-chunk metadata normalization, concrete model and token/cost capture.
- Modify backend/services/ai_settings.py: validated selected-model persistence and routing-mode migration.
- Modify backend/services/ai.py: expose prepared-message execution through a small public method while preserving session/signal parsing.
- Create backend/services/ai_analysis_preparation.py: fetch-independent preparation snapshot cache, exact body construction, disclosure derivation, and Decimal cost quote.
- Modify backend/services/ai_usage.py: receipt-oriented attempt recording and grouped metadata history.
- Modify backend/services/db.py: additive receipt columns and grouped recent-run reads through DatabaseService.
- Modify backend/routers/ai.py: thin model, preview, execution, receipt, and comparison routes; move preparation orchestration out of the router.
- Modify backend/deps.py and backend/main.py: construct and expose the preparation service.
- Modify backend/tests/test_ai_cloud_adapters.py: OpenRouter catalog/body/final usage behavior.
- Modify backend/tests/test_ai_provider_routes.py: public model, preview, run, receipt, and compare route behavior.
- Modify backend/tests/test_ai_settings_service.py: selected-model validation persistence and hybrid_auto migration.
- Modify backend/tests/test_ai_usage_ledger.py: receipt grouping, fallback attempts, and metadata-only persistence.
- Create backend/tests/test_ai_analysis_preparation.py: snapshot TTL, exact body, disclosure, and cost behavior through the public service.

### Frontend

- Modify src/modules/parallax/api.ts: model, preview, receipt, comparison contracts and sidecar calls.
- Modify src/store/ai.ts: per-run target/model/fallback and current receipt state.
- Modify src/hooks/useAiStatus.ts: unified TanStack keys and OpenRouter model/default hydration.
- Modify src/hooks/useAiAnalyzeStream.ts: snapshot execution plus typed SSE error/receipt handling.
- Create src/hooks/useAiRunInspector.ts: preview, recent receipt, and comparison queries/mutations.
- Create src/components/ai/AiAnalysisTargetControls.tsx: per-run Local/OpenRouter/model/fallback controls.
- Create src/components/ai/AiRunInspectorDialog.tsx: Summary/Payload/Receipt/Compare user surface.
- Modify src/components/ai/AiProviderBadge.tsx: requested versus executed model, generation/cost/fallback status.
- Modify src/components/ai/AiChatPanel.tsx: integrate target controls and inspector; remove local-model leakage into cloud requests.
- Modify src/components/ai/AiProvidersSettings.tsx: defaults/caps only, remove Hybrid auto, correct stale local-only copy.
- Create src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx.
- Create src/components/ai/__tests__/AiRunInspectorDialog.test.tsx.
- Modify src/components/ai/__tests__/AiChatPanel.test.tsx.
- Modify src/components/ai/__tests__/AiProvidersSettings.test.tsx.
- Modify src/hooks/__tests__/useAiAnalyzeStream.test.ts.
- Create src/hooks/__tests__/useAiRunInspector.test.ts.

## Deep Module Boundaries

### OpenRouterProvider

Small interface:

~~~python
async def list_models(self) -> list[OpenRouterModel]:
    raise NotImplementedError

async def chat_with_metadata(
    self,
    *,
    messages: list[dict[str, str]],
    model: str,
    max_tokens: int,
) -> AIProviderTextResult:
    raise NotImplementedError

async def chat_stream_with_metadata(
    self,
    *,
    messages: list[dict[str, str]],
    model: str,
    max_tokens: int,
) -> AsyncIterator[dict[str, Any]]:
    raise NotImplementedError
~~~

It hides auth headers, OpenRouter JSON parsing, status mapping, streaming edge cases, Decimal-compatible pricing strings, concrete-model resolution, and usage normalization. Only provider construction code and tests import the concrete adapter.

### AIAnalysisPreparationService

Small interface:

~~~python
async def prepare(
    self,
    request: AnalyzeRequest,
    *,
    provider_name: AIProviderName,
    model: AIModelOption,
    local_model: str | None,
) -> PreparedAnalysisSnapshot:
    raise NotImplementedError

def get_snapshot(self, snapshot_id: str) -> PreparedAnalysisSnapshot:
    raise NotImplementedError
~~~

It hides indicator-name resolution, one-time IBKR-derived timeframe preparation through injected collaborators, prompt construction, exact body generation, disclosure, token estimation, cost calculation, TTL, and eviction. The route stays responsible for dependency injection and HTTP error mapping.

### AIUsageLedger

Extend the existing interface instead of adding a shallow receipt service:

~~~python
async def record_attempt(self, attempt: AIRunAttemptWrite) -> int:
    raise NotImplementedError

async def list_run_receipts(self, *, limit: int = 50) -> list[AIRunReceipt]:
    raise NotImplementedError
~~~

It hides additive SQLite rows, run grouping, failed-cloud-plus-local-fallback accounting, and metadata-only history. Routers do not issue SQL.

### AiRunInspectorDialog

Pure UI interface:

~~~ts
interface AiRunInspectorDialogProps {
  open: boolean;
  preview: AIAnalysisPreview | null;
  receipt: AIRunReceipt | null;
  comparison: AIComparisonResult | null;
  isRunning: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
  onCompare(): void;
}
~~~

The component renders state only. useAiRunInspector owns TanStack Query/mutation behavior and AiChatPanel owns per-run user intent.

---

## Execution Initialization After Approval

- [x] Read the project-plan-update skill.
- [x] Update PROJECT_PLAN.md before implementation to mark this mission IN PROGRESS and link docs/superpowers/plans/2026-06-17-ai-run-inspector-openrouter-review.md.
- [x] Preserve all existing PROJECT_PLAN.md edits in the dirty worktree; do not replace or normalize unrelated sections.
- [ ] Re-run git status and begin Slice 1 only.

## Slice 1: AFK - Select a Valid OpenRouter Model and Prove the Real Route

**Proof target:** From Analysis, the user selects OpenRouter and an authenticated fixed model; the next mocked stream request uses that exact model and can no longer send an Ollama model or silently default to openrouter/auto.

**Interfaces produced:**

~~~python
class AIModelOption(BaseModel):
    id: str
    name: str
    context_length: int
    max_completion_tokens: int
    prompt_price_per_token: str
    completion_price_per_token: str
    request_price: str

class AIProviderModelsResponse(BaseModel):
    provider_name: Literal["openrouter"]
    models: list[AIModelOption]
    selected_model: str | None
    fetched_at: datetime

class AIProviderModelUpdateRequest(BaseModel):
    model: str
~~~

Routes:

~~~text
GET /ai/providers/openrouter/models
PUT /ai/providers/openrouter/model
~~~

- [ ] **Step 1: Write failing OpenRouter catalog adapter tests**

In backend/tests/test_ai_cloud_adapters.py, add mocked tests proving:

~~~python
async def test_openrouter_list_models_uses_authenticated_user_catalog():
    assert request.method == "GET"
    assert request.url.path == "/api/v1/models/user"
    assert request.headers["authorization"] == "Bearer test-key"

async def test_openrouter_list_models_keeps_only_fixed_priced_text_models():
    models = await provider.list_models()
    assert [model.id for model in models] == ["anthropic/claude-sonnet-4"]
    assert models[0].max_completion_tokens == 4096
~~~

The fixture must include one valid fixed text model, openrouter/auto, openrouter/fusion, an image-only model, a model without max_tokens, and a model with unknown pricing.

- [ ] **Step 2: Run the adapter tests red**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_cloud_adapters.py -q
~~~

Expected: FAIL because OpenRouterProvider.list_models and the typed catalog model do not exist.

- [ ] **Step 3: Implement the minimum catalog adapter**

Add the typed internal OpenRouterModel dataclass and list_models method. GET /api/v1/models/user with _headers(). Parse architecture, supported_parameters, top_provider.max_completion_tokens, context_length, and pricing. Exclude IDs beginning with openrouter/ and models that fail the resolved selection rules.

Use Decimal only for validation; preserve API price strings in response contracts.

- [ ] **Step 4: Run the adapter tests green**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write failing public route and persistence tests**

In backend/tests/test_ai_provider_routes.py and backend/tests/test_ai_settings_service.py, prove:

~~~python
def test_openrouter_models_returns_user_filtered_catalog_and_selected_model():
    response = client.get("/ai/providers/openrouter/models")
    assert response.status_code == 200
    assert response.json()["models"][0]["id"] == "anthropic/claude-sonnet-4"

def test_select_openrouter_model_rejects_model_missing_from_catalog():
    response = client.put(
        "/ai/providers/openrouter/model",
        json={"model": "gemma4:e4b"},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "ai_provider_model_unavailable"

def test_cloud_route_requires_a_validated_selected_model():
    response = client.post("/ai/analyze/stream", json=cloud_request_without_model)
    assert response.status_code == 409
~~~

Also prove hybrid_auto persistence migration and that no backend path defaults to openrouter/auto.

- [ ] **Step 6: Run route/settings tests red**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_provider_routes.py tests/test_ai_settings_service.py -q
~~~

Expected: FAIL on missing routes, unsupported migration, and current default behavior.

- [ ] **Step 7: Implement catalog routes and validated persistence**

Add thin routes that resolve the key from AIKeyStore, create a request-scoped OpenRouterProvider, list/validate models, persist only selected_model through AISettingsService, and close the provider in finally.

Remove openrouter/auto from _resolve_analysis_routing. If request.model is absent, use only the persisted validated model. If neither exists, raise typed 409 ai_provider_model_required.

Migrate hybrid_auto in DatabaseService initialization before returning routing policy.

- [ ] **Step 8: Run backend tests green**

Run the Step 6 command plus:

~~~bash
cd backend
uv run python -m pytest tests/test_ai_cloud_adapters.py tests/test_ai_provider_registry.py -q
~~~

Expected: PASS.

- [ ] **Step 9: Write failing frontend target-control tests**

Add AiAnalysisTargetControls tests proving Local and OpenRouter are explicit segmented choices, OpenRouter models come from the sidecar, model selection persists, fallback is a toggle, and no Hybrid auto option is rendered.

Update AiChatPanel test to prove:

~~~ts
expect(streamRequest.provider_name).toBe("openrouter");
expect(streamRequest.model).toBe("anthropic/claude-sonnet-4");
expect(streamRequest.model).not.toBe("gemma4:e4b");
~~~

- [ ] **Step 10: Run frontend tests red**

~~~bash
npm test -- src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx
~~~

Expected: FAIL because the controls and model-query path do not exist.

- [ ] **Step 11: Implement the Analysis target controls**

Create AiAnalysisTargetControls using existing shadcn controls and lucide icons. Keep server data in TanStack Query and per-run selections in Zustand. Settings remains the default source, but changing the Analysis selection changes the next run only.

Change resolveAnalysisRoute so a cloud provider never falls back to selectedModel. Disable Review Cloud Run until a validated cloud model exists. Remove Hybrid auto from Settings and correct the copy that says execution remains local-only.

- [ ] **Step 12: Run frontend and build verification**

~~~bash
npm test -- src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx
npm run build
git diff --check
~~~

Expected: all commands pass.

- [ ] **Step 13: Commit Slice 1**

~~~bash
git add backend/models/__init__.py backend/routers/ai.py backend/services/ai_cloud_adapters.py backend/services/ai_settings.py backend/services/db.py backend/tests/test_ai_cloud_adapters.py backend/tests/test_ai_provider_routes.py backend/tests/test_ai_settings_service.py src/modules/parallax/api.ts src/store/ai.ts src/hooks/useAiStatus.ts src/components/ai/AiAnalysisTargetControls.tsx src/components/ai/AiChatPanel.tsx src/components/ai/AiProvidersSettings.tsx src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx
git commit -m "feat: select validated OpenRouter models from analysis"
~~~

**Checkpoint:** Stop. Report the exact tests and demonstrate that the request model is the selected OpenRouter model.

---

## Slice 2: AFK - Preview the Exact Cloud Payload and Cost Before Sending

**Proof target:** Review Cloud Run prepares one snapshot and opens the inspector with truthful Summary and Payload tabs; Send to OpenRouter executes that exact snapshot without refetching market data.

**Interfaces produced:**

~~~python
class AIDataDisclosure(BaseModel):
    sent_to_cloud: list[str]
    kept_local: list[str]
    exact_payload_available_until: datetime

class AICostQuote(BaseModel):
    currency: Literal["USD"] = "USD"
    estimated_input_tokens: int
    expected_output_tokens: int
    max_output_tokens: int
    estimated_cost_usd: str
    maximum_cost_usd: str

class AIAnalysisPreviewResponse(BaseModel):
    snapshot_id: str
    expires_at: datetime
    provider_name: Literal["openrouter"]
    model: AIModelOption
    request_body: dict[str, Any]
    disclosure: AIDataDisclosure
    cost: AICostQuote
    fallback_enabled: bool
~~~

Route:

~~~text
POST /ai/analysis/preview
~~~

- [ ] **Step 1: Write failing preparation-service tests**

Create backend/tests/test_ai_analysis_preparation.py. Through AIAnalysisPreparationService.prepare/get_snapshot, prove:

~~~python
snapshot = await service.prepare(request, provider_name="openrouter", model=model, local_model="gemma4:e4b")

assert snapshot.request_body == {
    "model": "anthropic/claude-sonnet-4",
    "messages": snapshot.messages,
    "stream": True,
    "max_tokens": 4096,
}
assert "IBKR credentials" in snapshot.disclosure.kept_local
assert snapshot.cost.maximum_cost_usd == Decimal("0.0118")
assert service.get_snapshot(snapshot.snapshot_id) is snapshot
~~~

Use a fake clock to prove 10-minute expiry, 20-entry eviction, and that no prompt is written to DatabaseService.

- [ ] **Step 2: Run preparation tests red**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_analysis_preparation.py -q
~~~

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Extract prompt preparation behind the public service**

Move analysis data/prompt preparation currently embedded in backend/routers/ai.py and AiService private flow behind AIAnalysisPreparationService. Preserve public analysis output behavior.

Add an AiService public execution method:

~~~python
async def analyze_prepared_stream(
    self,
    *,
    snapshot: PreparedAnalysisSnapshot,
    provider: LLMProvider,
    fallback_provider: LLMProvider | None,
) -> AsyncIterator[dict[str, Any]]:
    raise NotImplementedError
~~~

The method owns session creation, streaming, signal parse/reformat, and fallback. It must not fetch IBKR data or rebuild messages.

- [ ] **Step 4: Run service and existing AI regression tests**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_analysis_preparation.py tests/test_ai_timeout.py tests/test_ai_with_fibs.py tests/test_ai_confidence.py -q
~~~

Expected: PASS.

- [ ] **Step 5: Write failing preview/run route tests**

In test_ai_provider_routes.py, prove:

~~~python
def test_preview_returns_exact_body_disclosure_and_cost_without_calling_openrouter():
    response = client.post("/ai/analysis/preview", json=request)
    assert response.status_code == 200
    assert response.json()["request_body"]["model"] == "anthropic/claude-sonnet-4"
    assert cloud_transport.calls == []

def test_cloud_stream_executes_snapshot_without_second_market_fetch():
    preview = client.post("/ai/analysis/preview", json=request).json()
    stream = client.post("/ai/analyze/stream", json={"snapshot_id": preview["snapshot_id"]})
    assert stream.status_code == 200
    assert ibkr.history_call_count == 1
    assert cloud_transport.last_json == preview["request_body"]

def test_cloud_stream_rejects_expired_snapshot():
    assert response.status_code == 410
    assert response.json()["detail"]["error"] == "ai_analysis_snapshot_expired"
~~~

Also prove maximum cost, not the expected estimate, enforces per-call/monthly caps.

- [ ] **Step 6: Run route tests red**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_provider_routes.py tests/test_ai_usage_ledger.py -q
~~~

Expected: FAIL on missing preview and snapshot execution.

- [ ] **Step 7: Implement preview and exact-snapshot execution**

Construct AIAnalysisPreparationService in main.py and expose it in deps.py. Keep router functions thin. Add typed 404 unknown snapshot, 410 expired snapshot, 409 model changed, and 422 model/context/cost errors.

Update OpenRouterProvider methods to accept max_tokens and produce the exact request body returned in preview. Do not add debug.echo_upstream_body, tools, plugins, or usage flags.

- [ ] **Step 8: Run backend tests green**

Run the Step 6 command plus test_ai_cloud_adapters.py.

Expected: PASS.

- [ ] **Step 9: Write failing inspector Summary/Payload tests**

Add AiRunInspectorDialog and useAiRunInspector tests proving:

- Review Cloud Run calls preview but does not call analyze/stream.
- Summary shows provider, model, estimated cost, maximum cost, fallback, expiry, sent categories, and kept-local categories.
- Payload renders the exact JSON body with messages and no Authorization/API key.
- Send to OpenRouter passes only snapshot_id to the stream hook.
- Closing without confirmation makes no cloud request.

- [ ] **Step 10: Run frontend tests red**

~~~bash
npm test -- src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/hooks/__tests__/useAiRunInspector.test.ts src/components/ai/__tests__/AiChatPanel.test.tsx
~~~

Expected: FAIL because preview/inspector behavior does not exist.

- [ ] **Step 11: Implement the permanent inspector preview**

Use the existing shadcn Dialog and Tabs; do not add a drawer dependency. Use a constrained wide desktop layout and full-screen mobile dialog. Payload uses a read-only monospaced pre block with copy icon and tooltip. Keep all server calls in useAiRunInspector/useAiAnalyzeStream.

Local Run Analysis bypasses preview. OpenRouter Review Cloud Run opens Summary. The primary dialog action is Send to OpenRouter and states the maximum charge.

- [ ] **Step 12: Run Slice 2 verification**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_analysis_preparation.py tests/test_ai_provider_routes.py tests/test_ai_cloud_adapters.py tests/test_ai_usage_ledger.py -q
cd ..
npm test -- src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/hooks/__tests__/useAiRunInspector.test.ts src/hooks/__tests__/useAiAnalyzeStream.test.ts src/components/ai/__tests__/AiChatPanel.test.tsx
npm run build
git diff --check
~~~

Expected: all commands pass.

- [ ] **Step 13: Commit Slice 2**

~~~bash
git add backend/models/__init__.py backend/main.py backend/deps.py backend/routers/ai.py backend/services/ai.py backend/services/ai_analysis_preparation.py backend/services/ai_cloud_adapters.py backend/tests/test_ai_analysis_preparation.py backend/tests/test_ai_provider_routes.py backend/tests/test_ai_cloud_adapters.py src/modules/parallax/api.ts src/store/ai.ts src/hooks/useAiAnalyzeStream.ts src/hooks/useAiRunInspector.ts src/components/ai/AiRunInspectorDialog.tsx src/components/ai/AiChatPanel.tsx src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/hooks/__tests__/useAiRunInspector.test.ts src/hooks/__tests__/useAiAnalyzeStream.test.ts src/components/ai/__tests__/AiChatPanel.test.tsx
git commit -m "feat: preview exact cloud analysis payloads"
~~~

**Checkpoint:** Stop. Demonstrate that preview performs no cloud call and confirmed execution uses byte-equivalent JSON values from the snapshot.

---

## Slice 3: AFK - Show a Truthful Receipt for Success, Error, and Fallback

**Proof target:** The inspector Receipt tab unambiguously reports OpenRouter success, concrete model, generation ID, tokens, cost, duration, and fallback/error attempts; recent runs expose metadata only.

**Interfaces produced:**

~~~python
class AIRunAttempt(BaseModel):
    provider_name: AIProviderName
    requested_model: str | None
    resolved_model: str | None
    status: Literal["success", "failed", "fallback_success", "blocked"]
    provider_request_id: str | None
    input_tokens: int | None
    output_tokens: int | None
    reasoning_tokens: int | None
    cached_tokens: int | None
    estimated_cost_usd: str | None
    actual_cost_usd: str | None
    duration_ms: int
    error_code: str | None

class AIRunReceipt(BaseModel):
    run_id: str
    requested_provider: AIProviderName
    requested_model: str | None
    executed_provider: AIProviderName | None
    resolved_model: str | None
    fallback_used: bool
    fallback_reason: str | None
    status: Literal["success", "failed", "fallback_success", "blocked"]
    attempts: list[AIRunAttempt]
    created_at: datetime
~~~

Route:

~~~text
GET /ai/runs?limit=50
~~~

- [ ] **Step 1: Write failing adapter metadata tests**

In test_ai_cloud_adapters.py, stream fixtures must finish with an empty choices array containing id, model, and usage. Prove one terminal metadata event includes the concrete model, generation ID, prompt/completion/reasoning/cached tokens, and cost.

Also prove OpenRouter 400 body is mapped to AIProviderModelUnavailableError when its error identifies an invalid model; other 400 responses map to a typed AIProviderRequestError with a redacted message.

- [ ] **Step 2: Run adapter tests red**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_cloud_adapters.py -q
~~~

Expected: FAIL because final metadata is incomplete and generic 400 mapping loses the useful error.

- [ ] **Step 3: Normalize OpenRouter terminal metadata**

Extend AIProviderTextResult/AIProviderMetadata with requested_model, resolved_model, request ID, token fields, and duration. Parse final stream usage even when choices is empty. Never include provider response bodies if they contain request input; expose only typed error code/message.

- [ ] **Step 4: Run adapter tests green**

Run Step 2.

Expected: PASS.

- [ ] **Step 5: Write failing ledger and public receipt tests**

In test_ai_usage_ledger.py, prove:

~~~python
receipt = (await ledger.list_run_receipts(limit=10))[0]
assert receipt.run_id == run_id
assert [attempt.status for attempt in receipt.attempts] == ["failed", "fallback_success"]
assert receipt.fallback_used is True
assert receipt.attempts[0].actual_cost_usd is None
assert receipt.attempts[1].provider_name == "ollama"
~~~

Inspect SQLite columns/values and assert no messages, prompt, request_body, API key, or completion text is stored.

In route tests, prove SSE done contains receipt and SSE error contains a failed receipt. Prove GET /ai/runs returns grouped metadata.

- [ ] **Step 6: Run receipt tests red**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_usage_ledger.py tests/test_ai_provider_routes.py -q
~~~

Expected: FAIL because receipt grouping and run IDs do not exist.

- [ ] **Step 7: Add additive receipt storage and SSE contracts**

Add nullable/backfilled-safe columns to ai_usage_log:

~~~text
run_id
requested_provider_name
requested_model
resolved_model
fallback_reason
duration_ms
reasoning_tokens
cached_tokens
~~~

Use one run_id for cloud failure and local fallback rows. Keep actual cloud cost off the local fallback row. Extend AIUsageLedger; all writes still go through DatabaseService._run_write.

Attach receipt to terminal SSE done and error frames. GET /ai/runs groups rows newest-first.

- [ ] **Step 8: Run backend receipt tests green**

Run Step 6 plus test_ai_settings_service.py.

Expected: PASS.

- [ ] **Step 9: Write failing frontend receipt/error tests**

Update useAiAnalyzeStream tests to prove type:error is parsed and displayed, not dropped. Add inspector tests for:

- OpenRouter succeeded, with concrete model and generation ID.
- OpenRouter failed then Local Ollama succeeded, with two attempts and reason.
- Cost-cap blocked, with no provider request ID.
- Actual cost and token counts.
- Recent receipt with Payload expired by design.

- [ ] **Step 10: Run frontend tests red**

~~~bash
npm test -- src/hooks/__tests__/useAiAnalyzeStream.test.ts src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx
~~~

Expected: FAIL because error events and receipts are not represented.

- [ ] **Step 11: Implement Receipt UI and typed SSE errors**

Add error to the SseEvent union and terminate the stream with the backend message/code. Store the receipt in Zustand. Render requested versus executed provider/model, attempts, generation ID with copy action, tokens, expected/actual cost, duration, and fallback reason.

Do not call OpenRouter's generation endpoint automatically and do not render a provider-metadata refresh action in this mission.

- [ ] **Step 12: Run Slice 3 verification**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_cloud_adapters.py tests/test_ai_usage_ledger.py tests/test_ai_provider_routes.py -q
cd ..
npm test -- src/hooks/__tests__/useAiAnalyzeStream.test.ts src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx
npm run build
git diff --check
~~~

Expected: all commands pass.

- [ ] **Step 13: Commit Slice 3**

~~~bash
git add backend/models/__init__.py backend/routers/ai.py backend/services/ai_cloud_adapters.py backend/services/ai_usage.py backend/services/db.py backend/tests/test_ai_cloud_adapters.py backend/tests/test_ai_provider_routes.py backend/tests/test_ai_usage_ledger.py src/modules/parallax/api.ts src/store/ai.ts src/hooks/useAiAnalyzeStream.ts src/hooks/useAiRunInspector.ts src/components/ai/AiRunInspectorDialog.tsx src/components/ai/AiProviderBadge.tsx src/components/ai/AiChatPanel.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx
git commit -m "feat: add inspectable AI run receipts"
~~~

**Checkpoint:** Stop. Report one success receipt and one mocked fallback receipt, including the two ledger attempts.

---

## Slice 4: HITL - Compare Local and OpenRouter on the Same Snapshot

**Proof target:** The Compare tab runs both providers over identical prepared messages, fetches market data once, and presents outputs plus objective completeness/cost/latency differences without declaring a trading winner.

**Interfaces produced:**

~~~python
class AIQualityChecks(BaseModel):
    response_completed: bool
    signal_parsed: bool
    entry_present: bool
    stop_present: bool
    target_present: bool
    checks_count: int
    narrative_characters: int

class AIComparisonSide(BaseModel):
    receipt: AIRunReceipt
    message: str
    signal: SignalData | None
    quality: AIQualityChecks

class AIComparisonResponse(BaseModel):
    snapshot_id: str
    same_input: Literal[True] = True
    local: AIComparisonSide
    cloud: AIComparisonSide
~~~

Route:

~~~text
POST /ai/analysis/compare
body: {"snapshot_id": "snapshot-123"}
~~~

- [ ] **Step 1: Write failing backend comparison tests**

In test_ai_provider_routes.py, prove:

~~~python
response = client.post("/ai/analysis/compare", json={"snapshot_id": snapshot_id})
assert response.status_code == 200
assert response.json()["same_input"] is True
assert local_provider.messages == cloud_provider.messages
assert ibkr.history_call_count == 1
assert response.json()["local"]["quality"]["entry_present"] is True
assert response.json()["cloud"]["receipt"]["attempts"][0]["actual_cost_usd"] == "0.0027"
~~~

Also prove compare is disabled when Ollama is unavailable, the snapshot expired, or the cloud model changed.

- [ ] **Step 2: Run comparison tests red**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_provider_routes.py -q -k comparison
~~~

Expected: FAIL because the endpoint and quality checks do not exist.

- [ ] **Step 3: Implement comparison over one snapshot**

Reuse AIAnalysisPreparationService.get_snapshot and AiService prepared execution. Do not call preparation twice. Run local then cloud to keep provider lifecycle and session accounting simple. Record separate run IDs linked by snapshot_id only in the response; do not persist snapshot_id or messages.

Compute AIQualityChecks deterministically from parsed outputs. Do not add model-graded evaluation.

- [ ] **Step 4: Run backend tests green**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_provider_routes.py tests/test_ai_analysis_preparation.py tests/test_ai_usage_ledger.py -q
~~~

Expected: PASS.

- [ ] **Step 5: Write failing Compare-tab tests**

Prove the Compare tab:

- Explains Same prepared market facts and prompt.
- Requires a ready local Ollama model.
- Shows local/cloud provider and model headings.
- Shows narrative and signal summaries side by side on desktop and stacked on narrow view.
- Shows objective completeness, latency, and cost rows.
- Does not render winner, accuracy score, recommended model, or trading-performance claims.

- [ ] **Step 6: Run frontend tests red**

~~~bash
npm test -- src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/hooks/__tests__/useAiRunInspector.test.ts
~~~

Expected: FAIL on missing comparison behavior.

- [ ] **Step 7: Implement comparison hook and UI**

Use a TanStack mutation in useAiRunInspector. Keep stable dialog dimensions so loading/result transitions do not shift layout. Disable Compare while a run is active. Keep results in component/session memory only.

- [ ] **Step 8: Run Slice 4 verification**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_provider_routes.py tests/test_ai_analysis_preparation.py tests/test_ai_usage_ledger.py -q
cd ..
npm test -- src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/hooks/__tests__/useAiRunInspector.test.ts src/components/ai/__tests__/AiChatPanel.test.tsx
npm run build
git diff --check
~~~

Expected: all commands pass.

- [ ] **Step 9: Commit Slice 4**

~~~bash
git add backend/models/__init__.py backend/routers/ai.py backend/services/ai.py backend/tests/test_ai_provider_routes.py src/modules/parallax/api.ts src/hooks/useAiRunInspector.ts src/components/ai/AiRunInspectorDialog.tsx src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/hooks/__tests__/useAiRunInspector.test.ts
git commit -m "feat: compare AI providers on one prepared analysis"
~~~

**HITL checkpoint:** Stop for user review. Demonstrate one comparison and let the user judge whether the visible information is sufficient before any docs/merge work.

---

## Slice 5: HITL - Manual OpenRouter Smoke Test, Documentation, and Merge Gate

**Proof target:** A real user-approved OpenRouter request is reviewable before sending, completes with a truthful receipt, and the active design accurately describes the shipped behavior.

- [ ] **Step 1: Run focused backend verification**

~~~bash
cd backend
uv run python -m pytest tests/test_ai_cloud_adapters.py tests/test_ai_provider_registry.py tests/test_ai_provider_routes.py tests/test_ai_settings_service.py tests/test_ai_usage_ledger.py tests/test_ai_analysis_preparation.py tests/test_ai_timeout.py tests/test_ai_with_fibs.py -q
uv run ruff check models/__init__.py routers/ai.py services/ai.py services/ai_analysis_preparation.py services/ai_cloud_adapters.py services/ai_settings.py services/ai_usage.py services/db.py tests/test_ai_cloud_adapters.py tests/test_ai_provider_routes.py tests/test_ai_settings_service.py tests/test_ai_usage_ledger.py tests/test_ai_analysis_preparation.py
~~~

Expected: PASS with no new Ruff findings.

- [ ] **Step 2: Run focused frontend verification**

~~~bash
npm test -- src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts src/hooks/__tests__/useAiRunInspector.test.ts src/lib/sidecarClient.test.ts
npm run build
~~~

Expected: PASS.

- [ ] **Step 3: Run full regression suites**

~~~bash
cd backend
uv run python -m pytest -q
cd ..
npm test -- --run
~~~

Expected: PASS, or a written reconciliation proving any failure is a pre-existing unrelated baseline failure. Do not label an uninvestigated failure unrelated.

- [ ] **Step 4: Perform the manual OpenRouter smoke checklist**

With the user's real key already saved in the OS keychain:

1. Open Settings and confirm OpenRouter is enabled without revealing the key.
2. Open Analysis, choose OpenRouter, and load the authenticated fixed-model catalog.
3. Select one low-cost model and confirm it persists after app restart.
4. Select one symbol, D timeframe, one indicator, and context None.
5. Click Review Cloud Run and verify provider/model, sent/kept-local disclosures, exact JSON body, estimate, maximum, and fallback before sending.
6. Confirm no Authorization header or secret appears in Payload, logs, SQLite, or UI.
7. Send the run and verify receipt says OpenRouter succeeded, shows a concrete model, generation ID, tokens, actual cost, and no fallback.
8. Temporarily select an invalid/unavailable mocked model path and verify the typed error is visible.
9. Trigger a mocked provider failure with fallback enabled and verify cloud failed plus local succeeded are both visible and correctly costed.
10. Run Compare and verify both sides used the same messages and market data was fetched once.
11. Restart Orbit and verify recent metadata receipt remains while exact payload is unavailable.

Save no key, full prompt, or completion in the test report.

- [ ] **Step 5: Update active documentation after successful smoke approval**

Modify:

- docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md
- docs/superpowers/plans/2026-06-15-orbit-v2-cloud-hybrid-ai.md
- PROJECT_PLAN.md

Record fixed-model OpenRouter selection, inspector behavior, ephemeral payload retention, receipt metadata, corrected routing modes, actual cost accounting, comparison limits, and explicit auto/Fusion deferral.

Do not rewrite shipped history. Mark this dedicated plan complete only after the manual checklist is approved.

- [ ] **Step 6: Run policy and cleanliness checks**

~~~bash
npm run check:policy-drift
git diff --check
git status --short
~~~

Expected: policy drift and diff checks pass; status contains only intentional branch files.

- [ ] **Step 7: Commit docs and verification state**

~~~bash
git add docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md docs/superpowers/plans/2026-06-15-orbit-v2-cloud-hybrid-ai.md docs/superpowers/plans/2026-06-17-ai-run-inspector-openrouter-review.md PROJECT_PLAN.md
git commit -m "docs: complete OpenRouter run inspector plan"
~~~

**HITL merge gate:** Stop. Do not merge or push until the user reviews the real smoke evidence and explicitly approves merge to dev. Then use policy-drift-check and dev-merge-completion.

---

## Acceptance Criteria

- Analysis never sends a local Ollama model ID to OpenRouter.
- OpenRouter model choices come from authenticated /api/v1/models/user and respect the user's available catalog.
- Dynamic OpenRouter router aliases are not selectable.
- A cloud call cannot start without a valid fixed selected model and unexpired preview snapshot.
- The user can inspect the exact outbound JSON body before sending; secrets and HTTP headers are absent.
- The user can see meaningful sent-to-cloud and kept-local disclosures.
- The user sees expected and maximum cost before sending; caps enforce maximum cost.
- The adapter sends max_tokens and captures the concrete model, generation ID, final tokens, and actual cost.
- Success, typed error, blocked, and fallback outcomes all produce truthful receipts.
- Fallback creates separate failed-cloud and successful-local attempts; local execution never receives cloud cost.
- Recent receipt history persists metadata only; exact prompt/body content expires and is not logged or stored.
- Compare uses identical prepared messages and one market-data preparation.
- The UI makes no autonomous trading, accuracy, or winner claim.
- Focused and full tests, build, Ruff, diff check, and policy drift are reconciled before merge.

## Execution Handoff Prompt

Pass the following prompt to the executing LLM:

~~~text
You are implementing the approved Orbit AI Run Inspector and OpenRouter Review Completion plan.

Repository: /Users/benarojasmac/Desktop/Projects/Orbit
Current feature branch: feature/orbit-v2-cloud-hybrid-ai-spec
Plan: docs/superpowers/plans/2026-06-17-ai-run-inspector-openrouter-review.md

Before editing:
1. Read AGENTS.md, the dedicated plan, docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md, and docs/superpowers/plans/2026-06-15-orbit-v2-cloud-hybrid-ai.md.
2. Use orbit-ai-workflow, parallax-backend, parallax-frontend, superpowers:test-driven-development, and superpowers:executing-plans or superpowers:subagent-driven-development.
3. Inspect git status and preserve every pre-existing change. Never reset, revert, or overwrite the existing cloud-AI remediation.
4. Re-open the official OpenRouter documentation URLs listed in the plan before changing the adapter.
5. Confirm PROJECT_PLAN.md already marks this approved mission IN PROGRESS. Do not add a duplicate entry.

Execute Slice 1 only.

Use TDD one public behavior at a time: write the failing route/hook/component test, run it red for the expected reason, implement the minimum behavior, run focused tests green, then refactor. Keep the slice vertical across adapter, settings, API, Analysis UI, and tests. Do not implement preview, receipts, or comparison from later slices. Do not expose openrouter/auto, openrouter/fusion, tools, plugins, web search, or prompt persistence. Keep API keys in the OS keychain only.

After Slice 1:
- run every verification command listed for Slice 1;
- commit with the plan's Slice 1 commit message;
- stop;
- report what the tracer bullet proved, exact files changed, exact test/build results, remaining known failures, and any scope or policy question.

Do not proceed to Slice 2 until the user approves the Slice 1 checkpoint.
~~~
