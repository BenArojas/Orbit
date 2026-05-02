"""
Tests for IBKRService.get_conid — Phase 8.9 / Commit C.

Regressions covered:
  - DXY (IBKR index) was 500ing because IBKR's /iserver/secdef/search
    returns a mixed list of dicts + bare strings. Iterating with `.get()`
    on a string raises AttributeError, which bubbled up as an HTTP 500.
  - A no-hint search must still choose the right asset class:
      BTC / ETH   → CRYPTO
      XAUUSD      → CMDTY
      USD.ILS     → CASH
      GLD / USO   → STK ETF, not the first non-stock neighbour

The tests mock IBKRService.search directly so they're hermetic (no
network) and fast.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from exceptions import SymbolNotFoundError
from services.ibkr import IBKRService
from state import IBKRState


def _make_service(search_side_effect) -> IBKRService:
    """Build a bare IBKRService with a mocked search() method."""
    svc = IBKRService.__new__(IBKRService)  # bypass __init__
    # Phase 8 / Task 1.4: get_conid() now writes (symbol, asset_class) to
    # state.conid_asset_class so snapshot() can pre-warm secdef. Tests
    # that exercise get_conid need a real state object.
    svc.state = IBKRState()
    svc.ensure_accounts = AsyncMock(return_value=None)
    svc.search = AsyncMock(side_effect=search_side_effect)
    # Bypass the @cached TTL wrapper so the same svc can run many scenarios.
    svc.get_conid = IBKRService.get_conid.__wrapped__.__get__(svc)
    return svc


# ── Happy path: STK hit first try ─────────────────────────────

@pytest.mark.asyncio
async def test_get_conid_returns_first_stk_match():
    """STK match with a STK section is accepted immediately."""
    async def fake_search(symbol: str, sec_type: str = ""):
        return [
            {
                "conid": 265598,
                "symbol": "AAPL",
                "description": "NASDAQ",
                "sections": [{"secType": "STK"}],
            }
        ]
    svc = _make_service(fake_search)
    assert await svc.get_conid("AAPL") == 265598


# ── Regression: mixed dict/str response must not crash ────────

@pytest.mark.asyncio
async def test_get_conid_survives_string_entries():
    """
    IBKR has been observed to include bare strings (section headers /
    group markers) inside the search response. Before this fix, the
    first such string crashed with:
        AttributeError: 'str' object has no attribute 'get'
    """
    async def fake_search(symbol: str, sec_type: str = ""):
        return [
            "Index",                               # stray header
            None,                                  # stray null
            {"conid": 495759171, "symbol": "DXY"},
        ]
    svc = _make_service(fake_search)
    assert await svc.get_conid("DXY") == 495759171


@pytest.mark.asyncio
async def test_get_conid_survives_non_list_response():
    """If IBKR returns a bare dict (error envelope), don't crash."""
    async def fake_search(symbol: str, sec_type: str = ""):
        return {"error": "bad request"}
    svc = _make_service(fake_search)
    with pytest.raises(SymbolNotFoundError):
        await svc.get_conid("WHATEVER")


# ── No-hint ranking across asset classes ──────────────────────

@pytest.mark.asyncio
async def test_get_conid_prefers_crypto_for_btc():
    async def fake_search(symbol: str, sec_type: str = ""):
        assert sec_type == ""
        return [
            {
                "conid": 479624278,
                "symbol": "BTC",
                "sections": [{"secType": "CRYPTO", "exchange": "PAXOS;"}],
            },
            {
                "conid": 741192224,
                "symbol": "BTC",
                "description": "ARCA",
                "sections": [{"secType": "STK"}],
            },
        ]

    svc = _make_service(fake_search)
    assert await svc.get_conid("BTC") == 479624278


@pytest.mark.asyncio
async def test_get_conid_prefers_cmdty_for_xauusd():
    async def fake_search(symbol: str, sec_type: str = ""):
        assert sec_type == ""
        return [
            {
                "conid": 58430358,
                "symbol": "XAUUSD",
                "description": "OTC",
                "sections": [{"secType": "WAR"}, {"secType": "CFD"}],
            },
            {
                "conid": 69067924,
                "symbol": "XAUUSD",
                "sections": [{"secType": "CMDTY"}],
            },
        ]

    svc = _make_service(fake_search)
    assert await svc.get_conid("XAUUSD") == 69067924


# ── Miss: no candidates → SymbolNotFoundError ─────────────────

@pytest.mark.asyncio
async def test_get_conid_raises_when_search_is_empty():
    async def fake_search(symbol: str, sec_type: str = ""):
        return []
    svc = _make_service(fake_search)
    with pytest.raises(SymbolNotFoundError):
        await svc.get_conid("ZZZZZ")


@pytest.mark.asyncio
async def test_get_conid_treats_zero_conid_as_miss():
    """A conid of 0 is not a valid match."""
    async def fake_search(symbol: str, sec_type: str = ""):
        return [{"conid": 0, "symbol": "GHOST"}]
    svc = _make_service(fake_search)
    with pytest.raises(SymbolNotFoundError):
        await svc.get_conid("GHOST")


