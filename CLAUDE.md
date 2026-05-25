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
