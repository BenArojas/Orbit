import pytest
from pathlib import Path

from services.db import DatabaseService


@pytest.fixture
async def db(tmp_path: Path):
    svc = DatabaseService(db_path=str(tmp_path / "t.db"))
    await svc.connect()
    yield svc
    await svc.close()


async def _seed_hit(svc, *, conid: int, symbol: str, suffix: str) -> int:
    rule_id = await svc.create_trigger_rule(
        name=f"r-{suffix}",
        watchlist_name=None,
        conid=conid,
        symbol=symbol,
        template_id=None,
        ibkr_mirror_target=None,
        timeframe="1D",
        scan_interval_seconds=300,
        enabled=True,
        conditions=[{"indicator": "rsi", "condition": "below", "threshold": 30}],
    )
    return await svc.record_trigger_hit(
        rule_id=rule_id,
        conid=conid,
        symbol=symbol,
        dedup_key=f"{rule_id}:{conid}:{suffix}:1D",
        condition_values=[
            {"indicator": "rsi", "condition": "below", "threshold": 30, "actual_value": 25}
        ],
        watchlist_name=None,
    )


@pytest.mark.asyncio
async def test_active_tags_returns_grouped_by_conid(db):
    await _seed_hit(db, conid=1, symbol="AAPL", suffix="a")
    await _seed_hit(db, conid=2, symbol="NVDA", suffix="b")
    tags = await db.get_active_tags([1, 2, 3])
    assert len(tags[1]) == 1
    assert len(tags[2]) == 1
    assert tags[3] == []


@pytest.mark.asyncio
async def test_dismissed_hit_excluded_from_tags(db):
    hit_id = await _seed_hit(db, conid=1, symbol="AAPL", suffix="a")
    await db.dismiss_trigger_hit(hit_id)
    tags = await db.get_active_tags([1])
    assert tags[1] == []


@pytest.mark.asyncio
async def test_snoozed_hit_excluded_from_tags(db):
    hit_id = await _seed_hit(db, conid=1, symbol="AAPL", suffix="a")
    await db.snooze_trigger_hit(hit_id, minutes=60)
    tags = await db.get_active_tags([1])
    assert tags[1] == []


@pytest.mark.asyncio
async def test_active_tags_with_empty_conid_list_returns_empty_dict(db):
    tags = await db.get_active_tags([])
    assert tags == {}
