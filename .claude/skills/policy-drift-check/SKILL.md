---
name: policy-drift-check
description: Use at the merge-to-dev gate when a branch changes rules, safety behavior, architecture conventions, API contracts, local/cloud boundaries, agent instructions, skills, or important docs.
---

# Policy Drift Check

Use this skill at the merge-to-`dev` gate when the work may change any project policy.

Policy includes product rules, trading safety, local/cloud boundaries, API contracts, data ownership, module boundaries, typed-error rules, pacing limits, agent instructions, and active design docs.

During planning or execution, policy changes should be highlighted and discussed in the plan. Run this check only after the plan is fully executed and the branch is being prepared for merge/push to `dev`.

## Required Workflow

1. Compare the branch against `dev`:

```bash
npm run check:policy-drift
```

2. If the check flags policy-bearing changes, inspect the changed code/config and update the matching active docs or skills:
   - `AGENTS.md` and `CLAUDE.md`
   - `.agents/skills/*/SKILL.md` and `.claude/skills/*/SKILL.md`
   - `docs/superpowers/specs/*.md`
   - `docs/superpowers/plans/*.md`
   - other active policy docs such as `docs/ibkr-pacing.md`
3. Keep Codex and Claude skill copies mirrored.
4. Rerun `npm run check:policy-drift` immediately before merge/push to `dev`.

## Rules

- Do not leave active docs contradicting current code behavior.
- Do not update only one agent surface when a policy affects both Codex and Claude.
- Do not treat `docs/archive/` as active policy; archive docs are historical.
- Ask before changing product or safety policy. Updating docs to match an already-approved policy does not need a new product decision.
