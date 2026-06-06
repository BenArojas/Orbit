# Instrument Identity Module - Design

> Date: 2026-06-06
> Branch: `feature/instrument-identity-module`
> Parent finding: `docs/superpowers/specs/2026-06-06-v1-foundation-architecture-findings.md` item 7

## Problem

`conid` is Orbit's universal instrument key, but the surrounding identity rules are scattered.

The shared SQLite `instruments` table stores conid-to-display metadata, while `conid_cache` stores symbol-to-conid lookup results. Today, route modules and services know too much about those details:

- `routers.market` writes instrument cache rows directly from quote, search, and conid-resolution payloads.
- `routers.watchlist` repeats IBKR payload normalization and writes cache rows directly.
- `services.db` exposes raw table operations but does not own typed cache-miss behavior.
- `services.ibkr` owns conid-resolution candidate ranking separately from display-identity writes.
- `services.inflect.service` has its own display fallback when a conid has no cached symbol.

This creates small but persistent ownership leaks. Each caller can make a different choice about display fallback, cache-write fields, or invalid IBKR payload handling.

## Product Decision

Use vertical tracer bullets for this architecture fix.

The first slice should prove a thin end-to-end identity path across backend service, API, and frontend consumption. It should not extract an entire backend layer first and postpone integration until later.

## Solution

Create an `InstrumentIdentityService` in the Python sidecar. The service owns display identity for existing Orbit instruments while preserving current public endpoint contracts in the first slice.

Public interface:

- read one cached instrument by `conid`
- read many cached instruments by `conid`
- cache normalized display identity from an IBKR payload
- raise a typed cache-miss error when a conid is not present locally

Hidden implementation:

- SQLite `instruments` table access through `DatabaseService`
- normalization of IBKR display fields into one canonical internal shape
- write rules for empty or partial display metadata
- cache-miss exception mapping to the existing HTTP 404 response
- display fallback rules for later Inflect/MoonMarket adoption

The service does not replace `conid_cache` in this branch. `conid_cache` remains the lookup-direction cache used by `IBKRService.get_conid(symbol, sec_type)`. The new identity service owns the result-direction cache: `conid -> symbol/company/sec_type/cached_at`.

## User Stories

- As a user who fetches a quote, Orbit stores the instrument's display identity from the quote payload so later UI surfaces can show a symbol/name for that same `conid`.
- As a user opening a UI surface that already has a `conid`, Orbit reads display metadata from the local cache without hitting IBKR again.
- As a user whose `conid` has not been cached yet, Orbit keeps the existing 404 behavior at `/instruments/{conid}` instead of silently inventing metadata.
- As a developer adding MoonMarket or Inflect display behavior, I can reuse one identity module instead of copying fallback and cache-write rules.

## Implementation Decisions

- Add the service under `backend/services/instrument_identity.py`.
- Keep all IBKR calls in existing IBKR-facing services/routes. The identity service normalizes payloads it receives; it does not call IBKR in the first slice.
- Keep public API contracts unchanged in the first slice:
  - `GET /market/quote/{conid}` response shape stays the same.
  - `GET /instruments/{conid}` still returns the existing cached instrument shape.
  - cache misses still surface as HTTP 404 to clients.
- Introduce typed backend cache-miss behavior behind the existing 404 response.
- Move only the selected tracer-bullet write path first. Do not migrate every backend writer in one pass.
- Preserve the split between `instruments` and `conid_cache`.
- Do not change database schema in the first slice.

## Deep Module Shape

`InstrumentIdentityService` is the small public backend interface. Callers provide `conid` and normalized or raw IBKR display fields; the service decides how to read, write, and miss.

Complexity hidden behind the service:

- which SQLite table stores display identity
- which IBKR field names map to symbol, company name, and security type
- whether a payload is useful enough to cache
- what happens when identity is absent
- how future callers share the same fallback behavior

Expected import direction:

