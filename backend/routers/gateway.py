"""
/gateway — IBKR Client Portal Gateway provisioning and lifecycle endpoints.

These endpoints let the frontend:
  - Check if the Gateway is provisioned and running
  - Trigger first-time provisioning (download JRE + Gateway)
  - Start / stop the Gateway process
  - Get provisioning progress during downloads
"""

import logging

from fastapi import APIRouter, Depends

from deps import get_gateway, get_ibkr
from exceptions import IBKRConnectionError, IBKRRequestError
from services.gateway import GatewayLifecycle
from services.ibkr import IBKRService

log = logging.getLogger("parallax.routers.gateway")

router = APIRouter(prefix="/gateway", tags=["gateway"])

# Note: the in-flight `_auth_probe_lock` that used to serialise concurrent
# `/gateway/status` polls was removed in Phase 8 / Task 1.7.  The new
# auth-status cache (TTL = AUTH_STATUS_TTL_SEC, default 5s) handles
# concurrent polls inside `IBKRService.auth_status()`: the first caller in
# a 5s window probes IBKR once, every other caller in that window receives
# the cached payload immediately.  The single-flight asyncio.Lock inside
# auth_status() additionally prevents two cold-cache concurrent callers
# from both probing — strictly stronger than the old lock here.


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
        # Task 1.7: auth_status() is now cached (AUTH_STATUS_TTL_SEC = 5s
        # default).  Concurrent polls share one IBKR probe, and the single-
        # flight lock inside auth_status() prevents the cold-cache
        # double-probe that the old `_auth_probe_lock` here used to guard.
        try:
            auth = await ibkr.auth_status()
            authenticated = auth["authenticated"]
            auth_message = auth["message"]

            # B1: start tickle loop here too — not only from /auth/status.
            # This ensures the session stays alive regardless of which
            # endpoint the frontend uses to detect auth.
            if authenticated:
                await ibkr.start_tickle_loop()
                # Cold-start protocol (Phase 8 / Task 1.2):
                # /iserver/accounts must be called before snapshot
                # and order endpoints respond. auth_status() handles
                # this on the first transition; this call is the
                # safety net for any path where state was reset
                # mid-session before the probe.
                if not ibkr.state.accounts_fetched:
                    try:
                        await ibkr.ensure_accounts()
                    except IBKRRequestError as exc:
                        log.warning(
                            "ensure_accounts() failed at /gateway/status response: %s",
                            exc,
                        )
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
    # Expose mid-session disconnect flag — the frontend uses this to show a
    # targeted "session expired" banner instead of the generic login prompt.
    status["session_dropped"] = ibkr.state.session_dropped
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


@router.post("/logout")
async def gateway_logout(
    gw: GatewayLifecycle = Depends(get_gateway),
    ibkr: IBKRService = Depends(get_ibkr),
) -> dict:
    """
    R1-soft: POST IBKR /logout — drops the session without restarting Java.

    Sequence:
      1. Stop the tickle keep-alive loop (would otherwise race a dead session).
      2. Close the IBKR WebSocket.
      3. POST to the Gateway's /v1/api/logout endpoint.
      4. Reset in-memory auth state.

    The Gateway JVM keeps running and port 5001 stays bound — the user can
    immediately click "Open IBKR Login" to re-authenticate without waiting
    for a Java cold start.

    For deeper recovery (e.g. Java itself wedged) use /reset-session.
    """
    log.info("Gateway logout requested")
    await ibkr._stop_tickle()
    await ibkr.stop_ibkr_websocket()
    result = await gw.logout()
    ibkr.state.reset()
    # Task 1.7: drop cached "authenticated: True" so the very next
    # /gateway/status poll re-probes IBKR and reflects the logged-out
    # state immediately (otherwise the UI shows authenticated for up
    # to AUTH_STATUS_TTL_SEC after this call returns).
    ibkr.invalidate_auth_cache()
    status = _enrich_status(gw.status())
    status["reset"] = "logout"
    status["logout_response"] = result
    return status


@router.post("/reset-session")
async def gateway_reset_session(
    gw: GatewayLifecycle = Depends(get_gateway),
    ibkr: IBKRService = Depends(get_ibkr),
) -> dict:
    """
    R2-full: recover from a wedged session without re-downloading binaries.

    Steps:
      1. Stop the tickle keep-alive loop
      2. Close the IBKR WebSocket (if open)
      3. Stop the Gateway subprocess
      4. Reset in-memory auth/session flags
      5. Start the Gateway again

    Use when login succeeded but the UI never updated, or subsequent login
    attempts fail to trigger the IBKR dispatcher download. Does NOT touch
    files on disk — for that, use /factory-reset.
    """
    log.info("Gateway reset-session requested")
    await ibkr._stop_tickle()
    await ibkr.stop_ibkr_websocket()
    await gw.stop()
    ibkr.state.reset()
    ibkr.invalidate_auth_cache()  # Task 1.7
    await gw.start()
    status = _enrich_status(gw.status())
    status["reset"] = "session"
    return status


@router.post("/factory-reset")
async def gateway_factory_reset(
    gw: GatewayLifecycle = Depends(get_gateway),
    ibkr: IBKRService = Depends(get_ibkr),
) -> dict:
    """
    R3-surgical: reset-session + delete session-state files on disk.

    Removes root/logs/, root/Jts/, any *.cookie / *.session files in root/,
    and gateway.log. Preserves the JRE, Gateway binaries, and conf.yaml.

    Use when reset-session alone is not enough — typically when IBKR's own
    dispatcher caching is masking a stale local session.
    """
    log.info("Gateway factory-reset requested")
    await ibkr._stop_tickle()
    await ibkr.stop_ibkr_websocket()
    await gw.stop()
    ibkr.state.reset()
    ibkr.invalidate_auth_cache()  # Task 1.7
    removed = gw.clear_session_files()
    await gw.start()
    status = _enrich_status(gw.status())
    status["reset"] = "factory"
    status["files_removed"] = removed
    return status
