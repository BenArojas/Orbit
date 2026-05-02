# Phase 8 — Dashboard request-fan-out optimization plan

**Author note for the executing LLM:** This plan is the source of truth for a multi-task refactor. Each task is self-contained, has a target branch name, lists every file you need to touch, states the main behavioral change, calls out the IBKR-docs source where relevant, and specifies the tests to add. Execute tasks **in the listed order** unless an explicit dependency note says otherwise — later tasks assume earlier ones are merged. Per project rule #7, **create a new git branch for every task**, branch name is given in each section. Per rule #1, every task ships with new tests covering the changed code. Per rule #4, never use bare `except Exception` — use the typed errors in `backend/exceptions.py`. Per rule #2, all dataframe code uses Polars (pandas-ta is the only bridged exception). Per rule #5, the React frontend NEVER talks to IBKR directly — every call goes through the FastAPI sidecar. Per rule #6, instruments are linked by conid, never by ticker string.

When you finish a task: run the tests, commit on the task branch, and stop. Wait for human review before opening the next task.

---

## Background — what we learned from the logs

Frontend (HAR, 170s window, post-login dashboard):

| Endpoint | Count | p50 | p95 | max |
|---|---|---|---|---|
| `/market/quote/:id` | 85 | 5.0s | 43.5s | 46s |
| `/gateway/status` | 27 | 0.5s | 8.6s | 33.6s |
| `/market/candles/:id` | 20 | 38.2s | 53.7s | 53.7s |
| `/health/details` | 14 | 7ms | 35.5s | 35.5s |
| `/sectors/breadth` | 2 | 40.0s | — | — |
| `/sectors/rotation` | 2 | 30.6s | — | — |
| `/sectors/performance` | 2 | 42.9s | — | — |
| `/watchlist/10/quotes` | 2 | 11.0s | — | — |

Backend (httpx → IBKR Gateway, same window): hundreds of `/iserver/marketdata/snapshot` calls because IBKR's first snapshot for a fresh conid returns no fields. Many `503 Service Unavailable` on `/iserver/marketdata/history` (cold cache). `Snapshot timed out for conids [X] after 5.0s` repeats for derivative-class conids that never had `/iserver/secdef/search` called for them.

Three independent polling clocks (`/gateway/status` 10s, `/health/details` 10s, `/ai/status` 10s/60s) each trigger their own IBKR auth probe → ~12 redundant IBKR `auth/status` POSTs per minute.

---

## IBKR Pacing limits — the source of truth

Save as `backend/constants/ibkr_pacing.py`. Every IBKR-facing service reads from this module — never hardcode pacing values elsewhere.

| Endpoint | Method | Limit | Notes |
|---|---|---|---|
| _global_ | any | **10 req/sec** | Across all endpoints to a single IP |
| `/iserver/marketdata/snapshot` | GET | **10 req/sec** | First call is a pre-flight; data arrives on subsequent calls |
| `/iserver/marketdata/history` | GET | **5 concurrent** | NOT a per-second limit — concurrency cap |
| `/iserver/scanner/params` | GET | 1 req / 15 min | Cache aggressively |
| `/iserver/scanner/run` | POST | 1 req/sec | |
| `/iserver/account/orders` | GET | 1 req / 5 sec | |
| `/iserver/account/pnl/partitioned` | GET | 1 req / 5 sec | |
| `/iserver/account/trades` | GET | 1 req / 5 sec | |
| `/portfolio/accounts` | GET | 1 req / 5 sec | |
| `/portfolio/subaccounts` | GET | 1 req / 5 sec | |
| `/sso/validate` | GET | 1 req / min | |
| `/tickle` | GET | 1 req / sec | We POST it for keep-alive |
| `/pa/performance` | POST | 1 req / 15 min | |
| `/pa/summary` | POST | 1 req / 15 min | |
| `/pa/transactions` | POST | 1 req / 15 min | |
| `/fyi/*` | various | 1 req / sec | Notifications namespace |

**429 behavior:** IP gets a 15-minute penalty box. Repeat violators may be permanently blocked. Never retry a 429 without honoring `Retry-After`.

---

## Phase 1 — IBKR service core

These tasks change the foundation. Frontend tasks assume they are merged.

### Task 1.1 — Externalize the pacing table

**Branch:** `feat/ibkr-pacing-constants`
**Files to create:**
- `backend/constants/ibkr_pacing.py`
**Files to touch:**
- `backend/rate_control.py` — read pacing from the new module instead of hardcoded values
- `backend/services/ibkr.py` — same

**Main change:** A single source of truth Python module with two structures: `GLOBAL_LIMIT_PER_SEC = 10` and `ENDPOINT_LIMITS: dict[str, EndpointLimit]` where `EndpointLimit` is a dataclass with `kind` (`"per_sec"` | `"concurrent"` | `"per_minutes"`), `count`, `interval_sec`. `rate_control.paced` decorator looks up the limit from `ENDPOINT_LIMITS` by IBKR path (regex-matched, normalized — strip query string, trailing slash) and applies the right `aiolimiter.AsyncLimiter` instance per path. For `kind="concurrent"`, use `asyncio.Semaphore` instead of a per-second limiter. Cache limiter instances per path so repeated requests share the same limiter.

