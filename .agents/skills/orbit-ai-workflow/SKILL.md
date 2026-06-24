---
name: orbit-ai-workflow
description: Budget-first Orbit workflow for non-trivial features, fixes, and refactors. Resolves focused context, writes short specs, implements one tracer bullet, and verifies only uncovered critical promises.
---

# Orbit AI Workflow

Use this process for non-trivial Orbit work. Product and architecture rules live
in `AGENTS.md` and its canonical docs; do not copy them into this skill.

## Workflow

1. **Resolve focused context**
   - Inspect the relevant code, canonical docs, recent diff, and nearby pattern.
   - Do not read broad directories or test suites by default.
   - Ask only about decisions that remain unresolved.

2. **Write one short spec when needed**
   - Use `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
   - Target fewer than 100 lines.
   - State problem, chosen solution, out-of-scope work, verification, and policy
     impact.
   - Skip a separate implementation plan unless work has multiple slices or is
     being handed off.

3. **Get approval**
   - Stop after writing or materially changing a spec/plan.
   - After approval, record the mission in `PROJECT_PLAN.md` before coding.
   - Pause if execution discovers a new architecture, safety, ownership, public
     contract, or local/cloud decision.

4. **Implement one tracer bullet**
   - Touch the real path end to end with the fewest files and smallest interface.
   - Define TypeScript or Pydantic contracts only at changed public/trust
     boundaries.
   - Do not add abstractions, configuration, or flexibility for hypothetical use.

5. **Verify the critical promise**
   - Follow `docs/testing.md`.
   - Default to zero new tests.
   - Reuse existing coverage; add at most one public-workflow test unless two
     distinct critical promises require success and fail-safe coverage.
   - Use typecheck, build, policy check, or manual smoke for non-critical work.
   - Stop after two unsuccessful verification loops and ask for direction.

6. **Stop at the slice boundary**
   - Report the behavior or policy proven, files changed, and checks run.
   - Update `PROJECT_PLAN.md` when the mission is complete.
   - Ask before widening scope or starting another slice.

## Interface Check

Before adding a module or boundary, state its small public interface, hidden
complexity, owners, and consumers. If that is unclear, present options and stop.
