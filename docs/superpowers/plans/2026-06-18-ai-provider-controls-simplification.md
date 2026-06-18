# AI Provider Controls Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the authenticated OpenRouter catalog, make Analysis the single persistent owner of provider/model/fallback selection, and reduce AI Settings to OS-keychain credential management.

**Architecture:** Keep the existing FastAPI provider and routing boundaries. Repair the OpenRouter adapter at its parser boundary, then persist Analysis selections through the reduced routing-policy API. Delete aggregate cap enforcement and its frontend controls while preserving ephemeral cost previews and metadata-only receipt costs.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, httpx, SQLite, pytest; React 19, TypeScript strict mode, Zustand, TanStack Query v5, Tailwind, Vitest and Testing Library.

**Status:** Awaiting execution approval. This remediation supersedes the Settings ownership and Orbit-owned cost-cap decisions in `docs/superpowers/plans/2026-06-17-ai-run-inspector-openrouter-review.md` and must complete before that plan's Slice 5 manual smoke gate.

## Global Constraints

- Orbit remains local-first. Cloud execution requires an explicitly selected cloud route and a saved OS-keychain key.
- SQLite stores only opaque `api_key_ref`; never persist API keys, prompts, request bodies, or completions.
- All provider and Ollama traffic continues through the FastAPI sidecar.
- Analysis owns provider, model, and fallback selection. Settings owns cloud API-key save/remove only.
- Remove Orbit per-call and monthly cap enforcement completely; do not leave hidden caps.
- Keep inspector expected/maximum estimates and receipt actual/estimated attempt costs.
- Keep existing SQLite cost columns inert; do not add or destructively migrate tables.
- Continue excluding `openrouter/auto`, `openrouter/fusion`, and every other `openrouter/*` dynamic route.
- Do not enable direct-provider catalog parity, tools, plugins, web search, or prompt persistence.
- Use TDD through public adapters, routes, hooks, and components. Stop after each verified slice.
- Do not perform a real cloud inference, push, merge, or start the old Slice 5 smoke checklist without explicit user approval.

## File Map

- `backend/services/ai_cloud_adapters.py`: parse the authenticated OpenRouter catalog.
- `backend/models/__init__.py`: expose the reduced routing-policy contract.
- `backend/services/db.py`: persist only provider/mode/fallback while retaining inert legacy columns.
- `backend/services/ai_settings.py`: provide the reduced routing-policy service API.
- `backend/routers/ai.py`: remove aggregate cap enforcement and the unused usage-summary route while preserving cost estimates and receipt accounting.
- `src/hooks/useAiStatus.ts`: own model queries, selections, and persistent Analysis route mutations.
- `src/components/ai/AiAnalysisTargetControls.tsx`: render provider-specific model controls and fallback.
- `src/components/ai/AiChatPanel.tsx`: remove the editable header model selector.
- `src/components/ai/AiProvidersSettings.tsx`: render credential management only.
- `src/store/ai.ts` and `src/modules/parallax/api.ts`: remove aggregate-cap state/contracts and keep the reduced routing contract.
- Existing backend/frontend AI tests: prove behavior only through public interfaces.

---

## Slice 1: AFK - Populate the Live OpenRouter Catalog

**Proof target:** A fixed authenticated text model whose current OpenRouter record omits `pricing.request` appears in Analysis with a zero fixed request fee; empty and failed catalogs are explicit.

**Interfaces:**

- Consumes: `OpenRouterProvider.list_models()`, `GET /ai/providers/openrouter/models`, `useAiStatus()`.
- Produces: `useAiStatus().openRouterModelsError: Error | null`; unchanged `AIModelOption.request_price: string` with missing provider values normalized to `"0"`.

- [ ] **Step 1: Write the failing adapter behavior**

Modify `backend/tests/test_ai_cloud_adapters.py` so the valid fixed model omits the request fee:

