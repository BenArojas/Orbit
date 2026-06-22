# Budget-First AI Workflow Design

> Status: Approved | Branch: `feature/budget-first-ai-workflow` | Date: 2026-06-20

## Problem

Orbit's agent workflow repeats knowledge across instructions, skills, plans, and
tests. It must fit the user's token budget without weakening core safety promises.

## Goal

Keep one source per rule, load details only when needed, keep plans short, and
test only uncovered critical promises.

## Canonical Sources

- `AGENTS.md`: short safety rules, stack, commands, and links to detailed docs.
- `CLAUDE.md`: imports `AGENTS.md`; it does not duplicate project rules.
- `docs/architecture/backend.md`: backend boundaries and durable invariants.
- `docs/architecture/frontend.md`: frontend conventions.
- `docs/architecture/modules.md`: module ownership and `conid` boundaries.
- `docs/ibkr-pacing.md`: sole source for IBKR pacing and cold-start behavior.
- `docs/testing.md`: critical promises, focused checks, and test-size limits.
- `PROJECT_PLAN.md`: sole roadmap and deferred-work source.
- `orbit-ai-workflow`: process only; no copied architecture or roadmap content.
- `policy-drift-check`: validates canonical sources instead of mirrored skills.

Delete both agent copies of `parallax-backend`, `parallax-frontend`,
`parallax-hub`, and `parallax-v2-roadmap`. Keep only current, useful decisions.

## Development Workflow

1. Inspect only the relevant code, canonical docs, and recent diff.
2. Write one short spec for non-trivial work; target fewer than 100 lines.
3. Define TypeScript or Pydantic contracts only at changed public/trust boundaries.
4. Implement the smallest tracer-bullet slice.
5. Verify the critical promise affected by the slice, then stop and report.
6. Use a separate implementation plan only for multiple slices or handoff work.
7. Stop after two unsuccessful verification loops and ask for direction.

## Testing Policy

Test important promises, not every layer or technology:

1. Unsafe trades cannot happen.
2. Secrets and private data stay only in approved locations.
3. Stored data is not lost or corrupted.
4. Main user workflows work from start to finish.
5. External failures stop safely and visibly.

Add an automated test only when a change affects one of these promises and no
existing test already protects it. Using an API, database, stream, or external
provider does not by itself require a new test.

- Default per slice: zero new tests.
- Normal maximum: one new public-workflow test.
- Maximum two only when success and fail-safe behavior are both critical.
- Low-risk bugs use focused manual verification.
- Serious or repeated bugs receive one regression test.
- Full relevant suites run only at the merge gate.
- Existing coverage counts; do not repeat it across service, route, hook, and UI.

## Test File Control

- Prefer one public-workflow test over several layer-specific unit tests.
- Keep new test files below 300 lines.
- Do not add to files above 500 lines without removing duplication.
- Use parameterized cases for repeated inputs or provider/error variants.
- Do not introduce snapshots, mock frameworks, or speculative test matrices.
- Do not split a large file only to hide its total size.
- Freeze existing oversized suites; cleanup is a separate approved mission.

## Tracer-Bullet Slice

One policy-only slice creates the docs, shortens root guidance, updates process
skills and policy drift, migrates valid roadmap decisions, and removes old skills.

## Verification

- `node --check scripts/check-policy-drift.mjs`
- `npm run check:policy-drift`
- Confirm removed skills and obsolete references are absent.
- Confirm `CLAUDE.md` imports `AGENTS.md`.
- Review the diff for duplicated or contradictory rules.

No application tests: runtime behavior does not change.

## Policy Impact

**Proposed policy change.** Replace mandatory TDD with critical-promises testing,
and mirrored-skill enforcement with canonical-doc enforcement. Product safety,
trading authority, data ownership, and local/cloud boundaries do not change.

## Out of Scope

- Deleting or restructuring existing application tests.
- Changing application code or runtime behavior.
- Rewriting archived plans or completed feature history.
- Mixing this work into `feature/orbit-v2-cloud-hybrid-ai-spec`.
