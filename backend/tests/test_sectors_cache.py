"""
Tests for /sectors/* 60s server-side result cache (Phase 8 / Task 2.3).

SectorService caches the result of each public method
(get_sector_performance, get_rrg_data, get_market_breadth,
get_sector_rotation) in the shared MemoryCache singleton for
SECTORS_CACHE_TTL_SEC seconds.

Three behaviors under test (verified for get_sector_performance as the
representative method; the pattern is identical for all four):

  1. Two calls within TTL → 1 set of IBKR fan-out calls; both callers
     receive the same payload.
  2. A call after TTL expiry → fresh fan-out.
  3. force_refresh=True bypasses the read-cache and overwrites the entry.

All four public methods are smoke-tested to confirm the cache key
constants are wired correctly.
"""

import asyncio
from unittest.mock import MagicMock, patch

import pytest

import config as cfg
from cache import cache as global_cache
from services.sectors import SectorService


# ── Fixtures ─────────────────────────────────────────────────────────


def _make_svc(history_call_tracker: list) -> SectorService:
    """Build a SectorService whose ibkr.history() tracks call counts.

    Returns a SectorService whose underlying IBKR calls are mocked:
      - ibkr.get_conid(sym) → deterministic int based on symbol hash
      - ibkr.history(conid, ...) → minimal valid response, appends conid
        to history_call_tracker so tests can count fan-out calls.
    """
    ibkr = MagicMock()

    # Deterministic conid per symbol so _resolve_conids() populates
    # self._conid_cache with stable ints.
    async def fake_get_conid(symbol: str) -> int:
        return abs(hash(symbol)) % 100_000

    ibkr.get_conid = fake_get_conid

    async def fake_history(conid: int, period: str = "1m", bar: str = "1d") -> dict:
        history_call_tracker.append(conid)
        # Return enough bars for every computation path (breadth needs
        # BREADTH_EMA_PERIOD * 3 bars; performance / rotation only need 2+).
        bars = [
            {"t": 1_000_000 * i, "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.0 + i * 0.1}
            for i in range(1, 200)
        ]
        return {"data": bars}

    ibkr.history = fake_history

    svc = SectorService(ibkr=ibkr)
    return svc


async def _clear_sectors_cache():
    """Wipe sector cache keys between tests (avoids cross-test pollution)."""
    for key in (
        SectorService._CACHE_KEY_PERFORMANCE,
        SectorService._CACHE_KEY_RRG,
        SectorService._CACHE_KEY_BREADTH,
        SectorService._CACHE_KEY_ROTATION,
    ):
        await global_cache.delete(key)


# ── Helpers to temporarily change SECTORS_CACHE_TTL_SEC ──────────────


class _PatchTTL:
    """Context manager: temporarily set cfg.SECTORS_CACHE_TTL_SEC."""

    def __init__(self, ttl: int):
        self._new = ttl
        self._orig = None

    def __enter__(self):
        self._orig = cfg.SECTORS_CACHE_TTL_SEC
        cfg.SECTORS_CACHE_TTL_SEC = self._new
        # Also patch the imported name inside the sectors module.
        import services.sectors as sm
        sm.SECTORS_CACHE_TTL_SEC = self._new
        return self

    def __exit__(self, *_):
        cfg.SECTORS_CACHE_TTL_SEC = self._orig
        import services.sectors as sm
        sm.SECTORS_CACHE_TTL_SEC = self._orig


# ── Core caching behaviour (tested via get_sector_performance) ────────


@pytest.mark.asyncio
async def test_second_call_within_ttl_is_served_from_cache():
    """Two calls within TTL → 1 fan-out to IBKR; both get the same payload."""
    await _clear_sectors_cache()
    calls: list = []
    svc = _make_svc(calls)

    with _PatchTTL(60):
        result1 = await svc.get_sector_performance()
        first_call_count = len(calls)

        result2 = await svc.get_sector_performance()
        second_call_count = len(calls)

    # No new IBKR calls on the second request.
    assert second_call_count == first_call_count, (
        f"second call should be a cache hit (no new IBKR calls); "
        f"calls before={first_call_count}, after={second_call_count}"
    )
    assert result1 == result2, (
        "both callers must receive identical payloads from the cache"
    )


@pytest.mark.asyncio
async def test_call_after_ttl_triggers_fresh_fanout():
    """A call after TTL expiry fires a fresh round of IBKR history calls."""
    await _clear_sectors_cache()
    calls: list = []
    svc = _make_svc(calls)

    # Use a very short TTL so we can expire it without sleeping long.
    with _PatchTTL(1):
        await svc.get_sector_performance()
        first_count = len(calls)

        # Wait for the TTL to lapse.
        await asyncio.sleep(1.1)

        await svc.get_sector_performance()
        second_count = len(calls)

    assert second_count > first_count, (
        f"expected fresh IBKR fan-out after TTL expiry; "
        f"first_count={first_count}, second_count={second_count}"
    )


@pytest.mark.asyncio
async def test_force_refresh_bypasses_and_overwrites_cache():
    """force_refresh=True skips the cache read and updates the entry."""
    await _clear_sectors_cache()
    calls: list = []
    svc = _make_svc(calls)

    with _PatchTTL(60):
        # Populate the cache.
        await svc.get_sector_performance()
        after_first = len(calls)

        # force_refresh must trigger a fresh fan-out even within TTL.
        await svc.get_sector_performance(force_refresh=True)
        after_force = len(calls)

        # After force_refresh the cache entry is updated; a plain call
        # should be a hit (no new IBKR calls).
        await svc.get_sector_performance()
        after_plain = len(calls)

    assert after_force > after_first, (
        "force_refresh=True must bypass the cache and fire fresh IBKR calls"
    )
    assert after_plain == after_force, (
        "plain call after force_refresh must be a cache hit (no new IBKR calls)"
    )


# ── Smoke-test all four public methods ───────────────────────────────
# Verifies each method's cache key is wired correctly: first call populates,
# second call is a hit.


@pytest.mark.asyncio
async def test_rrg_data_caches():
    """get_rrg_data second call within TTL is a cache hit.

    IndicatorService.ema_series is mocked to avoid the pandas_ta
    dependency (requires Python >=3.12, not available in this sandbox).
    The cache behaviour itself is what's under test.
    """
    await _clear_sectors_cache()
    calls: list = []
    svc = _make_svc(calls)

    # ema_series returns a plausible series for the RRG computation.
    def fake_ema(values: list, period: int) -> list:
        return [1.0] * max(0, len(values) - period + 1)

    with _PatchTTL(60), patch("services.sectors.IndicatorService.ema_series", side_effect=fake_ema):
        await svc.get_rrg_data()
        after_first = len(calls)
        await svc.get_rrg_data()

    assert len(calls) == after_first, (
        "second get_rrg_data call must be a cache hit"
    )


@pytest.mark.asyncio
async def test_market_breadth_caches():
    """get_market_breadth second call within TTL is a cache hit.

    IndicatorService.ema_series is mocked to avoid the pandas_ta
    dependency (requires Python >=3.12, not available in this sandbox).
    """
    await _clear_sectors_cache()
    calls: list = []
    svc = _make_svc(calls)

    def fake_ema(values: list, period: int) -> list:
        return [values[-1]] * max(0, len(values) - period + 1)

    with _PatchTTL(60), patch("services.sectors.IndicatorService.ema_series", side_effect=fake_ema):
        await svc.get_market_breadth()
        after_first = len(calls)
        await svc.get_market_breadth()

    assert len(calls) == after_first, (
        "second get_market_breadth call must be a cache hit"
    )


@pytest.mark.asyncio
async def test_sector_rotation_caches():
    await _clear_sectors_cache()
    calls: list = []
    svc = _make_svc(calls)

    with _PatchTTL(60):
        await svc.get_sector_rotation()
        after_first = len(calls)
        await svc.get_sector_rotation()

    assert len(calls) == after_first, (
        "second get_sector_rotation call must be a cache hit"
    )


@pytest.mark.asyncio
async def test_ttl_zero_disables_cache():
    """SECTORS_CACHE_TTL_SEC=0 means every call fans out to IBKR."""
    await _clear_sectors_cache()
    calls: list = []
    svc = _make_svc(calls)

    with _PatchTTL(0):
        await svc.get_sector_performance()
        after_first = len(calls)
        await svc.get_sector_performance()
        after_second = len(calls)

    assert after_second > after_first, (
        "TTL=0 must disable caching; every call should fan out to IBKR"
    )
