from __future__ import annotations

import asyncio
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models import SetupPlanCreate
from routers.triggers import _setup_plan_scope
from services.db import DatabaseService
from services.scanner import ScannerService


@pytest.fixture
async def db(tmp_path: Path):
    service = DatabaseService(db_path=str(tmp_path / "plans.db"))
    await service.initialize()
    try:
        yield service
    finally:
        await service.close()


async def _auto_plan(db: DatabaseService, *, account: str = "DU100", mode: str = "paper") -> int:
    return await db.create_setup_plan(
        owner_account_id=account,
        account_mode=mode,
        conid=265598,
        symbol="AAPL",
        setup_type="pullback",
        waiting_intention="Wait for price to return to support.",
        monitoring_mode="automatic",
        invalidation_reference="Below the prior swing low.",
        invalidation_condition=None,
        timeframe="1D",
        scan_interval_seconds=300,
        conditions=[{"indicator": "close", "condition": "above", "threshold": 100.0}],
    )


async def _evaluation(
    db, plan, outcome="matched", *, plan_revision=None, rule_revision=None, checked_at=None
):
    rule = plan["rule"]
    checked_at = checked_at or datetime.now(timezone.utc).isoformat()
    return await db.record_setup_plan_evaluation(
        plan_id=plan["id"],
        owner_account_id=plan["account_id"],
        account_mode=plan["account_mode"],
        plan_revision=plan_revision if plan_revision is not None else plan["revision"],
        rule_id=rule["id"],
        rule_revision=rule_revision if rule_revision is not None else rule["revision"],
        outcome=outcome,
        checked_at=checked_at,
        evidence_at=checked_at,
        condition_values=[{
            "indicator": "close", "condition": "above", "threshold": 100.0,
            "actual_value": 110.0, "news_candle_method": None,
        }],
    )


@pytest.mark.asyncio
async def test_atomic_create_manual_rulelessness_and_account_isolation(db):
    manual_id = await db.create_setup_plan(
        owner_account_id="U100", account_mode="live", conid=265598, symbol="AAPL",
        setup_type="breakout", waiting_intention="Review the range break.",
        monitoring_mode="manual", invalidation_reference="Below the range.",
        invalidation_condition=None, timeframe=None, scan_interval_seconds=None, conditions=[],
    )
    manual = await db.get_setup_plan(manual_id, "U100", "live")
    assert manual["rule"] is None

    plan_id = await _auto_plan(db)
    other_id = await _auto_plan(db, account="DU200")
    assert await db.get_setup_plan(plan_id, "DU200", "paper") is None
    assert await db.get_setup_plan(plan_id, "DU100", "live") is None
    assert not await db.update_setup_plan(
        plan_id, "DU200", "paper", {"waiting_intention": "Cross-account edit."}
    )
    assert not await db.archive_setup_plan(plan_id, "DU100", "live")
    assert not await db.review_setup_plan_events(plan_id, "DU200", "paper", [1])
    assert (await db.get_setup_plan(plan_id, "DU100", "paper"))["waiting_intention"] == "Wait for price to return to support."
    assert [p["id"] for p in await db.list_setup_plans("DU100", "paper")] == [plan_id]
    assert other_id != plan_id
    assert await db.get_trigger_rules() == []

    with pytest.raises(KeyError):
        await db.create_setup_plan(
            owner_account_id="DU300", account_mode="paper", conid=265598, symbol="AAPL",
            setup_type="pullback", waiting_intention="Wait.", monitoring_mode="automatic",
            invalidation_reference=None, invalidation_condition=None, timeframe="1D",
            scan_interval_seconds=300, conditions=[{}],
        )
    assert await db.fetch_all("SELECT id FROM setup_plans WHERE owner_account_id='DU300'") == []
    assert await db.fetch_all("SELECT id FROM trigger_rules WHERE owner_account_id='DU300'") == []


