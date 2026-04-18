"""
Tests for IBKRService.get_conid — Phase 8.9 / Commit C.

Regressions covered:
  - DXY (IBKR index) was 500ing because IBKR's /iserver/secdef/search
    returns a mixed list of dicts + bare strings. Iterating with `.get()`
    on a string raises AttributeError, which bubbled up as an HTTP 500.
  - GLD/USO/SLV/TLT (ETFs) can come back empty under sec_type="STK" —
    we now fall back to a sec_type-less search so the pulse bar can
    still resolve them.

The tests mock IBKRService.search directly so they're hermetic (no
network) and fast.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from exceptions import SymbolNotFoundError
from services.ibkr import IBKRService


def _make_service(search_side_effect) -> IBKRService:
    """Build a bare IBKRService with a mocked search() method."""
    svc = IBKRService.__new__(IBKRService)  # bypass __init__
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


# ── Fallback: STK empty → retry without sec_type ──────────────

@pytest.mark.asyncio
async def test_get_conid_falls_back_to_unfiltered_search():
    """
    STK search returns nothing for an ETF like GLD. We must retry
    without sec_type so the pulse bar can resolve it.
    """
    calls: list[str] = []

    async def fake_search(symbol: str, sec_type: str = ""):
        calls.append(sec_type)
        if sec_type == "STK":
            return []
        return [{"conid": 12345, "symbol": "GLD"}]

    svc = _make_service(fake_search)
    assert await svc.get_conid("GLD") == 12345
    # Both searches were attempted, STK first.
    assert calls == ["STK", ""]


@pytest.mark.asyncio
async def test_get_conid_fallback_also_survives_string_entries():
    """Mixed types on the fallback path shouldn't crash either."""
    async def fake_search(symbol: str, sec_type: str = ""):
        if sec_type == "STK":
            return []
        return ["Index", {"conid": 42, "symbol": "TLT"}]

    svc = _make_service(fake_search)
    assert await svc.get_conid("TLT") == 42


# ── Miss: both searches empty → SymbolNotFoundError ───────────

@pytest.mark.asyncio
async def test_get_conid_raises_when_both_searches_empty():
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


# ── Exchange scoring (Commit D) ───────────────────────────────
#
# Regression: a bare STK search for "GLD" returns the Hong Kong Gold
# Futures contract first and the SPDR Gold Shares ETF on ARCA second.
# Without exchange scoring we'd resolve GLD to the futures contract
# and show junk prices on the pulse bar.

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
    # Default path (sec_type="") uses "STK" as the primary hint and
    # requires a STK section — HKFE (IND-only) must be rejected.
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
        # Only one candidate, and it's IND-only. With a STK hint we
        # should NOT fall back to unfiltered — the caller said STK.
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
    """
    When the caller passed a hint, a primary miss must raise rather than
    silently falling back to an unfiltered search. The fallback is only
    for the no-hint path.
    """
    calls: list[str] = []

    async def fake_search(symbol: str, sec_type: str = ""):
        calls.append(sec_type)
        return []

    svc = _make_service(fake_search)
    with pytest.raises(SymbolNotFoundError):
        await svc.get_conid("ZZZ", sec_type="IND")
    # Only the IND call — no widen-to-unfiltered attempt.
    assert calls == ["IND"]


# ── No-hint fallback still works for non-STK instruments ─────

@pytest.mark.asyncio
async def test_get_conid_no_hint_falls_back_for_currency_pair():
    """USD.ILS has no STK match — fallback to unfiltered must succeed."""
    async def fake_search(symbol: str, sec_type: str = ""):
        if sec_type == "STK":
            return []
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
