# Parallax

> A local desktop trading decision-support tool for two experienced traders.
> Built with Tauri v2 + React/TypeScript frontend + Python FastAPI sidecar.

---

## Purpose

Parallax is **not a trading bot**. It is a technical analysis and screening tool
that helps make better trading decisions. It connects to Interactive Brokers via
the Client Portal Web API for live market data.

Three core pillars:
1. **Dashboard** — Market pulse, sector rotation, watchlists with trigger-based alerts
2. **Technical Analysis** — TradingView-style charts with 14 indicators + local AI chat
3. **Stock & sector screener** — Filter stocks/ETFs by technical criteria in real time

This app runs **100% locally**. No cloud, no subscriptions, no external servers.
Designed for experienced traders — no hand-holding UI needed.

For the full task breakdown, open questions, and implementation roadmap see `PROJECT_PLAN.md`.

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
- **AI**: Ollama (local LLM, managed by the app)
- **Database**: SQLite (watchlists, trigger rules, settings)

### Tooling
- **Linting**: ESLint + Prettier (frontend), Ruff (backend)
- **Type checking**: TypeScript strict, mypy (backend)
- **Git**: See "Git Policy" section below

---

## Architecture

```
React UI (Tauri webview)
       ↕  TanStack Query (REST) + WebSocket (live data)
Python FastAPI sidecar  [localhost:8000]
       ↕  ibind              ↕  ollama (local)
IBKR Client Portal      Ollama LLM server
  [localhost:5000]         [localhost:11434]
       ↕
   SQLite DB (local file)
```

The Python sidecar starts automatically when Tauri launches.
The frontend **never** talks directly to IBKR or Ollama — all data flows through Python.
Ollama is installed/started/stopped by the app automatically.

---

## Project Structure

```
parallax/
├── src/                          # React frontend
│   ├── components/
│   │   ├── charts/               # TradingView Lightweight Charts wrappers
│   │   ├── dashboard/            # Market pulse, gauges, sector panels
│   │   ├── screener/             # Screener table + filter controls
│   │   ├── indicators/           # Indicator config panels + pill toggles
│   │   ├── watchlist/            # Watchlist sidebar + trigger items
│   │   ├── ai/                   # AI chat panel, signal card, config
│   │   └── ui/                   # shadcn/ui component re-exports
│   ├── hooks/                    # Custom React hooks
│   ├── store/                    # Zustand stores
│   ├── lib/                      # Utilities, type definitions, constants
│   ├── pages/                    # Top-level page/view components
│   └── App.tsx
│
├── src-tauri/                    # Tauri shell — keep this minimal
│   ├── src/
│   │   └── main.rs
│   ├── icons/
│   └── tauri.conf.json
│
├── backend/                      # Python FastAPI sidecar
│   ├── routers/
│   │   ├── market.py             # /market — live quotes, OHLCV candles
│   │   ├── screener.py           # /screener — filtered stock lists
│   │   ├── indicators.py         # /indicators — computed indicator values
│   │   ├── watchlist.py          # /watchlist — CRUD + IBKR sync
│   │   ├── triggers.py           # /triggers — trigger rule CRUD + hits
│   │   └── ai.py                 # /ai — analysis requests to Ollama
│   ├── services/
│   │   ├── ibkr.py               # All IBKR Client Portal logic
│   │   ├── indicators.py         # Indicator computation (14 indicators)
│   │   ├── screener.py           # Screener filter engine
│   │   ├── ai.py                 # Ollama client + prompt templates
│   │   ├── triggers.py           # Trigger evaluation engine
│   │   ├── scanner.py            # Background scanner (asyncio scheduler)
│   │   └── db.py                 # SQLite connection + queries
│   ├── models/                   # Pydantic request/response models
│   ├── main.py                   # FastAPI app entrypoint
│   ├── pyproject.toml
│   └── requirements.txt
│
├── docs/                         # Archived mockups and design references
│   └── demo-layout-a-v2.html    # Approved UI mockup
│
├── PROJECT_PLAN.md               # Full task breakdown + open questions
├── CLAUDE.md                     # This file — read it every session
└── README.md
```

---

## Indicator Set (14 indicators)

| Indicator | Type | Default Params |
|---|---|---|
| RSI | Oscillator | Period: 14 |
| MACD | Oscillator | Fast: 12, Slow: 26, Signal: 9 |
| EMA 9 | Overlay | Period: 9 |
| EMA 21 | Overlay | Period: 21 |
| EMA 50 | Overlay | Period: 50 |
| EMA 200 | Overlay | Period: 200 |
| Fibonacci Retracement | Overlay | Auto swing detection + manual override |
| Volume + Volume MA | Histogram | MA period: 20 |
| Bollinger Bands | Overlay | Period: 20, StdDev: 2 |
| VWAP | Overlay | Intraday reset |
| ATR | Value | Period: 14 |
| Stochastic | Oscillator | K: 14, D: 3, Smooth: 3 |
| OBV | Line | Cumulative |
| ADX | Value | Period: 14 |

Fibonacci is a **primary tool** — the brother's core trading method.
It must support auto swing high/low detection on D/W/M timeframes,
manual endpoint adjustment, and alerts when price reacts from key levels.

---

## Running Locally

### Prerequisites
- IBKR Client Portal Gateway must be running on `localhost:5000`
- Authenticate via browser at `https://localhost:5000` before launching Parallax
- Node.js 20+, Rust (via rustup), Python 3.12, uv
- Ollama installed (app manages start/stop, but binary must be present)

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
- Pages are thin — compose from components, no business logic in pages