@pytest.mark.asyncio
async def test_manual_and_automatic_plans_survive_restart_and_day_change(tmp_path: Path):
    path = str(tmp_path / "restart.db")
    first = DatabaseService(db_path=path)
    await first.initialize()
    manual_id = await first.create_setup_plan(
        owner_account_id="DU100", account_mode="paper", conid=265598, symbol="AAPL",
        setup_type="pullback", waiting_intention="Review support manually.",
        monitoring_mode="manual", invalidation_reference=None,
        invalidation_condition=None, timeframe=None, scan_interval_seconds=None, conditions=[],
    )
    automatic_id = await _auto_plan(first)
    await first.close()

    second = DatabaseService(db_path=path)
    await second.initialize()
    manual = await second.get_setup_plan(manual_id, "DU100", "paper")
    automatic = await second.get_setup_plan(automatic_id, "DU100", "paper")
    assert manual["lifecycle"] == "active" and manual["rule"] is None
    assert automatic["lifecycle"] == "active" and automatic["rule"]["conditions"]
    first_day = await _evaluation(second, automatic, checked_at="2026-10-07T16:00:00+00:00")
    next_day = await _evaluation(second, automatic, checked_at="2026-10-08T16:00:00+00:00")
    assert first_day["hit_id"] is not None and next_day["hit_id"] != first_day["hit_id"]
    await second.close()

    restarted = DatabaseService(db_path=path)
    await restarted.initialize()
    saved = await restarted.get_setup_plan(automatic_id, "DU100", "paper")
    assert saved["lifecycle"] == "active"
    assert len(saved["evaluations"]) == 2 and len(saved["hits"]) == 2
    assert saved["unreviewed_match_count"] == 2
    await restarted.close()


@pytest.mark.asyncio
async def test_scanner_persists_matches_and_unavailable_checks(db):
    plan_id = await _auto_plan(db)
    plan = await db.get_setup_plan(plan_id, "DU100", "paper")
    bars = [
        {"t": 1_791_403_200_000, "o": 108, "h": 112, "l": 107, "c": 110, "v": 1000},
        {"t": 1_791_489_600_000, "o": 109, "h": 113, "l": 108, "c": 111, "v": 1200},
    ]

    class IBKR:
        state = SimpleNamespace(selected_account="DU100")

        async def brokerage_accounts(self):
            return [{"accountId": "DU100"}]

        async def history(self, *_args, **_kwargs):
            return {"data": bars}

    scanner = ScannerService(IBKR(), db)
    scope = {"account_id": "DU100", "account_mode": "paper"}
    await scanner._evaluate_setup_plan(plan, scope)
    bars[:] = bars[:1]
    await scanner._evaluate_setup_plan(plan, scope)

    detail = await db.get_setup_plan(plan_id, "DU100", "paper")
    assert [e["outcome"] for e in detail["evaluations"]] == ["unavailable", "matched"]
    assert detail["evaluations"][1]["evidence_at"] is not None
    assert detail["hits"][0]["rule_revision"] == 1
    assert detail["unreviewed_match_count"] == 1


@pytest.mark.asyncio
async def test_monitoring_health_goes_overdue_without_clearing_match(db):
    plan_id = await _auto_plan(db)
    plan = await db.get_setup_plan(plan_id, "DU100", "paper")
    await _evaluation(db, plan, checked_at="2026-01-01T00:00:00+00:00")

    detail = await db.get_setup_plan(plan_id, "DU100", "paper")
    assert detail["monitoring_health"] == "overdue"
    assert detail["monitoring_due_at"] == "2026-01-01T00:05:00+00:00"
    assert detail["latest_evaluation"]["outcome"] == "matched"
    assert detail["unreviewed_match_count"] == 1


@pytest.mark.asyncio
async def test_unreviewed_match_is_returned_outside_bounded_evaluation_history(db):
    plan_id = await _auto_plan(db)
    plan = await db.get_setup_plan(plan_id, "DU100", "paper")
    match_id = (await _evaluation(db, plan))["evaluation_id"]
    for _ in range(205):
        await _evaluation(db, plan, "not_matched")

    detail = await db.get_setup_plan(plan_id, "DU100", "paper")
    assert len(detail["evaluations"]) == 200
    assert all(evaluation["id"] != match_id for evaluation in detail["evaluations"])
    assert [evaluation["id"] for evaluation in detail["unreviewed_matches"]] == [match_id]
    assert detail["unreviewed_match_count"] == 1
    assert await db.review_setup_plan_events(plan_id, "DU100", "paper", [match_id])
    assert (await db.get_setup_plan(plan_id, "DU100", "paper"))["unreviewed_match_count"] == 0


