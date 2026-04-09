# Parallax

Local desktop trading decision-support tool. Connects to Interactive Brokers
via the Client Portal Web API for live market data. Supports any instrument
IBKR provides — stocks, ETFs, futures, forex, options.

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
                      └─────────────────────────────┘       │  Gateway  │
                                     │                       └──────────┘
                                     ▼                     localhost:5000
                               ┌──────────┐
                               │  SQLite   │
                               └──────────┘
```

All data flows through the Python sidecar. The frontend never talks to IBKR
or Ollama directly.

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Rust (for Tauri)
- An Interactive Brokers account (paper or live)

### IBKR Gateway Setup

Parallax needs the IBKR Client Portal Gateway to communicate with Interactive
Brokers. There are two ways to run it:

#### Option A: Automatic (recommended)

Open Parallax and click **"Set Up Gateway"** in the sidebar. The app will
download a portable Java runtime and the Gateway automatically — no manual
installation required. This takes about 30-60 seconds on first launch.

Everything is stored in `~/.parallax/gateway/` and does not touch your
system Java.

#### Option B: Docker (for developers)

If you prefer running the Gateway in a container:

```bash
docker-compose up -d
```

This builds and runs the Gateway on `localhost:5000`. Parallax detects the
running Gateway automatically — no additional configuration needed.

### Running in Development

```bash
# Terminal 1: Frontend (Vite dev server on :1420)
npm install
npm run dev

# Terminal 2: Backend sidecar
cd backend
uv run uvicorn main:app --reload --port 8000
```

After both are running, open `http://localhost:1420` in your browser.
Authenticate with IBKR at `https://localhost:5000` when prompted.

### Running the Desktop App

```bash
npm run tauri dev     # Dev mode with hot reload
npm run tauri build   # Production build (.dmg / .msi / .AppImage)
```

### Tests

```bash
cd backend && uv run pytest -v
```

## 100% Local

No cloud, no subscriptions, no external servers.
Everything runs on your machine.
