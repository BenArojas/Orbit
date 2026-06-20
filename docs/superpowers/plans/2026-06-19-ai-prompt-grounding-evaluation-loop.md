# AI Prompt Grounding and Evaluation Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `orbit-ai-workflow` to execute this plan. Implement one tracer-bullet slice, verify only the uncovered critical promise it touches, then stop for review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unsupported trade levels, measure prompt quality against stable cases, and improve the production prompt through small evidence-backed iterations.

**Architecture:** Put deterministic signal validation between model output and the UI, then evaluate prompt candidates against fixed synthetic market cases. Hard grounding and schema checks decide whether a candidate is eligible; a stable weighted score compares eligible candidates. Live OpenRouter evaluation is an explicit HITL command using the existing OS-keychain credential path, never part of normal tests or automatic production mutation.

**Tech Stack:** Python 3.12, Pydantic v2, pytest, existing prompt-fact pipeline and OpenRouter adapter; React 19/TypeScript for nullable level rendering; no prompt-optimization dependency.

**Status:** APPROVED FOR EXECUTION on 2026-06-20 and QUEUED after the UX lifecycle plan. `PROJECT_PLAN.md` tracks the dependency. Do not begin until the UX plan is complete and reviewed; then execute Slice 1 only.

**Remediation update (2026-06-20):** The focused review-blocker slice is now verified on `feature/orbit-v2-cloud-hybrid-ai-spec`. Grounding is enforced against exact rendered fact IDs plus explicit price-bearing values, eval fixtures derive their IDs/maps from the production fact pipeline, production normalizes legacy confidence labels before strict validation, and candidate comparison now fails closed when required telemetry is unavailable. Live OpenRouter evaluation and prompt promotion remain pending.

---

## Global Constraints

- Do not execute until `2026-06-19-ai-run-inspector-ux-lifecycle-remediation.md` is complete and reviewed.
- `NEUTRAL` or insufficient verified evidence returns no numeric entry, stop, target, or R:R.
- A model response never becomes authoritative merely because its JSON parses.
- Deterministic graders own factual, schema, geometry, and arithmetic checks.
- An LLM judge may later assess prose quality, but never factual grounding or trade-level validity in this mission.
- Evaluation weights remain fixed while comparing prompt candidates. Changing a prompt and its scoring weights in the same iteration is forbidden.
- Change one prompt clause, one fact representation, or one model parameter per candidate.
- Live evaluation requires explicit user approval, uses a saved OS-keychain key, displays estimated/max cost first, and never runs in CI or normal pytest.
- Do not persist real prompts, model completions, API keys, account data, or portfolio/order/execution data.
- Synthetic fixtures and aggregate eval scores may be committed.
- Do not add DSPy, promptfoo, an OpenAI Evals dependency, or another optimization framework in this mission.
- Local Ollama and OpenRouter use the same validated signal contract.
- Never add tools, web search, order mutation, or autonomous prompt deployment.
- **Testing policy (`docs/testing.md`): add tests only where they protect an uncovered critical promise; default to zero new tests and a one-test-per-slice budget.** The exceptions in this mission are explicit:
  - **Slice 1 — the signal validator IS a critical promise** (protects "Unsafe trades cannot happen"). Do not skip its test.
  - **Slice 2 — the deterministic graders ARE a critical promise** (a wrong grader can promote an ungrounded prompt, which produces unsafe trades). Do not skip their test.
  - **Slice 3 — the live runner's secret handling IS a critical promise** (protects "Secrets and private data stay only in approved locations"). Do not skip its boundary test.
  - Everything else — UI rendering, prompt/fact wording, integration wiring — is verified by `npm run typecheck`, `npm run build`, the policy-drift check, and the deterministic graders, plus manual smoke. Do not duplicate the safety promise across service, router, hook, and UI layers.
- Stop after every slice for review. Stop after two unsuccessful verification loops and ask for direction.

## Method Overview

This plan uses the common evaluation-driven optimization loop:

1. Define representative cases and graders before changing the prompt.
2. Record a baseline using the current prompt and one fixed model.
3. Change one variable.
4. Run the same cases and graders.
5. Reject every candidate with a hard grounding failure.
6. Compare weighted scores only among hard-gate passes.
7. Manually inspect finalists before promoting a prompt version.

This follows current evaluation guidance: build representative evals first, use narrow graders, iterate on prompt versions, and manually review optimized candidates before production. References:

