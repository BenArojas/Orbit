# Orbit Module Entry Seam - Design

> Date: 2026-06-06
> Branch: `feature/orbit-module-entry-seam`
> Parent finding: `docs/superpowers/specs/2026-06-06-v1-foundation-architecture-findings.md` item 5

## Problem

Top-level module entry behavior is split across the Orbit launcher, the route table, and module-local readiness handling.

The launcher disables Parallax, MoonMarket, and Inflect tiles while IBKR is unauthenticated, but direct routes such as `/moonmarket` and `/inflect` currently mount their modules without crossing the same shared route-access decision. Parallax also has an internal `AuthGuard`, but that guard only knows about Parallax's Zustand screens and cannot be the Orbit-wide module entry seam.

## Product Decision

Direct module URLs should preserve location. If a user opens `/parallax`, `/moonmarket`, or `/inflect` while unauthenticated, Orbit should render a locked/connect state in place at the requested URL, not redirect the user to `/`.

This avoids the feeling that Orbit kicked the user out without explaining what happened. The root launcher still keeps module tiles disabled until IBKR is authenticated.

## Solution

Create one Orbit-level module entry seam that owns module route access and module Adapter selection.

Public interface:

- `orbitModules` - registry of Orbit module metadata, route paths, readiness requirements, and render adapters.
- `OrbitModuleEntry` - route wrapper that receives a module id, evaluates shared readiness, and either renders the module adapter or an in-place locked/connect state.
- `ModuleLockedState` - reusable locked route surface that explains why the requested module is unavailable and exposes the existing Gateway connect surface.

Hidden implementation:

- auth/readiness checks from `GatewayContext`
- module label, description, and path metadata
- route-to-module adapter selection
- locked-state copy and connect UI composition
- future account-readiness extension points

`OrbitShell` should route module paths through `OrbitModuleEntry` instead of importing module components directly. `OrbitLauncher` can later read the same registry for tile metadata so module labels and paths are not duplicated.

## User Stories

- As a user opening `/moonmarket` before connecting IBKR, I stay on `/moonmarket` and see that MoonMarket is locked until IBKR is connected.
- As a user on `/`, I cannot click into Parallax, MoonMarket, or Inflect until IBKR is authenticated.
- As an authenticated user opening a module route directly, I see the requested module without extra navigation.
- As a developer adding or changing an Orbit module, I update one module entry registry instead of spreading route access rules across the launcher, router, and module wrappers.

## Implementation Decisions

- Put the new seam under `src/orbit/moduleEntry/`.
- Keep the first slice frontend-only; no backend API, database, IBKR, or account API changes.
- Use the existing `GatewayContext` as the IBKR authentication source.
- Preserve direct-route paths. Do not use `Navigate` for unauthenticated module access.
- Start with IBKR authentication readiness only. Account readiness remains owned by `OrbitAccountProvider` and module pages for now.
- Keep Parallax's internal `AuthGuard` unchanged in the first slice. It still protects Parallax's internal screens after the Orbit module entry allows Parallax to mount.
- Keep launcher visual behavior unchanged in the first slice except where it can safely read module metadata from the registry without redesign.

## Deep Module Shape

`OrbitModuleEntry` is the small public route interface. Consumers provide a module id; the seam decides what component is allowed to render.

Complexity hidden behind the seam:

- which modules exist
- how a module route maps to a component
- whether a module requires IBKR auth before mounting
- which locked-state explanation appears for the requested module
- how future readiness checks, such as account readiness or feature availability, plug in without touching each module route

Tests should target route behavior through `orbitRoutes`, not private helper calls.

## Tracer-Bullet Slices

### Slice 1: Direct module route locks in place when unauthenticated (`HITL`)

Prove the new seam with one end-to-end route behavior.

Work:

- add the module registry and entry wrapper
- route `/parallax/*`, `/moonmarket/*`, and `/inflect/*` through `OrbitModuleEntry`
- add an in-place locked/connect state for unauthenticated direct module URLs
- keep the requested URL unchanged
- prove authenticated route access still mounts the selected module
- update launcher tests only if shared registry usage is included in the slice

Public behavior to prove:

- `/moonmarket` while unauthenticated renders the locked MoonMarket route state and does not mount `MoonMarketModule`
- `/moonmarket` while authenticated mounts `MoonMarketModule`
- `/parallax` and `/inflect` route through the same seam

This is marked `HITL` because it changes top-level route access behavior and module-boundary ownership.

### Slice 2: Launcher reads module entry metadata (`AFK after slice 1 approval`)

Remove duplicated module labels, descriptions, and paths from `OrbitLauncher` by reading the module registry. Keep the existing launcher disabled-state behavior and visual layout.

### Slice 3: Keep non-auth readiness inside module pages (`HITL decision recorded`)

Decision: account readiness stays inside MoonMarket and Inflect module pages. `OrbitModuleEntry` remains responsible only for shared route-access auth gating in this branch.

Implication:

- do not move account readiness into `OrbitModuleEntry`
- keep `OrbitAccountProvider` and module-local page readiness behavior as-is
- any future account-readiness consolidation would require a separate design pass

## Testing

Slice 1 should use TDD through the public router interface:

- update `src/orbit/__tests__/OrbitShell.test.tsx` to mock `GatewayContext`
- verify unauthenticated `/moonmarket` keeps the route locked in place and does not mount the mocked module
- verify authenticated `/moonmarket` mounts the mocked module
- verify all module route objects go through the shared entry path

Relevant broader checks:

- focused Orbit shell tests
- launcher tests if launcher metadata is touched
- `npm run typecheck`

## Module Impact

- Parallax: route access moves to the Orbit entry seam before `ParallaxModule` mounts. Internal Parallax navigation remains unchanged.
- MoonMarket: direct route access becomes auth-gated before `MoonMarketModule` mounts. Account readiness stays in the existing account context path.
- Inflect: direct route access becomes auth-gated before `InflectModule` mounts. Journal account sync behavior stays module-local.

## Policy Impact

None expected. This does not change trading safety behavior, local/cloud boundaries, `conid` ownership, backend APIs, agent instructions, or active project rules.

## Out Of Scope

- no backend changes
- no trading-safety policy changes
- no account-context behavior changes in slice 1
- no Parallax internal navigation rewrite
- no launcher redesign
- no Inflect availability/product-scope change
