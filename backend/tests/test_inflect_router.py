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
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.testclient import TestClient

from exceptions import IBKRRateLimitError
from models.inflect import InflectTrade
from routers.inflect import get_inflect_service, require_inflect_service, router
from services.db import DatabaseService
from services.inflect.service import InflectService
from services.moonmarket import MoonMarketAccountNotFoundError

ET = ZoneInfo("US/Eastern")


def _et_ms(year, month, day, hour=12, minute=0) -> int:
    return int(datetime(year, month, day, hour, minute, tzinfo=ET).timestamp() * 1000)


class _FakeTrade:
    def __init__(self, **row):
        self._row = row

    def model_dump(self):
        return dict(self._row)


class _FakeMoon:
    def __init__(self, account="DU1", not_found=False, trades=None):
        self._account = account
        self._not_found = not_found
        self._trades = trades if trades is not None else []

    async def _resolve_account_id(self, account_id):
        if self._not_found:
            raise MoonMarketAccountNotFoundError("Unknown account_id: nope")
        return account_id or self._account

    async def trades(self, account_id=None, days=7, db=None):
        return SimpleNamespace(trades=list(self._trades))


class _RecordingIdentity:
    def __init__(self, rows):
        self.rows = rows
        self.calls: list[list[int]] = []

    async def get_many(self, conids):
        self.calls.append(list(conids))
        return list(self.rows)


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
                     entry=10.0, exit_=11.0, qty=10, account="DU1") -> str:
    open_ms = open_ms or _et_ms(2026, 6, 2, 9)
    close_ms = close_ms or _et_ms(2026, 6, 2, 10)
    _insert_fill(db, execution_id=f"{account}-{conid}-o-{open_ms}", conid=conid,
                 side="BUY", qty=qty, price=entry, ms=open_ms, account=account)
    _insert_fill(db, execution_id=f"{account}-{conid}-c-{close_ms}", conid=conid,
                 side="SELL", qty=qty, price=exit_, ms=close_ms, account=account)
    return f"{account}:{conid}:{account}-{conid}-o-{open_ms}"


def _seed_journal(db, *, trade_id, conid, setup, notes, tags, account="DU1"):
    db._conn.execute(
        """
        INSERT INTO journal_entries (trade_id, account_id, conid, setup, notes, tags)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (trade_id, account, conid, setup, notes, json.dumps(tags)),
    )
    db._conn.commit()


def _service(moon=None, ibkr=None) -> InflectService:
    db = _memory_db()
    return InflectService(ibkr=ibkr, db=db, moonmarket=moon or _FakeMoon())


def _open_short_trade(*, account="DU1", conid=1) -> InflectTrade:
    return InflectTrade(
        trade_id=f"{account}:{conid}:short-open",
        account_id=account,
        conid=conid,
        symbol="AAPL",
        sec_type="STK",
        direction="SHORT",
        status="OPEN",
        open_time="2026-06-02T09:00:00Z",
        open_time_ms=_et_ms(2026, 6, 2, 9),
        qty=10,
        avg_entry=20.0,
    )


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


def test_trades_display_guard_suppresses_stray_open_short_when_current_position_is_long():
    ibkr = SimpleNamespace(
        _request=AsyncMock(
            return_value=[{"conid": 1, "position": 5}]
        )
    )
    svc = _service(ibkr=ibkr)

    async def matched(account_id, end_ms):
        return [_open_short_trade(account=account_id, conid=1)]

    svc._matched_trades = matched

    client = _client(svc)
    first = client.get("/inflect/trades")
    second = client.get("/inflect/trades")

    assert first.status_code == 200
    trade = first.json()["trades"][0]
    assert trade["status"] == "INCOMPLETE_BASIS"
    assert trade["direction"] == "UNKNOWN"
    assert second.status_code == 200
    ibkr._request.assert_awaited_once_with("GET", "/portfolio2/DU1/positions")


def test_trades_display_guard_suppresses_stray_open_short_when_current_position_is_flat():
    ibkr = SimpleNamespace(
        _request=AsyncMock(
            return_value=[{"conid": 1, "position": 0}]
        )
    )
    svc = _service(ibkr=ibkr)

    async def matched(account_id, end_ms):
        return [_open_short_trade(account=account_id, conid=1)]

    svc._matched_trades = matched

    resp = _client(svc).get("/inflect/trades")

    assert resp.status_code == 200
    trade = resp.json()["trades"][0]
    assert trade["status"] == "INCOMPLETE_BASIS"
    assert trade["direction"] == "UNKNOWN"


def test_trades_display_guard_skips_rate_limited_position_check_without_failing():
    ibkr = SimpleNamespace(
        _request=AsyncMock(
            side_effect=IBKRRateLimitError(
                endpoint="/portfolio2/DU1/positions",
                retry_after=5,
            )
        )
    )
    svc = _service(ibkr=ibkr)

    async def matched(account_id, end_ms):
        return [_open_short_trade(account=account_id, conid=1)]

    svc._matched_trades = matched

    resp = _client(svc).get("/inflect/trades")

    assert resp.status_code == 200
    trade = resp.json()["trades"][0]
    assert trade["status"] == "OPEN"
    assert trade["direction"] == "SHORT"


def test_trades_list_does_not_attach_journal_from_other_account():
    svc = _service()
    trade_id = _seed_round_trip(svc.db, account="DU1")
    _seed_journal(
        svc.db,
        trade_id=trade_id,
        account="DU2",
        conid=1,
        setup="Breakout",
        notes="wrong account",
        tags=["leak"],
    )

    resp = _client(svc).get("/inflect/trades?account_id=DU1")

    assert resp.status_code == 200
    assert resp.json()["trades"][0]["journal_entry"] is None


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


def test_backfill_status_returns_queue_items_and_filters_by_conid():
    svc = _service()
    svc.db._conn.execute(
        """
        INSERT INTO basis_backfill_queue
            (account_id, conid, status, attempts, days_used, last_checked_ms, last_error)
        VALUES
            (?, ?, ?, ?, ?, ?, ?),
            (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "DU1",
            101,
            "still_needs_basis",
            2,
            365,
            _et_ms(2026, 6, 2, 11),
            "basis still missing",
            "DU1",
            202,
            "pending",
            0,
            None,
            None,
            None,
        ),
    )
    svc.db._conn.commit()

    client = _client(svc)

    all_items = client.get("/inflect/backfill-status?account_id=DU1")
    assert all_items.status_code == 200
    assert all_items.json()["account_id"] == "DU1"
    assert [item["conid"] for item in all_items.json()["items"]] == [101, 202]
    assert all_items.json()["items"][0]["status"] == "still_needs_basis"
    assert all_items.json()["items"][0]["days_used"] == 365

    filtered = client.get("/inflect/backfill-status?account_id=DU1&conid=202")
    assert filtered.status_code == 200
    assert [item["conid"] for item in filtered.json()["items"]] == [202]