```python
valid_model = {
    "id": "anthropic/claude-sonnet-4",
    "name": "Claude Sonnet 4",
    "context_length": 200000,
    "architecture": {
        "input_modalities": ["text"],
        "output_modalities": ["text"],
    },
    "supported_parameters": ["max_tokens"],
    "top_provider": {"max_completion_tokens": 4096},
    "pricing": {
        "prompt": "0.000003",
        "completion": "0.000015",
    },
}

models = await provider.list_models()
assert [model.id for model in models] == ["anthropic/claude-sonnet-4"]
assert models[0].request_price == "0"
```

- [ ] **Step 2: Run the adapter test red**

Run:

```bash
cd backend
uv run python -m pytest tests/test_ai_cloud_adapters.py -q -k list_models
```

Expected: FAIL because `_parse_model` rejects the missing request price.

- [ ] **Step 3: Normalize only an omitted fixed request fee**

Modify `OpenRouterProvider._parse_model` in `backend/services/ai_cloud_adapters.py`:

```python
request_price = pricing.get("request")
if request_price is None:
    request_price = "0"
price_values = (
    pricing.get("prompt"),
    pricing.get("completion"),
    request_price,
)
```

Do not default missing prompt/completion prices, invalid decimals, missing completion limits, or dynamic route IDs.

- [ ] **Step 4: Run the adapter test green**

Run Step 2 again.

Expected: PASS.

- [ ] **Step 5: Write failing Analysis empty/error-state tests**

Modify `src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx` with two public component behaviors:

```tsx
it("shows an explicit empty authenticated catalog", async () => {
  apiMocks.models.mockResolvedValue({
    provider_name: "openrouter",
    selected_model: null,
    fetched_at: "2026-06-18T00:00:00Z",
    models: [],
  });
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));
  expect(await screen.findByText("No compatible OpenRouter models available."))
    .toBeInTheDocument();
});

it("shows the typed catalog error", async () => {
  apiMocks.models.mockRejectedValue(new Error("OpenRouter authentication failed."));
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));
  expect(await screen.findByRole("alert"))
    .toHaveTextContent("OpenRouter authentication failed.");
});
```

- [ ] **Step 6: Run the component tests red**

Run:

```bash
cd ..
npm test -- src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx
```

Expected: FAIL because query errors and empty catalogs are not rendered.

- [ ] **Step 7: Expose and render the catalog state**

Modify `src/hooks/useAiStatus.ts` to return:

```ts
openRouterModelsError: openRouterModelsQuery.error,
```

Modify `src/components/ai/AiAnalysisTargetControls.tsx` so the OpenRouter section uses this precedence:

```tsx
{openRouterModelsError ? (
  <p role="alert" className="text-[10px] text-[var(--clr-red)]">
    {openRouterModelsError.message}
  </p>
) : !isLoadingOpenRouterModels && openRouterModels.length === 0 ? (
  <p className="text-[10px] text-[var(--text-3)]">
    No compatible OpenRouter models available.
  </p>
) : (
  <select
    id="ai-analysis-openrouter-model"
    aria-label="OpenRouter model"
    value={selectedModel}
    disabled={isLoadingOpenRouterModels || isSelectingOpenRouterModel}
    onChange={(event) => selectOpenRouterModel(event.target.value)}
  >
    {!selectedModel ? <option value="">Select a model</option> : null}
    {openRouterModels.map((model) => (
      <option key={model.id} value={model.id}>{model.name}</option>
    ))}
  </select>
)}
```

Retain the current authenticated query key and selected-model mutation.

- [ ] **Step 8: Run Slice 1 verification**

```bash
cd backend
uv run python -m pytest tests/test_ai_cloud_adapters.py tests/test_ai_provider_routes.py -q
cd ..
npm test -- src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx
npm run build
git diff --check
```

Expected: all commands pass. Existing unrelated warnings must be reported separately.

- [ ] **Step 9: Commit Slice 1**

