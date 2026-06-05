"""
Health Details Router — Phase 7.5

GET /health/details — aggregated system health for the frontend health strip.

Returns five named checks in plain English:
  - IBKR Gateway   (is the gateway process running + authenticated?)
  - Ollama          (is the AI server running + a model selected?)
  - Scanner         (is the background trigger scanner active?)
  - Database        (can we issue a lightweight query?)
  - Background Triggers (are any trigger rules enabled?)

Each check has:
  ok:      bool    — green (True) or red/yellow (False)
  label:   str     — display name shown in the modal
  message: str     — plain-English status sentence

The overall severity is:
  "ok"       — all checks pass
  "warning"  — non-critical issues (e.g. Ollama not ready, scanner waiting)
  "error"    — critical issues (gateway down, DB failure)

The frontend polls this every 10 s and also exposes a "Copy diagnostics"
button that dumps the raw response JSON to the clipboard — that's the only
place raw technical detail is visible.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from deps import get_db, get_gateway, get_ibkr, get_ollama, get_scanner
from exceptions import IBKRConnectionError
from services.db import DatabaseService
from services.gateway import GatewayLifecycle
from services.ibkr import IBKRService
from services.ollama import OllamaLifecycle
from services.scanner import ScannerService

log = logging.getLogger("parallax.routers.health")

router = APIRouter(prefix="/health", tags=["health"])


# ── Individual check helpers ──────────────────────────────────────────────────

def _check_gateway(gw: GatewayLifecycle, ibkr: IBKRService) -> dict:
    gw_status = gw.status()
    running = gw_status.get("running", False)
    authenticated = ibkr.state.authenticated
    session_dropped = ibkr.state.session_dropped

    if session_dropped:
        return {
            "ok": False,
            "label": "IBKR Gateway",
            "message": "Session dropped — re-authentication required.",
            "severity": "error",
        }
    if not running:
        state = gw_status.get("state", "unknown")
        return {
            "ok": False,
            "label": "IBKR Gateway",
            "message": f"Gateway not running (state: {state}).",
            "severity": "error",
        }
    if not authenticated:
        return {
            "ok": False,
            "label": "IBKR Gateway",
            "message": "Gateway running but not authenticated — log in via the IBKR portal.",
            "severity": "warning",
        }
    return {
        "ok": True,
        "label": "IBKR Gateway",
        "message": "Connected and authenticated.",
        "severity": "ok",
    }


def _check_ollama(ollama: OllamaLifecycle) -> dict:
    s = ollama.status()
    state = s.get("state", "unknown")

    if state == "ready":
        model = s.get("selected_model") or "unknown model"
        return {
            "ok": True,
            "label": "Ollama (AI)",
            "message": f"Running — model: {model}.",
            "severity": "ok",
        }
    if state in ("running", "installed"):
        return {
            "ok": False,
            "label": "Ollama (AI)",
            "message": "Ollama is running but no model is selected. AI features unavailable.",
            "severity": "warning",
        }
    if state == "not_installed":
        return {
            "ok": False,
            "label": "Ollama (AI)",
            "message": "Ollama is not installed. AI features unavailable.",
            "severity": "warning",
        }
    return {
        "ok": False,
        "label": "Ollama (AI)",
        "message": f"Ollama state: {state}. AI features may be unavailable.",
        "severity": "warning",
    }


def _check_scanner(scanner: ScannerService) -> dict:
    s = scanner.status()
    running = s.get("running", False)
    waiting = s.get("waiting_for_auth", False)
    last_run = s.get("last_run_at")  # ISO string or None

    if waiting:
        return {
            "ok": False,
            "label": "Scanner",
            "message": "Waiting for IBKR authentication before scanning.",
            "severity": "warning",
        }
    if not running:
        return {
            "ok": False,
            "label": "Scanner",
            "message": "Background scanner is not running.",
            "severity": "warning",
        }

    if last_run:
        try:
            dt = datetime.fromisoformat(last_run)
            # Make timezone-aware if naive
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_s = (datetime.now(timezone.utc) - dt).total_seconds()
            age_min = int(age_s // 60)
            time_str = f"{age_min}m ago" if age_min > 0 else "just now"
            msg = f"Running — last scan {time_str}."
        except ValueError:
            msg = "Running."
    else:
        msg = "Running — no scans completed yet."

    return {
        "ok": True,
        "label": "Scanner",
        "message": msg,
        "severity": "ok",
    }


async def _check_database(db: DatabaseService) -> dict:
    try:
        # Lightweight read — just fetch one setting
        await db.get_setting("scan_interval")
        return {
            "ok": True,
            "label": "Database",
            "message": "SQLite database is accessible.",
            "severity": "ok",
        }
    except Exception as exc:  # noqa: BLE001 — intentional catch-all for health probe
        log.warning("Health DB check failed: %s", exc)
        return {
            "ok": False,
            "label": "Database",
            "message": "Database query failed — the app may not function correctly.",
            "severity": "error",
        }


async def _check_triggers(db: DatabaseService) -> dict:
    try:
        rules = await db.get_trigger_rules()
        enabled = [r for r in rules if r.get("enabled", False)]
        total = len(rules)
        n_enabled = len(enabled)

        if total == 0:
            return {
                "ok": True,
                "label": "Trigger Rules",
                "message": "No trigger rules configured.",
                "severity": "ok",
            }
        return {
            "ok": True,
            "label": "Trigger Rules",
            "message": f"{n_enabled} of {total} rule{'s' if total != 1 else ''} active.",
            "severity": "ok",
        }
    except Exception as exc:  # noqa: BLE001
        log.warning("Health trigger check failed: %s", exc)
        return {
            "ok": False,
            "label": "Trigger Rules",
            "message": "Could not read trigger rules from database.",
            "severity": "warning",
        }


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/details")
async def health_details(
    gw: GatewayLifecycle = Depends(get_gateway),
    ibkr: IBKRService = Depends(get_ibkr),
    ollama: OllamaLifecycle = Depends(get_ollama),
    scanner: ScannerService = Depends(get_scanner),
    db: DatabaseService = Depends(get_db),
) -> dict:
    """
    Aggregated health check for the frontend health strip (Phase 7.5).

    Phase 8 / Task 2.4 — shape superset of /gateway/status.

    The response is a strict superset of /gateway/status: every key that
    endpoint returns is present here with an identical value, plus the
    per-subsystem check breakdown.  This allows the frontend (Task 3.6) to
    switch to polling /health/details only and drop the /gateway/status clock.

    Auth state comes from IBKRService.auth_status() which is cached for
    AUTH_STATUS_TTL_SEC (Task 1.7) — no extra IBKR probe is issued.
    """
    checks = [
        _check_gateway(gw, ibkr),
        _check_ollama(ollama),
        await _check_scanner_async(scanner),
        await _check_database(db),
        await _check_triggers(db),
    ]

    # Overall severity: any error → "error", any warning → "warning", else "ok"
    severities = [c["severity"] for c in checks]
    if "error" in severities:
        overall = "error"
    elif "warning" in severities:
        overall = "warning"
    else:
        overall = "ok"

    # ── /gateway/status field parity (Task 2.4) ───────────────────────────
    # Mirror the exact same logic as gateway_status() so both endpoints
    # return bit-for-bit identical values for the shared key subset.
    gw_status = gw.status()
    authenticated = False
    auth_message = "Gateway not running."

    if gw_status["running"]:
        try:
            auth = await ibkr.auth_status()
            authenticated = auth["authenticated"]
            auth_message = auth.get("message", "")
        except IBKRConnectionError as exc:
            log.warning("Auth probe in /health/details failed: %s", exc)
            auth_message = "Gateway starting up — auth check pending."

    return {
        # /gateway/status fields — frontend can drop that polling clock
        # once it switches to /health/details (Task 3.6).
        **gw_status,
        "authenticated": authenticated,
        "auth_required": gw_status["running"] and not authenticated,
        "auth_message": auth_message,
        "session_dropped": ibkr.state.session_dropped,
        # /health/details-specific fields
        "overall": overall,
        "checks": checks,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def _check_scanner_async(scanner: ScannerService) -> dict:
    """Thin async wrapper so health_details stays fully async."""
    return _check_scanner(scanner)
