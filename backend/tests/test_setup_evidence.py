from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from models import IndicatorRequest, SetupPlanCreate, TriggerConditionPayload, TriggerRuleCreate
from routers.indicators import compute_indicators
from services import db as db_module, scanner as scanner_module
from services.db import DatabaseService
from services.scanner import ScannerService
from services.setup_evidence import evidence_is_current


@pytest.mark.parametrize("timeframe,now,evidence,outside_rth,current", [
    ("30m", "2026-10-08T14:15:00Z", "2026-10-08T14:00:00Z", True, True),
    ("30m", "2026-10-08T14:15:00Z", "2020-10-08T14:00:00Z", True, False),
    ("30m", "2026-10-08T14:15:00Z", None, True, False),
    ("30m", "2026-10-08T14:15:00Z", "2026-10-08T15:00:00Z", True, False),
    ("30m", "2026-10-10T14:15:00Z", "2026-10-09T23:30:00Z", True, True),
    ("30m", "2026-10-10T14:15:00Z", "2026-10-09T19:30:00Z", True, False),
    ("30m", "2026-10-10T14:15:00Z", "2026-10-09T19:30:00Z", False, True),
    ("1D", "2026-10-12T07:30:00Z", "2026-10-09T00:00:00Z", True, True),
    ("1D", "2026-10-12T12:00:00Z", "2026-10-09T00:00:00Z", True, False),
    ("1D", "2026-11-26T16:00:00Z", "2026-11-25T00:00:00Z", True, True),
    ("30m", "2026-11-27T23:00:00Z", "2026-11-27T21:30:00Z", True, True),
    ("1h", "2026-11-02T16:30:00Z", "2026-11-02T16:00:00Z", True, True),
    ("1W", "2026-10-10T14:00:00Z", "2026-10-05T00:00:00Z", True, True),
    ("1M", "2026-10-10T14:00:00Z", "2026-10-01T00:00:00Z", True, True),
])
def test_session_policy_certifies_latest_available_not_completed_only(timeframe, now, evidence, outside_rth, current):
    assert evidence_is_current(evidence, timeframe, datetime.fromisoformat(now.replace("Z", "+00:00")), outside_rth=outside_rth) is current


@pytest.mark.asyncio
async def test_fresh_checks_reject_stale_or_unverifiable_evidence_and_retain_review_history(tmp_path, monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 8, 14, 15, tzinfo=timezone.utc)
    monkeypatch.setattr(scanner_module, "datetime", Clock)
    monkeypatch.setattr(db_module, "datetime", Clock)
    db = DatabaseService(db_path=str(tmp_path / "freshness.db"))
    await db.initialize()
    try:
        payload = SetupPlanCreate(conid=265598, setup_type="pullback", waiting_intention="Review price above 100", monitoring_mode="automatic", timeframe="30m", conditions=[{"indicator": "close", "condition": "above", "threshold": 100}])
        body = payload.model_dump()
        plan_id = await db.create_setup_plan(owner_account_id="DU100", account_mode="paper", symbol="AAPL", **body)
        plan = await db.get_setup_plan(plan_id, "DU100", "paper")
        stamp = int(datetime(2026, 10, 8, 14, tzinfo=timezone.utc).timestamp() * 1000)
        bars = [{"t": stamp - 1800000, "o": 105, "h": 112, "l": 104, "c": 110, "v": 10}, {"t": stamp, "o": 110, "h": 114, "l": 109, "c": 112, "v": 20}]
        ibkr = SimpleNamespace(state=SimpleNamespace(selected_account="DU100"), brokerage_accounts=AsyncMock(return_value=[{"accountId": "DU100"}]), history_fresh=AsyncMock(return_value={"data": bars}), security_definitions=AsyncMock(return_value=[{"conid": 265598, "ticker": "AAPL", "assetClass": "STK", "listingExchange": "NASDAQ", "countryCode": "US", "currency": "USD", "isUS": True}]))
        scanner = ScannerService(ibkr, db)
        scope = {"account_id": "DU100", "account_mode": "paper"}
        await scanner._evaluate_setup_plan(plan, scope)
        valid = await db.get_setup_plan(plan_id, "DU100", "paper")
        assert valid["monitoring_health"] == "healthy"
        assert valid["unreviewed_match_count"] == 1
        ibkr.history_fresh.assert_awaited_with(265598, period="1w", bar="30min", outside_rth=True)
        preserved = valid["unreviewed_matches"][0]

        for bar in bars:
            bar["t"] = 1577836800000 + (bar["t"] - stamp)
        await scanner._evaluate_setup_plan(plan, scope)
        stale = await db.get_setup_plan(plan_id, "DU100", "paper")
        assert stale["latest_evaluation"]["checked_at"].startswith("2026-10-08")
        assert stale["latest_evaluation"]["evidence_at"].startswith("2020-01-01")
        assert stale["latest_evaluation"]["outcome"] == "unavailable"
        assert stale["monitoring_health"] == "unavailable"
        assert stale["unreviewed_matches"] == [preserved]
        assert len(stale["hits"]) == 1

        ibkr.security_definitions.return_value = []
        await scanner._evaluate_setup_plan(plan, scope)
        unknown = await db.get_setup_plan(plan_id, "DU100", "paper")
        assert unknown["latest_evaluation"]["failure_code"] == "evidence_unverifiable"
        assert unknown["unreviewed_matches"] == [preserved]
        assert await db.get_setup_plan(plan_id, "DU100", "live") is None
        assert await db.review_setup_plan_events(plan_id, "DU100", "paper", [preserved["id"]])
        assert (await db.get_setup_plan(plan_id, "DU100", "paper"))["unreviewed_match_count"] == 0
    finally:
        await db.close()


