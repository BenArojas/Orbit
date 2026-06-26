"""
Agent discovery router.

Serves a small machine-readable capability + safety manifest at
``GET /.well-known/agent.json`` so any local agent (the in-app AI, an MCP
client, or a plain HTTP caller) that connects to the backend can discover what
Orbit is, what it can do, and — critically — that it never trades autonomously.

This is the runtime counterpart to the static repo-root ``llms.txt``. Facts
here are derived from the live app object and the project's non-negotiable
safety rules, so they cannot drift from what the backend actually enforces.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Request

router = APIRouter(tags=["agent"])

LLMS_TXT_URL = "https://github.com/BenArojas/orbit/blob/main/llms.txt"


@router.get("/.well-known/agent.json")
async def agent_manifest(request: Request) -> dict:
    """Capability + safety manifest for agents connecting to the backend."""
    app = request.app
    base = str(request.base_url).rstrip("/")
    return {
        "name": app.title,
        "version": app.version,
        "kind": "decision-support",
        "summary": "Local-first trading decision-support backend. Never trades autonomously.",
        "safety": {
            "decision_support_only": True,
            "autonomous_trading": False,
            "broker_execution_requires_human": True,
            "policy": (
                "Orbit never places or executes orders on its own. Every broker "
                "action requires explicit human confirmation. All broker, AI, and "
                "persistence access flows through this backend."
            ),
        },
        "modules": [
            {"name": "Parallax", "does": "technical analysis, screening, watchlists, alerts"},
            {"name": "MoonMarket", "does": "portfolio, account, options, human-confirmed order workflows"},
            {"name": "Inflect", "does": "trading journal and trade review"},
        ],
        "conventions": {
            "instrument_id": "conid",
            "note": "Use conid across module boundaries; ticker text is display metadata only.",
        },
        "interfaces": {
            "openapi": f"{base}{app.openapi_url}",
            "docs": f"{base}{app.docs_url}" if app.docs_url else None,
            "llms_txt": LLMS_TXT_URL,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
