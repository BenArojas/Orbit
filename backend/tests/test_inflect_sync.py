"""Tests for InflectSyncService — lifecycle, auth-wait, and the extended-hours
market-session gate (spec §12).

The IBKR client and InflectService are faked; the gate's pure helpers
(`_in_window`, `_fallback_window`, `_parse_schedule_window`,
`_hhmm_to_minutes`) are tested directly, and `_tick` is driven through the
window cache to assert sync runs only when the market is open.
"""

from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from exceptions import IBKRConnectionError
from services.inflect_sync import InflectSyncService

ET = ZoneInfo("US/Eastern")


class _FakeState:
    def __init__(self, authenticated=False):
        self.authenticated = authenticated


class _FakeIBKR:
    def __init__(self, authenticated=False, payload=None, exc=None):
        self.state = _FakeState(authenticated)
        self._payload = payload
        self._exc = exc
        self.requests = []

    async def _request(self, method, endpoint, params=None):
        self.requests.append((method, endpoint, params))
        if self._exc is not None:
            raise self._exc
        return self._payload


class _FakeInflect:
    def __init__(self, exc=None):
        self.calls = 0
        self._exc = exc

    async def sync(self, account_id=None):
        self.calls += 1
        if self._exc is not None:
            raise self._exc
        return SimpleNamespace(synced=3)


def _svc(ibkr=None, inflect=None):
    return InflectSyncService(
        ibkr=ibkr or _FakeIBKR(), inflect=inflect or _FakeInflect()
    )


# ── Window math ────────────────────────────────────────────────


def test_in_window_inside_and_outside():
    svc = _svc()
    now = datetime(2026, 6, 1, 10, 0, tzinfo=ET)  # 600 min
    assert svc._in_window(now, (4 * 60, 20 * 60)) is True
    early = datetime(2026, 6, 1, 3, 0, tzinfo=ET)  # 180 min
    assert svc._in_window(early, (4 * 60, 20 * 60)) is False
    late = datetime(2026, 6, 1, 20, 0, tzinfo=ET)  # 1200, == close → excluded
    assert svc._in_window(late, (4 * 60, 20 * 60)) is False


def test_in_window_none_is_never_open():
    svc = _svc()
    now = datetime(2026, 6, 1, 10, 0, tzinfo=ET)
    assert svc._in_window(now, None) is False


def test_fallback_window_weekday_vs_weekend():
    svc = _svc()
    monday = datetime(2026, 6, 1, 10, 0, tzinfo=ET)
    assert svc._fallback_window(monday) == (4 * 60, 20 * 60)
    saturday = datetime(2026, 6, 6, 10, 0, tzinfo=ET)
    assert svc._fallback_window(saturday) is None


def test_hhmm_to_minutes():
    svc = _svc()
    assert svc._hhmm_to_minutes("0400") == 240
    assert svc._hhmm_to_minutes("2000") == 1200
    assert svc._hhmm_to_minutes("930") is None  # not 4 digits
    assert svc._hhmm_to_minutes(None) is None
    assert svc._hhmm_to_minutes(" abcd") is None


def test_parse_schedule_window_trading_day():
    svc = _svc()
    now = datetime(2026, 6, 1, 10, 0, tzinfo=ET)
    payload = [
        {
            "schedules": [
                {
                    "tradingScheduleDate": "20260601",
                    "tradingtimes": [
                        {"openingTime": "0400", "closingTime": "2000"},
                    ],
                },
                {"tradingScheduleDate": "20260602", "tradingtimes": []},
            ]
        }
    ]
    assert svc._parse_schedule_window(payload, now) == (240, 1200)


def test_parse_schedule_window_holiday_marks_closed():
    svc = _svc()
    now = datetime(2026, 7, 3, 10, 0, tzinfo=ET)
    payload = [
        {
            "schedules": [
                {"tradingScheduleDate": "20260703", "tradingtimes": []},
            ]
        }
    ]
    assert svc._parse_schedule_window(payload, now) is None
    assert svc._schedule_marked_closed is True


