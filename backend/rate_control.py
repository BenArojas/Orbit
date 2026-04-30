"""
Per-endpoint rate limiter for IBKR Client Portal API.
Ported from MoonMarket — same battle-tested limiter logic.

Pacing values live in `constants/ibkr_pacing.py` (single source of truth).
This module is the runtime: it instantiates the appropriate limiter per
endpoint kind, caches one limiter instance per matched path, and wraps the
IBKR `_request` method with the `paced` decorator.

  - "per_sec":     aiolimiter.AsyncLimiter — token bucket, callers wait.
  - "concurrent":  asyncio.Semaphore — bounded in-flight count, callers wait.
  - "per_minutes": aiolimiter.AsyncLimiter — but full-bucket raises
                   IBKRRateLimitError(retry_after=interval_sec) so we never
                   block a request handler for 15 minutes.
"""

import asyncio
import logging
from functools import wraps

from aiolimiter import AsyncLimiter

from constants.ibkr_pacing import (
    ENDPOINT_LIMITS,
    GLOBAL_LIMIT_PER_SEC,
    EndpointLimit,
    lookup_limit,
    normalize_path,
)
from exceptions import IBKRRateLimitError

log = logging.getLogger("parallax.rate_control")


# ── Limiter cache ─────────────────────────────────────────────────────
# One limiter (or semaphore) per endpoint key. The dict is keyed by the
# normalized table key (e.g. "/iserver/marketdata/snapshot"), not the raw
# path, so all callers of the same logical endpoint share the limiter.
_LIMITER_CACHE: dict[str, AsyncLimiter | asyncio.Semaphore] = {}

# A dedicated key the global fallback shares — so any path that doesn't
# match a table entry funnels into a single 10/sec bucket.
_GLOBAL_KEY = "__global__"


def _build_limiter(limit: EndpointLimit) -> AsyncLimiter | asyncio.Semaphore:
    """Construct the right limiter primitive for this kind of cap."""
    if limit.kind == "concurrent":
        return asyncio.Semaphore(limit.count)
    # Both "per_sec" and "per_minutes" use a token bucket. The difference is
    # how we behave when the bucket is empty (waited vs. raised) — that
    # branch lives in the decorator, not here.
    return AsyncLimiter(limit.count, limit.interval_sec)


def _global_limiter() -> AsyncLimiter:
    """The 10/sec catch-all for paths that don't match any table entry."""
    cached = _LIMITER_CACHE.get(_GLOBAL_KEY)
    if cached is None:
        cached = AsyncLimiter(GLOBAL_LIMIT_PER_SEC, 1)
        _LIMITER_CACHE[_GLOBAL_KEY] = cached
    return cached  # type: ignore[return-value]


def _resolve(path: str) -> tuple[AsyncLimiter | asyncio.Semaphore, EndpointLimit | None]:
    """Find (or build) the limiter for `path`. Returns the limiter plus the
    table entry it came from (None if we fell through to the global cap)."""
    normalized = normalize_path(path)
    # Walk the table once to find the longest-prefix match AND its key, so
    # the cache is keyed by table key, not by the caller's full path.
    best_key: str | None = None
    for key in ENDPOINT_LIMITS:
        if normalized.startswith(key):
            if best_key is None or len(key) > len(best_key):
                best_key = key

    if best_key is None:
        return _global_limiter(), None

    limit = ENDPOINT_LIMITS[best_key]
    cached = _LIMITER_CACHE.get(best_key)
    if cached is None:
        cached = _build_limiter(limit)
        _LIMITER_CACHE[best_key] = cached
    return cached, limit


def _reset_cache_for_tests() -> None:
    """Drop all cached limiters. Tests use this to get a fresh clock."""
    _LIMITER_CACHE.clear()


# Public alias for tests / introspection. Same shape as the old
# `_get_limiter` helper but always returns just the limiter object.
def _get_limiter(endpoint: str) -> AsyncLimiter | asyncio.Semaphore:
    limiter, _ = _resolve(endpoint)
    return limiter


# Kept as a convenience for callers that want to know the kind of limit
# applied to a path (e.g. for logging or 429 backoff decisions).
def lookup_for_endpoint(endpoint: str) -> EndpointLimit | None:
    return lookup_limit(endpoint)


def paced(endpoint: str):
    """
    Decorator for IBKRService._request — injects rate limiting.

    When `endpoint` is "dynamic", the limiter is resolved at call time from
    the actual endpoint argument. Otherwise the limiter is fixed.
    """
    is_dynamic = endpoint == "dynamic"

    def decorator(fn):
        @wraps(fn)
        async def wrapper(self, method: str, ep: str, **kwargs):
            limiter, limit = _resolve(ep) if is_dynamic else _resolve(endpoint)

            # 15-min / 60-sec limits: fail fast instead of blocking the
            # request handler. The token bucket only carries `count` tokens,
            # so once full, callers would otherwise wait `interval_sec`.
            if (
                limit is not None
                and limit.kind == "per_minutes"
                and isinstance(limiter, AsyncLimiter)
                and not limiter.has_capacity()
            ):
                raise IBKRRateLimitError(
                    endpoint=ep,
                    retry_after=limit.interval_sec,
                )

            async with limiter:
                return await fn(self, method, ep, **kwargs)

        return wrapper
    return decorator
