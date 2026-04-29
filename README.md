# Parallax

Local desktop trading decision-support tool. Connects to Interactive Brokers
via the Client Portal Web API for live market data. Supports any instrument
IBKR provides — stocks, ETFs, futures, forex, options.

**Not a trading bot** — technical analysis, screening, and watchlists with
trigger-based alerts to help make better trading decisions.

## Documentation map

If you're looking for something specific, this is where it lives.

### Project state & planning

| File | What it covers |
|------|----------------|
| [`PROJECT_PLAN.md`](PROJECT_PLAN.md) | Phase-by-phase task tracker, locked decisions, owner assignments, "what shipped where". The canonical source of truth for "what's done and what's next." |
| [`CLAUDE.md`](CLAUDE.md) | Project rules (Polars only, typed errors, conid as universal key, etc.) and pointers to the skill files below. Loaded automatically by Claude Code. |

### Setup & how-to

| File | What it covers |
|------|----------------|
| [`README.md`](README.md) | This file — stack overview, architecture diagram, dev setup, packaging instructions. |
| [`backend/README.md`](backend/README.md) | Backend module map (services, routers, exceptions). Quick `uv sync` + run + test recipes. |

### Reference & learning

| File | What it covers |
|------|----------------|
| [`backend/docs/gateway-lifecycle.md`](backend/docs/gateway-lifecycle.md) | How the IBKR Gateway lifecycle actually works — process trees, signals, the cleanup chain, pid-file recovery, the three recovery levels in the UI. Read this when you want to understand *why* the gateway code is the way it is. |
| [`backend/docs/ibkr_market_data_fields.md`](backend/docs/ibkr_market_data_fields.md) | IBKR Client Portal market-data field IDs (e.g. `31` = last price, `7762` = volume). Reference when adding new fields to snapshot endpoints. |

### Claude skills (loaded on demand by Claude Code)

These are not meant to be read top-to-bottom. Claude loads them when a task matches their trigger. Listed here so you know what context is available.

| Skill | Triggers on |
|-------|-------------|
| [`.claude/skills/parallax-backend/SKILL.md`](.claude/skills/parallax-backend/SKILL.md) | Any backend task — routers, services, models, indicators, IBKR, DB. |
| [`.claude/skills/parallax-frontend/SKILL.md`](.claude/skills/parallax-frontend/SKILL.md) | Any frontend task — components, hooks, pages, stores, charts, styling. |
| [`.claude/skills/parallax-git/SKILL.md`](.claude/skills/parallax-git/SKILL.md) | Branching, commit messages, PR workflow, merge policy. |
| [`.claude/skills/parallax-hub/SKILL.md`](.claude/skills/parallax-hub/SKILL.md) | Cross-module concerns: instruments table, conid lookups, MoonMarket/Inflect boundaries. |
| [`.claude/skills/parallax-v2-roadmap/SKILL.md`](.claude/skills/parallax-v2-roadmap/SKILL.md) | Future features, deferred work, "is this v1 or v2?" decisions. |

---

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
┌─────────────┐       ┌─────────────────────────────┐       ┌──────────────┐
│  Tauri v2    │──HTTP──▶  Python FastAPI sidecar     │──HTTP──▶  IBKR Client │
│  React UI    │◀──WS───│  localhost:8000              │◀──WS───│  Portal      │
└─────────────┘       │  Indicators · AI · Triggers  │       │  Gateway     │
                      └─────────────────────────────┘       │  :5001       │
                                     │                       └──────────────┘
                                     ▼
                               ┌───────────────┐
                               │    SQLite      │
                               │  ~/.parallax/  │
                               └───────────────┘
```

All data flows through the Python sidecar. The frontend never talks to IBKR
or Ollama directly.

---

## Development

### Prerequisites

- Node.js 20+
- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Rust (stable) — install via [rustup](https://rustup.rs/)
- An Interactive Brokers account (paper or live)

### IBKR Gateway Setup

Parallax communicates with IBKR through the Client Portal Gateway on
`localhost:5001`. On first launch, click **"Set Up Gateway"** in the sidebar
— the app downloads a portable Java 17 runtime and the Gateway automatically
into `~/.parallax/gateway/`. No system Java required.

### Running in Development

```bash
# One-time setup
cd backend && uv sync && cd ..
npm install

# Terminal 1 — backend sidecar (with hot reload + clean shutdown)
./scripts/dev-backend.sh        # macOS / Linux
pwsh ./scripts/dev-backend.ps1  # Windows

# Terminal 2 — Tauri dev shell (opens the app window)
npm run tauri dev
```

Authenticate with IBKR at `https://localhost:5001` when prompted.

> **Why the wrapper?**  `uvicorn --reload` doesn't always propagate shutdown
> signals to the worker — closing the terminal window in particular skips
> lifespan shutdown, leaving the IBKR Gateway JVM running on `:5001` as an
> orphan.  The wrapper traps `SIGINT/SIGTERM/SIGHUP` and kills any process
> listed in `~/.parallax/gateway/gateway.pid` before exiting.  If the
> wrapper itself is hard-killed, the next launch's pid-file recovery
> picks up the orphan and either adopts or replaces it cleanly.

### Tests

```bash
cd backend && uv run pytest -v
```

---

## Building for Release

### 1. Build the Python sidecar

The backend is bundled into a self-contained binary using PyInstaller.
Run this once before `tauri build` (CI does it automatically on tag push).

**macOS / Linux:**
```bash
bash scripts/build-backend.sh
# → src-tauri/binaries/parallax-backend-<target-triple>
```

**macOS universal (arm64 + x86_64 lipo'd):**
```bash
bash scripts/build-backend.sh --universal
# → src-tauri/binaries/parallax-backend-universal-apple-darwin
```

**Windows (PowerShell):**
```powershell
pwsh scripts\build-backend.ps1
# → src-tauri\binaries\parallax-backend-x86_64-pc-windows-msvc.exe
```

### 2. Build the Tauri app

```bash
# macOS — universal .dmg (requires the universal sidecar above)
npm run tauri build -- --target universal-apple-darwin

# Windows — .msi + NSIS installer
npm run tauri build
```

Artifacts land in `src-tauri/target/`.

> **macOS Gatekeeper note:** The app is unsigned. On first launch right-click
> the app in Finder → Open to bypass the warning.

---

## Shipping a Release

Everything is automated. Push a semver tag to `main` and CI does the rest.

```bash
# 1. Make sure main is up to date
git checkout main && git merge dev && git push origin main

# 2. Tag the release
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions runs four jobs:

| Job | Runner | What it does |
|-----|--------|--------------|
| Sidecar arm64 | macos-14 | PyInstaller → arm64 binary |
| Sidecar x86_64 | macos-13 | PyInstaller → x86_64 binary |
| Build macOS | macos-14 | lipo → universal binary, `tauri build --target universal-apple-darwin` |
| Build Windows | windows-latest | PyInstaller + `tauri build` |

When all jobs pass, a **draft release** appears on GitHub with the `.dmg` and
Windows installer attached. Review it and click Publish.

### User data

All data (watchlists, triggers, settings, IBKR gateway) lives in
`~/.parallax/`. It survives reinstalls — users never lose their config.

---

## 100% Local

No cloud. No subscriptions. No external servers. Everything runs on your machine.
