"""
Tests for IBKR watchlist manipulation (Phase 6.3) and scanner integration (Phase 6.4).

Covers:
  - IBKRService._extract_rows_from_raw — both API response shapes
  - IBKRService.resolve_watchlist_id — found / not found
  - IBKRService.add_to_watchlist — new conid / already present
  - IBKRService.remove_from_watchlist — exists / not present
  - IBKRService.move_between_watchlists — happy path / missing watchlist
  - ScannerService._record_hit — watchlist move wired + IBKR error resilience
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from exceptions import IBKRRequestError
from services.ibkr import IBKRService
from services.scanner import ScannerService


# ── Helpers ──────────────────────────────────────────────────


def make_ibkr() -> IBKRService:
    """Return an IBKRService with a mocked HTTP client."""
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = MagicMock()
    svc.state.accounts_fetched = True  # skip ensure_accounts
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


# ── _extract_rows_from_raw ────────────────────────────────────


class TestExtractRowsFromRaw:
    def test_newer_api_rows_key(self):
        raw = {"id": "123", "rows": [{"C": 265598}, {"H": "Tech"}, {"C": 12345}]}
        rows = IBKRService._extract_rows_from_raw(raw)
        assert rows == [{"C": 265598}, {"H": "Tech"}, {"C": 12345}]

    def test_older_api_data_instruments(self):
        raw = {
            "id": "123",
            "name": "My List",
            "data": {
                "instruments": [
                    {"conid": 265598, "name": "AAPL"},
                    {"conid": 12345, "name": "SPY"},
                ]
            },
        }
        rows = IBKRService._extract_rows_from_raw(raw)
        assert {"C": 265598} in rows
        assert {"C": 12345} in rows
        assert len(rows) == 2

    def test_empty_instruments(self):
        raw = {"data": {"instruments": []}}
        rows = IBKRService._extract_rows_from_raw(raw)
        assert rows == []

    def test_unknown_shape_returns_empty(self):
        raw = {"something": "unexpected"}
        rows = IBKRService._extract_rows_from_raw(raw)
        assert rows == []

    def test_skips_instruments_without_conid(self):
        raw = {
            "data": {
                "instruments": [
                    {"name": "no conid here"},
                    {"conid": 999, "name": "SPY"},
                ]
            }
        }
        rows = IBKRService._extract_rows_from_raw(raw)
        assert rows == [{"C": 999}]


# ── resolve_watchlist_id ──────────────────────────────────────


class TestResolveWatchlistId:
    @pytest.fixture
    def ibkr(self):
        return make_ibkr()

    @pytest.mark.asyncio
    async def test_found(self, ibkr):
        ibkr.get_watchlists = AsyncMock(
            return_value=[
                {"id": "111", "name": "Swing Trades"},
                {"id": "222", "name": "Watchlist A"},
            ]
        )
        result = await ibkr.resolve_watchlist_id("Watchlist A")
        assert result == "222"

    @pytest.mark.asyncio
    async def test_not_found_returns_none(self, ibkr):
        ibkr.get_watchlists = AsyncMock(
            return_value=[{"id": "111", "name": "Other List"}]
        )
        result = await ibkr.resolve_watchlist_id("Missing Watchlist")
        assert result is None

    @pytest.mark.asyncio
    async def test_empty_watchlists_returns_none(self, ibkr):
        ibkr.get_watchlists = AsyncMock(return_value=[])
        result = await ibkr.resolve_watchlist_id("Any Name")
        assert result is None


# ── add_to_watchlist ──────────────────────────────────────────


class TestAddToWatchlist:
    @pytest.fixture
    def ibkr(self):
        return make_ibkr()

    @pytest.mark.asyncio
    async def test_adds_new_conid(self, ibkr):
        ibkr.get_watchlist_raw = AsyncMock(
            return_value={"data": {"instruments": [{"conid": 11111}]}}
        )
        ibkr._overwrite_watchlist = AsyncMock()

        added = await ibkr.add_to_watchlist("123", "My List", 99999)

        assert added is True
        ibkr._overwrite_watchlist.assert_awaited_once()
        call_args = ibkr._overwrite_watchlist.call_args[0]
        rows = call_args[2]
        conids_in_rows = [r["C"] for r in rows if "C" in r]
        assert 99999 in conids_in_rows
        assert 11111 in conids_in_rows

    @pytest.mark.asyncio
    async def test_skips_if_already_present(self, ibkr):
        ibkr.get_watchlist_raw = AsyncMock(
            return_value={"data": {"instruments": [{"conid": 265598}]}}
        )
        ibkr._overwrite_watchlist = AsyncMock()

        added = await ibkr.add_to_watchlist("123", "My List", 265598)

        assert added is False
        ibkr._overwrite_watchlist.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_preserves_header_rows(self, ibkr):
        ibkr.get_watchlist_raw = AsyncMock(
            return_value={"rows": [{"H": "Tech"}, {"C": 11111}]}
        )
        ibkr._overwrite_watchlist = AsyncMock()

        await ibkr.add_to_watchlist("123", "My List", 99999)

        rows = ibkr._overwrite_watchlist.call_args[0][2]
        assert {"H": "Tech"} in rows


# ── remove_from_watchlist ─────────────────────────────────────


class TestRemoveFromWatchlist:
    @pytest.fixture
    def ibkr(self):
        return make_ibkr()

    @pytest.mark.asyncio
    async def test_removes_existing_conid(self, ibkr):
        ibkr.get_watchlist_raw = AsyncMock(
            return_value={"rows": [{"C": 265598}, {"C": 12345}]}
        )
        ibkr._overwrite_watchlist = AsyncMock()

        removed = await ibkr.remove_from_watchlist("123", "My List", 265598)

        assert removed is True
        rows = ibkr._overwrite_watchlist.call_args[0][2]
        assert {"C": 265598} not in rows
        assert {"C": 12345} in rows

    @pytest.mark.asyncio
    async def test_returns_false_when_not_found(self, ibkr):
        ibkr.get_watchlist_raw = AsyncMock(
            return_value={"rows": [{"C": 11111}]}
        )
        ibkr._overwrite_watchlist = AsyncMock()

        removed = await ibkr.remove_from_watchlist("123", "My List", 99999)

        assert removed is False
        ibkr._overwrite_watchlist.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_preserves_header_rows(self, ibkr):
        ibkr.get_watchlist_raw = AsyncMock(
            return_value={"rows": [{"H": "Section"}, {"C": 265598}]}
        )
        ibkr._overwrite_watchlist = AsyncMock()

        await ibkr.remove_from_watchlist("123", "My List", 265598)

        rows = ibkr._overwrite_watchlist.call_args[0][2]
        assert {"H": "Section"} in rows
        assert {"C": 265598} not in rows


# ── move_between_watchlists ───────────────────────────────────


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
        assert "Missing Source" in exc_info.value.detail
        ibkr.add_to_watchlist.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_raises_when_target_not_found(self, ibkr):
        # source found, target not found
        ibkr.resolve_watchlist_id = AsyncMock(side_effect=["source_id", None])

        with pytest.raises(IBKRRequestError) as exc_info:
            await ibkr.move_between_watchlists(265598, "Source List", "Missing Target")
        assert "Missing Target" in exc_info.value.detail
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


# ── _overwrite_watchlist cache invalidation ───────────────────


class TestOverwriteWatchlist:
    @pytest.mark.asyncio
    async def test_invalidates_cache_after_overwrite(self):
        ibkr = make_ibkr()
        ibkr._request = AsyncMock(return_value={"id": "new123"})

        with patch("services.ibkr.cache") as mock_cache:
            mock_cache.delete = AsyncMock()
            await ibkr._overwrite_watchlist("old123", "My List", [{"C": 111}])
            mock_cache.delete.assert_awaited_once_with("get_watchlists")

    @pytest.mark.asyncio
    async def test_delete_failure_is_non_fatal(self):
        """DELETE before POST can fail (e.g. already gone) without crashing."""
        ibkr = make_ibkr()
        delete_called = []
        post_called = []

        async def fake_request(method, endpoint, **kwargs):
            if method == "DELETE":
                delete_called.append(True)
                raise IBKRRequestError(status_code=404, detail="not found")
            post_called.append(True)
            return {}

        ibkr._request = fake_request

        with patch("services.ibkr.cache") as mock_cache:
            mock_cache.delete = AsyncMock()
            # Should not raise even though DELETE failed
            await ibkr._overwrite_watchlist("123", "My List", [{"C": 111}])

        assert delete_called  # DELETE was attempted
        assert post_called    # POST still happened


# ── Scanner _record_hit integration (Phase 6.4) ──────────────


class TestRecordHitWithWatchlistMove:
    def _make_rule(self):
        return {
            "id": 1,
            "conid": 265598,
            "symbol": "AAPL",
            "indicator": "rsi",
            "condition": "below",
            "threshold": 30.0,
            "target_watchlist": "RSI Hits",
            "source_watchlist": "My Stocks",
            "auto_expire_days": None,
        }

    @pytest.mark.asyncio
    async def test_move_called_on_new_hit(self):
        ibkr = MagicMock()
        ibkr.move_between_watchlists = AsyncMock(return_value=True)
        db = MagicMock()
        db.record_trigger_hit = AsyncMock(return_value=42)  # new hit_id

        scanner = make_scanner(ibkr=ibkr, db=db)
        rule = self._make_rule()

        result = await scanner._record_hit(rule, actual_value=28.5)

        assert result is True
        ibkr.move_between_watchlists.assert_awaited_once_with(
            conid=265598,
            source_name="My Stocks",
            target_name="RSI Hits",
        )

    @pytest.mark.asyncio
    async def test_move_not_called_on_dedup(self):
        ibkr = MagicMock()
        ibkr.move_between_watchlists = AsyncMock()
        db = MagicMock()
        db.record_trigger_hit = AsyncMock(return_value=None)  # deduped

        scanner = make_scanner(ibkr=ibkr, db=db)
        rule = self._make_rule()

        result = await scanner._record_hit(rule, actual_value=28.5)

        assert result is False
        ibkr.move_between_watchlists.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ibkr_move_failure_does_not_crash_scanner(self):
        """Even if IBKR move fails, _record_hit returns True (hit was saved)."""
        ibkr = MagicMock()
        ibkr.move_between_watchlists = AsyncMock(
            side_effect=IBKRRequestError(status_code=404, detail="watchlist missing")
        )
        db = MagicMock()
        db.record_trigger_hit = AsyncMock(return_value=42)

        scanner = make_scanner(ibkr=ibkr, db=db)
        rule = self._make_rule()

        # Must not raise — IBKR error is swallowed in scanner
        result = await scanner._record_hit(rule, actual_value=28.5)

        assert result is True  # hit still recorded

    @pytest.mark.asyncio
    async def test_callback_fires_after_move(self):
        """on_trigger_fired fires even when the watchlist move fails."""
        fired = []

        async def callback(rule, hit_id, value):
            fired.append((rule["id"], hit_id, value))

        ibkr = MagicMock()
        ibkr.move_between_watchlists = AsyncMock(
            side_effect=Exception("IBKR is down")
        )
        db = MagicMock()
        db.record_trigger_hit = AsyncMock(return_value=7)

        scanner = make_scanner(ibkr=ibkr, db=db)
        scanner.on_trigger_fired = callback
        rule = self._make_rule()

        await scanner._record_hit(rule, actual_value=25.0)

        assert len(fired) == 1
        assert fired[0] == (1, 7, 25.0)
