"""
Tests for the snapshot pre-flight + warmed-conid set (Phase 8 / Task 1.3).

IBKR's first /iserver/marketdata/snapshot for a fresh conid returns empty
fields — the call itself is a "pre-flight" that primes IBKR's market-data
cache. We replace the previous "poll until fields populate" loop with the
documented pattern:

  1. If the conid is already in `state.warmed_conids`, call snapshot
     directly (no pre-flight).
  2. Else: call snapshot once, sleep `PREFLIGHT_DELAY_MS`, then call
     snapshot again and return that response. Add the conid to
     `warmed_conids` so future calls skip the pre-flight.

A per-conid asyncio.Lock coalesces concurrent first-time callers so 5
simultaneous snapshots for the same fresh conid only run one pre-flight
(1 pre-flight + 1 real call = 2 IBKR calls total, not 10).

Covers:
  - Cold call to snapshot([123]) issues exactly 2 IBKR calls separated by
    >= PREFLIGHT_DELAY_MS.
  - Subsequent call to snapshot([123]) issues exactly 1 IBKR call (warmed).
  - 5 concurrent first-time callers result in 2 IBKR calls total.
  - state.reset() clears warmed_conids; the next call pre-flights again.
  - Mixed cold + warm batch: cold conids get pre-flighted in parallel,
    real call goes out for the full batch.
"""

import asyncio
import time
from unittest.mock import MagicMock

import pytest

from services.ibkr import IBKRService
from state import IBKRState


# ── Helpers ──────────────────────────────────────────────────────────


def _make_svc(preflight_delay_ms: int = 50):
    """Return an IBKRService whose _request and ensure_accounts are mocked.

    `preflight_delay_ms` overrides PREFLIGHT_DELAY_MS for the test (default
    50ms — fast enough to keep tests under a second, large enough that the
    "≥ delay" assertion isn't fooled by clock jitter).

    Returns (svc, calls) where `calls` is a list of (method, endpoint,
    conids_param) recorded for every _request invocation.
    """
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = IBKRState()
    svc.http = MagicMock()
    svc._tickle_task = None
    svc._ws_task = None

    # ensure_accounts is irrelevant to pre-flight semantics; bypass it.
    async def _noop_accounts():
        return None

    svc.ensure_accounts = _noop_accounts  # type: ignore[method-assign]

    calls: list[tuple[str, str, str]] = []
    call_times: list[float] = []

    async def fake_request(method: str, endpoint: str, **kwargs):
        params = kwargs.get("params") or {}
        calls.append((method, endpoint, params.get("conids", "")))
        call_times.append(time.monotonic())
        # Real-time yield so concurrent callers in coalescing tests
        # actually have a chance to discover the in-flight future in
        # the dict before it's popped. Real httpx calls always take
        # measurable time on the wire; sleep(0) is too brief in some
        # scheduler orderings. 5ms is long enough for all 5 awaiters
        # in test_concurrent_first_time_callers_coalesce_pre_flight
        # to converge on the same future, short enough that the test
        # suite doesn't slow down meaningfully.
        await asyncio.sleep(0.005)
        # Echo back a minimal valid snapshot row per requested conid.
        conids = [int(c) for c in str(params.get("conids", "")).split(",") if c]
        return [{"conid": c, "31": "100.00"} for c in conids]

    svc._request = fake_request  # type: ignore[method-assign]

    # Patch PREFLIGHT_DELAY_MS in the module to keep tests fast.
    import services.ibkr as ibkr_mod
    svc._test_orig_delay = ibkr_mod.PREFLIGHT_DELAY_MS
    ibkr_mod.PREFLIGHT_DELAY_MS = preflight_delay_ms

    return svc, calls, call_times


def _restore_delay(svc):
    import services.ibkr as ibkr_mod
    ibkr_mod.PREFLIGHT_DELAY_MS = svc._test_orig_delay


