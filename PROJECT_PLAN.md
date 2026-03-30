# Parallax — Project Plan

> Last updated: 2026-03-30
> Status: Characterization complete. Ready for implementation.

---

## What Is Parallax

A local-only desktop tool for two experienced traders (Ben + brother).
Not a trading bot — a technical analysis and screening tool that connects
to Interactive Brokers via the Client Portal Web API.

Three screens: Dashboard, Technical Analysis (with AI chat), and Screener.

---

## Decisions Made

These are locked in. Don't revisit unless something breaks.

| Decision | Choice | Why |
|---|---|---|
| Desktop framework | Tauri v2 | Local-only, lightweight, cross-platform |
| Charts | TradingView Lightweight Charts v5 | Familiar to both users, open source, high quality |
| AI (v1) | Ollama — managed by the app | Fully local, no cloud dependency |
| AI (v2 — future) | Cloud LLM (Claude/OpenAI) | Better analysis quality, deferred to later |
| Persistence | SQLite (local) | Survives restarts, no external DB needed |
| Market data | IBKR Client Portal Web API via ibind | Already paying for data through IBKR accounts |
| Multi-timeframe | Single chart + timeframe switcher | Simpler UX, one chart at a time |
| Background scanner | Runs while app is open only | No system tray mode needed |
| Dashboard market pulse | Color-coded cards with mini sparklines | Quick scannable market read |
| Dashboard gauges | Arc gauges for Market Strength, VIX, Rotation, Triggers | Non-standard visual — approved in v2 mockup |
| Dynamic watchlists | Auto-populated by trigger rules | Separate from master IBKR-synced watchlist |
| Fibonacci | Primary tool — auto swing detection + manual override | Brother's core trading method |

---

## Approved Design

The approved mockup is **Layout A v2** (`demo-layout-a-v2.html` — archived in `/docs`).

Key visual elements:
- Dark cinematic theme with glowing accents (cyan/green/red/orange/purple)
- Gradient logo, pill navigation, arc gauges
- Glowing left-edge indicators on watchlist items for trigger hits
- Indicator pills with colored glow states
- TrendSpider-style Action Signal cards for AI analysis output
- Animated signal card reveal on "Run Analysis"

---

## Architecture

```
React UI (Tauri webview)
       ↕  TanStack Query (REST) + WebSocket (live data)
Python FastAPI sidecar  [localhost:8000]
       ↕  ibind + Ollama (local AI)
IBKR Client Portal Gateway  [localhost:5000]
```

Data never leaves the machine. The Python sidecar starts with Tauri.
Frontend never talks directly to IBKR or Ollama.

---

## Indicator Set (14 indicators)

These are available as chart overlays AND screener filter criteria:

| # | Indicator | Type | Notes |
|---|---|---|---|
| 1 | RSI (14) | Oscillator | Overbought/oversold momentum |
| 2 | MACD (12/26/9) | Oscillator | Trend direction + momentum |
| 3 | EMA 9 | Overlay | Fast moving average |
| 4 | EMA 21 | Overlay | Short-term trend |
| 5 | EMA 50 | Overlay | Medium-term trend |
| 6 | EMA 200 | Overlay | Long-term trend |
| 7 | Fibonacci Retracement | Overlay | Auto swing detection + manual adjust |
| 8 | Volume + Volume MA | Histogram | Conviction behind moves |
| 9 | Bollinger Bands (20,2) | Overlay | Volatility envelope |
| 10 | VWAP | Overlay | Intraday anchor |
| 11 | ATR (14) | Value | Volatility / position sizing |
| 12 | Stochastic (14,3,3) | Oscillator | Momentum overbought/oversold |
| 13 | OBV | Line | Volume-price confirmation |
| 14 | ADX (14) | Value | Trend strength |

Future candidates (not in v1): Ichimoku Cloud, Supertrend, 52-Week Hi/Lo.

---

## Reusable Code from MoonMarket

Source: `~/Desktop/Projects/MoonMarket`

