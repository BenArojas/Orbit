# Parallax — Project Plan

> Last updated: 2026-04-17
> Status: Phase 1–7 complete. Phase 8 (E2E testing) in progress.
---

## IBKR Gateway — What We Learned (2026-04-14)

The auto-provision path (Option B: app downloads JRE + Gateway on first launch) is working. Key findings from getting it to authenticate end-to-end:

**The root cause of the Dispatcher 200 loop (post-2FA redirect back to login):**

Browsers block cookies whose `Domain` is a bare IP address (RFC 6265). The IBKR Gateway proxies session cookies from IBKR's servers (`.ibkr.com`) and remaps them to the local host. When the browser was at `https://127.0.0.1:5001`, the remapped cookies were silently dropped — the browser never stored the `JSESSIONID`. So when Dispatcher was called after 2FA, there was no session cookie → IBKR saw an unauthenticated request → returned 200 (login page).

**The fix:** `IBKR_GATEWAY_HOST = "localhost"` everywhere. `localhost` is a valid cookie domain; `127.0.0.1` is not. MoonMarket worked because Docker port-maps to `localhost`, not `127.0.0.1`.

**Other changes made during this work:**

- `conf.yaml` — mirrored MoonMarket's working config exactly: `ip2loc: false`, `ips.allow: ["*"]`, minimal property set. IBKR Gateway crashes on unknown properties — we stripped everything not confirmed to work (removed `authDelay`, `cors`, `serverOptions`, `ccp`, `proxyRemoteSsl`, `autoRestart`)
- Port — `5001` on all OSes. Port 5000 collides with macOS AirPlay Receiver
- Java 17 — kept. IBKR Gateway (Apr 2023 build, Vert.x/Netty) breaks on newer JVMs. Java 17 LTS is the safe choice
- Removed Docker files — `docker-compose.yml`, `ibkr-gateway/Dockerfile`, `ibkr-gateway/conf.yaml`. The auto-provision path owns the full lifecycle; Docker option was confusing and diverged
- `_ensure_conf_yaml` duplication removed — `reset_conf_yaml()` is the single write path
- `httpx.ReadTimeout` in `IBKRService._request` was unhandled — now caught and raised as `IBKRConnectionError`. `/gateway/status` catches it and returns a clean JSON response instead of crashing the ASGI handler

**What did NOT fix it (documented to avoid re-trying):**

- `ip2loc: false` alone — necessary but not sufficient
- `-Djava.net.preferIPv4Stack=true` JVM flag — not the issue
- Port 5001 vs 5000 — not the issue

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
| Market data | IBKR Client Portal Web API (port 5001) | Staying with this — TWS API rejected (no scanner, callback model). ibind client. |
| Multi-timeframe | Single chart + timeframe switcher | Simpler UX |
| Background scanner | Runs while app is open only | No system tray mode |
| Dynamic watchlists | Auto-populated by trigger rules | Separate from master IBKR watchlist |
| Fibonacci | Primary tool — auto swing + manual override | Ofek's core trading method |
| Trigger watchlist moves | Real IBKR watchlist manipulation | Stocks show in TWS/mobile too, not just Parallax |
| News candle detection | All 4 methods, user selects per rule | Evaluate which works best in practice |

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

> Goal: Filter instruments via IBKR native scanner filters, display paginated results, AI-assisted filter creation.
> Universe source: IBKR Scanner API presets (top gainers, most active, etc.).
> Scan mode: On-demand only (user clicks Scan). Background scan is Phase 6.

#### 5A — Core — DONE

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 5.1 | Screener filter bar | Ofek | DONE | IBKR native filter codes, grouped dropdown (Fundamental/Technical/Analyst/Short Interest) |
| 5.2 | Screener results table | Ofek | DONE | Symbol, Name, Type, Price, Chg%, Volume, Mkt Cap; sortable |
| 5.3 | Screener backend service | Ben | DONE | scanner_run with native filters + batch snapshots; no indicator computation |
| 5.4 | Screener router | Ben | DONE | POST /screener/scan, GET /screener/presets |
| 5.5 | Click result → Analysis | Both | DONE | navigateToAnalysis(conid) on row click |
| 5.6 | Universe via IBKR Scanner API | Ben | DONE | /iserver/scanner/params + /iserver/scanner/run |

