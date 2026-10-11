# Orbit — Active Project Plan

Updated: 2026-10-11. This file tracks active work and unresolved follow-ups, not shipped history.
Product baseline: `refactor/remove-ai-inflect`, which removes AI analysis and Inflect.

## Active product

- Parallax: deterministic analysis, charts, Compare, screening, watchlists and alerts.
- MoonMarket: portfolio, accounts, options and shared order workflows.
- TWS Assistant: user-controlled execution planning and broker workflows, with its existing exclusive session mode.
- Shared Orbit boundaries: local FastAPI data/persistence access, conid identity, account context and Trading Safety. Current architecture documents remain authoritative.

## Parallax redesign — closeout complete; merged locally

[Approved design](docs/superpowers/specs/2026-10-03-parallax-redesign-design.md) · [Sidecar contracts](docs/superpowers/specs/2026-06-07-sidecar-client-contracts-design.md)

- Owner: Parallax. The approved Market → Names → Analysis → Today workflow is implemented on `feature/parallax-redesign-spec`, through `d8ae32a`. Market explains completed-session posture; Names separates Watchlist, published RS Leaders and Custom scan; Analysis creates and revises saved setup plans; Today prioritizes their review.
- Plans use provider-selected account and paper/live scope, verified stock identities, revisioned evidence, explicit review and archival. Automatic checks use supported conditions; manual plans remain explicit. Neither plan monitoring nor review changes broker orders or watchlist membership.
- Today uses the approved compact workbench, with tracked plans primary and Quick alerts secondary. Plan rows open the exact plan in Analysis. Guidance explains measured changes, evidence time and review priority; invalidation comes first, and monitoring uncertainty stays visible. Outstanding matches survive later failed checks and capped history. Keep watching acknowledges only the displayed evaluation IDs.
- Quick alerts have explicit edit/delete controls and pending/failure/retry states. Dismissal persists and repeated checks stay quiet until a valid clear→match transition. Grouped history reduces repeated ticker noise. The market ticker strip lives on Market. Compare, chart tools and saved drawings remain available.
- Verification on 2026-10-11: repaired the OrderTicket quote-owner mock and partial-fill status assertion, supplied the TWS policy fixture, and isolated Gateway route/process tests from the real developer environment. No runtime behavior changed. Focused checks passed (55 OrderTicket and 90 backend); the full merge gate passed (188 frontend and 450 backend), as did production build, policy drift and diff checks. Existing chart import, bundle-size and dependency deprecation warnings remain.
- Merged into local `main` on 2026-10-11 as `9335cbb`, after the user approved test repairs and the full gate passed. Nothing was pushed. The merged source tree matches the tested feature branch and includes the earlier TWS work and AI/Inflect removal. Real Gateway data was not reset or altered by the repaired fixtures.
- Manual acceptance: the user reported testing the app and approved closeout on 2026-10-11. This records user acceptance; an agent-operated native walkthrough was not performed. Release QA owns the remaining provider/platform checks: verify live Fred/IBKR refresh, quotes, reconnect, watchlist mutations and packaged-platform behavior before claiming release readiness. These checks are not established by the automated gate or the unspecified scope of the user’s manual testing.
- Later product work: approve one tactic's detector rules before automatic tactic detection. Chart-tool interaction improvements remain separate; restore AI guidance only after the evidence and review workflow is validated.

## Other active follow-ups

- MoonMarket: real IBKR paper validation of single-leg options and enhanced stock OrderTicket flows. Option brackets remain deferred.
- TWS: verify fill notifications and real-time cockpit updates against live market data; [package replacement](docs/superpowers/specs/2026-07-01-scale-out-cockpit-v2-design.md) remains a separate unapproved broker-mutation follow-up.
- MCP: verify read-only client list/call behavior and the packaged backend runtime. Preserve the [existing exposure boundary](docs/superpowers/specs/2026-06-26-mcp-readonly-server-design.md).
- Release: indicator/chart accuracy, saved-state/restart behavior, gateway installation and packaged macOS/Windows smoke checks.

These verification items were retained from the prior roadmap; their completion was not revalidated during this documentation-only cleanup.