| File | What to reuse | What to fix |
|---|---|---|
| `backend/api/auth.py` | IBKR auth flow (status, tickle, SSO validate, logout) | Replace generic exceptions with typed errors |
| `backend/api/market.py` | Market data, historical bars, search, snapshots | Adapt from httpx to ibind patterns |
| `backend/ibkr.py` | Core `_req` method with retry logic | Clean up SSL handling for local gateway |
| `backend/rate_control.py` | Per-endpoint rate limiting | Keep as-is, proven in production |
| `backend/cache.py` | Cache decorator with TTLs | Swap Redis for SQLite-backed cache |
| `backend/ibkr_websocket/handler.py` | WebSocket streaming (smd, spl, sbd topics) | Add auto-reconnect + gap filling |
| `backend/state.py` | In-memory subscription tracking | Extend for trigger rule state |
| `backend/constants.py` | IBKR field codes, period mappings | Keep as-is |
| `backend/routers/watchlist.py` | IBKR watchlist sync | Adapt to new router structure |

**Don't reuse:** Perplexity/Apify AI, Docker/nginx, order placement, options chain, frontend.

---

## Task Breakdown

### Legend
- `[Ben]` / `[Bro]` — assigned to
- `[Both]` — pair or either
- `[?]` — needs further investigation before starting
- `[Blocked]` — depends on another task completing first

---

### Phase 1: Foundation (Backend Core)

> Goal: Python sidecar talks to IBKR, serves data, persists to SQLite.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 1.1 | Set up FastAPI app skeleton (`main.py`, CORS, lifespan) | Ben | DONE | `main.py` — async lifespan creates IBKRService singleton, CORS for `localhost:1420`, typed exception handlers (401/429/502/500), `/health` endpoint. Supporting files: `config.py` (all env vars), `exceptions.py` (typed error hierarchy), `deps.py` (DI helper), `state.py` (Pydantic state model), `models/__init__.py` (HealthResponse, AuthStatusResponse), `routers/auth.py` (GET `/auth/status`, POST `/auth/logout`). Routes: `/health`, `/auth/status`, `/auth/logout`. |
| 1.2 | Port IBKR auth service (`services/ibkr.py`) | Ben | DONE | `services/ibkr.py` — singleton class with `_request()` core HTTP helper (retry on 404/503, typed exceptions for 401/429/4xx, connection errors). Auth methods: `auth_status()`, `tickle()`, `sso_validate()`, `ensure_accounts()`, `logout()`. Background tickle loop (55s interval) auto-starts on successful auth. Clean `shutdown()` cancels all tasks + closes httpx client. No mixin pattern (simpler than MoonMarket). |
| 1.3 | Port rate limiter + cache layer | Ben | DONE | `rate_control.py` — async token-bucket rate limiter via aiolimiter. 8 endpoint patterns matching IBKR's observed limits (global 10/s, history 5 concurrent, tickle 1/s, scanner 1/15min, etc.). `@paced("dynamic")` decorator resolves limiter at call time. `cache.py` — in-memory TTL cache (dict + asyncio.Lock), replaces MoonMarket's Redis. `@cached(ttl=60)` decorator with default key builder. No external dependencies. |
| 1.4 | Set up SQLite schema + service (`services/db.py`) | Bro | TODO | Tables: watchlists, trigger_rules, trigger_hits, settings |
| 1.5 | Market data router (`routers/market.py`) | Ben | TODO | GET /quote, GET /candles, field code mapping |
| 1.6 | WebSocket handler for live streaming | Ben | TODO | Port from MoonMarket, add auto-reconnect |
| 1.7 | Pydantic models for all request/response types | Bro | TODO | Quote, Candle, WatchlistItem, TriggerRule, etc. |
| 1.8 | Indicator computation service (`services/indicators.py`) | Bro | TODO | All 14 indicators via pandas-ta bridged from Polars |
| 1.9 | Indicator router (`routers/indicators.py`) | Bro | TODO | POST /compute with symbol + timeframe + indicator list |

