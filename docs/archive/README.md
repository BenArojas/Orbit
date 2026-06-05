# Archived Design Docs

These are **plans and specs for v1 features that have already shipped**. They are
kept for historical reference only — they are not active/forward-looking design.
If you are an agent (Claude Code, Codex) or a human looking for the *current*
design of a system, look in `docs/superpowers/plans/`, `docs/superpowers/specs/`,
and `docs/ibkr-pacing.md` first. Only consult this folder when you need the
original rationale behind a shipped v1 feature.

> Nothing here is dead weight to delete — these documents explain *why* shipped
> code looks the way it does. They were moved out of the active design folders
> during the v1 close-out cleanup so the active folders only hold docs that v2
> still builds on.

## Contents

| Feature (shipped in v1) | Plan | Spec |
| --- | --- | --- |
| AI prompt fact layer | `2026-05-24-ai-prompt-fact-layer.md` | `2026-05-24-ai-prompt-fact-layer-design.md` |
| MoonMarket portfolio | `2026-05-26-moonmarket-portfolio.md` | `2026-05-26-moonmarket-portfolio-design.md` |
| MoonMarket transactions | `2026-05-26-moonmarket-transactions.md` | `2026-05-26-moonmarket-transactions-design.md` |
| Today page / watchlists / triggers | `2026-05-20-today-page-watchlists-triggers-plan.md` | `2026-05-20-watchlists-triggers-design.md`, `2026-05-20-watchlists-triggers-recommendations.md` |
| Inflect basis backfill / recovery | `inflect-basis-backfill-general-plan.md`, `2026-06-02-inflect-basis-recovery-implementation-plan.md` | — |

## What was kept active (not archived)

Left in `docs/superpowers/` because v2 builds directly on them:

- `specs/2026-05-25-orbit-v1-design.md` — master v1 design
- `plans/2026-05-25-orbit-foundation.md` — app foundation
- MoonMarket **options** (foundation for the v2 dual-mode bot): the `2026-05-28-moonmarket-options*` and `2026-06-04-moonmarket-options-atm-review-fixes.md` docs
- **OrderTicket** (the real-money order path the v2 trade-manager extends): the `2026-05-26-orbit-orderticket*` and `2026-06-03-orderticket-trailing-rr-cash*` docs
- **Inflect** journal (the next module to build): `2026-06-01-inflect-journal-*`
- `docs/ibkr-pacing.md` — IBKR rate/pacing limits, needed for v2 automation

## What was deleted (recoverable via git history)

One-off completed bug-fix / polish / optimization plans with no forward value were
deleted, not archived (recover from git history if ever needed): analysis-page fix,
drawing-tools plan, fibonacci-improvements, phase8 dashboard optimization, chart
state bugs, fib UX bugs, layout-and-history, compare mode, and orbit launcher polish.
The `reference/moonmarket/` porting copy of the old MoonMarket app was also deleted.
