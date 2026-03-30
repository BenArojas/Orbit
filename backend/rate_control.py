"""
Per-endpoint rate limiter for IBKR Client Portal API.
Ported from MoonMarket — same battle-tested limiter logic.

Uses aiolimiter for async-safe token bucket rate limiting.
Each IBKR endpoint pattern gets its own limiter to respect
their undocumented but real rate limits.
"""

import asyncio
import logging
import re
from functools import wraps

from aiolimiter import AsyncLimiter

from exceptions import IBKRRateLimitError

log = logging.getLogger("parallax.rate_control")


# ── Limiter Definitions ──────────────────────────────────────
# These match IBKR's observed rate limits from MoonMarket production usage.

GLOBAL = AsyncLimiter(10, 1)           # 10 requests per second (default)
ONE_PER_SEC = AsyncLimiter(1, 1)       # 1 request per second
ONE_PER_5SEC = AsyncLimiter(1, 5)      # 1 request per 5 seconds
ONE_PER_15MIN = AsyncLimiter(1, 900)   # 1 request per 15 minutes
FIVE_CONCUR = AsyncLimiter(5, 1)       # 5 concurrent (history endpoint)

# Map endpoint regex patterns to their limiter
ENDPOINT_LIMITERS: list[tuple[re.Pattern, AsyncLimiter]] = [
    (re.compile(r"/iserver/marketdata/snapshot"), GLOBAL),
    (re.compile(r"/iserver/marketdata/history"), FIVE_CONCUR),
    (re.compile(r"/iserver/account/(orders|pnl|trades)"), ONE_PER_5SEC),
    (re.compile(r"/portfolio/(accounts|subaccounts)"), ONE_PER_5SEC),
    (re.compile(r"/pa/(performance|summary|transactions)"), ONE_PER_15MIN),
    (re.compile(r"/iserver/scanner/params"), ONE_PER_15MIN),
    (re.compile(r"/fyi/"), ONE_PER_SEC),
    (re.compile(r"/tickle$"), ONE_PER_SEC),
]


def _get_limiter(endpoint: str) -> AsyncLimiter:
    """Find the matching limiter for an endpoint, or fall back to GLOBAL."""
    for pattern, limiter in ENDPOINT_LIMITERS:
        if pattern.search(endpoint):
            return limiter
    return GLOBAL


def paced(endpoint: str):
    """
    Decorator for IBKRService._request — injects rate limiting.

    When endpoint is "dynamic", the limiter is resolved at call time
    from the actual endpoint argument. Otherwise uses a fixed limiter.
    """
    is_dynamic = endpoint == "dynamic"

    def decorator(fn):
        @wraps(fn)
        async def wrapper(self, method: str, ep: str, **kwargs):
            limiter = _get_limiter(ep) if is_dynamic else _get_limiter(endpoint)

            # For 15-minute limits, don't block — fail fast
            if not limiter.has_capacity and limiter is ONE_PER_15MIN:
                raise IBKRRateLimitError(
                    endpoint=ep,
                    retry_after=900,
                )

            async with limiter:
                return await fn(self, method, ep, **kwargs)

        return wrapper
    return decorator