---

### Phase 2: Foundation (Frontend Core)

> Goal: App shell renders, connects to backend, shows live data.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 2.1 | App shell + routing (Dashboard / Analysis / Screener pages) | Bro | TODO | React Router or simple state-based nav |
| 2.2 | Zustand stores (watchlist, chart, screener, settings) | Bro | TODO | Persist settings store to SQLite |
| 2.3 | TanStack Query setup + API client (`lib/api.ts`) | Ben | TODO | Base URL, error handling, typed responses |
| 2.4 | WebSocket hook (`useWebSocket`) | Ben | TODO | Connect to backend WS, dispatch to stores |
| 2.5 | Theme + design tokens (dark theme CSS variables) | Bro | TODO | Match approved mockup color scheme |
| 2.6 | shadcn/ui component setup (buttons, inputs, dialogs, tables) | Bro | TODO | Base components styled to match theme |
| 2.7 | Tauri sidecar auto-launch for Python backend | Ben | TODO | Start uvicorn on app launch, kill on close |

---

### Phase 3: Dashboard

> Goal: Full dashboard with market pulse, gauges, sectors, watchlists.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 3.1 | Market Pulse bar component | Bro | TODO | Color-coded cards with mini sparklines |
| 3.2 | Arc gauge components (Market Strength, VIX, Rotation, Triggers) | Bro | TODO | SVG arc with glow effects |
| 3.3 | Sector Performance panel (YTD bars) | Ben | TODO | Sorted bar chart, green/red gradient fills |
| 3.4 | Sector Rotation RRG panel | Ben | TODO | [?] Need to define RS Momentum calculation |
| 3.5 | Master Watchlist sidebar (synced from IBKR) | Ben | TODO | Fetch from IBKR watchlist API, store in SQLite |
| 3.6 | Dynamic trigger watchlists | Bro | TODO | Render from trigger_hits table, glow edge indicators |
| 3.7 | Trigger Rules section (compact list + create modal) | Bro | TODO | CRUD for trigger rules in SQLite |
| 3.8 | Click stock → navigate to Analysis with ticker | Both | TODO | Wire up routing from any watchlist item |

---

### Phase 4: Technical Analysis Screen

> Goal: Full chart with indicators, Fibonacci, and AI panel.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 4.1 | Chart wrapper component (Lightweight Charts) | Ben | TODO | Candlestick + volume, timeframe switcher |
| 4.2 | Indicator overlay system (toggle indicators on/off) | Ben | TODO | EMA lines, Bollinger Bands as series overlays |
| 4.3 | Sub-chart panels (RSI, MACD, Stochastic, OBV) | Ben | TODO | Stacked below main chart |
| 4.4 | Fibonacci retracement overlay | Bro | TODO | Auto swing high/low detection algorithm |
| 4.5 | Fibonacci manual adjustment (drag endpoints) | Bro | TODO | [?] Need to figure out Lightweight Charts interaction API |
| 4.6 | Indicator pill toggles with glow states | Bro | TODO | Match mockup style |
| 4.7 | AI panel — config section (timeframe + indicator picker) | Bro | TODO | Multi-select chips for analysis parameters |
| 4.8 | AI panel — Action Signal card component | Bro | TODO | Direction, confidence, entry/stop/target, confirmations |
| 4.9 | AI panel — chat interface | Ben | TODO | Message list + input, scrollable |
| 4.10 | Ollama integration service (`services/ai.py`) | Ben | TODO | [?] Need to decide model, prompt template, context format |
| 4.11 | AI analysis router (`routers/ai.py`) | Ben | TODO | POST /analyze with chart data + indicators + timeframes |
| 4.12 | Ollama lifecycle management (install/start/stop) | Ben | TODO | [?] Need to test Ollama CLI bundling in Tauri |

---

### Phase 5: Screener

