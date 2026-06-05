"""
Tests for server-side request coalescing (Phase 8 / Task 1.6).

The coalescing layer sits on top of the existing pre-flight + secdef
machinery and ensures that concurrent callers for the same in-flight
request share a single underlying IBKR call rather than each firing
their own.

Three coalescing dicts on `IBKRService`:

  * `_snapshot_batch_futures`   — keyed by (sorted-conid-tuple, fields).
                                   Coalesces identical batch snapshots.
  * `_snapshot_single_futures`  — keyed by (conid, fields). Coalesces
                                   `get_snapshot()` (singular) calls.
  * `_history_futures`          — keyed by (conid, period, bar).
                                   Coalesces `history()` calls on
                                   cache miss.

Failure semantics: an exception during the in-flight call propagates to
EVERY awaiter, then the future is cleared so a subsequent caller
retries fresh (no stale failure pinning).
"""

import asyncio
import time
from unittest.mock import MagicMock

import pytest

from cache import cache as global_cache
from services.ibkr import IBKRService
from state import IBKRState


# ── Shared fixtures ──────────────────────────────────────────────────


def _make_svc(
    preflight_delay_ms: int = 20,
    snapshot_response_delay: float = 0.0,
    history_response_delay: float = 0.0,
):
    """Return an IBKRService with `_request` mocked.

    `snapshot_response_delay` / `history_response_delay` add an
    `asyncio.sleep` inside the mocked _request so we can be sure
    multiple concurrent callers actually overlap (pin the future
    in the dict long enough for awaiters to discover it).

    Returns (svc, calls, raise_exc) where:
      - `calls` is a list of (method, endpoint, params) tuples.
      - `raise_exc` is a list with one optional Exception — when set,
        the next _request call raises it (consumed once). Used for
        failure-propagation tests.
    """
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = IBKRState()
    svc.http = MagicMock()
    svc._tickle_task = None
    svc._ws_task = None

    async def _noop_accounts():
        return None

    svc.ensure_accounts = _noop_accounts  # type: ignore[method-assign]

    calls: list[tuple[str, str, dict]] = []
    raise_exc: list[Exception | None] = [None]

    async def fake_request(method: str, endpoint: str, **kwargs):
        params = kwargs.get("params") or {}
        calls.append((method, endpoint, dict(params)))

        # ALWAYS yield before doing anything else — so concurrent
        # callers that arrive while we're "in flight" actually have
        # a chance to see this caller's future in the coalescing
        # dict. Without this, a synchronous raise / return wouldn't
        # yield and other callers would each fire their own request.
        delay = (
            history_response_delay if "history" in endpoint
            else snapshot_response_delay
        )
        # Small floor (1ms) so failure-injection paths still yield.
        await asyncio.sleep(max(delay, 0.001))

        # Failure injection (consumed once) — happens AFTER the yield
        # so coalesced awaiters have already joined the future.
        if raise_exc[0] is not None:
            exc = raise_exc[0]
            raise_exc[0] = None
            raise exc

        # Branch by endpoint to return the right shape.
        if "history" in endpoint:
            return {
                "symbol": "TEST",
                "data": [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}],
            }

        # Snapshot endpoint: return one row per requested conid.
        conids = [
            int(c) for c in str(params.get("conids", "")).split(",") if c
        ]
        return [{"conid": c, "31": "100.00"} for c in conids]

    svc._request = fake_request  # type: ignore[method-assign]

    # Patch the module-level pre-flight delay so tests stay fast.
    import services.ibkr as ibkr_mod
    svc._test_orig_delay = ibkr_mod.PREFLIGHT_DELAY_MS
    ibkr_mod.PREFLIGHT_DELAY_MS = preflight_delay_ms

    return svc, calls, raise_exc


def _restore_delay(svc):
    import services.ibkr as ibkr_mod
    ibkr_mod.PREFLIGHT_DELAY_MS = svc._test_orig_delay


# ── Layer 2: snapshot batch coalescing ───────────────────────────────


