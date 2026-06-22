# AI Streaming Reliability: finish_reason + Reformat Context

> **For the coder agent:** Use `orbit-ai-workflow`. Two small independent slices.
> Implement A, verify, stop. Then B, verify, stop. Do not start C or D.

**Goal:** Make cloud-analysis failures diagnosable (A) and make the one JSON
recovery call preserve the model's original answer instead of re-deriving a new
one (B). Both are delivery-layer fixes; neither touches grounding, geometry, or
the trade-safety contract.

**Status:** APPROVED for execution 2026-06-21. A and B are independent — either
can ship alone.

**Out of scope (do NOT do these):**
- Raising token limits / changing the cost-derived `max_tokens`. Decide *after*
  A produces a `finish_reason` distribution.
- Prompt rewriting / semantic eval (idea D). Use the existing 2026-06-19 eval
  loop in a separate mission.
- "Recovered signal" status + UI badge (idea C). A makes this trivial later.
- Persisting `finish_reason` to the usage ledger / a DB migration. Live metadata
  → Inspector only. Ledger persistence is a separate decision.

---

## Slice A — Capture `finish_reason`

**Why:** Today a missing-JSON response is indistinguishable from a truncated one
or a provider-interrupted one. The provider reports the reason and Orbit drops
it (`ai_cloud_adapters.py` reads `choices[0]` but never reads `finish_reason`).

**Files:**
- `backend/models/__init__.py` — `AIProviderMetadata`
- `backend/services/ai_cloud_adapters.py` — `OpenRouterProvider`
- `src/components/ai/AiRunInspectorDialog.tsx` — display only

- [ ] **A1. Add the field.** In `AIProviderMetadata` (models/__init__.py:1079),
  add, following the existing `exclude_if` pattern:
  ```python
  finish_reason: Optional[str] = Field(default=None, exclude_if=lambda value: value is None)
  ```

- [ ] **A2. Capture it (non-stream).** In `OpenRouterProvider.chat_with_metadata`
  (ai_cloud_adapters.py:98), read `data["choices"][0].get("finish_reason")` and
  pass it to `_metadata(...)`.

- [ ] **A3. Capture it (stream).** In `chat_stream_with_metadata` (:126):
  OpenRouter sends `finish_reason` on the chunk where content stops, which may
  arrive *before* the final `usage` chunk. Track it in a local
  `finish_reason: str | None = None`, set it whenever a chunk has
  `choices[0].get("finish_reason")`, and pass the tracked value into the
  `_metadata(...)` call used for the emitted `metadata` event.

- [ ] **A4. Thread it through `_metadata`.** Add a `finish_reason: str | None = None`
  param to `OpenRouterProvider._metadata` (:298) and set it on the returned
  `AIProviderMetadata`. Other providers leave it `None` — do not touch them.

- [ ] **A5. Surface it in the Inspector.** In `AiRunInspectorDialog.tsx`, render
  `finish_reason` wherever provider metadata fields (model, tokens, cost) are
  already shown. Follow the existing field-rendering pattern. No new prop plumbing
  beyond what metadata already carries.

- [ ] **A6. Verify A.** One test only — the streaming ordering is the part that
  can break:
  ```bash
  cd backend && uv run pytest tests/ -k "openrouter and stream" -q
  ```
  Add/extend one adapter test (mock an OpenRouter stream where an early chunk
  carries `finish_reason: "length"` and a later chunk carries `usage`) asserting
  the emitted `metadata` event's `finish_reason == "length"`. Then:
  ```bash
  cd backend && uv run ruff check services/ai_cloud_adapters.py models/__init__.py
  cd .. && npm run typecheck && npm run build
  ```
  Manual smoke: run one real cloud analysis, confirm `finish_reason` shows in the
  Run Inspector.

**Checkpoint:** Stop. Report the field is captured and visible.

---

## Slice B — Reformat preserves the original response

**Why:** When the narrative has no JSON, `_extract_signal` makes one reformat
call but sends only `[system, user, reformat-instruction]` — the model's original
answer is absent (it does `session.add_user(...)` then `session.get_messages()`).
The model re-analyzes from scratch and can return a *different* conclusion than
the prose the user is reading. All three analysis paths (`analyze`,
`analyze_stream`, `analyze_prepared_stream`) route through `_extract_signal`, so
this is a single-point fix.

**Files:**
- `backend/services/ai.py` — `_extract_signal` (:695)
- `backend/tests/test_ai_timeout.py` — extend existing reformat test

- [ ] **B1. Include the original answer in the retry, without polluting session
  history.** In `_extract_signal`, replace the current
  `session.add_user(reformat_instruction)` + `session.get_messages()` with a
  non-mutating retry message list:
  ```python
  reformat_instruction = (
      "Your previous response did not include the required JSON block. "
      "Reply with ONLY a fenced ```json ... ``` block containing the signal "
      "(direction, confidence, description, entry, stop, target, confirmations, "
      "cautions, meta). No other text."
  )
  retry_messages = [
      *session.get_messages(),
      {"role": "assistant", "content": narrative},
      {"role": "user", "content": reformat_instruction},
  ]
  ```
  Pass `retry_messages` to `_chat_with_provider`. Do **not** `session.add_*` the
  narrative or the instruction — the caller already appends the finalized
  assistant turn (ai.py:961/1105/1199); adding here would double the assistant
  turn and corrupt follow-up chat context.

- [ ] **B2. Verify B.** Extend the existing
  `test_missing_json_triggers_one_reformat` in `tests/test_ai_timeout.py`:
  capture the messages passed to the reformat call and assert the original
  narrative appears as an `assistant` message before the reformat `user`
  instruction. Keep the existing `await_count == 2` assertion.
  ```bash
  cd backend && uv run pytest tests/test_ai_timeout.py tests/test_ai_provider_registry.py -q
  cd backend && uv run ruff check services/ai.py
  ```
  If `test_ai_provider_registry.py::test_cloud_analysis_reformat_uses_the_same_request_provider`
  or any test asserts the old session/message shape, update its expectation to
  the new non-mutating retry list (behavior is intentionally cleaner). Do not
  loosen the call-count assertion.

**Checkpoint:** Stop. Report the reformat call now carries the original answer.

---

## What's next (driven by A's evidence, not now)

After A ships, run several real cloud analyses and read the `finish_reason` mix:
- mostly `length` → the fix is the token/cost limit (separate decision).
- mostly `stop` but JSON missing → the fix is prompt wording via the existing
  2026-06-19 eval loop (separate HITL mission).
- `error`/interrupted → provider retry/handling (separate decision).

## Policy

Touches the AI delivery path but not the grounding/geometry/trade-safety
contract. Run `policy-drift-check` before merging to `dev`.