> Goal: Filter stocks by indicator criteria, display results table.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 5.1 | Screener filter bar component | Bro | TODO | RSI range, EMA trend, volume, fib, MACD, price |
| 5.2 | Screener results table | Bro | TODO | Sortable columns, color-coded badges |
| 5.3 | Screener backend service (`services/screener.py`) | Ben | TODO | Scan universe, compute indicators, apply filters |
| 5.4 | Screener router (`routers/screener.py`) | Ben | TODO | POST /scan, GET /results |
| 5.5 | Click result → navigate to Analysis | Both | TODO | Same pattern as dashboard watchlist |
| 5.6 | Universe definition | Both | TODO | [?] How to get full US equity list from IBKR? Scanner API? |

---

### Phase 6: Background Scanner + Triggers

> Goal: Periodic scans, trigger detection, desktop notifications.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 6.1 | Background scheduler (asyncio task in FastAPI lifespan) | Ben | TODO | Configurable interval (default 5 min) |
| 6.2 | Trigger evaluation engine | Ben | TODO | Compare computed indicators against rule conditions |
| 6.3 | Trigger hit persistence + deduplication | Bro | TODO | Store in SQLite, don't re-alert same hit |
| 6.4 | Desktop notifications via Tauri | Bro | TODO | Tauri notification plugin |
| 6.5 | Fibonacci alert — "news candle" hitting fib level | Both | TODO | [?] Define "news candle" criteria (volume + price move %) |
| 6.6 | Alert log component on dashboard | Bro | TODO | Timestamped feed of trigger events |

---

### Phase 7: Polish + Integration

> Goal: Everything works together, feels professional.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 7.1 | IBKR session disconnect detection + re-auth prompt | Ben | TODO | Detect stale session, show UI prompt |
| 7.2 | Error states for all components (loading, error, empty) | Both | TODO | Skeleton loaders, error boundaries |
| 7.3 | Settings page (scan interval, default timeframe, theme tweaks) | Bro | TODO | Persisted to SQLite settings table |
| 7.4 | Keyboard shortcuts (switch screens, toggle indicators) | Bro | TODO | [?] Define shortcut map |
| 7.5 | Performance optimization (large watchlists, many indicators) | Both | TODO | Virtualized lists, memoized computations |
| 7.6 | End-to-end testing with live IBKR connection | Both | TODO | Manual testing checklist |

---

### Future (v2 — Not In Scope Now)

- Cloud LLM integration (Claude API / OpenAI) for better analysis
- Multi-account support
- Options chain analysis
- System tray mode with persistent scanning
- Ichimoku Cloud, Supertrend, 52-Week indicators
- Trade journaling / logging
- Export analysis as PDF/image
- Mobile companion (read-only dashboard)

---

## Open Questions

These need answers before their related tasks can start:

| # | Question | Related Task | Notes |
|---|---|---|---|
| Q1 | What Ollama model to use for chart analysis? | 4.10 | Candidates: llama3, mistral, codellama. Need to test quality vs speed |
| Q2 | How to structure the AI prompt with chart data? | 4.10, 4.11 | Send raw OHLCV + computed indicators as JSON? Or a text summary? |
| Q3 | Can Lightweight Charts support draggable Fibonacci endpoints? | 4.5 | May need custom canvas overlay on top of the chart |
| Q4 | How to get full US equity universe from IBKR? | 5.6 | Scanner API can return filtered lists, but not a raw universe dump |
| Q5 | What defines a "news candle" for Fibonacci alerts? | 6.5 | Proposal: candle body > 2x ATR AND volume > 2x avg |
| Q6 | How to calculate Market Strength gauge composite? | 3.2 | Proposal: combine advance/decline + % above 200 EMA + McClellan |
| Q7 | Sector Rotation (RRG) — what RS calculation? | 3.4 | Standard: price ratio vs SPX, smoothed with EMA. Need period params |
| Q8 | Can Ollama be bundled into a Tauri app? | 4.12 | May need to shell out to ollama CLI. Test on Mac + Windows |
