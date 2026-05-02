"""
Tests for /iserver/secdef/search pre-warm (Phase 8 / Task 1.4).

IBKR snapshot doc: "For derivative contracts the endpoint
/iserver/secdef/search must be called first."

We extend this empirically to all non-STK/ETF asset classes — see
_SECDEF_PREWARM_CLASSES on IBKRService. The flow at snapshot() time is:

  1. Look up state.conid_asset_class[conid] -> (symbol, asset_class).
  2. If asset_class is in _SECDEF_PREWARM_CLASSES and the conid isn't
     already in state.secdef_warmed, call /iserver/secdef/search?
     symbol=<sym>&secType=<class>. Coalesced via per-conid lock.
  3. Mark the conid warmed (success OR failure — we don't retry 4xx).
  4. Continue with snapshot pre-flight (Task 1.3) and the real call.

Covers:
  - Cold snapshot of a CASH-class conid issues secdef/search BEFORE
    the snapshot pre-flight, BEFORE the real snapshot.
  - Cold snapshot of a STK-class conid issues NO secdef/search.
  - 5 concurrent first-time CASH callers issue exactly 1 secdef/search.
  - state.reset() clears secdef_warmed so the next call re-warms.
  - secdef/search 4xx (e.g. IBKR rejects an undocumented secType value)
    is logged + the conid is marked warmed; snapshot pre-flight still
    runs and the real snapshot still goes out.
  - Conids with no cached asset_class skip secdef-warm (treated as STK).
"""

import asyncio
import time
from unittest.mock import MagicMock

import pytest

from exceptions import IBKRRequestError
from services.ibkr import IBKRService
from state import IBKRState


# ── Helpers ──────────────────────────────────────────────────────────


def _make_svc(
    preflight_delay_ms: int = 30,
    secdef_error: Exception | None = None,
):
    """Return an IBKRService with _request mocked.

    `secdef_error`: if set, /iserver/secdef/search raises this (used to
    test the failure path). Otherwise it returns an empty list.

    Returns (svc, calls) where `calls` records every (method, endpoint,
    params_dict) hit on _request, in order. Tests assert ordering and
    counts against this log.
    """
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = IBKRState()
    svc.http = MagicMock()
    svc._tickle_task = None
    svc._ws_task = None
    # Phase 8 / Task 1.5: get_conid uses these.
    svc.db = None
    svc._conid_resolve_locks = {}

    async def _noop_accounts():
        return None

    svc.ensure_accounts = _noop_accounts  # type: ignore[method-assign]

    calls: list[tuple[str, str, dict]] = []

    async def fake_request(method: str, endpoint: str, **kwargs):
        params = dict(kwargs.get("params") or {})
        calls.append((method, endpoint, params))
        if endpoint == "/iserver/secdef/search":
            if secdef_error is not None:
                raise secdef_error
            return []
        if endpoint == "/iserver/marketdata/snapshot":
            conids = [int(c) for c in str(params.get("conids", "")).split(",") if c]
            return [{"conid": c, "31": "100.00"} for c in conids]
        raise AssertionError(f"unexpected endpoint: {endpoint}")

    svc._request = fake_request  # type: ignore[method-assign]

    import services.ibkr as ibkr_mod
    svc._test_orig_delay = ibkr_mod.PREFLIGHT_DELAY_MS
    ibkr_mod.PREFLIGHT_DELAY_MS = preflight_delay_ms
    return svc, calls


def _restore_delay(svc):
    import services.ibkr as ibkr_mod
    ibkr_mod.PREFLIGHT_DELAY_MS = svc._test_orig_delay


