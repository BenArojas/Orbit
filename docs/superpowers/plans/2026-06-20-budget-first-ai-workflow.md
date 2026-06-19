# Budget-First AI Workflow Implementation Plan

> Status: Proposed for execution | Execute inline as one slice; do not use subagents.

**Goal:** Replace duplicated agent guidance and mandatory TDD with canonical,
on-demand docs and critical-promises testing.

**Design:** `docs/superpowers/specs/2026-06-20-budget-first-ai-workflow-design.md`

## Constraints

- Branch remains `feature/budget-first-ai-workflow`, based on `dev`.
- Do not change application runtime behavior or existing application tests.
- Keep product safety, trading authority, data ownership, and cloud boundaries.
- Migrate only current facts; delete stale or duplicated guidance.
- Stop after this slice and report before merge.

## File Map

Create:

- `docs/architecture/backend.md`
- `docs/architecture/frontend.md`
- `docs/architecture/modules.md`
- `docs/testing.md`

Modify:

- `AGENTS.md`: concise rules and canonical-doc map.
- `CLAUDE.md`: import `AGENTS.md` only.
- `PROJECT_PLAN.md`: sole home for valid deferred roadmap decisions.
- `.agents/skills/orbit-ai-workflow/SKILL.md`: short budget-first process.
- `.agents/skills/policy-drift-check/SKILL.md`: canonical-doc merge gate.
- `scripts/check-policy-drift.mjs`: recognize canonical docs and stop requiring
  mirrored skill edits.

Keep one physical copy of the remaining shared skills. Replace the matching
Claude `SKILL.md` files with relative symlinks to `.agents/skills`:

- `orbit-ai-workflow`
- `policy-drift-check`
- `parallax-git`

Delete both agent copies of:

- `parallax-backend`
- `parallax-frontend`
- `parallax-hub`
- `parallax-v2-roadmap`

## Slice 1: Establish Canonical Agent Policy

- [ ] Record this approved mission as in progress in `PROJECT_PLAN.md`.
- [ ] Write the four canonical docs from current code, active specs, and
      `docs/ibkr-pacing.md`; do not copy stale skill text blindly.
- [ ] Move valid deferred roadmap decisions into `PROJECT_PLAN.md` in compact
      form, preserving the OS-keychain-only cloud policy.
- [ ] Shorten `AGENTS.md` and replace `CLAUDE.md` with `@AGENTS.md`.
- [ ] Rewrite `orbit-ai-workflow` around short specs, one tracer bullet,
      critical promises, zero tests by default, and a two-loop stop limit.
- [ ] Rewrite `policy-drift-check` and its script around canonical docs.
- [ ] Delete the eight domain-skill directories and symlink the three remaining
      Claude skill files to their canonical Codex copies.
- [ ] Mark the mission complete in `PROJECT_PLAN.md`.

## Verification

Run:

```bash
node --check scripts/check-policy-drift.mjs
npm run check:policy-drift
git diff --check
```

Check structure:

```bash
test "$(cat CLAUDE.md)" = "@AGENTS.md"
find .agents/skills .claude/skills -maxdepth 2 -type d | sort
find .claude/skills -name SKILL.md -type l -print
rg -n "parallax-(backend|frontend|hub|v2-roadmap)" AGENTS.md CLAUDE.md .agents .claude scripts PROJECT_PLAN.md docs/architecture docs/testing.md
```

Expected:

- JavaScript syntax, policy drift, and diff checks pass.
- Removed skills and live references are absent.
- Claude process/git skill files are symlinks to canonical `.agents` files.
- No application test command is run because runtime behavior is unchanged.

## Commit

```bash
git add AGENTS.md CLAUDE.md PROJECT_PLAN.md docs .agents .claude scripts/check-policy-drift.mjs
git commit -m "refactor: establish canonical agent policy sources"
```

Stop and report the proven source-of-truth path before requesting merge to `dev`.