@pytest.mark.asyncio
async def test_plan_only_revision_hides_old_match_and_rejects_stale_review(db):
    plan_id = await _auto_plan(db)
    original = await db.get_setup_plan(plan_id, "DU100", "paper")
    match = await _evaluation(db, original)

    assert await db.update_setup_plan(
        plan_id, "DU100", "paper", {"waiting_intention": "Wait for a new retest."}
    )
    revised = await db.get_setup_plan(plan_id, "DU100", "paper")
    assert revised["revision"] == original["revision"] + 1
    assert revised["rule"]["revision"] == original["rule"]["revision"]
    assert revised["latest_evaluation"] is None
    assert revised["monitoring_health"] == "not_checked"
    assert revised["unreviewed_match_count"] == 0
    assert revised["evaluations"][0]["plan_revision"] == original["revision"]
    with pytest.raises(ValueError, match="current waiting or invalidation matches"):
        await db.review_setup_plan_events(plan_id, "DU100", "paper", [match["evaluation_id"]])

    current_match = await _evaluation(db, revised)
    current = await db.get_setup_plan(plan_id, "DU100", "paper")
    assert current["unreviewed_match_count"] == 1
    assert await db.review_setup_plan_events(
        plan_id, "DU100", "paper", [current_match["evaluation_id"]]
    )
    assert (await db.get_setup_plan(plan_id, "DU100", "paper"))["unreviewed_match_count"] == 0


@pytest.mark.asyncio
async def test_waiting_and_invalidation_conditions_are_evaluated_separately(db):
    plan_id = await db.create_setup_plan(
        owner_account_id="DU100", account_mode="paper", conid=265598, symbol="AAPL",
        setup_type="breakout", waiting_intention="Wait above 120.",
        monitoring_mode="automatic", invalidation_reference="Below 90.",
        invalidation_condition={"indicator": "close", "condition": "below", "threshold": 90.0},
        timeframe="1D", scan_interval_seconds=300,
        conditions=[{"indicator": "close", "condition": "above", "threshold": 120.0}],
    )
    close = 130.0
    bars = [
        {"t": 1_791_403_200_000, "o": close, "h": close + 1, "l": close - 1, "c": close, "v": 1000},
        {"t": 1_791_489_600_000, "o": close, "h": close + 1, "l": close - 1, "c": close, "v": 1200},
    ]

    class IBKR:
        state = SimpleNamespace(selected_account="DU100")

        async def brokerage_accounts(self):
            return [{"accountId": "DU100"}]

        async def history(self, *_args, **_kwargs):
            return {"data": bars}

    scanner = ScannerService(IBKR(), db)
    plan = await db.get_setup_plan(plan_id, "DU100", "paper")
    scope = {"account_id": "DU100", "account_mode": "paper"}
    await scanner._evaluate_setup_plan(plan, scope)
    close = 80.0
    bars[:] = [
        {"t": 1_791_403_200_000, "o": close, "h": close + 1, "l": close - 1, "c": close, "v": 1000},
        {"t": 1_791_489_600_000, "o": close, "h": close + 1, "l": close - 1, "c": close, "v": 1200},
    ]
    await scanner._evaluate_setup_plan(plan, scope)

    detail = await db.get_setup_plan(plan_id, "DU100", "paper")
    at_80, at_130 = detail["evaluations"]
    assert (at_130["outcome"], at_130["invalidation_outcome"]) == ("matched", "not_matched")
    assert (at_80["outcome"], at_80["invalidation_outcome"]) == ("not_matched", "matched")
    assert [value["condition_role"] for value in at_80["condition_values"]] == [
        "waiting", "invalidation",
    ]
    assert {
        hit["condition_values"][0]["condition_role"] for hit in detail["hits"]
    } == {"waiting", "invalidation"}
    assert len(detail["hits"]) == 2
    assert detail["unreviewed_match_count"] == 2
    assert await db.review_setup_plan_events(
        plan_id, "DU100", "paper", [at_80["id"]]
    )
    reviewed = await db.get_setup_plan(plan_id, "DU100", "paper")
    assert reviewed["unreviewed_match_count"] == 1


