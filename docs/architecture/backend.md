# Backend Architecture

This is the canonical guide for Orbit's Python sidecar. Code and executable
constants win when this document becomes stale.

## Boundary

- One FastAPI sidecar owns broker, AI-provider, and SQLite access.
- React never calls IBKR, Ollama, cloud model providers, or SQLite directly.
- Routers translate HTTP requests and typed errors; services own domain logic.
- Public and trust boundaries use Pydantic request/response models.
- Errors distinguish authentication, network, rate limit, validation, and data
  failures. Do not add a bare `except Exception`.

## Data and Persistence

- Use Polars for dataframe work. pandas is allowed only through the pandas-ta
  bridge.
- `DatabaseService` owns SQLite access; routers do not issue raw SQL.
- The service shares one SQLite connection across worker threads. Every access
  to that connection goes through `_run_read` or `_run_write`, which share one
  lock. Do not call `asyncio.to_thread` on the connection directly.
- `conid` is the instrument key. Display identity is owned by
  `InstrumentIdentityService`; symbol-to-conid lookup remains an IBKR concern.

## IBKR and Execution

- `IBKRService` is the Client Portal HTTP transport owner.
- `ClientPortalExecutionAdapter` owns execution/account endpoint paths, verbs,
  and wire quirks. Domain services call its intent-level methods.
- Pacing constants live in `backend/constants/ibkr_pacing.py`; human guidance
  and cold-start troubleshooting live in `docs/ibkr-pacing.md`.
- Client Portal is the current data and decision-support path. Future TWS work
  is a separate, explicitly gated execution subsystem.

## Structure

- `backend/routers/`: HTTP and WebSocket boundaries.
- `backend/services/`: domain behavior and external adapters.
- `backend/models/`: shared Pydantic contracts.
- `backend/exceptions.py`: typed error vocabulary.
- `backend/main.py`: sidecar lifecycle and dependency wiring.

## Commands

```bash
cd backend
uv run uvicorn main:app --reload --port 8000
uv run python -m pytest tests/<focused-file>.py -q
```

Use `docs/testing.md` to decide whether a test is needed. Ruff and mypy are not
current project dependencies; do not claim they passed unless they are added and
actually run.

## Detailed Decisions

- `docs/superpowers/specs/2026-06-06-client-portal-execution-adapter-design.md`
- `docs/superpowers/specs/2026-06-06-instrument-identity-module-design.md`
- `docs/superpowers/specs/2026-06-06-trading-safety-module-design.md`
