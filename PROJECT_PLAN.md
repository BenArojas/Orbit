# Parallax — Project Plan

> Last updated: 2026-04-08
> Status: Phase 1–4 complete. Phase 5 built (feature/screener-page) — **blocked pending code review and Q9 resolution (TWS API vs IBKR Gateway)**.

---

## Decisions Made

These are locked in. Don't revisit unless something breaks.

| Decision | Choice | Why |
|---|---|---|
| Instrument scope | Any instrument IBKR supports | Focus is US equities/ETFs, but don't restrict — if IBKR has data, show it |
| Desktop framework | Tauri v2 | Local-only, lightweight, cross-platform |
| Charts | TradingView Lightweight Charts v5 | Familiar, open source, high quality |
| AI model | Gemma 4 26B (user picks from installed) | Fully local, 4 tier options by hardware |
| AI input | Structured JSON (pre-computed signals) | Not raw OHLCV — cleaner, more reliable |
| AI scope | Full chat + signal card | Signal card on first response, then follow-up chat |
| Ollama lifecycle | Detect-only, never auto-install | Guide user, don't decide for them |
| Persistence | SQLite (local) | Survives restarts, shared across Hub modules |
| Market data | IBKR Client Portal Web API via ibind | Already paying for data |
| Multi-timeframe | Single chart + timeframe switcher | Simpler UX |
| Background scanner | Runs while app is open only | No system tray mode |
| Dynamic watchlists | Auto-populated by trigger rules | Separate from master IBKR watchlist |
| Fibonacci | Primary tool — auto swing + manual override | Ofek's core trading method |

---

## Task Breakdown

### Legend
- `[Ben]` / `[Ofek]` — assigned to
- `[Both]` — pair or either
- `[?]` — needs investigation before starting

---

### Phase 1: Foundation (Backend Core) — COMPLETE

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 1.1 | FastAPI app skeleton | Ben | DONE | main.py, CORS, lifespan, typed exception handlers, /health |
| 1.2 | IBKR auth service | Ben | DONE | Singleton with retry, typed exceptions, background tickle loop |
| 1.3 | Rate limiter + cache layer | Ben | DONE | aiolimiter token-bucket, in-memory TTL cache (replaced Redis) |
| 1.4 | SQLite schema + service | Ofek | DONE | 3 tables + instruments table (conid PK), WAL mode, full CRUD |
| 1.5 | Market data router | Ben | DONE | /market/quote, /candles, /search, /conid — TradingView format |
| 1.6 | WebSocket handler | Ben | DONE | Two-layer: FastAPI /ws for frontend, IBKR ws with auto-reconnect |
| 1.7 | Pydantic models | Ofek | DONE | Full model set for all routes |
| 1.8 | Indicator computation service | Ofek | DONE | All 14 indicators, Polars→Pandas bridge for pandas-ta |
| 1.9 | Indicator router | Ofek | DONE | POST /indicators/compute — returns candles + all indicators + fib |

---

### Phase 2: Foundation (Frontend Core) — COMPLETE

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 2.1 | App shell + routing | Ofek | DONE | Zustand tab-based routing, pill nav, connection status dot |
| 2.2 | Zustand stores | Ofek | DONE | 5 stores: navigation, chart, watchlist, screener, settings |
| 2.3 | TanStack Query + API client | Ben | DONE | Typed API client, QueryClient with desktop-optimized settings |
| 2.4 | WebSocket hook | Ben | DONE | Auto-reconnect, exponential backoff, handler registration |
| 2.5 | Theme + design tokens | Ofek | DONE | Dark cinematic theme, trading colors with glow, Inter + JetBrains Mono |
| 2.6 | shadcn/ui components | Ofek | DONE | 11 components installed, styled by dark theme |
| 2.7 | Tauri sidecar auto-launch | Ben | DONE | shell + process plugins, polls /health, dev mode skips spawn |

---

