# Orbit

Orbit is a local-first desktop trading decision-support platform:

- **Parallax:** technical analysis, screening, watchlists, and alerts.
- **MoonMarket:** portfolio, account, options, and order workflows.
- **Inflect:** trading journal and trade review.

Stack: Tauri v2, React 19/TypeScript, Tailwind/shadcn, FastAPI/Python 3.12,
Polars with a pandas-ta bridge, SQLite, IBKR Client Portal, and Ollama.

## Non-Negotiable Rules

1. Orbit is decision support, never an autonomous trading bot.
2. All broker, AI-provider, and persistence access flows through FastAPI.
3. Use `conid` across module boundaries; ticker text is display metadata.
4. Use Polars for dataframe work; pandas is allowed only for pandas-ta bridging.
5. Use typed errors at trust boundaries; never add a bare `except Exception`.
6. Orbit is local-first. Cloud AI requires explicit opt-in; keys live only in
   the OS keychain and are never stored in SQLite or logs.
7. Create a new branch for every feature or fix.
8. Agents must not merge to `dev` or `main`; merging requires human approval.

## Development Workflow

- Use `orbit-ai-workflow` for non-trivial features, fixes, and refactors.
- Resolve context from relevant code and canonical docs; do not read the whole repo.
- Keep non-trivial specs under 100 lines when practical.
- Implement one smallest tracer-bullet slice, then stop and report.
- Tests follow `docs/testing.md`: zero new tests by default; protect uncovered
  critical promises rather than every file or layer.
- Ask before changing architecture, module boundaries, trading safety, data
  ownership, public contracts, or local/cloud policy.
- After plan approval, update `PROJECT_PLAN.md` before and after execution.
- Before merging to `dev`, use `policy-drift-check`. `main` changes require a PR.

## GitHub Issue-Driven Agent Workflow

Use GitHub Issues, GitHub Projects, labels, and Pull Requests as the handoff protocol between the human, planner agent, coder agent, and reviewer agent.

### Board statuses

Use these GitHub Projects columns:

- `Backlog`
- `Needs Planning`
- `Ready for Coding`
- `In Progress`
- `PR Open`
- `In Review`
- `Changes Requested`
- `Human Approval`
- `Done`

### State machine

1. Human creates or approves a parent issue.
2. Planner splits the parent issue into small executable issues.
3. Human approves the sub-issues that are allowed to be coded.
4. Coder works on exactly one issue at a time.
5. Coder opens a focused PR linked to the issue.
6. Reviewer checks the PR diff, linked issue, test results, and this file.
7. Coder fixes requested changes if needed.
8. Human approves and merges.

### Scheduler priority

When scanning a board, agents must process work in this order:

1. `Human Approval`: never continue automatically. Summarize the decision needed and stop.
2. `Changes Requested`: fix existing PRs before starting new work.
3. `In Review`: review open PRs that are waiting for AI review.
4. `PR Open`: route open PRs into review if they are ready.
5. `In Progress`: check only for stuck/stale work; do not start a second agent on the same item.
6. `Ready for Coding`: start at most one approved coding task per run.
7. `Needs Planning`: plan at most one parent issue per run.
8. `Backlog`: do nothing unless explicitly promoted.
9. `Done`: do nothing.

This keeps work-in-progress low and prevents agents from opening many unfinished branches or PRs.

### Human Approval routing

`Human Approval` is a pause state, not a final state.

Every item moved to `Human Approval` must include:

- Blocked issue or PR.
- Approval type.
- Came from status.
- Return to / next status.
- Exact decision needed.
- Resume instructions after approval.

After a human answers, route by `Return to / next status`:

- `Done`: human merges, closes, or finishes the item. No agent continues automatically.
- `In Progress`: resume the same coding task with the approved option only.
- `Changes Requested`: send the PR back to coder/fixer before any fresh coding.
- `In Review`: resume review.
- `Needs Planning`: resume planner.
- `Ready for Coding`: task is now approved and can be picked by coder.

