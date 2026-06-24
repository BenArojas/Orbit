# Orbit Module Boundaries

Orbit is one Tauri application with one FastAPI sidecar and one SQLite database.
It contains three product modules:

- **Parallax:** technical analysis, screening, watchlists, and alerts.
- **MoonMarket:** portfolio, account, options, and order workflows.
- **Inflect:** trading journal, fills-derived trades, and annotations.

## Shared Orbit Ownership

- `OrbitModuleEntry` owns top-level authentication access to module routes.
- Orbit account context owns account hydration, selection, and paper/live mode.
- Trading Safety owns the order-mutation policy vocabulary and confirmation copy.
- `InstrumentIdentityService` owns `conid`-to-display identity in `instruments`.
- `IBKRService` owns Client Portal transport; execution adapters hide its wire
  details from domain services.
- Shared frontend transport lives in `sidecarClient`; product endpoints remain
  in module-local API files.

## Instrument Identity

`conid` is the universal cross-module instrument key. Never persist or link
records across modules by ticker text. Symbols and names are display metadata.
The `conid_cache` lookup direction remains separate from the `instruments`
display-identity cache.

## Trading Safety

- Orbit is decision support, not an autonomous trading system.
- Preview is allowed for paper and live accounts.
- Paper mutations are allowed without real-money confirmation.
- Live place, reply, cancel, and modify are allowed only through the policy-backed
  real-money confirmation flow.
- Unknown accounts, unreachable policy, rejected decisions, or incomplete live
  confirmation data fail closed.
- The backend reevaluates policy before forwarding a mutation to IBKR.

## Module Rules

- Parallax does not add journal callbacks, save-to-journal UI, or Inflect hooks.
- Inflect derives trades from shared fills and owns only journal annotations and
  related repair data.
- MoonMarket owns account/portfolio/order product behavior but consumes shared
  Orbit account, identity, safety, and execution boundaries.
- Cross-module behavior is introduced through a small Orbit-owned interface, not
  by importing another module's component internals.

## Detailed Decisions

- `docs/superpowers/specs/2026-06-06-account-context-module-design.md`
- `docs/superpowers/specs/2026-06-06-instrument-identity-module-design.md`
- `docs/superpowers/specs/2026-06-06-orbit-module-entry-seam-design.md`
- `docs/superpowers/specs/2026-06-06-trading-safety-module-design.md`
