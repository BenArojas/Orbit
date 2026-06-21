# AI Analysis Data and Grounding Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` task-by-task. Use `orbit-ai-workflow`, stop after each slice, and request review before continuing. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give local and cloud models correctly labelled candles plus enough explicitly groundable structural prices to produce complete entry/stop/target setups without weakening fail-closed validation.

**Architecture:** Keep IBKR and `IndicatorService` authoritative for OHLCV and indicator calculations. Reuse the canonical IBKR timeframe specifications, repair fact selection, and make existing selected-indicator prices visibly eligible for grounding. The LLM chooses among verified candidates; `validate_signal_draft()` remains authoritative.

**Tech Stack:** FastAPI/Python 3.12, existing Polars/pandas-ta bridge, Pydantic prompt facts, pytest. No dependency, frontend contract, database, provider, or token-limit change.

## Global Constraints

- Keep indicator selection user-controlled; do not silently enable EMA, BB, VWAP, or Fibonacci.
- Always expose current close as a grounded fact; expose other prices only for selected indicators.
- ATR remains a distance and must never enter `price_values`.
- Preserve exact fact-ID, cent matching, geometry, server-owned R:R, and deterministic `NEUTRAL` fallback.
- Do not change `max_tokens`, `max_completion_tokens`, `num_predict`, pricing, routing, key storage, or provider adapters.
- Use existing test files and one parameterized case where possible; do not add a dependency or broad test matrix.
- After plan approval, mark this remediation active in `PROJECT_PLAN.md` before Slice 1. Update it again only after all slices and manual smoke pass.

---

## Slice 1: Correct Candle Semantics and Restore EMA Facts

**Proof target:** AI `1H`, `4H`, `D`, and `W` requests use true bars with enough history, and selected `EMA Stack` results reach the rendered prompt.

**Files and anchors:**
- Modify `backend/routers/ai.py:575-580` (`AI_TIMEFRAME_MAP`) and `:622-675` (`_fetch_timeframe_data`).
- Reuse `backend/constants/ibkr_history.py:50-64` (`TIMEFRAME_SPEC`); do not duplicate period/bar values.
- Modify `backend/services/prompt_facts/__init__.py:31-39` (`_group_indicators`) or `:69-72` (`_build_for_tf`) so `ema_*` results are passed together to `build_ema_facts()`.
- Extend `backend/tests/test_ai_with_fibs.py:96-159` and `backend/tests/test_prompt_builder_facts.py`.

- [ ] Add one parameterized failing router test asserting: `1H -> TIMEFRAME_SPEC["1h"]`, `4H -> ["4h"]`, `D -> ["1D"]`, and `W -> ["1W"]`; assert the exact `ibkr.history(period=..., bar=...)` call.
- [ ] Replace the private period/bar table with a small UI-label-to-canonical-key map and resolve the `HistorySpec` inside `_fetch_timeframe_data()`.
- [ ] Add a failing prompt-pipeline test using `IndicatorResult(name="ema_9"...)` through `build_prompt_facts()`; require an emitted `D.ema.*` fact.
- [ ] Group names beginning with `ema_` as one EMA family without renaming the `IndicatorResult` objects.
- [ ] Run `cd backend && uv run python -m pytest tests/test_ai_with_fibs.py tests/test_prompt_builder_facts.py tests/test_prompt_facts_ema.py -q`; expect all pass.
- [ ] Commit only Slice 1 as `fix: correct ai timeframe and ema facts`, then stop for review.

---

## Slice 2: Expose Explicit Grounded Structural Candidates

**Proof target:** The rendered prompt and ephemeral grounding map agree on current close and every eligible selected-indicator price.

**Files and anchors:**
- Modify `backend/services/prompt_facts/__init__.py:42-53` (`_build_for_tf`) to emit `{TF}.price.current_close` with `price_values=(last_close,)` when close is positive.
- Modify `backend/services/prompt_facts/ema.py:26-137` (`build_ema_facts`) to emit one `levels_current` fact containing every available EMA value, including incomplete stacks.
- Modify `backend/services/prompt_facts/bbands.py:20-115` (`build_bbands_facts`) to always emit one `levels_current` fact containing lower, middle, and upper bands; retain existing squeeze/walk/outside facts.
- Modify `backend/services/prompt_facts/vwap.py:11-53` (`_make`, `build_vwap_facts`) so `price_above`/`price_below` carry `(last_close, vwap_val)` in `price_values`.
- Preserve `backend/services/prompt_facts/fibonacci.py:130-315`; its swing, retracement, convergence, and extension facts already carry explicit prices.
- Modify `backend/services/prompt_facts/render.py:14-21` (`_fact_line`) to append `Grounded price candidates: ...` only when `price_values` is non-empty.
- Extend `backend/tests/test_prompt_facts_ema.py:21-50`, `test_prompt_facts_bbands.py:27-67`, `test_prompt_facts_vwap.py:25-52`, and `test_prompt_facts_render.py:14-64`.

