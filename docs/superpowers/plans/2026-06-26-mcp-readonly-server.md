# Read-Only MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Orbit's decision-support reads to local AI agents over a strictly read-only MCP server, mounted in-process on the existing FastAPI sidecar.

**Architecture:** `FastMCP.from_fastapi(app)` generates MCP tools from the existing FastAPI routes and mounts as an ASGI sub-app at `/mcp-server/mcp` (streamable-http). A positive path-prefix allowlist + catch-all `EXCLUDE` keeps it read-only; a tool-list assertion test is the enforced safety boundary. Sensitive portfolio/journal reads sit behind `MCP_EXPOSE_PORTFOLIO` (default ON). No new process/binary/Tauri-capability/CSP/CORS change.

**Tech Stack:** Python 3.12, FastAPI, `fastmcp ~=3.4` (3.4.2), uv, PyInstaller (Tauri sidecar).

**Design:** `docs/superpowers/specs/2026-06-26-mcp-readonly-server-design.md`

---

## File Structure

- Modify: `backend/pyproject.toml` — add `fastmcp~=3.4`.
- Create: `backend/mcp_server.py` — builds the read-only `FastMCP` server (allowlist/denylist `route_maps`, the `MCP_EXPOSE_PORTFOLIO` flag). One focused responsibility; keeps `main.py` lean.
- Modify: `backend/main.py` — import `build_mcp`, mount the sub-app, merge lifespans (after all `include_router` calls).
- Create: `backend/tests/test_mcp_readonly.py` — the safety boundary assertion.
- Modify: `backend/parallax-backend.spec` — `fastmcp` hidden imports.
- Modify: `docs/agent-workflow.md` — client wiring docs.

> **3.x API note:** the verified stack is medium-confidence on exact 3.4.x accessors (tool-introspection method, lifespan helper). Task 1 is an empirical spike that pins these down with runnable commands; later tasks use what it prints. Do **not** trust memory over the spike output.

---

## Phase 0 — Spike + tracer bullet (market-data only)

### Task 1: Add dependency and pin down the 3.4.x API surface

**Files:**
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Add the dependency**

In `backend/pyproject.toml`, add to `dependencies` (after `"keyring>=25.0.0",`):

```toml
    "fastmcp~=3.4",
```

- [ ] **Step 2: Install**

Run: `cd backend && uv sync`
Expected: resolves `fastmcp` (3.4.x) + `fastmcp-slim`; no errors.

- [ ] **Step 3: Confirm imports and APIs empirically (record the output)**

Run:
```bash
cd backend && uv run python -c "
import fastmcp, inspect
from fastmcp import FastMCP, Client
from fastmcp.server.providers.openapi import RouteMap, MCPType
print('fastmcp', fastmcp.__version__)
print('from_fastapi params:', list(inspect.signature(FastMCP.from_fastapi).parameters))
print('http_app params:', list(inspect.signature(FastMCP.http_app).parameters))
print('MCPType:', [m for m in dir(MCPType) if not m.startswith('_')])
import fastmcp.utilities.lifespan as lf; print('lifespan utils:', [n for n in dir(lf) if not n.startswith('_')])
"
```
Expected: prints a 3.4.x version, a `from_fastapi` signature accepting `app` and `route_maps`, an `http_app` accepting `path`, `MCPType` including `TOOL` and `EXCLUDE`, and a `combine_lifespans` (or similarly named) helper. **Record the exact `combine_lifespans` name and the lifespan-util module** — Task 3 uses it.

- [ ] **Step 4: Confirm no import-time network/telemetry (local-first rule)**

Run: `cd backend && uv run python -c "import fastmcp"` under a network-trace if available, or inspect `fastmcp` docs/settings for a telemetry flag and disable it (e.g. env `FASTMCP_TELEMETRY_ENABLED=false`) if one exists. Note the finding in the PR.

