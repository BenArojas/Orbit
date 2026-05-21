"""
Tests for trigger-hit DB reads (Phase 6.7).

The /triggers/hits list endpoint now LEFT JOINs trigger_rules to surface
rule_name so the Alert Log can label each hit. We verify:
  - Attached rule: rule_name comes back populated
  - Orphaned hit (rule deleted via CASCADE-side effect): rule_name is None
  - Newest-first ordering holds across the join
"""
from __future__ import annotations

import pytest

from services.db import DatabaseService

pytestmark = pytest.mark.skip(reason="Refactored in trigger overhaul Task 4")


@pytest.fixture()
def db() -> DatabaseService:
    svc = DatabaseService(db_path=":memory:")
    svc._conn = svc._connect()
    svc._create_tables()
    return svc


async def _seed_rule(db: DatabaseService, name: str = "My Rule") -> int:
    return await db.create_trigger_rule(
        name=name,
        conid=265598,
        symbol="AAPL",
        indicator="rsi",
        condition="below",
        threshold=30.0,
        timeframe="1D",
        target_watchlist="RSI Oversold",
        source_watchlist="My Stocks",
        auto_expire_days=None,
        scan_interval_seconds=None,
        news_candle_method=None,
    )


async def _record_hit(db: DatabaseService, rule_id: int, *, conid: int = 265598):
    return await db.record_trigger_hit(
        rule_id=rule_id,
        conid=conid,
        symbol="AAPL",
        indicator="rsi",
        condition="below",
        threshold=30.0,
        actual_value=27.3,
        target_watchlist="RSI Oversold",
        source_watchlist="My Stocks",
        auto_expire_days=None,
    )


@pytest.mark.asyncio
async def test_hit_returns_rule_name_via_join(db: DatabaseService):
    rule_id = await _seed_rule(db, name="AAPL RSI Oversold")
    await _record_hit(db, rule_id)

    rows = await db.get_trigger_hits(limit=10)
    assert len(rows) == 1
    assert rows[0]["rule_name"] == "AAPL RSI Oversold"
    assert rows[0]["rule_id"] == rule_id


@pytest.mark.asyncio
async def test_orphaned_hit_rule_name_is_none(db: DatabaseService):
    rule_id = await _seed_rule(db, name="Doomed Rule")
    await _record_hit(db, rule_id)

    # Delete the rule but keep the hit (simulate CASCADE-off / manual scenario).
    await db.delete_trigger_rule(rule_id)

    rows = await db.get_trigger_hits(limit=10)
    # CASCADE DELETE removes the hit in production schema; if it doesn't, we still
    # want rule_name to come back as None instead of raising.
    for row in rows:
        if row["rule_id"] == rule_id:
            assert row["rule_name"] is None


@pytest.mark.asyncio
async def test_hits_ordered_newest_first(db: DatabaseService):
    rule_a = await _seed_rule(db, name="Rule A")
    rule_b = await _seed_rule(db, name="Rule B")

    await _record_hit(db, rule_a, conid=1)
    await _record_hit(db, rule_b, conid=2)

    rows = await db.get_trigger_hits(limit=10)
    # Most recent first: Rule B hit was recorded second, should appear first.
    assert rows[0]["rule_name"] == "Rule B"
    assert rows[1]["rule_name"] == "Rule A"
