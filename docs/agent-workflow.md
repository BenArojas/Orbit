# Agent Workflow

This repo uses GitHub as the shared state machine for planning, coding, review, and human approval.

## Core idea

- Issues hold the plan.
- Sub-issues hold executable tasks.
- Pull requests hold implementation.
- PR comments hold review and fix loops.
- GitHub Projects shows the board.
- Human approval controls merge and high-risk work.

This keeps agent context small and reduces token waste because each agent reads the artifact it needs instead of long chat history.

## Board statuses

Use these GitHub Projects columns:

1. `Backlog`
2. `Needs Planning`
3. `Ready for Coding`
4. `In Progress`
5. `PR Open`
6. `In Review`
7. `Changes Requested`
8. `Human Approval`
9. `Done`

## Board meaning

- `Backlog`: idea exists, but nobody should work on it yet.
- `Needs Planning`: worth doing, but too big or vague. Planner may split it into small Agent Task issues.
- `Ready for Coding`: small, approved, clear task. Coder may pick it up.
- `In Progress`: a human or agent is actively working on it.
- `PR Open`: code exists in a PR.
- `In Review`: Claude, Codex, or a human is reviewing the PR.
- `Changes Requested`: review found issues. A coder/fixer may address only requested changes.
- `Human Approval`: work is blocked until the human approves, rejects, merges, or gives direction.
- `Done`: merged, closed, or intentionally completed.

## Scheduler priority

When an autonomous or semi-autonomous agent scans the board, it must process work in this order:

1. `Human Approval`: never continue automatically. Summarize the decision needed and stop.
2. `Changes Requested`: fix existing PRs before starting new work.
3. `In Review`: review open PRs that are waiting for AI review.
4. `PR Open`: route open PRs into review if they are ready.
5. `In Progress`: check only for stuck/stale work; do not start a second agent on the same item.
6. `Ready for Coding`: start at most one approved coding task per run.
7. `Needs Planning`: plan at most one parent issue per run.
8. `Backlog`: do nothing unless explicitly promoted.
9. `Done`: do nothing.

This policy keeps work-in-progress low and prevents agents from creating many unfinished branches or PRs.

## Human Approval routing

`Human Approval` is not a single final state. It is a pause state with routing metadata.

Every approval item must include:

- `Blocked issue or PR`: the artifact that is waiting.
- `Approval type`: why a human decision is needed.
- `Came from`: the board status before it entered `Human Approval`.
- `Return to / next status`: where it should go after approval.
- `Decision needed`: the exact question for the human.
- `Resume instructions`: what the next agent should do after approval.

Common routes:

| Scenario | Came from | Return to / next status | Priority after approval |
| --- | --- | --- | --- |
| Final merge approval | `PR Open` or `In Review` | `Done` | Human merges/closes; no agent continues |
| Coder blocked mid-implementation | `In Progress` | `In Progress` | Resume same coding task after decision |
| Reviewer found a risky decision | `In Review` | `Changes Requested` | Send back to coder/fixer before new work |
| Planner needs scope decision | `Needs Planning` | `Needs Planning` or `Ready for Coding` | Planner resumes or generated task becomes codable |
| Architecture/API/schema decision | Any active status | Usually the original status | Resume only with the approved option |

After a human answers, the next action is determined by `Return to / next status`, not by the original location alone.

If `Return to / next status` is `Changes Requested`, it outranks all new `Ready for Coding` work.

## Concurrency limits

Default limits:

- Planner: at most 1 parent plan per scheduled run.
- Coder: at most 1 coding task per scheduled run.
- Reviewer: can review multiple PRs, but prefer 1-2 per run to control cost.
- Fixer: prioritize existing `Changes Requested` PRs before new coding.

Do not allow multiple agents to work on the same issue or PR at once.

## What happens when an agent gets stuck

If an agent is uncertain, blocked, or needs approval, it must:

1. Stop changing code.
2. Leave a concise comment with:
   - What it tried.
   - Why it is blocked.
   - The exact decision needed from the human.
   - The recommended option, if there is one.
   - Came from status.
   - Return to / next status.
3. Move or label the item as `Human Approval` / `human:needs-approval`.
4. Wait for the human.

The agent must not guess on high-risk decisions.

Human approval is required for:

- Merging any PR.
- Issues labeled `risk:high`.
- Database schema or migration changes.
- Authentication, permissions, secrets, deployment, payments, broker execution, or cloud-AI policy changes.
- Large refactors that touch unrelated areas.
- Any change that affects trading-safety boundaries.

## Parent plan flow

Create a Parent Plan issue for larger phases. The planner agent should respond with smaller Agent Task issues.

A good parent plan includes:

- Goal
- Context
- Success criteria
- Constraints
- Non-goals
- Risk level

The planner should create sub-issues that are small enough for one focused PR.

## Agent task flow

A good Agent Task issue includes:

- Task
- Relevant files
- Acceptance criteria
- Non-goals
- Tests or validation commands
- Risk level
- Approval status

A coding agent should only work on one issue at a time.

## Agent runners (opencode / Claude / Codex)

Three interchangeable runners drive the same board flow. Each is a workflow that
reacts to a comment trigger and auto-selects a role from context:

