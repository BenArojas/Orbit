"""
Tests for bundled `/market/quotes` snapshot fan-out (Phase 8 / Task 2.1).

`IBKRService.snapshot()` now chunks any list of >50 conids into ≤50-sized
chunks and dispatches each chunk as one IBKR /iserver/marketdata/snapshot
HTTP call. Cold conids are pre-flighted (Task 1.3) before the real call.

Three behaviors under test:
  1. 13 conids in one request → 1 IBKR snapshot call (after pre-flights).
  2. Mix of warmed + cold conids → pre-flight only fires for cold.
  3. 75 conids → 2 IBKR snapshot calls (50 + 25).
"""

import asyncio
from unittest.mock import MagicMock

import pytest

from constants import DEFAULT_QUOTE_FIELDS_STR
from services.ibkr import IBKRService
from state import IBKRState


# ── Helpers ──────────────────────────────────────────────────────────


def _make_svc(preflight_delay_ms: int = 5):
    """Build an `IBKRService` with `_request` mocked.

    The mock yields once (via asyncio.sleep) and returns a list of
    snapshot rows shaped the way IBKR really replies (one row per
    requested conid). Returns (svc, calls) where `calls` is a list of
    (method, endpoint, params) tuples for assertion.
    """
    svc = IBKRService.__new__(IBKRService)
    svc.base_url = "https://localhost:5000/v1/api"
    svc.state = IBKRState()
    svc.http = MagicMock()
    svc._tickle_task = None
    svc._ws_task = None

    async def _noop_accounts():
        return None

    svc.ensure_accounts = _noop_accounts  # type: ignore[method-assign]

    calls: list[tuple[str, str, dict]] = []

    async def fake_request(method: str, endpoint: str, **kwargs):
        params = kwargs.get("params") or {}
        calls.append((method, endpoint, dict(params)))
        # Yield so the event loop can schedule any concurrent callers.
        await asyncio.sleep(0.001)
        if "snapshot" in endpoint:
            conids = [
                int(c) for c in str(params.get("conids", "")).split(",") if c
            ]
            return [{"conid": c, "31": "100.00"} for c in conids]
        return []

    svc._request = fake_request  # type: ignore[method-assign]

    import services.ibkr as ibkr_mod
    svc._test_orig_delay = ibkr_mod.PREFLIGHT_DELAY_MS
    ibkr_mod.PREFLIGHT_DELAY_MS = preflight_delay_ms
    return svc, calls


def _restore_delay(svc):
    import services.ibkr as ibkr_mod
    ibkr_mod.PREFLIGHT_DELAY_MS = svc._test_orig_delay


def _split_calls(calls):
    """Split recorded (_, _, params) tuples into pre-flight vs real.

    Pre-flight calls always carry exactly one conid (per-conid
    `_preflight_snapshot`). Real bulk-chunk calls carry however many
    conids the chunk had. We classify by counting commas.
    """
    snapshot_calls = [
        c for c in calls if c[1] == "/iserver/marketdata/snapshot"
    ]
    preflights = [
        c for c in snapshot_calls if "," not in c[2].get("conids", "")
    ]
    bulks = [
        c for c in snapshot_calls if "," in c[2].get("conids", "")
    ]
    return preflights, bulks


# ── Tests ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_thirteen_conids_one_real_ibkr_call():
    """13 conids in one request → 1 real IBKR bulk snapshot call.

    All 13 are cold so 13 per-conid pre-flights fire, then ONE bulk
    snapshot call with all 13 conids comma-joined.
    """
    svc, calls = _make_svc()
    try:
        conids = list(range(1001, 1014))  # 13 conids
        rows = await svc.snapshot(conids, DEFAULT_QUOTE_FIELDS_STR)

        # Caller got one row per conid.
        assert len(rows) == 13
        assert {r["conid"] for r in rows} == set(conids)

        preflights, bulks = _split_calls(calls)
        assert len(preflights) == 13, (
            f"expected 13 per-conid pre-flights for cold conids; got "
            f"{len(preflights)}: {preflights}"
        )
        assert len(bulks) == 1, (
            f"expected exactly 1 bulk snapshot call (≤50 conids = no "
            f"chunking); got {len(bulks)}: {bulks}"
        )
        # And the bulk call carries all 13 conids.
        bulk_conids = bulks[0][2]["conids"].split(",")
        assert len(bulk_conids) == 13
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_mix_of_warmed_and_cold_only_preflights_cold():
    """Pre-flight only fires for cold conids — warmed conids skip
    the per-conid pre-flight step entirely."""
    svc, calls = _make_svc()
    try:
        # Warm 5 conids ahead of time so they're already in
        # state.warmed_conids.
        for c in range(2001, 2006):
            svc.state.warmed_conids.add(c)

        # Now request 5 warmed + 7 cold = 12 conids in one call.
        request = list(range(2001, 2006)) + list(range(3001, 3008))
        calls.clear()  # ignore any setup noise
        rows = await svc.snapshot(request, DEFAULT_QUOTE_FIELDS_STR)
        assert len(rows) == 12

        preflights, bulks = _split_calls(calls)
        # Exactly 7 pre-flights — only for the cold conids.
        assert len(preflights) == 7, (
            f"expected 7 pre-flights (only the cold conids); got "
            f"{len(preflights)}: {preflights}"
        )
        preflight_conids = {p[2]["conids"] for p in preflights}
        assert preflight_conids == {str(c) for c in range(3001, 3008)}, (
            f"pre-flight should have covered cold conids 3001-3007 "
            f"only; got {preflight_conids}"
        )
        # And exactly 1 bulk call.
        assert len(bulks) == 1
        # All 12 conids end up warmed afterward.
        for c in request:
            assert c in svc.state.warmed_conids
    finally:
        _restore_delay(svc)


@pytest.mark.asyncio
async def test_seventy_five_conids_chunks_into_two_ibkr_calls():
    """75 conids in one request → 2 real bulk IBKR calls (50 + 25)."""
    svc, calls = _make_svc()
    try:
        # Mark all conids warmed so we isolate the chunking layer
        # from the pre-flight layer (we already cover pre-flight in
        # the other tests).
        conids = list(range(5001, 5076))  # 75 conids
        for c in conids:
            svc.state.warmed_conids.add(c)
        calls.clear()

        rows = await svc.snapshot(conids, DEFAULT_QUOTE_FIELDS_STR)
        assert len(rows) == 75
        assert {r["conid"] for r in rows} == set(conids)

        preflights, bulks = _split_calls(calls)
        assert len(preflights) == 0, (
            "no pre-flights expected when all conids are warmed"
        )
        assert len(bulks) == 2, (
            f"75 conids must split into 2 bulk calls (50 + 25); got "
            f"{len(bulks)}: {[b[2]['conids'][:30] for b in bulks]}"
        )

        # Verify the chunk sizes.
        chunk_sizes = sorted(
            len(b[2]["conids"].split(",")) for b in bulks
        )
        assert chunk_sizes == [25, 50], (
            f"expected chunks of 25 and 50; got {chunk_sizes}"
        )

        # And no conid is duplicated or dropped across chunks.
        seen: set[int] = set()
        for b in bulks:
            for c in b[2]["conids"].split(","):
                seen.add(int(c))
        assert seen == set(conids)
    finally:
        _restore_delay(svc)
