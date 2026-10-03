# Orbit — Active Project Plan

Updated: 2026-10-03. This file tracks active work and unresolved follow-ups, not shipped history.
Product baseline: `refactor/remove-ai-inflect`, which removes AI analysis and Inflect. This documentation cleanup does not merge that branch or change application code.

## Active product

- Parallax: deterministic analysis, charts, Compare, screening, watchlists and alerts.
- MoonMarket: portfolio, accounts, options and shared order workflows.
- TWS Assistant: user-controlled execution planning and broker workflows, with its existing exclusive session mode.
- Shared Orbit boundaries: local FastAPI data/persistence access, conid identity, account context and Trading Safety. Current architecture documents remain authoritative.

## Parallax redesign — approved, not implemented

[Approved design](docs/superpowers/specs/2026-10-03-parallax-redesign-design.md) · [First coder brief](docs/superpowers/plans/2026-10-03-parallax-market-first-handoff.md)

- Flow: market status → RS names and sectors → tactics. Use Cool Mineral, a compact interface and progressive disclosure.
- First slice: market-first entry, real SPY/QQQ/IWM evidence, eleven-sector participation, live WebSocket prices and automatic daily assessment reconciliation.
- Daily rules: EMA21/SMA50 classification, sector SMA50 participation, SMA200 as index context, regular-session history and local exchange calendar.
- Missing evidence: classify only when unknown values cannot change the conclusion; otherwise show incomplete state with previous dated assessment when available.
- Preserve Compare, current chart tools and saved work. Add a separate read-only assessment interface; preserve the existing EMA50 sector feed.
- All first-slice product decisions are approved. The separate coder implements; the orchestrator reviews. No application code has been changed by this planning/cleanup work.

## Later Parallax slices

- Manual watchlist additions and scanner suggestions; users choose what to monitor. Lock the scanner universe and RS calculation before implementation.
- Stock review and pullback, breakout and breakout-retest monitoring. Lock pullback boundaries/buffer and the breakout/retest rules before implementation.
- Chart-tool improvements: lines, indicators and Fibonacci. Preserve existing functionality while designing the later interaction.

## Other active follow-ups

- MoonMarket: real IBKR paper validation of single-leg options and enhanced stock OrderTicket flows. Option brackets remain deferred.
- TWS: verify fill notifications and real-time cockpit updates against live market data; [package replacement](docs/superpowers/specs/2026-07-01-scale-out-cockpit-v2-design.md) remains a separate unapproved broker-mutation follow-up.
- MCP: verify read-only client list/call behavior and the packaged backend runtime. Preserve the [existing exposure boundary](docs/superpowers/specs/2026-06-26-mcp-readonly-server-design.md).
- Release: indicator/chart accuracy, saved-state/restart behavior, gateway installation and packaged macOS/Windows smoke checks.

These verification items were retained from the prior roadmap; their completion was not revalidated during this documentation-only cleanup.