### Phase 3: Dashboard — COMPLETE

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 3.1 | Market Pulse bar | Ofek | DONE | SPX/VIX/QQQ/DIA/IWM/TLT/GLD/USO with sparklines |
| 3.2 | Arc gauges | Ofek | DONE | Market Strength, VIX, Rotation, Triggers — SVG with glow |
| 3.3 | Sector Performance panel | Ben | DONE | Sorted bidirectional bars, GET /sectors/performance |
| 3.4 | Sector Rotation RRG | Ben | DONE | Standard JdK method, 5-point trails, GET /sectors/rrg |
| 3.5 | Master Watchlist sidebar | Ben | DONE | IBKR fetch-only, multi-watchlist dropdown, live quotes |
| 3.6 | Dynamic trigger watchlists | Ofek | DONE | Trigger hits with colored glow edges by indicator type |
| 3.7 | Trigger Rules section | Ofek | DONE | Compact list + create modal, full CRUD backend |
| 3.8 | Click stock → Analysis | Both | DONE | navigateToAnalysis(conid) wired throughout |

---

### Phase 4: Technical Analysis Screen

> Goal: Full chart with indicators, Fibonacci, and AI panel.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 4.1 | Chart wrapper (Lightweight Charts) | Ben | DONE | Candlestick + volume, timeframe switcher, live WS updates |
| 4.2 | Indicator overlay system | Ben | DONE | EMA, Bollinger, VWAP as line overlays |
| 4.3 | Sub-chart panels (RSI, MACD, etc.) | Ben | DONE | Stacked instances, ResizeObserver, show/hide via pills |
| 4.4 | Fibonacci retracement overlay | Ofek | DONE | Auto swing high/low detection algorithm |
| 4.5 | Fibonacci manual adjustment | Ofek | DONE | 
| 4.6 | Indicator pill toggles | Ofek | DONE | Per-indicator colors, glow states, wired to chart store |
| 4.7 | AI config panel | Ofek | DONE | Timeframe/indicator multi-select, AI Assist/Manual toggle |
| 4.8 | Action Signal card | Ofek | DONE | Direction badge, confidence, entry/stop/target, checklist |
| 4.9 | AI chat interface | Ben | DONE | Message list + input, scrollable, streaming responses |
| 4.10 | Ollama integration service | Ben | DONE | services/ai.py — structured JSON input, model per-request |
| 4.11 | AI analysis router | Ben | DONE | routers/ai.py — 8 endpoints (status, models, setup-guide, analyze, chat) |
| 4.12 | Ollama lifecycle management | Ben | DONE | services/ollama.py — detect binary, start server, list models, setup guide |
| 4.13 | Prompt builder refactor | Ben | DONE | Extracted to `services/prompt_builder.py`. Per-indicator formatter registry (no if/elif). Dynamic system prompt with per-indicator analysis hints. Token budget (3000) with graceful truncation (drops oldest timeframes first). |
| 4.14 | Watchlist context in /ai/analyze | Ben | DONE | Optional `watchlist` field on AnalyzeRequest (+ TS type). 6 watchlist archetypes matched by substring (RS leaders, short-term, swing, long-term, momentum, mean reversion). Unknown watchlists get generic framing mentioning the name. Wired through router → ai.analyze → build_system_prompt. |

---

### Phase 5: Screener

> Goal: Filter instruments by indicator criteria, display results table.
> Universe source: IBKR Scanner API presets (top gainers, most active, etc.).
> Scan mode: On-demand only (user clicks Scan). Background scan is Phase 6.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 5.1 | Screener filter bar | Ofek | REVIEW | Built — IBKR native filter codes, grouped dropdown (Fundamental/Technical/Analyst/Short Interest) |
| 5.2 | Screener results table | Ofek | REVIEW | Built — Symbol, Name, Type, Price, Chg%, Volume, Mkt Cap; sortable |
| 5.3 | Screener backend service | Ben | REVIEW | Built — scanner_run with native filters + batch snapshots; no indicator computation |
| 5.4 | Screener router | Ben | REVIEW | Built — POST /screener/scan, GET /screener/presets |
| 5.5 | Click result → Analysis | Both | REVIEW | Built — navigateToAnalysis(conid) on row click |
| 5.6 | Universe via IBKR Scanner API | Ben | REVIEW | Built — /iserver/scanner/params + /iserver/scanner/run |

> ⚠️ **Phase 5 blocked — awaiting code review and resolution of Q9 (TWS API vs IBKR Gateway Web API).** Do not merge `feature/screener-page` until Q9 is decided.
> 🧹 **Cleanup needed on branch:** `docker-compose.yml` and `ibkr-gateway/` were committed to `feature/screener-page` by mistake — move to a dedicated `infra/ibkr-gateway` branch or root config area before merge.

---

### Phase 6: Background Scanner + Triggers

