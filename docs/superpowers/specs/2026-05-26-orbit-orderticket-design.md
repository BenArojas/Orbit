# Orbit OrderTicket + conid nav bridge — Design (Plan #5)

> Date: 2026-05-26
> Status: Approved design — to be decomposed into sub-plans (5a/5b/5c) at the writing-plans step.
> Parent spec: `docs/superpowers/specs/2026-05-25-orbit-v1-design.md` (locked the right-side slide-over form factor, OrderPanel reuse, and the conid nav bridge).

---

## Purpose

Give Orbit a single shared **OrderTicket** — a right-side slide-over for placing IBKR orders — usable from both MoonMarket and Parallax, plus a stateless **conid nav bridge** between the two modules. This is the first time Orbit places real orders, so all order mutations must cross the Trading Safety policy boundary.

The order logic already exists in `reference/moonmarket/` (backend `api/orders.py`, frontend `StockItem/trading/OrderPanel.tsx` + helpers). This plan **ports and re-stacks** that proven logic onto Orbit's conventions (ibind-backed `IBKRService`, shadcn/Tailwind, TanStack Query) — it does not invent the order flow.

---

## Decisions (locked during brainstorming)

| Topic | Decision |
|---|---|
| Order flow | **Full**: preview (IBKR `whatif`) → confirm → place, single **and bracket** (entry + profit-taker + stop), plus cancel and modify. |
| Entry points | MoonMarket position rows ("Trade"); Parallax analysis toolbar ("Trade", for the charted conid). No standalone symbol search, no chart price-level prefill. |
| Open a NEW position | Analyze the symbol in Parallax → "Trade" (Parallax Trade button is the new-entry path). MoonMarket "Trade" manages existing holdings. |
| Paper/live policy | Preview, place, confirm/reply, cancel, and modify are allowed on paper and live accounts. Live-account frontend mutations require an explicit real-money confirmation, and backend mutation routes evaluate the Trading Safety policy before forwarding to IBKR. |
| Summon mechanism | Global `useOrderTicketStore` + a single `<OrderTicket/>` mounted once at the Orbit root (inside `OrbitProviders`, above the router). |
| Account selection | A shared `useAccountStore` (selected/default account id) so MoonMarket's selector and the ticket agree; default resolved from `/moonmarket/accounts`. |
| Form factor | Right-side slide-over (locked in v1 spec). |

---

## Decomposition (three sub-plans)

Execute in order; each is independently testable.

- **5a — Backend orders API** (`/moonmarket/orders/*`): port `reference/.../api/orders.py` to an ibind-backed router. Depends on nothing new.
- **5b — Shared OrderTicket UI**: global store + single mount + re-stacked OrderPanel, wired to 5a. Depends on 5a.
- **5c — conid nav bridge + entry points**: Trade / Analyze-in-Parallax / View-in-Portfolio buttons. Depends on 5b (for the Trade buttons) but the nav-bridge buttons alone depend on nothing new.

---

## 5a — Backend orders API

New router (e.g. `backend/routers/orders.py`, prefix `/moonmarket/orders`, or extend `routers/moonmarket.py`) backed by `IBKRService` (the only IBKR gateway). Port the reference flow, adapting `self._req(...)` → Orbit's `IBKRService._request(...)`:

| Endpoint | IBKR call | Notes |
|---|---|---|
| `POST /moonmarket/orders/preview` | `POST /iserver/account/{accountId}/orders/whatif` | Returns cost/margin/warnings. Allowed on any account. |
| `POST /moonmarket/orders` | `POST /iserver/account/{accountId}/orders` | Body is a list — single order or a bracket group (`cOID`/`parentId`/`isSingleGroup`). Trading Safety is evaluated before forwarding. |
| `POST /moonmarket/orders/{accountId}/reply/{replyId}` | `POST /iserver/reply/{replyId}` | `{confirmed: true|false}`. Account id is required so Orbit can evaluate Trading Safety before forwarding. |
| `DELETE /moonmarket/orders/{accountId}/{orderId}` | `DELETE /iserver/account/{accountId}/order/{orderId}` | Cancel. Trading Safety is evaluated before forwarding. |
| `PATCH /moonmarket/orders/{accountId}/{orderId}` | `POST /iserver/account/{accountId}/order/{orderId}` | Modify (merge over the live order, as the reference does). Trading Safety is evaluated before forwarding. |

