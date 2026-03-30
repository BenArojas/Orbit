"""
In-memory TTL cache for Parallax.
Replaces MoonMarket's Redis-backed cache with a simple dict + asyncio.

No external dependencies. Data lives in memory and dies with the process.
That's perfect for Parallax — we're a local desktop app, not a server.

Usage:
    from cache import cached

    @cached(ttl=60)
    async def get_quote(self, conid: int) -> dict:
        return await self._request("GET", f"/md/snapshot?conids={conid}")
"""

import asyncio
import logging
import time
from functools import wraps
from typing import Any, Awaitable, Callable

log = logging.getLogger("parallax.cache")


class MemoryCache:
    """
    Simple async-safe in-memory cache with TTL expiration.
    Keys are strings, values are any serializable Python object.
    """

    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}  # key -> (value, expires_at)
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Any | None:
        """Get a value if it exists and hasn't expired."""
        async with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.monotonic() > expires_at:
                del self._store[key]
                return None
            return value

    async def set(self, key: str, value: Any, ttl: int) -> None:
        """Set a value with a TTL in seconds."""
        async with self._lock:
            self._store[key] = (value, time.monotonic() + ttl)

    async def delete(self, key: str) -> None:
        """Remove a specific key."""
        async with self._lock:
            self._store.pop(key, None)

    async def clear(self) -> None:
        """Clear the entire cache."""
        async with self._lock:
            self._store.clear()

    async def cleanup_expired(self) -> int:
        """Remove all expired entries. Returns count of removed items."""
        async with self._lock:
            now = time.monotonic()
            expired = [k for k, (_, exp) in self._store.items() if now > exp]
            for k in expired:
                del self._store[k]
            return len(expired)

    @property
    def size(self) -> int:
        """Current number of entries (including possibly expired ones)."""
        return len(self._store)


# Global singleton cache instance
cache = MemoryCache()


def _default_key_builder(fn_name: str, args: tuple, kwargs: dict) -> str:
    """
    Build a cache key from function name + arguments.
    Skips 'self' (args[0]) since it's always the service instance.
    """
    key_parts = [fn_name]
    # Skip self (args[0])
    for arg in args[1:]:
        key_parts.append(str(arg))
    for k, v in sorted(kwargs.items()):
        key_parts.append(f"{k}={v}")
    return ":".join(key_parts)


def cached(
    ttl: int,
    key_builder: Callable[..., str] | None = None,
):
    """
    Decorator to cache async function results for `ttl` seconds.

    Args:
        ttl: Time to live in seconds.
        key_builder: Optional custom function to generate cache keys.
                     Receives (*args, **kwargs) and returns a string key.
                     If None, uses default key builder.

    Example:
        @cached(ttl=30)
        async def get_snapshot(self, conids: list[int], fields: str) -> dict:
            ...
    """
    def decorator(fn: Callable[..., Awaitable]):
        @wraps(fn)
        async def wrapper(*args, **kwargs):
            # Build cache key
            if key_builder:
                key = key_builder(*args, **kwargs)
            else:
                key = _default_key_builder(fn.__name__, args, kwargs)

            # Try cache first
            cached_val = await cache.get(key)
            if cached_val is not None:
                log.debug("Cache hit: %s", key)
                return cached_val

            # Cache miss — call the real function
            log.debug("Cache miss: %s", key)
            result = await fn(*args, **kwargs)

            # Store result
            await cache.set(key, result, ttl=ttl)
            return result

        return wrapper
    return decorator
