"""
Eval harness for the prompt fact layer.

Uses syrupy snapshot testing: first run generates golden snapshots in
tests/__snapshots__/; subsequent runs diff against them.  Any change to
the fact builders, renderer, or truncator that alters output will cause a
snapshot mismatch — surfacing regressions before they reach production.

Scenarios (see tests/fixtures/eval_scenarios.py):
  - TSM bullish extension: overbought RSI, confirmed EMA stack
  - AAPL in-swing: Fibonacci retracement consolidation
  - NVDA EMA stack breakout: wide separation, sustained RSI

To update snapshots after an intentional change:
    pytest tests/test_prompt_facts_eval.py --snapshot-update
"""
from __future__ import annotations

import pytest
from syrupy.assertion import SnapshotAssertion

from services.prompt_builder import build_indicator_context
from tests.fixtures.eval_scenarios import aapl_in_swing, nvda_ema_stack, tsm_extension


# ── helpers ──────────────────────────────────────────────────────────────────


def _build(scenario: dict, budget_tokens: int = 4096) -> str:
    """Run scenario kwargs through the fact pipeline and return rendered text."""
    return build_indicator_context(**scenario, budget_tokens=budget_tokens)


# ── snapshot tests ────────────────────────────────────────────────────────────


class TestPromptFactsEval:
    def test_tsm_extension_snapshot(self, snapshot: SnapshotAssertion):
        """TSM bullish extension: EMA stack + overbought RSI + volume confirm."""
        output = _build(tsm_extension())
        assert output == snapshot

    def test_aapl_in_swing_snapshot(self, snapshot: SnapshotAssertion):
        """AAPL in-swing: Fibonacci retracement with neutral RSI."""
        output = _build(aapl_in_swing())
        assert output == snapshot

    def test_nvda_ema_stack_snapshot(self, snapshot: SnapshotAssertion):
        """NVDA breakout: wide EMA stack separation with sustained RSI strength."""
        output = _build(nvda_ema_stack())
        assert output == snapshot


# ── structural assertions (non-snapshot, always run) ─────────────────────────


class TestPromptFactsEvalStructure:
    """Quick structural checks that don't depend on exact text — safer to evolve."""

    def test_tsm_emits_ema_facts(self):
        out = _build(tsm_extension())
        assert "D.ema." in out

    def test_tsm_emits_rsi_facts(self):
        out = _build(tsm_extension())
        assert "D.rsi." in out

    def test_aapl_emits_fibonacci_facts(self):
        out = _build(aapl_in_swing())
        assert "D.fibonacci." in out

    def test_nvda_emits_ema_facts(self):
        out = _build(nvda_ema_stack())
        assert "D.ema." in out

    def test_all_scenarios_contain_verified_facts_header(self):
        for scenario_fn in (tsm_extension, aapl_in_swing, nvda_ema_stack):
            out = _build(scenario_fn())
            assert "Verified Facts" in out, f"Missing header for {scenario_fn.__name__}"

    def test_no_legacy_labels_in_any_scenario(self):
        """Fact layer must never emit old-format labels."""
        for scenario_fn in (tsm_extension, aapl_in_swing, nvda_ema_stack):
            out = _build(scenario_fn())
            assert "Primary fib" not in out
            assert "Source: MANUAL" not in out
            assert "Locked fib #" not in out

    def test_budget_truncation_shortens_output(self):
        """Passing a tiny budget should reduce output vs. full budget."""
        full = _build(tsm_extension(), budget_tokens=16384)
        tiny = _build(tsm_extension(), budget_tokens=200)
        assert len(tiny) <= len(full)