# ── Tests ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cash_class_issues_secdef_then_preflight_then_snapshot():
    """Cold CASH conid: secdef/search first, then snapshot pre-flight,
    then real bulk snapshot. Order matters."""
    svc, calls = _make_svc()
    try:
        # USD.ILS = CASH class
        svc.state.conid_asset_class[111] = ("USD.ILS", "CASH")

        await svc.snapshot([111])

        # 3 calls in order:
        #   1) GET /iserver/secdef/search?symbol=USD.ILS&secType=CASH
        #   2) GET /iserver/marketdata/snapshot (pre-flight) for 111
        #   3) GET /iserver/marketdata/snapshot (real bulk) for 111
        assert len(calls) == 3, f"expected 3 calls, got {len(calls)}: {calls}"
        assert calls[0][1] == "/iserver/secdef/search"
        assert calls[0][2] == {"symbol": "USD.ILS", "secType": "CASH"}
        assert calls[1][1] == "/iserver/marketdata/snapshot"
        assert calls[1][2].get("conids") == "111"
        assert calls[2][1] == "/iserver/marketdata/snapshot"
        assert calls[2][2].get("conids") == "111"
        assert 111 in svc.state.secdef_warmed
        assert 111 in svc.state.warmed_conids
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_stk_class_does_not_issue_secdef():
    """STK conids skip secdef/search entirely (only pre-flight + real)."""
    svc, calls = _make_svc()
    try:
        svc.state.conid_asset_class[265598] = ("AAPL", "STK")

        await svc.snapshot([265598])

        # No secdef/search call
        secdef_calls = [c for c in calls if c[1] == "/iserver/secdef/search"]
        assert secdef_calls == [], "STK class must not trigger secdef/search"
        # Snapshot pre-flight + real = 2 calls
        snap_calls = [c for c in calls if c[1] == "/iserver/marketdata/snapshot"]
        assert len(snap_calls) == 2
        assert 265598 not in svc.state.secdef_warmed
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_concurrent_first_time_callers_coalesce_secdef():
    """5 concurrent snapshot([99]) calls for a fresh CASH conid issue
    exactly 1 /iserver/secdef/search (lock-coalesced)."""
    svc, calls = _make_svc()
    try:
        svc.state.conid_asset_class[99] = ("USD.ILS", "CASH")

        await asyncio.gather(*(svc.snapshot([99]) for _ in range(5)))

        secdef_calls = [c for c in calls if c[1] == "/iserver/secdef/search"]
        assert len(secdef_calls) == 1, (
            f"expected exactly 1 secdef/search call (coalesced), "
            f"got {len(secdef_calls)}"
        )
        assert 99 in svc.state.secdef_warmed
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_state_reset_clears_secdef_state():
    """state.reset() clears secdef_warmed, secdef_locks, and
    conid_asset_class so the next call re-warms."""
    svc, calls = _make_svc()
    try:
        svc.state.conid_asset_class[42] = ("BTC", "CRYPTO")
        await svc.snapshot([42])
        assert 42 in svc.state.secdef_warmed
        assert 42 in svc.state.secdef_locks
        assert 42 in svc.state.conid_asset_class

        svc.state.reset()
        assert svc.state.secdef_warmed == set()
        assert svc.state.secdef_locks == {}
        assert svc.state.conid_asset_class == {}

        # Re-prime asset class (would normally happen via get_conid())
        svc.state.conid_asset_class[42] = ("BTC", "CRYPTO")
        calls.clear()
        await svc.snapshot([42])
        secdef_calls = [c for c in calls if c[1] == "/iserver/secdef/search"]
        assert len(secdef_calls) == 1, (
            f"expected re-warm after reset, got {len(secdef_calls)} secdef calls"
        )
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_secdef_failure_is_logged_and_does_not_block_snapshot(caplog):
    """If /iserver/secdef/search returns 4xx (e.g. IBKR rejects an
    undocumented secType), log a warning, mark the conid warmed anyway,
    and proceed with snapshot pre-flight + real call."""
    error = IBKRRequestError(status_code=400, detail="invalid secType")
    svc, calls = _make_svc(secdef_error=error)
    try:
        svc.state.conid_asset_class[7] = ("BTC", "CRYPTO")

        with caplog.at_level("WARNING", logger="parallax.ibkr"):
            result = await svc.snapshot([7])

        # secdef call attempted (and failed), then pre-flight + real ran
        assert calls[0][1] == "/iserver/secdef/search"
        snap_calls = [c for c in calls if c[1] == "/iserver/marketdata/snapshot"]
        assert len(snap_calls) == 2, (
            f"snapshot pre-flight + real should still run after secdef "
            f"failure; got {len(snap_calls)} snapshot calls"
        )
        # Conid is marked warmed so we don't retry the failing call
        assert 7 in svc.state.secdef_warmed
        # A warning was logged mentioning secdef
        assert any(
            "secdef" in record.getMessage().lower()
            for record in caplog.records
        ), "expected a warning log mentioning secdef"
        # Real snapshot still returned data
        assert result == [{"conid": 7, "31": "100.00"}]
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_unknown_asset_class_skips_secdef():
    """Conids with no cached asset_class fall through (treated as STK)
    and skip secdef/search. Pre-flight + real snapshot still run."""
    svc, calls = _make_svc()
    try:
        # Note: no entry in state.conid_asset_class for 555
        await svc.snapshot([555])

        secdef_calls = [c for c in calls if c[1] == "/iserver/secdef/search"]
        assert secdef_calls == [], (
            "conid with no cached asset_class must skip secdef/search"
        )
        snap_calls = [c for c in calls if c[1] == "/iserver/marketdata/snapshot"]
        assert len(snap_calls) == 2, "snapshot pre-flight + real should still run"
        assert 555 not in svc.state.secdef_warmed
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_get_conid_populates_asset_class_cache():
    """get_conid() stores (symbol, asset_class) on state.conid_asset_class
    so snapshot() can find the data without a DB roundtrip."""
    svc, _ = _make_svc()
    try:
        # Mock search() to return a single CRYPTO match
        async def fake_search(symbol: str, sec_type: str = ""):
            return [
                {
                    "conid": 1234,
                    "symbol": "BTC",
                    "sections": [{"secType": "CRYPTO", "exchange": "PAXOS"}],
                }
            ]

        svc.search = fake_search  # type: ignore[method-assign]

        conid = await svc.get_conid("BTC")
        assert conid == 1234
        assert svc.state.conid_asset_class.get(1234) == ("BTC", "CRYPTO")
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_mixed_asset_class_batch():
    """Batch with one CASH + one CRYPTO + one STK + one unknown:
    secdef/search fires for CASH and CRYPTO only (in parallel)."""
    svc, calls = _make_svc()
    try:
        svc.state.conid_asset_class[101] = ("USD.ILS", "CASH")
        svc.state.conid_asset_class[102] = ("BTC", "CRYPTO")
        svc.state.conid_asset_class[103] = ("AAPL", "STK")
        # 104 has no cached asset_class

        await svc.snapshot([101, 102, 103, 104])

        secdef_calls = [c for c in calls if c[1] == "/iserver/secdef/search"]
        assert len(secdef_calls) == 2, (
            f"expected 2 secdef calls (CASH + CRYPTO only), got {len(secdef_calls)}"
        )
        # Verify the two secdef calls hit the right secTypes
        sectypes_called = {c[2].get("secType") for c in secdef_calls}
        assert sectypes_called == {"CASH", "CRYPTO"}
        # Snapshot pre-flight runs for all 4 cold conids (4 calls), then
        # one real bulk call = 5 snapshot calls
        snap_calls = [c for c in calls if c[1] == "/iserver/marketdata/snapshot"]
        assert len(snap_calls) == 5, (
            f"expected 4 pre-flights + 1 bulk = 5 snapshot calls, "
            f"got {len(snap_calls)}"
        )
        assert {101, 102}.issubset(svc.state.secdef_warmed)
        assert 103 not in svc.state.secdef_warmed
        assert 104 not in svc.state.secdef_warmed
    finally:
        _restore_delay(svc)