# ── Ranking: exact symbol + preferred secType + exchange ──────

@pytest.mark.asyncio
async def test_get_conid_prefers_arca_over_hkfe():
    """GLD-shaped response: HKFE futures first, ARCA ETF second → pick ARCA."""
    async def fake_search(symbol: str, sec_type: str = ""):
        return [
            {
                "conid": 54927692,
                "symbol": "GLD",
                "description": "HKFE",
                "sections": [{"secType": "IND", "exchange": "HKFE;"}],
            },
            {
                "conid": 51529211,
                "symbol": "GLD",
                "description": "ARCA",
                "sections": [
                    {"secType": "STK"},
                    {"secType": "OPT"},
                ],
            },
            {
                "conid": 777714916,
                "symbol": "GLD",
                "description": "VENTURE",
                "sections": [{"secType": "STK"}],
            },
        ]
    svc = _make_service(fake_search)
    assert await svc.get_conid("GLD") == 51529211


@pytest.mark.asyncio
async def test_get_conid_uso_prefers_arca_over_iceeu():
    """USO-shaped: Five Year Swapnote ICEEU first, ARCA ETF second."""
    async def fake_search(symbol: str, sec_type: str = ""):
        return [
            {
                "conid": 16322948,
                "symbol": "USO",
                "description": "ICEEU",
                "sections": [{"secType": "IND", "exchange": "ICEEU;"}],
            },
            {
                "conid": 418893644,
                "symbol": "USO",
                "description": "ARCA",
                "sections": [{"secType": "STK"}, {"secType": "OPT"}],
            },
        ]
    svc = _make_service(fake_search)
    assert await svc.get_conid("USO") == 418893644


@pytest.mark.asyncio
async def test_get_conid_prefers_arca_over_mexi():
    """When both candidates pass the STK filter, US exchange beats MEXI."""
    async def fake_search(symbol: str, sec_type: str = ""):
        return [
            {
                "conid": 999,
                "symbol": "TLT",
                "description": "MEXI",
                "sections": [{"secType": "STK", "exchange": "MEXI;"}],
            },
            {
                "conid": 15547841,
                "symbol": "TLT",
                "description": "NASDAQ",
                "sections": [{"secType": "STK"}],
            },
        ]
    svc = _make_service(fake_search)
    assert await svc.get_conid("TLT") == 15547841


# ── Explicit sec_type hint (Commit D) ─────────────────────────

@pytest.mark.asyncio
async def test_get_conid_with_stk_hint_rejects_non_stk_sections():
    """sec_type='STK' must reject an item whose sections are IND-only."""
    async def fake_search(symbol: str, sec_type: str = ""):
        assert sec_type == "STK"
        return [
            {
                "conid": 54927692,
                "symbol": "GLD",
                "description": "HKFE",
                "sections": [{"secType": "IND", "exchange": "HKFE;"}],
            },
        ]
    svc = _make_service(fake_search)
    with pytest.raises(SymbolNotFoundError):
        await svc.get_conid("GLD", sec_type="STK")


@pytest.mark.asyncio
async def test_get_conid_with_ind_hint_picks_ind_section():
    """sec_type='IND' must pick the IND match, not a stray STK neighbour."""
    async def fake_search(symbol: str, sec_type: str = ""):
        assert sec_type == "IND"
        return [
            {
                "conid": 416996,
                "symbol": "XAU",
                "description": "PHLX",
                "sections": [{"secType": "IND", "exchange": "PHLX;"}],
            },
        ]
    svc = _make_service(fake_search)
    assert await svc.get_conid("XAU", sec_type="IND") == 416996


@pytest.mark.asyncio
async def test_get_conid_explicit_hint_does_not_widen_on_miss():
    calls: list[str] = []

    async def fake_search(symbol: str, sec_type: str = ""):
        calls.append(sec_type)
        return []

    svc = _make_service(fake_search)
    with pytest.raises(SymbolNotFoundError):
        await svc.get_conid("ZZZ", sec_type="IND")
    assert calls == ["IND"]


# ── Non-stock defaults remain resolvable without a hint ───────

@pytest.mark.asyncio
async def test_get_conid_no_hint_prefers_cash_for_currency_pair():
    async def fake_search(symbol: str, sec_type: str = ""):
        assert sec_type == ""
        return [
            {
                "conid": 44495102,
                "symbol": "USD.ILS",
                "description": "United States dollar",
                "sections": [{"secType": "CASH"}],
            },
        ]
    svc = _make_service(fake_search)
    assert await svc.get_conid("USD.ILS") == 44495102


@pytest.mark.asyncio
async def test_get_conid_no_hint_prefers_index_for_spx():
    async def fake_search(symbol: str, sec_type: str = ""):
        assert sec_type == ""
        return [
            {
                "conid": 416904,
                "symbol": "SPX",
                "description": "CBOE",
                "sections": [{"secType": "IND", "exchange": "CBOE;"}],
            },
            {
                "conid": 141513582,
                "symbol": "SPX",
                "description": "VALUE",
                "sections": [{"secType": "STK"}],
            },
        ]
    svc = _make_service(fake_search)
    assert await svc.get_conid("SPX") == 416904
