# Phase 8 — End-to-End Test Results

> Branch: `feature/phase8-e2e`
> Started: 2026-04-17
> Environment assumed: IBKR Gateway authenticated, Ollama running with model installed

## Legend

- ✅ PASS
- ❌ FAIL (with notes)
- ⚠️ PARTIAL / caveat
- ⏭️ SKIPPED (with reason)

---

## 8.1 IBKR Connection Lifecycle

Status: _in progress_

| Step | Result | Notes |
|---|---|---|
| Cold start → gateway spawns + auth prompt | | |
| Gateway down at launch → banner + retry | | |
| Session expiry mid-run → `IBKRSessionExpiredError` → banner | | |
| Re-auth banner CTA → reconnect success | | |
| Network drop → clean `IBKRConnectionError` | | |

---

## 8.2 Ollama Detection

Status: _pending_

| Step | Result | Notes |
|---|---|---|
| Ollama not installed → setup guide shown | | |
| Installed but no model → "install a model" CTA | | |
| Model switch mid-session | | |
| Ollama process killed → recovery banner | | |

---

## 8.3 Scanner Flow

Status: _pending_

| Step | Result | Notes |
|---|---|---|
| Preset → filters applied | | |
| Scan returns paginated results | | |
| Row click → slide-over (contract info + 52W) | | |
| "Add to Watchlist" writes to IBKR | | |
| "Open in Analysis" navigates | | |
| Trigger rule created from scanner result | | |
| AI-assisted filters populate bar | | |

---

## 8.4 Trigger Firing

Status: _pending_

| Step | Result | Notes |
|---|---|---|
| `volume_spike` detection fires | | |
| `range_spike` detection fires | | |
| `gap` detection fires | | |
| `long_wick` detection fires | | |
| Watchlist move (source → target) on IBKR | | |
| Auto-expire returns symbol to source | | |
| Dedup prevents double-fire within interval | | |
| Desktop notification + WS alert broadcast | | |

---

## 8.5 Indicator Accuracy

Cross-check 5 symbols × 3 timeframes against TradingView.

| Symbol | TF | RSI | EMA20 | EMA50 | MACD | BB | VWAP | ATR | Fib |
|---|---|---|---|---|---|---|---|---|---|
| AAPL | 1D | | | | | | | | |
| AAPL | 1H | | | | | | | | |
| AAPL | 5m | | | | | | | | |
| SPY | 1D | | | | | | | | |
| TSLA | 1D | | | | | | | | |
| NVDA | 1D | | | | | | | | |
| QQQ | 1D | | | | | | | | |

Tolerance: ≤0.5% deviation = ✅

---

## 8.6 Settings Persistence

Status: _pending_

| Setting | Survives restart? | Notes |
|---|---|---|
| Scan interval | | |
| Default timeframe | | |
| Ollama model selection | | |
| IBKR gateway URL | | |
| Theme / UI prefs | | |
| Watchlist expiry overrides | | |

---

## 8.7 Error + Empty State Coverage

Status: _pending_

Force each condition, verify no blank screens + correct UI.

| Condition | Component | Result |
|---|---|---|
| IBKR auth fail | Shell banner | |
| IBKR network timeout | Toast + retry | |
| Ollama offline | Analysis panel | |
| Scanner zero results | Results table empty state | |
| Empty watchlist | Sidebar empty state | |
| Chart no symbol | Chart empty state | |
| Empty trigger list | Dashboard empty state | |
| Empty alert log | Alert panel empty state | |
| AI chat no history | Prompt-chip empty state | |

---

## 8.8 Fresh-Install Run-Through

Status: _pending_

Clean VM (macOS + Windows) — gateway setup → first symbol → first trigger.

| Step | macOS | Windows | Notes |
|---|---|---|---|
| DMG/MSI installs cleanly | | | |
| Tauri sidecar launches | | | |
| Gateway auto-provisioned (JRE + jar) | | | |
| First IBKR auth completes | | | |
| SQLite DB created | | | |
| First symbol loads | | | |
| First trigger rule fires | | | |

---

## Summary

_Filled in at the end._
