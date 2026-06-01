"""Inflect module constants — single source of truth for the journal's fixed
vocabulary and timing knobs.

Kept out of the service/router modules so the setup vocabulary and timezone are
trivially importable by tests and (later) surfaced to the frontend via
`GET /inflect/setups`.
"""

from __future__ import annotations

# ── Setup-dropdown vocabulary (spec §4.2, C1) ──────────────────
#
# The fixed strategy/setup labels the user picks from when journaling a trade.
# Ordered for the dropdown; "Other" is the catch-all and stays last. Confirmed
# with Ofek 2026-06-01; more may be added later. Tags remain freeform.
SETUP_OPTIONS: list[str] = [
    "Fib retracement",
    "Fib extension",
    "Breakout",
    "Mean reversion",
    "News candle",
    "Other",
]

# ── Trading-day bucketing (C4 / D11) ───────────────────────────
#
# Calendar days bucket by the trade's close time in US/Eastern (exchange time),
# not local wall-clock, so days align to the trading session.
TRADING_DAY_TZ = "US/Eastern"

# ── Background sync cadence (D5 / spec §7) ─────────────────────
#
# 60s floor. `/iserver/account/trades` is capped at 1 req / 5 sec by the pacing
# limiter, so 60s sits far under it; trade history only changes on a fill, so
# polling faster buys nothing.
SYNC_INTERVAL_SEC = 60

# ── Extended-hours fallback window (C2 / D10 / spec §12) ───────
#
# The sync gate normally derives today's window from `/trsrv/secdef/schedule`
# (holiday-aware). If that call fails, fall back to this hardcoded US/Eastern
# extended-hours window (pre-market open → post-market close), skipping
# weekends. Degrades gracefully rather than stopping the sync.
FALLBACK_SESSION_OPEN_MINUTES = 4 * 60  # 04:00 ET
FALLBACK_SESSION_CLOSE_MINUTES = 20 * 60  # 20:00 ET

# US-equity proxy symbol used to fetch the trading schedule for the sync gate.
# SPY is liquid, always-listed, and on the primary US session calendar.
SCHEDULE_PROXY_SYMBOL = "SPY"