**Source:** IBKR docs section "Pacing Limitations" (the table reproduced above).

**Tests to add (`backend/tests/test_ibkr_pacing.py`):**
- Limiter for `/iserver/marketdata/snapshot` admits exactly 10 calls in <1s, 11th waits.
- Limiter for `/iserver/marketdata/history` admits 5 concurrent, 6th waits until one returns.
- Limiter for `/sso/validate` admits 1 call, 2nd waits until 60s elapsed (test with monkey-patched clock).
- Path matching strips query strings and matches the longest-prefix endpoint pattern.

**Acceptance:** `grep -rn "10 req\|requests_per_second\|RPS" backend/` returns no hardcoded limits outside this module.

---

### Task 1.2 — `/iserver/accounts` cold-start hook

**Branch:** `feat/ibkr-accounts-bootstrap`
**Files to touch:**
- `backend/services/ibkr.py` — add `state.accounts: list[dict]` and `state.selected_account: str | None`; add `async def fetch_accounts(self) -> list[dict]` that calls `GET /iserver/accounts`; modify `auth_status` so that on the first transition to `authenticated=True`, it awaits `fetch_accounts` and stores the result.
- `backend/state.py` — add the new state fields if state lives there (verify location while implementing).
- `backend/routers/auth.py` and `backend/routers/gateway.py` — when either reports authenticated, ensure `fetch_accounts` has been awaited at least once before responding.

**Main change:** IBKR requires `/iserver/accounts` to have been called before `/iserver/marketdata/snapshot` and order endpoints will respond correctly. We currently never call it. Add it as a one-shot bootstrap on the first authenticated transition. Cache the result in `IBKRService.state`. Reset on `state.reset()` so it re-fires after logout / factory-reset.

**Source:** IBKR docs — "Receive Brokerage Accounts" section: *"Note this endpoint must be called before modifying an order or querying open orders."* And the snapshot doc: *"The endpoint /iserver/accounts must be called prior to /iserver/marketdata/snapshot."*

**Tests to add (`backend/tests/test_ibkr_accounts_bootstrap.py`):**
- After `auth_status` returns authenticated, `state.accounts` is populated.
- Calling `auth_status` 5 times triggers exactly one `GET /iserver/accounts` (asserted via mocked httpx).
- After `state.reset()`, the next authenticated transition triggers a fresh `GET /iserver/accounts`.
- If the GET fails with `IBKRRequestError`, the auth path still returns authenticated but logs the warning — accounts will be retried on the next probe.

**Acceptance:** A fresh app startup → log shows exactly one `GET /iserver/accounts` between auth-success and the first snapshot call.

---

### Task 1.3 — Snapshot pre-flight + warmed-conid set

**Branch:** `feat/ibkr-snapshot-preflight`
**Depends on:** Task 1.2 (must run AFTER `/iserver/accounts` has succeeded).
**Files to touch:**
- `backend/services/ibkr.py` — introduce `state.warmed_conids: set[int]`; add `async def _preflight_snapshot(conid: int) -> None`; modify the existing `get_snapshot(conid)` (or equivalent) so:
  1. If `conid in state.warmed_conids` → call snapshot directly, return.
  2. Else → call snapshot once, sleep `PREFLIGHT_DELAY_MS` (default 750ms), call snapshot again, return the second response, add to `warmed_conids`.
  - Use a per-conid `asyncio.Lock` so concurrent callers for the same fresh conid only run one pre-flight. Store the locks in `dict[int, asyncio.Lock]` and clear on `state.reset()`.
- `backend/state.py` if state struct lives there — add `warmed_conids` and the lock dict.
- `backend/config.py` — expose `PREFLIGHT_DELAY_MS` as a tunable env var.

**Main change:** Replace the current "poll until fields populate" pattern with IBKR's documented pre-flight pattern. After the pre-flight, the second call almost always returns populated fields. Coalesces concurrent first-time requests for the same conid via a per-conid lock.

**Source:** IBKR docs — Snapshot endpoint: *"A pre-flight request must be made prior to ever receiving data. For some fields, it may take more than a few moments to receive information."*

**Tests to add (`backend/tests/test_ibkr_snapshot_preflight.py`):**
- Cold call to `get_snapshot(123)` issues exactly 2 IBKR calls, separated by ≥`PREFLIGHT_DELAY_MS`.
- Subsequent call to `get_snapshot(123)` issues exactly 1 IBKR call.
- 5 concurrent callers for the same fresh conid result in 2 IBKR calls total (1 pre-flight + 1 real), all 5 callers receive the same response.
- After `state.reset()`, conid is removed from `warmed_conids`; next call pre-flights again.

**Acceptance:** In the backend logs, you should no longer see 3–7 retry calls per fresh conid; you should see exactly 2 calls (pre-flight then real) for first-time conids and 1 call for already-warmed conids.

