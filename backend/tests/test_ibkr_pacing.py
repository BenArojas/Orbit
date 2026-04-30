"""
Tests for the IBKR pacing-table module + rate_control runtime wiring.

These tests verify that:
  - `ENDPOINT_LIMITS` resolves the right limiter kind per endpoint.
  - The global 10/sec cap admits 10 calls in <1s and makes the 11th wait.
  - The 5-concurrent cap on /iserver/marketdata/history is enforced via
    asyncio.Semaphore (not a per-second token bucket).
  - The 1-per-60s cap on /sso/validate is honored: 2nd call waits until
    the bucket has refilled (verified by monkey-patching the loop clock).
  - Path normalization strips query strings and the longest-prefix table
    entry wins.

We do not exercise the IBKRService HTTP path here — that has its own tests
elsewhere. These tests stay at the rate_control / constants layer.
"""

import asyncio
import time

import pytest

from constants.ibkr_pacing import (
    ENDPOINT_LIMITS,
    GLOBAL_LIMIT_PER_SEC,
    EndpointLimit,
    lookup_limit,
    normalize_path,
)
from exceptions import IBKRRateLimitError
import rate_control
from rate_control import _get_limiter, _resolve, paced


@pytest.fixture(autouse=True)
def _reset_limiter_cache():
    """Each test gets a fresh limiter cache so timing carries no state."""
    rate_control._reset_cache_for_tests()
    yield
    rate_control._reset_cache_for_tests()


# ── Pacing table shape ────────────────────────────────────────────────


def test_pacing_table_is_complete():
    """Every row of the IBKR Pacing-Limitations table is represented."""
    assert GLOBAL_LIMIT_PER_SEC == 10
    assert ENDPOINT_LIMITS["/iserver/marketdata/snapshot"] == EndpointLimit("per_sec", 10, 1)
    assert ENDPOINT_LIMITS["/iserver/marketdata/history"] == EndpointLimit("concurrent", 5, 0)
    assert ENDPOINT_LIMITS["/iserver/account/orders"] == EndpointLimit("per_sec", 1, 5)
    assert ENDPOINT_LIMITS["/iserver/account/pnl/partitioned"] == EndpointLimit("per_sec", 1, 5)
    assert ENDPOINT_LIMITS["/iserver/account/trades"] == EndpointLimit("per_sec", 1, 5)
    assert ENDPOINT_LIMITS["/portfolio/accounts"] == EndpointLimit("per_sec", 1, 5)
    assert ENDPOINT_LIMITS["/portfolio/subaccounts"] == EndpointLimit("per_sec", 1, 5)
    assert ENDPOINT_LIMITS["/sso/validate"] == EndpointLimit("per_sec", 1, 60)
    assert ENDPOINT_LIMITS["/tickle"] == EndpointLimit("per_sec", 1, 1)
    assert ENDPOINT_LIMITS["/iserver/scanner/run"] == EndpointLimit("per_sec", 1, 1)
    assert ENDPOINT_LIMITS["/iserver/scanner/params"] == EndpointLimit("per_minutes", 1, 900)
    assert ENDPOINT_LIMITS["/pa/performance"] == EndpointLimit("per_minutes", 1, 900)
    assert ENDPOINT_LIMITS["/pa/summary"] == EndpointLimit("per_minutes", 1, 900)
    assert ENDPOINT_LIMITS["/pa/transactions"] == EndpointLimit("per_minutes", 1, 900)
    assert ENDPOINT_LIMITS["/fyi/"] == EndpointLimit("per_sec", 1, 1)


# ── Path normalization + longest-prefix matching ──────────────────────


def test_normalize_strips_query_and_trailing_slash():
    assert normalize_path("/iserver/marketdata/snapshot?conids=1,2,3") == \
        "/iserver/marketdata/snapshot"
    assert normalize_path("/iserver/account/orders/") == "/iserver/account/orders"
    assert normalize_path("/iserver/account/orders") == "/iserver/account/orders"
    assert normalize_path("/iserver/account/orders?force=1") == "/iserver/account/orders"
    # Root path stays as "/"
    assert normalize_path("/") == "/"


def test_lookup_uses_longest_prefix():
    """`/iserver/account/pnl/partitioned` must match the specific entry,
    not the shorter `/iserver/account/orders` / `.../trades` siblings."""
    pnl = lookup_limit("/iserver/account/pnl/partitioned")
    assert pnl is not None
    assert pnl == EndpointLimit("per_sec", 1, 5)

    # Snapshot path with a query string still matches the snapshot entry
    snap = lookup_limit("/iserver/marketdata/snapshot?conids=1,2,3")
    assert snap is not None
    assert snap.kind == "per_sec"
    assert snap.count == 10

    # Unmapped path → None (caller falls through to global cap)
    assert lookup_limit("/iserver/marketdata/regsnapshot") is None


# ── Limiter runtime behavior ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_snapshot_limiter_admits_10_then_waits():
    """`/iserver/marketdata/snapshot` admits exactly 10 acquires inside
    a single second; the 11th must wait for the bucket to refill."""
    limiter, limit = _resolve("/iserver/marketdata/snapshot")
    assert limit is not None and limit.kind == "per_sec" and limit.count == 10

    start = time.monotonic()
    for _ in range(10):
        async with limiter:
            pass
    fast_elapsed = time.monotonic() - start
    assert fast_elapsed < 0.5, f"first 10 acquires took {fast_elapsed:.3f}s"

    # 11th must wait for the bucket to drip back. Token bucket refills at
    # 10/sec → ~100ms per token, so we should see ≥50ms wait.
    waited_start = time.monotonic()
    async with limiter:
        pass
    waited = time.monotonic() - waited_start
    assert waited >= 0.05, f"11th acquire returned in {waited:.3f}s (expected wait)"


