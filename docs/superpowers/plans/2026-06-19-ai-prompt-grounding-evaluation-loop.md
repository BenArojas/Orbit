# AI Prompt Grounding and Evaluation Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unsupported trade levels, measure prompt quality against stable cases, and improve the production prompt through small evidence-backed iterations.

**Architecture:** Put deterministic signal validation between model output and the UI, then evaluate prompt candidates against fixed synthetic market cases. Hard grounding and schema checks decide whether a candidate is eligible; a stable weighted score compares eligible candidates. Live OpenRouter evaluation is an explicit HITL command using the existing OS-keychain credential path, never part of normal tests or automatic production mutation.

**Tech Stack:** Python 3.12, Pydantic v2, pytest, existing prompt-fact pipeline and OpenRouter adapter; React 19/TypeScript for nullable level rendering; no prompt-optimization dependency.

**Status:** APPROVED FOR EXECUTION on 2026-06-19 and QUEUED after the UX lifecycle plan. `PROJECT_PLAN.md` tracks the dependency. Do not begin until the UX plan is complete and reviewed; then execute Slice 1 only.

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
- Use TDD through public prompt, validator, API, and component interfaces.
- Stop after every slice for review.

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

**Proposed public-contract and safety-behavior change.** The signal contract will allow absent numeric levels and R:R for `NEUTRAL`/insufficient evidence. Files affected include `backend/services/ai.py`, `backend/models/__init__.py`, `src/components/ai/ActionSignalCard.tsx`, `src/modules/parallax/api.ts`, and the active cloud-AI design. This reduces unsupported financial guidance and does not expand AI authority.

## File Map

- Create `backend/services/ai_signal_validation.py`: deep module for raw signal schema, deterministic validation, safe fallback, and R:R calculation.
- Create `backend/services/ai_prompt_eval.py`: eval cases/results, hard gates, fixed weighted score, and candidate comparison.
- Create `backend/scripts/evaluate_ai_prompt.py`: explicit local/HITL runner; no normal-test or startup integration.
- Create `backend/tests/fixtures/ai_prompt_eval_cases.py`: synthetic sparse and directional cases.
- Create `backend/tests/test_ai_signal_validation.py`: strict contract behavior.
- Create `backend/tests/test_ai_prompt_eval.py`: grader and score behavior.
- Modify `backend/services/prompt_builder.py`: neutral-null instruction, canonical hints, prompt version constant, and one candidate change at a time.
- Modify `backend/services/prompt_facts/bbands.py`: expose verified current band levels as facts.
- Modify `backend/services/ai.py`: validate before frontend conversion and calculate R:R locally.
- Modify `backend/models/__init__.py`: nullable structured signal contracts if a route-facing model is introduced.
- Modify `src/components/ai/ActionSignalCard.tsx`: honest absent-level rendering.
- Modify `src/modules/parallax/api.ts`: preserve `SignalData` while allowing absent level display values.
- Update `docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md` only after a candidate is approved.

---

## Slice 1: HITL - Sparse Evidence Produces an Honest Signal End to End

**Proof target:** The observed WULF BB-only case cannot display invented prices, even if a model returns valid-looking JSON containing them.

**Files:**
- Create: `backend/services/ai_signal_validation.py`
- Create: `backend/tests/test_ai_signal_validation.py`
- Modify: `backend/services/prompt_builder.py`
- Modify: `backend/services/ai.py`
- Modify: `backend/tests/test_ai_confidence.py`
- Modify: `src/components/ai/ActionSignalCard.tsx`
- Modify: `src/components/ai/__tests__/ActionSignalCard.test.tsx`

**Interfaces:**
- Produces `validate_signal_draft(raw: object) -> ValidatedSignal`.
- Produces `safe_neutral_signal(reason: str) -> ValidatedSignal`.
- Keeps the existing frontend `SignalData` shape; absent levels use display value `—` and explanatory subtext.

- [ ] **Step 1: Write failing strict-contract tests**

Define the public schema in the test through the wished-for API:

```python
def test_neutral_rejects_numeric_trade_levels():
    raw = {
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

    with pytest.raises(AISignalGroundingError, match="NEUTRAL cannot contain numeric trade levels"):
        validate_signal_draft(raw)
```

Add tests for valid neutral-null, LONG and SHORT geometry, confidence bounds, invalid direction, and server R:R:

```python
assert calculate_risk_reward(direction="LONG", entry=27, stop=25.5, target=31.5) == Decimal("3")
```

- [ ] **Step 2: Run validation tests red**

```bash
cd backend
uv run python -m pytest tests/test_ai_signal_validation.py -q
```

Expected: FAIL because the validation module does not exist.

- [ ] **Step 3: Implement the small validation module**

Use Pydantic models with nullable levels and a frozen evidence input:

```python
Direction = Literal["STRONG LONG", "LONG", "NEUTRAL", "SHORT", "STRONG SHORT"]

class SignalLevelDraft(BaseModel):
    price: Decimal | None
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

```

Validation rules are exactly the direction, nullability, confidence, geometry,
and arithmetic rules in the Resolved Product Contract above. Return a
normalized copy whose `risk_reward` is generated locally. Case-specific fact
availability belongs to the deterministic eval module in Slice 2 rather than
the production signal schema.

- [ ] **Step 4: Run validation tests green**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Write the failing safe-finalization behavior**

Through the existing validation and frontend-conversion interfaces, prove that
the supplied WULF-style raw signal becomes a safe neutral signal rather than a
numeric card:

```python
try:
    validated = validate_signal_draft(raw_signal)
except AISignalGroundingError:
    validated = safe_neutral_signal("Insufficient verified evidence for numeric trade levels")
result = signal_to_frontend_format(validated.model_dump(mode="python"))
assert result["direction"] == "NEUTRAL"
assert [level["value"] for level in result["levels"]] == ["—", "—", "—"]
assert next(item for item in result["meta"] if item["label"] == "R:R")["value"] == "—"
```

- [ ] **Step 6: Integrate validation before frontend conversion**

Replace direct acceptance of parsed JSON with:

```python
try:
    validated = validate_signal_draft(raw_signal)
except (ValidationError, AISignalGroundingError) as exc:
    log.warning("Rejected ungrounded AI signal: %s", exc)
    validated = safe_neutral_signal("Insufficient verified evidence for numeric trade levels")
return signal_to_frontend_format(validated.model_dump(mode="python"))
```

Do not silently coerce an invalid direction or numeric neutral plan into a directional plan.

- [ ] **Step 7: Make the production prompt state the approved contract**

Change only the neutral/insufficient-evidence clauses and JSON schema in this slice:

```text
- NEUTRAL: mixed or insufficient verified evidence. Do not invent a trade plan.
- If verified facts do not contain enough information to support numeric levels, return NEUTRAL and set entry, stop, target, and risk_reward to null.
- Never estimate an indicator value, support/resistance level, or price target that is absent from Verified Facts.
```

JSON uses:

```json
"entry": {"price": null, "note": "No grounded level"},
"stop": {"price": null, "note": "No grounded level"},
"target": {"price": null, "note": "No grounded level"},
"meta": {"risk_reward": null}
```

Directional examples retain numeric placeholders.

- [ ] **Step 8: Write and implement the absent-level card behavior**

Render three stable cards for layout continuity, using `—` and `No grounded level`. Do not hide the section or show `$0.00`.

Run:

```bash
npm test -- src/components/ai/__tests__/ActionSignalCard.test.tsx
```

Expected: PASS after observing the new test fail first.

- [ ] **Step 9: Run Slice 1 verification**

```bash
cd backend
uv run python -m pytest tests/test_ai_signal_validation.py tests/test_ai_confidence.py tests/test_ai_provider_registry.py tests/test_ai_provider_routes.py -q
cd ..
npm test -- src/components/ai/__tests__/ActionSignalCard.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 10: Commit Slice 1**

```bash
git add backend/services/ai_signal_validation.py backend/tests/test_ai_signal_validation.py backend/services/prompt_builder.py backend/services/ai.py backend/tests/test_ai_confidence.py src/components/ai/ActionSignalCard.tsx src/components/ai/__tests__/ActionSignalCard.test.tsx
git commit -m "fix: reject ungrounded ai trade levels"
```

**Checkpoint:** Stop. Demonstrate the WULF payload with a safe neutral/null result before building the optimization loop.

---

## Slice 2: AFK - Add Stable Cases and Deterministic Graders

**Proof target:** Orbit can grade the current prompt and any candidate against the same cases without a live provider or subjective reviewer.

**Files:**
- Create: `backend/services/ai_prompt_eval.py`
- Create: `backend/tests/fixtures/ai_prompt_eval_cases.py`
- Create: `backend/tests/test_ai_prompt_eval.py`
- Modify: `backend/tests/test_prompt_facts_eval.py`

**Interfaces:**
- Produces `grade_prompt_output(case: PromptEvalCase, output: str) -> PromptEvalResult`.
- Produces `compare_candidates(baseline: PromptEvalSummary, candidate: PromptEvalSummary) -> CandidateDecision`.
- Produces immutable `PROMPT_EVAL_WEIGHTS` matching the table above.

- [ ] **Step 1: Define six representative cases**

Use synthetic data only:

1. `wulf_bb_sparse`: close and `%B` only; must be neutral/null.
2. `tsm_extension`: bullish EMA stack plus stretched RSI; directional analysis allowed.
3. `aapl_fib_pullback`: verified fib and EMA levels; numeric levels allowed.
4. `nvda_ema_extension`: strong trend plus overextension cautions.
5. `conflicting_timeframes`: higher bullish, lower bearish; must not be strong direction.
6. `missing_adx_volume`: output must say unavailable rather than invent values.

Each case declares `allowed_fact_ids`, `insufficient_for_levels`, allowed direction set, and required caution concepts. Reuse `tests/fixtures/eval_scenarios.py` builders rather than duplicating candle data.

- [ ] **Step 2: Write failing grader tests**

Cover:

```python
result = grade_prompt_output(wulf_case, ungrounded_wulf_response)
assert "neutral_has_numeric_levels" in result.hard_failures
assert result.eligible is False

