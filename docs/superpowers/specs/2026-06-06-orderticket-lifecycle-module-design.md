# OrderTicket lifecycle module - Design

> Date: 2026-06-06
> Status: Branch spec for the architecture finding.
> Parent finding: `docs/superpowers/specs/2026-06-06-v1-foundation-architecture-findings.md`

## Problem

`OrderForm.tsx` owns too much lifecycle behavior: draft construction, bracket construction, live-order modify hydration, IBKR result parsing, fill-state derivation, and post-submit invalidation. The visible OrderTicket interface is small, but the implementation is shallow because trading lifecycle rules are embedded directly in the UI adapter.

## Solution

Keep the existing OrderTicket slide-over seam and move lifecycle behavior behind a module-local public interface. The UI remains responsible for rendering fields and calling mutations; the lifecycle module owns deterministic order rules that can be tested without rendering React.

## Public Interface

Start with `src/orbit/OrderTicket/orderLifecycle.ts`.

- `buildOrderDraft(input)` returns the normalized base `MoonMarketOrderDraft`.
- `buildOrderChain(input)` returns either a single order or the bracket parent/child chain plus validation errors.
- `availableOrderTypesFromRules(values)` and `outsideRthOrderTypesFromRules(values)` normalize IBKR rule payloads into ticket-facing order-type sets.
- `buildOrderSubmission(input)` validates quantity and price requirements, then returns either errors or ready-to-submit orders.
- `classifyOrderResult(result)` classifies an IBKR mutation response as submitted, reply-required, rejected, or unknown.
- `deriveOrderTracker(input)` turns the tracked order, live orders, recent trades, and current price into one `OrderTrackerState`.
- `buildOrderRefreshPlan(input)` returns the query invalidations and revalidate-positions decision for submitted, filled, and cancelled transitions.

`src/orbit/OrderTicket/useOrderTicketLifecycle.ts` is the React adapter hook over those lifecycle functions. `OrderForm.tsx` should stay focused on rendering and field wiring.

The interface hides numeric parsing, price-field normalization, bracket parent id rules, child order side selection, stock-vs-option bracket eligibility, nested IBKR result rows, numeric/string ids, rejection-status handling, IBKR rule normalization, submit validation, stale-trade filtering, fill-state derivation, distance math, and post-submit refresh rules.

## Vertical Slices

- **Slice 1 - AFK:** Extract draft and bracket construction. Prove the module can build a plain limit draft, a take-profit/stop-loss bracket chain, an option single-leg draft, and validation errors for missing protective prices. Keep UI behavior unchanged.
- **Slice 2 - AFK after user approval:** Extract IBKR result/reply parsing. Public interface classifies a response as final order, reply-required, rejection, or unknown before the UI reacts.
- **Slice 3 - AFK after user approval:** Extract fill-state derivation. Public interface turns tracked order, live order, trades, and quote into `OrderTrackerState`.
- **Slice 4 - AFK after user approval:** Extract post-submit invalidation rules. Public interface lists which query keys and side effects a lifecycle transition requires.

## Out Of Scope

- No new trading behavior.
- No backend API changes.
- No changes to Trading Safety policy.
- No UI redesign.
- No options bracket support.

## Testing

Slice 1 uses TDD through the new lifecycle module public interface and reruns the existing OrderTicket UI tests that submit through the real form adapter.