@pytest.mark.asyncio
async def test_concurrent_identical_batches_coalesce_to_one_real_call():
    """10 concurrent `snapshot([99], fields)` -> 1 pre-flight + 1 real
    call total (= 2 IBKR calls), all 10 callers receive the same list."""
    svc, calls, _ = _make_svc(
        preflight_delay_ms=20,
        snapshot_response_delay=0.05,  # keep the future pinned
    )
    try:
        results = await asyncio.gather(
            *(svc.snapshot([99]) for _ in range(10))
        )

        # 1 pre-flight + 1 real = 2.
        assert len(calls) == 2, (
            f"expected 2 IBKR calls (1 pre-flight + 1 real), got "
            f"{len(calls)}: {calls}"
        )
        # Every caller got the same response.
        first = results[0]
        assert all(r == first for r in results), (
            "coalesced callers received divergent responses"
        )
        # And the response actually contains conid 99.
        assert results[0] == [{"conid": 99, "31": "100.00"}]
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_batch_future_cleared_after_resolve():
    """After a coalesced batch future resolves, a subsequent identical
    batch call issues a NEW real IBKR call — the future was popped
    from the dict so we don't pin a stale value."""
    svc, calls, _ = _make_svc(preflight_delay_ms=10)
    try:
        # First call: pre-flight + real = 2 calls. Future cleared in finally.
        await svc.snapshot([77])
        assert len(calls) == 2

        # Second call: warm conid (no pre-flight) + real = 1 call. The
        # critical assertion is that the real call DID fire — meaning
        # the previous future wasn't pinned in the dict.
        calls.clear()
        await svc.snapshot([77])
        assert len(calls) == 1, (
            f"expected 1 fresh real call after coalesced future cleared; "
            f"got {len(calls)}: {calls}"
        )
        # And the futures dict is empty (no leak).
        assert svc._snapshot_batch_futures == {}
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_failed_batch_propagates_to_all_awaiters_and_clears():
    """When the in-flight IBKR call raises, every coalesced awaiter
    gets the same exception, and the future is cleared so the next
    call retries fresh (no permanent failure pinning)."""
    from exceptions import IBKRRequestError

    svc, calls, raise_exc = _make_svc(
        preflight_delay_ms=5,
        snapshot_response_delay=0.05,
    )
    try:
        # First we need to get past the pre-flight stage so the
        # injected failure happens on the REAL bulk call. Warm 88.
        await svc.snapshot([88])
        assert 88 in svc.state.warmed_conids
        calls.clear()

        # Inject a failure for the next real call.
        raise_exc[0] = IBKRRequestError(status_code=500, detail="boom")

        # Fire 5 concurrent calls — all should see the same exception.
        async def _attempt():
            try:
                return await svc.snapshot([88])
            except IBKRRequestError as exc:
                return exc

        outcomes = await asyncio.gather(*(_attempt() for _ in range(5)))

        # All 5 received an IBKRRequestError (same root cause).
        assert all(isinstance(o, IBKRRequestError) for o in outcomes), (
            f"expected every awaiter to receive IBKRRequestError; got "
            f"{[type(o).__name__ for o in outcomes]}"
        )
        # And only ONE real IBKR call was actually attempted (the others
        # awaited the shared future and got its exception).
        assert len(calls) == 1, (
            f"expected 1 IBKR call (others coalesced into the failing "
            f"future), got {len(calls)}: {calls}"
        )

        # Future was cleared — a fresh call issues a new request.
        assert svc._snapshot_batch_futures == {}
        await svc.snapshot([88])  # success this time (no injected exc)
        assert len(calls) == 2, (
            "expected the post-failure retry to fire a fresh IBKR call"
        )
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_different_batch_keys_do_not_coalesce():
    """Concurrent batches with DIFFERENT conid sets each fire their own
    real call — coalescing keys on (sorted conids, fields)."""
    svc, calls, _ = _make_svc(
        preflight_delay_ms=10,
        snapshot_response_delay=0.05,
    )
    try:
        # Warm both conids first so we isolate the real-call layer.
        await svc.snapshot([1])
        await svc.snapshot([2])
        calls.clear()

        # Now fire concurrent calls for [1] and [2] — different batch
        # keys, must NOT coalesce.
        await asyncio.gather(svc.snapshot([1]), svc.snapshot([2]))
        assert len(calls) == 2, (
            f"different batch keys must not coalesce; got {len(calls)}"
        )
        seen_conids = {c[2]["conids"] for c in calls}
        assert seen_conids == {"1", "2"}
    finally:
        _restore_delay(svc)


# ── Layer 1: get_snapshot (singular) coalescing ──────────────────────


@pytest.mark.asyncio
async def test_get_snapshot_coalesces_concurrent_callers():
    """10 concurrent `get_snapshot(99)` -> 1 pre-flight + 1 real bulk
    call total (= 2 IBKR calls). Layer 1 collapses 10 callers into a
    single underlying snapshot([99], fields) which Layer 2 then
    handles."""
    svc, calls, _ = _make_svc(
        preflight_delay_ms=20,
        snapshot_response_delay=0.05,
    )
    try:
        results = await asyncio.gather(
            *(svc.get_snapshot(99) for _ in range(10))
        )

        # 2 IBKR calls = 1 pre-flight + 1 real.
        assert len(calls) == 2, (
            f"expected 2 IBKR calls, got {len(calls)}: {calls}"
        )
        # Every caller got the same row back, NOT the bulk list.
        first = results[0]
        assert all(r == first for r in results)
        # And the row matches conid 99.
        assert results[0] == {"conid": 99, "31": "100.00"}
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_get_snapshot_returns_none_when_conid_missing_from_response():
    """If IBKR returns rows that don't include the requested conid, the
    singular wrapper returns None rather than the wrong row."""
    svc, _, _ = _make_svc(preflight_delay_ms=5)
    try:
        # Override _request to return a row for a DIFFERENT conid than
        # was asked for — simulates IBKR dropping the row entirely.
        async def _request_other_conid(method, endpoint, **kwargs):
            params = kwargs.get("params") or {}
            return [{"conid": 999, "31": "1.00"}]  # never the asked conid

        svc._request = _request_other_conid  # type: ignore[method-assign]
        result = await svc.get_snapshot(42)
        assert result is None, (
            f"expected None when IBKR omits the requested conid; got {result}"
        )
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_get_snapshot_failure_propagates_to_all_awaiters():
    """A failure inside the singular coalescing layer (or anywhere
    below) propagates to every awaiter, then clears the dict."""
    from exceptions import IBKRRequestError

    svc, calls, raise_exc = _make_svc(
        preflight_delay_ms=5,
        snapshot_response_delay=0.05,
    )
    try:
        # Warm conid first so the failure lands on the real call,
        # not on a pre-flight (pre-flight failures bubble through
        # asyncio.gather differently).
        await svc.get_snapshot(55)
        calls.clear()

        raise_exc[0] = IBKRRequestError(status_code=502, detail="bad gateway")

        async def _attempt():
            try:
                return await svc.get_snapshot(55)
            except IBKRRequestError as exc:
                return exc

        outcomes = await asyncio.gather(*(_attempt() for _ in range(5)))
        assert all(isinstance(o, IBKRRequestError) for o in outcomes)
        # And the singular dict was cleaned up.
        assert svc._snapshot_single_futures == {}
    finally:
        _restore_delay(svc)