def test_basis_audit_returns_rows_for_conid():
    svc = _service()
    svc.db._conn.execute(
        """
        INSERT INTO basis_audit
            (account_id, conid, action, source, before_json, after_json)
        VALUES
            (?, ?, ?, ?, ?, ?),
            (?, ?, ?, ?, ?, ?),
            (?, ?, ?, ?, ?, ?)
        """,
        (
            "DU1",
            101,
            "lot_create",
            "MANUAL",
            "[]",
            '[{"status":"CLOSED"}]',
            "DU1",
            202,
            "auto_backfill",
            "PA_TRANSACTION",
            "[]",
            "[]",
            "DU2",
            101,
            "lot_delete",
            "MANUAL",
            "[]",
            "[]",
        ),
    )
    svc.db._conn.commit()

    resp = _client(svc).get("/inflect/basis-audit?account_id=DU1&conid=101")

    assert resp.status_code == 200
    assert resp.json()["account_id"] == "DU1"
    assert resp.json()["conid"] == 101
    assert len(resp.json()["items"]) == 1
    assert resp.json()["items"][0]["action"] == "lot_create"
    assert resp.json()["items"][0]["source"] == "MANUAL"
    assert resp.json()["items"][0]["after_json"] == '[{"status":"CLOSED"}]'


def test_symbols_returns_distinct_traded_conids_in_period():
    svc = _service()
    _insert_fill(
        svc.db,
        execution_id="aapl-1",
        conid=101,
        side="BUY",
        qty=1,
        price=10,
        ms=_et_ms(2026, 6, 1, 10),
    )
    svc.db._conn.execute(
        "UPDATE fills SET symbol = ? WHERE execution_id = ?",
        ("AAPL", "aapl-1"),
    )
    _insert_fill(
        svc.db,
        execution_id="old",
        conid=202,
        side="BUY",
        qty=1,
        price=20,
        ms=_et_ms(2026, 5, 1, 10),
    )
    svc.db._conn.execute(
        """
        INSERT INTO instruments (conid, symbol, company_name, sec_type)
        VALUES (?, ?, ?, ?), (?, ?, ?, ?)
        """,
        (303, "MSFT", "Microsoft", "STK", 202, "OLD", "Old", "STK"),
    )
    svc.db._conn.execute(
        """
        INSERT INTO basis_lots
            (account_id, conid, side, quantity, entry_date, entry_price)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("DU1", 303, "LONG", 5, "2026-06-02", 30),
    )
    svc.db._conn.commit()

    resp = _client(svc).get(
        "/inflect/symbols"
        f"?account_id=DU1&from={_et_ms(2026, 6, 1, 0)}&to={_et_ms(2026, 6, 3, 0)}"
    )

    assert resp.status_code == 200
    assert resp.json()["account_id"] == "DU1"
    assert resp.json()["symbols"] == [
        {"conid": 101, "symbol": "AAPL"},
        {"conid": 303, "symbol": "MSFT"},
    ]


def test_symbols_uses_identity_service_for_cached_conid_display():
    svc = _service()
    _insert_fill(
        svc.db,
        execution_id="aapl-1",
        conid=101,
        side="BUY",
        qty=1,
        price=10,
        ms=_et_ms(2026, 6, 1, 10),
    )
    svc.db._conn.execute(
        "UPDATE fills SET symbol = ? WHERE execution_id = ?",
        ("AAPL", "aapl-1"),
    )
    svc.db._conn.execute(
        """
        INSERT INTO basis_lots
            (account_id, conid, side, quantity, entry_date, entry_price)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("DU1", 303, "LONG", 5, "2026-06-02", 30),
    )
    svc.db._conn.commit()
    identity = _RecordingIdentity([
        {"conid": 303, "symbol": "MSFT", "company_name": "Microsoft", "sec_type": "STK"},
    ])
    svc.identity = identity

    resp = _client(svc).get(
        "/inflect/symbols"
        f"?account_id=DU1&from={_et_ms(2026, 6, 1, 0)}&to={_et_ms(2026, 6, 3, 0)}"
    )

    assert resp.status_code == 200
    assert resp.json()["symbols"] == [
        {"conid": 101, "symbol": "AAPL"},
        {"conid": 303, "symbol": "MSFT"},
    ]
    assert identity.calls == [[101, 303]]


