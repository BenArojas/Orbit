# Agent Readiness — Docs + Discovery Slice

**Date:** 2026-06-26
**Branch:** `feature/agent-readiness`
**Source:** Forter "Agentic Readiness Guide" (5 pillars) + M. Lugassy's post on
website readiness for agents.

## Problem / reframe

Forter's guide targets **public e-commerce websites** so external buying agents
can discover and transact. Orbit is a **local-first desktop app** (Tauri shell +
local FastAPI sidecar) with no public website, crawler surface, or checkout. So
the literal Forter checklist (`sitemap.xml`, `robots.txt` Content-Signal headers,
SEO structured data) mostly does not apply.

The five pillars *do* map onto Orbit's two real agent surfaces:

- the **local FastAPI backend** (what the in-app AI / an MCP or HTTP client calls)
- the **repo** (what coding agents read)

| Pillar | Orbit translation | Before |
|---|---|---|
| Discoverable | `llms.txt` briefing + findable OpenAPI | no llms.txt; bare `/openapi.json` |
| Comprehensible | rich OpenAPI metadata + AGENTS.md | `title="Orbit"` only |
| Trustworthy | machine-readable "never autonomous" policy | prose docs only |
| Actionable | clean spec + typed errors (have) + maybe MCP | typed errors ✓ |
| Experiential | trading-safety boundaries enforced | already enforced |

## Scope decision

User chose **docs + discovery only** (zero trading-safety risk). A read-only MCP
server is a gated follow-up; full MCP with order placement is rejected — it
violates non-negotiable rule #1 (never an autonomous trading bot).

## What ships

1. **`llms.txt`** (repo root) — plain-language briefing: safety policy first,
   module map, `conid` convention, runtime interface URLs, canonical-doc links.
2. **FastAPI metadata** (`backend/main.py`) — `summary`, markdown `description`
   (leads with the safety guarantee + manifest pointer), `contact`,
   `license_info`, and an `agent` `openapi_tags` entry. Renders in `/docs` and
   `/openapi.json` `info`.
3. **`GET /.well-known/agent.json`** (`backend/routers/agent.py`) — capability +
   safety manifest. Name/version/interface URLs derived from the live app object
   (`request.app.*`) so they can't drift; safety facts mirror the enforced policy
   (`decision_support_only`, `autonomous_trading: false`,
   `broker_execution_requires_human`).

No new executable surface, no auth/persistence/broker changes.

## Testing

Per `docs/testing.md` (protect critical promises, not every file): one guard
test, `backend/tests/test_agent_manifest.py`, asserts the manifest returns 200
and keeps `autonomous_trading: false` / `decision_support_only: true`. Mounted on
a bare app so no IBKR/Ollama lifespan is needed. OpenAPI metadata verified to
serialize via `app.openapi()`.

## Deferred

- Read-only MCP server (safe decision-support reads; no orders) — gated follow-up.
- Serving `llms.txt` from the backend (kept repo-only; `/.well-known/agent.json`
  is the live-backend discovery primitive). Add if an agent needs it over HTTP.
