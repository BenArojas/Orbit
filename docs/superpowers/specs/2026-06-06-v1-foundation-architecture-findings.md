# Orbit v1 Foundation - Architecture Findings

> Date: 2026-06-06
> Branch reviewed: `dev`
> Purpose: short list of architecture problems and suggested solutions. This is not an implementation plan.

## 1. Trading Safety module

**Problem**

Trading safety policy is not localized. Current docs still describe paper-only mutations, but the live-mutation policy has changed. That leaves policy split across docs, UI flows, backend behavior, and tests.

**Suggested solution**

Create one Trading Safety module that owns live vs paper mutation policy, confirmation behavior, and typed rejection or approval modes. Add a repo workflow skill or merge-time check that updates policy docs whenever the policy changes before or during merges to `dev`.

## 2. OrderTicket lifecycle module

**Problem**

[OrderForm.tsx](/Users/benarojasmac/Desktop/Projects/Orbit/src/orbit/OrderTicket/OrderForm.tsx) owns too much Implementation: draft construction, bracket rules, order-rule filtering, live quote usage, result parsing, fill tracking, invalidation, and confirmation flow. The opening Interface is small, but the lifecycle depth is trapped inside one UI module.

**Suggested solution**

Keep the existing OrderTicket seam, but move lifecycle behavior behind it:

- draft building and normalization
- bracket construction rules
- live-order modify hydration
- IBKR result and reply parsing
- fill-state derivation
- post-submit invalidation rules

The UI should become a thin Adapter over that lifecycle module.

## 3. Client Portal execution Adapter

**Problem**

Client Portal request details leak into domain modules through direct `ibkr._request` usage. Order, account, options, and trade-history behavior depend on private transport details instead of a deeper execution seam.

**Suggested solution**

Deepen the execution Adapter around mutation and account behavior first. Hide endpoint paths, payload quirks, pacing concerns, and transport-specific rules behind a smaller execution Interface. This also sets up the future TWS execution Adapter cleanly.

## 4. Account context module

**Problem**

Frontend account context is shared, but the seam lives under OrderTicket and still requires MoonMarket and Inflect to coordinate hydration themselves.

**Suggested solution**

Promote account context into an Orbit-level module that owns:

- account list
- selected account
- paper/live state
- ready/error state

MoonMarket, Inflect, and OrderTicket should all read the same account truth through that seam.

## 5. Orbit module entry seam

**Problem**

Top-level module entry behavior is shallow. Launcher gating, route behavior, and module-level readiness are split between different places, so direct routes do not clearly cross one shared seam.

**Suggested solution**

Create one Orbit module entry seam that owns route access, readiness checks, and module Adapter selection for Parallax, MoonMarket, and Inflect.

## 6. Sidecar client contract by module

**Problem**

[api.ts](/Users/benarojasmac/Desktop/Projects/Orbit/src/lib/api.ts) is a broad shared Interface for every backend type and every sidecar call. The Interface is too wide relative to its Implementation.

**Suggested solution**

Keep one deep core request module for base URL, offline handling, and error handling, then split product contracts into module-local seams for Parallax, MoonMarket, and Inflect.

## 7. Instrument Identity module

**Problem**

`conid` is the universal key, but cache-write rules, display fallbacks, and ownership of instrument metadata still leak into route modules.

**Suggested solution**

Deepen one Instrument Identity module that owns:

- conid-to-display metadata
- cache-write rules
- typed cache-miss behavior
- IBKR payload normalization

## Notes

- Trading Safety is still the highest-risk foundation seam before the v2 branches are rebased.
- OrderTicket lifecycle is the next likely source of merge pain because too much trading behavior is concentrated in one UI module.
- The live-mutation policy is now allowed by product decision; the remaining problem is policy drift between behavior and docs, not the live path itself.