- [ ] **Step 5: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "build: add fastmcp dependency for read-only MCP server"
```

### Task 2: Write the safety self-check test FIRST (drives the implementation)

**Files:**
- Create: `backend/mcp_server.py` (stub only this task)
- Create: `backend/tests/test_mcp_readonly.py`

- [ ] **Step 1: Stub the builder so the test imports**

Create `backend/mcp_server.py`:

```python
"""Read-only MCP server for Orbit (see docs/superpowers/specs/2026-06-26-mcp-readonly-server-design.md)."""
from __future__ import annotations
import os
from fastmcp import FastMCP

# Path-prefix allowlist. Positive list: only these are exposed; anything else
# (incl. every non-GET, and any future router) is EXCLUDED by the catch-all.
BASE_ALLOW = (
    r"^/market/|^/instruments/|^/screener/|^/sectors/|"
    r"^/moonmarket/options/|^/watchlist/|^/fibonacci/|^/inflect/setups\b"
)
# Sensitive (private financials), gated by MCP_EXPOSE_PORTFOLIO.
SENSITIVE_ALLOW = (
    r"^/moonmarket/accounts\b|^/moonmarket/accounts/|^/moonmarket/portfolio\b|"
    r"^/moonmarket/performance\b|^/moonmarket/trades\b|^/moonmarket/live-orders\b|"
    r"^/inflect/(calendar|trades|symbols|basis-lots|basis-audit|backfill-status)\b"
)
# Paths that must NEVER appear as tools, asserted by the test even if they are GETs.
DENYLIST = (
    "/moonmarket/orders", "/moonmarket/trading-safety", "/auth", "/gateway",
    "/settings", "/ai/", "/ws", "/health", "/.well-known",
    "/triggers", "/drawings", "/pulse", "/watchlist-config", "/inflect/storage",
)


def expose_portfolio() -> bool:
    return os.getenv("MCP_EXPOSE_PORTFOLIO", "true").lower() not in ("0", "false", "no")


def build_mcp(app):
    """Build the read-only FastMCP server from the existing FastAPI app.

    Filled in Task 3. Stubbed here so the test module imports.
    """
    raise NotImplementedError
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_mcp_readonly.py`:

```python
"""The MCP read-only safety boundary. RouteMap is config, not auth — this test IS the boundary."""
import re
import pytest
from fastmcp import Client

from mcp_server import build_mcp, DENYLIST, expose_portfolio


def _build_app():
    # Bare app with the real routers but no IBKR/Ollama lifespan.
    from fastapi import FastAPI
    import main  # noqa: F401 — ensures routers import
    app = FastAPI(title="Orbit", version="test")
    for r in main.ALL_ROUTERS:  # added in Task 3
        app.include_router(r)
    return app


async def _tool_paths(app):
    mcp = build_mcp(app)
    async with Client(mcp) as client:
        tools = await client.list_tools()
    # from_fastapi tools carry the source route; path is in name/description/meta.
    # Confirm the exact accessor in Task 3 step 3 and adjust this extractor if needed.
    return [f"{t.name} {getattr(t, 'description', '') or ''} {getattr(t, '_meta', '') or ''}" for t in tools]


@pytest.mark.asyncio
async def test_no_denylisted_tool_is_exposed(monkeypatch):
    monkeypatch.setenv("MCP_EXPOSE_PORTFOLIO", "true")
    blobs = await _tool_paths(_build_app())
    for bad in DENYLIST:
        assert not any(bad in b for b in blobs), f"forbidden path {bad} exposed as MCP tool"


@pytest.mark.asyncio
async def test_no_mutation_verbs_in_tools(monkeypatch):
    monkeypatch.setenv("MCP_EXPOSE_PORTFOLIO", "true")
    blobs = await _tool_paths(_build_app())
    for verb in ("place", "cancel", "modify", "reply", "logout", "delete", "POST", "PUT", "DELETE", "PATCH"):
        assert not any(re.search(verb, b, re.I) for b in blobs), f"mutation hint {verb!r} in tool list"


