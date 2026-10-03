import asyncio
import datetime as dt
from unittest.mock import AsyncMock

import pytest
import exchange_calendars as xcals
from zoneinfo import ZoneInfo

from constants import SECTOR_ETFS
from cache import cache
from services.market_assessment import ALL_SYMBOLS, INDEX_SYMBOLS, MarketAssessmentService
from services.ibkr import IBKRService
import services.ibkr as ibkr_module


class _AssessmentIbkr:
    def __init__(self, sessions: list[dt.date], above: set[str]) -> None:
        self.sessions = sessions
        self.above = above
        self.missing: set[str] = set()
        self.regular_hours: list[bool] = []
        self.cached_daily: dict[int, dict] = {}
        self.final_spy_close: float | None = None

    def _history(self, conid: int, *, spy_close: float | None = None) -> dict:
        symbol = ALL_SYMBOLS[conid - 1]
        closes = []
        for index, session in enumerate(self.sessions):
            close = 100.0
            if index == len(self.sessions) - 1:
                close = 101.0 if symbol in INDEX_SYMBOLS or symbol in self.above else 98.0
                if symbol == "SPY" and spy_close is not None:
                    close = spy_close
            if symbol in self.missing and index == len(self.sessions) - 1:
                continue
            timestamp = int(dt.datetime.combine(session, dt.time(), dt.UTC).timestamp() * 1000)
            closes.append({"t": timestamp, "c": close})
        return {"data": closes}

    async def get_conid(self, symbol: str) -> int:
        return ALL_SYMBOLS.index(symbol) + 1

    async def history(self, conid: int, *, period: str, bar: str, outside_rth: bool) -> dict:
        assert (period, bar) == ("1y", "1d")
        self.regular_hours.append(outside_rth)
        if conid not in self.cached_daily:
            self.cached_daily[conid] = self._history(conid)
        return self.cached_daily[conid]

    async def history_fresh(self, conid: int, *, period: str, bar: str, outside_rth: bool) -> dict:
        assert (period, bar) == ("1y", "1d")
        self.regular_hours.append(outside_rth)
        final_close = self.final_spy_close if ALL_SYMBOLS[conid - 1] == "SPY" else None
        return self._history(conid, spy_close=final_close)


@pytest.mark.asyncio
async def test_assessment_classifies_and_keeps_prior_posture_when_missing_data_could_change_it():
    sessions = [dt.date(2026, 1, 1) + dt.timedelta(days=index) for index in range(120)]
    above = {item["symbol"] for item in SECTOR_ETFS[:8]}
    ibkr = _AssessmentIbkr(sessions, above)
    now = dt.datetime(2026, 10, 3, 12, tzinfo=dt.UTC)
    service = MarketAssessmentService(ibkr, now=lambda: now, calendar=object())
    next_close = now + dt.timedelta(days=1)
    contexts = [
        (sessions[-1], sessions, False, next_close),
        (sessions[-1] + dt.timedelta(days=1), sessions + [sessions[-1] + dt.timedelta(days=1)], True, next_close),
    ]
    service._session_context = lambda: contexts.pop(0)  # type: ignore[method-assign]

    eastern = ZoneInfo("America/New_York")
    calendar_service = MarketAssessmentService(
        ibkr,
        now=lambda: dt.datetime(2026, 11, 27, 12, 59, tzinfo=eastern),
        calendar=xcals.get_calendar("XNYS"),
    )
    expected, _, market_open, next_reconcile = calendar_service._session_context()
    assert expected == dt.date(2026, 11, 25)  # Thanksgiving is not an XNYS session.
    assert market_open  # Black Friday's early close is at 13:00 ET.
    assert next_reconcile.astimezone(eastern) == dt.datetime(2026, 11, 27, 13, 5, tzinfo=eastern)
    calendar_service._now = lambda: dt.datetime(2026, 11, 27, 13, 5, tzinfo=eastern)
    expected, _, market_open, _ = calendar_service._session_context()
    assert expected == dt.date(2026, 11, 27)
    assert not market_open

    first = await service.get_assessment()
    assert (first.status, first.posture) == ("complete", "broad")
    assert all(item.sma200 is None for item in first.indices)
    assert first.participation.confirmed_above == 8
    assert ibkr.regular_hours and all(value is False for value in ibkr.regular_hours)

    sessions = sessions + [sessions[-1] + dt.timedelta(days=1)]
    ibkr.sessions = sessions
    ibkr.above = {item["symbol"] for item in SECTOR_ETFS[:7]}
    ibkr.missing = {SECTOR_ETFS[7]["symbol"]}
    second = await service.get_assessment()
    assert (second.status, second.posture) == ("incomplete", None)
    assert (second.participation.possible_above_min, second.participation.possible_above_max) == (7, 8)
    assert second.previous_assessment is not None
    assert second.previous_assessment.posture == "broad"


