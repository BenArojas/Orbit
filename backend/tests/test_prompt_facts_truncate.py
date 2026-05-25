"""Tests for truncate_by_value."""
from services.prompt_facts.types import PromptContextBlock, PromptFact
from services.prompt_facts.truncate import truncate_by_value


def _fact(id_: str, polarity: str = "bullish", priority: int = 70, strength: int = 60) -> PromptFact:
    return PromptFact(
        id=id_, timeframe=id_.split(".")[0],
        indicator=id_.split(".")[1], text=f"Fact for {id_}",
        polarity=polarity, strength=strength, priority=priority, data={},
    )


def _approx_tokens(blocks: list[PromptContextBlock]) -> int:
    """Rough token estimate: text length // 4."""
    total = 0
    for b in blocks:
        for f in b.facts:
            total += len(f.text) // 4
    return total


class TestTruncate:
    def test_no_op_when_within_budget(self):
        blocks = [
            PromptContextBlock(timeframe="D", tf_weight=3, facts=[_fact("D.ema.stack_bullish")], last_close=100.0),
        ]
        out = truncate_by_value(blocks, budget_tokens=10_000)
        assert len(out) == 1
        assert len(out[0].facts) == 1

    def test_protects_cautions_always(self):
        blocks = [
            PromptContextBlock(
                timeframe="D", tf_weight=3,
                facts=[_fact(f"D.ema.f{i}", polarity="neutral", priority=10, strength=10) for i in range(20)]
                       + [_fact("D.rsi.overbought", polarity="caution", priority=50, strength=50)],
                last_close=100.0,
            ),
        ]
        out = truncate_by_value(blocks, budget_tokens=10)
        all_facts = [f for b in out for f in b.facts]
        assert any(f.id == "D.rsi.overbought" for f in all_facts)

    def test_drops_neutral_before_directional(self):
        blocks = [
            PromptContextBlock(
                timeframe="D", tf_weight=3,
                facts=[
                    _fact("D.ema.stack_bullish", polarity="bullish", priority=90, strength=80),
                    _fact("D.atr.stop_distances", polarity="neutral", priority=40, strength=30),
                ],
                last_close=100.0,
            ),
        ]
        out = truncate_by_value(blocks, budget_tokens=5)
        remaining = [f.id for b in out for f in b.facts]
        assert "D.ema.stack_bullish" in remaining
        assert "D.atr.stop_distances" not in remaining

    def test_multi_block_phase1_drops_neutrals_first(self):
        """C12: across blocks, phase-1 drops neutrals before directional facts.

        Highest-TF block's directional facts are protected entirely; lower-TF
        neutrals are first to go; lower-TF directional facts survive if budget allows.
        """
        m_block = PromptContextBlock(
            timeframe="M", tf_weight=5,
            facts=[
                _fact("M.ema.stack_bullish", polarity="bullish", priority=90, strength=80),
                _fact("M.rsi.above_50_rising", polarity="bullish", priority=80, strength=60),
            ],
            last_close=100.0,
        )
        d_block = PromptContextBlock(
            timeframe="D", tf_weight=3,
            facts=[
                _fact("D.ema.stack_bullish", polarity="bullish", priority=85, strength=70),
                _fact("D.atr.stop_distances", polarity="neutral", priority=40, strength=30),
                _fact("D.atr.contracting", polarity="neutral", priority=30, strength=20),
            ],
            last_close=100.0,
        )
        # Budget tight enough to require dropping some D-level neutrals but
        # not so tight that we lose all directional facts.
        out = truncate_by_value([m_block, d_block], budget_tokens=120)
        ids = {f.id for b in out for f in b.facts}
        # M block directional facts are protected.
        assert "M.ema.stack_bullish" in ids
        assert "M.rsi.above_50_rising" in ids
        # D-block directional fact survives over D-block neutrals.
        assert "D.ema.stack_bullish" in ids
        # D-block neutrals are the first dropped.
        assert "D.atr.contracting" not in ids or "D.atr.stop_distances" not in ids

    def test_drops_lowest_tf_block_last(self):
        blocks = [
            PromptContextBlock(
                timeframe="M", tf_weight=5,
                facts=[_fact("M.ema.stack_bullish", priority=80, strength=70)],
                last_close=100.0,
            ),
            PromptContextBlock(
                timeframe="1H", tf_weight=1,
                facts=[_fact("1H.ema.stack_bullish", priority=80, strength=70)],
                last_close=100.0,
            ),
        ]
        out = truncate_by_value(blocks, budget_tokens=3)
        tfs = {b.timeframe for b in out}
        assert "M" in tfs
        assert "1H" not in tfs   # 1H must be dropped first per phase-2 rule
