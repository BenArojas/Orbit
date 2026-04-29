# Parallax Backend Sidecar

Python FastAPI server that sits between the Tauri frontend and external
services (IBKR Client Portal Gateway, Ollama). Runs on `localhost:8000`.
The frontend never talks to IBKR or Ollama directly — everything flows
through this process.

## Module map

| Path | Purpose |
|------|---------|
| `main.py` | FastAPI app + lifespan (startup/shutdown wiring for every service). |
| `run.py` | PyInstaller / production entry point. Sets up `~/.parallax/`, installs `SIGHUP → SIGTERM` handler, then `uvicorn.run(app)`. |
| `config.py` | Environment-driven config (ports, paths, IBKR base URLs, gateway home). |
| `state.py` | `IBKRState` — in-memory auth/session flags, mutated by services. |
| `deps.py` | FastAPI dependency providers (`get_ibkr`, `get_gateway`, `get_db`, …). |
| `exceptions.py` | Typed exception hierarchy. **Never `except Exception`** — see project rule 4. |
| `cache.py` / `rate_control.py` | TTL cache + aiolimiter token-bucket for IBKR endpoints. |
| `services/ibkr.py` | IBKR Client Portal HTTP + WebSocket integration (httpx, websockets, ibind). |
| `services/gateway.py` | IBKR Gateway provisioning, JVM lifecycle, pid-file orphan recovery, `/v1/api/logout`. See [`docs/gateway-lifecycle.md`](docs/gateway-lifecycle.md). |
| `services/indicators.py` | Indicator computation (Polars → pandas-ta bridge). |
| `services/ai.py` | Ollama chat + analysis service (stateless). |
| `services/ollama.py` | Ollama lifecycle (detect → start server → list models). Never auto-installs. |
| `services/prompt_builder.py` | Structured-JSON prompt assembly with per-indicator hints + token budget. |
| `services/scanner.py` | Background trigger scanner (asyncio task, per-rule cadence, dedup). |
| `services/screener.py` / `screener_ai.py` | IBKR scanner orchestration + AI natural-language → filter codes. |
| `services/sectors.py` | Sector performance + RRG calculations (singleton, conid cache). |
| `services/db.py` | SQLite connection + schema management (WAL mode, full CRUD). |
| `routers/` | FastAPI route handlers (auth, gateway, market, indicators, ai, screener, sectors, watchlist, triggers, settings, health, ws, …). |
| `models/` | Pydantic request/response models (mirrors `src/lib/api.ts`). |
| `constants/` | Static IBKR catalogues — filter codes, scanner presets, etc. |
| `tests/` | pytest suite. Asyncio mode auto, mocks all network calls. |

## Running in development

The dev wrapper handles signals + cleans up the IBKR Gateway JVM on exit:

```bash
cd backend && uv sync          # one-time
./scripts/dev-backend.sh        # macOS / Linux  (run from repo root)
pwsh ./scripts/dev-backend.ps1  # Windows         (run from repo root)
```

Both scripts ultimately run `uv run uvicorn main:app --reload --port 8000`,
but they trap `SIGINT` / `SIGTERM` / `SIGHUP` so that closing the terminal
doesn't leave the IBKR Gateway running on `:5001` as an orphan.
See [`docs/gateway-lifecycle.md`](docs/gateway-lifecycle.md) for the full
explanation of why this matters.

## Tests

```bash
uv run pytest -v              # full suite
uv run pytest tests/test_gateway.py -v   # one file
uv run pytest -k "orphan"     # by keyword
```

Per project rule 1, every new feature/service/endpoint gets test coverage
on the changed code — no PR without it.

## Project rules

The seven non-negotiable rules live in [`../CLAUDE.md`](../CLAUDE.md).
Re-read them before any non-trivial change.