# ── Tests ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cold_call_issues_pre_flight_then_real_with_delay():
    """First snapshot for a fresh conid: 2 IBKR calls separated by
    >= PREFLIGHT_DELAY_MS (one pre-flight, one real)."""
    svc, calls, call_times = _make_svc(preflight_delay_ms=80)
    try:
        result = await svc.snapshot([123])

        assert len(calls) == 2, f"expected 2 IBKR calls, got {len(calls)}: {calls}"
        # Both calls hit the snapshot endpoint with conid=123
        assert calls[0] == ("GET", "/iserver/marketdata/snapshot", "123")
        assert calls[1] == ("GET", "/iserver/marketdata/snapshot", "123")
        # Spacing >= delay (with a small jitter tolerance)
        delta = call_times[1] - call_times[0]
        assert delta >= 0.075, f"calls spaced {delta:.3f}s, expected >= 0.080s"
        assert 123 in svc.state.warmed_conids
        assert result == [{"conid": 123, "31": "100.00"}]
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_warmed_conid_skips_pre_flight():
    """Second snapshot for the same conid: 1 IBKR call only."""
    svc, calls, _ = _make_svc(preflight_delay_ms=20)
    try:
        await svc.snapshot([123])  # 2 calls
        calls.clear()

        result = await svc.snapshot([123])
        assert len(calls) == 1, f"expected 1 IBKR call (warmed), got {len(calls)}"
        assert calls[0] == ("GET", "/iserver/marketdata/snapshot", "123")
        assert result == [{"conid": 123, "31": "100.00"}]
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_concurrent_first_time_callers_coalesce_pre_flight():
    """5 concurrent snapshot([99]) calls -> 2 IBKR calls total
    (1 pre-flight + 1 real bulk call). All 5 callers receive the same
    response.

    Originally written against Task 1.3 alone — at that point the
    expectation was 6 calls (1 pre-flight + 5 real, since the real
    bulk call wasn't coalesced). Task 1.6 added Layer 2 batch
    coalescing on the real call, so identical-batch concurrent
    callers now collapse to a single IBKR call there too. This test
    was tightened to the post-1.6 expectation.
    """
    svc, calls, _ = _make_svc(preflight_delay_ms=80)
    try:
        results = await asyncio.gather(*(svc.snapshot([99]) for _ in range(5)))

        # 1 pre-flight (per-conid lock) + 1 real bulk call (Task 1.6
        # batch future) = 2 IBKR calls for 5 concurrent identical
        # batches.
        assert len(calls) == 2, (
            f"expected 1 pre-flight + 1 real (post-Task 1.6) = 2 calls; "
            f"got {len(calls)}: {calls}"
        )
        for call in calls:
            assert call[:2] == ("GET", "/iserver/marketdata/snapshot")
            assert call[2] == "99"
        assert 99 in svc.state.warmed_conids
        # All 5 callers get the same response
        assert all(r == [{"conid": 99, "31": "100.00"}] for r in results)
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_state_reset_clears_warmed_conids_and_locks():
    """After state.reset(), the conid is no longer warmed; next call
    pre-flights again."""
    svc, calls, _ = _make_svc(preflight_delay_ms=20)
    try:
        await svc.snapshot([42])
        assert 42 in svc.state.warmed_conids
        assert 42 in svc.state.preflight_locks

        svc.state.reset()
        assert svc.state.warmed_conids == set()
        assert svc.state.preflight_locks == {}

        calls.clear()
        await svc.snapshot([42])
        # Should pre-flight again: 2 calls
        assert len(calls) == 2, (
            f"expected 2 calls after reset (re-pre-flight), got {len(calls)}"
        )
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_mixed_cold_and_warm_batch():
    """A batch with some warmed conids and some cold ones pre-flights only
    the cold ones, then issues one bulk call for the full batch."""
    svc, calls, _ = _make_svc(preflight_delay_ms=20)
    try:
        # Warm 100, 200 first
        await svc.snapshot([100])
        await svc.snapshot([200])
        calls.clear()

        # Now request a mixed batch: 100 (warm) + 200 (warm) + 300 (cold) + 400 (cold)
        result = await svc.snapshot([100, 200, 300, 400])

        # Expected calls:
        #   pre-flights for 300 and 400 (2 cold conids -> 2 pre-flight calls,
        #   issued in parallel via asyncio.gather)
        #   1 real bulk call for "100,200,300,400"
        # Total: 3 calls.
        preflight_calls = [c for c in calls if c[2] in ("300", "400")]
        bulk_calls = [c for c in calls if c[2] == "100,200,300,400"]
        assert len(preflight_calls) == 2, (
            f"expected 2 pre-flight calls (cold conids only), got {len(preflight_calls)}"
        )
        assert len(bulk_calls) == 1, (
            f"expected 1 bulk call for full batch, got {len(bulk_calls)}"
        )
        # And no pre-flight was issued for the already-warm conids
        warmed_preflights = [c for c in calls if c[2] in ("100", "200")]
        assert warmed_preflights == [], (
            f"warm conids must not trigger pre-flight; got {warmed_preflights}"
        )

        # warmed_conids now includes the new ones too
        assert {100, 200, 300, 400}.issubset(svc.state.warmed_conids)

        # All 4 conids in the response
        returned_conids = {row["conid"] for row in result}
        assert returned_conids == {100, 200, 300, 400}
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_preflight_lock_is_per_conid():
    """Two concurrent callers for DIFFERENT cold conids do NOT block each
    other — each runs its own pre-flight in parallel."""
    svc, calls, call_times = _make_svc(preflight_delay_ms=80)
    try:
        # Issue two concurrent first-time snapshots for different conids
        results = await asyncio.gather(
            svc.snapshot([501]),
            svc.snapshot([502]),
        )

        # Each snapshot does pre-flight + real => 2 calls each, 4 total
        assert len(calls) == 4, f"expected 4 calls (2 conids x 2 each), got {len(calls)}"
        # Both pre-flights should have started before either finished —
        # confirm by checking the wall-clock spread is roughly one delay,
        # not two (which would mean serial execution).
        # Total elapsed: max(call_times) - min(call_times) should be in
        # the same neighborhood as PREFLIGHT_DELAY_MS, not 2x.
        spread = max(call_times) - min(call_times)
        assert spread < 0.2, (
            f"pre-flights ran serially: spread {spread:.3f}s "
            f"(parallel would be ~0.080s)"
        )
        assert {501, 502}.issubset(svc.state.warmed_conids)
        assert all(len(r) == 1 for r in results)
    finally:
        _restore_delay(svc)
