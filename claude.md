# Parallax

> A local desktop trading decision-support tool for two experienced traders.
> Built with Tauri v2 + React/TypeScript frontend + Python FastAPI sidecar.

---

## Purpose

Parallax is **not a trading bot**. It is a technical analysis and screening tool
that helps make better trading decisions. It connects to Interactive Brokers via
the Client Portal Web API for live market data.

The two core pillars:
1. **Indicator analysis** — TradingView-style charts with customizable technical indicators
2. **Stock & sector screener** — Filter stocks/ETFs by technical criteria in real time

This app runs **100% locally**. No cloud, no subscriptions, no external servers.
Designed for experienced traders — no hand-holding UI needed.

---

## Stack

### Frontend
- **Desktop shell**: Tauri v2
- **Framework**: React 19 + TypeScript (strict mode)
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **Charts**: TradingView Lightweight Charts v5
- **State**: Zustand (global), React useState (local/component-level)
- **Data fetching**: TanStack Query v5 — REST for screener, WebSocket for live streams

### Backend (Python Sidecar)
- **Runtime**: Python 3.12
- **Framework**: FastAPI + uvicorn
- **Package manager**: uv
- **Data processing**: Polars (never Pandas)
- **Indicators**: pandas-ta (bridged from Polars where needed)
- **IBKR**: ibind (Client Portal Web API wrapper)

### Tooling
- **Linting**: ESLint + Prettier (frontend), Ruff (backend)
- **Type checking**: TypeScript strict, mypy (backend)
- **Git**: feature branches → dev → main, PRs only into main

---

## Architecture

```
React UI (Tauri webview)
       ↕  TanStack Query (REST) + WebSocket (live data)
Python FastAPI sidecar  [localhost:8000]
       ↕  ibind
IBKR Client Portal Gateway  [localhost:5000]  ← must be running
```

The Python sidecar starts automatically when Tauri launches.
The frontend **never** talks directly to IBKR — all market data flows through Python.

---

## Project Structure

```
parallax/
├── src/                          # React frontend
│   ├── components/
│   │   ├── charts/               # TradingView Lightweight Charts wrappers
│   │   ├── screener/             # Screener table + filter controls
│   │   ├── indicators/           # Indicator config panels
│   │   ├── watchlist/            # Watchlist sidebar
│   │   └── ui/                   # shadcn/ui component re-exports
│   ├── hooks/                    # Custom React hooks (e.g. useMarketData)
│   ├── store/                    # Zustand stores (watchlist, screener filters, settings)
│   ├── lib/                      # Utilities, type definitions, constants
│   ├── pages/                    # Top-level page/view components
│   └── App.tsx
│
├── src-tauri/                    # Tauri shell — keep this minimal
│   ├── src/
│   │   └── main.rs               # Tauri entrypoint (sidecar launch lives here)
│   ├── icons/
│   └── tauri.conf.json
│
├── backend/                      # Python FastAPI sidecar
│   ├── routers/
│   │   ├── market.py             # /market — live quotes, OHLCV candles
│   │   ├── screener.py           # /screener — filtered stock lists
│   │   └── indicators.py         # /indicators — computed indicator values
│   ├── services/
│   │   ├── ibkr.py               # All IBKR Client Portal logic lives here
│   │   ├── indicators.py         # Indicator computation (RSI, MACD, EMA, BB, Vol)
│   │   └── screener.py           # Screener filter engine
│   ├── models/                   # Pydantic request/response models
│   ├── main.py                   # FastAPI app entrypoint
│   ├── pyproject.toml
│   └── requirements.txt
│
├── CLAUDE.md                     # This file — read it every session
└── README.md
```

---

## Running Locally

### Prerequisites
- IBKR Client Portal Gateway must be running on `localhost:5000`
- Authenticate via browser at `https://localhost:5000` before launching Parallax
- Node.js 20+, Rust (via rustup), Python 3.12, uv

### Dev Mode

```bash
# Terminal 1 — Python backend
cd backend
uv run uvicorn main:app --reload --port 8000

# Terminal 2 — Tauri frontend
npm run tauri dev
```

### Build for Production

```bash
npm run tauri build
```

---

## Coding Conventions

### Frontend
- Components: **PascalCase**, one per file
- Hooks: `use` prefix, camelCase (e.g. `useWatchlist`, `useLiveQuote`)
- All API calls go through **TanStack Query** — never fetch directly inside components
- Global state in **Zustand stores**, local state in `useState`
- No inline styles — Tailwind classes only
- Use **shadcn/ui** for all base UI elements (buttons, inputs, dialogs, tables)
- Charts are wrapped components — never use TradingView Lightweight Charts directly in pages

### Backend
- Route handlers are **thin** — business logic lives in `/services`, not in `/routers`
- Use **Polars** for all dataframe operations — not Pandas
- All IBKR interaction goes exclusively through `services/ibkr.py`
- Use **Pydantic models** for all request and response types
- All FastAPI routes must be **async**
- Ruff for formatting and linting — run before committing

---

## What NOT To Do

- **Don't use Pandas** — use Polars
- **Don't add cloud dependencies** — this is a local-only app
- **Don't commit credentials** — no IBKR session tokens, cookies, or API keys in git
- **Don't put business logic in frontend components** — it belongs in services
- **Don't write complex Rust in src-tauri** — keep it minimal, delegate everything to Python
- **Don't call IBKR from the frontend** — always go through the Python sidecar
- **Don't add heavy new dependencies** without a reason

---

## IBKR Setup

This app uses the **IBKR Client Portal Web API** (not the TWS socket API).

1. Download the Client Portal Gateway from IBKR's website
2. Run the gateway: `java -jar root/conf.yaml`
3. Open browser and authenticate at `https://localhost:5000`
4. Leave the gateway running while using Parallax

The session is cookie-based and will time out — re-authenticate if data stops streaming.

---

## Git Workflow

```
main     ← always stable, working app — PRs only, never push directly
dev      ← integration branch
feature/your-feature-name  ← individual work
```

- Open a PR from `feature/*` → `dev`, then `dev` → `main` when stable
- Commit message format: `type: short description`
- Types: `feat`, `fix`, `refactor`, `style`, `docs`, `chore`
- Examples: `feat: add RSI overlay to chart`, `fix: screener not filtering by volume`

---

## Domain Context

We trade US equities and sector ETFs on Interactive Brokers.

Focus areas:
- Technical indicators: RSI, MACD, EMA (9/21/50/200), Bollinger Bands, Volume
- Sector rotation and relative strength screening
- Intraday and swing trade setups

The UI should feel like a professional tool — dense, information-rich, dark theme.
Think TradingView meets Bloomberg terminal aesthetic.