### Backend
- Route handlers are **thin** — business logic lives in `/services`, not in `/routers`
- Use **Polars** for all dataframe operations — not Pandas
- All IBKR interaction goes exclusively through `services/ibkr.py`
- Use **Pydantic models** for all request and response types
- All FastAPI routes must be **async**
- Use **typed exceptions** — never bare `except Exception`. Distinguish auth errors, network errors, rate limits, data errors
- Ruff for formatting and linting — run before committing
- SQLite queries go through `services/db.py` — never raw SQL in routers

---

## What NOT To Do

- **Don't use Pandas** — use Polars
- **Don't add cloud dependencies** — this is a local-only app (v1)
- **Don't commit credentials** — no IBKR session tokens, cookies, or API keys in git
- **Don't put business logic in frontend components** — it belongs in backend services
- **Don't write complex Rust in src-tauri** — keep it minimal, delegate everything to Python
- **Don't call IBKR from the frontend** — always go through the Python sidecar
- **Don't call Ollama from the frontend** — always go through the Python sidecar
- **Don't add heavy new dependencies** without a reason
- **Don't use bare `except Exception`** — type your errors

---

## IBKR Setup

This app uses the **IBKR Client Portal Web API** (not the TWS socket API).

1. Download the Client Portal Gateway from IBKR's website
2. Run the gateway: `java -jar root/conf.yaml`
3. Open browser and authenticate at `https://localhost:5000`
4. Leave the gateway running while using Parallax

The session is cookie-based and will time out — re-authenticate if data stops streaming.
Only one active session at a time. Logging in on phone/browser kills the desktop session.
The app must detect this and prompt re-authentication gracefully.

---

## Git Policy

### Branch Structure

```
main                    ← production-ready, always stable
  └── dev               ← integration branch, features merge here first
        ├── feature/*   ← new features (e.g. feature/dashboard-gauges)
        ├── fix/*       ← bug fixes (e.g. fix/websocket-reconnect)
        └── refactor/*  ← code improvements (e.g. refactor/ibkr-error-handling)
```

### Rules

1. **Never push directly to `main`**. All changes go through PRs.
2. **Never push directly to `dev`**. All changes go through PRs from feature branches.
3. **One feature branch per task**. Branch from `dev`, name it `feature/short-description`.
4. **Pull `dev` into your feature branch before opening a PR** to resolve conflicts locally.
5. **PRs require review from the other person** before merging. No self-merging.
   - Exception: trivial fixes (typos, formatting) can self-merge with a comment explaining why.
6. **Squash merge** feature branches into `dev` to keep history clean.
7. **Fast-forward merge** `dev` into `main` when a milestone is stable.
8. **Delete feature branches** after merge.

### Branch Naming

```
feature/dashboard-market-pulse
feature/ibkr-auth-service
fix/websocket-disconnect-handling
refactor/indicator-service-polars
```

### Commit Messages

Format: `type: short description`

Types: `feat`, `fix`, `refactor`, `style`, `docs`, `chore`, `test`

Examples:
```
feat: add RSI overlay to chart component
fix: screener not filtering by volume ratio
refactor: extract IBKR auth into typed error classes
chore: update pandas-ta to 0.4.72
docs: add trigger rule examples to PROJECT_PLAN
```

### Daily Workflow

```bash
# Start of day — sync with dev
git checkout dev
git pull origin dev

# Create feature branch
git checkout -b feature/your-task-name

# Work, commit often with clear messages
git add <files>
git commit -m "feat: description"

# Before PR — rebase onto latest dev
git checkout dev
git pull origin dev
git checkout feature/your-task-name
git rebase dev
# resolve conflicts if any, then:
git push origin feature/your-task-name

# Open PR: feature/* → dev
# Other person reviews and approves
# Squash merge, delete branch
```

### When to Merge dev → main

- A full phase (from PROJECT_PLAN.md) is complete
- Both people have tested the feature end-to-end
- No known broken functionality

---

## Domain Context

We trade US equities and sector ETFs on Interactive Brokers.

Focus areas:
- Technical indicators: RSI, MACD, EMA (9/21/50/200), Fibonacci, Bollinger Bands, Volume
- Sector rotation and relative strength screening
- Intraday and swing trade setups

The UI should feel like a professional tool — dense, information-rich, dark cinematic theme.
Glowing accents, arc gauges, gradient effects. Think TradingView meets Bloomberg terminal
with a sci-fi edge.

---

## IBKR Hub Context

Parallax is one of three modules in the **IBKR Hub** — a single Tauri binary that houses:
- **Parallax** — technical analysis (this app)
- **MoonMarket** — portfolio & account management
- **Inflect** — trading journal (Phase 4, built last)

All three share one Python FastAPI sidecar and one SQLite database.

### conid is the universal instrument key

`conid` (IBKR's contract ID integer) is the primary identifier for all instruments
across every module. Never store or link instruments by ticker string — always by conid.

The `instruments` table in SQLite is the shared cache for conid → symbol/name/type lookups.
Parallax owns this table (task 1.4). All other modules read from it.

### What Inflect needs from Parallax

Nothing special. Inflect will call the existing `/indicators` endpoint to fetch indicator
context (RSI, MACD, Fibonacci levels, etc.) at the time of a trade entry. No journal-specific
code belongs in Parallax. Build the indicator API for Parallax's own needs — Inflect rides
along for free.

### What NOT to add for Inflect

- No journal hooks, callbacks, or event emissions in Parallax
- No "save to journal" buttons or UI in Parallax (that lives in Inflect)
- No schema changes beyond the `instruments` table already planned
