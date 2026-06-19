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

## Canonical Sources

- Backend: `docs/architecture/backend.md`
- Frontend: `docs/architecture/frontend.md`
- Module ownership and trading safety: `docs/architecture/modules.md`
- Testing: `docs/testing.md`
- IBKR pacing/cold start: `docs/ibkr-pacing.md`
- Roadmap and deferred work: `PROJECT_PLAN.md`
- Active feature decisions: `docs/superpowers/specs/` and `docs/superpowers/plans/`
- Shipped history: `docs/archive/README.md`

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
