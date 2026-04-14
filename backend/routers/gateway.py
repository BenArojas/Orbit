"""
/gateway — IBKR Client Portal Gateway provisioning and lifecycle endpoints.

These endpoints let the frontend:
  - Check if the Gateway is provisioned and running
  - Trigger first-time provisioning (download JRE + Gateway)
  - Start / stop the Gateway process
  - Get provisioning progress during downloads
"""

import asyncio
import logging

from fastapi import APIRouter, Depends

from deps import get_gateway, get_ibkr
from exceptions import IBKRConnectionError
from services.gateway import GatewayLifecycle
from services.ibkr import IBKRService

log = logging.getLogger("parallax.routers.gateway")

router = APIRouter(prefix="/gateway", tags=["gateway"])

# ── B4: in-flight auth probe lock ────────────────────────────────────────────
# The frontend polls /gateway/status every 2 s while needsLogin is true.
# Each poll triggers ibkr.auth_status() → POST to the Gateway.
# Under fast polling this can overlap.  A simple lock serialises probes so we
# never fire two concurrent auth checks to the same Gateway endpoint.
_auth_probe_lock = asyncio.Lock()


def _enrich_status(status: dict) -> dict:
    """Ensure all frontend-expected auth fields are present on any status dict.

    The base ``gw.status()`` dict only has lifecycle fields.  The frontend's
    ``GatewayStatusResponse`` type always expects ``authenticated``,
    ``auth_required``, and ``auth_message``.  Action endpoints (provision,
    start, stop) that skip the auth probe still need these keys set to safe
    defaults so the frontend doesn't see ``undefined``.
    """
    status.setdefault("authenticated", False)
    status.setdefault("auth_required", status.get("running", False))
    status.setdefault("auth_message", "")
    return status


@router.get("/status")
async def gateway_status(
    gw: GatewayLifecycle = Depends(get_gateway),
    ibkr: IBKRService = Depends(get_ibkr),
) -> dict:
    """
    Current Gateway state.
    Frontend polls this to decide what UI to show:
      - not_provisioned → "Set up" button
      - downloading_* → progress bar
      - provisioned → "Start" button
      - running → green indicator (+ auth state)
      - error → error message + retry

    When the Gateway is running this endpoint also probes IBKR auth status
    and, on first successful auth, starts the session keep-alive tickle loop.
    """
    status = gw.status()

    authenticated = False
    auth_message = "Gateway not running."

    if status["running"]:
        # B4: serialise concurrent polls — skip if a probe is already in flight
        if _auth_probe_lock.locked():
            # Return last known auth state from ibkr service state
            authenticated = ibkr.state.authenticated
            auth_message = "Checking auth status..."
        else:
            async with _auth_probe_lock:
                try:
                    auth = await ibkr.auth_status()
                    authenticated = auth["authenticated"]
                    auth_message = auth["message"]

                    # B1: start tickle loop here too — not only from /auth/status.
                    # This ensures the session stays alive regardless of which
                    # endpoint the frontend uses to detect auth.
                    if authenticated:
                        await ibkr.start_tickle_loop()
                except IBKRConnectionError as exc:
                    # Gateway is running (port is up) but not yet ready to answer
                    # auth probes — e.g. JVM still warming up. Return a clean status
                    # instead of crashing the ASGI handler with a ReadTimeout.
                    log.warning("Auth probe failed (Gateway not ready yet): %s", exc)
                    authenticated = False
                    auth_message = "Gateway starting up — auth check pending."

    status["authenticated"] = authenticated
    status["auth_required"] = status["running"] and not authenticated
    status["auth_message"] = auth_message
    return status


@router.post("/provision")
async def gateway_provision(
    force: bool = False,
    gw: GatewayLifecycle = Depends(get_gateway),
) -> dict:
    """
    Download and set up JRE + Gateway files.
    Idempotent — skips downloads if files already exist (unless force=True).
    After provisioning, the Gateway is ready to start but not yet running.
    """
    await gw.provision(force=force)
    return _enrich_status(gw.status())


@router.post("/start")
async def gateway_start(gw: GatewayLifecycle = Depends(get_gateway)) -> dict:
    """
    Start the Gateway process.
    If it's already running (externally or via Docker), detects that and returns success.
    Raises 400 if not provisioned.
    """
    await gw.start()
    return _enrich_status(gw.status())


@router.post("/stop")
async def gateway_stop(gw: GatewayLifecycle = Depends(get_gateway)) -> dict:
    """
    Stop the Gateway process (only if we started it).
    No-op if Gateway was started externally.
    """
    await gw.stop()
    return _enrich_status(gw.status())


@router.post("/reprovision")
async def gateway_reprovision(gw: GatewayLifecycle = Depends(get_gateway)) -> dict:
    """
    Force re-download of JRE + Gateway.
    Useful when IBKR releases a Gateway update.
    Stops the running process first if needed.
    """
    await gw.stop()
    await gw.provision(force=True)
    return _enrich_status(gw.status())


@router.post("/reset-conf")
async def gateway_reset_conf(gw: GatewayLifecycle = Depends(get_gateway)) -> dict:
    """
    Overwrite conf.yaml with the built-in defaults.

    Use when the on-disk config is broken or stale (e.g. wrong ip2loc,
    restrictive ips.allow, missing svcEnvironment).  The Gateway must be
    restarted after this for the new config to take effect.
    """
    conf_path = gw.reset_conf_yaml()
    status = _enrich_status(gw.status())
    status["conf_reset"] = True
    status["conf_path"] = str(conf_path)
    return status
