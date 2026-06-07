# Sidecar Client Contracts By Module - Design

> Date: 2026-06-07
> Branch: `feature/sidecar-client-contracts`
> Parent finding: `docs/superpowers/specs/2026-06-06-v1-foundation-architecture-findings.md` item 6

## Problem

`src/lib/api.ts` is doing too much. It currently owns:

- the core sidecar request runtime: base URL, `fetch`, offline checks, response parsing, and `ApiError`
- gateway and auth calls
- shared market, instruments, indicators, drawings, triggers, watchlist, screener, AI, and sector calls
- MoonMarket endpoint contracts and types
- Inflect endpoint contracts and types
- Parallax endpoint contracts and types

That makes the interface wide relative to the implementation. A module importing one endpoint or type from `@/lib/api` is coupled to every other product contract in Orbit. It also makes future backend contract changes harder to reason about because `api.ts` is both the low-level transport module and the product-level API surface.

## Product Decision

The final state should have module-local sidecar contracts for every product module:

- `src/modules/moonmarket/api.ts`
- `src/modules/inflect/api.ts`
- `src/modules/parallax/api.ts`

Those module files should share one deep core request module:

- `src/lib/sidecarClient.ts`

The migration should still happen through vertical tracer bullets. The first implementation slice should prove the full shape through one real module path before spreading the pattern across Inflect and Parallax.

## Solution

Create `src/lib/sidecarClient.ts` as the only frontend module that owns sidecar transport mechanics:

- `API_BASE`
- online/offline preflight behavior
- `fetch`
- JSON/no-content response handling
- `ApiError`
- network-offline error translation and offline toast behavior

Then move product contracts into module-owned API files. Each module API owns its endpoint names, request builders, response types, and query-string encoding. UI components and hooks inside that module should import the module contract instead of reaching into the global `@/lib/api` object.

`src/lib/api.ts` should stay temporarily as a compatibility seam while callers are migrated. It may re-export or compose from module APIs during the transition, but it should stop being the place where new product endpoint contracts are added.

## User Stories

- As a developer changing MoonMarket portfolio endpoints, I can work in the MoonMarket module without scanning Parallax, Inflect, gateway, AI, or screener contracts.
- As a developer changing Inflect journal endpoints, I can import `inflectApi` and Inflect types from the Inflect module instead of the broad global client.
- As a developer changing Parallax analysis or watchlist endpoints, I can keep Parallax-specific contracts in the Parallax module while still sharing the same sidecar runtime.
- As a user, there is no behavior change. The same local sidecar, offline handling, route behavior, and UI data should continue to work.

## Implementation Decisions

- `src/lib/sidecarClient.ts` exports:
  - `ApiError`
  - `sidecarRequest<T>(method, path, body?, signal?)`
- `src/modules/moonmarket/api.ts` is created first and owns the MoonMarket product contract.
- `src/modules/inflect/api.ts` and `src/modules/parallax/api.ts` are part of the same architecture mission, but they follow after the first verified MoonMarket slice.
- `src/lib/api.ts` remains during migration so unmigrated callers do not need to move in the first slice.
- Module-local API files may import `sidecarRequest` from `@/lib/sidecarClient`; they must not call `fetch` directly.
- Module UI and hooks should import their module API when migrated.
- Types should move with the owning module where practical. During migration, type re-exports may remain for compatibility, but new module code should prefer local module types.
- Gateway/auth/account shell contracts are Orbit-level concerns, not product-module contracts. They can remain in a smaller shared/Orbit API seam until a later finding addresses them.

## Deep Module Shape

`sidecarClient` is the deep runtime module. Its public interface is small: make one typed sidecar request and expose the typed `ApiError`. It hides all lower-level request behavior.

Complexity hidden behind `sidecarClient`:

- base URL construction
- request headers and JSON body encoding
- 204 No Content handling
- failed JSON parsing behavior
- offline preflight
- network-offline toast behavior
- `AbortError` passthrough

Product module APIs are shallow, readable contracts over endpoint paths. Their complexity is endpoint naming, query-string construction, request/response types, and product-owned naming. They should not own transport policy.

Expected import direction:

- `src/modules/moonmarket/*` imports from `src/modules/moonmarket/api.ts`
- `src/modules/inflect/*` and Inflect hooks import from `src/modules/inflect/api.ts`
- `src/modules/parallax/*` and Parallax hooks/components import from `src/modules/parallax/api.ts`
- module API files import from `src/lib/sidecarClient.ts`
- `src/lib/sidecarClient.ts` does not import product modules

## Tracer-Bullet Slices

### Slice 1: MoonMarket portfolio uses a module-local API (`HITL`)

Prove one full vertical path:

1. Create `src/lib/sidecarClient.ts` with the existing request runtime and `ApiError`.
2. Keep `src/lib/api.ts` behavior compatible by using the extracted request runtime.
3. Create `src/modules/moonmarket/api.ts` for MoonMarket portfolio and performance endpoints.
4. Move the MoonMarket portfolio/performance response types needed by `PortfolioPage` into the MoonMarket module contract.
5. Update `PortfolioPage` to call the module-local API.
6. Keep current UI behavior unchanged.

