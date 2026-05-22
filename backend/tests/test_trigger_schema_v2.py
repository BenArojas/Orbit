"""
Clean-install schema tests for the watchlists/triggers overhaul.
The new schema ships with no legacy data — these tests pin the
shape down so accidental drift gets caught early.
"""
import asyncio
from pathlib import Path
import pytest

from services.db import DatabaseService


@pytest.fixture
async def db(tmp_path: Path) -> DatabaseService:
    svc = DatabaseService(db_path=str(tmp_path / "test.db"))
    await svc.connect()
    yield svc
    await svc.close()


async def _table_columns(db: DatabaseService, table: str) -> dict[str, str]:
    """Return {column_name: data_type} for the given table."""
    rows = await db.fetch_all(f"PRAGMA table_info({table})")
    return {row["name"]: row["type"] for row in rows}


@pytest.mark.asyncio
async def test_trigger_rules_has_new_columns(db: DatabaseService) -> None:
    cols = await _table_columns(db, "trigger_rules")
    assert "watchlist_name" in cols
    assert "template_id" in cols
    assert "ibkr_mirror_target" in cols
    # Legacy single-condition fields are gone
    for legacy in ("indicator", "condition", "threshold", "news_candle_method",
                   "source_watchlist", "target_watchlist", "auto_expire_days"):
        assert legacy not in cols, f"legacy column {legacy} should not exist"


@pytest.mark.asyncio
async def test_trigger_conditions_table_exists(db: DatabaseService) -> None:
    cols = await _table_columns(db, "trigger_conditions")
    assert {"rule_id", "order_index", "indicator", "condition", "threshold",
            "news_candle_method"}.issubset(cols.keys())


@pytest.mark.asyncio
async def test_trigger_hits_has_new_columns(db: DatabaseService) -> None:
    cols = await _table_columns(db, "trigger_hits")
    assert "condition_values" in cols
    assert "watchlist_name" in cols
    assert "dismissed_at" in cols
    assert "snoozed_until" in cols


@pytest.mark.asyncio
async def test_rule_templates_table_exists(db: DatabaseService) -> None:
    cols = await _table_columns(db, "rule_templates")
    assert {"name", "category", "is_builtin", "default_timeframe",
            "conditions_json"}.issubset(cols.keys())


@pytest.mark.asyncio
async def test_rule_scope_check_constraint(db: DatabaseService) -> None:
    """A rule must have either watchlist_name or conid (or both). Pure NULL fails."""
    with pytest.raises(Exception):
        await db.execute(
            "INSERT INTO trigger_rules (name, timeframe, scan_interval_seconds) "
            "VALUES (?, ?, ?)",
            ("bad rule", "1D", 300),
        )
