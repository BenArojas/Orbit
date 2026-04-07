# Parallax

Local desktop trading decision-support tool for US equities and sector ETFs.
Connects to Interactive Brokers via the Client Portal Web API for live market data.

**Not a trading bot** — technical analysis, screening, and watchlists with
trigger-based alerts to help make better trading decisions.

## Stack

| Layer | Tech |
|-------|------|
| Desktop shell | Tauri v2 |
| Frontend | React 19 / TypeScript, Tailwind CSS, shadcn/ui, Lightweight Charts |
| Backend sidecar | Python FastAPI (httpx + websockets for IBKR) |
| Data | Polars, pandas-ta bridge for indicators |
| AI | Ollama (local LLM — Gemma 4 26B recommended) |
| Storage | SQLite |

## Architecture

```
┌─────────────┐       ┌─────────────────────────────┐       ┌──────────┐
│  Tauri v2    │──HTTP──▶  Python FastAPI sidecar     │──HTTP──▶  IBKR     │
│  React UI    │◀──WS───│  localhost:8000              │◀──WS───│  Client   │
└─────────────┘       │  Indicators · AI · Triggers  │       │  Portal   │
                      └─────────────────────────────┘       └──────────┘
                                     │
                                     ▼
                               ┌──────────┐
                               │  SQLite   │
                               └──────────┘
```

All data flows through the Python sidecar. The frontend never talks to IBKR
or Ollama directly.

## Development

### Prerequisites

- Node.js 20+
- Python 3.12+
- Rust (for Tauri)
- Interactive Brokers Client Portal running on localhost:5000

### Frontend

```bash
npm install
npm run dev          # Vite dev server on :1420
```

### Backend sidecar

```bash
cd backend
pip install -e ".[dev]"
python -m uvicorn main:app --reload --port 8000
```

### Tests

```bash
# Backend
cd backend && pytest

# Frontend
npm run lint
```

## 100% Local

No cloud, no subscriptions, no external servers.
Everything runs on your machine.