- [OpenAI model optimization workflow](https://platform.openai.com/docs/guides/model-optimization)
- [OpenAI graders](https://platform.openai.com/docs/guides/graders/)
- [OpenAI prompt optimizer safety guidance](https://platform.openai.com/docs/guides/prompt-optimizer)

The first implementation deliberately uses Orbit's existing Python stack. Automated optimizers become relevant only if the small loop proves too slow or the case set becomes large.

## Resolved Product Contract

### Strict signal behavior

- Directions remain `STRONG LONG`, `LONG`, `NEUTRAL`, `SHORT`, and `STRONG SHORT`.
- `NEUTRAL` always has `entry.price = null`, `stop.price = null`, `target.price = null`, and `risk_reward = null`.
- The prompt requires insufficient-evidence cases to return `NEUTRAL` with null levels and an explicit caution; fixed eval cases enforce that behavior.
- LONG geometry requires `stop < entry < target`.
- SHORT geometry requires `target < entry < stop`.
- R:R is calculated by Orbit from validated numeric levels; model-provided R:R is ignored.
- Confidence remains an integer from 0 through 100.
- Unknown ADX or volume stays `null`/`N/A`; the model may not manufacture a value.
- The UI renders absent levels as `—` with `No grounded level`.

### Evaluation gates and score

Hard gates, each required:

- JSON/schema valid.
- Direction valid.
- Neutral-null contract valid.
- Directional price geometry valid.
- No numeric level in an insufficient-evidence case.
- Every cited fact ID exists in the supplied verified-fact set.
- Server-calculated R:R matches the rendered R:R.

Weighted score among hard-gate passes:

| Dimension | Weight |
|---|---:|
| Factual grounding and valid fact citations | 35 |
| Direction/evidence consistency | 20 |
| Actionability when evidence supports a setup | 15 |
| Confirmation and caution coverage | 10 |
| Concision and lack of duplicated prose | 10 |
| Schema reliability across repeated runs | 10 |

Weights are product priorities, not knobs an optimization agent may alter to make a candidate win. A later human-approved plan may revise them after reviewing real failure distributions.

### Candidate acceptance

- Zero hard-gate failures.
- Weighted mean improves by at least 2 points out of 100 over the current accepted version.
- No individual case regresses by more than 10 points.
- Mean actual cost and latency regress by no more than 10% unless the user explicitly accepts the tradeoff.
- Development pass: one response per case.
- Finalist pass: three responses per case using the same model and parameters.
- User approval is required before replacing the production prompt version.

## Policy Impact

**Proposed public-contract and safety-behavior change.** The signal contract will allow absent numeric levels and R:R for `NEUTRAL`/insufficient evidence. Files affected include `backend/services/ai.py`, `backend/models/__init__.py`, `src/components/ai/ActionSignalCard.tsx`, `src/modules/parallax/api.ts`, and the active cloud-AI design. This reduces unsupported financial guidance and does not expand AI authority. Run `policy-drift-check` before merging to `dev`.

## File Map

- Create `backend/services/ai_signal_validation.py`: deep module for raw signal schema, deterministic validation, safe fallback, and R:R calculation.
- Create `backend/services/ai_prompt_eval.py`: eval cases/results, hard gates, fixed weighted score, and candidate comparison.
- Create `backend/scripts/evaluate_ai_prompt.py`: explicit local/HITL runner; no normal-test or startup integration.
- Create `backend/tests/fixtures/ai_prompt_eval_cases.py`: synthetic sparse and directional cases.
- Create `backend/tests/test_ai_signal_validation.py`: strict contract behavior (critical-promise test).
- Create `backend/tests/test_ai_prompt_eval.py`: grader and score behavior (critical-promise test).
- Create `backend/tests/test_ai_prompt_eval_runner.py`: runner boundary secret-handling (critical-promise test).
- Modify `backend/services/prompt_builder.py`: neutral-null instruction, canonical hints, prompt version constant, and one candidate change at a time.
- Modify `backend/services/prompt_facts/bbands.py`: expose verified current band levels as facts.
- Modify `backend/services/ai.py`: validate before frontend conversion and calculate R:R locally.
- Modify `backend/models/__init__.py`: nullable structured signal contracts if a route-facing model is introduced.
- Modify `src/components/ai/ActionSignalCard.tsx`: honest absent-level rendering (verified by build + manual smoke, not a new unit test).
- Modify `src/modules/parallax/api.ts`: preserve `SignalData` while allowing absent level display values.
- Update `docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md` only after a candidate is approved.

---

## Slice 1: HITL — Sparse Evidence Produces an Honest Signal End to End

**Critical promise protected:** "Unsafe trades cannot happen." The signal validator is the boundary that stops invented trade levels. This slice's validator test is the one required new test (`docs/testing.md` highest-practical-boundary rule); the card and integration are verified by build + manual smoke.

**Proof target:** The observed WULF BB-only case cannot display invented prices, even if a model returns valid-looking JSON containing them.

**Files:**
- Create: `backend/services/ai_signal_validation.py`
- Create: `backend/tests/test_ai_signal_validation.py`
- Modify: `backend/services/prompt_builder.py`
- Modify: `backend/services/ai.py`
- Modify: `src/components/ai/ActionSignalCard.tsx`
- Modify: `src/modules/parallax/api.ts`

**Interfaces:**
- Produces `validate_signal_draft(raw: object) -> ValidatedSignal`, raising `AISignalGroundingError` on contract violations.
- Produces `safe_neutral_signal(reason: str) -> ValidatedSignal`.
- Produces `calculate_risk_reward(direction: str, entry: Decimal, stop: Decimal, target: Decimal) -> Decimal`.
- Keeps the existing frontend `SignalData` shape; absent levels use display value `—` and explanatory subtext.

- [ ] **Step 1: Write the failing strict-contract test (the critical-promise test)**

Create `backend/tests/test_ai_signal_validation.py`. Define the public schema through the wished-for API:

```python
from decimal import Decimal

import pytest

from services.ai_signal_validation import (
    AISignalGroundingError,
    calculate_risk_reward,
    safe_neutral_signal,
    validate_signal_draft,
)


def _neutral_with_levels() -> dict:
    return {
        "direction": "NEUTRAL",
        "confidence": 35,
        "description": "Insufficient confirmation",
        "entry": {"price": 27.0, "note": "estimated middle band"},
        "stop": {"price": 25.5, "note": "estimated lower band"},
        "target": {"price": 31.5, "note": "estimated projection"},
        "confirmations": [],
        "cautions": ["Only one verified fact"],
        "meta": {"risk_reward": "3:1", "score": "4/10", "adx_trend": None, "volume_signal": None},
    }


def test_neutral_rejects_numeric_trade_levels():
    with pytest.raises(AISignalGroundingError, match="NEUTRAL cannot contain numeric trade levels"):
        validate_signal_draft(_neutral_with_levels())


def test_neutral_null_contract_is_accepted():
    raw = _neutral_with_levels()
    raw["entry"] = {"price": None, "note": "No grounded level"}
    raw["stop"] = {"price": None, "note": "No grounded level"}
    raw["target"] = {"price": None, "note": "No grounded level"}
    raw["meta"]["risk_reward"] = None

    validated = validate_signal_draft(raw)

    assert validated.direction == "NEUTRAL"
    assert validated.entry.price is None
    assert validated.meta.risk_reward is None


def test_long_geometry_must_be_stop_below_entry_below_target():
    raw = _neutral_with_levels()
    raw["direction"] = "LONG"
    raw["entry"] = {"price": 31.5, "note": "entry"}
    raw["stop"] = {"price": 32.0, "note": "stop above entry is invalid"}
    raw["target"] = {"price": 35.0, "note": "target"}

    with pytest.raises(AISignalGroundingError, match="LONG geometry"):
        validate_signal_draft(raw)


def test_short_geometry_must_be_target_below_entry_below_stop():
    raw = _neutral_with_levels()
    raw["direction"] = "SHORT"
    raw["entry"] = {"price": 27.0, "note": "entry"}
    raw["stop"] = {"price": 25.0, "note": "stop below entry is invalid"}
    raw["target"] = {"price": 24.0, "note": "target"}

    with pytest.raises(AISignalGroundingError, match="SHORT geometry"):
        validate_signal_draft(raw)


def test_invalid_direction_is_rejected():
    raw = _neutral_with_levels()
    raw["direction"] = "MOON"

    with pytest.raises(AISignalGroundingError):
        validate_signal_draft(raw)


def test_confidence_must_be_within_bounds():
    raw = _neutral_with_levels()
    raw["confidence"] = 250

    with pytest.raises(AISignalGroundingError):
        validate_signal_draft(raw)


def test_server_calculates_long_risk_reward():
    assert calculate_risk_reward(
        direction="LONG",
        entry=Decimal("27"),
        stop=Decimal("25.5"),
        target=Decimal("31.5"),
    ) == Decimal("3")


def test_valid_long_signal_uses_server_risk_reward_not_model_value():
    raw = _neutral_with_levels()
    raw["direction"] = "LONG"
    raw["entry"] = {"price": 27.0, "note": "entry"}
    raw["stop"] = {"price": 25.5, "note": "stop"}
    raw["target"] = {"price": 31.5, "note": "target"}
    raw["meta"]["risk_reward"] = "99:1"  # model value must be ignored

    validated = validate_signal_draft(raw)

    assert validated.meta.risk_reward == "3:1"


def test_safe_neutral_signal_has_null_levels():
    validated = safe_neutral_signal("Insufficient verified evidence for numeric trade levels")

    assert validated.direction == "NEUTRAL"
    assert validated.entry.price is None
    assert validated.stop.price is None
    assert validated.target.price is None
    assert validated.meta.risk_reward is None
```

- [ ] **Step 2: Run the validation test red**

```bash
cd backend
uv run python -m pytest tests/test_ai_signal_validation.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'services.ai_signal_validation'`.

- [ ] **Step 3: Implement the validation module**

Create `backend/services/ai_signal_validation.py`:

```python
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

Direction = Literal["STRONG LONG", "LONG", "NEUTRAL", "SHORT", "STRONG SHORT"]
_LONG_DIRECTIONS = {"STRONG LONG", "LONG"}
_SHORT_DIRECTIONS = {"STRONG SHORT", "SHORT"}


class AISignalGroundingError(Exception):
    """Raised when a model signal violates the grounding contract."""


class SignalLevelDraft(BaseModel):
    price: Decimal | None = None
    note: str


class SignalMetaDraft(BaseModel):
    risk_reward: str | None = None
    score: str | None = None
    adx_trend: str | None = None
    volume_signal: str | None = None


class SignalDraft(BaseModel):
    direction: Direction
    confidence: int = Field(ge=0, le=100)
    description: str
    entry: SignalLevelDraft
    stop: SignalLevelDraft
    target: SignalLevelDraft
    confirmations: list[str]
    cautions: list[str]
    meta: SignalMetaDraft


# A ValidatedSignal is a normalized SignalDraft whose risk_reward is server-owned.
ValidatedSignal = SignalDraft


def calculate_risk_reward(
    *, direction: str, entry: Decimal, stop: Decimal, target: Decimal
) -> Decimal:
    reward = abs(target - entry)
    risk = abs(entry - stop)
    if risk == 0:
        raise AISignalGroundingError("Risk distance cannot be zero")
    return (reward / risk).quantize(Decimal("0.01")).normalize()


def _format_risk_reward(value: Decimal) -> str:
    return f"{value.normalize()}:1"


def validate_signal_draft(raw: object) -> ValidatedSignal:
    try:
        draft = SignalDraft.model_validate(raw)
    except ValidationError as exc:
        raise AISignalGroundingError(f"Invalid signal schema: {exc}") from exc

    levels = (draft.entry.price, draft.stop.price, draft.target.price)

    if draft.direction == "NEUTRAL":
        if any(level is not None for level in levels):
            raise AISignalGroundingError("NEUTRAL cannot contain numeric trade levels")
        draft.meta.risk_reward = None
        return draft

    if any(level is None for level in levels):
        raise AISignalGroundingError(
            f"{draft.direction} requires numeric entry, stop, and target"
        )

    entry, stop, target = draft.entry.price, draft.stop.price, draft.target.price

    if draft.direction in _LONG_DIRECTIONS and not (stop < entry < target):
        raise AISignalGroundingError("LONG geometry requires stop < entry < target")
    if draft.direction in _SHORT_DIRECTIONS and not (target < entry < stop):
        raise AISignalGroundingError("SHORT geometry requires target < entry < stop")

    try:
        rr = calculate_risk_reward(
            direction=draft.direction, entry=entry, stop=stop, target=target
        )
    except InvalidOperation as exc:
        raise AISignalGroundingError("Could not compute risk/reward") from exc

    draft.meta.risk_reward = _format_risk_reward(rr)
    return draft


def safe_neutral_signal(reason: str) -> ValidatedSignal:
    return SignalDraft(
        direction="NEUTRAL",
        confidence=0,
        description=reason,
        entry=SignalLevelDraft(price=None, note="No grounded level"),
        stop=SignalLevelDraft(price=None, note="No grounded level"),
        target=SignalLevelDraft(price=None, note="No grounded level"),
        confirmations=[],
        cautions=[reason],
        meta=SignalMetaDraft(risk_reward=None),
    )
```

- [ ] **Step 4: Run the validation test green**

```bash
cd backend
uv run python -m pytest tests/test_ai_signal_validation.py -q
```

Expected: PASS.

- [ ] **Step 5: Integrate validation before frontend conversion**

In `backend/services/ai.py`, replace direct acceptance of the parsed model JSON with a guarded path. Locate the function that converts the parsed model output to the frontend format (the call site that currently passes `raw_signal` straight into `signal_to_frontend_format`) and wrap it:

```python
from services.ai_signal_validation import (
    AISignalGroundingError,
    safe_neutral_signal,
    validate_signal_draft,
)
from pydantic import ValidationError

# ...inside the analysis-response handler, replacing the prior direct conversion:
try:
    validated = validate_signal_draft(raw_signal)
except (ValidationError, AISignalGroundingError) as exc:
    log.warning("Rejected ungrounded AI signal: %s", exc)
    validated = safe_neutral_signal(
        "Insufficient verified evidence for numeric trade levels"
    )
return signal_to_frontend_format(validated.model_dump(mode="python"))
```

Do not silently coerce an invalid direction or a numeric neutral plan into a directional plan. The `except` catches only the two typed errors above — no bare `except Exception` (AGENTS.md rule 5).

- [ ] **Step 6: Make the production prompt state the approved contract**

In `backend/services/prompt_builder.py`, change only the neutral/insufficient-evidence clauses and the JSON schema example in this slice. Replace the existing neutral guidance lines with:

```text
- NEUTRAL: mixed or insufficient verified evidence. Do not invent a trade plan.
- If verified facts do not contain enough information to support numeric levels, return NEUTRAL and set entry, stop, target, and risk_reward to null.
- Never estimate an indicator value, support/resistance level, or price target that is absent from Verified Facts.
```

Update the JSON schema example's neutral branch to:

```json
"entry": {"price": null, "note": "No grounded level"},
"stop": {"price": null, "note": "No grounded level"},
"target": {"price": null, "note": "No grounded level"},
"meta": {"risk_reward": null}
```

Directional examples retain numeric placeholders. Do not change scoring or weighting text in this slice.

- [ ] **Step 7: Render absent levels honestly in the UI**

In `src/components/ai/ActionSignalCard.tsx`, render three stable level cards for layout continuity. When a level value is absent, show `—` as the value and `No grounded level` as the subtext. Do not hide the section and do not show `$0.00`. In `src/modules/parallax/api.ts`, keep the existing `SignalData` shape but allow the absent display value `—` for level values and `R:R`.

This is UI rendering of the already-validated contract — it does not get its own unit test (testing.md: do not duplicate the safety promise across layers). It is verified by typecheck, build, and manual smoke in Step 8.

- [ ] **Step 8: Verify Slice 1**

```bash
cd backend
uv run python -m pytest tests/test_ai_signal_validation.py -q
uv run ruff check services/ai_signal_validation.py services/ai.py services/prompt_builder.py tests/test_ai_signal_validation.py
cd ..
npm run typecheck
npm run build
git diff --check
```

Expected: validation test PASS, no new Ruff findings, typecheck and build PASS, no whitespace errors.

Manual smoke (no automation): start `npm run tauri dev`, trigger an analysis that returns the WULF BB-only sparse payload (or paste it through the dev path), and confirm the card shows `NEUTRAL`, three `—` levels with `No grounded level`, and `R:R` of `—`. Confirm a valid LONG payload still renders numeric levels and a server-computed R:R.

- [ ] **Step 9: Commit Slice 1**

```bash
git add backend/services/ai_signal_validation.py backend/tests/test_ai_signal_validation.py backend/services/prompt_builder.py backend/services/ai.py src/components/ai/ActionSignalCard.tsx src/modules/parallax/api.ts
git commit -m "fix: reject ungrounded ai trade levels"
```

**Checkpoint:** Stop. Demonstrate the WULF payload producing a safe neutral/null result before building the optimization loop.

---

## Slice 2: AFK — Add Stable Cases and Deterministic Graders

**Critical promise protected:** "Unsafe trades cannot happen." The graders are the gate that decides whether a prompt candidate is grounded enough to promote; a wrong grader could let an ungrounded prompt win. **Grader correctness IS a critical promise — its test is the one required new test for this slice.** The fixture file is data, not a test.

**Proof target:** Orbit can grade the current prompt and any candidate against the same cases without a live provider or subjective reviewer.

**Files:**
- Create: `backend/services/ai_prompt_eval.py`
- Create: `backend/tests/fixtures/ai_prompt_eval_cases.py`
- Create: `backend/tests/test_ai_prompt_eval.py`

**Interfaces:**
- Produces `grade_prompt_output(case: PromptEvalCase, output: str) -> PromptEvalResult`.
- Produces `compare_candidates(baseline: PromptEvalSummary, candidate: PromptEvalSummary) -> CandidateDecision`.
- Produces immutable `PROMPT_EVAL_WEIGHTS` matching the score table above (sums to 100).

- [ ] **Step 1: Define the six representative cases**

Create `backend/tests/fixtures/ai_prompt_eval_cases.py`. Use synthetic data only and reuse the existing candle builders in `tests/fixtures/eval_scenarios.py` rather than duplicating candle arrays:

```python
from __future__ import annotations

from dataclasses import dataclass, field

from tests.fixtures.eval_scenarios import (
    bullish_ema_stack,
    conflicting_timeframes_candles,
    fib_pullback_candles,
    sparse_bb_only_candles,
    strong_trend_overextended_candles,
    missing_adx_volume_candles,
)


@dataclass(frozen=True)
class PromptEvalCase:
    case_id: str
    candles: object
    allowed_fact_ids: frozenset[str]
    allowed_directions: frozenset[str]
    insufficient_for_levels: bool
    required_caution_concepts: tuple[str, ...] = field(default_factory=tuple)


EVAL_CASES: tuple[PromptEvalCase, ...] = (
    PromptEvalCase(
        case_id="wulf_bb_sparse",
        candles=sparse_bb_only_candles(),
        allowed_fact_ids=frozenset({"close", "bbands.percent_b"}),
        allowed_directions=frozenset({"NEUTRAL"}),
        insufficient_for_levels=True,
        required_caution_concepts=("single verified fact", "insufficient evidence"),
    ),
    PromptEvalCase(
        case_id="tsm_extension",
        candles=bullish_ema_stack(),
        allowed_fact_ids=frozenset({"close", "ema.stack", "rsi.value"}),
        allowed_directions=frozenset({"LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=("overextension",),
    ),
    PromptEvalCase(
        case_id="aapl_fib_pullback",
        candles=fib_pullback_candles(),
        allowed_fact_ids=frozenset({"close", "fib.level", "ema.value"}),
        allowed_directions=frozenset({"LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=(),
    ),
    PromptEvalCase(
        case_id="nvda_ema_extension",
        candles=strong_trend_overextended_candles(),
        allowed_fact_ids=frozenset({"close", "ema.stack", "rsi.value"}),
        allowed_directions=frozenset({"STRONG LONG", "LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=("overextension", "pullback"),
    ),
    PromptEvalCase(
        case_id="conflicting_timeframes",
        candles=conflicting_timeframes_candles(),
        allowed_fact_ids=frozenset({"close", "ema.stack", "rsi.value"}),
        allowed_directions=frozenset({"NEUTRAL", "LONG", "SHORT"}),
        insufficient_for_levels=False,
        required_caution_concepts=("conflicting timeframes",),
    ),
    PromptEvalCase(
        case_id="missing_adx_volume",
        candles=missing_adx_volume_candles(),
        allowed_fact_ids=frozenset({"close", "ema.stack"}),
        allowed_directions=frozenset({"LONG", "NEUTRAL"}),
        insufficient_for_levels=False,
        required_caution_concepts=("adx unavailable", "volume unavailable"),
    ),
)
```

If any builder name in `tests/fixtures/eval_scenarios.py` differs, add a small synthetic builder beside the existing ones rather than inlining candle arrays here.

- [ ] **Step 2: Write the failing grader test (the critical-promise test)**

Create `backend/tests/test_ai_prompt_eval.py`:

```python
import json

from services.ai_prompt_eval import (
    PROMPT_EVAL_WEIGHTS,
    compare_candidates,
    grade_prompt_output,
)
from tests.fixtures.ai_prompt_eval_cases import EVAL_CASES

WULF_CASE = next(c for c in EVAL_CASES if c.case_id == "wulf_bb_sparse")

UNGROUNDED_WULF = json.dumps(
    {
        "direction": "LONG",
        "confidence": 70,
        "description": "Bounce off lower band [close] toward middle band.",
        "entry": {"price": 27.0, "note": "estimated"},
        "stop": {"price": 25.5, "note": "estimated"},
        "target": {"price": 31.5, "note": "estimated"},
        "confirmations": ["Price near lower band [close]"],
        "cautions": [],
        "meta": {"risk_reward": "3:1", "score": "7/10", "adx_trend": None, "volume_signal": None},
    }
)

GROUNDED_WULF = json.dumps(
    {
        "direction": "NEUTRAL",
        "confidence": 30,
        "description": "Only %B is verified [bbands.percent_b]; single verified fact means insufficient evidence for a trade plan.",
        "entry": {"price": None, "note": "No grounded level"},
        "stop": {"price": None, "note": "No grounded level"},
        "target": {"price": None, "note": "No grounded level"},
        "confirmations": [],
        "cautions": ["Single verified fact", "Insufficient evidence for numeric levels"],
        "meta": {"risk_reward": None, "score": "3/10", "adx_trend": None, "volume_signal": None},
    }
)


def test_weights_total_one_hundred():
    assert sum(PROMPT_EVAL_WEIGHTS.values()) == 100


def test_ungrounded_neutral_case_fails_hard_gate():
    result = grade_prompt_output(WULF_CASE, UNGROUNDED_WULF)
    assert "neutral_has_numeric_levels" in result.hard_failures
    assert result.eligible is False


def test_grounded_neutral_case_is_eligible_and_scores_high():
    result = grade_prompt_output(WULF_CASE, GROUNDED_WULF)
    assert result.eligible is True
    assert result.weighted_score >= 90


def test_unknown_fact_id_fails_hard_gate():
    bad = json.loads(GROUNDED_WULF)
    bad["description"] = "Support at 25 [fib.level] holds."  # fact id not allowed for this case
    result = grade_prompt_output(WULF_CASE, json.dumps(bad))
    assert "cited_unknown_fact" in result.hard_failures
    assert result.eligible is False


def test_invalid_json_fails_hard_gate():
    result = grade_prompt_output(WULF_CASE, "not json")
    assert "invalid_json" in result.hard_failures
    assert result.eligible is False


def test_compare_rejects_candidate_with_case_regression_over_ten_points():
    baseline = _summary(weighted_mean=80.0, per_case={"wulf_bb_sparse": 90.0})
    candidate = _summary(weighted_mean=83.0, per_case={"wulf_bb_sparse": 78.0})
    decision = compare_candidates(baseline, candidate)
    assert decision.accepted is False
    assert "case_regression" in decision.reasons


def test_compare_accepts_candidate_meeting_all_thresholds():
    baseline = _summary(weighted_mean=80.0, per_case={"wulf_bb_sparse": 90.0})
    candidate = _summary(weighted_mean=83.0, per_case={"wulf_bb_sparse": 88.0})
    decision = compare_candidates(baseline, candidate)
    assert decision.accepted is True


def _summary(*, weighted_mean: float, per_case: dict[str, float]):
    from services.ai_prompt_eval import PromptEvalSummary

    return PromptEvalSummary(
        candidate="test",
        weighted_mean=weighted_mean,
        per_case_scores=per_case,
        hard_gate_failures=0,
        mean_actual_cost_usd=0.001,
        mean_latency_ms=900.0,
    )
```

- [ ] **Step 3: Run the grader test red**

```bash
cd backend
uv run python -m pytest tests/test_ai_prompt_eval.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'services.ai_prompt_eval'`.

- [ ] **Step 4: Implement deterministic grading**

Create `backend/services/ai_prompt_eval.py`. Use the production parser and the Slice 1 validation module. Do not call an LLM from `grade_prompt_output`:

```python
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from types import MappingProxyType

from services.ai_signal_validation import (
    AISignalGroundingError,
    validate_signal_draft,
)
from tests.fixtures.ai_prompt_eval_cases import PromptEvalCase

_FACT_CITATION = re.compile(r"\[([a-z0-9_.]+)\]")

PROMPT_EVAL_WEIGHTS = MappingProxyType(
    {
        "factual_grounding": 35,
        "direction_consistency": 20,
        "actionability": 15,
        "caution_coverage": 10,
        "concision": 10,
        "schema_reliability": 10,
    }
)

# Improvement / regression thresholds (Candidate Acceptance section).
_MIN_MEAN_IMPROVEMENT = 2.0
_MAX_CASE_REGRESSION = 10.0
_MAX_COST_LATENCY_REGRESSION = 0.10


@dataclass(frozen=True)
class PromptEvalResult:
    case_id: str
    eligible: bool
    weighted_score: int
    dimension_scores: dict[str, int]
    hard_failures: list[str]


@dataclass(frozen=True)
class PromptEvalSummary:
    candidate: str
    weighted_mean: float
    per_case_scores: dict[str, float]
    hard_gate_failures: int
    mean_actual_cost_usd: float
    mean_latency_ms: float


@dataclass(frozen=True)
class CandidateDecision:
    accepted: bool
    reasons: list[str] = field(default_factory=list)


def _cited_fact_ids(text: str) -> set[str]:
    return set(_FACT_CITATION.findall(text))


def grade_prompt_output(case: PromptEvalCase, output: str) -> PromptEvalResult:
    hard_failures: list[str] = []

    try:
        raw = json.loads(output)
    except json.JSONDecodeError:
        return PromptEvalResult(case.case_id, False, 0, {}, ["invalid_json"])

    try:
        validated = validate_signal_draft(raw)
    except AISignalGroundingError as exc:
        message = str(exc).lower()
        if "neutral cannot contain numeric" in message:
            hard_failures.append("neutral_has_numeric_levels")
        elif "geometry" in message:
            hard_failures.append("invalid_geometry")
        elif "schema" in message or "direction" in message:
            hard_failures.append("invalid_schema")
        else:
            hard_failures.append("grounding_error")
        return PromptEvalResult(case.case_id, False, 0, {}, hard_failures)

    if validated.direction not in case.allowed_directions:
        hard_failures.append("direction_not_allowed")

    cited = _cited_fact_ids(validated.description) | {
        fid for c in validated.confirmations for fid in _cited_fact_ids(c)
    }
    if cited - case.allowed_fact_ids:
        hard_failures.append("cited_unknown_fact")

    if case.insufficient_for_levels and validated.entry.price is not None:
        hard_failures.append("numeric_level_in_insufficient_case")

    if hard_failures:
        return PromptEvalResult(case.case_id, False, 0, {}, hard_failures)

    dimension_scores = _score_dimensions(case, validated, cited)
    weighted = sum(
        round(dimension_scores[name] * weight / 100)
        for name, weight in PROMPT_EVAL_WEIGHTS.items()
    )
    return PromptEvalResult(case.case_id, True, weighted, dimension_scores, [])


def _score_dimensions(case, validated, cited: set[str]) -> dict[str, int]:
    grounding = 100 if cited and cited <= case.allowed_fact_ids else 70
    direction = 100 if validated.direction in case.allowed_directions else 0
    actionability = (
        100
        if case.insufficient_for_levels or validated.entry.price is not None
        else 60
    )
    caution_text = " ".join(validated.cautions).lower()
    covered = sum(1 for concept in case.required_caution_concepts if concept in caution_text)
    caution = (
        100
        if not case.required_caution_concepts
        else round(100 * covered / len(case.required_caution_concepts))
    )
    concision = 100 if len(validated.description) <= 600 else 70
    schema = 100  # single deterministic parse succeeded
    return {
        "factual_grounding": grounding,
        "direction_consistency": direction,
        "actionability": actionability,
        "caution_coverage": caution,
        "concision": concision,
        "schema_reliability": schema,
    }


def compare_candidates(
    baseline: PromptEvalSummary, candidate: PromptEvalSummary
) -> CandidateDecision:
    reasons: list[str] = []

    if candidate.hard_gate_failures > 0:
        reasons.append("hard_gate_failure")
    if candidate.weighted_mean - baseline.weighted_mean < _MIN_MEAN_IMPROVEMENT:
        reasons.append("insufficient_improvement")
    for case_id, base_score in baseline.per_case_scores.items():
        cand_score = candidate.per_case_scores.get(case_id, 0.0)
        if base_score - cand_score > _MAX_CASE_REGRESSION:
            reasons.append("case_regression")
            break
    if _regressed(candidate.mean_actual_cost_usd, baseline.mean_actual_cost_usd):
        reasons.append("cost_regression")
    if _regressed(candidate.mean_latency_ms, baseline.mean_latency_ms):
        reasons.append("latency_regression")

    return CandidateDecision(accepted=not reasons, reasons=reasons)


def _regressed(candidate_value: float, baseline_value: float) -> bool:
    if baseline_value <= 0:
        return False
    return (candidate_value - baseline_value) / baseline_value > _MAX_COST_LATENCY_REGRESSION
```

- [ ] **Step 5: Run the grader test green**

```bash
cd backend
uv run python -m pytest tests/test_ai_prompt_eval.py -q
uv run ruff check services/ai_prompt_eval.py tests/fixtures/ai_prompt_eval_cases.py tests/test_ai_prompt_eval.py
```

Expected: PASS, no new Ruff findings.

- [ ] **Step 6: Commit Slice 2**

```bash
git add backend/services/ai_prompt_eval.py backend/tests/fixtures/ai_prompt_eval_cases.py backend/tests/test_ai_prompt_eval.py
git commit -m "test: add grounded ai prompt evaluations"
```

**Checkpoint:** Stop and review the case set and fixed weights. Do not tune the prompt until the user agrees the graders reflect product quality.

---

## Slice 3: HITL — Run the Controlled Prompt Candidate Loop

**Critical promise protected:** "Secrets and private data stay only in approved locations." The live runner reads the OS-keychain key through the existing services and must never print, return, or persist the key or raw prompts/completions. **The runner's secret-handling boundary IS a critical promise — its offline boundary test is the one required new test for this slice.** Candidate iteration itself is HITL and verified by the Slice 2 graders plus manual review; per-candidate prompt/fact changes do not each get their own test (testing.md budget).

**Proof target:** One narrowly changed prompt candidate beats the recorded baseline without grounding, cost, latency, or case-level regression, and no secret ever leaves an approved location.

**Files:**
- Create: `backend/scripts/evaluate_ai_prompt.py`
- Create: `backend/tests/test_ai_prompt_eval_runner.py`
- Modify one candidate at a time: `backend/services/prompt_builder.py` or one fact builder
- Modify when the BB candidate is selected: `backend/services/prompt_facts/bbands.py`
- Update after approval: `docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md`

**Interfaces:**
- CLI:

```bash
uv run python scripts/evaluate_ai_prompt.py \
  --model z-ai/glm-5.2 \
  --candidate baseline \
  --repetitions 1 \
  --live
```

- `run_prompt_eval(model, candidate, repetitions, provider) -> PromptEvalSummary` is the testable async core.
- The script reads the OpenRouter provider config and API key through `AISettingsService` and `AIKeyStore`; it never accepts a key argument.
- The script prints case scores, hard failures, token counts, actual cost, latency, and aggregate comparison. Raw prompts and completions remain in memory and are not written to disk.

- [ ] **Step 1: Write the failing runner boundary test (the critical-promise test)**

Create `backend/tests/test_ai_prompt_eval_runner.py`. Use injected fakes so the test never touches the network or a real key:

```python
import asyncio
from decimal import Decimal

import pytest

from scripts.evaluate_ai_prompt import run_prompt_eval

FAKE_KEY = "sk-or-fake-secret-value"


class _FakeProvider:
    def __init__(self):
        self.closed = False

    async def chat_with_metadata(self, *, model, messages):
        return {
            "content": '{"direction": "NEUTRAL", "confidence": 20,'
            ' "description": "Insufficient evidence [bbands.percent_b]; single verified fact.",'
            ' "entry": {"price": null, "note": "No grounded level"},'
            ' "stop": {"price": null, "note": "No grounded level"},'
            ' "target": {"price": null, "note": "No grounded level"},'
            ' "confirmations": [], "cautions": ["Single verified fact", "Insufficient evidence"],'
            ' "meta": {"risk_reward": null, "score": "2/10", "adx_trend": null, "volume_signal": null}}',
            "input_tokens": 500,
            "output_tokens": 100,
            "actual_cost_usd": Decimal("0.0010"),
            "latency_ms": 800.0,
            "provider_request_id": "req_test",
        }

    async def aclose(self):
        self.closed = True


def test_runner_executes_all_cases_offline():
    provider = _FakeProvider()
    summary = asyncio.run(
        run_prompt_eval(
            model="z-ai/glm-5.2",
            candidate="baseline",
            repetitions=1,
            provider=provider,
        )
    )
    assert summary.cases_run == 6
    assert provider.closed is True


def test_runner_never_leaks_api_key():
    provider = _FakeProvider()
    summary = asyncio.run(
        run_prompt_eval(
            model="z-ai/glm-5.2",
            candidate="baseline",
            repetitions=1,
            provider=provider,
            api_key=FAKE_KEY,
        )
    )
    serialized = summary.model_dump_json() if hasattr(summary, "model_dump_json") else str(summary)
    assert FAKE_KEY not in serialized


def test_runner_rejects_out_of_range_repetitions():
    provider = _FakeProvider()
    with pytest.raises(ValueError, match="repetitions"):
        asyncio.run(
            run_prompt_eval(
                model="z-ai/glm-5.2",
                candidate="baseline",
                repetitions=4,
                provider=provider,
            )
        )
```

`run_prompt_eval` returns a summary object that adds `cases_run` to the `PromptEvalSummary` fields; expose `cases_run` on the runner summary (a small dataclass that wraps or extends `PromptEvalSummary`). Whatever shape it has, its string/JSON form must not contain the key.

- [ ] **Step 2: Run the runner test red**

```bash
cd backend
uv run python -m pytest tests/test_ai_prompt_eval_runner.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.evaluate_ai_prompt'`.

- [ ] **Step 3: Implement the opt-in runner**

Create `backend/scripts/evaluate_ai_prompt.py`. The testable core accepts an injected provider; the CLI wires real services and requires `--live`:

```python
from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from decimal import Decimal

from services.ai_prompt_eval import (
    PromptEvalSummary,
    grade_prompt_output,
)
from services.prompt_builder import build_analysis_messages
from tests.fixtures.ai_prompt_eval_cases import EVAL_CASES

_MIN_REPS = 1
_MAX_REPS = 3


@dataclass(frozen=True)
class RunnerSummary:
    summary: PromptEvalSummary
    cases_run: int

    def model_dump_json(self) -> str:
        return (
            f'{{"candidate": "{self.summary.candidate}", '
            f'"weighted_mean": {self.summary.weighted_mean}, '
            f'"cases_run": {self.cases_run}}}'
        )

    def __str__(self) -> str:  # never includes secrets
        return self.model_dump_json()


async def run_prompt_eval(
    *,
    model: str,
    candidate: str,
    repetitions: int,
    provider,
    api_key: str | None = None,
) -> RunnerSummary:
    if not (_MIN_REPS <= repetitions <= _MAX_REPS):
        raise ValueError(f"repetitions must be between {_MIN_REPS} and {_MAX_REPS}")
    # api_key is intentionally never stored on the summary, logged, or returned.

    per_case_scores: dict[str, float] = {}
    hard_failures = 0
    costs: list[Decimal] = []
    latencies: list[float] = []

    try:
        for case in EVAL_CASES:
            case_scores: list[int] = []
            for _ in range(repetitions):
                messages = build_analysis_messages(case.candles, candidate=candidate)
                response = await provider.chat_with_metadata(model=model, messages=messages)
                result = grade_prompt_output(case, response["content"])
                if not result.eligible:
                    hard_failures += 1
                case_scores.append(result.weighted_score)
                costs.append(Decimal(str(response["actual_cost_usd"])))
                latencies.append(float(response["latency_ms"]))
            per_case_scores[case.case_id] = sum(case_scores) / len(case_scores)
    finally:
        await provider.aclose()

    weighted_mean = (
        sum(per_case_scores.values()) / len(per_case_scores) if per_case_scores else 0.0
    )
    summary = PromptEvalSummary(
        candidate=candidate,
        weighted_mean=weighted_mean,
        per_case_scores=per_case_scores,
        hard_gate_failures=hard_failures,
        mean_actual_cost_usd=float(sum(costs) / len(costs)) if costs else 0.0,
        mean_latency_ms=sum(latencies) / len(latencies) if latencies else 0.0,
    )
    return RunnerSummary(summary=summary, cases_run=len(per_case_scores))


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="HITL OpenRouter prompt evaluation")
    parser.add_argument("--model", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--repetitions", type=int, default=1)
    parser.add_argument("--live", action="store_true", required=False)
    parser.add_argument("--confirm-cost", action="store_true", required=False)
    return parser.parse_args(argv)


async def _main(args: argparse.Namespace) -> None:
    if not args.live:
        raise SystemExit("Refusing to run: live evaluation requires --live")

    # Real wiring: read provider config + keychain key through existing services.
    from services.ai_settings import AISettingsService
    from services.ai_key_store import AIKeyStore
    from providers.openrouter import OpenRouterProvider

    settings = AISettingsService()
    key_store = AIKeyStore()
    config = settings.get_provider_config("openrouter")
    api_key = key_store.get_key("openrouter")  # raises typed error if absent
    provider = OpenRouterProvider(api_key=api_key, config=config)

    preview_max = _preview_max_cost_usd(args)
    print(
        f"Model={args.model} cases={len(EVAL_CASES)} "
        f"repetitions={args.repetitions} max_estimated_cost_usd~={preview_max}"
    )
    if not args.confirm_cost:
        answer = input("Proceed with live spend? type 'yes': ").strip().lower()
        if answer != "yes":
            raise SystemExit("Aborted before any live call")

    runner = await run_prompt_eval(
        model=args.model,
        candidate=args.candidate,
        repetitions=args.repetitions,
        provider=provider,
        api_key=api_key,
    )
    _print_report(runner)


def _preview_max_cost_usd(args: argparse.Namespace) -> str:
    # Sum of per-case preview maxima; placeholder uses count*reps order of magnitude.
    return f"<= {len(EVAL_CASES) * args.repetitions} calls"


def _print_report(runner: "RunnerSummary") -> None:
    s = runner.summary
    print(f"cases_run={runner.cases_run} weighted_mean={s.weighted_mean:.1f}")
    for case_id, score in s.per_case_scores.items():
        print(f"  {case_id}: {score:.1f}")
    print(
        f"hard_gate_failures={s.hard_gate_failures} "
        f"mean_cost_usd={s.mean_actual_cost_usd:.4f} mean_latency_ms={s.mean_latency_ms:.0f}"
    )


if __name__ == "__main__":
    asyncio.run(_main(_parse_args()))
```

Catch only typed key-store/provider errors at the real-wiring boundary; never add a bare `except Exception` and never print the key (AGENTS.md rules 5 and 6). If the real `build_analysis_messages` signature differs, pass the candidate selector through the parameter that already exists rather than adding new public surface.

- [ ] **Step 4: Run the runner test green (offline)**

```bash
cd backend
uv run python -m pytest tests/test_ai_prompt_eval_runner.py tests/test_ai_prompt_eval.py -q
uv run ruff check scripts/evaluate_ai_prompt.py tests/test_ai_prompt_eval_runner.py
```

Expected: PASS without network or a real key, no new Ruff findings.

- [ ] **Step 5: Record the baseline with user approval (HITL, no new test)**

After the user approves live spend, run one response per case against one fixed model:

```bash
cd backend
uv run python scripts/evaluate_ai_prompt.py --model z-ai/glm-5.2 --candidate baseline --repetitions 1 --live
```

Capture from the printed report: hard-gate pass rate, weighted mean and per-case score, unsupported-level rate, schema success rate, mean input/output tokens, actual total cost, and mean latency. Do not persist raw prompts or completions; only aggregate numbers may be recorded.

- [ ] **Step 6: Iterate one variable at a time (HITL)**

Candidate order:

1. `neutral-null wording`: already introduced in Slice 1; measure it against baseline history.
2. `canonical indicator hints`: derive enabled hints from `indicator_names` so UI aliases such as `BB` cannot suppress `bbands` guidance.
3. `verified BB levels`: emit one `bbands.current_levels` fact containing current upper, middle, and lower values (modify `backend/services/prompt_facts/bbands.py`).
4. `concise evidence-first output`: require each conclusion sentence to include its supporting fact IDs and remove duplicated system/user instructions.

For each candidate:

1. Make only that one candidate change in `prompt_builder.py` or one fact builder.
2. Re-run the deterministic graders (no new test needed — Slice 2 covers grader correctness):

   ```bash
   cd backend
   uv run python -m pytest tests/test_ai_prompt_eval.py -q
   ```

3. Run one live response per case after user cost confirmation:

   ```bash
   uv run python scripts/evaluate_ai_prompt.py --model z-ai/glm-5.2 --candidate <candidate-name> --repetitions 1 --live
   ```

4. Accept or reject using `compare_candidates` against the recorded baseline.
5. Revert a rejected candidate with a normal patch or `git revert`; never use destructive reset commands.

- [ ] **Step 7: Confirm the finalist (HITL)**

Run three responses per case:

```bash
cd backend
uv run python scripts/evaluate_ai_prompt.py --model z-ai/glm-5.2 --candidate <finalist> --repetitions 3 --live
```

Require the Candidate Acceptance thresholds. Present representative outputs and score/cost/latency deltas to the user. Do not promote automatically.

- [ ] **Step 8: Promote the user-approved prompt version**

Add a source constant to `backend/services/prompt_builder.py`:

```python
ANALYSIS_PROMPT_VERSION = "2026-06-20-grounded-v1"
```

Include the version in eval summaries and non-secret run metadata only if the existing usage schema accepts it without a migration; otherwise keep it in source and the completion report. Do not add a database migration solely for prompt versioning.

Update `docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md` with the strict neutral contract, deterministic validator, eval loop, accepted candidate, model used, aggregate scores, and the date 2026-06-20. Do not include raw prompts or responses.

- [ ] **Step 9: Run final verification**

```bash
cd backend
uv run python -m pytest tests/test_ai_signal_validation.py tests/test_ai_prompt_eval.py tests/test_ai_prompt_eval_runner.py -q
uv run ruff check services/ai_signal_validation.py services/ai_prompt_eval.py services/prompt_builder.py services/prompt_facts/bbands.py scripts/evaluate_ai_prompt.py
cd ..
npm run typecheck
npm run build
npm run check:policy-drift
git diff --check
```

Expected: PASS with no new Ruff findings. Manual smoke: confirm the AI panel still renders honest neutral/null and valid directional cards.

- [ ] **Step 10: Commit the approved candidate and documentation**

```bash
git add backend/services/prompt_builder.py backend/services/prompt_facts/bbands.py backend/scripts/evaluate_ai_prompt.py backend/tests/test_ai_prompt_eval_runner.py docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md
git commit -m "feat: add grounded ai prompt evaluation loop"
```

**HITL checkpoint:** Stop. The user must approve the new real-model evidence before the parent OpenRouter smoke gate resumes. Run `policy-drift-check` before merging to `dev`.

## Out of Scope

- Automatic production prompt mutation.
- Automatic eval-weight tuning.
- Fine-tuning or reinforcement learning.
- LLM judging of factual correctness.
- Model routing based on eval score.
- Dynamic per-user prompt variants.
- Complete deterministic provenance for every possible derived technical-analysis price. The strict neutral gate, geometry checks, verified facts, and eval cases are the bounded first improvement.
- Fixing chart-context modes that currently do not affect prompt facts; that requires its own visible product decision and plan.
- Follow-up chat without parseable structured signal remains conversational and retains the previous validated card. Full grounding of arbitrary follow-up prose requires a separate product decision and is not part of this remediation.

## Acceptance Criteria

- The WULF BB-only case cannot display numeric trade levels.
- Neutral and insufficient-evidence output is honest and visually stable.
- Directional geometry and R:R are validated locally.
- Fixed deterministic cases and weights exist before prompt tuning.
- Prompt candidates change one variable at a time.
- No candidate with a grounding failure can win on weighted score.
- Live evals are explicit, cost-confirmed, keychain-backed, and absent from CI.
- Raw live prompts and completions are not persisted, and no test or summary leaks an API key.
- The production prompt changes only after finalist repetition and user approval.

## Execution Instruction

Execute Slice 1 only after the UX lifecycle plan is complete. Follow `orbit-ai-workflow`: implement the tracer-bullet slice, run only the slice's critical-promise test plus typecheck/build/policy/manual smoke, commit the verified sparse-evidence tracer bullet, then stop before building the wider evaluation harness. Update `PROJECT_PLAN.md` before and after each slice.
