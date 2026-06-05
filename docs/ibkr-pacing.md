# IBKR Pacing Limits

> **Executable source of truth:** `backend/constants/ibkr_pacing.py`
>
> This document is the human-readable companion. If the two ever disagree,
> the Python file wins — update this doc to match.

## Pacing table

| Endpoint | Limit | Kind | Notes |
|---|---|---|---|
| _global_ | 10 req/sec | per_sec | Across all endpoints to a single IP |
| `/iserver/marketdata/snapshot` | 10 req/sec | per_sec | First call is a pre-flight; data arrives on the second |
| `/iserver/marketdata/history` | 5 concurrent | concurrent | NOT a per-second limit — concurrency cap |
| `/iserver/account/orders` | 1 req / 5 sec | per_sec | |
| `/iserver/account/pnl/partitioned` | 1 req / 5 sec | per_sec | |
| `/iserver/account/trades` | 1 req / 5 sec | per_sec | |
| `/portfolio/accounts` | 1 req / 5 sec | per_sec | |
| `/portfolio/subaccounts` | 1 req / 5 sec | per_sec | |
| `/iserver/scanner/params` | 1 req / 15 min | per_minutes | Cached aggressively — fail-fast on limit |
| `/iserver/scanner/run` | 1 req/sec | per_sec | |
| `/pa/performance` | 1 req / 15 min | per_minutes | Fail-fast on limit |
| `/pa/summary` | 1 req / 15 min | per_minutes | Fail-fast on limit |
| `/pa/transactions` | 1 req / 15 min | per_minutes | Fail-fast on limit |
| `/tickle` | 1 req/sec | per_sec | We POST it for keep-alive |
| `/fyi/` | 1 req/sec | per_sec | Notifications namespace |
| `/sso/validate` | 1 req / 60 sec | per_sec | |

**429 behavior:** IBKR puts the IP in a 15-minute penalty box. Repeat
violators may be blocked permanently. Never retry a 429 without honoring
the `Retry-After` header.

## How limits are enforced

The `@paced` decorator on `IBKRService._request` looks up the IBKR path in
`ENDPOINT_LIMITS` (longest-prefix match, query string stripped) and applies:

- `"per_sec"` → `AsyncLimiter(count, interval_sec)` — callers wait in queue
- `"concurrent"` → `asyncio.Semaphore(count)` — at most N in-flight at once
- `"per_minutes"` → same token bucket but raises `IBKRRateLimitError` instead
  of blocking (multi-minute waits inside a request handler are user-hostile)

If no table entry matches, the global 10 req/sec cap applies.

---

## Troubleshooting: snapshot timeouts and empty price fields

### Symptom: snapshot returns `[{conid: X, _updated: Y}]` with no price fields

**Most likely cause: missing secdef pre-warm.**

Non-STK instruments (CASH, FUT, OPT, CRYPTO, etc.) require
`GET /iserver/secdef/search?symbol=X&secType=Y` to be called before the first
snapshot. Without it, IBKR's internal cache for that instrument is cold and
returns an empty data row.

**Fix:** Confirm `state.secdef_warmed` includes the conid in question. After
`state.reset()` (logout) the set is cleared and must be re-warmed on next use.
See `IBKRService._ensure_secdef` in `backend/services/ibkr.py`.

---

### Symptom: snapshot returns empty rows for STK conids on the first call

**Most likely cause: missing pre-flight.**

IBKR's snapshot endpoint requires a pre-flight call ~750 ms before the real
call. The first response primes their server-side cache; the second returns
populated fields.

**Fix:** Confirm `state.warmed_conids` does NOT include the conid (i.e. it
hasn't been pre-flighted yet). The `_preflight_snapshot` path handles this
automatically for first-time conids. If the conid is already in
`warmed_conids` but fields are still missing, the instrument may be halted,
pre-market, or illiquid — those cases are expected and logged as warnings.

---

### Symptom: 429 errors from IBKR, or requests backing up

**Most likely cause: pacing constants out of date or a new code path bypassing
the `@paced` decorator.**

Run:
```bash
grep -rn "requests_per_second\|RPS\|10 req" backend/
```
Any hit outside `backend/constants/ibkr_pacing.py` is a bug. All pacing must
go through the `ENDPOINT_LIMITS` table.

---

### Symptom: snapshot calls fail immediately after login

**Most likely cause: `/iserver/accounts` was never called.**

IBKR requires `GET /iserver/accounts` before any snapshot or order endpoint
will respond correctly. This is bootstrapped automatically on the first
authenticated transition via `IBKRService.ensure_accounts()`. If
`state.accounts_fetched` is `False`, the bootstrap hasn't run yet — check for
errors in the `ensure_accounts` log lines.

---

## Cold-start call order

See the full protocol in `.claude/skills/parallax-backend/SKILL.md` under
**"Cold-start Protocol"**. Short version:

```
auth_status → ensure_accounts → _ensure_secdef (non-STK only)
    → snapshot pre-flight (750 ms) → snapshot (real call)
```
