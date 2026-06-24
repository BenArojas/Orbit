# Trading Safety Module

> Date: 2026-06-06
> Branch: `feature/trading-safety-module`
> Parent finding: `docs/superpowers/specs/2026-06-06-v1-foundation-architecture-findings.md`

## Problem

Trading mutation policy is currently split across historical docs, backend order behavior, backend tests, and the OrderTicket UI.

The product policy has changed: live-account mutations are allowed. The remaining risk is policy drift. Old active docs still describe paper-only live guards, while the current backend allows live place, reply, cancel, and modify requests and the frontend requires a real-money confirmation dialog before live submission.

## Product Policy

- Preview is allowed for paper and live accounts.
- Paper-account place, reply, cancel, and modify are allowed.
- Live-account place, reply, cancel, and modify are allowed.
- Live-account frontend mutations must require an explicit real-money confirmation before calling the sidecar.
- Orbit remains decision support, not an autonomous trading bot.
- The backend should expose a single localized policy decision instead of scattering live-vs-paper rules through order services, routers, UI copy, and tests.

### Fail-closed rules (2026-06-10)

- Unknown or unclassifiable accounts fail closed: `evaluate_order_action` raises `MoonMarketAccountNotFoundError` (routers map it to 404). An account missing from the MoonMarket snapshot is never treated as paper.
- `TradingSafetyDecision` enforces internal consistency via a pydantic `model_validator`: `rejected` ⇒ not allowed; `live_confirmation_required` ⇒ allowed with `confirmation.required`, `message`, and `confirm_label` present; `paper_allowed` ⇒ allowed without confirmation.
- The frontend never invents confirmation copy. OrderTicket's live gate blocks the action (with an error toast) when the trading-safety service is unreachable, the decision rejects, or an allowed decision is missing its confirmation message/label. Confirmation dialog copy always comes from the backend decision.

## Suggested Solution

Create a Trading Safety module that owns the order mutation policy vocabulary and expose that policy through one small sidecar endpoint.

The first slice should keep runtime trading behavior unchanged while proving one real user path end-to-end: a live-account user places an order from OrderTicket, receives the policy-backed real-money confirmation, confirms, and the backend evaluates the same policy before forwarding the mutation to IBKR.

## First Tracer Bullet

**AFK candidate:** Live account place order uses Trading Safety end-to-end.

User behavior to prove:

- A live-account user clicks `Place` in OrderTicket.
- OrderTicket fetches the Trading Safety decision for `action=place`.
- The confirmation dialog copy and confirm label come from the policy decision.
- The order is not submitted before the user confirms the real-money dialog.
- After confirmation, `POST /moonmarket/orders` is called.
- The backend evaluates the same Trading Safety policy before forwarding the place request to IBKR.
- Live place remains allowed by policy.

Small public interface:

```py
class TradingSafetyPolicy:
    async def evaluate_order_action(
        self,
        account_id: str,
        action: TradingSafetyAction,
    ) -> TradingSafetyDecision: ...
```

Hidden complexity:

- account resolution
- paper/live account classification
- action vocabulary
- typed allow/reject mode
- live-confirmation-required metadata

Sidecar endpoint:

```txt
GET /moonmarket/trading-safety/order-action?account_id=<id>&action=place
```

Initial response shape:

```json
{
  "account_id": "U12345",
  "action": "place",
  "allowed": true,
  "mode": "live_confirmation_required",
  "confirmation": {
    "required": true,
    "title": "Real-money order",
    "message": "Review and confirm before sending this live order to IBKR.",
    "confirm_label": "Place Live Order"
  }
}
```

## Slice Status

- Slice 1 complete: live account place order uses Trading Safety end-to-end.
- Slice 2 complete: live account IBKR reply confirmation uses Trading Safety end-to-end.
- Slice 3 complete: live account cancel order uses Trading Safety end-to-end.
- Slice 4 complete: live account modify order uses Trading Safety end-to-end.

## Remaining Work

**AFK candidate:** Active docs are updated so the OrderTicket spec and options spec no longer claim live mutations are blocked.

**HITL:** Add a repo workflow skill or merge-time check that flags policy doc drift when trading-safety policy files change before merging to `dev`.

## Out Of Scope

- Do not block live mutations.
- Do not add autonomous trading behavior.
- Do not build the TWS execution adapter in this branch.
- Do not refactor the full OrderTicket lifecycle module here.
- Do not split the Client Portal execution adapter here.

## Approved Slice

The approved first slice is the vertical live-place path with a policy-read endpoint, OrderTicket consuming that decision, and the backend order mutation route using the same policy before the IBKR call.