#### 5B — Enhancements — DONE

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 5.7 | Quick-peek slide-over | Both | DONE | 400px right panel, contract info endpoint, 52W range bar, "Open in Analysis" + "Add to Watchlist" |
| 5.8 | Skeleton loaders | Ofek | DONE | Shimmer table rows during scan, slide-over skeleton, preset dropdown skeleton |
| 5.9 | Persist last scan | Ben | DONE | Zustand store is module-scoped — results survive page navigation without persist middleware |
| 5.10 | Pagination + uncap results | Ben | DONE | Backend paginates server-side up to 200 from IBKR. Frontend page controls (25/50/100/page) |
| 5.11 | Scanner sort codes | Ben | DONE | IBKR server-side sort via `sort` param. Frontend sort dropdown + direction toggle in filter bar |
| 5.12 | WSH earnings date preset | Ben | DONE | "Earnings This Week" preset with `wshEarningsDate` default filter. Added to Fundamental category |

#### 5C — AI-Assisted Filters — DONE

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 5.13 | AI screener side panel (UI) | Ofek | DONE | Collapsible right panel. Freeform text input + preset quick-question chips. Shows reasoning per filter. |
| 5.14 | AI screener backend endpoint | Ben | DONE | POST `/screener/ai-filters` — query + filter catalogue → Ollama → `{filters: [{code, value, reasoning}]}` |
| 5.15 | AI → filter bar wiring | Both | DONE | AI response auto-populates filter bar pills. User tweaks/removes before scan. |
| 5.16 | Prompt engineering | Ben | DONE | System prompt with IBKR filter catalogue, output schema, edge case handling (ambiguous/conflicting/unknown filters) |

---

### Phase 6: Background Scanner + Triggers — COMPLETE

> Goal: Periodic scans, trigger detection, IBKR watchlist moves, desktop notifications.
> Watchlist strategy: Real IBKR watchlist manipulation (read → modify → overwrite via Client Portal API). Stocks move between IBKR watchlists so they show in TWS/mobile too.
> News candle strategy: Ship all 4 detection methods as selectable options. User picks per-rule. Evaluate which works best in practice.
> Branch: `feature/phase6-scanner-triggers` — 7 commits, pending PR to dev.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 6.1 | Background scheduler | Ben | DONE | asyncio task in lifespan with auth-wait startup. Per-rule `scan_interval_seconds` (default 300). `next_scan_at` tracks per-rule cadence. Runs while app is open only. |
| 6.2 | Trigger evaluation engine | Ben | DONE | Groups rules by conid → batch indicator compute → evaluates conditions (above/below/crosses_above/crosses_below/fires). `dedup_key` prevents double-fires within the interval window. |
| 6.3 | IBKR watchlist moves | Ben | DONE | `move_between_watchlists`: fetch source list → remove conid → overwrite; fetch target list → append conid → overwrite. Uses ibind `create_watchlist`. |
| 6.4 | Trigger hit persistence + dedup | Ofek | DONE | SQLite `trigger_hits` table with `dedup_key` (rule_id + date + interval). `record_trigger_hit` upserts on conflict. `mark_moved_back` flips the bit on successful return. |
| 6.5 | Desktop notifications + WS alerts | Ofek | DONE | Tauri notification plugin fires on trigger hit. Backend WS broadcasts `trigger_alert` event to all frontend clients. Frontend WebSocket hook dispatches to `AlertLog` via TanStack Query `invalidateQueries`. |
| 6.6 | News candle trigger | Both | DONE | 4 methods: `volume_spike` (× 20-bar avg vol), `range_spike` (× 20-bar avg range), `gap` (% vs prev close), `long_wick` (max wick ÷ body). User selects method per rule. `news_candle_method` stored in `trigger_rules`. Frontend `CreateRuleModal` switches to method selector when `indicator = news_candle`. |
| 6.7 | Alert log dashboard panel | Ofek | DONE | 160px bottom panel, full-width. 5-col grid: Time / Symbol / Rule / Condition→Actual / Source→Target. Indicator colour-coded dots. Click row → `navigateToAnalysis(conid)` + auto-dismiss toast. WS `trigger_alert` live-refreshes via TanStack Query. `get_trigger_hits` LEFT JOINs `trigger_rules` to surface `rule_name`. |
| 6.8 | Auto-expire return scanner + watchlist config UI | Ofek | DONE | `watchlist_config` SQLite table: per-watchlist `auto_expire_days` override. Override priority: config row (even NULL = no-expire) beats rule value. `_return_expired_hits()` runs each scanner heartbeat: moves symbol back to source on expiry, only marks `moved_back=1` on IBKR success (retries on failure). Frontend: collapsible "Watchlist Expiry" section in sidebar, IBKR watchlist dropdown, inline day editing. 19 backend tests + 3 trigger-hit tests. |

