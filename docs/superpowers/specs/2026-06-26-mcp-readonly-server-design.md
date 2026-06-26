# Read-Only MCP Server — Design

**Date:** 2026-06-26
**Branch:** `feature/agent-readiness`
**Follows:** the docs+discovery slice (llms.txt, enriched OpenAPI, `/.well-known/agent.json`).
**Source framing:** Forter agentic-readiness "Actionable" pillar (MCP is its headline standard).

## Goal

Let a local AI agent (Claude Code, Cursor, Claude Desktop) call Orbit's
decision-support **reads** natively over MCP — quotes, candles, screeners,
sectors, options chains, watchlists, fibonacci, and the user's journal/portfolio.
Strictly **read-only**: no order placement, no broker/process mutations, never
autonomous trading.

## Non-negotiables this design enforces

- No mutation surface ever reaches MCP (rule #1: decision support, never autonomous trading).
- All access stays inside the existing FastAPI backend (rule #2).
- Local-first: server binds `127.0.0.1` only; no new secret surface (rule #6).
- Typed errors / existing auth path reused (rule #5).

## Approach (chosen: A)

`FastMCP.from_fastapi(app=app, route_maps=[...])` mounted **in-process** as an
ASGI sub-app at `/mcp-server/mcp` on the already-running uvicorn sidecar
(streamable-http transport). The MCP tools are generated from the existing
FastAPI routes (the OpenAPI the prior slice enriched) and routed back through the
app's normal request path — so they reuse the real routers, `Depends(require_ibkr_auth)`,
typed-error handlers, and `app.state` singletons. No duplicated handlers.

**Why not the alternatives:**
- **(B) hand-written tools** re-implement ~36 reads the routers already do — rung-2 violation.
- **(C) separate stdio sidecar** adds a second binary + Tauri capability + sign/notarize target for isolation a read-only toolset doesn't need.

**Stack (adversarially verified against live docs, 2026-06-26):**
`fastmcp ~=3.4` (latest 3.4.2; default install already includes server+client).
Imports: `from fastmcp import FastMCP`, `from fastmcp.server.providers.openapi import RouteMap, MCPType`.
Endpoint: `http://localhost:8000/mcp-server/mcp`.

## The safety boundary (critical)

`RouteMap` is **config, not an auth boundary**, and a bare `GET .*` filter would
still expose *side-effecting* GETs (`/auth/status` and `/gateway/status` start the
IBKR tickle keep-alive loop + `ensure_accounts`; `/ai/*` and `/settings/*` leak
cloud-policy/config). Therefore:

1. **Positive prefix allowlist**, not denylist+catch-all-allow. Only named groups
   are exposed; any future router is excluded by default.
2. **Catch-all `EXCLUDE`** drops every non-GET (orders, etc. can never appear).
3. **A mandatory tool-list assertion test** is the real boundary: it enumerates
   the generated tools and fails if any forbidden path/method appears. The design
   leans on this test, so it is justified, not speculative.
4. Backend keeps rejecting writes regardless.

## Exposed surface

**Always on (non-sensitive, 29 GETs):** `market` (6), `instruments` (1),
`screener` (5), `sectors` (5), `moonmarket/options` (4), `watchlist` (4),
`fibonacci` (2), `inflect/setups` (1, static taxonomy).

**Gated by `MCP_EXPOSE_PORTFOLIO` (default ON per owner decision, 14 GETs):**
MoonMarket portfolio/account reads (`/accounts`, `/funds`, `/portfolio`,
`/performance`, `/trades`, `/live-orders`, `order-rules`) and account-derived
Inflect journal reads (`/calendar`, `/trades`, `/trades/{id}`, `/symbols`,
`/basis-lots`, `/basis-audit`, `/backfill-status`). These expose private
financials; default ON means the loopback-only trust boundary is the protection,
so it is documented for the user, and the flag lets them turn it off.

**Hard-excluded (even GETs):** all of `orders.py`; `trading-safety/order-action`;
`gateway/*`; `auth/*`; `settings/*`; `ai/*`; `ws`; `health`; `triggers`,
`drawings`, `pulse_config`, `watchlist_config`, `inflect/storage|health`;
`/.well-known/agent.json` (already its own contract); and every non-GET.

## Lifecycle / packaging

In-process mount → **no** new process, binary, Tauri capability, CSP, or CORS
change (rides the already-allowed `localhost:8000`). The one real integration
risk is merging the MCP ASGI lifespan with Orbit's existing 8-singleton lifespan
(`combine_lifespans`) — verified hands-on in the tracer bullet. PyInstaller needs
`fastmcp` hidden imports added to `parallax-backend.spec` (fails only at packaged
runtime, so the bundled binary is tested in Phase 3, not just dev uvicorn).

## Testing (per docs/testing.md)

One focused test, `backend/tests/test_mcp_readonly.py`: build the mounted server
in-process, enumerate tools via the in-memory `fastmcp.Client`, assert (a) zero
tools from non-GET routes, (b) zero tools matching the denylist paths, (c) the
`MCP_EXPOSE_PORTFOLIO` flag gates the sensitive set both ways. This single
assertion *is* the safety boundary. No per-route tests; happy-path list/call is
covered by manual MCP-client verification in the tracer.

## Open questions resolved / assumptions

- Sensitive reads: **flag, default ON** (owner decision 2026-06-26).
- Trust boundary: **loopback-only, no API key**; beyond-loopback is unsupported.
- `/market/search` and `/market/conid/{symbol}` write only the local instruments
  cache (no broker mutation) → kept in the read-only set; noted for transparency.
- Pin `fastmcp ~=3.4`; confirm no import-time telemetry before merge.