```bash
git add backend/services/ai_cloud_adapters.py backend/tests/test_ai_cloud_adapters.py src/hooks/useAiStatus.ts src/components/ai/AiAnalysisTargetControls.tsx src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx
git commit -m "fix: populate authenticated OpenRouter model catalog"
```

**Checkpoint:** Stop. Demonstrate a populated mocked catalog plus explicit empty/error states. Do not proceed without user approval.

---

## Slice 2: HITL - Make Analysis the Persistent Execution-Control Owner

**Proof target:** Analysis persistently selects Local Ollama or OpenRouter, renders the matching model control in one location, and owns fallback; Settings contains credentials only; no Orbit aggregate cap can block a reviewed cloud run.

**Final routing contract:**

```python
class AIRoutingPolicyResponse(BaseModel):
    active_provider: AIProviderName = "ollama"
    routing_mode: AIRoutingMode = "local_only"
    local_fallback_enabled: bool = True

class AIRoutingPolicyUpdate(AIRoutingPolicyResponse):
    pass
```

```ts
interface AIRoutingPolicyResponse {
  active_provider: AIProviderName;
  routing_mode: AIRoutingMode;
  local_fallback_enabled: boolean;
}
```

### Backend policy and execution

- [ ] **Step 1: Write failing reduced-policy and no-cap tests**

Modify `backend/tests/test_ai_settings_service.py`:

```python
assert await service.get_routing_policy() == {
    "active_provider": "ollama",
    "routing_mode": "local_only",
    "local_fallback_enabled": True,
}

updated = await service.update_routing_policy(
    active_provider="openrouter",
    routing_mode="cloud_with_local_fallback",
    local_fallback_enabled=True,
)
assert set(updated) == {
    "active_provider", "routing_mode", "local_fallback_enabled",
}
```

Rename `test_cloud_stream_enforces_cost_cap_against_snapshot_maximum` to
`test_reviewed_cloud_snapshot_is_not_blocked_by_legacy_cost_columns`. Retain
its existing setup through the POST response assignment, then replace the old
terminal assertions with:

```python
assert snapshot.cost.maximum_cost_usd > Decimal("0.03")
assert response.status_code == 200
assert fake_ai.executed is True
assert all(record["status"] != "blocked" for record in usage.records)
```

Update the public routing route test to assert cap fields are absent and remove the `/ai/usage` summary test.

- [ ] **Step 2: Run backend tests red**

```bash
cd backend
uv run python -m pytest tests/test_ai_settings_service.py tests/test_ai_provider_routes.py tests/test_ai_usage_ledger.py -q
```

Expected: FAIL because routing responses still contain caps and reviewed requests still enforce them.

- [ ] **Step 3: Reduce routing persistence without a schema migration**

Modify `backend/models/__init__.py`, `backend/services/ai_settings.py`, and `backend/services/db.py`:

- remove cap fields and parameters from routing response/update/service methods;
- select/return only `active_provider`, `routing_mode`, and `local_fallback_enabled`;
- update only those three columns plus `updated_at`;
- leave existing SQLite cap columns and defaults untouched and unread.

The final SQL update is:

```sql
UPDATE ai_routing_policy
SET active_provider = ?,
    routing_mode = ?,
    local_fallback_enabled = ?,
    updated_at = datetime('now')
WHERE id = 1
```

- [ ] **Step 4: Remove aggregate enforcement while preserving estimates**

Modify `backend/routers/ai.py`:

- delete `_enforce_cloud_cost_caps` and `_cloud_cost_limit_http_error` if unused;
- delete `GET /ai/usage` and `AIUsageSummaryResponse`;
- for ordinary cloud analysis, assign:

```python
estimated_cost = _estimate_cloud_analysis_cost(provider_name, model)
```

- for reviewed snapshot execution, continue passing
  `float(snapshot.cost.estimated_cost_usd)` to receipt recording without any
  cap check;
