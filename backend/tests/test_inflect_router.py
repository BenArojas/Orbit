"""Endpoint tests for the Inflect router.

Mounts the router on a bare app and overrides the service-builder dependencies
with an `InflectService` backed by an in-memory DB and a fake account resolver,
so the tests exercise routing, query/path wiring, status-code mapping, and
serialization without touching IBKR.

Seeding writes go straight to the live sqlite connection (synchronously) so the
async write-lock only ever binds to TestClient's event loop — avoiding
cross-loop `asyncio.Lock` issues.
"""

import json
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.inflect import get_inflect_service, require_inflect_service, router
from services.db import DatabaseService
from services.inflect.service import InflectService
from services.moonmarket import MoonMarketAccountNotFoundError

ET = ZoneInfo("US/Eastern")


def _et_ms(year, month, day, hour=12, minute=0) -> int:
    return int(datetime(year, month, day, hour, minute, tzinfo=ET).timestamp() * 1000)


class _FakeMoon:
    def __init__(self, account="DU1", not_found=False, synced=2):
        self._account = account
        self._not_found = not_found
        self._synced = synced

    async def _resolve_account_id(self, account_id):
        if self._not_found:
            raise MoonMarketAccountNotFoundError("Unknown account_id: nope")
        return account_id or self._account

    async def trades(self, account_id=None, days=7, db=None):
        return SimpleNamespace(trades=[{}] * self._synced)


def _memory_db() -> DatabaseService:
    db = DatabaseService(db_path=":memory:")
    db._conn = db._connect()
    db._create_tables()
    db._migrate()
    return db


def _client(service: InflectService) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_inflect_service] = lambda: service
    app.dependency_overrides[require_inflect_service] = lambda: service
    return TestClient(app)


def _insert_fill(db, *, execution_id, conid, side, qty, price, ms, account="DU1"):
    db._conn.execute(
        """
        INSERT INTO fills (execution_id, account_id, conid, symbol, side,
                           quantity, price, net_amount, commission, sec_type,
                           trade_time, trade_time_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (execution_id, account, conid, "AAPL", side, qty, price, price * qty,
         0.0, "STK", f"t{ms}", ms),
    )
    db._conn.commit()


def _seed_round_trip(db, *, conid=1, open_ms=None, close_ms=None,
                     entry=10.0, exit_=11.0, qty=10) -> str:
    open_ms = open_ms or _et_ms(2026, 6, 2, 9)
    close_ms = close_ms or _et_ms(2026, 6, 2, 10)
    _insert_fill(db, execution_id=f"{conid}-o-{open_ms}", conid=conid,
                 side="BUY", qty=qty, price=entry, ms=open_ms)
    _insert_fill(db, execution_id=f"{conid}-c-{close_ms}", conid=conid,
                 side="SELL", qty=qty, price=exit_, ms=close_ms)
    return f"DU1:{conid}:{conid}-o-{open_ms}"


def _seed_journal(db, *, trade_id, conid, setup, notes, tags):
    db._conn.execute(
        """
        INSERT INTO journal_entries (trade_id, account_id, conid, setup, notes, tags)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (trade_id, "DU1", conid, setup, notes, json.dumps(tags)),
    )
    db._conn.commit()


def _service(moon=None) -> InflectService:
    db = _memory_db()
    return InflectService(ibkr=None, db=db, moonmarket=moon or _FakeMoon())


def test_health():
    resp = _client(_service()).get("/inflect/health")
    assert resp.status_code == 200
    assert resp.json() == {"module": "inflect", "status": "ok"}


def test_setups_returns_fixed_vocabulary():
    resp = _client(_service()).get("/inflect/setups")
    assert resp.status_code == 200
    setups = resp.json()["setups"]
    assert setups[0] == "Fib retracement"
    assert "Breakout" in setups
    assert setups[-1] == "Other"