# ── History coalescing (inline inside `history()`) ───────────────────


def _clear_history_cache():
    """Clear the global @cached(ttl=300) decorator's store between tests
    so a fresh call hits the cache miss path and exercises coalescing.

    The cache is a process-level singleton so tests that run after
    something populated it would otherwise short-circuit before the
    coalescing layer runs.
    """
    # Reach into the singleton synchronously — safe because we only
    # mutate the underlying dict (not the asyncio.Lock state).
    global_cache._store.clear()


@pytest.mark.asyncio
async def test_concurrent_history_calls_coalesce_to_one_ibkr_call():
    """5 concurrent `history(conid, period, bar)` calls on a cold cache
    -> 1 IBKR /iserver/marketdata/history call. The other 4 awaiters
    receive the same response."""
    _clear_history_cache()

    svc, calls, _ = _make_svc(history_response_delay=0.05)
    try:
        results = await asyncio.gather(
            *(svc.history(7777, period="5d", bar="5min") for _ in range(5))
        )

        assert len(calls) == 1, (
            f"expected 1 IBKR history call (4 coalesced), got {len(calls)}: "
            f"{calls}"
        )
        assert all(r == results[0] for r in results)
        assert calls[0][1] == "/iserver/marketdata/history"
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_history_future_cleared_after_resolve():
    """After resolving, the history future is popped from the dict so a
    fresh call (after cache also cleared) issues a new IBKR call."""
    _clear_history_cache()

    svc, calls, _ = _make_svc()
    try:
        await svc.history(8888, period="1m", bar="30min")
        assert len(calls) == 1
        assert svc._history_futures == {}, (
            "history futures dict should be empty after resolve"
        )

        _clear_history_cache()  # bypass the @cached decorator
        await svc.history(8888, period="1m", bar="30min")
        assert len(calls) == 2, (
            "fresh history call (after cache cleared) must issue a new "
            "IBKR call — the previous future must NOT be pinned"
        )
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_history_failure_propagates_and_clears():
    """When the IBKR history call raises, every coalesced awaiter gets
    the same exception and the future is cleared (no failure pinning)."""
    from exceptions import IBKRRequestError

    _clear_history_cache()

    svc, calls, raise_exc = _make_svc(history_response_delay=0.05)
    try:
        raise_exc[0] = IBKRRequestError(status_code=503, detail="service unavailable")

        async def _attempt():
            try:
                return await svc.history(9999, period="5d", bar="5min")
            except IBKRRequestError as exc:
                return exc

        outcomes = await asyncio.gather(*(_attempt() for _ in range(5)))
        assert all(isinstance(o, IBKRRequestError) for o in outcomes)
        # Only one IBKR call (others coalesced into the failing future).
        assert len(calls) == 1
        # Future cleared — next call retries fresh.
        assert svc._history_futures == {}

        _clear_history_cache()
        result = await svc.history(9999, period="5d", bar="5min")
        assert result is not None
        assert len(calls) == 2, "post-failure retry must fire a fresh IBKR call"
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_different_history_keys_do_not_coalesce():
    """history() calls with different (conid, period, bar) keys do NOT
    share a future."""
    _clear_history_cache()

    svc, calls, _ = _make_svc(history_response_delay=0.05)
    try:
        await asyncio.gather(
            svc.history(1111, period="5d", bar="5min"),
            svc.history(1111, period="1m", bar="30min"),  # different period/bar
            svc.history(2222, period="5d", bar="5min"),  # different conid
        )
        assert len(calls) == 3, (
            f"3 distinct (conid, period, bar) keys must each fire; got "
            f"{len(calls)}: {calls}"
        )
    finally:
        _restore_delay(svc)
