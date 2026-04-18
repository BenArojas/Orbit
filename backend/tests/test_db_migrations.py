from __future__ import annotations

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
