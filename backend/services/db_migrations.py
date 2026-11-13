"""Forward-only SQLite migrations, rehearsed on a copy before touching data."""

from __future__ import annotations

import os
import sqlite3
import tempfile
from collections.abc import Callable
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

Migration = Callable[[sqlite3.Connection], None]

def local_watchlists(conn: sqlite3.Connection) -> None:
    execute_schema(conn, """
        CREATE TABLE orbit_watchlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            position INTEGER NOT NULL
        );
        CREATE TABLE orbit_watchlist_rows (
            watchlist_id TEXT NOT NULL REFERENCES orbit_watchlists(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            data_json TEXT NOT NULL,
            PRIMARY KEY (watchlist_id, position)
        );
    """)


def broker_records(conn: sqlite3.Connection) -> None:
    execute_schema(conn, """
        CREATE TABLE broker_executions (
            execution_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL
        );
        CREATE TABLE broker_commissions (
            execution_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL
        );
    """)


def execute_schema(conn: sqlite3.Connection, script: str) -> None:
    """Unlike executescript(), preserve the caller's transaction."""
    statement = ""
    for line in script.splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            conn.execute(statement)
            statement = ""
    if statement.strip():
        raise ValueError("Incomplete migration SQL")


def _check(conn: sqlite3.Connection) -> None:
    if [row[0] for row in conn.execute("PRAGMA integrity_check")] != ["ok"]:
        raise sqlite3.DatabaseError("Migration integrity check failed")
    if conn.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise sqlite3.IntegrityError("Migration foreign-key check failed")


def _apply(conn: sqlite3.Connection, migrations: tuple[Migration, ...]) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations "
        "(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
    )
    for number, migrate in enumerate(migrations, start=1):
        if number <= version:
            continue
        migrate(conn)
        if not conn.in_transaction:
            raise sqlite3.DatabaseError("Migration unexpectedly committed its transaction")
        conn.execute(
            "INSERT INTO schema_migrations VALUES (?, ?)",
            (number, datetime.now(timezone.utc).isoformat()),
        )
        conn.execute(f"PRAGMA user_version = {number}")
    _check(conn)


def migrate_database(
    conn: sqlite3.Connection, db_path: str, migrations: tuple[Migration, ...]
) -> Path | None:
    """Keep a private SQLite backup, rehearse, then migrate atomically.

    A write reservation prevents another process changing the source between
    the backup and application. SQLite backup includes committed WAL contents.
    Failures roll back the source; the backup remains available for recovery.
    """
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > len(migrations):
        raise sqlite3.DatabaseError("Database was created by a newer Orbit version")
    if version == len(migrations):
        return None

    backup_path: Path | None = None
    with tempfile.TemporaryDirectory(prefix="orbit-migration-") as temporary:
        copy_path = Path(temporary) / "validation.db"
        if db_path == ":memory:":
            with closing(sqlite3.connect(copy_path)) as copy:
                conn.backup(copy)
        conn.execute("BEGIN IMMEDIATE")
        try:
            # Another startup may have finished migrating while we waited.
            locked_version = conn.execute("PRAGMA user_version").fetchone()[0]
            if locked_version > len(migrations):
                raise sqlite3.DatabaseError("Database was created by a newer Orbit version")
            if locked_version == len(migrations):
                conn.rollback()
                return None
            if db_path != ":memory:":
                source = Path(db_path).resolve()
                directory = source.parent / f"{source.name}.backups"
                directory.mkdir(mode=0o700, exist_ok=True)
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
                backup_path = directory / f"v{locked_version}-{stamp}-{uuid4().hex}.db"
                fd = os.open(backup_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(fd)
                with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as reader:
                    with closing(sqlite3.connect(backup_path)) as backup:
                        reader.backup(backup)
                        _check(backup)
                        with closing(sqlite3.connect(copy_path)) as copy:
                            backup.backup(copy)
            with closing(sqlite3.connect(copy_path)) as copy:
                copy.row_factory = sqlite3.Row
                copy.execute("PRAGMA foreign_keys=ON")
                copy.execute("BEGIN IMMEDIATE")
                _apply(copy, migrations)
                copy.commit()
                _check(copy)
            _apply(conn, migrations)
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
    return backup_path
