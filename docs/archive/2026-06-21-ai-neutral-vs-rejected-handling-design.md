# AI NEUTRAL vs Rejected Signal Handling Design

**Date:** 2026-06-21
**Status:** Approved; not yet implemented
**Branch:** `feature/orbit-v2-cloud-hybrid-ai-spec`

## Problem

Orbit treats two different outcomes as identical: a valid NEUTRAL analysis (no
actionable trade, but useful commentary) and a rejected or malformed model
response (untrusted). In `_finalize_signal_result` (`backend/services/ai.py`
~771-787), both a validation failure and a valid NEUTRAL are overwritten with
the same `safe_neutral_signal(UNVERIFIED_TRADE_PLAN_MESSAGE)`. The frontend
cannot tell them apart because the backend emits identical bytes.

Two consequences:

1. The model's real NEUTRAL analysis (higher-timeframe trend, conflicting
   indicators, what would make the setup actionable, risks to watch) is thrown
   away. Orbit is a decision-support product; "do nothing, and here is why" is
   valuable output.
2. The single warning string is stuffed into `description`, `cautions[]`, and
   `message`, so it renders three times with no added safety.

## Approved Solution

### Keep the strict signal contract

Unchanged: no verified setup means NEUTRAL; NEUTRAL carries no numeric entry,
stop, target, or R:R; prices must match grounded facts; the validator still
rejects invented levels and bad geometry. This design changes only how the
three outcomes are *distinguished and presented*, never the grounding rules.

### Backend: emit an explicit outcome

`_finalize_signal_result` stops collapsing outcomes and returns an explicit
status. Three states reach the frontend:

| status | when | card | confidence | narrative | raw kept |
|---|---|---|---|---|---|
| `directional` | valid LONG/SHORT | full card + levels | model's | model analysis | — |
| `neutral` | model returned valid NEUTRAL | safe-neutral card | **model's** | model commentary | — |
| `rejected` | validation raised, or no JSON parsed | safe-neutral card | **0** | none (untrusted) | raw → inspector |

For a valid NEUTRAL, preserve the model's own `description` and confidence and
the free-text narrative (JSON block stripped). For rejected, preserve nothing
the model claimed except the raw text, routed to the inspector.

`UNVERIFIED_TRADE_PLAN_MESSAGE` is no longer written into `description` or
`cautions`. It becomes a single `warning` field.

### API contract change (approved)

`AnalyzeResponse` gains:

- `status: "directional" | "neutral" | "rejected"`
- `narrative: str | None` — model free-text; present for directional and valid
  neutral, null for rejected
- `warning: str | None` — the single safety line; present for neutral and
  rejected, null for directional
- `rejected_output: str | None` — raw model text, rejected only, for the
  inspector

`message` is retired in favor of `narrative` + `warning` so one string cannot
render three times. `signal.description` and `signal.checks` (cautions) no
longer carry the warning.

### Frontend: three states, warning shown once

- **directional** — unchanged: signal card plus narrative.
- **neutral** — safe-neutral card using the model's confidence, one warning
  banner, and the narrative below labelled "Model commentary — not verified".
- **rejected** — safe-neutral card (confidence 0), one warning banner, and a
  "View unverified model output" action that opens the inspector.

Remove the duplicate warning placements in `ActionSignalCard` and
`AiChatPanel`.

### Inspector: capture rejected raw for all runs

`useAiRunInspector` gains an "Unverified model output" section fed by
`rejected_output`, available regardless of provider including local Ollama —
not only cloud snapshots.

## Slices (vertical)

**Slice A — Valid NEUTRAL shows its analysis (tracer bullet).** Backend status
split and contract (`status`/`narrative`/`warning`), plus the frontend neutral
and directional states with the warning shown once. Spans service → API model
→ TS type → `ActionSignalCard`/`AiChatPanel`. Demo: a NEUTRAL renders its
commentary with one warning instead of the same line three times. Directional
output is unchanged.

**Slice B — Rejected output is inspectable.** Backend tags `rejected` and
carries `rejected_output`; frontend rejected state plus the inspector
"Unverified model output" section for all providers. Demo: an ungrounded or
unparseable response shows the safety card and a link that opens the raw text.

Slice B builds on Slice A's contract. The directional path needs no slice; both
verticals must avoid regressing it.

## Public Interfaces

- `POST /ai/analyze` — `AnalyzeResponse` gains `status`, `narrative`,
  `warning`, `rejected_output`; `message` retired.
- The streaming analyze path, if it shares finalization, must emit the same
  status and fields.
- All frontend access continues through the FastAPI sidecar.

## Testing

Per `docs/testing.md`, protect the uncovered critical promises:

1. Finalization test: a valid NEUTRAL draft yields `status="neutral"`,
   preserved model confidence, preserved narrative, single `warning`, and no
   numeric levels.
2. Finalization test: a draft that fails grounding yields `status="rejected"`,
   confidence 0, null narrative, and `rejected_output` carrying the raw text.
3. Finalization test: an unparseable response yields `status="rejected"` with
   `rejected_output` set.
4. Regression test: a valid directional draft is unchanged (`status="directional"`,
   narrative preserved, no warning).
5. Component test: the neutral state shows commentary plus exactly one warning;
   the rejected state shows the inspector entry; no warning renders three times.

## Out of Scope

- Changes to grounding, geometry, or price-candidate rules.
- Scrubbing or rewriting model narrative text beyond the "not verified" label.
- Any new trade-direction behavior.
- Merge or push.