@pytest.mark.asyncio
async def test_history_limiter_is_5_concurrent_semaphore():
    """`/iserver/marketdata/history` uses asyncio.Semaphore — at most 5
    in flight, the 6th waits until one returns."""
    limiter, limit = _resolve("/iserver/marketdata/history")
    assert isinstance(limiter, asyncio.Semaphore)
    assert limit is not None and limit.kind == "concurrent" and limit.count == 5

    in_flight = 0
    peak = 0
    sixth_finished = asyncio.Event()
    release = asyncio.Event()

    async def holder():
        nonlocal in_flight, peak
        async with limiter:
            in_flight += 1
            peak = max(peak, in_flight)
            await release.wait()
            in_flight -= 1

    async def sixth():
        nonlocal in_flight, peak
        async with limiter:
            in_flight += 1
            peak = max(peak, in_flight)
            in_flight -= 1
        sixth_finished.set()

    # 5 holders all block on `release`, fully occupying the semaphore
    holders = [asyncio.create_task(holder()) for _ in range(5)]
    await asyncio.sleep(0.05)
    assert in_flight == 5, f"expected 5 holders in flight, got {in_flight}"

    sixth_task = asyncio.create_task(sixth())
    await asyncio.sleep(0.05)
    assert not sixth_finished.is_set(), "6th acquire returned while semaphore was full"
    assert peak == 5, f"peak in-flight was {peak} (expected exactly 5)"

    # Release the holders; the 6th should now acquire and complete
    release.set()
    await asyncio.wait_for(sixth_finished.wait(), timeout=1.0)
    await asyncio.gather(*holders, sixth_task)
    assert peak == 5, f"peak in-flight was {peak} after release (expected 5)"


@pytest.mark.asyncio
async def test_sso_validate_limiter_waits_until_60s_elapsed(monkeypatch):
    """`/sso/validate` is 1 per 60s. After the first acquire the bucket is
    empty (a 2nd acquire would block); only after 60s of (faked) loop time
    elapse does the bucket refill. We patch the limiter's loop clock to
    advance time without actually waiting a minute."""
    limiter, limit = _resolve("/sso/validate")
    assert limit is not None and limit.kind == "per_sec" and limit.interval_sec == 60

    loop = asyncio.get_running_loop()
    base = loop.time()
    fake_now = base

    def fake_time():
        return fake_now

    # AsyncLimiter caches the loop reference inside the instance — replace
    # only the .time method, leaving call_at etc. on the real loop.
    monkeypatch.setattr(limiter._loop, "time", fake_time)

    # First acquire returns immediately and drains the bucket
    async with limiter:
        pass

    # Bucket is empty: a second acquire would block. Confirm via the
    # public has_capacity() probe (this is what `acquire()` checks before
    # parking the caller in the waiter heap).
    assert not limiter.has_capacity(), \
        "bucket reported capacity right after a single 1-per-60s acquire"

    # Advance the loop's clock by less than 60s — bucket still empty
    fake_now = base + 30.0
    assert not limiter.has_capacity(), \
        "bucket refilled before 60s elapsed (advanced 30s)"

    # Advance past 60s — bucket refills
    fake_now = base + 61.0
    assert limiter.has_capacity(), \
        "bucket did not refill after 61s of (faked) elapsed time"

    # And the next acquire returns immediately under the advanced clock
    await asyncio.wait_for(limiter.acquire(), timeout=1.0)


# ── Decorator integration ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_paced_decorator_dispatches_by_path():
    """`paced("dynamic")` resolves the limiter from the actual endpoint
    argument at call time. Different endpoints get different limiters."""
    snap_limiter = _get_limiter("/iserver/marketdata/snapshot")
    hist_limiter = _get_limiter("/iserver/marketdata/history")
    assert snap_limiter is not hist_limiter
    # Cache hit: second resolution returns the same instance
    assert _get_limiter("/iserver/marketdata/snapshot") is snap_limiter
    assert _get_limiter("/iserver/marketdata/history") is hist_limiter


@pytest.mark.asyncio
async def test_paced_decorator_fails_fast_on_per_minutes_full():
    """A per_minutes limit (1 / 15 min) raises IBKRRateLimitError on the
    second call instead of blocking — a 15-min wait inside a handler is
    user-hostile, so the decorator surfaces the limit upward."""
    class _Service:
        @paced("dynamic")
        async def call(self, method: str, ep: str) -> str:
            return "ok"

    svc = _Service()
    # First call goes through
    result = await svc.call("GET", "/iserver/scanner/params")
    assert result == "ok"

    # Second call within the same 15-min window must raise fast
    with pytest.raises(IBKRRateLimitError) as exc:
        await svc.call("GET", "/iserver/scanner/params")
    assert exc.value.endpoint == "/iserver/scanner/params"
    assert exc.value.retry_after == 900


@pytest.mark.asyncio
async def test_paced_decorator_unmapped_path_uses_global_cap():
    """An endpoint with no table entry falls through to the 10/sec global
    cap, not to a per-endpoint limit."""
    limiter, limit = _resolve("/some/unmapped/path")
    assert limit is None  # fell through
    # Same global limiter is shared by every unmapped path
    other, _ = _resolve("/another/unmapped/path")
    assert limiter is other