result = grade_prompt_output(wulf_case, grounded_wulf_response)
assert result.eligible is True
assert result.weighted_score >= 90
```

Also prove unknown fact IDs fail, invalid geometry fails, score weights total 100, and a candidate cannot pass with one regressed case over 10 points.

- [ ] **Step 3: Run grader tests red**

```bash
cd backend
uv run python -m pytest tests/test_ai_prompt_eval.py -q
```

Expected: FAIL because the eval module and cases do not exist.

- [ ] **Step 4: Implement deterministic grading**

Use the production parser and validation module. Do not call an LLM from `grade_prompt_output`. Parse bracketed citations with one compiled regex and compare against the case's `allowed_fact_ids`.

Represent scores as integers from 0 through 100 and include per-dimension values plus hard-failure codes. `compare_candidates` enforces the Candidate Acceptance section exactly.

- [ ] **Step 5: Run deterministic evals green**

```bash
uv run python -m pytest tests/test_ai_prompt_eval.py tests/test_prompt_facts_eval.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit Slice 2**

```bash
git add backend/services/ai_prompt_eval.py backend/tests/fixtures/ai_prompt_eval_cases.py backend/tests/test_ai_prompt_eval.py backend/tests/test_prompt_facts_eval.py
git commit -m "test: add grounded ai prompt evaluations"
```

**Checkpoint:** Stop and review the case set and fixed weights. Do not tune the prompt until the user agrees the graders reflect product quality.

---

## Slice 3: HITL - Run the Controlled Prompt Candidate Loop

**Proof target:** One narrowly changed prompt candidate beats the recorded baseline without grounding, cost, latency, or case-level regression.

**Files:**
- Create: `backend/scripts/evaluate_ai_prompt.py`
- Test: `backend/tests/test_ai_prompt_eval_runner.py`
- Modify one candidate at a time: `backend/services/prompt_builder.py` or one fact builder
- Modify when BB candidate is selected: `backend/services/prompt_facts/bbands.py`
- Test: `backend/tests/test_prompt_builder_facts.py`
- Test: `backend/tests/test_prompt_facts_bbands.py`
- Update after approval: `docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md`

**Interfaces:**
- CLI:

```bash
uv run python scripts/evaluate_ai_prompt.py \
  --model z-ai/glm-5.2 \
  --candidate baseline \
  --repetitions 1
```

- The script reads the existing OpenRouter provider config and API key through `AISettingsService` and `AIKeyStore`; it never accepts a key argument.
- The script prints case scores, hard failures, token counts, actual cost, latency, and aggregate comparison. Raw prompts and completions remain in memory and are not written to disk.

- [ ] **Step 1: Write the failing CLI boundary tests**

Use injected fake provider and key-store dependencies. Assert:

```python
summary = await run_prompt_eval(
    model="z-ai/glm-5.2",
    candidate="baseline",
    repetitions=1,
    provider=fake_provider,
)
assert summary.cases_run == 6
assert summary.total_actual_cost_usd == Decimal("0.0060")
assert api_key not in summary.model_dump_json()
```

Prove `repetitions` is restricted to 1 through 3 and the runner refuses execution without explicit `--live`.

- [ ] **Step 2: Implement the opt-in runner**

The parser requires `--live`. Before sending, print the selected model, case count, repetitions, and the sum of preview maximum costs; require an interactive `yes` unless `--confirm-cost` is also supplied by the human operator.

Use existing `OpenRouterProvider.chat_with_metadata` and close it in `finally`. Catch only typed key-store/provider errors. Never print the key.

- [ ] **Step 3: Run the offline runner tests**

```bash
cd backend
uv run python -m pytest tests/test_ai_prompt_eval_runner.py tests/test_ai_prompt_eval.py -q
```

Expected: PASS without network or a real key.

- [ ] **Step 4: Record the baseline with user approval**

Run one response per case against one fixed model. Report:

- hard-gate pass rate;
- weighted mean and per-case score;
- unsupported-level rate;
- schema success rate;
- mean input/output tokens;
- actual total cost;
- mean latency.

Do not persist raw prompts or completions.