@pytest.mark.asyncio
async def test_portfolio_flag_gates_sensitive(monkeypatch):
    monkeypatch.setenv("MCP_EXPOSE_PORTFOLIO", "false")
    blobs = await _tool_paths(_build_app())
    assert not any("/inflect/trades" in b or "/moonmarket/portfolio" in b for b in blobs)
    monkeypatch.setenv("MCP_EXPOSE_PORTFOLIO", "true")
    blobs = await _tool_paths(_build_app())
    assert any("/inflect/trades" in b or "/moonmarket/portfolio" in b for b in blobs)
```

- [ ] **Step 3: Run — expect failure (NotImplementedError)**

Run: `cd backend && uv run pytest tests/test_mcp_readonly.py -x -q`
Expected: FAIL — `AttributeError: module 'main' has no attribute 'ALL_ROUTERS'` (added in Task 3) or `NotImplementedError` from `build_mcp`. Either red state is correct here.

- [ ] **Step 4: Commit the failing test**

```bash
git add backend/mcp_server.py backend/tests/test_mcp_readonly.py
git commit -m "test: read-only MCP safety boundary (failing)"
```

### Task 3: Implement `build_mcp` + expose router list; pass the safety test

**Files:**
- Modify: `backend/mcp_server.py`
- Modify: `backend/main.py` (export `ALL_ROUTERS`)

- [ ] **Step 1: Expose the router list from main.py for reuse**

In `backend/main.py`, after the last `app.include_router(...)`, add a module-level list of the included routers (reuse the names already imported):

```python
# Routers exposed for in-process reuse (e.g. the read-only MCP server / tests).
ALL_ROUTERS = [
    auth_router, indicators_router, market_router, sectors_router, watchlist_router,
    ws_router, triggers_router, ai_router, fibonacci_router, screener_router,
    gateway_router, watchlist_config_router, settings_router, pulse_config_router,
    health_router, instruments_router, drawings_router, moonmarket_router,
    orders_router, trading_safety_router, options_router, inflect_router, agent_router,
]
```

- [ ] **Step 2: Implement `build_mcp`**

Replace the `build_mcp` body in `backend/mcp_server.py`:

```python
from fastmcp.server.providers.openapi import RouteMap, MCPType


def build_mcp(app) -> FastMCP:
    route_maps = [
        RouteMap(methods=["GET"], pattern=BASE_ALLOW, mcp_type=MCPType.TOOL),
    ]
    if expose_portfolio():
        route_maps.append(RouteMap(methods=["GET"], pattern=SENSITIVE_ALLOW, mcp_type=MCPType.TOOL))
    route_maps.append(RouteMap(mcp_type=MCPType.EXCLUDE))  # everything else incl. all non-GET
    return FastMCP.from_fastapi(app=app, name="Orbit (read-only)", route_maps=route_maps)
```

- [ ] **Step 3: Confirm the tool-introspection accessor, fix `_tool_paths` if needed**

Run:
```bash
cd backend && uv run python -c "
import asyncio; from fastmcp import Client
from fastapi import FastAPI; import main
from mcp_server import build_mcp
app=FastAPI(); [app.include_router(r) for r in main.ALL_ROUTERS]
async def go():
    async with Client(build_mcp(app)) as c:
        ts=await c.list_tools(); print(len(ts)); print(ts[0])
asyncio.run(go())
"
```
Expected: prints a tool count and one tool object. **Inspect the printed object**: confirm the source path is visible in `.name`/`.description`/`._meta`. If it is stored elsewhere, update the extractor in `_tool_paths` (test) accordingly so the denylist substrings can match.

- [ ] **Step 4: Run the safety test — expect PASS**

Run: `cd backend && uv run pytest tests/test_mcp_readonly.py -q`
Expected: 3 passed. If a denylist assertion fails, the allowlist regex is too broad — tighten `BASE_ALLOW`/`SENSITIVE_ALLOW`, do not loosen the test.

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_server.py backend/main.py
git commit -m "feat: read-only MCP server builder passing safety boundary"
```

