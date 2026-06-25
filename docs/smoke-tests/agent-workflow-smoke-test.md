# Agent Workflow Smoke Test (opencode / Claude / Codex)

End-to-end check that the issue → board → PR → review → approval loop works for
each agent runner. Run it once per agent after adding that agent's API key.

## Pre-validated (no secrets / no merge required)

The board-movement mechanism — the core of this feature — was validated live
against the real `Orbit Agent Workflow` board: a throwaway issue was added to the
board and driven through **all nine Status columns** using the exact
`updateProjectV2ItemFieldValue` mutation and option IDs in
`.github/actions/board-sync/action.yml`, each transition confirmed by read-back,
then cleaned up. So the board IDs, the mutation, and column routing are proven.
What remains for the live run below is the **agent execution** (opencode / Claude
/ Codex actually planning, coding, and reviewing) plus the event-driven
`project-automation.yml` cascade, both of which require the secrets and a merge to
`main`.

## Prerequisites

- Repository secrets present (see `docs/agent-workflow.md` → One-time setup):
  - `PROJECT_PAT` (classic PAT, `project` + `repo` scope) — required for all.
  - `OPENROUTER_API_KEY` (opencode), `ANTHROPIC_API_KEY` (Claude), `OPENAI_API_KEY` (Codex).
- The GitHub Projects (v2) board exists with the nine Status columns and the
  option IDs baked into `.github/actions/board-sync/action.yml`.
- These workflow files are on the **default branch** (issue_comment workflows run
  from the default branch, so the fixes must be merged before triggers fire).

Verify secrets:

```bash
gh secret list           # expect PROJECT_PAT + the agent keys you added
```

## Trigger reference

| Step | Comment on | opencode | Claude | Codex |
| --- | --- | --- | --- | --- |
| Plan | parent issue w/ `agent:needs-planning` | `/oc` | `@claude` | `/codex` |
| Code | task issue w/ `agent:ready-for-coding` | `/oc` | `@claude` | `/codex` |
| Review | the opened PR | `/oc` | `@claude` | `/codex` |

## A-to-Z run (repeat per agent)

1. **Create a parent issue**, add label `agent:needs-planning`.
   - ✅ Board: card appears and lands in **Needs Planning**.
2. **Comment the plan trigger** on the parent issue.
   - ✅ Planner creates 1–5 `[Task]` sub-issues labelled `agent:ready-for-coding`.
   - ✅ Board: parent moves to **Ready for Coding**.
3. Pick one sub-issue (keep it a docs-only task for the smoke test, e.g. "add a
   line to a scratch markdown file") and **comment the code trigger** on it.
   - ✅ Board: **In Progress**, label `agent:in-progress`.
   - ✅ A branch is pushed and a PR opens whose body contains `Closes #<sub-issue>`.
   - ✅ Board: **Pr Open**, label `agent:pr-open`.
4. **Comment the review trigger** on the PR.
   - ✅ Board: **In Review**, label `agent:needs-review`.
   - ✅ A formal review is submitted (Approve or Request changes), not just a comment.
   - ✅ Board: **Human Approval** (approved) or **Changes Requested** (changes).
5. **Human merges** the PR (the approval gate — no agent merges).
   - ✅ Board: linked issue → **Done** (via `project-automation.yml` on PR merge).

If a column does not move, open the failing run under **Actions** and check the
`board-sync` step output and the `project-automation` run for that event.

## Results

Fill in per agent.

### opencode

- **Model used:** `openrouter/z-ai/glm-5.2` (configurable in `opencode.yml`)
- **Git access (branch/commit/push):** pass / fail —
- **GitHub CLI access (read/create issues, open PR):** pass / fail —
- **PR / review / human-approval loop:** pass / fail —

### Claude

- **Model used:** `claude-sonnet-4-6` (configurable via `claude_args` in `claude-code.yml`)
- **Git access (branch/commit/push):** pass / fail —
- **GitHub CLI access (read/create issues, open PR):** pass / fail —
- **PR / review / human-approval loop:** pass / fail —

### Codex

- **Model used:** `openai/codex-action@v1` default (set `model:` in `codex.yml` to pin)
- **Git access (branch/commit/push — done by the workflow, not the action):** pass / fail —
- **GitHub CLI access (read/create issues, open PR, submit review):** pass / fail —
- **PR / review / human-approval loop:** pass / fail —

## Known per-agent differences

- **opencode** and **Claude** open the PR themselves (the action/agent runs git +
  `gh`). **Codex** only edits files / emits structured JSON, so `codex.yml` does
  the branch, commit, push, `gh pr create`, and `gh pr review` itself.
- First live run is the moment to confirm two un-CI-testable assumptions: that
  `claude-code-action` actually opens the PR from the prompt, and that
  `codex-action` writes clean JSON to its `output-file` for the planner/reviewer
  schema parsing. Adjust prompts if either misbehaves.
