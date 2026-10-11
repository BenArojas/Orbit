# Orbit — Active Project Plan

Updated: 2026-10-11. This file tracks active work and unresolved follow-ups, not shipped history.
Product baseline: `refactor/remove-ai-inflect`, which removes AI analysis and Inflect.

## Active product

- Parallax: deterministic analysis, charts, Compare, screening, watchlists and alerts.
- MoonMarket: portfolio, accounts, options and shared order workflows.
- TWS Assistant: user-controlled execution planning and broker workflows, with its existing exclusive session mode.
- Shared Orbit boundaries: local FastAPI data/persistence access, conid identity, account context and Trading Safety. Current architecture documents remain authoritative.

## Parallax redesign — implemented; full merge gate passed

[Approved design](docs/superpowers/specs/2026-10-03-parallax-redesign-design.md) · [Sidecar contracts](docs/superpowers/specs/2026-06-07-sidecar-client-contracts-design.md)

- Owner: Parallax. The approved Market → Names → Analysis → Today workflow is implemented on `feature/parallax-redesign-spec`, through `d8ae32a`. Market explains completed-session posture; Names separates Watchlist, published RS Leaders and Custom scan; Analysis creates and revises saved setup plans; Today prioritizes their review.
- Plans use provider-selected account and paper/live scope, verified stock identities, revisioned evidence, explicit review and archival. Automatic checks use supported conditions; manual plans remain explicit. Neither plan monitoring nor review changes broker orders or watchlist membership.
- Today uses the approved compact workbench, with tracked plans primary and Quick alerts secondary. Plan rows open the exact plan in Analysis. Guidance explains measured changes, evidence time and review priority; invalidation comes first, and monitoring uncertainty stays visible. Outstanding matches survive later failed checks and capped history. Keep watching acknowledges only the displayed evaluation IDs.
- Quick alerts have explicit edit/delete controls and pending/failure/retry states. Dismissal persists and repeated checks stay quiet until a valid clear→match transition. Grouped history reduces repeated ticker noise. The market ticker strip lives on Market. Compare, chart tools and saved drawings remain available.
- Verification on 2026-10-11: repaired the OrderTicket quote-owner mock and partial-fill status assertion, supplied the TWS policy fixture, and isolated Gateway route/process tests from the real developer environment. No runtime behavior changed. Focused checks passed (55 OrderTicket and 90 backend); the full merge gate passed (188 frontend and 450 backend), as did production build, policy drift and diff checks. Existing chart import, bundle-size and dependency deprecation warnings remain.
- The user approved test repairs followed by merge into local `main` only, with no push. The full gate now passes. Main also inherits earlier TWS work and AI/Inflect removal when this branch merges. Real Gateway data was not reset or altered by the repaired fixtures.
- Next owner: native paper-account verification. Complete a walkthrough for navigation, plan review, invalidation, unavailable/overdue evidence, restart persistence and account/mode isolation. No running Orbit UI was available during closeout. Live Fred/IBKR refresh, quotes, reconnect, watchlist mutations and packaged-platform behavior remain unverified by this gate.
- Later product work: approve one tactic's detector rules before automatic tactic detection. Chart-tool interaction improvements remain separate; restore AI guidance only after the evidence and review workflow is validated.

## Other active follow-ups

- MoonMarket: real IBKR paper validation of single-leg options and enhanced stock OrderTicket flows. Option brackets remain deferred.
- TWS: verify fill notifications and real-time cockpit updates against live market data; [package replacement](docs/superpowers/specs/2026-07-01-scale-out-cockpit-v2-design.md) remains a separate unapproved broker-mutation follow-up.
- MCP: verify read-only client list/call behavior and the packaged backend runtime. Preserve the [existing exposure boundary](docs/superpowers/specs/2026-06-26-mcp-readonly-server-design.md).
- Release: indicator/chart accuracy, saved-state/restart behavior, gateway installation and packaged macOS/Windows smoke checks.

These verification items were retained from the prior roadmap; their completion was not revalidated during this documentation-only cleanup.