### Task 4: Mount in-process with merged lifespan (market-only tracer)

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Mount the MCP sub-app and merge lifespans**

In `backend/main.py`, after `ALL_ROUTERS` (and after the app is fully built), add. Use the `combine_lifespans` helper name **confirmed in Task 1 Step 3**:

```python
from fastmcp.utilities.lifespan import combine_lifespans  # confirm exact name from Task 1
from mcp_server import build_mcp

_mcp = build_mcp(app)
_mcp_app = _mcp.http_app(path="/mcp")
# Merge the MCP ASGI lifespan with Orbit's existing lifespan so BOTH the 8
# app.state singletons AND the MCP session manager start. (Existing `lifespan`
# was passed at FastAPI() construction; reassign to the combined context.)
app.router.lifespan_context = combine_lifespans(lifespan, _mcp_app.lifespan)
app.mount("/mcp-server", _mcp_app)
```

> If `combine_lifespans` is not the confirmed name/shape, use the explicit nest instead:
> ```python
> from contextlib import asynccontextmanager
> @asynccontextmanager
> async def _combined(a):
>     async with lifespan(a):
>         async with _mcp_app.router.lifespan_context(_mcp_app):
>             yield
> app.router.lifespan_context = _combined
> ```

- [ ] **Step 2: Start the backend; verify BOTH lifespans run**

Run: `cd backend && uv run uvicorn main:app --port 8000`
Expected: the existing startup logs (gateway/ibkr/db/scanner/inflect) appear AND no MCP lifespan error. `curl -s http://localhost:8000/health` → ok. This proves the merge didn't skip the singletons (top risk).

- [ ] **Step 3: Verify the MCP endpoint serves**

With the server running, in another shell:
Run: `npx -y @modelcontextprotocol/inspector http://localhost:8000/mcp-server/mcp` (or `claude mcp add --transport http orbit http://localhost:8000/mcp-server/mcp` then list tools).
Expected: the read tools list; calling `/market/quote/{conid}` for a known conid returns a quote (requires an authenticated IBKR gateway).

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: mount read-only MCP at /mcp-server/mcp with merged lifespan"
```

---

## Phase 1 — Confirm full surface + harden the denylist

### Task 5: Assert the full exposed/excluded surface

**Files:**
- Modify: `backend/tests/test_mcp_readonly.py`

- [ ] **Step 1: Add an explicit expected-tool-count / group assertion**

Append a test that, with `MCP_EXPOSE_PORTFOLIO=true`, asserts at least one tool from each allowed group (`/market/`, `/screener/`, `/sectors/`, `/moonmarket/options/`, `/watchlist/`, `/fibonacci/`, `/instruments/`, `/inflect/setups`) is present, and that none of the side-effecting GETs (`/auth/status`, `/gateway/status`, `/ai/providers`, `/settings`) appear (these are already in `DENYLIST` — this widens coverage to confirm the catch-all `EXCLUDE` actually drops them, since RouteMap may have bugs).

```python
@pytest.mark.asyncio
async def test_expected_groups_present(monkeypatch):
    monkeypatch.setenv("MCP_EXPOSE_PORTFOLIO", "true")
    blobs = await _tool_paths(_build_app())
    for grp in ("/market/", "/screener/", "/sectors/", "/moonmarket/options/",
                "/watchlist/", "/fibonacci/", "/instruments/", "/inflect/setups"):
        assert any(grp in b for b in blobs), f"expected group {grp} missing from tools"
```

- [ ] **Step 2: Run all MCP tests**

Run: `cd backend && uv run pytest tests/test_mcp_readonly.py -q`
Expected: all pass. If a side-effecting GET slips through, add an earlier-ordered `RouteMap(pattern=..., mcp_type=MCPType.EXCLUDE)` for it in `build_mcp` and re-run.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_mcp_readonly.py
git commit -m "test: assert full MCP read surface and denylist coverage"
```