- routers may depend on `InstrumentIdentityService`
- module services such as Inflect may later depend on `InstrumentIdentityService`
- `InstrumentIdentityService` depends on `DatabaseService`
- `InstrumentIdentityService` does not depend on route modules, frontend code, or `IBKRService`

## Tracer-Bullet Slices

### Slice 1: Quote populates display identity end-to-end (`HITL`)

Prove one real integrated path:

1. `GET /market/quote/{conid}` receives an IBKR snapshot row.
2. The route delegates display-identity normalization and cache write to `InstrumentIdentityService`.
3. `GET /instruments/{conid}` reads the cached identity through `InstrumentIdentityService`.
4. `useInstrument(conid)` continues to consume the same existing response shape.

Public behavior to prove:

- a quote response still includes `symbol`, `companyName`, prices, and bid/ask sizes
- after the quote path sees `55=AAPL` and `7051=Apple Inc`, `/instruments/265598` returns the cached AAPL identity
- `/instruments/{missing_conid}` still returns HTTP 404, backed by a typed cache-miss error inside the service
- the frontend hook still exposes `{ symbol, companyName, isLoading }` from the existing `/instruments/{conid}` API shape

This is marked `HITL` because it introduces a new shared module boundary for Orbit-wide instrument identity.

### Slice 2: Search and conid-resolution writes use the identity service (`AFK after slice 1 approval`)

Move `GET /market/search` and `GET /market/conid/{symbol}` cache writes into `InstrumentIdentityService`.

Public behavior to prove:

- search results remain unchanged
- conid-resolution responses remain unchanged
- matching search enrichment still writes `company_name`
- `conid_cache` behavior remains owned by `IBKRService.get_conid`

### Slice 3: Watchlist identity normalization uses the identity service (`AFK after slice 2 approval`)

Move watchlist instrument normalization and cache writes into the service without changing `/watchlist/{id}/instruments` response shape.

Public behavior to prove:

- mixed IBKR watchlist rows still skip invalid entries instead of crashing
- valid rows still return `conid`, `symbol`, and `companyName`
- cache writes use the same display-identity rules as quote/search

### Slice 4: Inflect display fallback reads through identity service (`HITL`)

Replace Inflect's local conid display fallback with the shared identity service.

Public behavior to prove:

- `/inflect/symbols` still returns traded conids sorted by display symbol
- fill symbols still win when present
- cached instrument symbols fill missing display names
- uncached conids still use the explicit fallback format

This remains `HITL` because it changes an Inflect module-service dependency.

## Testing

Slice 1 should use TDD through public interfaces:

- backend route test for `GET /market/quote/{conid}` followed by `GET /instruments/{conid}` using a real in-memory or temp `DatabaseService`
- backend route test for `/instruments/{missing_conid}` preserving HTTP 404
- focused service test only if needed to cover typed cache-miss behavior that is otherwise hidden by HTTP mapping
- frontend hook test for `useInstrument(conid)` consuming the existing API response shape

Relevant checks:

- focused backend tests for market quote and instruments routes
- focused frontend hook test
- backend type/lint check if touched files require it
- `npm run typecheck`

## Module Impact

- Parallax: quote/search/conid paths gradually stop owning direct instrument-cache writes. Public market API behavior stays unchanged.
- MoonMarket: no first-slice behavior change. Later MoonMarket adoption can use the identity service for display rules without changing `conid` ownership.
- Inflect: no first-slice behavior change. Later slice can replace local fallback code with the shared identity service.

## Policy Impact

None expected. This does not change trading safety behavior, local/cloud boundaries, `conid` ownership, public API contracts, agent instructions, or active project rules.

## Out Of Scope

- no schema migration in the first slice
- no new frontend public API contract in the first slice
- no direct frontend access to IBKR
- no changes to `conid_cache` ownership
- no full migration of all backend writers in Slice 1
- no change to MoonMarket or Inflect behavior in Slice 1
