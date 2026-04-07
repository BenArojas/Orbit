# Parallax

Local desktop trading decision-support tool for US equities/ETFs. Connects to Interactive Brokers Client Portal Web API. Not a trading bot — technical analysis, screening, and watchlists with trigger-based alerts.

**Stack**: Tauri v2 + React 19/TS + Tailwind/shadcn | Python FastAPI sidecar (httpx + websockets for IBKR) + Polars + pandas-ta bridge + Ollama | SQLite

## Rules

1. **Tests for everything.** Every new feature, service, and endpoint gets tests. No PR without test coverage for the changed code.
2. **Polars, never Pandas.** All dataframe operations use Polars. pandas-ta is the only exception (bridged).
3. **No cloud dependencies.** This is a 100% local app. No external servers, subscriptions, or cloud services.
4. **Typed errors only.** Never bare `except Exception`. Distinguish auth, network, rate-limit, and data errors.
5. **All data flows through Python.** Frontend never talks to IBKR or Ollama directly — everything goes through the FastAPI sidecar.
6. **conid is the universal key.** Never store or link instruments by ticker string — always by IBKR contract ID (conid).

## Skills

Detailed conventions are in `.claude/skills/` — loaded on demand, not every message:
- `parallax-frontend` — React/TS component patterns, state management, chart wrappers
- `parallax-backend` — FastAPI conventions, indicator set, IBKR service patterns, architecture
- `parallax-git` — Branch structure, commit format, PR workflow, merge policy
- `parallax-hub` — IBKR Hub multi-module context (Parallax, MoonMarket, Inflect)
