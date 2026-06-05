"""
Tests for trigger-hit DB reads under the multi-condition schema.

The /triggers/hits list endpoint LEFT JOINs trigger_rules to surface
rule_name so the Alert Log can label each hit. We verify:
  - Attached rule: rule_name comes back populated
  - condition_values JSON roundtrips through the column as a list
  - Newest-first ordering holds across the join
"""
from __future__ import annotations

import pytest

from services.db import DatabaseService


@pytest.fixture()
def db() -> DatabaseService:
    svc = DatabaseService(db_path=":memory:")
    svc._conn = svc._connect()
    svc._create_tables()
    return svc


async def _seed_rule(db: DatabaseService, name: str = "My Rule") -> int:
    return await db.create_trigger_rule(
        name=name,
        watchlist_name=None,
        conid=265598,
        symbol="AAPL",
        template_id=None,
        ibkr_mirror_target=None,
        timeframe="1D",
        scan_interval_seconds=300,
        enabled=True,
        conditions=[
            {"indicator": "rsi", "condition": "below", "threshold": 30.0},
        ],
    )


async def _record_hit(
    db: DatabaseService,
    rule_id: int,
    *,
    conid: int = 265598,
    dedup_suffix: str = "",
):
    return await db.record_trigger_hit(
        rule_id=rule_id,
        conid=conid,
        symbol="AAPL",
        dedup_key=f"{rule_id}:{conid}:2026-05-21:1D{dedup_suffix}",
        condition_values=[
            {
                "indicator": "rsi",
                "condition": "below",
                "threshold": 30.0,
                "actual_value": 27.3,
                "news_candle_method": None,
            },
        ],
        watchlist_name=None,
        source_watchlist=None,
        target_watchlist=None,
        expires_at=None,
    )


@pytest.mark.asyncio
async def test_hit_returns_rule_name_via_join(db: DatabaseService):
    rule_id = await _seed_rule(db, name="AAPL RSI Oversold")
    hit_id = await _record_hit(db, rule_id)
    assert hit_id is not None

    rows = await db.get_trigger_hits(limit=10)
    assert len(rows) == 1
    assert rows[0]["rule_name"] == "AAPL RSI Oversold"
    assert rows[0]["rule_id"] == rule_id


@pytest.mark.asyncio
async def test_condition_values_roundtrip(db: DatabaseService):
    rule_id = await _seed_rule(db)
    await _record_hit(db, rule_id)

    rows = await db.get_trigger_hits(limit=10)
    assert len(rows) == 1
    values = rows[0]["condition_values"]
    assert isinstance(values, list)
    assert len(values) == 1
    assert values[0]["indicator"] == "rsi"
    assert values[0]["actual_value"] == 27.3


@pytest.mark.asyncio
async def test_hits_ordered_newest_first(db: DatabaseService):
    rule_a = await _seed_rule(db, name="Rule A")
    rule_b = await _seed_rule(db, name="Rule B")

    await _record_hit(db, rule_a, conid=1)
    await _record_hit(db, rule_b, conid=2)

    rows = await db.get_trigger_hits(limit=10)
    # Most recent first: Rule B's hit was inserted second.
    assert rows[0]["rule_name"] == "Rule B"
    assert rows[1]["rule_name"] == "Rule A"