**Footnote — `required_fields` removed (2026-04-30):** The previous version
of `IBKRService.snapshot()` accepted `timeout`, `poll_interval`, and
`required_fields` and looped until IBKR populated the requested fields. All
three were dropped when the documented pre-flight pattern landed. Pre-flight
handles cache warm-up, which was the dominant cause of "missing fields"
responses; the screener's existing pass-1/pass-2 logic catches the
remainder. **Future revisit:** if rows still come back missing core fields
after pre-flight (pre-market, illiquid, halted contracts), reintroduce
`required_fields` as a *post-call validator* — log a warning per row missing
the listed fields, but do NOT trigger any retries inside `snapshot()`. That
keeps pre-flight as the warm-up mechanism and `required_fields` purely
diagnostic. Reference: this task's footnote + the removed
`TestSnapshotRequiredFields` block in `tests/test_screener.py`.

---

### Task 1.4 — `/iserver/secdef/search` pre-warm for non-STK contracts

**Branch:** `feat/ibkr-secdef-prewarm`
**Depends on:** Task 1.3 (sits between pre-flight and snapshot for derivative classes).
**Files to touch:**
- `backend/services/ibkr.py` — add `async def _ensure_secdef(conid: int, asset_class: str) -> None`; track `state.secdef_warmed: set[int]`. For any conid whose `asset_class` is in `{"CASH", "FUT", "OPT", "FOP", "WAR", "BOND", "FUND", "IND", "CRYPTO"}`, call `GET /iserver/secdef/search?symbol=<symbol>&secType=<asset_class>` once before the first pre-flight. Cache the conid in `secdef_warmed`. Clear on `state.reset()`.
- Wire into the `get_snapshot` path so the order is: secdef-warm (if needed) → snapshot pre-flight → real snapshot.
- The `asset_class` is already known from the conid resolution (`/market/conid/:symbol` returns it); pass it through.

**Main change:** Pre-warms IBKR's security-definition cache for any non-stock instrument so its market-data subscription succeeds. Without this, BTC/ETH/USD.ILS/VIX/futures conids time out silently in our 5s snapshot wait.

**Source:** IBKR docs — Snapshot endpoint: *"For derivative contracts the endpoint /iserver/secdef/search must be called first."*

**Tests to add (`backend/tests/test_ibkr_secdef_prewarm.py`):**
- Cold snapshot of a CASH-class conid issues `secdef/search` then pre-flight then snapshot — in that order.
- Cold snapshot of a STK-class conid issues NO `secdef/search`.
- 5 concurrent first-time CASH callers issue exactly 1 `secdef/search`.
- After `state.reset()`, secdef must be re-warmed.

**Acceptance (revised 2026-04-30):** The original acceptance referenced
the "Snapshot timed out for conids …" warning, but Task 1.3 already
removed the entire poll loop that emitted those warnings. New acceptance:
after this task ships, snapshots for non-STK conids return rows with
populated price fields (e.g. `31` last price) on the first dashboard
mount instead of the bare `[{conid: X, _updated: Y}]` empty rows we used
to see for BTC / USD.ILS / VIX / futures. Verify by:

1. Tail the backend log during a fresh dashboard mount with a CASH or
   CRYPTO conid in the watchlist. You should see one
   `GET /iserver/secdef/search?symbol=…&secType=…` line BEFORE the first
   `/iserver/marketdata/snapshot` line for that conid.
2. The bulk snapshot response for that conid contains field `31`
   (and any other requested non-system fields), not just `_updated` /
   `conidEx`.
3. After `state.reset()` (logout), repeat — the secdef call must fire
   again before the next snapshot.

**Footnote — IBKR docs vs. plan's asset-class set (2026-04-30):** The
IBKR Client Portal docs only literally list `{STK, IND, BOND}` as valid
`secType` values for `/iserver/secdef/search`, and only describe the
prerequisite for "derivative contracts" (conventionally OPT/FOP/WAR/FUT).
The plan extends both: it pre-warms `{CASH, FUT, OPT, FOP, WAR, BOND,
FUND, IND, CRYPTO}` and passes `secType=<class>` for all of them.
Justification: the broader set is empirical — MoonMarket observed BTC /
USD.ILS / VIX timing out without the warm-up — and IBKR's full asset-class
enumeration (visible on the WebSocket `act` topic's `chartPeriods` field:
STK/CFD/OPT/FOP/WAR/IOPT/FUT/CASH/IND/BOND/FUND/CMDTY/PHYSS/CRYPTO)
suggests these strings are valid IBKR vocabulary even if they aren't
documented on the search page. The implementation calls
`/iserver/secdef/search?symbol=<sym>&secType=<class>` literally and
catches `IBKRRequestError` (4xx) as a logged warning so an undocumented
secType rejection never blocks the snapshot path. If telemetry shows
specific classes always 4xx-ing, drop them from the prewarm set;
`CMDTY` and `PHYSS` are not currently in the set and can be added if
gold/silver conids show similar timeouts.

---

### Task 1.5 — Server-side conid resolution cache (SQLite)

