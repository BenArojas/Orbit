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
# Terminal 1 — backend sidecar (with hot reload)
cd backend
uv sync
uv run uvicorn main:app --reload --port 8000

# Terminal 2 — Tauri dev shell (opens the app window)
npm install
npm run tauri dev
```

Authenticate with IBKR at `https://localhost:5001` when prompted.

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
