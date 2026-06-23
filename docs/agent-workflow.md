# Agent Workflow

This repo uses GitHub as the shared state machine for planning, coding, review, and human approval.

## Core idea

- Issues hold the plan.
- Sub-issues hold executable tasks.
- Pull requests hold implementation.
- PR comments hold review and fix loops.
- Human approval controls merge and high-risk work.

This keeps agent context small and reduces token waste because each agent reads the artifact it needs instead of long chat history.

## Recommended statuses

Use GitHub Projects columns or labels with this flow:

1. `agent:needs-planning`
2. `agent:ready-for-coding`
3. `agent:in-progress`
4. `agent:needs-review`
5. `agent:changes-requested`
6. `human:needs-approval`
7. `human:approved`
8. Done / closed

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

## Claude Code integration

This repo includes `.github/workflows/claude-code.yml`.

Setup required:

1. Install the Claude Code GitHub app or run `/install-github-app` from Claude Code locally.
2. Add a GitHub repository secret named `ANTHROPIC_API_KEY`.
3. Comment `@claude` on an issue or PR.

Suggested comments:

```text
@claude implement this issue using AGENTS.md. Open a PR and do not merge.
```

```text
@claude review this PR against AGENTS.md and the linked issue. Focus on correctness, security, trading-safety, and high-impact bugs only.
```

Keep Claude mostly manual-triggered. Automatic review on every PR can become expensive.

## Codex integration

Codex should use `AGENTS.md` as repo guidance.

Recommended use:

```text
@codex review
```

Use Codex mainly for PR review or focused issue execution through GitHub's agent UI. Keep it diff-based when possible.

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