---

### Phase 7: Polish + Integration — COMPLETE

> Goal: Everything works together, feels professional.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 7.1 | IBKR disconnect detection + re-auth | Both | DONE | Non-blocking banner + Reconnect CTA; `IBKRAuthError` / `IBKRSessionExpiredError`; retries with backoff |
| 7.2 | Error states + toast system | Both | DONE | Skeleton loaders, error boundaries per panel, Sonner toasts for transient errors |
| 7.3 | Settings page + theme fixes | Both | DONE | Scan interval, default timeframe, Ollama model selector, IBKR gateway URL — SQLite-persisted |
| 7.4 | Performance optimization | Both | DONE | 7.4a: query dedup + `useIbkrReadyTier` stagger hook. 7.4b: React.lazy() code splitting for AnalysisPage + ScreenerPage. 7.4c: `@tanstack/react-virtual` for WatchlistSidebar |
| 7.5 | Health status strip + diagnostics | Both | DONE | 🟢/🟡/🔴 strip in shell. Modal: IBKR Gateway, Ollama, Scanner, Database, Background Triggers — plain-English status. "Copy diagnostics" → minimal JSON to clipboard only. No log viewer |
| 7.6 | Empty states | Both | DONE | Shared `<EmptyState>` component. Covers: empty watchlist, chart no symbol, scanner pre-run + zero results, empty trigger list, AI chat no history (prompt chips), empty alert log |
| 7.7 | Release packaging | Both | DONE | PyInstaller `--onefile` sidecar (run.py entry point). `scripts/build-backend.sh` + `.ps1` for local builds. macOS universal .dmg via GitHub Actions lipo (arm64 on macos-14 + x86_64 on macos-13). Windows NSIS + MSI on windows-latest. `.github/workflows/release.yml` — push `v*.*.*` tag → CI builds + draft GitHub Release. No code signing (no paid certs). CORS updated for `tauri://localhost`. `src-tauri/binaries/` gitignored. |

---

### Phase 8: End-to-End Testing