**Branch:** `feat/conid-cache-sqlite`
**Files to touch:**
- `backend/services/db.py` — add a migration creating a `conid_cache` table: `(symbol TEXT, sec_type TEXT, conid INTEGER, asset_class TEXT, name TEXT, resolved_at INTEGER, PRIMARY KEY (symbol, sec_type))`.
- `backend/services/ibkr.py` — modify `resolve_conid(symbol, sec_type)` to read from the cache before hitting IBKR. TTL = forever (conids do not change). Bypass with a `force_refresh` kwarg available only via a CLI/admin endpoint, not via the regular path.
- `backend/routers/market.py` — `/market/conid/:symbol` reads via the cached path automatically.

**Main change:** Conid mappings are stable — IBKR contract IDs never change for an instrument. Today we re-resolve every cold start. Persist mappings in SQLite so a 10–13s cold-start cost on first use becomes ~1ms on every subsequent run.

**Source:** IBKR docs (no specific quote) — conid is documented as the canonical contract identifier and is stable across sessions. Cross-reference: project rule #6.

**Tests to add (`backend/tests/test_conid_cache.py`):**
- First lookup of `("AAPL", "STK")` calls IBKR; second lookup reads cache only.
- Cache survives an in-process service restart (uses real SQLite tempfile).
- `force_refresh=True` bypasses the cache and updates the row.
- Different `sec_type` for the same symbol stores separate rows (e.g. `("USD", "CASH")` vs `("USD", "STK")`).

**Acceptance:** After one warm session, a fresh app start logs zero `/trsrv/secdef/...` or `/iserver/secdef/search?symbol=...` resolution calls during dashboard mount.

---

### Task 1.6 — Server-side snapshot coalescing

**Branch:** `feat/snapshot-coalescing`
**Depends on:** Task 1.3.
**Files to touch:**
- `backend/services/ibkr.py` — introduce a `dict[int, asyncio.Future]` keyed by conid. When `get_snapshot(conid)` is called: if a future already exists for that conid, await it. Else create a future, kick off the work, set the future's result when done, remove it from the dict, return.
- Apply the same pattern to `get_history(conid, period, bar)` keyed by `(conid, period, bar)`.

**Main change:** Multiple concurrent callers for the same conid (e.g. dashboard mount fires `/market/quote/X` from MarketPulse while the watchlist is also querying X) result in exactly one IBKR call. Today they each fire independently.

**Source:** No external docs — this is a standard request-coalescing pattern.

**Tests to add (`backend/tests/test_snapshot_coalescing.py`):**
- 10 concurrent `get_snapshot(99)` calls result in 1 IBKR call; all 10 receive the same response.
- After the future resolves, a fresh `get_snapshot(99)` triggers a new call (the future was cleared).
- A failed future (IBKR raises) propagates the same exception to all awaiters but doesn't pin a stale failure for future calls.

**Acceptance:** Backend log on dashboard mount shows ≤1 IBKR snapshot call per conid in any 1s window, regardless of how many frontend callers want it.

---

### Task 1.7 — Auth-state cache (deduplicate auth probes)

**Branch:** `feat/auth-state-cache`
**Files to touch:**
- `backend/services/ibkr.py` — `state.auth_status_cached: dict | None`, `state.auth_status_at: float`. Modify `auth_status()` to return the cached value if `now - auth_status_at < AUTH_STATUS_TTL_SEC` (default 5s). Always invalidate on `start_tickle_loop` failures and on `session_dropped`.
- `backend/config.py` — `AUTH_STATUS_TTL_SEC` env var.
- `backend/routers/health.py` — read auth status from this cache instead of probing IBKR directly.
- `backend/routers/gateway.py` — replace `_auth_probe_lock` usage with the new cached path; cache makes the lock redundant for read paths.

**Main change:** Multiple polling clocks (`/gateway/status`, `/health/details`, `/auth/status`) each currently trigger an IBKR auth probe. Cache the auth result for 5s server-side; all three endpoints share the cache. Reduces IBKR `auth/status` POSTs from ~12/min to ~2/min in steady state.

**Source:** No external docs — internal optimization.

**Tests to add (`backend/tests/test_auth_state_cache.py`):**
- 5 calls to `auth_status()` within 5s issue exactly 1 IBKR `POST /v1/api/iserver/auth/status`.
- Calling `state.reset()` clears the cache; next call probes IBKR.
- A `session_dropped` event invalidates the cache.

**Acceptance:** Backend log shows at most 1 IBKR `iserver/auth/status` POST per 5s window in steady state.

---

## Phase 2 — Backend routers

### Task 2.1 — Bundled `/market/quotes` endpoint

**Branch:** `feat/bundled-quotes-endpoint`
**Depends on:** Tasks 1.3, 1.6.
**Files to touch:**
- `backend/routers/market.py` — add `GET /market/quotes?conids=1,2,3` returning `{items: [{conid, lastPrice, changePercent, ...}]}`. Internally calls `IBKRService.get_snapshots_bundled(conids)` which uses IBKR's batch snapshot syntax (`?conids=A,B,C`).
- `backend/services/ibkr.py` — add `get_snapshots_bundled(conids: list[int]) -> list[dict]` that:
  1. Pre-flights any conids not in `warmed_conids` (one batch pre-flight via the same comma-syntax).
  2. After 750ms, fires the real bundled snapshot.
  3. Adds all conids to `warmed_conids`.
  4. Splits into batches of ≤50 conids if the input is larger (IBKR's documented batch ceiling — verify by trial; doc doesn't pin a number, the existing watchlist code uses up to 14 per call).

