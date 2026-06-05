"""
Tests for Phase 8.9 dashboard arc-gauge feeds:
  - SectorService.get_market_breadth()   → /sectors/breadth
  - SectorService.get_sector_rotation()  → /sectors/rotation
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from constants import (
    BREADTH_EMA_PERIOD,
    ROTATION_LOOKBACK_DAYS,
    ROTATION_RANGE_PCT,
    SECTORS_DEFENSIVE,
    SECTORS_OFFENSIVE,
    SECTOR_ETFS,
)
from services.sectors import SectorService


# ── Helpers ──────────────────────────────────────────────────


def _bars(closes: list[float]) -> dict:
    """Shape the IBKR history() response: {"data": [{"c": ...}, ...]}."""
    return {"data": [{"c": c} for c in closes]}


def _flat_series(length: int, value: float) -> list[float]:
    return [value] * length


def _make_service(
    conids: dict[str, int],
    history_map: dict[int, dict],
) -> SectorService:
    """
    Build a SectorService whose IBKR calls return canned data.
    `history_map` maps conid → {"data": [...]}.
    """
    ibkr = MagicMock()
    ibkr.get_conid = AsyncMock(side_effect=lambda sym: conids.get(sym))
    ibkr.history = AsyncMock(
        side_effect=lambda conid, period=None, bar=None: history_map.get(conid, {"data": []})
    )

    svc = SectorService(ibkr)
    # Pre-populate the conid cache so _resolve_conids short-circuits.
    svc._conid_cache.update(conids)
    return svc


# ── Market Breadth ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_breadth_all_above_ema_returns_100():
    # Rising series: last close > 50-EMA for every sector.
    rising = list(range(1, BREADTH_EMA_PERIOD * 3 + 1))
    conids = {etf["symbol"]: 1000 + i for i, etf in enumerate(SECTOR_ETFS)}
    history_map = {conid: _bars(rising) for conid in conids.values()}
    # SPY benchmark conid is also resolved but not used by breadth.
    conids["SPY"] = 9999
    history_map[9999] = _bars(rising)

    svc = _make_service(conids, history_map)
    result = await svc.get_market_breadth(force_refresh=True)

    assert result["value"] == 100.0
    assert result["above"] == result["total"] == len(SECTOR_ETFS)
    assert all(s["above"] for s in result["etf_states"])


@pytest.mark.asyncio
async def test_breadth_all_below_ema_returns_0():
    # Falling series: last close < 50-EMA for every sector.
    falling = list(range(BREADTH_EMA_PERIOD * 3, 0, -1))
    conids = {etf["symbol"]: 1000 + i for i, etf in enumerate(SECTOR_ETFS)}
    history_map = {conid: _bars(falling) for conid in conids.values()}
    conids["SPY"] = 9999
    history_map[9999] = _bars(falling)

    svc = _make_service(conids, history_map)
    result = await svc.get_market_breadth(force_refresh=True)

    assert result["value"] == 0.0
    assert result["above"] == 0
    assert result["total"] == len(SECTOR_ETFS)


@pytest.mark.asyncio
async def test_breadth_mixed_returns_correct_percentage():
    conids = {etf["symbol"]: 1000 + i for i, etf in enumerate(SECTOR_ETFS)}
    conids["SPY"] = 9999

    rising = list(range(1, BREADTH_EMA_PERIOD * 3 + 1))
    falling = list(range(BREADTH_EMA_PERIOD * 3, 0, -1))

    history_map = {}
    for i, (sym, conid) in enumerate(conids.items()):
        if sym == "SPY":
            history_map[conid] = _bars(rising)
            continue
        # First 6 ETFs rising, rest falling.
        history_map[conid] = _bars(rising if i < 6 else falling)

    svc = _make_service(conids, history_map)
    result = await svc.get_market_breadth(force_refresh=True)

    # 6 out of 11 ETFs above the EMA.
    assert result["total"] == len(SECTOR_ETFS)
    assert result["above"] == 6
    assert result["value"] == pytest.approx(round((6 / 11) * 100, 2))


@pytest.mark.asyncio
async def test_breadth_skips_sectors_with_too_few_bars():
    # First sector returns too few bars — it should be dropped, not crash.
    conids = {etf["symbol"]: 1000 + i for i, etf in enumerate(SECTOR_ETFS)}
    conids["SPY"] = 9999

    rising = list(range(1, BREADTH_EMA_PERIOD * 3 + 1))
    short = [100.0, 101.0]  # clearly < BREADTH_EMA_PERIOD

    history_map = {conid: _bars(rising) for conid in conids.values()}
    short_sym_conid = conids[SECTOR_ETFS[0]["symbol"]]
    history_map[short_sym_conid] = _bars(short)

    svc = _make_service(conids, history_map)
    result = await svc.get_market_breadth(force_refresh=True)

    assert result["total"] == len(SECTOR_ETFS) - 1


# ── Sector Rotation ─────────────────────────────────────────


def _perf_series(start: float, end: float, length: int = ROTATION_LOOKBACK_DAYS + 5) -> list[float]:
    """Linear interpolation from `start` → `end` over `length` bars."""
    step = (end - start) / (length - 1)
    return [start + step * i for i in range(length)]


@pytest.mark.asyncio
async def test_rotation_neutral_when_groups_match():
    # Both offensive and defensive up the same amount → delta 0 → gauge 50.
    conids = {}
    history_map = {}
    for i, sym in enumerate(SECTORS_OFFENSIVE + SECTORS_DEFENSIVE):
        conid = 2000 + i
        conids[sym] = conid
        history_map[conid] = _bars(_perf_series(100.0, 110.0))
    conids["SPY"] = 9999
    history_map[9999] = _bars(_perf_series(100.0, 110.0))

    svc = _make_service(conids, history_map)
    result = await svc.get_sector_rotation(force_refresh=True)

    assert result["delta_pct"] == pytest.approx(0.0, abs=0.01)
    assert result["value"] == pytest.approx(50.0, abs=0.01)


@pytest.mark.asyncio
async def test_rotation_fully_offensive_caps_at_100():
    # Offensive +10 %, defensive −10 % ⇒ delta +20 % — clamps to 100.
    conids = {}
    history_map = {}
    for i, sym in enumerate(SECTORS_OFFENSIVE):
        conid = 2000 + i
        conids[sym] = conid
        history_map[conid] = _bars(_perf_series(100.0, 110.0))
    for i, sym in enumerate(SECTORS_DEFENSIVE):
        conid = 3000 + i
        conids[sym] = conid
        history_map[conid] = _bars(_perf_series(100.0, 90.0))
    conids["SPY"] = 9999
    history_map[9999] = _bars(_perf_series(100.0, 100.0))

    svc = _make_service(conids, history_map)
    result = await svc.get_sector_rotation(force_refresh=True)

    assert result["delta_pct"] > ROTATION_RANGE_PCT
    assert result["value"] == 100.0


@pytest.mark.asyncio
async def test_rotation_fully_defensive_clamps_to_0():
    # Offensive −10 %, defensive +10 % ⇒ delta −20 % — clamps to 0.
    conids = {}
    history_map = {}
    for i, sym in enumerate(SECTORS_OFFENSIVE):
        conid = 2000 + i
        conids[sym] = conid
        history_map[conid] = _bars(_perf_series(100.0, 90.0))
    for i, sym in enumerate(SECTORS_DEFENSIVE):
        conid = 3000 + i
        conids[sym] = conid
        history_map[conid] = _bars(_perf_series(100.0, 110.0))
    conids["SPY"] = 9999
    history_map[9999] = _bars(_perf_series(100.0, 100.0))

    svc = _make_service(conids, history_map)
    result = await svc.get_sector_rotation(force_refresh=True)

    assert result["delta_pct"] < -ROTATION_RANGE_PCT
    assert result["value"] == 0.0


@pytest.mark.asyncio
async def test_rotation_handles_missing_groups_gracefully():
    # If we can't compute either group, service returns neutral (50) without
    # raising — keeps the dashboard usable during partial IBKR outages.
    conids = {"SPY": 9999}
    history_map = {9999: _bars(_perf_series(100.0, 100.0))}

    svc = _make_service(conids, history_map)
    result = await svc.get_sector_rotation(force_refresh=True)

    assert result["value"] == 50.0
    assert result["delta_pct"] == 0.0
    assert result["offensive_pct"] is None
    assert result["defensive_pct"] is None
