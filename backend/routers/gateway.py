"""
/gateway — IBKR Client Portal Gateway provisioning and lifecycle endpoints.

These endpoints let the frontend:
  - Check if the Gateway is provisioned and running
  - Trigger first-time provisioning (download JRE + Gateway)
  - Start / stop the Gateway process
  - Get provisioning progress during downloads
"""

from fastapi import APIRouter, Depends

from deps import get_gateway
from services.gateway import GatewayLifecycle

router = APIRouter(prefix="/gateway", tags=["gateway"])


@router.get("/status")
async def gateway_status(gw: GatewayLifecycle = Depends(get_gateway)) -> dict:
    """
    Current Gateway state.
    Frontend polls this to decide what UI to show:
      - not_provisioned → "Set up" button
      - downloading_* → progress bar
      - provisioned → "Start" button
      - running → green indicator
      - error → error message + retry
    """
    return gw.status()


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
    return gw.status()


@router.post("/start")
async def gateway_start(gw: GatewayLifecycle = Depends(get_gateway)) -> dict:
    """
    Start the Gateway process.
    If it's already running (externally or via Docker), detects that and returns success.
    Raises 400 if not provisioned.
    """
    await gw.start()
    return gw.status()


@router.post("/stop")
async def gateway_stop(gw: GatewayLifecycle = Depends(get_gateway)) -> dict:
    """
    Stop the Gateway process (only if we started it).
    No-op if Gateway was started externally.
    """
    await gw.stop()
    return gw.status()


@router.post("/reprovision")
async def gateway_reprovision(gw: GatewayLifecycle = Depends(get_gateway)) -> dict:
    """
    Force re-download of JRE + Gateway.
    Useful when IBKR releases a Gateway update.
    Stops the running process first if needed.
    """
    await gw.stop()
    await gw.provision(force=True)
    return gw.status()