If approval came from review and returns to `Changes Requested`, it has priority over new `Ready for Coding` tasks.

### Stuck or blocked agents

If an agent is uncertain, blocked, or needs approval, it must stop changing code and leave a concise comment with:

- What it tried.
- Why it is blocked.
- The exact decision needed from the human.
- The recommended option, if there is one.
- Came from status.
- Return to / next status.

Then move or label the item as `Human Approval` / `human:needs-approval` and wait for the human.

### Status labels

Use these labels as the canonical workflow signals:

- `agent:needs-planning`
- `agent:ready-for-coding`
- `agent:in-progress`
- `agent:needs-review`
- `agent:changes-requested`
- `human:needs-approval`
- `human:approved`
- `risk:low`
- `risk:medium`
- `risk:high`
- `type:feature`
- `type:bug`
- `type:refactor`
- `type:docs`

### Planner agent rules

The planner may:

- Split parent issues into small sub-issues.
- Add acceptance criteria, relevant files, dependencies, non-goals, risk level, and test requirements.
- Mark high-risk or unclear work as requiring human approval.

The planner must not:

- Implement code.
- Expand scope beyond the parent issue.
- Create vague tasks such as "improve dashboard" without concrete acceptance criteria.

### Coder agent rules

The coder may work only on issues that are explicitly approved or labeled `agent:ready-for-coding`.

The coder must:

- Create a branch named `agent/<issue-number>-short-description`.
- Make the smallest change that satisfies the issue.
- Link the issue in the PR body.
- Fill the PR checklist.
- Include test commands and results.
- Stop for human approval before changing architecture, auth, permissions, persistence, broker behavior, secrets, deployment, migrations, or trading-safety boundaries.

### Review agent rules

The reviewer should review the PR diff, linked issue, relevant tests, and this file. Do not reread the whole repository unless required.

The reviewer should focus on:

- Correctness and acceptance criteria.
- Serious bugs and edge cases.
- Security or secrets leakage.
- Trading-safety regressions.
- Performance regressions.
- Maintainability problems that will likely cause near-term issues.

Avoid low-value style comments unless they block readability or project consistency.

## Token-Budget Rules

- Issues are the persistent plan.
- PRs are the persistent implementation record.
- PR comments are the persistent review loop.
- Do not rely on long chat history as source of truth.
- Prefer small issues and focused PR diffs.
- Paste only relevant snippets, not whole files.
- Summarize decisions in the issue or PR after each major turn.
- Review agents should inspect diffs, not the entire repo.
- Agents should use canonical docs before exploring unrelated files.

## Human Approval Gates

Human approval is required for:

- Merging any PR.
- Issues labeled `risk:high`.
- Database schema or migration changes.
- Authentication, permissions, secrets, deployment, payments, broker execution, or cloud-AI policy changes.
- Large refactors that touch unrelated areas.

## Canonical Sources

- Backend: `docs/architecture/backend.md`
- Frontend: `docs/architecture/frontend.md`
- Module ownership and trading safety: `docs/architecture/modules.md`
- Testing: `docs/testing.md`
- IBKR pacing/cold start: `docs/ibkr-pacing.md`
- Roadmap and deferred work: `PROJECT_PLAN.md`
- Active feature decisions: `docs/superpowers/specs/` and `docs/superpowers/plans/`
- Shipped history: `docs/archive/README.md`
- Agent workflow setup: `docs/agent-workflow.md`

## Commands

```bash
npm run tauri dev
npm run typecheck
npm run build
cd backend && uv run uvicorn main:app --reload --port 8000
```

Run focused tests only when `docs/testing.md` calls for them. Full relevant
suites belong at the merge gate.

## Agent Support

- Codex reads `AGENTS.md`; Claude Code imports it from `CLAUDE.md`.
- `.agents/skills/` contains the canonical shared workflow skills.
- Matching `.claude/skills/*/SKILL.md` files are symlinks to canonical skills.
