---
name: parallax-git
description: Git workflow and conventions for Parallax. Use whenever committing, creating branches, opening PRs, merging, or discussing git strategy. Covers branch structure, naming, commit message format, PR workflow, and merge policy. Trigger on any git-related task.
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

1. Never push directly to `main` or `dev`. All changes go through PRs from feature branches.
2. One feature branch per task. Branch from `dev`.
3. Pull `dev` into your feature branch before opening a PR.
4. PRs require review from the other person before merging (exception: trivial fixes with a comment).
5. Squash merge feature branches into `dev`.
6. Fast-forward merge `dev` into `main` when a milestone is stable.
7. Delete feature branches after merge.

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
# before PR — rebase onto latest dev
git checkout dev && git pull origin dev
git checkout feature/your-task-name && git rebase dev
git push origin feature/your-task-name
# open PR: feature/* → dev, get review, squash merge, delete branch
```

## When to Merge dev → main

- A full phase (from PROJECT_PLAN.md) is complete
- Both people have tested end-to-end
- No known broken functionality