- comparison likewise uses the snapshot estimate only for its cloud receipt;
- retain local-only routing rejection, key availability, selected-model
  validation, fallback, typed provider errors, and receipt ledger writes.

- [ ] **Step 5: Run backend tests green**

Run Step 2 again.

Expected: PASS.

### Frontend ownership and persistence

- [ ] **Step 6: Write failing unified-control tests**

Modify `src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx`:

```tsx
it("renders and persists the Ollama model beneath Local Ollama", async () => {
  renderControls();
  expect(screen.getByRole("button", { name: /gemma4:4b/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));
  await waitFor(() => expect(parallaxApi.aiUpdateRoutingPolicy).toHaveBeenCalledWith({
    active_provider: "openrouter",
    routing_mode: "cloud_with_local_fallback",
    local_fallback_enabled: true,
  }));
});

it("persists fallback as the cloud routing mode", async () => {
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: /openrouter/i }));
  fireEvent.click(await screen.findByRole("switch", { name: /local fallback/i }));
  await waitFor(() => expect(parallaxApi.aiUpdateRoutingPolicy).toHaveBeenLastCalledWith({
    active_provider: "openrouter",
    routing_mode: "cloud_manual",
    local_fallback_enabled: false,
  }));
});

it("rehydrates the persisted provider and fallback policy", async () => {
  apiMocks.routingPolicy.mockResolvedValue({
    active_provider: "openrouter",
    routing_mode: "cloud_manual",
    local_fallback_enabled: false,
  });
  renderControls();
  expect(await screen.findByRole("button", { name: /openrouter/i }))
    .toHaveAttribute("aria-pressed", "true");
  expect(await screen.findByRole("switch", { name: /local fallback/i }))
    .toHaveAttribute("aria-checked", "false");
});
```

Modify `src/components/ai/__tests__/AiChatPanel.test.tsx` to assert the header no longer contains the editable Ollama model trigger.

Replace routing/cap/spend tests in `src/components/ai/__tests__/AiProvidersSettings.test.tsx` with:

```tsx
it("renders credential management without execution or spend controls", async () => {
  renderWithQueryClient(<AiProvidersSettings />);
  expect(await screen.findByLabelText("OpenRouter API key")).toBeInTheDocument();
  expect(screen.queryByLabelText("Routing mode")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Active provider")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Local fallback")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Per-call cost cap")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Monthly cost cap")).not.toBeInTheDocument();
  expect(screen.queryByText("Monthly spend")).not.toBeInTheDocument();
});
```

- [ ] **Step 7: Run frontend tests red**

```bash
cd ..
npm test -- src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx
```

Expected: FAIL because local model editing is still in the header, routing is not persisted from Analysis, and Settings still owns duplicate controls.

- [ ] **Step 8: Implement the final Analysis ownership**

Modify `src/hooks/useAiStatus.ts` to add one mutation:

```ts
const updateAnalysisRouteMutation = useMutation({
  mutationFn: (policy: AIRoutingPolicyUpdate) =>
    parallaxApi.aiUpdateRoutingPolicy(policy),
  onSuccess: (policy) => {
    setRoutingPolicy(policy);
    setAnalysisProvider(policy.active_provider);
    setAnalysisFallbackEnabled(policy.local_fallback_enabled);
    void queryClient.invalidateQueries({ queryKey: AI_PROVIDERS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ["ai", "routing-policy"] });
  },
});
```

Add routing-policy hydration beside the existing providers query:

```ts
const routingPolicyQuery = useQuery({
  queryKey: ["ai", "routing-policy"],
  queryFn: () => parallaxApi.aiRoutingPolicy(),
  staleTime: 30_000,
});

useEffect(() => {
  if (routingPolicyQuery.data) setRoutingPolicy(routingPolicyQuery.data);
}, [routingPolicyQuery.data, setRoutingPolicy]);
```

