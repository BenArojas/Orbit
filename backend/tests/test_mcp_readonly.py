"""The read-only MCP safety boundary.

RouteMap is config, not an auth boundary — so this test IS the boundary. It
builds the mounted server in-process and asserts that no order/auth/gateway/
settings/ai or mutation tool is ever exposed, and that the MCP_EXPOSE_PORTFOLIO
flag gates the sensitive portfolio/journal reads both ways.

Uses a bare FastAPI app (the real routers, no IBKR/Ollama lifespan), so no
gateway is required to run it.
"""
import pytest
from fastapi import FastAPI
from fastmcp import Client

import main
from mcp_server import DENY_NAME_SUFFIXES, DENY_NAME_TOKENS, build_mcp


def _app() -> FastAPI:
    app = FastAPI(title="Orbit", version="test")
    for r in main.ALL_ROUTERS:
        app.include_router(r)
    return app


async def _tool_names(monkeypatch, expose: str) -> list[str]:
    monkeypatch.setenv("MCP_EXPOSE_PORTFOLIO", expose)
    async with Client(build_mcp(_app())) as client:
        return [t.name for t in await client.list_tools()]


@pytest.mark.asyncio
async def test_no_forbidden_tool_is_exposed(monkeypatch):
    # Even with the sensitive flag ON, none of these may appear.
    names = await _tool_names(monkeypatch, "true")
    for name in names:
        for tok in DENY_NAME_TOKENS:
            assert tok not in name, f"forbidden token {tok!r} in MCP tool {name!r}"


@pytest.mark.asyncio
async def test_no_mutation_tools(monkeypatch):
    names = await _tool_names(monkeypatch, "true")
    for name in names:
        assert not name.endswith(DENY_NAME_SUFFIXES), f"mutation tool exposed: {name!r}"


@pytest.mark.asyncio
async def test_portfolio_flag_gates_sensitive(monkeypatch):
    off = await _tool_names(monkeypatch, "false")
    on = await _tool_names(monkeypatch, "true")
    sensitive = ("moonmarket_portfolio", "inflect_trades", "moonmarket_trades")
    assert not any(s in n for n in off for s in sensitive), "sensitive read leaked when flag OFF"
    assert any(s in n for n in on for s in sensitive), "sensitive read missing when flag ON"
    # Turning the flag on only adds tools; it never removes a base tool.
    assert set(off) < set(on)


@pytest.mark.asyncio
async def test_expected_read_groups_present(monkeypatch):
    names = await _tool_names(monkeypatch, "true")
    for group in ("market", "screener", "sectors", "options", "watchlist",
                  "fibonacci", "instruments", "inflect_setups"):
        assert any(group in n for n in names), f"expected read group {group!r} missing"
