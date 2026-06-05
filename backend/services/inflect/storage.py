"""Inflect local storage stats and raw-payload cleanup."""

from __future__ import annotations

import os
from datetime import datetime
from zoneinfo import ZoneInfo

from constants.inflect import TRADING_DAY_TZ
from models.inflect import (
    InflectStorageCleanupResponse,
    InflectStorageStatsResponse,
)
from services.db import DatabaseService

_TABLES = (
    "fills",
    "basis_backfill_queue",
    "basis_lots",
    "basis_audit",
    "journal_entries",
)


async def storage_stats(db: DatabaseService) -> InflectStorageStatsResponse:
    counts: dict[str, int] = {}
    for table in _TABLES:
        row = (await db.fetch_all(f"SELECT COUNT(*) AS n FROM {table}"))[0]
        counts[table] = int(row["n"])
    raw_row = (await db.fetch_all(
        "SELECT COALESCE(SUM(LENGTH(raw_json)), 0) AS n FROM fills"
    ))[0]
    file_size = os.path.getsize(db.db_path) if db.db_path != ":memory:" else 0
    return InflectStorageStatsResponse(
        file_size_bytes=file_size,
        table_counts=counts,
        raw_json_bytes=int(raw_row["n"] or 0),
    )


async def cleanup_storage(
    db: DatabaseService, *, before_date: str, confirm: bool
) -> InflectStorageCleanupResponse:
    if not confirm:
        raise ValueError("confirm is required for storage cleanup")

    cutoff_ms = _date_start_ms(before_date)
    count_row = (await db.fetch_all(
        """
        SELECT COUNT(*) AS n
        FROM fills
        WHERE raw_json IS NOT NULL
          AND trade_time_ms IS NOT NULL
          AND trade_time_ms < ?
        """,
        (cutoff_ms,),
    ))[0]
    cleared = int(count_row["n"])
    await db.execute(
        """
        UPDATE fills
        SET raw_json = NULL
        WHERE raw_json IS NOT NULL
          AND trade_time_ms IS NOT NULL
          AND trade_time_ms < ?
        """,
        (cutoff_ms,),
    )
    return InflectStorageCleanupResponse(
        before_date=before_date,
        cleared_raw_payloads=cleared,
        deleted_rows=0,
        export_recommended=True,
        message="Raw payloads cleared. Export before cleanup is recommended.",
    )


def _date_start_ms(value: str) -> int:
    parsed = datetime.strptime(value, "%Y-%m-%d").replace(
        tzinfo=ZoneInfo(TRADING_DAY_TZ)
    )
    return int(parsed.timestamp() * 1000)

