---
name: parallax-git
description: Git workflow and conventions for Orbit. Use whenever committing, creating branches, opening PRs, merging, or discussing git strategy. Covers branch structure, naming, commit message format, PR workflow, and merge policy. Trigger on any git-related task.
---

# Git Policy

## Branch Structure

```
main                    ← production-ready, always stable
  └── dev               ← integration branch, features merge here first
        ├── feature/*   ← new features (e.g. feature/dashboard-gauges)
        ├── fix/*       ← bug fixes (e.g. fix/websocket-reconnect)
        └── refactor/*  ← code improvements (e.g. refactor/ibkr-error-handling)
```

## Rules

1. Never push directly to `main`. `main` changes go through PRs.
2. One feature branch per task. Branch from `dev`.
3. When the user says "merge into dev", direct local merge and push to `dev` is an approved solo workflow.
4. Before merging to `dev`, finish verification and run the dev merge completion workflow.
5. Use PRs for `dev` when collaboration/review is requested or the change is high-risk.
6. Fast-forward merge feature branches into `dev` when possible; otherwise ask before creating a merge commit or squash.
7. Fast-forward merge `dev` into `main` when a milestone is stable, then open the PR path for `main`.
8. Delete feature branches after merge.

## Branch Naming

```
feature/dashboard-market-pulse
feature/ibkr-auth-service
fix/websocket-disconnect-handling
refactor/indicator-service-polars
```

## Commit Messages

Format: `type: short description`

Types: `feat`, `fix`, `refactor`, `style`, `docs`, `chore`, `test`

Examples:
```
feat: add RSI overlay to chart component
fix: screener not filtering by volume ratio
refactor: extract IBKR auth into typed error classes
```

## Daily Workflow

```bash
git checkout dev && git pull origin dev
git checkout -b feature/your-task-name
# work, commit often
git add <files> && git commit -m "feat: description"
# before merge to dev — rebase onto latest dev
git checkout dev && git pull origin dev
git checkout feature/your-task-name && git rebase dev
# after user approves "merge into dev"
git checkout dev && git merge --ff-only feature/your-task-name
git push origin dev
```

## When to Merge dev → main

- A full phase (from PROJECT_PLAN.md) is complete
- Both people have tested end-to-end
- No known broken functionality