@pytest.mark.asyncio
async def test_reconciliation_replaces_cached_preclose_close_with_corrected_provider_evidence():
    sessions = [dt.date(2026, 1, 1) + dt.timedelta(days=index) for index in range(120)]
    above = {item["symbol"] for item in SECTOR_ETFS[:8]}
    ibkr = _AssessmentIbkr(sessions, above)
    cached = await ibkr.history(1, period="1y", bar="1d", outside_rth=False)
    assert cached["data"][-1]["c"] == 101.0

    now = [dt.datetime(2026, 10, 3, 12, tzinfo=dt.UTC)]
    service = MarketAssessmentService(ibkr, now=lambda: now[0], calendar=object())
    next_close = now[0] + dt.timedelta(days=1)
    service._session_context = lambda: (sessions[-1], sessions, False, next_close)  # type: ignore[method-assign]

    before_correction = await service.get_assessment()
    assert before_correction.indices[0].close == 101.0
    ibkr.final_spy_close = 99.0
    now[0] += dt.timedelta(minutes=5)
    corrected = await service.get_assessment()

    assert corrected.expected_session == before_correction.expected_session
    assert corrected.indices[0].close == 99.0
    assert ibkr.cached_daily[1]["data"][-1]["c"] == 101.0


@pytest.mark.asyncio
async def test_ibkr_fresh_history_bypasses_cached_history_and_reads_corrected_provider_value(monkeypatch):
    cache_key = "history:1:bar=1d:outside_rth=False:period=1y"
    await cache.delete(cache_key)
    client = object.__new__(IBKRService)
    client.ensure_accounts = AsyncMock()
    client._request = AsyncMock(side_effect=[
        {"data": [{"t": "20261002", "c": 101}]},
        {"data": [{"t": "20261002", "c": 99}]},
    ])
    monkeypatch.setattr(ibkr_module, "dump_if_first", lambda *_args: None)

    try:
        cached = await client.history(1, period="1y", bar="1d", outside_rth=False)
        fresh = await client.history_fresh(1, period="1y", bar="1d", outside_rth=False)
        assert cached["data"][-1]["c"] == 101
        assert fresh["data"][-1]["c"] == 99
        assert client._request.await_count == 2
    finally:
        await cache.delete(cache_key)


def _shared_calculation_service():
    sessions = [dt.date(2026, 1, 1)]
    ibkr = _AssessmentIbkr(sessions, set())
    service = MarketAssessmentService(
        ibkr,
        now=lambda: dt.datetime(2026, 10, 3, 12, tzinfo=dt.UTC),
        calendar=object(),
    )
    service._session_context = lambda: (  # type: ignore[method-assign]
        sessions[-1], sessions, False, dt.datetime(2026, 10, 4, tzinfo=dt.UTC)
    )
    return service


@pytest.mark.asyncio
async def test_cancelling_one_assessment_caller_keeps_shared_calculation_for_other_caller():
    service = _shared_calculation_service()
    started, release, cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def calculate(*_args):
        started.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return service._unavailable("2026-10-03T12:00:00Z", "fixture")

    service._calculate = calculate  # type: ignore[method-assign]
    first = asyncio.create_task(service.get_assessment())
    await started.wait()
    second = asyncio.create_task(service.get_assessment())
    await asyncio.sleep(0)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert not cancelled.is_set()

    release.set()
    result = await second
    assert result.status == "incomplete"
    await asyncio.sleep(0)
    assert not service._inflight
    assert not cancelled.is_set()


@pytest.mark.asyncio
async def test_cancelling_all_assessment_callers_cancels_and_cleans_shared_calculation():
    service = _shared_calculation_service()
    started, cancelled = asyncio.Event(), asyncio.Event()

    async def calculate(*_args):
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    service._calculate = calculate  # type: ignore[method-assign]
    callers = [asyncio.create_task(service.get_assessment()) for _ in range(2)]
    await started.wait()
    await asyncio.sleep(0)
    for caller in callers:
        caller.cancel()
    for caller in callers:
        with pytest.raises(asyncio.CancelledError):
            await caller
    await asyncio.sleep(0)
    assert cancelled.is_set()
    assert not service._inflight


@pytest.mark.asyncio
async def test_failed_assessment_calculation_is_removed_from_inflight_for_recovery():
    service = _shared_calculation_service()
    attempts = 0

    async def calculate(*_args):
        nonlocal attempts
        attempts += 1
        raise RuntimeError("fixture request failure")

    service._calculate = calculate  # type: ignore[method-assign]
    with pytest.raises(RuntimeError, match="fixture request failure"):
        await service.get_assessment()
    await asyncio.sleep(0)
    assert not service._inflight

    with pytest.raises(RuntimeError, match="fixture request failure"):
        await service.get_assessment()
    await asyncio.sleep(0)
    assert attempts == 2
    assert not service._inflight
