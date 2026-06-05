from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from services.db import DatabaseService


def test_migrate_normalizes_legacy_crypto_pulse_symbols():
    svc = DatabaseService(db_path=":memory:")
    svc._conn = svc._connect()
    svc._create_tables()

    svc._conn.execute(
        "INSERT INTO pulse_config (position, label, resolve, sec_type) VALUES (0, 'BTC', 'BTC.USD', '')"
    )
    svc._conn.execute(
        "INSERT INTO pulse_config (position, label, resolve, sec_type) VALUES (1, 'ETH', 'ETH.USD', '')"
    )
    svc._conn.commit()

    svc._migrate()

    rows = svc._fetchall(
        "SELECT label, resolve, sec_type FROM pulse_config ORDER BY position ASC"
    )
    assert rows == [
        {"label": "BTC", "resolve": "BTC", "sec_type": ""},
        {"label": "ETH", "resolve": "ETH", "sec_type": ""},
    ]


def test_create_tables_includes_basis_backfill_queue():
    svc = DatabaseService(db_path=":memory:")
    svc._conn = svc._connect()
    svc._create_tables()
    svc._migrate()

    columns = svc._fetchall("PRAGMA table_info(basis_backfill_queue)")
    assert {column["name"] for column in columns} >= {
        "account_id",
        "conid",
        "status",
        "attempts",
        "days_used",
        "last_checked_ms",
        "last_error",
        "created_at",
        "updated_at",
    }


@pytest.mark.asyncio
async def test_fills_table_upserts_and_lists_recent_fills():
    svc = DatabaseService(db_path=":memory:")
    svc._conn = svc._connect()
    svc._create_tables()
    svc._migrate()

    columns = svc._fetchall("PRAGMA table_info(fills)")
    assert {column["name"] for column in columns} >= {
        "execution_id",
        "account_id",
        "conid",
        "side",
        "quantity",
        "trade_time",
        "trade_time_ms",
        "raw_json",
    }

    old_trade_time = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=2)
    new_trade_time = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=1)

    inserted = await svc.upsert_fills(
        [
            {
                "execution_id": "E-OLD",
                "account_id": "DU12345",
                "conid": 265598,
                "symbol": "AAPL",
                "description": "BOT 1 AAPL",
                "side": "BUY",
                "quantity": 1.0,
                "price": 180.0,
                "net_amount": -180.0,
                "commission": 1.0,
                "sec_type": "STK",
                "trade_time": old_trade_time.isoformat(),
                "trade_time_ms": int(old_trade_time.timestamp() * 1000),
                "raw_json": {"source": "old"},
            },
            {
                "execution_id": "E-NEW",
                "account_id": "DU12345",
                "conid": 756733,
                "symbol": "SPY",
                "description": "SLD 2 SPY",
                "side": "SELL",
                "quantity": 2.0,
                "price": 550.0,
                "net_amount": 1100.0,
                "commission": 1.25,
                "sec_type": "ETF",
                "trade_time": new_trade_time.isoformat(),
                "trade_time_ms": int(new_trade_time.timestamp() * 1000),
                "raw_json": {"source": "new"},
            },
            {
                "execution_id": "BAD-NO-CONID",
                "account_id": "DU12345",
                "side": "BUY",
                "quantity": 1.0,
                "trade_time": "2026-05-26T11:00:00+00:00",
            },
        ]
    )
    assert inserted == 2

    updated = await svc.upsert_fills(
        [
            {
                "execution_id": "E-OLD",
                "account_id": "DU12345",
                "conid": 265598,
                "symbol": "AAPL",
                "description": "BOT 3 AAPL",
                "side": "BUY",
                "quantity": 3.0,
                "price": 181.0,
                "net_amount": -543.0,
                "commission": 1.5,
                "sec_type": "STK",
                "trade_time": old_trade_time.isoformat(),
                "trade_time_ms": int(old_trade_time.timestamp() * 1000),
                "raw_json": {"source": "updated"},
            }
        ]
    )
    assert updated == 1

    rows = await svc.list_fills("DU12345", days=7)
    assert [row["execution_id"] for row in rows] == ["E-NEW", "E-OLD"]
    assert rows[1]["quantity"] == 3.0
    assert svc._fetchall("SELECT execution_id FROM fills ORDER BY execution_id ASC") == [
        {"execution_id": "E-NEW"},
        {"execution_id": "E-OLD"},
    ]


@pytest.mark.asyncio
async def test_fills_are_keyed_by_account_and_execution_id():
    svc = DatabaseService(db_path=":memory:")
    svc._conn = svc._connect()
    svc._create_tables()
    svc._migrate()

    trade_time = datetime.now(timezone.utc).replace(microsecond=0)
    trade_time_ms = int(trade_time.timestamp() * 1000)
    rows = [
        {
            "execution_id": "SHARED-EXEC",
            "account_id": "DU1",
            "conid": 1,
            "side": "BUY",
            "quantity": 10,
            "price": 10.0,
            "trade_time": trade_time.isoformat(),
            "trade_time_ms": trade_time_ms,
        },
        {
            "execution_id": "SHARED-EXEC",
            "account_id": "DU2",
            "conid": 2,
            "side": "SELL",
            "quantity": 5,
            "price": 20.0,
            "trade_time": trade_time.isoformat(),
            "trade_time_ms": trade_time_ms,
        },
    ]

    assert await svc.upsert_fills(rows) == 2

    stored = svc._fetchall(
        "SELECT account_id, execution_id, conid, quantity "
        "FROM fills ORDER BY account_id"
    )
    assert stored == [
        {"account_id": "DU1", "execution_id": "SHARED-EXEC", "conid": 1, "quantity": 10.0},
        {"account_id": "DU2", "execution_id": "SHARED-EXEC", "conid": 2, "quantity": 5.0},
    ]
