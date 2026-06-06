# Account Context Module Design

> Date: 2026-06-06
> Branch: `feature/account-context-module`
> Finding: `2026-06-06-v1-foundation-architecture-findings.md` item 4

## Problem

Account context is shared product state, but the current frontend seam lives under `OrderTicket`. MoonMarket and Inflect both import that store and each run their own account-list query plus hydration effect. That makes account ownership unclear and forces every account-aware module to coordinate account readiness itself.

## Solution

Promote account context into an Orbit-level module. The module owns account hydration and selection state, and modules consume a small account-context interface instead of coordinating the account query themselves.

Public interface:

- `OrbitAccountProvider`
- `useOrbitAccountContext()`
- `useAccountStore` for lower-level consumers that only need synchronous selection state

Hidden implementation:

- the MoonMarket account-list endpoint used to fetch accounts
- default-account selection rules
- preservation of a user-selected account after rehydration
- paper/live account-mode derivation
- loading, ready, and error state

## User Stories

- As a MoonMarket user, I can open portfolio, transactions, or options with the same selected account behavior as before.
- As an Inflect user, I can open the journal and reuse the same selected account without a second module-local hydration path.
- As an OrderTicket user, the ticket reads the same selected account truth as MoonMarket and Inflect.

## Implementation Decisions

- Put the new module under `src/orbit/accountContext/`.
- Keep account data flowing through the existing Python sidecar API; the frontend still calls only `api.moonmarketAccounts`.
- Mount account hydration under `OrbitProviders` so all modules share one account truth.
- Gate global hydration on IBKR readiness so the launcher does not create pre-auth account requests.
- Keep the first slice behavior-preserving: no UI redesign, no backend API change, no account-selection persistence.

## Tracer-Bullet Slices

### Slice 1: Shared Orbit account hydration (`AFK`)

Prove MoonMarket and Inflect can consume one Orbit-level account context while preserving current visible behavior.

Work:

- add the Orbit account context module
- move the account store out of `OrderTicket`
- update MoonMarket, Inflect, and OrderTicket imports
- remove duplicated account-query hydration from MoonMarket and Inflect
- add tests for the account context interface and update existing module tests

Status: complete in this branch. `OrbitAccountProvider` now owns account hydration, `useOrbitAccountContext()` exposes account readiness and paper/live state, and MoonMarket plus Inflect read from the shared Orbit context.

### Slice 2: OrderTicket account readiness (`HITL`)

Use the Orbit account context directly in OrderTicket flows so the ticket can present account readiness/error state without depending on a module page having hydrated accounts first.

This touches the global trading UI and should be reviewed after slice 1 proves the shared context.

Status: complete in this branch. `OrderTicket` now reads account readiness from the Orbit account context, renders explicit loading/error account states, and keeps trading actions disabled until the shared account context is ready.

### Slice 3: Account context consumers cleanup (`AFK`)

Move remaining account ID prop threading where it is purely mechanical and does not change page behavior.

Status: complete in this branch for the layout layer. `MoonMarketLayout` and `InflectLayout` now consume the Orbit account context directly, so the module wrappers no longer thread account selector props into those layouts.

## Testing

- Add a public hook/provider test for account hydration, selected-account preservation, paper/live mode, and error state.
- Keep existing MoonMarket and Inflect page tests passing through the new provider.
- Keep OrderTicket tests passing after import migration.

## Out Of Scope

- no backend account API changes
- no TWS account selection behavior
- no persisted selected-account preference
- no trading-safety policy changes
- no UI redesign
