"""Read-only MCP server for Orbit.

Generates an MCP server from the existing FastAPI app (no duplicated handlers)
and exposes ONLY decision-support reads. Order placement, broker/process
mutations, auth, gateway, settings, and AI-provider control can never appear —
enforced by a positive path-prefix allowlist plus a catch-all EXCLUDE, and
asserted by tests/test_mcp_readonly.py (RouteMap is config, not an auth boundary).

Design: docs/superpowers/specs/2026-06-26-mcp-readonly-server-design.md
"""
from __future__ import annotations

import os

from fastmcp import FastMCP
from fastmcp.server.providers.openapi import MCPType, RouteMap

# Positive allowlist of read groups exposed by default. Anything not matched
# here (every non-GET, and any future router) is dropped by the catch-all EXCLUDE.
BASE_ALLOW = (
    r"^/market/|^/instruments/|^/screener/|^/sectors/|"
    r"^/moonmarket/options/|^/watchlist/|^/fibonacci/|^/inflect/setups"
)

# Sensitive private-financial reads (balances, positions, P&L, cost basis),
# gated by MCP_EXPOSE_PORTFOLIO. Pure GETs, but they expose account data.
SENSITIVE_ALLOW = (
    r"^/moonmarket/accounts|^/moonmarket/portfolio|^/moonmarket/performance|"
    r"^/moonmarket/trades|^/moonmarket/live-orders|"
    r"^/inflect/(calendar|trades|symbols|basis-lots|basis-audit|backfill-status)"
)

# Substrings that must NEVER appear in a generated tool's name (path-encoded with
# underscores). The test asserts their absence even though they are filtered out
# by the route maps — config is not the boundary, the assertion is.
# NB: "moonmarket_orders" (order placement) is denied; "moonmarket_live_orders"
# (a sensitive working-orders READ) is allowed when the portfolio flag is on.
DENY_NAME_TOKENS = (
    "moonmarket_orders",
    "trading_safety",
    "auth",
    "gateway",
    "settings",
    "ai_providers",
    "ai_status",
    "ai_routing",
    "ai_models",
    "ai_runs",
    "ai_setup",
)

# Mutation method suffixes FastMCP appends to tool names. None may appear.
DENY_NAME_SUFFIXES = ("_post", "_put", "_patch", "_delete")


def expose_portfolio() -> bool:
    """Whether the sensitive portfolio/journal reads are exposed (default ON)."""
    return os.getenv("MCP_EXPOSE_PORTFOLIO", "true").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def build_mcp(app) -> FastMCP:
    """Build the read-only FastMCP server from the existing FastAPI ``app``."""
    route_maps = [RouteMap(methods=["GET"], pattern=BASE_ALLOW, mcp_type=MCPType.TOOL)]
    if expose_portfolio():
        route_maps.append(
            RouteMap(methods=["GET"], pattern=SENSITIVE_ALLOW, mcp_type=MCPType.TOOL)
        )
    # Catch-all: drop everything else, including every non-GET (orders, etc.).
    route_maps.append(RouteMap(mcp_type=MCPType.EXCLUDE))
    return FastMCP.from_fastapi(app=app, name="Orbit (read-only)", route_maps=route_maps)