@pytest.mark.asyncio
async def test_scope_comes_from_provider_selection_and_request_cannot_set_owner():
    ibkr = SimpleNamespace(
        state=SimpleNamespace(selected_account="DU100"),
        brokerage_accounts=AsyncMock(return_value=[{"accountId": "DU100"}]),
    )
    assert await _setup_plan_scope(ibkr) == ("DU100", "paper")
    ibkr.state.selected_account = "U999"
    with pytest.raises(HTTPException) as exc:
        await _setup_plan_scope(ibkr)
    assert exc.value.status_code == 503

    request = {
        "conid": 265598, "setup_type": "pullback", "waiting_intention": "Wait.",
        "monitoring_mode": "manual", "owner_account_id": "U999",
    }
    with pytest.raises(ValidationError):
        SetupPlanCreate(**request)
    with pytest.raises(ValidationError):
        SetupPlanCreate(
            conid=265598, setup_type="pullback", waiting_intention="   ",
            monitoring_mode="manual",
        )
    with pytest.raises(ValidationError):
        SetupPlanCreate(
            conid=265598, setup_type="pullback", waiting_intention="Wait.",
            monitoring_mode="automatic", timeframe="2h", conditions=[{
                "indicator": "close", "condition": "above", "threshold": 100,
            }],
        )
    with pytest.raises(ValidationError):
        SetupPlanCreate(
            conid=265598, setup_type="pullback", waiting_intention="Wait.",
            monitoring_mode="automatic", conditions=[{
                "indicator": "new_detector", "condition": "above", "threshold": 100,
            }],
        )


@pytest.mark.asyncio
async def test_revision_fence_event_ack_race_and_archive_preserve_history(db):
    plan_id = await _auto_plan(db)
    plan = await db.get_setup_plan(plan_id, "DU100", "paper")
    matched = await _evaluation(db, plan)
    assert matched["hit_id"] is not None
    await _evaluation(db, plan, "unavailable")
    assert (await db.get_setup_plan(plan_id, "DU100", "paper"))["unreviewed_match_count"] == 1

    started, release = asyncio.Event(), asyncio.Event()
    async def acknowledge_captured_event():
        started.set()
        await release.wait()
        return await db.review_setup_plan_events(plan_id, "DU100", "paper", [matched["evaluation_id"]])

    ack = asyncio.create_task(acknowledge_captured_event())
    await started.wait()
    detail = await db.get_setup_plan(plan_id, "DU100", "paper")
    during_ack = await _evaluation(db, detail)
    release.set()
    assert await ack is True
    detail = await db.get_setup_plan(plan_id, "DU100", "paper")
    assert detail["unreviewed_match_count"] == 1
    assert next(e for e in detail["evaluations"] if e["id"] == during_ack["evaluation_id"])["reviewed_at"] is None

    old = detail
    assert await db.update_setup_plan(
        plan_id, "DU100", "paper",
        {"timeframe": "4h", "conditions": [{"indicator": "close", "condition": "above", "threshold": 105.0}]},
    )
    fenced = await db.record_setup_plan_evaluation(
        plan_id=plan_id, owner_account_id="DU100", account_mode="paper",
        plan_revision=old["revision"], rule_id=old["rule"]["id"],
        rule_revision=old["rule"]["revision"], outcome="matched",
        checked_at=datetime.now(timezone.utc).isoformat(), evidence_at=None,
        condition_values=[],
    )
    assert fenced is None
    current = await db.get_setup_plan(plan_id, "DU100", "paper")
    assert current["monitoring_health"] == "not_checked"
    assert current["unreviewed_match_count"] == 0
    assert current["evaluations"][-1]["rule_revision"] == 1

    updated_event = await _evaluation(db, current)
    assert updated_event["hit_id"] is not None
    assert updated_event["hit_id"] != matched["hit_id"]
    assert await db.archive_setup_plan(plan_id, "DU100", "paper")
    archived = await db.get_setup_plan(plan_id, "DU100", "paper")
    assert archived["lifecycle"] == "archived"
    assert archived["rule"]["enabled"] is False
    assert len(archived["hits"]) == 2
    assert len(archived["evaluations"]) == 4
    with pytest.raises(PermissionError):
        await db.delete_trigger_rule(archived["rule"]["id"])
    assert await db.get_active_setup_plan_rules("DU100", "paper") == []