def test_parse_schedule_window_missing_day_returns_none():
    svc = _svc()
    now = datetime(2026, 6, 1, 10, 0, tzinfo=ET)
    payload = [{"schedules": [{"tradingScheduleDate": "20251231", "tradingtimes": []}]}]
    assert svc._parse_schedule_window(payload, now) is None
    assert svc._schedule_marked_closed is False


# ── Window resolution (schedule + fallback) ────────────────────


@pytest.mark.asyncio
async def test_resolve_window_falls_back_on_fetch_error():
    ibkr = _FakeIBKR(exc=IBKRConnectionError("down"))
    svc = _svc(ibkr=ibkr)
    monday = datetime(2026, 6, 1, 10, 0, tzinfo=ET)
    window = await svc._resolve_today_window(monday)
    assert window == (4 * 60, 20 * 60)  # hardcoded fallback


@pytest.mark.asyncio
async def test_resolve_window_holiday_does_not_fall_back():
    payload = [{"schedules": [{"tradingScheduleDate": "20260703", "tradingtimes": []}]}]
    ibkr = _FakeIBKR(payload=payload)
    svc = _svc(ibkr=ibkr)
    holiday = datetime(2026, 7, 3, 10, 0, tzinfo=ET)
    window = await svc._resolve_today_window(holiday)
    assert window is None  # schedule authoritatively closed → no fallback


@pytest.mark.asyncio
async def test_resolve_window_is_cached_per_day():
    payload = [
        {"schedules": [{"tradingScheduleDate": datetime.now(ET).strftime("%Y%m%d"),
                        "tradingtimes": [{"openingTime": "0400", "closingTime": "2000"}]}]}
    ]
    ibkr = _FakeIBKR(payload=payload)
    svc = _svc(ibkr=ibkr)
    now = datetime.now(ET)
    await svc._resolve_today_window(now)
    await svc._resolve_today_window(now)
    assert len(ibkr.requests) == 1  # second call served from cache


# ── Tick gating ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tick_syncs_when_in_window():
    inflect = _FakeInflect()
    svc = _svc(inflect=inflect)
    # Prime the window cache for today so _tick treats the market as open.
    today = datetime.now(ET).date().isoformat()
    svc._window_cache_day = today
    svc._window_cache = (0, 24 * 60)  # open all day
    await svc._tick()
    assert inflect.calls == 1
    assert svc._last_synced_count == 3


@pytest.mark.asyncio
async def test_tick_skips_when_market_closed():
    inflect = _FakeInflect()
    svc = _svc(inflect=inflect)
    today = datetime.now(ET).date().isoformat()
    svc._window_cache_day = today
    svc._window_cache = None  # non-trading day
    await svc._tick()
    assert inflect.calls == 0


@pytest.mark.asyncio
async def test_tick_swallows_ibkr_errors():
    inflect = _FakeInflect(exc=IBKRConnectionError("boom"))
    svc = _svc(inflect=inflect)
    today = datetime.now(ET).date().isoformat()
    svc._window_cache_day = today
    svc._window_cache = (0, 24 * 60)
    # Must not raise — a transient IBKR failure should be logged and retried.
    await svc._tick()
    assert inflect.calls == 1


# ── Lifecycle / auth-wait ──────────────────────────────────────


@pytest.mark.asyncio
async def test_wait_for_auth_returns_true_when_authenticated():
    svc = _svc(ibkr=_FakeIBKR(authenticated=True))
    assert await svc._wait_for_ibkr_auth() is True


@pytest.mark.asyncio
async def test_start_and_stop_are_clean():
    svc = _svc(ibkr=_FakeIBKR(authenticated=True))
    svc.start()
    assert svc.status()["running"] is True
    await svc.stop()
    assert svc.status()["running"] is False


@pytest.mark.asyncio
async def test_stop_unblocks_auth_wait():
    # Not authenticated: the loop parks in _wait_for_ibkr_auth; stop() must
    # release it without hanging.
    svc = _svc(ibkr=_FakeIBKR(authenticated=False))
    svc.start()
    await svc.stop()
    assert svc.status()["running"] is False
