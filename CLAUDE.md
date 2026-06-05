# Orbit

Orbit is the local desktop trading decision-support platform. It unifies:

- **Parallax** — technical analysis, screening, watchlists, and alerts.
- **MoonMarket** — portfolio, account, and trading workflows.
- **Inflect** — trading journal, planned after Parallax and MoonMarket.
- **TWS Execution Assistant** — working label for the v2 TWS-gated execution
  assistant module until the product name is chosen.

Orbit was previously called **IBKR Hub** during planning. Keep that name only as historical context; do not use it as the product name because it sounds official/affiliated with IBKR.

Orbit is local-first and connects to Interactive Brokers through the Client Portal Web API by default. Client Portal mode powers Parallax, MoonMarket, and Inflect. v2 may add an exclusive TWS mode for the TWS-gated execution assistant; when TWS mode is active, Parallax, MoonMarket, and Inflect are disabled because their data contracts are built around the Client Portal Web API. Orbit does not support autonomous trading: every trade plan must be explicitly reviewed and armed by the user.

**Stack**: Tauri v2 + React 19/TS + Tailwind/shadcn | Python FastAPI sidecar (httpx + websockets for IBKR) + Polars + pandas-ta bridge + Ollama | SQLite

## Rules

1. **Tests for everything.** Every new feature, service, and endpoint gets tests. No PR without test coverage for the changed code.
2. **Polars, never Pandas.** All dataframe operations use Polars. pandas-ta is the only exception (bridged).
3. **Local-first with optional cloud AI.** Orbit runs locally by default. Optional cloud AI is allowed only when explicitly enabled by the user. API keys stay local, encrypted, and never logged.
4. **Typed errors only.** Never bare `except Exception`. Distinguish auth, network, rate-limit, and data errors.
5. **All data flows through Python.** Frontend never talks to IBKR or Ollama directly; everything goes through the FastAPI sidecar.
6. **conid is the universal key.** Never store or link instruments by ticker string across module boundaries; always use IBKR contract ID (`conid`).
7. **Always create a new branch for each feature/fix.**
8. **No autonomous trading.** AI, scanners, and triggers may draft ideas or alerts, but they must never place, arm, modify, or cancel orders. Every order must be created by, or execute within, a user-reviewed and user-armed plan.

## AI Coding Workflow

Use `orbit-ai-workflow` before planning or implementing non-trivial features, fixes, or refactors.

Default workflow:

1. **Resolve context first.** Inspect relevant docs, code, recent commits, and existing module patterns before proposing changes.
2. **PRD/spec before large work.** For substantial work, turn resolved context into a spec in `docs/superpowers/specs/`. Do not re-interview the user when the context is already resolved.
3. **Policy impact before approval.** Every implementation plan/spec must say whether policy changes are expected. Policy changes are allowed, but must be highlighted and discussed before execution approval.
4. **Plan approval gate.** After writing or refreshing an `.md` plan/spec, stop and wait for user approval before executing it.
5. **Project plan tracking.** After a plan is approved for execution, update `PROJECT_PLAN.md`; update it again when the mission is completed.
6. **Tracer bullets over layers.** Break work into narrow vertical slices that touch the real path end-to-end. Avoid horizontal tasks like "schema", then "API", then "UI" unless they are only preparatory steps inside one vertical slice.
7. **TDD one behavior at a time.** Write one failing behavior test through a public interface, verify red, implement the minimum code, verify green, then refactor.
8. **Design deep modules.** Keep meaningful complexity behind small, stable, testable interfaces. Tests should target those interfaces, not private implementation details.
9. **Review critical choices.** Ask before changing architecture, module boundaries, trading safety behavior, data ownership, or public interfaces.
10. **Stop after the slice.** After a tracer bullet passes, report what was proven and ask before widening scope.
11. **Merge gate.** When the user approves merging to `dev`, run `policy-drift-check`, update `PROJECT_PLAN.md`, handle plan/spec cleanup or archival, then merge/push to `dev`. Direct merge/push to `dev` is allowed for solo work. `main` still requires a PR.

## Agent Support

This repo supports both Claude Code and Codex:

- Claude Code reads this `CLAUDE.md`.
- Codex reads `AGENTS.md`.
- Keep both files aligned when changing project rules.

Detailed conventions live in both agent folders and should remain mirrored:

- `.claude/skills/` — Claude Code skills.
- `.agents/skills/` — Codex skills.

Skill names are still `parallax-*` because most conventions currently target the Parallax module and its backend/frontend patterns:

- `parallax-frontend` — React/TS component patterns, state management, chart wrappers.
- `parallax-backend` — FastAPI conventions, indicator set, IBKR service patterns, architecture.
- `parallax-git` — branch structure, commit format, PR workflow, merge policy.
- `parallax-hub` — Orbit module boundaries, shared database concerns, Parallax/MoonMarket/Inflect relationships.
- `parallax-v2-roadmap` — deferred work and v2 scope.
- `orbit-ai-workflow` — PRD/spec, tracer-bullet issue, TDD, and deep-module workflow for AI-assisted coding.
- `policy-drift-check` — merge-to-`dev` policy audits, including active docs and mirrored skill updates.

Global workflow skills may also be used when available:

- `project-plan-update` — update the main planning file after approved plans and completed missions.
- `dev-merge-completion` — final merge-to-`dev` gate: policy drift, planning status, plan cleanup, merge/push.

## Design Docs

Active, forward-looking design lives in `docs/superpowers/plans/`, `docs/superpowers/specs/`, and `docs/ibkr-pacing.md`. These are the docs v2 still builds on (v1 master design, foundation, MoonMarket options, OrderTicket, Inflect journal, IBKR pacing).

Plans/specs for **already-shipped v1 features** were moved to `docs/archive/` during the v1 close-out cleanup — see `docs/archive/README.md` for the index. They are historical reference (the rationale behind shipped code), not active design. Do not treat them as forgotten: check the archive index when you need the original "why" behind a shipped v1 feature.
