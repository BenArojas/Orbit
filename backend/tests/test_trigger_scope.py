"""
Verifies that scope expansion turns a watchlist-scoped rule into a
list of {conid, symbol} targets, and that a per-stock rule targets
only its own conid.
"""
import pytest
from unittest.mock import AsyncMock

from services.scanner import ScannerService


@pytest.mark.asyncio
async def test_watchlist_scoped_rule_expands_to_members():
    db = AsyncMock()
    ibkr = AsyncMock()
    ibkr.get_watchlist_members = AsyncMock(return_value=[
        {"conid": 1, "symbol": "AAPL"},
        {"conid": 2, "symbol": "MSFT"},
        {"conid": 3, "symbol": "NVDA"},
    ])
    scanner = ScannerService(db=db, ibkr=ibkr)
    rule = {"id": 1, "watchlist_name": "Swing Setups", "conid": None}
    targets = await scanner._scope_targets(rule)
    assert {t["conid"] for t in targets} == {1, 2, 3}


@pytest.mark.asyncio
async def test_per_stock_rule_targets_only_its_conid():
    scanner = ScannerService(db=AsyncMock(), ibkr=AsyncMock())
    rule = {"id": 2, "watchlist_name": None, "conid": 7, "symbol": "TSLA"}
    targets = await scanner._scope_targets(rule)
    assert targets == [{"conid": 7, "symbol": "TSLA"}]


@pytest.mark.asyncio
async def test_watchlist_scoped_rule_returns_empty_when_watchlist_missing():
    """A watchlist-scoped rule whose watchlist has no members (or is missing
    altogether) yields zero targets — the evaluator must not crash."""
    ibkr = AsyncMock()
    ibkr.get_watchlist_members = AsyncMock(return_value=[])
    scanner = ScannerService(ibkr=ibkr, db=AsyncMock())
    rule = {"id": 1, "watchlist_name": "nonexistent", "conid": None}
    targets = await scanner._scope_targets(rule)
    assert targets == []
