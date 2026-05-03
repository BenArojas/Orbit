---
name: parallax-backend
description: Python FastAPI backend conventions for Parallax. Use whenever working on routers, services, models, indicators, IBKR integration, database, or any file under backend/. Covers architecture, coding patterns, indicator set, and IBKR setup. Trigger on any backend task — API endpoints, data processing, indicator computation, database queries, or Python code.
---

# Backend Conventions

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

The Python sidecar starts automatically when Tauri launches. Frontend never talks directly to IBKR or Ollama.

## Project Structure

```
backend/
├── routers/
│   ├── market.py        # /market — live quotes, OHLCV candles
│   ├── screener.py      # /screener — filtered stock lists
│   ├── indicators.py    # /indicators — computed indicator values
│   ├── watchlist.py     # /watchlist — CRUD + IBKR sync
│   ├── triggers.py      # /triggers — trigger rule CRUD + hits
│   └── ai.py            # /ai — analysis requests to Ollama
├── services/
│   ├── ibkr.py          # All IBKR Client Portal logic
│   ├── indicators.py    # Indicator computation (14 indicators)
│   ├── screener.py      # Screener filter engine
│   ├── ai.py            # Ollama client + prompt templates
│   ├── triggers.py      # Trigger evaluation engine
│   ├── scanner.py       # Background scanner (asyncio scheduler)
│   └── db.py            # SQLite connection + queries
├── models/              # Pydantic request/response models
├── main.py              # FastAPI app entrypoint
├── pyproject.toml
└── requirements.txt
```

## Coding Patterns

- Route handlers are **thin** — business logic lives in `/services`, not `/routers`
- All IBKR interaction goes exclusively through `services/ibkr.py`
- **Pydantic models** for all request and response types
- All FastAPI routes must be **async**
- **Typed exceptions** — never bare `except Exception`. Distinguish auth, network, rate-limit, data errors
- **Polars** for all dataframe operations — never Pandas
- Ruff for formatting and linting — run before committing
- SQLite queries go through `services/db.py` — never raw SQL in routers
- **`DatabaseService` write-lock invariant** — every method that writes to
  SQLite must dispatch through `await self._run_write(fn)`, not
  `await asyncio.to_thread(fn)` directly. The class shares one
  `sqlite3.Connection` across asyncio worker threads
  (`check_same_thread=False`), and Python's `sqlite3.Connection` is not
  safe for concurrent use — two workers calling `.execute()` /
  `.commit()` simultaneously will raise `SQLITE_MISUSE` ("bad parameter
  or other API misuse") or `cannot start a transaction within a
  transaction`. `_run_write` serialises writes behind
  `self._write_lock` (an `asyncio.Lock`). **Reads** (`_fetchone` /
  `_fetchall`) bypass the lock — SQLite WAL mode handles read-vs-write
  at the file level. This rule was introduced after a real production
  regression in Phase 8 / Task 1.5 (sectors cold-start fanned out 11
  parallel `get_conid()` calls and tripped MISUSE). See
  `backend/services/db.py:_run_write` docstring and
  `backend/tests/test_db_concurrent_writes.py` for the regression suite.
- **Pacing constants** — IBKR rate limits live exclusively in
  `backend/constants/ibkr_pacing.py`. Never hardcode `requests_per_second`
  / RPS / "10 req" literals elsewhere. Add new endpoints to the
  `ENDPOINT_LIMITS` dict; the `paced` decorator on
  `IBKRService._request` reads from there at call time.
- Package manager: **uv**

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

Fibonacci is a **primary tool** — core trading method. Must support auto swing high/low detection on D/W/M timeframes, manual endpoint adjustment, and alerts when price reacts from key levels.

## IBKR Setup

Uses the **Client Portal Web API** (not the TWS socket API).

1. Client Portal Gateway runs on `localhost:5000`
2. Authenticate via browser at `https://localhost:5000`
3. Session is cookie-based, will time out — app must detect and prompt re-auth
4. Only one active session at a time — logging in elsewhere kills the desktop session

## Running Dev

```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```

## Stack Reference

- Python 3.12, FastAPI + uvicorn
- Polars (data), pandas-ta (indicators, bridged)
- ibind (IBKR Client Portal wrapper)
- Ollama (local LLM)
- SQLite, Ruff, mypy