| Agent | Workflow | Trigger comment | Action used | API-key secret |
| --- | --- | --- | --- | --- |
| opencode | `.github/workflows/opencode.yml` | `/oc` or `/opencode` | `anomalyco/opencode/github` | `OPENROUTER_API_KEY` |
| Claude | `.github/workflows/claude-code.yml` | `@claude` or `/claude` | `anthropics/claude-code-action@v1` | `ANTHROPIC_API_KEY` |
| Codex | `.github/workflows/codex.yml` | `/codex` or `@codex` | `openai/codex-action@v1` | `OPENAI_API_KEY` |

Role is chosen automatically:

- Comment on an **issue with `agent:needs-planning`** → **planner** (splits it into
  `agent:ready-for-coding` sub-issues, then moves the parent to Ready for Coding).
- Comment on an **issue without `agent:needs-planning`** → **coder** (implements,
  opens a PR with `Closes #N`, moves In Progress → Pr Open).
- Comment on a **pull request** → **reviewer** (submits a formal `gh pr review`,
  then routes the linked issue to Human Approval or Changes Requested from the
  verdict).

### How the board moves

All column + label transitions go through one shared composite action,
`.github/actions/board-sync`, which writes the GitHub Projects (v2) Status field
and the `agent:*` labels using `PROJECT_PAT`. `.github/workflows/project-automation.yml`
covers the human/event-driven transitions (PR opened/merged, review submitted by
a human, issue closed/reopened, manual label changes). Both use `PROJECT_PAT`
because the default `GITHUB_TOKEN` cannot write user-level Projects V2.

### One-time setup (repository secrets)

| Secret | Used by | Notes |
| --- | --- | --- |
| `PROJECT_PAT` | board-sync + project-automation | Classic PAT with `project` + `repo` scope. Required for any board movement. |
| `OPENROUTER_API_KEY` | opencode | Also powers Claude/GPT models via the model override below. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude | From `claude setup-token` (Claude Pro/Max). Uses your subscription instead of metered API. Preferred over the API key if both are set. |
| `ANTHROPIC_API_KEY` | Claude | Metered Anthropic API. Only needed if you are not using the OAuth token. |
| `OPENAI_API_KEY` | Codex | Metered OpenAI API. `gh secret set OPENAI_API_KEY`. |

Add only the keys for the agents you intend to use. A runner whose key is missing
will fail its agent step; the others are unaffected.

### Cost & billing

These runners call hosted models from CI, which is **metered usage billed
separately from any Claude.ai or ChatGPT subscription**:

- **Anthropic API key** and **OpenAI API key** — pay-per-token via the provider
  API. A Claude Pro/Max or ChatGPT Plus/Pro subscription does **not** cover API calls.
- **Claude exception** — set `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`,
  requires Claude Pro/Max) instead of `ANTHROPIC_API_KEY`. The Claude runner then
  draws on your subscription's included usage rather than billing the API.
- **OpenRouter** — prepaid, metered per token (often a small markup over provider
  rates) in exchange for one key across many models.
- **GitHub Actions minutes** are also metered (free for public repos; included
  minutes for private).

### Running a different model (OpenRouter)

The opencode runner takes an optional per-comment model override so you can drive
**Claude or GPT/Codex models through your existing `OPENROUTER_API_KEY`** with no
new keys:

```text
/oc                                          # default: z-ai/glm-5.2
/oc model=anthropic/claude-sonnet-4.6        # Claude via OpenRouter
/oc model=openai/gpt-4.1                      # GPT/Codex-class via OpenRouter
```

Use any slug from the OpenRouter model catalog. This is the no-extra-key way to
"run Claude/Codex"; the native `claude-code.yml` / `codex.yml` runners are the
full-capability path when you have provider keys (or a Claude subscription token).

Keep agents mostly manual-triggered (one comment per task). Automatic review on
every PR can become expensive.

## Token-budget rules

1. Planner reads the parent issue and canonical docs only.
2. Coder reads the approved task issue, relevant files, and AGENTS.md.
3. Reviewer reads the PR diff, linked issue, test results, and AGENTS.md.
4. Human approves high-risk work and merges.

Avoid giving every agent the whole repo or every previous conversation.

## When to use which agent

Use planner agent when:

- The task is vague.
- The feature spans multiple files or modules.
- You need sub-issues and ordering.

Use coder agent when:

- The issue is approved and scoped.
- Acceptance criteria are clear.
- The expected output is a focused PR.

Use review agent when:

- A PR exists.
- You want a second pass on diff correctness.
- You want high-signal issues only.

Use human approval when:

- The task is high-risk.
- It changes architecture, broker behavior, auth, persistence, secrets, deployment, or trading-safety boundaries.
- The agent is uncertain or suggests a major scope change.

## Minimal operating loop

1. Create Parent Plan issue.
2. Ask planner to split it.
3. Approve chosen Agent Task issue.
4. Ask Claude/Codex/coder to implement one issue.
5. Open PR.
6. Run CI/checks.
7. Ask Codex or Claude for review.
8. Fix requested changes.
9. Human merges.
