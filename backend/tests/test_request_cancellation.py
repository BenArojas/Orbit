"""Tests for run_cancelling_on_disconnect — the client-disconnect guard."""

import asyncio

import pytest

from request_cancellation import ClientDisconnected, run_cancelling_on_disconnect


class FakeRequest:
    """Minimal Request stand-in with a controllable is_disconnected()."""

    def __init__(self, disconnected_after: float | None = None):
        self._disconnected_after = disconnected_after
        self._start = None

    async def is_disconnected(self) -> bool:
        if self._disconnected_after is None:
            return False
        loop = asyncio.get_event_loop()
        if self._start is None:
            self._start = loop.time()
        return (loop.time() - self._start) >= self._disconnected_after


@pytest.mark.asyncio
async def test_returns_result_when_client_stays_connected():
    req = FakeRequest(disconnected_after=None)

    async def work():
        await asyncio.sleep(0.01)
        return 42

    result = await run_cancelling_on_disconnect(req, work())
    assert result == 42


@pytest.mark.asyncio
async def test_cancels_work_and_raises_when_client_disconnects():
    # Client is already gone; the long work must be cancelled, not awaited.
    req = FakeRequest(disconnected_after=0.0)
    cancelled = asyncio.Event()

    async def long_work():
        try:
            await asyncio.sleep(10)  # never completes within the test
        except asyncio.CancelledError:
            cancelled.set()
            raise

    with pytest.raises(ClientDisconnected):
        await run_cancelling_on_disconnect(req, long_work())

    assert cancelled.is_set(), "work should have been cancelled on disconnect"


@pytest.mark.asyncio
async def test_releases_semaphore_when_cancelled():
    # Proves cancellation propagates through an `async with semaphore`,
    # mirroring how ibkr.history() holds the shared history semaphore.
    sem = asyncio.Semaphore(1)
    req = FakeRequest(disconnected_after=0.0)

    async def work():
        async with sem:
            await asyncio.sleep(10)

    with pytest.raises(ClientDisconnected):
        await run_cancelling_on_disconnect(req, work())

    # If the semaphore had leaked, this acquire would block forever.
    await asyncio.wait_for(sem.acquire(), timeout=0.5)
    assert sem.locked()
