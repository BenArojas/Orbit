import pytest
from pathlib import Path

from services.db import DatabaseService


@pytest.fixture
async def db(tmp_path: Path):
    svc = DatabaseService(db_path=str(tmp_path / "t.db"))
    await svc.connect()
    rule_id = await svc.create_trigger_rule(
        name="x",
        watchlist_name=None,
        conid=1,
        symbol="AAPL",
        template_id=None,
        ibkr_mirror_target=None,
        timeframe="1D",
        scan_interval_seconds=300,
        enabled=True,
        conditions=[{"indicator": "rsi", "condition": "below", "threshold": 30}],
    )
    hit_id = await svc.record_trigger_hit(
        rule_id=rule_id,
        conid=1,
        symbol="AAPL",
        dedup_key=f"{rule_id}:1:2026-05-20:1D",
        condition_values=[
            {"indicator": "rsi", "condition": "below", "threshold": 30, "actual_value": 25}
        ],
        watchlist_name=None,
    )
    yield svc, hit_id
    await svc.close()


@pytest.mark.asyncio
async def test_dismissed_hit_disappears_from_active(db):
    svc, hit_id = db
    before = await svc.get_trigger_hits(status="active")
    assert any(h["id"] == hit_id for h in before)
    assert await svc.dismiss_trigger_hit(hit_id) is True
    after = await svc.get_trigger_hits(status="active")
    assert all(h["id"] != hit_id for h in after)
    dismissed = await svc.get_trigger_hits(status="dismissed")
    assert any(h["id"] == hit_id for h in dismissed)


@pytest.mark.asyncio
async def test_snoozed_hit_returns_to_active_after_expiry(db):
    svc, hit_id = db
    assert await svc.snooze_trigger_hit(hit_id, minutes=1) is True
    snoozed = await svc.get_trigger_hits(status="snoozed")
    assert any(h["id"] == hit_id for h in snoozed)
    # Backdate snoozed_until so "active" reflects expiry
    await svc.execute(
        "UPDATE trigger_hits SET snoozed_until=datetime('now','-1 minutes') WHERE id=?",
        (hit_id,),
    )
    active = await svc.get_trigger_hits(status="active")
    assert any(h["id"] == hit_id for h in active)


@pytest.mark.asyncio
async def test_dismiss_nonexistent_hit_returns_false(db):
    svc, _ = db
    assert await svc.dismiss_trigger_hit(99999) is False


@pytest.mark.asyncio
async def test_snooze_nonexistent_hit_returns_false(db):
    svc, _ = db
    assert await svc.snooze_trigger_hit(99999, minutes=10) is False
