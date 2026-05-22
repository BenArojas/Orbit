"""
Client-disconnect cancellation for expensive request handlers.

Starlette does not cancel a route handler when the client goes away — the
handler runs to completion even though nobody is listening. For cheap routes
that's harmless, but for handlers that fan out many IBKR history calls (the
sector RRG / performance routes) it means a user who navigates away mid-load
leaves ~40 history requests hogging the shared 4-slot history semaphore,
which then queues the next page's chart request behind them.

`run_cancelling_on_disconnect` races the work against a disconnect poller and
cancels the work if the client leaves first. Cancellation propagates into the
in-flight `ibkr.history()` awaits, releasing the semaphore immediately.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Awaitable, TypeVar

from fastapi import Request

log = logging.getLogger("parallax.request_cancellation")

T = TypeVar("T")


class ClientDisconnected(Exception):
    """Raised when the client disconnects before the handler finishes."""


async def _poll_disconnect(request: Request, interval: float = 0.25) -> None:
    while True:
        if await request.is_disconnected():
            return
        await asyncio.sleep(interval)


async def run_cancelling_on_disconnect(
    request: Request,
    coro: Awaitable[T],
    *,
    label: str = "request",
) -> T:
    """
    Run `coro`, but cancel it if the client disconnects first.

    Returns the coroutine's result on normal completion. Raises
    `ClientDisconnected` if the client went away — the caller can translate
    that into a discarded response (the client isn't listening anyway); the
    point is that cancelling the work frees shared resources.
    """
    work: asyncio.Task[T] = asyncio.ensure_future(coro)
    watcher = asyncio.ensure_future(_poll_disconnect(request))

    try:
        done, _pending = await asyncio.wait(
            {work, watcher}, return_when=asyncio.FIRST_COMPLETED
        )
    except asyncio.CancelledError:
        work.cancel()
        watcher.cancel()
        raise

    if work in done:
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watcher
        return work.result()

    # Client disconnected first — cancel the work and let cancellation
    # propagate into the IBKR fetches so the semaphore is freed.
    log.info("client disconnected — cancelling %s work", label)
    work.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await work
    raise ClientDisconnected()
