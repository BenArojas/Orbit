"""Tests for prompt facts renderer."""
from services.prompt_facts.types import PromptContextBlock, PromptFact
from services.prompt_facts.render import render_prompt_facts


def _fact(id_: str, text: str, polarity: str = "bullish") -> PromptFact:
    return PromptFact(
        id=id_, timeframe=id_.split(".")[0],
        indicator=id_.split(".")[1], text=text,
        polarity=polarity, strength=60, priority=80, data={},
    )


class TestRenderer:
    def test_renders_verified_facts_section(self):
        block = PromptContextBlock(
            timeframe="D", tf_weight=3,
            facts=[
                _fact("D.ema.stack_bullish", "EMA stack bullish."),
                _fact("D.rsi.above_50_rising", "RSI above 50 and rising."),
            ],
            last_close=100.0,
        )
        out = render_prompt_facts([block])
        assert "Verified Facts" in out
        assert "EMA stack bullish." in out
        assert "RSI above 50 and rising." in out

    def test_renders_cautions_section_separately(self):
        block = PromptContextBlock(
            timeframe="D", tf_weight=3,
            facts=[
                _fact("D.ema.stack_bullish", "EMA stack bullish.", "bullish"),
                _fact("D.rsi.overbought", "RSI overbought.", "caution"),
            ],
            last_close=100.0,
        )
        out = render_prompt_facts([block])
        assert "Cautions" in out
        # Caution text must appear under Cautions section
        cautions_idx = out.index("Cautions")
        assert "RSI overbought." in out[cautions_idx:]

    def test_orders_blocks_highest_tf_first(self):
        b_d = PromptContextBlock(timeframe="D", tf_weight=3, facts=[_fact("D.ema.stack_bullish", "D fact.")], last_close=100.0)
        b_w = PromptContextBlock(timeframe="W", tf_weight=4, facts=[_fact("W.ema.stack_bullish", "W fact.")], last_close=100.0)
        b_m = PromptContextBlock(timeframe="M", tf_weight=5, facts=[_fact("M.ema.stack_bullish", "M fact.")], last_close=100.0)
        out = render_prompt_facts([b_d, b_w, b_m])  # any order in
        m_idx = out.index("M fact.")
        w_idx = out.index("W fact.")
        d_idx = out.index("D fact.")
        assert m_idx < w_idx < d_idx

    def test_includes_fact_ids_inline(self):
        block = PromptContextBlock(
            timeframe="D", tf_weight=3,
            facts=[_fact("D.ema.stack_bullish", "EMA stack bullish.")],
            last_close=100.0,
        )
        out = render_prompt_facts([block])
        assert "D.ema.stack_bullish" in out

    def test_empty_blocks_renders_nothing(self):
        assert render_prompt_facts([]) == ""

    def test_fact_with_price_values_appends_grounded_candidates(self):
        f = PromptFact(
            id="D.ema.stack_bullish", timeframe="D", indicator="ema",
            text="EMA stack bullish.", polarity="bullish",
            strength=85, priority=92, data={},
            price_values=(110.0, 105.0, 100.0, 90.0),
        )
        block = PromptContextBlock(timeframe="D", tf_weight=3, facts=[f], last_close=112.0)
        out = render_prompt_facts([block])
        assert "Grounded price candidates:" in out
        assert "$110.00" in out
        assert "$90.00" in out

    def test_fact_without_price_values_has_no_grounded_candidates(self):
        f = _fact("D.rsi.above_50_rising", "RSI above 50.")
        block = PromptContextBlock(timeframe="D", tf_weight=3, facts=[f], last_close=100.0)
        out = render_prompt_facts([block])
        assert "Grounded price candidates" not in out

    def test_empty_facts_block_renders_header_only(self):
        """C13: a block with no facts still shows the header but no section labels.

        Locks the current behavior: render does NOT skip empty blocks, and the
        section labels ('Verified Facts', 'Cautions') only appear when their
        respective fact lists are non-empty.
        """
        block = PromptContextBlock(
            timeframe="D", tf_weight=3, facts=[], last_close=100.0,
        )
        out = render_prompt_facts([block])
        assert "=== D (close=$100.00) ===" in out
        assert "Verified Facts" not in out
        assert "Cautions" not in out