---

## Phase 2 — Packaging + client docs

### Task 6: PyInstaller hidden imports for the bundled sidecar

**Files:**
- Modify: `backend/parallax-backend.spec`

- [ ] **Step 1: Add fastmcp to hidden imports / collected packages**

In `backend/parallax-backend.spec`, mirror the existing `collect_all`/hiddenimports pattern. Add near the other `collect_all` calls:

```python
from PyInstaller.utils.hooks import collect_all
_fmcp_datas, _fmcp_binaries, _fmcp_hidden = collect_all("fastmcp")
# also collect the slim core + transport deps fastmcp resolves dynamically
for pkg in ("fastmcp_slim", "mcp", "sse_starlette", "anyio"):
    d, b, h = collect_all(pkg)
    _fmcp_datas += d; _fmcp_binaries += b; _fmcp_hidden += h
```
and extend `datas`, `binaries`, and `hiddenimports` in the `Analysis(...)` call with these (matching how the spec already extends them for pandas/uvicorn).

- [ ] **Step 2: Build and run the bundled binary (not just uvicorn)**

Run: `cd backend && bash ../scripts/build-backend.sh` (or the documented build command), then run the produced `parallax-backend` binary directly.
Expected: starts with no `ModuleNotFoundError`; `curl http://localhost:8000/mcp-server/mcp` (or the inspector) reaches the MCP endpoint from the packaged binary. Add any missing module surfaced as a `ModuleNotFoundError` to `hiddenimports` and rebuild.

- [ ] **Step 3: Commit**

```bash
git add backend/parallax-backend.spec
git commit -m "build: bundle fastmcp in the PyInstaller sidecar"
```

### Task 7: Document client wiring

**Files:**
- Modify: `docs/agent-workflow.md`

- [ ] **Step 1: Add an "MCP server (read-only)" section**

Document: the endpoint `http://localhost:8000/mcp-server/mcp` (only while the Orbit app/sidecar is running); that it is **read-only** and **loopback-only** (beyond-loopback is unsupported); the `MCP_EXPOSE_PORTFOLIO` flag (default ON — exposes private financials to any local MCP client; set to `false` to disable) and where it is read; and the three client configs:

```text
Claude Code:  claude mcp add --transport http orbit http://localhost:8000/mcp-server/mcp
Cursor (~/.cursor/mcp.json):  {"mcpServers":{"orbit":{"url":"http://localhost:8000/mcp-server/mcp"}}}
Claude Desktop (free tier, stdio bridge):
  {"mcpServers":{"orbit":{"command":"npx","args":["-y","mcp-remote","http://localhost:8000/mcp-server/mcp"]}}}
```
Also point readers at `/.well-known/agent.json` (capability/safety manifest) and `/openapi.json`.

- [ ] **Step 2: Update llms.txt runtime interfaces**

In repo-root `llms.txt`, add under "Runtime interfaces": the MCP endpoint and that it is read-only/loopback-only.

- [ ] **Step 3: Commit**

```bash
git add docs/agent-workflow.md llms.txt
git commit -m "docs: document the read-only MCP server client wiring"
```

---

## Done criteria

- `pytest tests/test_mcp_readonly.py` green: no mutation/denylist tool exposed; portfolio flag gates the sensitive set; all expected groups present.
- Dev uvicorn AND the packaged PyInstaller binary both start (both lifespans run) and serve `/mcp-server/mcp`.
- A real MCP client lists the read tools and returns a quote.
- `MCP_EXPOSE_PORTFOLIO` documented; loopback-only trust boundary documented.
- No order/broker/process/auth/settings/ai surface reachable via MCP.

## Human-approval note

Per AGENTS.md this adds a new public contract (MCP surface). It stays inside
"decision support" (read-only, no orders), but **merge to `dev`/`main` still
requires human approval and a `policy-drift-check`** before the gate.