- [ ] Write focused failing assertions for the new fact IDs, exact cent-rounded candidate text, and `price_values`; include one incomplete EMA stack case.
- [ ] Implement the facts with existing `PromptFact`; do not introduce a new candidate model, role enum, or service.
- [ ] Render eligibility from `price_values` so prompt text and `_build_grounding_map()` use the same source of truth.
- [ ] Confirm ATR facts still have empty `price_values` and Fibonacci behavior is unchanged.
- [ ] Run `cd backend && uv run python -m pytest tests/test_prompt_facts_ema.py tests/test_prompt_facts_bbands.py tests/test_prompt_facts_vwap.py tests/test_prompt_facts_render.py tests/test_prompt_facts_fibonacci.py tests/test_prompt_facts_atr.py -q`; expect all pass.
- [ ] Commit only Slice 2 as `fix: expose grounded ai price candidates`, then stop for review.

---

## Slice 3: Align Guidance and Prove the Complete Grounding Path

**Proof target:** A prepared payload exposes role-understandable candidates, a valid directional response using them passes validation, and an invented price still fails closed.

**Files and anchors:**
- Modify `backend/services/prompt_builder.py:1224-1235` (`build_analysis_user_message`) and `:1264-1282` (`SIGNAL_INLINE_JSON_INSTRUCTION`).
- Exercise `backend/services/prompt_builder.py:45-69` (`_build_grounding_map`) and `:794-808` (`build_full_prompt_context_bundle`) without changing their ownership.
- Preserve `backend/services/ai_signal_validation.py:76-161` (`validate_signal_draft`) and `backend/services/ai.py:759-813` (finalization/fail-closed behavior).
- Extend `backend/tests/test_prompt_builder_facts.py` and `backend/tests/test_ai_signal_validation.py:153-183`.
- Update `docs/superpowers/plans/2026-06-19-ai-prompt-grounding-evaluation-loop.md` and `PROJECT_PLAN.md` after verification.

- [ ] Add a failing payload test requiring the prompt to say that only values explicitly labelled `Grounded price candidates` may be copied, while semantic fact text identifies EMA/BB/VWAP/Fibonacci support, resistance, entry, and target context.
- [ ] Add one integration-style test: build a real `PromptContextBundle`, select three geometry-valid candidate prices from its `grounding_map`, and verify `validate_signal_draft()` accepts them; change one price by one cent and verify rejection.
- [ ] Make the smallest prompt wording change needed. Do not add scoring weights, deterministic trade selection, hidden chain-of-thought, or another model call.
- [ ] Run `cd backend && uv run python -m pytest tests/test_prompt_builder_facts.py tests/test_ai_signal_validation.py tests/test_ai_analysis_preparation.py -q`.
- [ ] Run `npm run typecheck`, `npm run build`, `npm run check:policy-drift`, and `git diff --check`.
- [ ] Manually restart the backend and inspect one OpenRouter preview for each: EMA setup, BB/VWAP setup, Fibonacci setup, and sparse momentum-only `NEUTRAL`. Confirm true timeframe data, exact payload candidates, accepted directional geometry where evidence permits, and no invented prices.
- [ ] Record the manual evidence in this plan and `PROJECT_PLAN.md`. Do not run a paid call without explicit user approval.
- [ ] Commit Slice 3 as `fix: align ai grounding guidance with data`, then request final code review. Do not push or merge.

## Completion Gate

- All three slice reviews clear P0-P2 findings.
- Manual smoke proves at least one valid directional cloud result and one deterministic sparse-evidence `NEUTRAL` result.
- Existing AI Run Inspector receipt, fallback, Compare, and restart-persistence checks remain pending unless separately completed.
- Run the full relevant backend/frontend suites and `policy-drift-check` before requesting merge to `dev`.