@pytest.mark.asyncio
async def test_30m_history_and_persistence_preserve_native_candle_boundaries_and_utc_instants(tmp_path):
    db = DatabaseService(db_path=str(tmp_path / "30m.db"))
    await db.initialize()
    try:
        bars = [{"t": 1791464400000 + index * 1800000, "o": 100, "h": 102, "l": 99, "c": 101, "v": 10 + index} for index in range(4)]
        ibkr = SimpleNamespace(history_fresh=AsyncMock(return_value={"data": bars}))
        request = IndicatorRequest(conid=265598, timeframe="30m", indicators=[], history_period="1y")
        response = await compute_indicators(request, ibkr, db)
        ibkr.history_fresh.assert_awaited_once_with(265598, period="1w", bar="30min")
        assert [c.time for c in response.candles] == [bar["t"] // 1000 for bar in bars]
        assert [c.volume for c in response.candles] == [10, 11, 12, 13]
        payload = SetupPlanCreate(conid=265598, setup_type="breakout", waiting_intention="Review", monitoring_mode="automatic", timeframe="30m", conditions=[{"indicator": "close", "condition": "above", "threshold": 100}])
        plan_id = await db.create_setup_plan(owner_account_id="DU100", account_mode="paper", symbol="AAPL", **payload.model_dump())
        await db.execute("UPDATE setup_plans SET created_at=?, updated_at=? WHERE id=?", ("2026-10-08 12:00:00", "2026-10-08T16:30:00+03:00", plan_id))
        await db.close()
        await db.initialize()
        assert (await db.get_setup_plan(plan_id, "DU100", "paper"))["updated_at"] == "2026-10-08T16:30:00+03:00"
        assert await db.archive_setup_plan(plan_id, "DU100", "paper")
        detail = await db.get_setup_plan(plan_id, "DU100", "paper")
        assert detail["rule"]["timeframe"] == "30m"
        assert detail["created_at"] == "2026-10-08T12:00:00+00:00"
        stored = await db.fetch_all("SELECT created_at FROM setup_plans WHERE id=?", (plan_id,))
        assert stored[0]["created_at"] == "2026-10-08 12:00:00"
        assert datetime.fromisoformat(detail["archived_at"]).tzinfo is not None
        assert TriggerRuleCreate(name="Price", conid=265598, timeframe="30m", conditions=payload.conditions).timeframe == "30m"
        with pytest.raises(ValidationError):
            IndicatorRequest(conid=265598, timeframe="2h", indicators=[])
        with pytest.raises(ValidationError):
            TriggerRuleCreate(name="Bad", conid=265598, timeframe="2h", conditions=payload.conditions)
    finally:
        await db.close()


@pytest.mark.parametrize("indicator", ["rsi", "close", "ema_21"])
def test_numeric_indicators_cannot_use_fires(indicator):
    with pytest.raises(ValidationError):
        TriggerRuleCreate(name="Invalid operator", conid=265598, conditions=[{"indicator": indicator, "condition": "fires", "threshold": 30}])
