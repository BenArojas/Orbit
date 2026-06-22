"""Tests for InflectSyncService — external-failure safety and lifecycle.

Protects promise #5: external failures stop safely and visibly.
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


# ── Tick gating ────────────────────────────────────────────────


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
async def test_stop_unblocks_auth_wait():
    # Not authenticated: the loop parks in _wait_for_ibkr_auth; stop() must
    # release it without hanging.
    svc = _svc(ibkr=_FakeIBKR(authenticated=False))
    svc.start()
    await svc.stop()
    assert svc.status()["running"] is False
