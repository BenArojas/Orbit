---
name: orbit-ai-workflow
description: Orbit AI coding workflow. Use before planning or implementing non-trivial features, fixes, or refactors in Orbit. Guides resolved-context PRDs/specs, tracer-bullet vertical slices, TDD through public interfaces, deep-module boundaries, and human checkpoints. Pair with parallax-backend, parallax-frontend, parallax-git, parallax-hub, or parallax-v2-roadmap when their domain applies.
---

# Orbit AI Workflow

Use this skill to keep AI-assisted work small, testable, and aligned with Orbit's product rules.

## Non-Negotiables

- Respect `CLAUDE.md` project rules.
- Create a new branch for every feature or fix.
- Keep all IBKR and Ollama access behind the Python sidecar.
- Use `conid` across module boundaries.
- Never add autonomous trading behavior.
- Add tests for changed behavior.

## Workflow

1. **Resolve context**
   - Inspect relevant docs, code, recent commits, and existing patterns.
   - Ask only for unresolved decisions.
   - If context is already resolved, synthesize it instead of interviewing again.

2. **Write or refresh the PRD/spec**
   - Use `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` for substantial work.
   - Include problem, solution, user stories, implementation decisions, testing decisions, out-of-scope items, and module impact.
   - Sketch deep-module opportunities: public interface, hidden implementation, dependencies, tests.

3. **Break work into tracer-bullet slices**
   - Prefer vertical slices that prove one behavior end-to-end.
   - Each slice should include only the schema, service, API, UI, and tests needed for that behavior.
   - Avoid horizontal plans like "build schema", "build API", "build UI" as separate deliverables.
   - Mark each slice as `AFK` when it can be implemented without a human checkpoint, or `HITL` when it changes product, design, architecture, safety, or module boundaries.

4. **Implement with TDD**
   - Test one behavior through a public interface.
   - Run the test and verify it fails for the expected reason.
   - Implement the minimum code to pass.
   - Run the focused test and then relevant broader checks.
   - Refactor only after green.

5. **Stop at the slice boundary**
   - Report what the tracer bullet proved.
   - List files changed and verification run.
   - Ask before expanding to the next slice when scope, UI, architecture, trading safety, or public interfaces change.

## Deep Module Check

Before adding or changing a module, answer:

- What is the small public interface?
- What complexity is hidden behind it?
- Which tests prove behavior through the interface?
- Which other modules may import it?
- Does it preserve Orbit boundaries and `conid` ownership?

If the interface is hard to describe, pause and propose boundary options.

## TDD Test Shape

Good tests:

- read like behavior specs
- use public functions, routes, hooks, or components
- avoid private functions and internal collaborators
- survive implementation refactors

Bad tests:

- assert private helper calls
- mock the module under test
- test broad imagined behavior before the first slice works

