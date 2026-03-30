"""
Pydantic models for request/response types.
Full model set will be built in Step 1.7 — this is the starter set
needed for auth and health endpoints.
"""

from pydantic import BaseModel


# ── Health / Status ──────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str  # "ok" or "degraded"
    ibkr_connected: bool
    ibkr_authenticated: bool
    ws_ready: bool
    version: str


class AuthStatusResponse(BaseModel):
    authenticated: bool
    ws_ready: bool
    message: str