Public behavior to prove:

- MoonMarket portfolio query still calls `/moonmarket/portfolio`.
- MoonMarket performance query still calls `/moonmarket/performance`.
- account IDs and periods are encoded the same way as before.
- `ApiError`, 204 handling, offline handling, and abort behavior remain owned by the shared sidecar runtime.
- unmigrated callers using `@/lib/api` still work.

This is marked `HITL` because it creates a new frontend module boundary.

### Slice 2: MoonMarket remaining product endpoints move behind `moonmarketApi` (`AFK after slice 1 approval`)

Move the rest of MoonMarket's product endpoints into `src/modules/moonmarket/api.ts`:

- account list and funds
- trades and live orders
- trading safety decision read
- position revalidation
- order rules
- order preview/place/reply/cancel/modify
- options expirations, chain, contract, and strike window

Public behavior to prove:

- MoonMarket module tests still pass.
- OrderTicket flows that depend on MoonMarket order endpoints still pass or keep compatibility through `src/lib/api.ts` until their own seam is addressed.
- options-chain tests still prove the same encoded endpoint paths.

### Slice 3: Inflect endpoints move behind `inflectApi` (`AFK after slice 2 approval`)

Create `src/modules/inflect/api.ts` and move Inflect endpoint contracts behind it:

- setups
- calendar
- trades and trade detail
- journal save
- sync
- backfill status
- basis lots and basis audit
- storage stats and cleanup
- Inflect response/request types

Public behavior to prove:

- Inflect hooks call `inflectApi`, not the broad global API object.
- Inflect module tests keep the same loading, empty, error, sync, and journal-save behavior.
- query keys and invalidation behavior remain unchanged.

### Slice 4: Parallax endpoints move behind `parallaxApi` (`HITL`)

Create `src/modules/parallax/api.ts` and move Parallax-owned contracts behind it:

- market quote/candles/search/resolve
- instruments read contract where Parallax owns display cache reads
- indicators
- sectors and dashboard pulse feeds
- watchlists
- triggers, tags, templates, and watchlist config
- AI analysis and model lifecycle where still Parallax-facing
- fibonacci config, locks, and drawings
- screener contracts

Public behavior to prove:

- Parallax hooks/components use `parallaxApi`.
- core chart, watchlist, trigger, screener, AI, and dashboard tests keep behavior unchanged.
- shared `conid` rules remain unchanged.

This is marked `HITL` because Parallax currently owns the largest surface and includes shared-adjacent contracts such as instruments, watchlists, triggers, and AI.

### Slice 5: Shrink or remove `src/lib/api.ts` (`HITL`)

Once product modules are migrated, reduce `src/lib/api.ts` to one of two shapes:

- compatibility barrel that re-exports module APIs and shared shell contracts, or
- deleted entirely if all imports can be moved cleanly.

Public behavior to prove:

- no product module imports `@/lib/api` for module-owned endpoint calls
- typecheck passes without broad global API coupling
- shared shell contracts have an explicit owner

This is marked `HITL` because it changes the final public frontend import convention.

## Testing

Use TDD through public interfaces for each slice.

Slice 1 tests:

- `src/lib/sidecarClient.test.ts` proves 204 handling and error behavior through `sidecarRequest`.
- `src/modules/moonmarket/api.test.ts` proves portfolio/performance endpoint paths and query encoding through `moonmarketApi`.
- existing MoonMarket portfolio/module tests prove `PortfolioPage` still renders from the same mocked data and query behavior.
- `src/lib/api.test.ts` remains as compatibility coverage for unmigrated global-client calls.

Relevant checks:

- `npm test -- src/lib/sidecarClient.test.ts src/modules/moonmarket/api.test.ts src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`
- `npm run typecheck`

Later slices should add or move tests alongside the module API being migrated, then run the relevant module tests plus `npm run typecheck`.

## Module Impact

- MoonMarket: first module to own its frontend sidecar contract. User behavior stays unchanged.
- Inflect: planned follow-up migration to its own API seam. No first-slice behavior change.
- Parallax: planned follow-up migration to its own API seam. No first-slice behavior change.
- Shared shell/gateway/auth/account: not part of product-module split in Slice 1; they remain shared/Orbit-level until a smaller seam is defined.
- Backend: no backend changes expected.

## Policy Impact

None expected. This does not change trading safety behavior, backend public contracts, local/cloud boundaries, `conid` ownership, agent instructions, skills, or active project rules.

## Out Of Scope

- no backend route changes
- no IBKR or Ollama access changes
- no trading safety behavior changes
- no database changes
- no change to TanStack Query keys unless a migrated hook already needs that change for correctness
- no full repo-wide import rewrite in Slice 1
- no removal of `src/lib/api.ts` until module migrations prove the replacement seams
