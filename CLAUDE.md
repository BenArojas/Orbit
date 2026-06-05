# Orbit

Orbit is the local desktop trading decision-support platform. It unifies:

- **Parallax** — technical analysis, screening, watchlists, and alerts.
- **MoonMarket** — portfolio, account, and trading workflows.
- **Inflect** — trading journal, planned after Parallax and MoonMarket.

Orbit was previously called **IBKR Hub** during planning. Keep that name only as historical context; do not use it as the product name because it sounds official/affiliated with IBKR.

Orbit connects to Interactive Brokers through the Client Portal Web API. It supports any instrument IBKR provides data for (stocks, ETFs, futures, forex, options, etc.). It is not a trading bot.

**Stack**: Tauri v2 + React 19/TS + Tailwind/shadcn | Python FastAPI sidecar (httpx + websockets for IBKR) + Polars + pandas-ta bridge + Ollama | SQLite

## Rules

1. **Tests for everything.** Every new feature, service, and endpoint gets tests. No PR without test coverage for the changed code.
2. **Polars, never Pandas.** All dataframe operations use Polars. pandas-ta is the only exception (bridged).
3. **No cloud dependencies.** This is a 100% local app. No external servers, subscriptions, or cloud services.
4. **Typed errors only.** Never bare `except Exception`. Distinguish auth, network, rate-limit, and data errors.
5. **All data flows through Python.** Frontend never talks to IBKR or Ollama directly; everything goes through the FastAPI sidecar.
6. **conid is the universal key.** Never store or link instruments by ticker string across module boundaries; always use IBKR contract ID (`conid`).
7. **Always create a new branch for each feature/fix.**

## AI Coding Workflow

Use `orbit-ai-workflow` before planning or implementing non-trivial features, fixes, or refactors.

Default workflow:

1. **Resolve context first.** Inspect relevant docs, code, recent commits, and existing module patterns before proposing changes.
2. **PRD/spec before large work.** For substantial work, turn resolved context into a spec in `docs/superpowers/specs/`. Do not re-interview the user when the context is already resolved.
3. **Tracer bullets over layers.** Break work into narrow vertical slices that touch the real path end-to-end. Avoid horizontal tasks like "schema", then "API", then "UI" unless they are only preparatory steps inside one vertical slice.
4. **TDD one behavior at a time.** Write one failing behavior test through a public interface, verify red, implement the minimum code, verify green, then refactor.
5. **Design deep modules.** Keep meaningful complexity behind small, stable, testable interfaces. Tests should target those interfaces, not private implementation details.
6. **Review critical choices.** Ask before changing architecture, module boundaries, trading safety behavior, data ownership, or public interfaces.
7. **Stop after the slice.** After a tracer bullet passes, report what was proven and ask before widening scope.

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

## Design Docs

Active, forward-looking design lives in `docs/superpowers/plans/`, `docs/superpowers/specs/`, and `docs/ibkr-pacing.md`. These are the docs v2 still builds on (v1 master design, foundation, MoonMarket options, OrderTicket, Inflect journal, IBKR pacing).

Plans/specs for **already-shipped v1 features** were moved to `docs/archive/` during the v1 close-out cleanup — see `docs/archive/README.md` for the index. They are historical reference (the rationale behind shipped code), not active design. Do not treat them as forgotten: check the archive index when you need the original "why" behind a shipped v1 feature.
