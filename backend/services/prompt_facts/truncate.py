"""Truncate-by-value: drop low-signal facts to fit token budget.

Drop order:
  1. Neutral facts by score asc (priority × tf_weight × strength)
  2. Whole lowest-tf blocks
Protect:
  - All polarity=caution facts
  - Highest-TF non-neutral facts
"""
from __future__ import annotations

from services.prompt_facts.types import PromptContextBlock, PromptFact

# Conservative tokens-per-fact estimate: text + id + leading marker.
_TOKENS_PER_FACT = 30


def _estimate_tokens(blocks: list[PromptContextBlock]) -> int:
    return sum(len(b.facts) * _TOKENS_PER_FACT + 10 for b in blocks)


def _fact_score(f: PromptFact, tf_weight: int) -> int:
    return f.priority * tf_weight * max(f.strength, 1)


def _estimate_tokens_skip(blocks: list[PromptContextBlock], skip: set[tuple[int, int]]) -> int:
    total = 0
    for bi, b in enumerate(blocks):
        kept = sum(1 for fi, _ in enumerate(b.facts) if (bi, fi) not in skip)
        total += kept * _TOKENS_PER_FACT + 10
    return total


def truncate_by_value(
    blocks: list[PromptContextBlock], budget_tokens: int
) -> list[PromptContextBlock]:
    if _estimate_tokens(blocks) <= budget_tokens:
        return blocks

    # Work on shallow copies so we can mutate facts lists.
    working: list[PromptContextBlock] = [
        PromptContextBlock(
            timeframe=b.timeframe, tf_weight=b.tf_weight,
            facts=list(b.facts), last_close=b.last_close,
        )
        for b in blocks
    ]

    # Identify highest tf_weight present.
    max_weight = max((b.tf_weight for b in working), default=0)

    # Phase 1: drop neutral facts, lowest score first, but never touch
    # caution facts or highest-tf non-neutral facts.
    candidates: list[tuple[int, int, int]] = []  # (block_idx, fact_idx, score)
    for bi, b in enumerate(working):
        for fi, f in enumerate(b.facts):
            if f.polarity == "caution":
                continue
            if b.tf_weight == max_weight and f.polarity != "neutral":
                continue
            score = _fact_score(f, b.tf_weight)
            candidates.append((bi, fi, score))

    candidates.sort(key=lambda t: t[2])  # asc — lowest first

    to_drop: set[tuple[int, int]] = set()
    for bi, fi, _ in candidates:
        if _estimate_tokens_skip(working, to_drop) <= budget_tokens:
            break
        to_drop.add((bi, fi))

    for bi, b in enumerate(working):
        b.facts = [f for fi, f in enumerate(b.facts) if (bi, fi) not in to_drop]

    # Phase 2: drop whole blocks, lowest tf_weight first.
    # Never drop the highest-tf block — it is the anchor for analysis.
    if _estimate_tokens(working) > budget_tokens:
        working.sort(key=lambda b: b.tf_weight)
        while len(working) > 1 and _estimate_tokens(working) > budget_tokens:
            # Skip blocks whose only facts are cautions — try next.
            # Also skip the highest-tf block (last after asc sort).
            highest_idx = len(working) - 1
            droppable = next(
                (
                    i for i, b in enumerate(working)
                    if i != highest_idx and not any(f.polarity == "caution" for f in b.facts)
                ),
                None,
            )
            if droppable is None:
                break
            working.pop(droppable)
        # Restore canonical order: highest tf_weight first.
        working.sort(key=lambda b: -b.tf_weight)

    return working