> Goal: Verified correct behaviour across all critical flows with a live IBKR connection.

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|
| 8.1 | IBKR connection lifecycle | Both | DONE* | Cold start, gateway down, session expiry, re-auth banner, reconnect success. *Code-complete incl. 8.1-F (client `navigator.onLine` fast-fail + singleton offline toast + auto-refetch on recovery, 2026-04-17). Still under ongoing manual verification — we re-exercise the login loop every session, so rows A–F stay "live" rather than locked. Brother continues E2E on his machine. |
| 8.2 | Ollama detection walkthrough | Both | TODO | Not installed, installed but no model, model switch mid-session, Ollama crash recovery |
| 8.3 | Scanner flow | Both | TODO | Preset → filters → results → add to watchlist → trigger rule created |
| 8.4 | Trigger firing | Both | TODO | All 4 news candle methods under live data; watchlist move + return; dedup across intervals |
| 8.5 | Chart + indicator accuracy | Both | TODO | Cross-check indicator values vs TradingView on 5 symbols across 3 timeframes |
| 8.6 | Settings persistence | Both | TODO | All settings survive app restart; theme applies on cold launch |
| 8.7 | Error + empty state coverage | Both | TODO | Force each error condition manually; verify correct state renders, no blank screens |
| 8.8 | Fresh-install run-through | Both | TODO | Clean macOS VM + clean Windows VM; gateway setup → first symbol → first trigger |
| 8.9 | Dashboard bugs + request issues | Both | CODE COMPLETE · review pending | Branch `feat/dashboard-phase8-task8.9` off `dev`. Shipped: watchlist 500 fix, 9-tier staggered loads (250 ms cascade), per-component pulse skeletons, Market Pulls rewrite (13 tickers centred, 80 ms inner stagger, sparklines), WS singleton with 10 s teardown grace, real Market Strength + Sector Rotation arc gauges (ETF proxy / 21-day offensive-vs-defensive), VIX click → Analysis(1D), Sector Performance scrollable (3 visible + fade hint), RRG flex-1 min-h 280 px with percentage-based SVG, AlertLog collapse-when-empty + dashboard-scroll-when-populated. 17 new backend tests (9 unwrap + 8 gauges) + 12 tier-hook tests, all green. See [`docs/phase8-task8.9-plan.md`](docs/phase8-task8.9-plan.md). |

---

### Future (v2 — Not In Scope Now)

- Cloud LLM integration (Claude API / OpenAI) for better analysis
- Multi-account support
- Options chain analysis
- System tray mode with persistent scanning
- Ichimoku Cloud, Supertrend, 52-Week indicators
- Export analysis as PDF/image
- Mobile companion (read-only dashboard)
- Keyboard shortcuts
- Backup / restore SQLite (watchlists, triggers, settings export)

> **Inflect (trading journal)** is Phase 4 of the Hub roadmap, built after Parallax and MoonMarket.

---

## Open Questions

| # | Question | Related Task | Status |
|---|---|---|---|
| Q1 | ~~What Ollama model for analysis?~~ | 4.10 | RESOLVED: Gemma 4 26B recommended, 4 tiers, user picks from installed |
| Q2 | ~~How to structure AI prompt with chart data?~~ | 4.10, 4.11 | RESOLVED: Structured JSON — pre-computed indicator signals |
| Q3 | Can Lightweight Charts support draggable Fibonacci? | 4.5 | OPEN — may need custom canvas overlay |
| Q4 | ~~How to get full equity universe from IBKR?~~ | 5.6 | RESOLVED: Use IBKR Scanner API presets as universe source (filtered lists, not raw universe). User picks a preset → backend runs scanner → applies indicator filters on results. |
| Q5 | ~~What defines a "news candle" for Fibonacci alerts?~~ | 6.6 | RESOLVED: Ship all 4 detection methods as user-selectable options. (A) body > 2× ATR + vol > 2× avg, (B) range > 2× ATR + vol > 1.5× avg, (C) price crosses fib + vol > 1.5× avg, (D) price within X% of fib + configurable filter. Evaluate in practice. |
| Q6 | How to calculate Market Strength gauge composite? | 3.2 | OPEN — proposal: advance/decline + % above 200 EMA + McClellan |
| Q7 | ~~Sector Rotation RRG calculation?~~ | 3.4 | RESOLVED: standard JdK method |
| Q8 | ~~Can Ollama be bundled into Tauri?~~ | 4.12 | RESOLVED: detect-only, never auto-install. Guide user instead |
| Q9 | ~~TWS API or IBKR Client Portal Web API?~~ | ALL | RESOLVED: staying with Client Portal Web API. TWS API rejected — no scanner endpoint, callback model would require full backend rewrite. |
