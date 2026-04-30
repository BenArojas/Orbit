"""
Tests for the /iserver/accounts cold-start bootstrap (Phase 8 / Task 1.2).

IBKR requires /iserver/accounts to be called before /iserver/marketdata
/snapshot and the order endpoints will respond correctly. We bootstrap
on the first False -> True auth transition and cache the result in
`state.accounts_fetched` until `state.reset()` clears it.

Covers:
  - state.accounts and state.selected_account are populated after a
    successful auth_status() probe.
  - 5 consecutive auth_status() calls produce exactly one
    /iserver/accounts call (idempotent via state.accounts_fetched).
  - state.reset() clears accounts_fetched; the next authenticated
    transition triggers a fresh /iserver/accounts call.
  - An IBKRRequestError on /iserver/accounts is logged but does not
    prevent auth_status() from returning authenticated=True; accounts
    are retried on the next probe.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from exceptions import IBKRRequestError
from services.ibkr import IBKRService
from state import IBKRState


# ── Helpers ──────────────────────────────────────────────────────────


def _make_ibkr(
    auth_payload: dict | None = None,
    accounts_payload: dict | None = None,
    accounts_error: Exception | None = None,
) -> tuple[IBKRService, list[tuple[str, str]]]:
    """Return an IBKRService whose _request dispatches by path.

    Returns (svc, call_log) where call_log records every (method, endpoint)
    that hit _request, in order. Tests assert exact counts against this log.
    """
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = IBKRState()
    svc.http = MagicMock()
    svc._tickle_task = None
    svc._ws_task = None

    auth_payload = auth_payload or {
        "authenticated": True,
        "connected": True,
        "message": "ok",
    }
    accounts_payload = accounts_payload or {
        "accounts": ["DU1234567"],
        "selectedAccount": "DU1234567",
    }

    call_log: list[tuple[str, str]] = []

    async def fake_request(method: str, endpoint: str, **kwargs):
        call_log.append((method, endpoint))
        if endpoint == "/iserver/auth/status":
            return auth_payload
        if endpoint == "/iserver/accounts":
            if accounts_error is not None:
                raise accounts_error
            return accounts_payload
        raise AssertionError(f"unexpected endpoint in test: {endpoint}")

    svc._request = fake_request  # type: ignore[method-assign]
    return svc, call_log


# ── Tests ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_auth_status_populates_accounts_on_first_success():
    svc, calls = _make_ibkr()

    result = await svc.auth_status()

    assert result["authenticated"] is True
    assert svc.state.authenticated is True
    assert svc.state.accounts_fetched is True
    assert svc.state.accounts == ["DU1234567"]
    assert svc.state.selected_account == "DU1234567"
    # First probe issues one auth/status + one accounts call, in order
    assert calls == [
        ("POST", "/iserver/auth/status"),
        ("GET", "/iserver/accounts"),
    ]


@pytest.mark.asyncio
async def test_repeated_auth_status_calls_only_one_accounts_fetch():
    """5 calls to auth_status() must result in exactly 1 /iserver/accounts."""
    svc, calls = _make_ibkr()

    for _ in range(5):
        await svc.auth_status()

    accounts_calls = [c for c in calls if c == ("GET", "/iserver/accounts")]
    auth_calls = [c for c in calls if c == ("POST", "/iserver/auth/status")]
    assert len(accounts_calls) == 1, (
        f"expected exactly 1 /iserver/accounts, got {len(accounts_calls)}"
    )
    assert len(auth_calls) == 5
    assert svc.state.accounts_fetched is True


@pytest.mark.asyncio
async def test_state_reset_triggers_fresh_accounts_fetch():
    """After state.reset(), the next authenticated probe re-fetches."""
    svc, calls = _make_ibkr()

    await svc.auth_status()
    assert svc.state.accounts_fetched is True
    fetches_before_reset = sum(1 for c in calls if c == ("GET", "/iserver/accounts"))
    assert fetches_before_reset == 1

    # User logs out / session is dropped — state cleared
    svc.state.reset()
    assert svc.state.accounts_fetched is False
    assert svc.state.accounts == []
    assert svc.state.selected_account is None

    # Next probe must fetch again (False -> True transition + accounts_fetched=False)
    await svc.auth_status()
    fetches_after_reset = sum(1 for c in calls if c == ("GET", "/iserver/accounts"))
    assert fetches_after_reset == 2, (
        f"expected 2 /iserver/accounts after reset, got {fetches_after_reset}"
    )
    assert svc.state.accounts_fetched is True


@pytest.mark.asyncio
async def test_accounts_fetch_failure_does_not_block_auth(caplog):
    """An IBKRRequestError on /iserver/accounts must not flip authenticated
    to False; the warning is logged and the next probe will retry."""
    error = IBKRRequestError(status_code=500, detail="upstream blew up")
    svc, calls = _make_ibkr(accounts_error=error)

    with caplog.at_level("WARNING", logger="parallax.ibkr"):
        result = await svc.auth_status()

    # Auth itself succeeded
    assert result["authenticated"] is True
    assert svc.state.authenticated is True
    # ...but the accounts cache was NOT populated, so the next probe retries
    assert svc.state.accounts_fetched is False
    assert svc.state.accounts == []
    assert svc.state.selected_account is None
    # A warning mentioning ensure_accounts was emitted
    assert any(
        "ensure_accounts" in record.getMessage().lower()
        or "accounts" in record.getMessage().lower()
        for record in caplog.records
    ), "expected a warning log about the failed accounts fetch"

    # Both calls were attempted: auth then accounts (which raised)
    assert calls == [
        ("POST", "/iserver/auth/status"),
        ("GET", "/iserver/accounts"),
    ]

    # The next probe retries the accounts call (idempotent retry path)
    # Replace _request with a healthy mock so the retry succeeds.
    healthy_calls: list[tuple[str, str]] = []

    async def healthy_request(method: str, endpoint: str, **kwargs):
        healthy_calls.append((method, endpoint))
        if endpoint == "/iserver/auth/status":
            return {"authenticated": True, "connected": True, "message": "ok"}
        if endpoint == "/iserver/accounts":
            return {"accounts": ["DU1234567"], "selectedAccount": "DU1234567"}
        raise AssertionError(endpoint)

    svc._request = healthy_request  # type: ignore[method-assign]
    await svc.auth_status()
    assert ("GET", "/iserver/accounts") in healthy_calls
    assert svc.state.accounts_fetched is True
    assert svc.state.accounts == ["DU1234567"]


@pytest.mark.asyncio
async def test_unauthenticated_response_does_not_call_accounts():
    """If the auth probe says not authenticated, /iserver/accounts is skipped."""
    svc, calls = _make_ibkr(
        auth_payload={"authenticated": False, "connected": False, "message": "no"},
    )

    result = await svc.auth_status()

    assert result["authenticated"] is False
    assert svc.state.authenticated is False
    assert svc.state.accounts_fetched is False
    accounts_calls = [c for c in calls if c == ("GET", "/iserver/accounts")]
    assert accounts_calls == [], "must not call /iserver/accounts when not authenticated"


@pytest.mark.asyncio
async def test_already_authenticated_state_does_not_refetch():
    """If state.authenticated is already True AND accounts_fetched is True,
    a subsequent auth_status() probe must not re-issue /iserver/accounts."""
    svc, calls = _make_ibkr()

    # First probe primes the cache
    await svc.auth_status()
    assert svc.state.accounts_fetched is True

    # Subsequent probe: no transition + cache already warm -> no extra fetch
    await svc.auth_status()
    accounts_calls = [c for c in calls if c == ("GET", "/iserver/accounts")]
    assert len(accounts_calls) == 1, (
        f"expected 1 /iserver/accounts across two probes, got {len(accounts_calls)}"
    )
