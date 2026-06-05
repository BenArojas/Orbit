"""Tests for Volume prompt facts."""
from models import CandleData
from services.prompt_facts.volume import build_volume_facts


def _candle(close: float, open_: float, vol: float, time: int = 1_700_000_000) -> CandleData:
    return CandleData(
        time=time, open=open_, high=max(open_, close) + 1,
        low=min(open_, close) - 1, close=close, volume=vol,
    )


def _history(closes_opens_vols: list[tuple[float, float, float]]) -> list[CandleData]:
    return [_candle(c, o, v, time=1_700_000_000 + i * 86400) for i, (c, o, v) in enumerate(closes_opens_vols)]


class TestVolumeFacts:
    def test_surge_up_on_up_candle_with_high_volume(self):
        # 20 bars history at vol=1M, last candle is up + vol=2M
        hist = [(100.0 + i * 0.1, 100.0 + i * 0.1 - 0.5, 1_000_000.0) for i in range(20)]
        hist.append((105.0, 100.0, 2_000_000.0))  # up + 2x volume
        facts = build_volume_facts(symbol="AAPL", timeframe="D", candles=_history(hist))
        ids = [f.id for f in facts]
        assert "D.volume.surge_up" in ids

    def test_surge_down_on_down_candle_with_high_volume(self):
        hist = [(100.0, 99.5, 1_000_000.0) for _ in range(20)]
        hist.append((95.0, 100.0, 2_000_000.0))  # down + 2x volume
        facts = build_volume_facts(symbol="AAPL", timeframe="D", candles=_history(hist))
        ids = [f.id for f in facts]
        assert "D.volume.surge_down" in ids

    def test_dry_up_when_volume_well_below_average(self):
        hist = [(100.0, 99.5, 1_000_000.0) for _ in range(20)]
        hist.append((100.5, 100.0, 300_000.0))  # 0.3x avg
        facts = build_volume_facts(symbol="AAPL", timeframe="D", candles=_history(hist))
        ids = [f.id for f in facts]
        assert "D.volume.dry_up" in ids

    def test_no_facts_when_insufficient_history(self):
        hist = [(100.0, 99.5, 1_000_000.0) for _ in range(5)]
        facts = build_volume_facts(symbol="AAPL", timeframe="D", candles=_history(hist))
        assert facts == []
