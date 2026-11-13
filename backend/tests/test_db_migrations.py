from __future__ import annotations

import sqlite3
from contextlib import closing

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
    svc._conn.close()


async def test_numbered_migration_preserves_data_backup_and_restart(tmp_path):
    path = tmp_path / "orbit.db"
    # Keep the old writer open: this data exists in WAL, not just the main file.
    with closing(sqlite3.connect(path)) as legacy:
        legacy.execute("PRAGMA journal_mode=WAL")
        legacy.executescript("""
            CREATE TABLE settings (
                key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT
            );
            INSERT INTO settings VALUES ('theme_mode', 'light', '2026-11-13');
            CREATE TABLE pulse_config (
                position INTEGER PRIMARY KEY, label TEXT NOT NULL,
                resolve TEXT NOT NULL, updated_at TEXT
            );
            INSERT INTO pulse_config VALUES (0, 'BTC', 'BTC.USD', '2026-11-13');
        """)
        svc = DatabaseService(str(path))
        await svc.initialize()
        backup_path = svc.migration_backup_path
        assert backup_path is not None
        with closing(sqlite3.connect(backup_path)) as backup:
            assert backup.execute("PRAGMA user_version").fetchone()[0] == 0
            assert backup.execute("SELECT resolve FROM pulse_config").fetchone()[0] == "BTC.USD"
            assert backup.execute("SELECT value FROM settings").fetchone()[0] == "light"
            assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert await svc.get_setting("theme_mode") == "light"
        assert (await svc.get_pulse_config())[0]["resolve"] == "BTC"
        assert (await svc.fetch_all("PRAGMA user_version"))[0]["user_version"] == 3
        await svc.close()
    reopened = DatabaseService(str(path))
    await reopened.initialize()
    assert reopened.migration_backup_path is None
    assert await reopened.get_setting("theme_mode") == "light"
    await reopened.close()
    # Recovery is performed on a separate copy, never over an active database.
    recovered_path = tmp_path / "recovered.db"
    with closing(sqlite3.connect(backup_path)) as backup:
        with closing(sqlite3.connect(recovered_path)) as recovered:
            backup.backup(recovered)
            assert recovered.execute("SELECT resolve FROM pulse_config").fetchone()[0] == "BTC.USD"
            assert recovered.execute("SELECT value FROM settings").fetchone()[0] == "light"


@pytest.mark.parametrize("failure", ["rehearsal", "application", "future_version"])
async def test_migration_failure_leaves_original_unchanged(tmp_path, monkeypatch, failure):
    path = tmp_path / "orbit.db"
    with closing(sqlite3.connect(path)) as original:
        original.executescript("CREATE TABLE keep (value TEXT); INSERT INTO keep VALUES ('saved');")
        if failure == "future_version":
            original.execute("PRAGMA user_version=99")
        original.commit()
        before = list(original.iterdump())
    baseline = DatabaseService._baseline_schema
    calls = 0

    def fail(conn):
        nonlocal calls
        calls += 1
        baseline(conn)
        conn.execute("UPDATE keep SET value='changed'")
        if failure == "rehearsal" or calls == 2:
            raise sqlite3.OperationalError("Injected migration failure")

    monkeypatch.setattr(DatabaseService, "_baseline_schema", staticmethod(fail))
    svc = DatabaseService(str(path))
    with pytest.raises(sqlite3.DatabaseError):
        await svc.initialize()
    assert svc._conn is None
    with closing(sqlite3.connect(path)) as original:
        assert list(original.iterdump()) == before
        assert original.execute("PRAGMA user_version").fetchone()[0] == (
            99 if failure == "future_version" else 0
        )
    if failure != "future_version":
        backups = list((tmp_path / "orbit.db.backups").glob("*.db"))
        assert len(backups) == 1
        with closing(sqlite3.connect(backups[0])) as backup:
            assert list(backup.iterdump()) == before
