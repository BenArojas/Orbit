import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from services.db import DatabaseService
from services.scanner import ScannerService


@pytest.mark.asyncio
async def test_quick_alert_stays_quiet_until_valid_clear_and_preserves_newer_alerts(tmp_path):
    path = str(tmp_path / "alerts.db")
    db = DatabaseService(path)
    await db.initialize()
    rule_id = await db.create_trigger_rule(
        name="Price alert", watchlist_name=None, conid=451, symbol="TEST",
        template_id=None, ibkr_mirror_target=None, timeframe="30m",
        scan_interval_seconds=60, enabled=True,
        conditions=[{"indicator": "close", "condition": "above", "threshold": 100}],
    )
    rule = (await db.get_trigger_rules())[0]
    old_id = await db.record_trigger_hit(
        rule_id=rule_id, conid=451, symbol="TEST", dedup_key="legacy-day",
        condition_values=[], rule_revision=1, watchlist_name=None,
    )
    scanner = ScannerService(ibkr=MagicMock(), db=db)
    scanner._fetch_evaluation_bar = AsyncMock(return_value={"close": 110})
    try:
        assert await scanner._evaluate_one(rule) == 0
        await db.dismiss_trigger_hit(old_id)
        assert await db.get_trigger_hits() == []
        await db.close()
        db = DatabaseService(path)
        await db.initialize()
        scanner = ScannerService(ibkr=MagicMock(), db=db)
        scanner._fetch_evaluation_bar = AsyncMock(return_value={"close": 110})
        assert await scanner._evaluate_one(rule) == 0
        for missing in (None, {"close": None}, {"close": float("nan")}):
            scanner._fetch_evaluation_bar.return_value = missing
            assert await scanner._evaluate_one(rule) == 0
            scanner._fetch_evaluation_bar.return_value = {"close": 110}
            assert await scanner._evaluate_one(rule) == 0
        scanner._fetch_evaluation_bar.return_value = {"close": 99}
        assert await scanner._evaluate_one(rule) == 0
        scanner._fetch_evaluation_bar.return_value = {"close": 110}
        assert sorted(await asyncio.gather(scanner._evaluate_one(rule), scanner._evaluate_one(rule))) == [0, 1]
        active = await db.get_trigger_hits()
        assert len(active) == 1
        current_id = active[0]["id"]
        await db.dismiss_trigger_hit(current_id)
        assert await db.get_trigger_hits() == []
        assert all(hit["dismissed_at"] for hit in await db.get_trigger_hits(status="all"))
        assert await scanner._evaluate_one(rule) == 0
        scanner._fetch_evaluation_bar.return_value = {"close": 99}
        await scanner._evaluate_one(rule)
        scanner._fetch_evaluation_bar.return_value = {"close": 110}
        assert await scanner._evaluate_one(rule) == 1
        await db.dismiss_trigger_hit(current_id)
        assert len(await db.get_trigger_hits()) == 1

        # Watchlist mirroring keeps its original daily deduplication.
        mirror = {**rule, "ibkr_mirror_target": "Destination", "watchlist_name": "Source"}
        scanner.ibkr.move_between_watchlists = AsyncMock()
        target = {"conid": 452, "symbol": "OTHER"}
        assert await scanner._record_hit(mirror, target, []) is True
        assert await scanner._record_hit(mirror, target, []) is False
        scanner.ibkr.move_between_watchlists.assert_awaited_once()
    finally:
        await db.close()