@pytest.mark.asyncio
async def test_repeatable_upgrade_preserves_legacy_records_and_does_not_attribute_hits(tmp_path):
    path = str(tmp_path / "legacy.db")
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE trigger_rules (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
          timeframe TEXT NOT NULL DEFAULT '1D', scan_interval_seconds INTEGER NOT NULL DEFAULT 300,
          watchlist_name TEXT, conid INTEGER, symbol TEXT, template_id INTEGER,
          ibkr_mirror_target TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE trigger_conditions (
          id INTEGER PRIMARY KEY, rule_id INTEGER NOT NULL, order_index INTEGER NOT NULL DEFAULT 0,
          indicator TEXT NOT NULL, condition TEXT NOT NULL, threshold REAL, news_candle_method TEXT);
        CREATE TABLE trigger_hits (
          id INTEGER PRIMARY KEY, rule_id INTEGER NOT NULL, conid INTEGER NOT NULL, symbol TEXT NOT NULL,
          triggered_at TEXT, dedup_key TEXT NOT NULL UNIQUE, condition_values TEXT NOT NULL,
          watchlist_name TEXT, dismissed_at TEXT, snoozed_until TEXT, source_watchlist TEXT,
          target_watchlist TEXT, moved_back INTEGER NOT NULL DEFAULT 0, expires_at TEXT);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
        CREATE TABLE chart_drawings (
          id INTEGER PRIMARY KEY, conid INTEGER NOT NULL, kind TEXT NOT NULL,
          anchors_json TEXT NOT NULL, style_json TEXT, created_at TEXT NOT NULL, updated_at TEXT);
        CREATE TABLE locked_fibonacci_drawings (
          id INTEGER PRIMARY KEY, conid INTEGER NOT NULL, timeframe TEXT NOT NULL,
          tool_type TEXT NOT NULL, swing_high_price REAL NOT NULL, swing_high_time INTEGER NOT NULL,
          swing_low_price REAL NOT NULL, swing_low_time INTEGER NOT NULL, direction TEXT NOT NULL,
          user_note TEXT, locked_at TEXT);
        INSERT INTO trigger_rules VALUES (7, 'Legacy', 1, '1D', 300, NULL, 265598, 'AAPL', NULL, NULL, 'a', 'a');
        INSERT INTO trigger_conditions VALUES (9, 7, 0, 'rsi', 'below', 30, NULL);
        INSERT INTO trigger_hits VALUES (11, 7, 265598, 'AAPL', 'old-time', '7:265598:old', '[]', NULL, NULL, NULL, NULL, NULL, 0, NULL);
        INSERT INTO settings VALUES ('chart.theme', 'saved', 'old-time');
        INSERT INTO chart_drawings VALUES (13, 265598, 'trend_line', '[]', '{}', 'old-time', NULL);
        INSERT INTO locked_fibonacci_drawings VALUES (17, 265598, '1D', 'retracement', 200, 20, 100, 10, 'up', 'saved fib', 'old-time');
    """)
    conn.commit()
    conn.close()

    service = DatabaseService(db_path=path)
    await service.initialize()
    service._migrate()
    assert await service.fetch_all("SELECT id, name FROM trigger_rules") == [{"id": 7, "name": "Legacy"}]
    assert await service.fetch_all("SELECT id, indicator, threshold FROM trigger_conditions") == [
        {"id": 9, "indicator": "rsi", "threshold": 30.0}
    ]
    hit = (await service.fetch_all("SELECT id, dedup_key, rule_revision FROM trigger_hits"))[0]
    assert hit == {"id": 11, "dedup_key": "7:265598:old", "rule_revision": None}
    assert await service.fetch_all("SELECT key, value FROM settings") == [{"key": "chart.theme", "value": "saved"}]
    assert await service.fetch_all("SELECT id, kind FROM chart_drawings") == [{"id": 13, "kind": "trend_line"}]
    assert await service.fetch_all("SELECT id, timeframe, tool_type, user_note FROM locked_fibonacci_drawings") == [
        {"id": 17, "timeframe": "1D", "tool_type": "retracement", "user_note": "saved fib"}
    ]
    assert await service.fetch_all("SELECT rule_id, revision FROM trigger_rule_revisions") == [
        {"rule_id": 7, "revision": 1}
    ]
    assert await service.fetch_all("SELECT id FROM setup_plans") == []
    await service.close()