- **Pydantic models** for the order request (conid, side, quantity, orderType, tif, price?, auxPrice?, bracket fields?) and the IBKR responses. Strict types, no bare `Any` in the public surface.
- **Paper detection:** add `is_paper: bool` to the account model. Primary heuristic: account id starts with `DU` (IBKR paper). The plan must also inspect a live `/iserver/accounts` (or `/portfolio/accounts`) payload for an explicit flag (e.g. a `type`/`tradingType`/`isPaper` field) and prefer it if present; fall back to the `DU` prefix.
- **Trading Safety policy:** place, reply, cancel, and modify resolve the target account, classify paper/live account state, and evaluate the Trading Safety decision before forwarding to IBKR. The current product policy allows live mutations, with live confirmation required upstream.
- **Fills:** placing/fetching does not change the existing `upsert_fills` path; the `fills` table continues to be populated by `/moonmarket/trades` (unchanged).
- **Tests:** `backend/tests/test_orders_router.py` with a mocked `IBKRService` — preview shape, place (single + bracket payload), confirm reply, cancel, modify, live-account allowed behavior, and Trading Safety rejection paths for place/reply/cancel/modify.

---

## 5b — Shared OrderTicket UI

Re-stack the reference trading components from MUI → shadcn into `src/orbit/OrderTicket/`:
- `useOrderTicketStore.ts` — Zustand: `{ isOpen, conid, symbol, side?, open(args), close() }`.
- `useAccountStore.ts` — Zustand: `{ selectedAccountId, setAccount() }`; default resolved from the accounts query.
- `OrderTicket.tsx` — right-side slide-over shell; reads the store; renders nothing when closed.
- `OrderForm.tsx` (+ small subcomponents as needed) — ported from `OrderPanel`/`OrderFormFields`/`OrderInfoDisplay`/`OrderResultDisplay`: side, quantity, order type, TIF, limit/aux price, bracket toggle (profit-taker + stop), preview→confirm→place result display.
- Raw API methods live in `src/lib/api.ts`, matching the existing `api.moonmarket*` client; TanStack Query mutation hooks (`usePreviewOrder`/`usePlaceOrder`/`useConfirmOrder`/`useCancelOrder`/`useModifyOrder`) live in `src/orbit/OrderTicket/useOrderMutations.ts`.
- **Paper/live badge:** the ticket shows PAPER (green) or LIVE (red) for the active account; when LIVE, place/confirm/cancel/modify remain available but require an explicit real-money confirmation sourced from Trading Safety policy.
- Mounted once: `<OrderTicket/>` inside `OrbitProviders` beside `{children}`, before `<Toaster />`, so it overlays whichever module is active.
- `TransactionsPage` live-orders tab stops being read-only in Plan #5: rows expose **Cancel** and **Modify**. Cancel uses `useCancelOrder`; Modify opens the shared ticket in modify mode with the order id and prefilled draft. Both follow the same paper/live guard.
- **Tests:** store open/close; form renders the active conid/symbol; place disabled + badge LIVE when account is live, enabled when paper; bracket fields appear when toggled. Backend calls are mocked.

---

## 5c — conid nav bridge + entry points

- **MoonMarket `PortfolioPage`** selected-position inspector / actionable position rows gain two actions:
  - **Trade** → `useOrderTicketStore.getState().open({ conid, symbol, side: "SELL" })` (default SELL since it's an existing holding; user can flip to BUY).
  - **Analyze in Parallax** → `useNavigationStore.getState().navigateToAnalysis(conid, symbol)` then `navigate('/parallax')`.
- **Parallax `AnalysisPage`** toolbar gains:
  - **Trade** → `open({ conid, symbol })` for the charted instrument (the new-position path).
  - **View in Portfolio** → `navigate('/moonmarket/portfolio')`.
- The bridge is stateless — only the conid (and symbol for display) crosses; no shared trade state.
- **Tests:** clicking Trade calls `open` with the right conid; clicking Analyze/View calls the right navigation. Mock the stores/router.

---

## Out of scope (v1)

- Options trading (Phase 2).
- Autonomous trading behavior.
- Chart price-level prefill of the limit price.
- Standalone symbol search → trade.
- Keeping the ticket's draft state across opens (each open starts fresh).

---

## Success criteria

- From a MoonMarket position or the Parallax chart, the OrderTicket slides in for that conid.
- On a **paper** account: preview→confirm→place works for market, limit, and bracket orders; cancel/modify work.
- On a **live** account: the ticket shows a LIVE badge, order mutations require explicit real-money confirmation in the UI, and the server evaluates Trading Safety before forwarding place/confirm/cancel/modify to IBKR.
- Nav bridge: MoonMarket→Parallax loads the charted conid; Parallax→MoonMarket lands on the portfolio.
- Focused frontend tests + `npx vite build` pass; `npm run typecheck` has no new OrderTicket/MoonMarket errors beyond the known unrelated baseline until that baseline is fixed. `uv run python -m pytest` is green for backend order tests, including Trading Safety allow/reject cases.