> Goal: Periodic scans, trigger detection, desktop notifications.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 6.1 | Background scheduler | Ben | TODO | asyncio task in lifespan, configurable interval (default 5 min) |
| 6.2 | Trigger evaluation engine | Ben | TODO | Compare indicators against rule conditions |
| 6.3 | Trigger hit persistence + dedup | Ofek | TODO | SQLite, don't re-alert same hit |
| 6.4 | Desktop notifications | Ofek | TODO | Tauri notification plugin |
| 6.5 | Fibonacci alert — news candle | Both | TODO | [?] Define criteria (volume + price move %) |
| 6.6 | Alert log component | Ofek | TODO | Timestamped feed on dashboard |

---

### Phase 7: Polish + Integration

> Goal: Everything works together, feels professional.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 7.1 | IBKR disconnect detection + re-auth | Ben | TODO | Detect stale session, show UI prompt |
| 7.2 | Error states for all components | Both | TODO | Skeleton loaders, error boundaries |
| 7.3 | Settings page | Ofek | TODO | Scan interval, timeframe, theme — SQLite persisted |
| 7.4 | Keyboard shortcuts | Ofek | TODO | [?] Define shortcut map |
| 7.5 | Performance optimization | Both | TODO | Virtualized lists, memoized computations |
| 7.6 | End-to-end testing | Both | TODO | Manual testing with live IBKR connection |

---

### Future (v2 — Not In Scope Now)

- Cloud LLM integration (Claude API / OpenAI) for better analysis
- Multi-account support
- Options chain analysis
- System tray mode with persistent scanning
- Ichimoku Cloud, Supertrend, 52-Week indicators
- Export analysis as PDF/image
- Mobile companion (read-only dashboard)

> **Inflect (trading journal)** is Phase 4 of the Hub roadmap, built after Parallax and MoonMarket.

---

## Open Questions

| # | Question | Related Task | Status |
|---|---|---|---|
| Q1 | ~~What Ollama model for analysis?~~ | 4.10 | RESOLVED: Gemma 4 26B recommended, 4 tiers, user picks from installed |
| Q2 | ~~How to structure AI prompt with chart data?~~ | 4.10, 4.11 | RESOLVED: Structured JSON — pre-computed indicator signals |
| Q3 | Can Lightweight Charts support draggable Fibonacci? | 4.5 | OPEN — may need custom canvas overlay |
| Q4 | ~~How to get full equity universe from IBKR?~~ | 5.6 | RESOLVED: Use IBKR Scanner API presets as universe source (filtered lists, not raw universe). User picks a preset → backend runs scanner → applies indicator filters on results. |
| Q5 | What defines a "news candle" for Fibonacci alerts? | 6.5 | OPEN — proposal: body > 2x ATR AND volume > 2x avg |
| Q6 | How to calculate Market Strength gauge composite? | 3.2 | OPEN — proposal: advance/decline + % above 200 EMA + McClellan |
| Q7 | ~~Sector Rotation RRG calculation?~~ | 3.4 | RESOLVED: standard JdK method |
| Q8 | ~~Can Ollama be bundled into Tauri?~~ | 4.12 | RESOLVED: detect-only, never auto-install. Guide user instead |
| Q9 | **TWS API or IBKR Client Portal Web API?** | ALL | **OPEN — project paused** |

**Q9 Detail:**

The current backend is built against the **IBKR Client Portal Web API** (REST/WebSocket, requires Docker gateway on port 5001, session-based auth). The alternative is the **TWS API** (socket-based, requires TWS or IB Gateway desktop app running, uses `ibapi` Python client).

Key trade-offs to decide:

| Factor | Client Portal Web API | TWS API |
|---|---|---|
| Data model | REST/JSON, easy HTTP | Raw socket, callback-based |
| Auth | Browser session (fragile, expires) | TWS app login (persistent) |
| Scanner | ✅ Native `/iserver/scanner/run` | ❌ No scanner endpoint — must build own universe |
| Streaming | WebSocket (gateway managed) | Direct socket (lower latency) |
| Setup friction | Docker + gateway + browser auth | TWS/IB Gateway app always running |
| Backend rewrite scope | Current state | **Full IBKRService rewrite** — all REST calls replaced with `ibapi` callbacks |

**If TWS API is chosen:** `IBKRService`, all routers touching market data, screener service (scanner unavailable — need alternative universe source), and the WebSocket layer must be rewritten. Estimated scope: Phase 1 backend equivalent of work.
