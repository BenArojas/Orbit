---
name: trading-safety-policy
description: Use when changing Orbit trading mutation behavior, live vs paper policy, OrderTicket confirmation behavior, order routes, or docs before merging to dev.
---

# Trading Safety Policy

Use this skill whenever a change can affect order mutation policy, including place, reply, cancel, modify, live-account confirmation, or paper/live account classification.

## Current Policy

- Preview is allowed for paper and live accounts.
- Place, reply, cancel, and modify are allowed for paper and live accounts.
- Live-account frontend mutations require explicit real-money confirmation before the sidecar mutation call.
- Backend mutation routes must evaluate `TradingSafetyPolicy` before forwarding to IBKR.
- Orbit remains decision support, not an autonomous trading bot.

## Required Workflow

1. Inspect `backend/services/trading_safety.py`, `backend/routers/orders.py`, and `src/orbit/OrderTicket/OrderForm.tsx`.
2. Update active policy docs when behavior changes:
   - `docs/superpowers/specs/2026-05-26-orbit-orderticket-design.md`
   - `docs/superpowers/specs/2026-05-28-moonmarket-options-design.md`
   - relevant active plans in `docs/superpowers/plans/`
3. Run:

```bash
npm run check:trading-safety-policy
```

4. Add or update public-interface tests for any changed action path.

## Do Not

- Reintroduce paper-only live mutation language in active docs.
- Change live-vs-paper trading behavior without a human checkpoint.
- Let frontend-only gates replace backend Trading Safety evaluation.
