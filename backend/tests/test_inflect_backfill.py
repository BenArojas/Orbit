from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from exceptions import IBKRRateLimitError
from services.db import DatabaseService
from services.inflect_backfill import InflectBackfillService


_SIXTEEN_MIN_MS = 16 * 60 * 1000


class _FakeState:
    def __init__(self, authenticated: bool = False) -> None:
        self.authenticated = authenticated


class _FakeIBKR:
    def __init__(self, *, authenticated: bool = True, responses=None) -> None:
        self.state = _FakeState(authenticated)
        self.responses = list(responses or [])
        self.requests: list[tuple[str, str, dict | None]] = []

    async def _request(self, method: str, endpoint: str, params=None):
        self.requests.append((method, endpoint, params))
        if self.responses:
            response = self.responses.pop(0)
            if isinstance(response, BaseException):
                raise response
            return response
        return {"transactions": []}


class _FakeInflect:
    def __init__(self, trades=None) -> None:
        self._trades = trades or []
        self.calls = 0

    async def trades(self, account_id, status=None):
        self.calls += 1
        return SimpleNamespace(account_id=account_id or "DU123", trades=self._trades)


@pytest.fixture
async def db():
    svc = DatabaseService(db_path=":memory:")
    await svc.initialize()
    yield svc
    await svc.close()


@pytest.mark.asyncio
async def test_enqueue_basis_is_idempotent(db):
    await db.enqueue_basis("DU123", 265598)
    await db.enqueue_basis("DU123", 265598)

    rows = await db.list_backfill_status("DU123")

    assert len(rows) == 1
    assert rows[0]["account_id"] == "DU123"
    assert rows[0]["conid"] == 265598
    assert rows[0]["status"] == "pending"
    assert rows[0]["attempts"] == 0


@pytest.mark.asyncio
async def test_claim_next_backfill_respects_16_minute_gate(db):
    now_ms = 1_800_000_000_000
    await db.enqueue_basis("DU123", 1)
    await db.enqueue_basis("DU123", 2)
    await db.set_backfill_status(
        "DU123",
        1,
        status="pending",
        last_checked_ms=now_ms - _SIXTEEN_MIN_MS + 1,
    )
    await db.set_backfill_status(
        "DU123",
        2,
        status="pending",
        last_checked_ms=now_ms - _SIXTEEN_MIN_MS,
    )

    claimed = await db.claim_next_backfill(now_ms=now_ms)

    assert claimed is not None
    assert claimed["conid"] == 2
    assert claimed["status"] == "running"
    assert claimed["attempts"] == 1


@pytest.mark.asyncio
async def test_rate_limit_path_sets_status_without_immediate_retry(db):
    clock = [1_800_000_000_000]
    ibkr = _FakeIBKR(
        responses=[IBKRRateLimitError("/pa/transactions", retry_after=900)]
    )
    svc = InflectBackfillService(
        ibkr=ibkr,
        db=db,
        inflect=_FakeInflect(),
        clock_ms=lambda: clock[0],
    )
    await db.enqueue_basis("DU123", 265598)

    await svc._tick()
    clock[0] += 60_000
    await svc._tick()

    rows = await db.list_backfill_status("DU123")
    assert len(ibkr.requests) == 1
    assert rows[0]["status"] == "rate_limited"
    assert rows[0]["last_error"] == "Rate limit exceeded for /pa/transactions (retry after 900s)"


@pytest.mark.asyncio
async def test_scheduler_does_not_call_pa_transactions_within_16_minutes(db):
    clock = [1_800_000_000_000]
    ibkr = _FakeIBKR(responses=[{"transactions": []}, {"transactions": []}])
    svc = InflectBackfillService(
        ibkr=ibkr,
        db=db,
        inflect=_FakeInflect(),
        clock_ms=lambda: clock[0],
    )
    await db.enqueue_basis("DU123", 1)
    await db.enqueue_basis("DU123", 2)

    await svc._tick()
    clock[0] += _SIXTEEN_MIN_MS - 1
    await svc._tick()
    clock[0] += 1
    await svc._tick()

    pa_requests = [request for request in ibkr.requests if request[1] == "/pa/transactions"]
    assert len(pa_requests) == 2
    assert pa_requests == [
        ("GET", "/pa/transactions", {"accountId": "DU123", "conid": "1", "days": 365}),
        ("GET", "/pa/transactions", {"accountId": "DU123", "conid": "2", "days": 365}),
    ]


@pytest.mark.asyncio
async def test_start_stop_unblocks_auth_wait(db):
    svc = InflectBackfillService(
        ibkr=_FakeIBKR(authenticated=False),
        db=db,
        inflect=_FakeInflect(),
    )

    svc.start()
    await asyncio.sleep(0)
    assert svc.status()["waiting_for_auth"] is True
    await svc.stop()

    assert svc.status()["running"] is False


@pytest.mark.asyncio
async def test_tick_auto_enqueues_needs_basis_trades(db):
    trade = SimpleNamespace(account_id="DU123", conid=265598, status="INCOMPLETE_BASIS")
    svc = InflectBackfillService(
        ibkr=_FakeIBKR(),
        db=db,
        inflect=_FakeInflect(trades=[trade]),
    )

    await svc._enqueue_needs_basis()

    rows = await db.list_backfill_status("DU123")
    assert [(row["account_id"], row["conid"], row["status"]) for row in rows] == [
        ("DU123", 265598, "pending")
    ]
