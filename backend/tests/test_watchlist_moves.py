from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from exceptions import IBKRConnectionError, IBKRRequestError
from services.ibkr import IBKRService
from services.scanner import ScannerService


def make_ibkr() -> IBKRService:
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = MagicMock()
    svc.state.accounts_fetched = True
    svc.http = AsyncMock()
    svc._tickle_task = None
    svc._ws_task = None
    return svc


def make_scanner(ibkr=None, db=None) -> ScannerService:
    if ibkr is None:
        ibkr = MagicMock()
    if db is None:
        db = MagicMock()
    return ScannerService(ibkr=ibkr, db=db)


class TestMoveBetweenWatchlists:
    @pytest.fixture
    def ibkr(self):
        svc = make_ibkr()
        svc.add_to_watchlist = AsyncMock(return_value=True)
        svc.remove_from_watchlist = AsyncMock(return_value=True)
        return svc

    @pytest.mark.asyncio
    async def test_happy_path(self, ibkr):
        ibkr.resolve_watchlist_id = AsyncMock(side_effect=["source_id", "target_id"])

        result = await ibkr.move_between_watchlists(265598, "Source List", "Target List")

        assert result is True
        ibkr.add_to_watchlist.assert_awaited_once_with("target_id", "Target List", 265598)
        ibkr.remove_from_watchlist.assert_awaited_once_with("source_id", "Source List", 265598)

    @pytest.mark.asyncio
    async def test_raises_when_source_not_found(self, ibkr):
        ibkr.resolve_watchlist_id = AsyncMock(return_value=None)

        with pytest.raises(IBKRRequestError) as exc_info:
            await ibkr.move_between_watchlists(265598, "Missing Source", "Target List")
        assert "Missing Source" in exc_info.value.message
        ibkr.add_to_watchlist.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_raises_when_target_not_found(self, ibkr):
        ibkr.resolve_watchlist_id = AsyncMock(side_effect=["source_id", None])

        with pytest.raises(IBKRRequestError) as exc_info:
            await ibkr.move_between_watchlists(265598, "Source List", "Missing Target")
        assert "Missing Target" in exc_info.value.message
        ibkr.add_to_watchlist.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_add_happens_before_remove(self, ibkr):
        """Stock must be in target before being removed from source."""
        call_order = []
        ibkr.resolve_watchlist_id = AsyncMock(side_effect=["source_id", "target_id"])
        ibkr.add_to_watchlist = AsyncMock(
            side_effect=lambda *a, **k: call_order.append("add") or True
        )
        ibkr.remove_from_watchlist = AsyncMock(
            side_effect=lambda *a, **k: call_order.append("remove") or True
        )

        await ibkr.move_between_watchlists(265598, "Source List", "Target List")

        assert call_order == ["add", "remove"]


class TestRecordHitWithWatchlistMove:
    def _make_rule(self, *, mirror: str | None = "RSI Hits"):
        return {
            "id": 1,
            "conid": 265598,
            "symbol": "AAPL",
            "watchlist_name": "My Stocks",
            "ibkr_mirror_target": mirror,
            "timeframe": "1D",
            "conditions": [
                {"indicator": "rsi", "condition": "below", "threshold": 30.0},
            ],
        }

    def _target(self) -> dict:
        return {"conid": 265598, "symbol": "AAPL"}

    def _values(self) -> list[dict]:
        return [{
            "indicator": "rsi",
            "condition": "below",
            "threshold": 30.0,
            "actual_value": 28.5,
            "news_candle_method": None,
        }]

    @pytest.mark.asyncio
    async def test_move_called_on_new_hit_with_mirror(self):
        ibkr = MagicMock()
        ibkr.move_between_watchlists = AsyncMock(return_value=True)
        db = MagicMock()
        db.record_trigger_hit = AsyncMock(return_value=42)
        db.get_watchlist_config = AsyncMock(return_value=None)

        scanner = make_scanner(ibkr=ibkr, db=db)
        result = await scanner._record_hit(self._make_rule(), self._target(), self._values())

        assert result is True
        ibkr.move_between_watchlists.assert_awaited_once_with(
            conid=265598, source_name="My Stocks", target_name="RSI Hits",
        )

    @pytest.mark.asyncio
    async def test_no_move_when_mirror_target_absent(self):
        ibkr = MagicMock()
        ibkr.move_between_watchlists = AsyncMock()
        db = MagicMock()
        db.record_trigger_hit = AsyncMock(return_value=42)
        db.get_watchlist_config = AsyncMock(return_value=None)

        scanner = make_scanner(ibkr=ibkr, db=db)
        result = await scanner._record_hit(self._make_rule(mirror=None), self._target(), self._values())

        assert result is True
        ibkr.move_between_watchlists.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_move_not_called_on_dedup(self):
        ibkr = MagicMock()
        ibkr.move_between_watchlists = AsyncMock()
        db = MagicMock()
        db.record_trigger_hit = AsyncMock(return_value=None)  # deduped
        db.get_watchlist_config = AsyncMock(return_value=None)

        scanner = make_scanner(ibkr=ibkr, db=db)
        result = await scanner._record_hit(self._make_rule(), self._target(), self._values())

        assert result is False
        ibkr.move_between_watchlists.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ibkr_move_failure_does_not_crash_scanner(self):
        """IBKR move failure must not prevent the hit from being saved."""
        ibkr = MagicMock()
        ibkr.move_between_watchlists = AsyncMock(
            side_effect=IBKRRequestError(status_code=404, detail="watchlist missing")
        )
        db = MagicMock()
        db.record_trigger_hit = AsyncMock(return_value=42)
        db.get_watchlist_config = AsyncMock(return_value=None)

        scanner = make_scanner(ibkr=ibkr, db=db)
        result = await scanner._record_hit(self._make_rule(), self._target(), self._values())

        assert result is True

    @pytest.mark.asyncio
    async def test_callback_fires_with_new_payload(self):
        fired: list[tuple] = []

        async def callback(hit_id, rule, target, values):
            fired.append((hit_id, rule["id"], target["conid"], values))

        ibkr = MagicMock()
        ibkr.move_between_watchlists = AsyncMock(
            side_effect=IBKRConnectionError("IBKR is down")
        )
        db = MagicMock()
        db.record_trigger_hit = AsyncMock(return_value=7)
        db.get_watchlist_config = AsyncMock(return_value=None)

        scanner = make_scanner(ibkr=ibkr, db=db)
        scanner.on_trigger_fired = callback
        values = self._values()

        await scanner._record_hit(self._make_rule(), self._target(), values)

        assert len(fired) == 1
        hit_id, rule_id, conid, payload_values = fired[0]
        assert (hit_id, rule_id, conid) == (7, 1, 265598)
        assert payload_values == values
