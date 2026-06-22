# AI Provider Controls Simplification Design

**Date:** 2026-06-18  
**Status:** Complete on branch; Slices 1-3 verified on 2026-06-19
**Branch:** `feature/orbit-v2-cloud-hybrid-ai-spec`

## Problem

AI execution controls are split between Analysis and Settings. Analysis selects
Local Ollama or OpenRouter, but the Ollama model selector remains in the panel
header while the OpenRouter model selector sits below the provider selector.
Settings duplicates provider, routing, fallback, and cost controls even though
these choices belong to the analysis workflow.

The OpenRouter model selector is also empty in the live app. A diagnostic call
using the saved OS-keychain credential returned 339 authenticated models, but
Orbit rejected all of them. The main cause is that 279 current model records
omit `pricing.request`; Orbit incorrectly requires that optional fixed request
fee to be a string.

## Approved Solution

### Analysis owns execution selection

Analysis presents one persistent provider selector followed immediately by the
model selector for that provider:

- **Local Ollama:** show the existing installed-model selector, refresh action,
  and response-time indicator below the provider selector.
- **OpenRouter:** show the authenticated fixed-model catalog below the provider
  selector, followed by the local-fallback toggle.

Remove the Ollama model selector from the AI panel header. The header may retain
the latest-run provider badge because it reports an outcome rather than editing
the next route.

Provider, model, and fallback changes persist immediately through the existing
FastAPI settings interfaces. Selecting Local Ollama persists `local_only`.
Selecting OpenRouter persists either `cloud_manual` or
`cloud_with_local_fallback` according to the fallback toggle. Cloud execution
still requires a saved OS-keychain key and an explicit cloud selection.

### Settings owns credentials only

The AI provider Settings section keeps cloud API-key save/remove controls and
provider status. Remove these controls from Settings:

- routing mode
- active provider
- local fallback
- per-call cost cap
- monthly cost cap
- monthly spend

Direct-provider model-catalog parity remains deferred. This change does not
enable OpenAI, Anthropic, Gemini, or Grok analysis controls.

### Remove Orbit aggregate cost enforcement

Orbit no longer enforces per-call or monthly cloud spending caps. Users manage
budgets and limits through their cloud-provider account or API-key settings.
Do not leave hidden Orbit caps that can reject an otherwise valid run.

Keep:

- preflight expected and maximum cost estimates in the cloud-run inspector
- actual and estimated attempt cost metadata in run receipts
- metadata-only usage-ledger rows needed by receipt history
- historical `blocked` receipt rendering for existing rows

Remove cap fields from the active routing-policy API and frontend state. Existing
SQLite columns may remain inert to avoid a destructive migration. Remove the
unused aggregate usage-summary route and client query if no other caller exists.
New cloud runs must not call aggregate cap enforcement or create new cost-cap
`blocked` attempts.

### Repair the OpenRouter catalog

Treat an omitted `pricing.request` value as `"0"`. Continue requiring valid
prompt and completion prices, text input/output, `max_tokens`, a positive
context length, and a positive provider completion limit. Continue excluding
`openrouter/auto`, `openrouter/fusion`, and other `openrouter/*` dynamic routes.

If the authenticated catalog is empty after validation, display an explicit
empty-state message instead of a selector containing only "Select a model." If
catalog loading fails, display the typed FastAPI error.

## Public Interfaces

The existing interfaces remain the ownership boundary:

- `GET /ai/providers/openrouter/models`
- `PUT /ai/providers/openrouter/model`
- `GET /ai/routing-policy`
- `PUT /ai/routing-policy`
- `POST /ai/models/select`

The routing-policy response/update retains only active provider, routing mode,
and local fallback. All frontend calls continue through the FastAPI sidecar.

## Testing

Use TDD through public interfaces:

1. Adapter test: an authenticated fixed text model without `pricing.request`
   appears with `request_price == "0"`.
2. Route/component test: the live-compatible OpenRouter catalog populates the
   Analysis selector and preserves typed empty/error states.
3. Component test: Local Ollama shows its model selector below the provider
   selector and the panel header has no editable model selector.
4. Persistence tests: provider, Ollama/OpenRouter model, and fallback survive
   state rehydration through backend settings.
5. Settings test: only credential management remains; routing, fallback, cap,
   and spend controls are absent.
6. Route tests: cloud execution remains explicitly gated while aggregate caps
   no longer block reviewed requests. Receipt cost metadata remains accurate.

Run focused backend AI adapter/settings/routes/ledger tests, focused frontend AI
controls/settings/chat tests, production build, Ruff on changed Python files,
and policy-drift verification. Reconcile full-suite failures separately.

## Policy Impact

**Proposed policy change approved:** Orbit keeps local-first, explicit cloud
enablement, OS-keychain-only secrets, and server-side routing enforcement, but
removes Orbit-owned aggregate cloud spending caps. The active cloud-AI design,
execution plans, and project plan must be reconciled before merge. `AGENTS.md`
and `CLAUDE.md` do not require a rule change because neither currently mandates
Orbit-owned cost caps.

## Out of Scope

- OpenRouter Auto or Fusion routing
- tools, plugins, or web search
- direct-provider catalog parity
- prompt or completion persistence
- new database tables or destructive schema cleanup
- changes to receipt comparison or trading-safety behavior
- merge or push