- [ ] **Step 5: Iterate one variable at a time**

Candidate order:

1. `neutral-null wording`: already introduced in Slice 1; measure it against baseline history.
2. `canonical indicator hints`: derive enabled hints from `indicator_names` so UI aliases such as `BB` cannot suppress `bbands` guidance.
3. `verified BB levels`: emit one `bbands.current_levels` fact containing current upper, middle, and lower values.
4. `concise evidence-first output`: require each conclusion sentence to include its supporting fact IDs and remove duplicated system/user instructions.

For each candidate:

1. Add or update one failing public prompt/fact test.
2. Run it red.
3. Make only that candidate change.
4. Run deterministic tests green.
5. Run one live response per case after user cost confirmation.
6. Reject or retain the candidate using `compare_candidates`.
7. Revert rejected candidate code with a normal patch or commit reversal; never use destructive reset commands.

- [ ] **Step 6: Confirm the finalist**

Run three responses per case. Require the Candidate Acceptance thresholds. Present representative outputs and score/cost/latency deltas to the user. Do not promote automatically.

- [ ] **Step 7: Promote the user-approved prompt version**

Add a simple source constant such as:

```python
ANALYSIS_PROMPT_VERSION = "2026-06-19-grounded-v1"
```

Include the version in eval summaries and non-secret run metadata only if the existing usage schema can accept it without a migration; otherwise keep it in source and the completion report. Do not add a database migration solely for prompt versioning.

Update the active cloud design with the strict neutral contract, deterministic validator, eval loop, accepted candidate, model used, aggregate scores, and date. Do not include raw prompts or responses.

- [ ] **Step 8: Run final verification**

```bash
cd backend
uv run python -m pytest tests/test_ai_signal_validation.py tests/test_ai_prompt_eval.py tests/test_ai_prompt_eval_runner.py tests/test_prompt_builder_facts.py tests/test_prompt_facts_bbands.py tests/test_prompt_facts_eval.py tests/test_ai_confidence.py tests/test_ai_provider_routes.py -q
uv run ruff check services/ai_signal_validation.py services/ai_prompt_eval.py services/prompt_builder.py services/prompt_facts/bbands.py scripts/evaluate_ai_prompt.py tests/test_ai_signal_validation.py tests/test_ai_prompt_eval.py tests/test_ai_prompt_eval_runner.py
cd ..
npm test -- src/components/ai/__tests__/ActionSignalCard.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx
npm run build
npm run check:policy-drift
git diff --check
```

Expected: PASS with no new Ruff findings.

- [ ] **Step 9: Commit the approved candidate and documentation**

```bash
git add backend/services/ai_signal_validation.py backend/services/ai_prompt_eval.py backend/services/prompt_builder.py backend/services/prompt_facts/bbands.py backend/scripts/evaluate_ai_prompt.py backend/tests/test_ai_signal_validation.py backend/tests/test_ai_prompt_eval.py backend/tests/test_ai_prompt_eval_runner.py backend/tests/test_prompt_builder_facts.py backend/tests/test_prompt_facts_bbands.py backend/tests/test_prompt_facts_eval.py backend/tests/fixtures/ai_prompt_eval_cases.py src/components/ai/ActionSignalCard.tsx src/components/ai/__tests__/ActionSignalCard.test.tsx docs/superpowers/specs/2026-06-05-orbit-v2-cloud-hybrid-ai-design.md
git commit -m "feat: add grounded ai prompt evaluation loop"
```

**HITL checkpoint:** Stop. The user must approve the new real-model evidence before the parent OpenRouter smoke gate resumes.

## Out of Scope

- Automatic production prompt mutation.
- Automatic eval-weight tuning.
- Fine-tuning or reinforcement learning.
- LLM judging of factual correctness.
- Model routing based on eval score.
- Dynamic per-user prompt variants.
- Complete deterministic provenance for every possible derived technical-analysis price. The strict neutral gate, geometry checks, verified facts, and eval cases are the bounded first improvement.
- Fixing chart-context modes that currently do not affect prompt facts; that requires its own visible product decision and plan.

## Acceptance Criteria

- The WULF BB-only case cannot display numeric trade levels.
- Neutral and insufficient-evidence output is honest and visually stable.
- Directional geometry and R:R are validated locally.
- Fixed deterministic cases and weights exist before prompt tuning.
- Prompt candidates change one variable at a time.
- No candidate with a grounding failure can win on weighted score.
- Live evals are explicit, cost-confirmed, keychain-backed, and absent from CI.
- Raw live prompts and completions are not persisted.
- The production prompt changes only after finalist repetition and user approval.

## Execution Instruction

Execute Slice 1 only after the UX lifecycle plan is complete. Use TDD, commit the verified sparse-evidence tracer bullet, and stop before building the wider evaluation harness.