def test_calendar_empty():
    resp = _client(_service()).get("/inflect/calendar?year=2026&month=6")
    assert resp.status_code == 200
    body = resp.json()
    assert body["account_id"] == "DU1"
    assert body["days"] == []
    assert body["total_net_pnl"] == 0.0
    assert body["days_traded"] == 0


def test_calendar_with_a_closed_trade():
    svc = _service()
    _seed_round_trip(svc.db)
    resp = _client(svc).get("/inflect/calendar?year=2026&month=6")
    assert resp.status_code == 200
    body = resp.json()
    assert body["days"][0]["date"] == "2026-06-02"
    assert body["days"][0]["net_pnl"] == 10.0
    assert body["total_net_pnl"] == 10.0


def test_trades_list_and_journal_attach():
    svc = _service()
    trade_id = _seed_round_trip(svc.db)
    _seed_journal(svc.db, trade_id=trade_id, conid=1, setup="Breakout",
                  notes="clean", tags=["momentum"])
    resp = _client(svc).get("/inflect/trades")
    assert resp.status_code == 200
    trades = resp.json()["trades"]
    assert len(trades) == 1
    assert trades[0]["trade_id"] == trade_id
    assert trades[0]["status"] == "CLOSED"
    assert trades[0]["journal_entry"]["setup"] == "Breakout"
    assert trades[0]["journal_entry"]["tags"] == ["momentum"]


def test_trades_status_filter():
    svc = _service()
    _seed_round_trip(svc.db)  # closed
    # An open position (conid 2) — buy only, never flattened.
    _insert_fill(svc.db, execution_id="2-o", conid=2, side="BUY", qty=5,
                 price=10.0, ms=_et_ms(2026, 6, 3, 9))
    client = _client(svc)
    closed = client.get("/inflect/trades?status=CLOSED").json()["trades"]
    assert [t["status"] for t in closed] == ["CLOSED"]
    open_ = client.get("/inflect/trades?status=OPEN").json()["trades"]
    assert [t["status"] for t in open_] == ["OPEN"]


def test_trade_detail_found_and_missing():
    svc = _service()
    trade_id = _seed_round_trip(svc.db)
    client = _client(svc)

    ok = client.get(f"/inflect/trades/{trade_id}")
    assert ok.status_code == 200
    assert ok.json()["trade_id"] == trade_id
    assert len(ok.json()["fills"]) == 2

    missing = client.get("/inflect/trades/DU1:999:nope")
    assert missing.status_code == 404
    assert missing.json()["detail"]["error"] == "inflect_trade_not_found"


def test_save_journal_round_trips():
    svc = _service()
    trade_id = _seed_round_trip(svc.db)
    client = _client(svc)

    resp = client.put(
        f"/inflect/trades/{trade_id}/journal",
        json={"setup": "Mean reversion", "notes": "faded the gap", "tags": ["a", "b"]},
    )
    assert resp.status_code == 200
    entry = resp.json()
    assert entry["trade_id"] == trade_id
    assert entry["setup"] == "Mean reversion"
    assert entry["tags"] == ["a", "b"]

    # The saved entry is now attached to the trade detail.
    detail = client.get(f"/inflect/trades/{trade_id}")
    assert detail.json()["journal_entry"]["notes"] == "faded the gap"


def test_save_journal_rejects_malformed_trade_id():
    resp = _client(_service()).put(
        "/inflect/trades/not-a-valid-id/journal",
        json={"setup": None, "notes": None, "tags": []},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "inflect_invalid_trade_id"


def test_sync_returns_count():
    resp = _client(_service(_FakeMoon(synced=4))).post("/inflect/sync")
    assert resp.status_code == 200
    assert resp.json() == {"account_id": "DU1", "synced": 4}


def test_account_not_found_maps_to_404():
    resp = _client(_service(_FakeMoon(not_found=True))).get(
        "/inflect/calendar?year=2026&month=6&account_id=nope"
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "inflect_account_not_found"