def test_storage_endpoints_report_stats_and_require_cleanup_confirm():
    svc = _service()
    _insert_fill(
        svc.db,
        execution_id="raw-old",
        conid=101,
        side="BUY",
        qty=1,
        price=10,
        ms=_et_ms(2026, 5, 1, 10),
    )
    svc.db._conn.execute(
        "UPDATE fills SET raw_json = ? WHERE execution_id = ?",
        ('{"source":"old"}', "raw-old"),
    )
    svc.db._conn.commit()
    client = _client(svc)

    stats = client.get("/inflect/storage")
    assert stats.status_code == 200
    assert stats.json()["table_counts"]["fills"] == 1
    assert stats.json()["raw_json_bytes"] > 0

    rejected = client.post(
        "/inflect/storage/cleanup",
        json={"before_date": "2026-06-01", "confirm": False},
    )
    assert rejected.status_code == 400

    cleaned = client.post(
        "/inflect/storage/cleanup",
        json={"before_date": "2026-06-01", "confirm": True},
    )
    assert cleaned.status_code == 200
    assert cleaned.json()["cleared_raw_payloads"] == 1
    assert cleaned.json()["deleted_rows"] == 0
    assert cleaned.json()["export_recommended"] is True


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


def test_save_journal_returns_404_for_valid_missing_trade_id():
    resp = _client(_service()).put(
        "/inflect/trades/DU1:1:not-present/journal",
        json={"setup": None, "notes": "should not save", "tags": []},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "inflect_trade_not_found"


def test_save_journal_rejects_unknown_setup():
    svc = _service()
    trade_id = _seed_round_trip(svc.db)

    resp = _client(svc).put(
        f"/inflect/trades/{trade_id}/journal",
        json={"setup": "Not a setup", "notes": None, "tags": []},
    )

    assert resp.status_code == 422


def test_save_journal_rejects_malformed_trade_id():
    resp = _client(_service()).put(
        "/inflect/trades/not-a-valid-id/journal",
        json={"setup": None, "notes": None, "tags": []},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "inflect_invalid_trade_id"


def test_sync_returns_accepted_db_upsert_count():
    trades = [
        _FakeTrade(
            execution_id="ok-1",
            account_id="DU1",
            conid=1,
            side="BUY",
            quantity=1,
            trade_time="2026-06-02T10:00:00Z",
        ),
        _FakeTrade(
            execution_id="missing-required-fields",
            account_id="DU1",
            conid=1,
            side="SELL",
        ),
    ]

    resp = _client(_service(_FakeMoon(trades=trades))).post("/inflect/sync")

    assert resp.status_code == 200
    assert resp.json() == {"account_id": "DU1", "synced": 1}


def test_sync_is_idempotent_for_duplicate_execution_ids():
    trades = [
        _FakeTrade(
            execution_id="same-exec",
            account_id="DU1",
            conid=1,
            side="BUY",
            quantity=1,
            trade_time="2026-06-02T10:00:00Z",
        ),
    ]
    svc = _service(_FakeMoon(trades=trades))
    client = _client(svc)

    first = client.post("/inflect/sync")
    second = client.post("/inflect/sync")

    assert first.status_code == 200
    assert second.status_code == 200
    rows = svc.db._conn.execute(
        "SELECT execution_id, quantity FROM fills WHERE account_id = ?",
        ("DU1",),
    ).fetchall()
    assert [tuple(row) for row in rows] == [("same-exec", 1.0)]


def test_account_not_found_maps_to_404():
    resp = _client(_service(_FakeMoon(not_found=True))).get(
        "/inflect/calendar?year=2026&month=6&account_id=nope"
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "inflect_account_not_found"
