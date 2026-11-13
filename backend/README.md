# Orbit Backend Sidecar

Shared Python FastAPI sidecar for Orbit. Routes serve Parallax, MoonMarket, and the TWS Assistant through one backend.

Python FastAPI server that sits between the Tauri frontend and external
services (IBKR Client Portal Gateway). Runs on `localhost:8000`.
The frontend never talks to IBKR directly — everything flows
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
| `services/scanner.py` | Background trigger scanner (asyncio task, per-rule cadence, dedup). |
| `services/screener.py` | IBKR scanner orchestration and deterministic filter handling. |
| `services/sectors.py` | Sector performance + RRG calculations (singleton, conid cache). |
| `services/db.py` | SQLite connection + schema management (WAL mode, full CRUD). |
| `routers/` | FastAPI route handlers (auth, gateway, market, indicators, screener, sectors, watchlist, triggers, settings, health, ws, …). |
| `models/` | Pydantic request/response models (mirrors `src/lib/api.ts`). |
| `constants/` | Static IBKR catalogues — filter codes, scanner presets, etc. |
| `tests/` | pytest suite. Asyncio mode auto, mocks all network calls. |

## Running in development

Launch development through Tauri so Rust can create the private sidecar session:

```bash
cd backend && uv sync && cd ..  # one-time
npm run tauri dev
```

Stop any manually launched server on port 8000 first. Standalone launchers remain
for diagnostics, but do not authorize a desktop mutation client. The sidecar
accepts its launch credential only through native stdin; no HTTP route reveals it.
See [`docs/gateway-lifecycle.md`](docs/gateway-lifecycle.md) for the full
explanation of why this matters.

## Tests

```bash
uv run pytest -v              # full suite
uv run pytest tests/test_gateway.py -v   # one file
uv run pytest -k "orphan"     # by keyword
```

Follow [`../docs/testing.md`](../docs/testing.md): protect critical promises at
the highest practical public boundary, not every file.

## Project rules

Repository rules live in [`../AGENTS.md`](../AGENTS.md). Phase 0 disables Client
Portal order mutations, all legacy live actions, and the shared-port MCP mount.
Paper TWS mutations require both a paper port and one connected `DU` account.
