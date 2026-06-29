# TWS Order Management Design

> Status: DESIGN APPROVED
> Branch: `feature/tws-execution-assistant-spec`
> Date: 2026-06-28

## Problem

The TWS Execution Assistant can submit paper orders and show Open Orders, but it
cannot manage those open orders. For intraday use, the next useful behavior is
fast order management, not saved drafts or long-lived plan recovery.

## Approved Direction

Add TWS order management in one batch:

- Add `STP` and `STP LMT` to the execution ticket.
- Let users cancel every TWS open order shown in the table.
- Let users modify supported open orders.
- Handle advanced TWS rejects with an explicit user override flow.
- Keep everything process-local.

No DB-backed plans, restart recovery, audit ledger, or live trading enablement in
this batch.

## Order-Type Capabilities

Use one Orbit-owned capability map so draft, preview, submit, and modify cannot
drift:

| Type | Draft | Modify | Editable fields |
|---|---:|---:|---|
| `MKT` | yes | no | quantity |
| `LMT` | yes | yes | quantity, limit price |
| `STP` | yes | yes | quantity, stop price |
| `STP LMT` | yes | yes | quantity, stop price, limit price |

Both `BUY` and `SELL` are allowed for `STP` and `STP LMT`.

Unsupported order types seen in Open Orders still get `Cancel`. Their modify
action is hidden or disabled with `Modify not supported for this order type yet.`

## Draft And Submit

The ticket renders required fields from the capability map:

- `MKT`: no price field.
- `LMT`: limit price.
- `STP`: stop trigger.
- `STP LMT`: stop trigger plus limit cap/floor.

Backend validation owns the same requirements. `TwsBrokerAdapter` remains the
only place that creates `ib_async` contract/order objects.

Button labels stay clean: `Review order` and `Place order`. The environment is
shown once as status context, for example `Paper TWS`, not repeated in every
button.

## Cancel Flow

Every visible TWS open order row gets `Cancel`.

The backend rechecks mutation safety immediately before the broker call:

- adapter connected
- TWS session mode active
- mutation policy allows the current environment
- kill switch inactive
- order exists in current TWS open orders when practical

After cancel, Orbit refreshes Open Orders. If the broker outcome is ambiguous,
Orbit says so and refreshes anyway.

Do not use global cancel.

## Modify Flow

Supported rows get `Modify`. The existing ticket opens in edit mode, prefilled
from the selected open order.

The user may edit only:

- quantity
- the order type's editable price fields

The user may not edit:

- symbol or `conid`
- side
- account or session mode
- order type
- parent/child relationships

Review shows before/after values. Submit uses TWS modify semantics: send the same
broker `order_id` with the updated order object. After submit, refresh Open
Orders.

## Advanced Reject / Override Flow

TWS advanced rejects are not Client Portal replies. If TWS returns advanced reject
JSON, Orbit shows a blocking panel with:

- clean rejection summary
- override code/tag list
- expandable raw IBKR reject details
- `Override and submit`
- `Cancel`

Orbit never auto-overrides. If the user chooses override, the backend resubmits
the same order with `advancedErrorOverride`, then refreshes Open Orders.

Real TWS reject payloads should be captured during manual smoke if possible. If
paper TWS cannot trigger one reliably, the mocked/defensive path can ship with the
manual real-reject smoke marked unproven.

## Safety And Live-Ready Seam

This implementation remains paper-only in behavior, but it should not scatter
paper checks through every endpoint.

Route all broker mutations through one backend guard such as
`ensure_tws_order_mutation_allowed(action)`. Today that guard allows only known
paper environments. Later live enablement should change this guard, live
confirmation copy, and Trading Safety integration, not rewrite cancel/modify.

Do not add a simple accidental toggle like `ENABLE_LIVE_TWS_TRADING=true`.

## Non-Goals

- No DB-backed execution plans.
- No saved drafts.
- No restart recovery.
- No audit ledger.
- No kill-switch persistence.
- No live trading enablement.
- No global cancel.
- No bracket, OCA, trailing, GTD, MOC/LOC, conditions, or full order-workstation
  editor.
- No persistence of AI-generated suggestions; that belongs to a later AI workflow.

## Verification Targets

- `npm run typecheck`
- Focused backend tests for order-type validation and fail-closed mutation guards.
- Manual paper smoke:
  - create and place `LMT`, then cancel it
  - create and place `LMT`, then modify price and quantity
  - create, review, and place `STP`
  - create, review, and place `STP LMT`
  - attempt to capture one advanced reject response; if unavailable, document that
    only the defensive/mocked advanced-reject path was proven
