---
name: policy-drift-check
description: Merge-to-dev gate for changes to safety, architecture, API contracts, data ownership, local/cloud policy, agent guidance, or canonical docs.
---

# Policy Drift Check

Use only when preparing an implemented branch for merge to `dev`.

## Canonical Sources

- `AGENTS.md`
- `docs/architecture/*.md`
- `docs/testing.md`
- `docs/ibkr-pacing.md`
- `PROJECT_PLAN.md`
- active `docs/superpowers/specs/` and `docs/superpowers/plans/`
- canonical `.agents/skills/*/SKILL.md`

`CLAUDE.md` imports `AGENTS.md`; Claude skill files symlink to `.agents`. They
are discovery surfaces, not additional policy sources. `docs/archive/` is history.

## Merge Gate

1. Compare the branch with `dev`.
2. Run `npm run check:policy-drift`.
3. If policy-bearing code changed, update the matching canonical source.
4. Remove contradictory active guidance instead of copying fixes everywhere.
5. Rerun the check immediately before merge/push.

Ask before changing product or safety policy. Updating canonical docs for an
already-approved decision does not require a new product decision.