**Main change:** Replaces N `/market/quote/:id` calls with 1 `/market/quotes?conids=...` call from the frontend's perspective, and reduces IBKR pressure proportionally.

**Source:** IBKR snapshot doc — `conids` is documented as comma-separated.

**Tests to add (`backend/tests/test_bundled_quotes.py`):**
- 13 conids in one request → 1 IBKR snapshot call (after pre-flight).
- Mix of warmed + cold conids → pre-flight covers only the cold ones.
- 75 conids → 2 IBKR calls (50 + 25).

**Acceptance:** Pulse-bar HAR (after Task 3.1 lands) shows 1 `/market/quotes?conids=...` request instead of 13 individual ones.

---

### Task 2.2 — Bundled `/market/candles` endpoint

**Branch:** `feat/bundled-candles-endpoint`
**Depends on:** Task 1.6.
**Files to touch:**
- `backend/routers/market.py` — add `GET /market/candles?conids=1,2,3&period=5D&bar=5min` returning `{items: [{conid, candles: [...]}]}`.
- `backend/services/ibkr.py` — add `get_history_bundled(conids, period, bar, outsideRth)` that uses `asyncio.gather` over individual `/iserver/marketdata/history?conid=X` calls, **bounded by `asyncio.Semaphore(5)`** to honor IBKR's 5-concurrent limit on this endpoint (see pacing table). On 429, honor `Retry-After`. On 503, retry up to 3 times with 0.5s backoff (existing pattern).

**Main change:** Frontend issues one bundled candle request for the full pulse list / sector list; backend honors IBKR's 5-concurrent cap automatically. No more 5+ parallel candle calls from the frontend.

**Source:** IBKR pacing table — `/iserver/marketdata/history` 5 concurrent.

**Tests to add (`backend/tests/test_bundled_candles.py`):**
- 13 conids → 13 IBKR history calls, but at most 5 concurrent (verify with a mocked client tracking concurrency).
- 429 from IBKR with `Retry-After: 2` → caller waits ≥2s before retry.
- One conid failure does not break the others (returns partial result with `errors` field).

**Acceptance:** Backend log shows at most 5 in-flight history requests at any moment.

---

### Task 2.3 — `/sectors/*` 60s server cache

**Branch:** `feat/sectors-cache`
**Depends on:** Task 1.6.
**Files to touch:**
- `backend/services/sectors.py` — add a per-method async TTL cache. Each method (`performance`, `breadth`, `rotation`, `rrg`) caches its result for `SECTORS_CACHE_TTL_SEC` (default 60). When a request arrives with a non-stale cache, return cached. When stale, compute fresh and update.
- `backend/cache.py` — if a generic TTL helper exists, reuse it; otherwise add a small `AsyncTTLCache` class.
- `backend/routers/sectors.py` — no change needed (service is the cache layer).
- `backend/config.py` — `SECTORS_CACHE_TTL_SEC` env var.

**Main change:** Each sectors endpoint fans out to ~11 IBKR history calls and takes 30–43s. Frontend polls at 5min cadence already, but a fresh page load pays the full cost. With a 60s server cache, the second cold page load is ~1ms.

**Source:** No external docs — internal cache.

**Tests to add (`backend/tests/test_sectors_cache.py`):**
- Two calls within 60s → 1 set of IBKR fan-out calls, both callers receive same payload.
- A call >60s after the previous one → fresh fan-out.
- Force-refresh kwarg bypasses cache.

**Acceptance:** Reload the dashboard within 60s — sectors return instantly; backend log shows no fresh history calls.

---

### Task 2.4 — Merge `/health/details` + `/gateway/status` (or unify their auth source)

**Branch:** `feat/health-status-unify`
**Depends on:** Task 1.7.
**Files to touch:**
- `backend/routers/health.py` and `backend/routers/gateway.py` — they should now read auth state from the cache (Task 1.7), so the duplicate IBKR probes are already gone. The remaining question is whether to keep them as two endpoints or merge them. **Decision: keep two endpoints (frontend has different consumers), but add a single unified payload shape that is a strict superset.** `/health/details` returns the gateway-status fields PLUS the per-check breakdown; the frontend can switch to using `/health/details` only and drop the `/gateway/status` poll if desired (Task 3.6 covers the frontend side).

**Main change:** No backend behavior change beyond Task 1.7; this is the explicit shape unification + documenting the migration path.

**Source:** No external docs.

**Tests to add (`backend/tests/test_health_status_shape.py`):**
- `/health/details` response is a strict superset of `/gateway/status` response (same keys present with identical values for the overlapping subset).

**Acceptance:** Schema diff between the two responses is empty for the shared subset.

---

### Task 2.5 — WebSocket auth-state push (subscribe to IBKR `sts`)

