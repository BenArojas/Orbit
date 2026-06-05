"""Renderer: PromptContextBlock list -> deterministic prompt text."""
from __future__ import annotations

from services.prompt_facts.types import PromptContextBlock, PromptFact

_TF_ORDER = ["M", "W", "D", "4H", "1H"]


def _tf_sort_key(tf: str) -> int:
    try:
        return _TF_ORDER.index(tf)
    except ValueError:
        return len(_TF_ORDER)


def _fact_line(f: PromptFact) -> str:
    # "  [D.ema.stack_bullish] EMA stack bullish."
    return f"  [{f.id}] {f.text}"


def render_prompt_facts(blocks: list[PromptContextBlock]) -> str:
    if not blocks:
        return ""

    ordered = sorted(blocks, key=lambda b: _tf_sort_key(b.timeframe))
    sections: list[str] = []

    for block in ordered:
        verified = [f for f in block.facts if f.polarity != "caution"]
        cautions = [f for f in block.facts if f.polarity == "caution"]

        sections.append(f"=== {block.timeframe} (close=${block.last_close:.2f}) ===")
        if verified:
            sections.append("Verified Facts:")
            sections.extend(_fact_line(f) for f in verified)
        if cautions:
            sections.append("Cautions:")
            sections.extend(_fact_line(f) for f in cautions)
        sections.append("")  # blank line between blocks

    return "\n".join(sections).rstrip()
