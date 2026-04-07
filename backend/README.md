# Parallax Backend Sidecar

Python FastAPI server that sits between the Tauri frontend and external services
(IBKR Client Portal, Ollama). Runs on `localhost:8000`.

## Key modules

| Module | Purpose |
|--------|---------|
| `services/ibkr.py` | IBKR Client Portal HTTP + WebSocket integration (httpx, websockets) |
| `services/indicators.py` | Technical indicator computation (Polars + pandas-ta bridge) |
| `services/ai_service.py` | Ollama LLM integration for AI analysis |
| `services/prompt_builder.py` | Structured prompt assembly for AI analysis |
| `services/trigger_engine.py` | Trigger rule evaluation and hit tracking |
| `routers/` | FastAPI route handlers (market, indicators, AI, sectors, etc.) |
| `models/` | Pydantic request/response models |
| `exceptions.py` | Typed exception hierarchy (never bare `except Exception`) |
| `db.py` | SQLite connection and schema management |

## Running

```bash
pip install -e ".[dev]"
python -m uvicorn main:app --reload --port 8000
```

## Tests

```bash
pytest
pytest --cov=services   # with coverage
```