**Branch:** `feat/ws-auth-state-push`
**Files to touch:**
- `backend/services/ibkr.py` — when the IBKR WS connection is established (`start_ibkr_websocket`), send the subscription message `smd+system+{"sts":"+"}` (per IBKR streaming docs for system messages — verify exact syntax against IBKR's WebSocket reference). On receipt of `sts` topic messages, update `state.authenticated` AND `state.auth_status_cached`, then call `_broadcast({"type": "auth_state", "authenticated": ..., "session_dropped": ...})` so the frontend WS hook can react.
- `backend/routers/ws.py` — no change beyond verifying the `auth_state` type passes through `broadcast()`.

**Main change:** Frontend gets immediate notification of auth changes. Combined with Task 3.7 on the frontend, this lets us drop `/gateway/status` polling from 10s to 60s heartbeat-only.

**Source:** IBKR Client Portal WebSocket streaming docs (the `sts` system topic). Verify exact subscription syntax against IBKR's reference before implementing — note in the PR description which exact reference URL was used.

**Tests to add (`backend/tests/test_ws_auth_push.py`):**
- Mock IBKR WS sends `sts` message → broadcaster emits `{"type":"auth_state",...}` to frontend.
- Auth flip from `true → false` invalidates the auth-state cache (Task 1.7).

**Acceptance:** Manually log out from the IBKR Gateway UI; frontend health strip flips to red within ~1s without polling.

---

## Phase 3 — Frontend hygiene

### Task 3.1 — MarketPulse uses bundled endpoints

**Branch:** `feat/pulse-bundled-quotes`
**Depends on:** Tasks 2.1, 2.2.
**Files to touch:**
- `src/lib/api.ts` — add `quotesBundled(conids: number[])` and `candlesBundled(conids: number[], period: string)` helpers calling the new bundled endpoints.
- `src/components/dashboard/MarketPulse.tsx` — refactor:
  - Replace per-ticker `useQuery` for quotes with a single parent-level `useQuery` whose key is `["quotes-bundled", sortedConids.join(",")]`.
  - Same for candles.
  - Each `PulseItem` reads its slice from the bundled response by conid.
  - Keep the conid resolution per-ticker (those run once and are cached forever) until Task 3.2 lands.
- `src/__tests__/MarketPulse.test.tsx` (create if missing) — assert 1 quotes call and 1 candles call regardless of ticker count.

**Main change:** Pulse bar fan-out drops from 13×3 = 39 frontend requests to 13 + 1 + 1 = 15 (will become 1+1+1=3 once Task 3.2 lands).

**Source:** N/A.

**Tests to add:**
- Render `<MarketPulse>` with a 13-ticker config behind a mocked API; assert exactly 1 `quotes` and 1 `candles` call were issued.
- Each `PulseItem` receives the right slice from the bundled response.

**Acceptance:** HAR replay shows the pulse bar fires 3 backend calls instead of 39.

---

### Task 3.2 — Cached conid resolution makes pulse-bar startup near-instant

**Branch:** `feat/pulse-cached-conids`
**Depends on:** Task 1.5.
**Files to touch:**
- `src/components/dashboard/MarketPulse.tsx` — no real change; the `/market/conid/:symbol` calls now resolve from SQLite on the second app run, so the dashboard's first-paint cost drops automatically.

**Main change:** None on the frontend per se — this is the frontend-side validation that Task 1.5 worked. Just confirm the HAR shows `/market/conid/...` calls take <100ms after the first session.

**Tests:** Manual verification via HAR. No code changes, so no new automated tests beyond what Task 1.5 already provided.

**Acceptance:** Dashboard cold-start time on a "second run" (with a populated `conid_cache`) is <2s for pulse-bar paint.

---

### Task 3.3 — Defer candles until quote data arrives

**Branch:** `feat/defer-pulse-candles`
**Depends on:** Task 3.1.
**Files to touch:**
- `src/components/dashboard/MarketPulse.tsx` — change the candles `useQuery` `enabled` flag to `enabled && quotesBundled.data != null`. Sparkline renders empty until quotes are in.

**Main change:** Quotes paint first; candles fetch only after quotes have settled. Removes one tier of contention during cold start.

**Tests to add:**
- With `quotes.isLoading=true`, candles query is `enabled=false`.
- With `quotes.data` populated, candles query is `enabled=true`.

**Acceptance:** HAR timeline shows candles requests strictly after the quotes request resolves.

---

### Task 3.4 — Tier reduction (9 → 4)

**Branch:** `feat/dashboard-4-tiers`
**Files to touch:**
- `src/hooks/useIbkrReadyTier.ts` — collapse `Tier` to `1 | 2 | 3 | 4` with delays `0 / 200 / 400 / 800`.
- Every consumer of `useIbkrReadyTier(N)` — re-tier:
  - **Tier 1 (0ms)** — MarketPulse, ArcGaugeRow (above-the-fold, paid for by bundled call)
  - **Tier 2 (200ms)** — SectorPerformancePanel, RRGPanel (cached server-side after Task 2.3, so cheap)
  - **Tier 3 (400ms)** — WatchlistSidebar, TriggerWatchlist
  - **Tier 4 (800ms)** — TriggerRules, WatchlistConfigSection, AlertLog
- `src/__tests__/useIbkrReadyTier.test.ts` — update for the new mapping.

**Main change:** With server-side bundling and caching, the 9-tier 250ms staircase no longer pays for itself. 4 tiers preserve the visual cascade without the artificial 2s delay before below-the-fold widgets fire.

**Tests to add:**
- Tier 1 fires at 0ms.
- Tier 4 fires at 800ms.
- All tiers reset on `ibkrReady=false`.

**Acceptance:** Dashboard time-to-fully-rendered (with warm cache) drops to <1s.

---

### Task 3.5 — staleTime / refetchInterval audit

**Branch:** `chore/query-timing-audit`
**Files to touch:** Every `useQuery` / `useInfiniteQuery` in `src/`. Run `grep -rn "useQuery\|refetchInterval\|staleTime" src/`.

**Main change:** For each query:
1. If `refetchInterval` is set, ensure `staleTime ≤ refetchInterval` (otherwise the interval is moot).
2. If the data is for a polling-displayed metric (quotes), `staleTime = refetchInterval / 2` is a good default.
3. If the data is essentially static (conid resolution, watchlist instrument list), set `staleTime: Infinity` AND `refetchInterval: false`.
4. If the query is gated by `enabled: ready`, ensure no `refetchOnMount: "always"` overrides — the gate should be the truth.

Document the resulting timing matrix in `src/lib/query.ts` as a comment block.

**Source:** TanStack Query v5 docs — `refetchInterval` overrides `staleTime` for background refetches.

**Tests to add:** None individually — but extend `src/__tests__/useGateway.test.ts` and similar to assert the new timings.

**Acceptance:** No `useQuery` in the codebase has `refetchInterval` shorter than its `staleTime`.

---

### Task 3.6 — Drop `/gateway/status` retry burst on cold start

**Branch:** `fix/gateway-status-retry`
**Files to touch:**
- `src/hooks/useGateway.ts` — change `retry: 3, retryDelay: 500` to `retry: 1, retryDelay: 1500`. Cold-start failures are noisy, not load-bearing — one retry after 1.5s is enough; the next polling tick will catch up.

**Source:** N/A.

**Tests to add:** Update existing `useGateway.test.ts` to assert the new retry config.

**Acceptance:** A single failed `/gateway/status` poll produces 2 backend calls within 2s (down from 4 in 1.5s).

---

### Task 3.7 — Pre/post-login cadences + visibility-aware polling + WS auth subscription

**Branch:** `feat/auth-polling-modernized`
**Depends on:** Task 2.5.
**Files to touch:**
- `src/hooks/useGateway.ts` — change `computeRefetchInterval`:
  - Pre-login (`!authenticated && needsLogin`): 3s
  - Cold start (`!data`): 2s
  - Provisioning: 2s
  - Steady state authenticated: **60s** (down from 10s — WS now drives change detection)
  - When `document.visibilityState === "hidden"`: pause (`refetchInterval: false`)
- `src/hooks/useWebSocket.ts` — no API change.
- `src/context/GatewayContext.tsx` — subscribe to WS `auth_state` messages. On receipt, write into the TanStack cache directly so consumers re-render immediately.
- `src/__tests__/useGateway.test.ts` — extend coverage.

**Main change:** Auth state is now event-driven via WS. Polling drops to a 60s heartbeat in steady state. Pre-login keeps a 3s cadence so login is responsive. Hidden tabs stop polling entirely.

**Source:** TanStack Query docs (`refetchInterval: false`, conditional polling), Page Visibility API.

**Tests to add (`src/__tests__/useGateway.test.ts`):**
- Authenticated + visible → 60s interval.
- Authenticated + hidden → no refetch.
- Pre-login + visible → 3s interval.
- WS `auth_state` push triggers an immediate cache update (no network call).
- Visibility flip from hidden → visible triggers an immediate refetch.

**Acceptance:** Steady-state HAR (60s post-login, no actions) shows 1 `/gateway/status` call. Background the app for 60s, foreground it — exactly 1 immediate `/gateway/status` call fires.

---

## Phase 4 — Observability + docs

### Task 4.1 — Document the cold-start protocol

**Branch:** `docs/ibkr-cold-start-protocol`
**Files to create / touch:**
- `.claude/skills/parallax-backend.md` (or wherever the backend skill lives) — add a "Cold-start protocol" subsection: auth → `/iserver/accounts` → secdef-warm (per non-STK conid) → snapshot pre-flight → snapshot. State the order, the 750ms pre-flight delay, and that the backend caches each step.
- `docs/ibkr-pacing.md` — reproduce the pacing table from this plan with a link to `backend/constants/ibkr_pacing.py` as the executable source of truth.
- Add a short "If you see snapshot timeouts" troubleshooting note pointing to Task 1.4 (secdef pre-warm).

**Tests:** N/A — docs only.

**Acceptance:** A new contributor can open these two files and understand the order of IBKR calls without reading the code.

---

### Task 4.2 — Keep request-logging middleware on by default in dev

**Branch:** `chore/request-logging-toggle`
**Files to touch:**
- `backend/main.py` — gate `app.add_middleware(RequestLoggingMiddleware)` behind an env var `PARALLAX_REQUEST_LOG=1` (default on in dev, off in packaged builds).
- `backend/config.py` — define the env var.
- `backend/request_logging.py` — already implemented in `chore/request-logging-middleware`.

**Main change:** The middleware exists already (you just merged it). This task adds the production-vs-dev toggle so we don't ship the JSONL writes to packaged users. Default-on in `BACKEND_PORT == 8000` dev mode, default-off otherwise.

**Tests to add (`backend/tests/test_request_logging_toggle.py`):**
- With env var set, app has the middleware mounted.
- Without env var, app does NOT have the middleware mounted.

**Acceptance:** `PARALLAX_REQUEST_LOG=0 python -c "import main; print(...)"` shows no request-logging middleware in the chain.

---

### Task 4.3 — Telemetry: per-task acceptance dashboard

**Branch:** `chore/log-summary-tool`
**Files to create:**
- `backend/scripts/summarize_request_log.py` — small Polars script that reads `backend/logs/requests.log`, prints:
  - Top 10 endpoints by hit count + p50/p95/max
  - 5s buckets with request count
  - Number of `5xx` and `4xx` responses

This is the same kind of summary I produced from your HAR. Having it run on the JSONL log gives you a way to verify each task's acceptance criterion locally.

**Tests to add (`backend/tests/test_summarize_request_log.py`):**
- Given a synthetic JSONL fixture, summary printout contains expected aggregates.

**Acceptance:** `uv run python backend/scripts/summarize_request_log.py backend/logs/requests.log` prints the report.

---

## Order of execution + checkpoints

Strict dependency chain — execute in order:

1. **1.1 pacing constants** → independent, prerequisite for everyone honoring rate limits.
2. **1.2 `/iserver/accounts` bootstrap** → independent, but must run before 1.3 to be useful.
3. **1.3 snapshot pre-flight** → depends on 1.2.
4. **1.4 secdef pre-warm** → depends on 1.3.
5. **1.5 conid SQLite cache** → independent.
6. **1.6 snapshot/history coalescing** → depends on 1.3.
7. **1.7 auth-state cache** → independent.
8. **2.1 bundled quotes** → depends on 1.3, 1.6.
9. **2.2 bundled candles** → depends on 1.6.
10. **2.3 sectors 60s cache** → depends on 1.6.
11. **2.4 health/status shape unify** → depends on 1.7.
12. **2.5 WS auth push** → depends on 1.7.
13. **3.1 pulse bundled** → depends on 2.1, 2.2.
14. **3.2 conid cache validation** → depends on 1.5 (no code).
15. **3.3 defer candles** → depends on 3.1.
16. **3.4 tier reduction** → independent of 3.x but cleaner after 3.1.
17. **3.5 staleTime audit** → independent.
18. **3.6 retry burst fix** → independent.
19. **3.7 polling modernization** → depends on 2.5.
20. **4.1 docs** → after all backend work.
21. **4.2 logging toggle** → independent.
22. **4.3 log summary tool** → independent.

After each phase, capture a fresh HAR + backend log on a 2-minute post-login run and run the summary script. Compare to the baseline at the top of this doc. Expected end state:

| Metric | Before | Target after |
|---|---|---|
| `/market/quote/:id` count (170s) | 85 | <5 (replaced by 1–2 bundled `/market/quotes`) |
| `/market/candles/:id` count | 20 | <5 (replaced by bundled) |
| `/gateway/status` count | 27 | <5 (60s cadence + WS push) |
| Backend → IBKR snapshot calls (170s) | ~250 | <60 (pre-flight + coalescing + bundling) |
| `Snapshot timed out` warnings | many | 0 (secdef pre-warm fixes derivative classes) |
| Dashboard time to fully-rendered | ~60s (cold) | <5s (cold) / <1s (warm) |

---

## Hard rules to follow during every task

1. **Tests** — no PR without tests for the changed code. Use Polars for any dataframe assertions.
2. **No bare `except`** — always use a typed error class from `backend/exceptions.py`. Distinguish auth, network, rate-limit, and data errors.
3. **No new packages** unless explicitly listed in this plan. The only allowed runtime additions are: nothing — every change uses existing deps.
4. **conid is the universal key** — never key any cache, store, or API parameter by ticker string. Always conid.
5. **Frontend never talks to IBKR or Ollama directly** — every call goes through `/...` on the FastAPI sidecar.
6. **One branch per task.** Never combine tasks into a single branch. Each branch ships with passing tests and its own PR.
7. **Update `MEMORY.md` only if a decision in this plan changes a long-lived design fact** — most of these are implementation details and should not become memories.

---

## Open questions to surface during execution (do not silently decide)

- IBKR's batch ceiling for `/iserver/marketdata/snapshot?conids=...` — the docs don't pin a number. The existing watchlist code uses 14. Test with 50; if it works, set the bundling threshold to 50. If 50 fails, bisect down to find the real ceiling and document it next to `ENDPOINT_LIMITS`.
- IBKR streaming `sts` topic syntax — verify against the IBKR Client Portal WebSocket reference before implementing Task 2.5. If the topic name or subscription envelope is different from what we assume, document the actual name in the PR description.
- `PREFLIGHT_DELAY_MS` — start at 750ms; if some derivative classes still time out, bisect (try 1500ms, 3000ms). Document the chosen value and why in the PR.
