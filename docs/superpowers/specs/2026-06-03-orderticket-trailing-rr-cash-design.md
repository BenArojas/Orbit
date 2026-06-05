# OrderTicket enhancements — Trailing stops, RTH, plain labels, R/R, cash sizing — Design

> Date: 2026-06-03
> Status: Approved design — to be decomposed into an implementation plan at the writing-plans step.
> Module: MoonMarket (shared OrderTicket).
> Parent spec: `docs/superpowers/specs/2026-05-26-orbit-orderticket-design.md` (Plan #5 — established the slide-over OrderTicket, preview→confirm→place flow, bracket plumbing, and the paper-only live-trading guard).

---

## Purpose

Five additive, user-facing enhancements to the existing OrderTicket modal, all driven by how Ofek actually trades. None of them changes the bracket plumbing, the paper-account guard, or the live-trading block.

1. **Trailing stop order types** — expose IBKR-native `TRAIL` and `TRAILLMT`.
2. **Outside RTH** flag.
3. **Plain-English labels** for every order-type / TIF / trailing-type shortcut.
4. **Risk/Reward readout** on bracket orders, with a short inline explanation.
5. **Cash sizing** — size a position by dollars (or % of buying power) instead of share count.

All five ship together on one branch.

---

## Scope boundaries

**In scope:** the five items above, with backend payload + validation support for trailing fields and `outsideRTH`, and frontend UI for all five.

**Out of scope (explicitly):**
- Making the bracket's stop-loss leg itself trailing. Trailing stays its own standalone order type; brackets keep their fixed `STP` leg.
- `GTD` (good-till-date) and `MOC`/`LOC` (market/limit-on-close) order types — noted as backlog, pair better with the v2 TWS-mode engine.
- Options brackets (already deferred/rejected server-side).
- Anything in the v2 tiered scale-out execution engine (separate subsystem, separate spec — see `parallax-v2-roadmap` / dual-mode bot direction).

---

## Decisions (locked during brainstorming)

| Topic | Decision |
|---|---|
| Trailing variants | **Both** `TRAIL` (trailing stop → market) **and** `TRAILLMT` (trailing stop → limit). |
| Trailing units | User selects **Percent (%)** or **Amount ($)** → `trailingType: "%" | "amt"`. |
| Outside RTH | New checkbox → `outsideRTH: bool`, default **off**. |
| Labels | Display-only plain-English labels; **wire values stay the IBKR codes** (`MKT`, `GTC`, `TRAIL`, etc.). One shared label map, defined once. |
| R/R readout | Shown only in bracket mode when both TP and SL are set. **Read-only / informational — never blocks the order.** Includes a one-line plain-English explainer. |
| Cash sizing | **Size by: Shares / Cash / % of Buying Power**. Cash = dollar amount; % of Buying Power = percent of the account's IBKR buying power. Computes a share quantity; IBKR still receives shares. **Buying power is fetched from IBKR `GET /portfolio/{accountId}/summary`** (margin buying power, which can exceed cash) via a new read-only Orbit funds endpoint. |
| Branch base | New branch cut **from `dev`** (per parallax-git naming), not from `feature/inflect-journal`. |

---

## IBKR grounding (CPAPI)

Trailing orders post to `POST /iserver/account/{accountId}/orders` with:

| Field | Meaning | Required |
|---|---|---|
| `orderType` | `"TRAIL"` or `"TRAILLMT"` | yes |
| `trailingType` | `"amt"` (absolute $) or `"%"` (percent) | yes for trailing |
| `trailingAmt` | trail distance (e.g. `trailingType:"%", trailingAmt:5` = sell after a 5% drawdown from the high) | yes for trailing |
| `auxPrice` | absolute offset reference for the stop | per CPAPI |
| `price` | limit offset once triggered | **`TRAILLMT` only** |
| `outsideRTH` | allow execution outside regular trading hours | optional |

TIF for trailing orders is restricted to `DAY` or `GTC` (`IOC` is incompatible with a resting stop).

Sources: IBKR Campus — Order Types; IBKR Web API Trading.

---

## 1. Trailing stop order types

**Types** — add `TRAILLMT` to the order-type unions (`TRAIL` already exists):
- Frontend: `src/lib/api.ts` (`MoonMarketOrderType`, `MoonMarketOrderDraft`).
- Backend: `backend/models/__init__.py` (`OrderType`, `MoonMarketOrderDraft`).

**New draft fields** (alias-mapped camelCase ↔ snake_case): `trailingType`/`trailing_type`, `trailingAmt`/`trailing_amt`. `price`/`auxPrice` already exist and are reused.

**UI** (`src/orbit/OrderTicket/OrderForm.tsx`) — when order type is `TRAIL` or `TRAILLMT`, reveal:
- **Trail by**: Percent (%) / Amount ($) toggle → `trailingType`.
- **Trail distance** → `trailingAmt`.
- **Limit offset** (only `TRAILLMT`) → `price`.

**Backend payload** (`backend/services/orders.py` `_order_payload`) — emit `trailingAmt`, `trailingType` when present; `price` for `TRAILLMT`.

**Validation** (Pydantic + form):
- `TRAIL`/`TRAILLMT` require `trailingAmt > 0` and `trailingType ∈ {"amt","%"}`.
- `TRAILLMT` additionally requires `price`.
- Trailing TIF restricted to `DAY`/`GTC`.

---

## 2. Outside RTH flag

A checkbox in the form → `outsideRTH: bool` on the draft and the Pydantic model (default `False`), emitted in `_order_payload` when true.

---

## 3. Plain-English labels (display-only)

A single shared map (e.g. `src/orbit/OrderTicket/labels.ts`) consumed by every dropdown/toggle so labels are defined once. The value sent to IBKR is always the code; only the rendered text changes.

| Code (wire) | Label |
|---|---|
| `MKT` | Market |
| `LMT` | Limit |
| `STP` | Stop |
| `STP_LIMIT` | Stop Limit |
| `TRAIL` | Trailing Stop |
| `TRAILLMT` | Trailing Stop Limit |
| `DAY` | Day |
| `GTC` | Good Till Cancel |
| `IOC` | Immediate or Cancel |
| trailingType `amt` | Amount ($) |
| trailingType `%` | Percent (%) |

---

## 4. Risk/Reward readout (bracket mode)

When bracket mode is active and **both** take-profit and stop-loss prices are set, render a computed line plus a short explainer.

- **Entry reference:** the limit price if set, otherwise the live last/ask from the existing market-data feed.
- **Long:** `risk = entry − stopLoss`, `reward = takeProfit − entry`. **Short:** signs reversed. `ratio = reward / risk`.
- **Display:** `Risk / Reward  1 : 2.8` with explainer text, e.g. *"For every $1 you risk down to your stop, you stand to make about $2.80 at your target. A ratio of 1:3 or higher is generally considered favorable."*
- Updates live as prices change. **Read-only** — it informs, it never blocks or alters the order. Degrades gracefully (hidden) if entry/TP/SL are incomplete or risk ≤ 0.

---

## 5. Cash sizing

A **Size by: Shares / Cash / % of Buying Power** toggle in the form.

- **Shares mode:** unchanged — quantity is entered directly.
- **Cash mode:** user enters a dollar amount. `quantity = floor(cashAmount / referencePrice)`, where `referencePrice` = limit price if set, else live ask, else live last.
- **% of Buying Power mode:** user enters a percent; `cash = buyingPower × pct/100`, then `quantity = floor(cash / referencePrice)`. The account's buying power is shown for context.
- The resolved share count (and, for % mode, the resolved cash) is displayed before submit. IBKR still receives `quantity` in shares.
- Degrades gracefully when reference price or buying power is unavailable (computed shares shown as `—`).

**Buying-power source (new, read-only backend):** a `GET /moonmarket/accounts/{accountId}/funds` endpoint calls IBKR `GET /portfolio/{accountId}/summary` and returns normalized `buying_power`, `available_funds`, `cash`, and `currency`. The summary payload uses `{amount, currency}` values under keys like `buyingpower`/`availablefunds`/`totalcashvalue`; the parser tries multiple key spellings (mirroring the existing ledger parser in `backend/services/moonmarket.py`) and the exact shape is confirmed against a live paper response during implementation. This is the **one** backend addition beyond trailing/RTH serialization; it places no orders and is allowed on any account.

---

## Affected files (summary)

| Area | File | Change |
|---|---|---|
| FE types | `src/lib/api.ts` | add `TRAILLMT`; `trailingType`/`trailingAmt`/`outsideRTH` on draft |
| FE form | `src/orbit/OrderTicket/OrderForm.tsx` | trailing fields, RTH checkbox, cash toggle, R/R readout, use label map |
| FE labels | `src/orbit/OrderTicket/labels.ts` (new) | shared code→label map |
| BE models | `backend/models/__init__.py` | add `TRAILLMT`; `trailing_type`/`trailing_amt`/`outside_rth`; validation |
| BE service | `backend/services/orders.py` | emit trailing + `outsideRTH` in `_order_payload` |

---

## Testing

- **Backend** (`backend/tests/test_orders_router.py`): `TRAIL` and `TRAILLMT` payloads serialize the correct fields (`trailingAmt`, `trailingType`, `price` for limit, `outsideRTH`); validation rejects trailing without `trailingAmt`/`trailingType`, and `TRAILLMT` without `price`.
- **Frontend** (`src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx`): trailing fields render conditionally per order type; dropdowns render plain-English labels; R/R computes correctly for long and short and hides when incomplete; cash mode computes the expected share count.

Per CLAUDE.md rule #1, no PR without test coverage for the changed code.