Expose `updateAnalysisRoute(policy)` and its pending/error state. Extend the
component test's `apiMocks` with `routingPolicy` and `updateRoutingPolicy`, and
wire them to `parallaxApi.aiRoutingPolicy` and
`parallaxApi.aiUpdateRoutingPolicy` so the rehydration test exercises the public
hook/component path.

Modify `src/components/ai/AiAnalysisTargetControls.tsx`:

- render `AiModelSelector` and `ResponseTimeBadge` in the Local Ollama section;
- render the OpenRouter selector and fallback only in the OpenRouter section;
- selecting Local persists `local_only` with fallback unchanged;
- selecting OpenRouter persists `cloud_manual` or
  `cloud_with_local_fallback` according to the current toggle;
- toggling fallback persists the matching mode immediately;
- keep controls disabled while the route mutation is pending.

Modify `src/components/ai/AiChatPanel.tsx` to remove `AiModelSelector` and
`ResponseTimeBadge` from the header while retaining `AiProviderBadge`.

- [ ] **Step 9: Delete duplicate Settings and aggregate frontend state**

Modify `src/components/ai/AiProvidersSettings.tsx` to keep `ProviderCard`, the
providers query, and key save/delete mutations only. Remove routing-policy and
usage-summary queries, drafts, mutations, and controls.

Modify `src/modules/parallax/api.ts` and `src/store/ai.ts`:

- reduce `AIRoutingPolicyResponse/Update` to three fields;
- remove `AIUsageSummaryResponse` and `parallaxApi.aiUsageSummary`;
- remove `perCallCostCapUsd` and `monthlyCostCapUsd` store state;
- keep active provider, routing mode, and fallback hydration.

- [ ] **Step 10: Run frontend tests green**

Run Step 7 again.

Expected: PASS.

- [ ] **Step 11: Run Slice 2 verification**

```bash
cd backend
uv run python -m pytest tests/test_ai_cloud_adapters.py tests/test_ai_provider_routes.py tests/test_ai_settings_service.py tests/test_ai_usage_ledger.py tests/test_ai_analysis_preparation.py -q
cd ..
npm test -- src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts src/hooks/__tests__/useAiRunInspector.test.ts
npm run build
git diff --check
```

Expected: all commands pass. Verify no API key, prompt, request body, or completion was added to SQLite.

- [ ] **Step 12: Commit Slice 2**

```bash
git add backend/models/__init__.py backend/routers/ai.py backend/services/ai_settings.py backend/services/db.py backend/tests/test_ai_provider_routes.py backend/tests/test_ai_settings_service.py backend/tests/test_ai_usage_ledger.py src/modules/parallax/api.ts src/store/ai.ts src/hooks/useAiStatus.ts src/components/ai/AiAnalysisTargetControls.tsx src/components/ai/AiChatPanel.tsx src/components/ai/AiProvidersSettings.tsx src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx
git commit -m "refactor: move AI execution controls to Analysis"
```

**HITL checkpoint:** Stop. Demonstrate persisted Local/OpenRouter selection, both model pickers in the same location, credential-only Settings, and a reviewed cloud request unaffected by legacy cap columns.

---

## Slice 3: HITL - Reconcile Active Documentation and Verification

**Proof target:** Active docs describe Analysis-owned execution controls and provider-owned budgets; automated suites are reconciled before the real OpenRouter smoke gate.

- [ ] **Step 1: Update active documentation**

Modify:

- `docs/superpowers/specs/2026-06-18-ai-provider-controls-simplification-design.md`
- `docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md`
- `docs/superpowers/plans/2026-06-15-orbit-v2-cloud-hybrid-ai.md`
- `docs/superpowers/plans/2026-06-17-ai-run-inspector-openrouter-review.md`
- `docs/superpowers/plans/2026-06-18-ai-provider-controls-simplification.md`
- `PROJECT_PLAN.md`

Record:

- Analysis owns persistent provider/model/fallback controls.
- Settings owns OS-keychain credential management only.
- Orbit shows preview/receipt costs but provider accounts own budgets and caps.
- Fixed-model and local-first restrictions remain unchanged.
- AI Run Inspector Slices 1-4 and this remediation's completed slices match the branch state.
- The remaining gate is a user-approved real OpenRouter smoke test followed by merge review.

- [ ] **Step 2: Run focused backend verification and Ruff**

```bash
cd backend
uv run python -m pytest tests/test_ai_cloud_adapters.py tests/test_ai_provider_registry.py tests/test_ai_provider_routes.py tests/test_ai_settings_service.py tests/test_ai_usage_ledger.py tests/test_ai_analysis_preparation.py tests/test_ai_timeout.py tests/test_ai_with_fibs.py -q
uvx ruff check models/__init__.py routers/ai.py services/ai.py services/ai_analysis_preparation.py services/ai_cloud_adapters.py services/ai_settings.py services/ai_usage.py services/db.py tests/test_ai_cloud_adapters.py tests/test_ai_provider_routes.py tests/test_ai_settings_service.py tests/test_ai_usage_ledger.py tests/test_ai_analysis_preparation.py
```

Expected: tests pass. Fix branch-introduced Ruff findings only and report unrelated baseline findings separately.

- [ ] **Step 3: Run focused frontend verification**

```bash
cd ..
npm test -- src/components/ai/__tests__/AiAnalysisTargetControls.test.tsx src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx src/components/ai/__tests__/AiProvidersSettings.test.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts src/hooks/__tests__/useAiRunInspector.test.ts src/lib/sidecarClient.test.ts
npm run build
```

Expected: PASS with only reconciled pre-existing warnings.

- [ ] **Step 4: Run full regression suites**

```bash
cd backend
uv run python -m pytest -q
cd ..
npm test -- --run
```

Expected: PASS, or a written root-cause reconciliation for each failure. Do not call an uninvestigated failure unrelated.

- [ ] **Step 5: Run policy and cleanliness checks**

```bash
npm run check:policy-drift
git diff --check
git status --short
```

Expected: policy drift and diff checks pass; status contains only intentional documentation changes.

- [ ] **Step 6: Commit documentation state**

```bash
git add docs/superpowers/specs/2026-06-18-ai-provider-controls-simplification-design.md docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md docs/superpowers/plans/2026-06-15-orbit-v2-cloud-hybrid-ai.md docs/superpowers/plans/2026-06-17-ai-run-inspector-openrouter-review.md docs/superpowers/plans/2026-06-18-ai-provider-controls-simplification.md PROJECT_PLAN.md
git commit -m "docs: reconcile AI provider control ownership"
```

**HITL checkpoint:** Stop. Do not perform a real OpenRouter call, push, or merge. Ask the user to approve resuming the manual smoke checklist from the original Slice 5.

---

## Acceptance Criteria

- The authenticated OpenRouter catalog displays compatible fixed models when `pricing.request` is omitted.
- Empty and failed catalogs are explicit; the selector never silently contains only a placeholder.
- Local Ollama and OpenRouter model controls occupy the same provider-specific location in Analysis.
- The AI panel header no longer contains an editable Ollama model selector.
- Provider, model, and fallback choices persist through FastAPI settings and survive rehydration.
- Settings contains cloud credential management and provider status only.
- Orbit does not enforce hidden per-call or monthly spending caps and does not create new cap-blocked attempts.
- Preview estimates and receipt attempt costs remain intact.
- Local-only routing, explicit cloud selection, OS-keychain-only secrets, and request-scoped cloud providers remain enforced.
- Existing SQLite cap columns remain inert; no destructive migration is added.
- No direct-provider catalog parity, dynamic OpenRouter route, tool, plugin, web search, or prompt persistence is introduced.
- Focused tests, full suites, build, Ruff, policy drift, and diff cleanliness are reconciled before manual smoke testing.
