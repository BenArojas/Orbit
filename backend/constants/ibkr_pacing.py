"""
IBKR Client Portal API pacing limits — single source of truth.

Reproduces the "Pacing Limitations" table from the IBKR Client Portal Web API
docs. Every IBKR-facing service reads from this module — never hardcode pacing
values elsewhere.

Three kinds of limits are represented:
  - "per_sec":     count requests admitted per `interval_sec` seconds (token
                   bucket). Excess callers wait.
  - "concurrent":  at most `count` requests in flight at once (semaphore).
                   Excess callers wait until one returns.
  - "per_minutes": count requests admitted per `interval_sec` seconds (token
                   bucket), but the limiter is expected to fail-fast rather
                   than block — multi-minute waits inside a request handler
                   are user-hostile. The decorator in `rate_control.py` raises
                   `IBKRRateLimitError(retry_after=interval_sec)` instead.

Path matching: callers pass the IBKR endpoint path (e.g. `/iserver/marketdata
/snapshot?conids=1,2`). The lookup helper normalizes by stripping the query
string and any trailing slash, then picks the longest entry in
`ENDPOINT_LIMITS` whose key is a prefix of the normalized path. If nothing
matches, the global 10-req/sec cap applies.

Source: IBKR docs, "Pacing Limitations" section.
"""

from dataclasses import dataclass
from typing import Literal


# 429 from IBKR results in a 15-minute IP penalty box. Repeat violators may be
# blocked permanently. Never retry a 429 without honoring `Retry-After`.
GLOBAL_LIMIT_PER_SEC = 10


LimitKind = Literal["per_sec", "concurrent", "per_minutes"]


@dataclass(frozen=True)
class EndpointLimit:
    """A single row of the IBKR pacing table.

    `kind` selects the limiter strategy used by `rate_control._get_limiter`:
      - "per_sec":     AsyncLimiter(count, interval_sec)
      - "concurrent":  asyncio.Semaphore(count)
      - "per_minutes": AsyncLimiter(count, interval_sec) with fail-fast on full

    `count` and `interval_sec` are the rate parameters. For "concurrent",
    `interval_sec` is unused (kept for shape symmetry).
    """

    kind: LimitKind
    count: int
    interval_sec: int


# ── Pacing table — one entry per row of the IBKR docs table ────────────
#
# Keys are exact IBKR path prefixes. Longest-prefix wins, so more specific
# paths (e.g. `/iserver/account/pnl/partitioned`) override shorter ones. Do
# not add regex characters here — the lookup uses str.startswith().
ENDPOINT_LIMITS: dict[str, EndpointLimit] = {
    # 10 req/sec — same as the global cap, listed for explicitness so the
    # snapshot path always resolves a dedicated limiter (cached per-path) and
    # never falls through to the global one.
    "/iserver/marketdata/snapshot": EndpointLimit("per_sec", 10, 1),

    # 5 concurrent — NOT a per-second limit. Exceeding it returns 429.
    "/iserver/marketdata/history": EndpointLimit("concurrent", 5, 0),

    # 1 req / 5 sec — account + portfolio reads
    "/iserver/account/": EndpointLimit("per_sec", 1, 5),
    "/iserver/account/orders": EndpointLimit("per_sec", 1, 5),
    "/iserver/account/pnl/partitioned": EndpointLimit("per_sec", 1, 5),
    "/iserver/account/trades": EndpointLimit("per_sec", 1, 5),
    "/iserver/reply": EndpointLimit("per_sec", 1, 5),
    "/portfolio/accounts": EndpointLimit("per_sec", 1, 5),
    "/portfolio/subaccounts": EndpointLimit("per_sec", 1, 5),

    # 1 req / 15 min — performance/summary/transactions and scanner params.
    # Marked "per_minutes" so the decorator fails fast instead of blocking
    # the request handler for up to 15 minutes.
    "/pa/allperiods": EndpointLimit("per_minutes", 1, 900),
    "/pa/performance": EndpointLimit("per_minutes", 1, 900),
    "/pa/summary": EndpointLimit("per_minutes", 1, 900),
    "/pa/transactions": EndpointLimit("per_minutes", 1, 900),
    "/iserver/scanner/params": EndpointLimit("per_minutes", 1, 900),

    # 1 req/sec — scanner run, tickle, fyi/* notifications
    "/iserver/scanner/run": EndpointLimit("per_sec", 1, 1),
    "/tickle": EndpointLimit("per_sec", 1, 1),
    "/fyi/": EndpointLimit("per_sec", 1, 1),

    # 1 req / 60 sec — single-session validate. Treated as a normal
    # waiting limiter (60s is short enough to wait inside a request).
    "/sso/validate": EndpointLimit("per_sec", 1, 60),
}


def normalize_path(path: str) -> str:
    """Strip query string and any trailing slash from an IBKR endpoint path.

    The IBKR API base URL is stripped at the httpx layer; what reaches
    rate-limiting is always a leading-slash path like `/iserver/...`. Query
    strings are dropped because pacing applies to the path, not the params.
    """
    # Drop query string
    qmark = path.find("?")
    if qmark != -1:
        path = path[:qmark]
    # Drop fragment (defensive — IBKR doesn't use them)
    hashmark = path.find("#")
    if hashmark != -1:
        path = path[:hashmark]
    # Drop a single trailing slash, but keep "/" itself
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    return path


def lookup_limit(path: str) -> EndpointLimit | None:
    """Return the most specific `EndpointLimit` for `path`, or None if no
    table entry applies (caller falls back to the global 10/sec cap).

    Matching rule: the chosen key is the longest entry in `ENDPOINT_LIMITS`
    such that `normalize_path(path).startswith(key)`.
    """
    normalized = normalize_path(path)
    best_key: str | None = None
    for key in ENDPOINT_LIMITS:
        if normalized.startswith(key):
            if best_key is None or len(key) > len(best_key):
                best_key = key
    if best_key is None:
        return None
    return ENDPOINT_LIMITS[best_key]
