"""FIFO round-trip trade matcher (spec §5).

Pure functions over the shared `fills` projection. Given a flat list of fill
rows (the `fills` table shape produced by `DatabaseService.list_fills_*`), the
matcher walks each instrument's executions in chronological order maintaining a
signed lot queue and emits round-trip `InflectTrade`s.

Key properties (spec §5.1):
  * Sign-aware — longs (buy-to-open → sell-to-close) and shorts
    (sell-to-open → buy-to-close) are both handled by one signed queue.
  * FIFO — reducing fills close against the oldest open lots first.
  * Partial scale-in/scale-out stays in one trade until the position is flat.
  * Commissions are allocated proportionally per fill (by the quantity of that
    fill applied to the trade), so a fill that flips the position splits its
    commission across the closing and the newly-opened trade.
  * Still-open positions (queue non-empty at end) are emitted as `OPEN` trades
    with no close fields and no realized P&L — the calendar excludes them.
  * Protective basis rule — a sell with no known long behind it is NEVER
    silently turned into a short. A first-seen flat sell, and the over-sell
    remainder of a long→flat flip, both become `INCOMPLETE_BASIS` ("Needs
    basis"). A short is opened only when the sell carries explicit IBKR
    opening-short metadata (see `_is_explicit_opening_short`). This stops the
    matcher inventing phantom shorts from incomplete local history.

`trade_id` is the deterministic, stable id from spec §5.2:
    f"{account_id}:{conid}:{first_open_execution_id}"

The matcher never touches IBKR, the DB, or the network — it is a deterministic
transform from fills to trades, which keeps it trivially unit-testable.
"""

from __future__ import annotations

from collections import deque
from typing import Any, Optional

from models.inflect import InflectFill, InflectTrade

# Float tolerance for treating a residual lot/position as flat. Fill
# quantities are whole or fractional shares/contracts; 1e-9 is far below any
# real size yet absorbs binary-float drift from repeated subtraction.
_EPS = 1e-9


def match_fills(fills: list[dict[str, Any]]) -> list[InflectTrade]:
    """Derive round-trip trades from raw fill rows.

    Fills are grouped by (account_id, conid) and matched independently, then
    the combined result is returned oldest-first by open time. Rows without a
    `trade_time_ms` cannot be placed on the timeline and are skipped (the DB
    query already excludes them; this is belt-and-suspenders).
    """
    groups: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for fill in fills:
        if fill.get("trade_time_ms") is None:
            continue
        account_id = str(fill["account_id"])
        conid = int(fill["conid"])
        groups.setdefault((account_id, conid), []).append(fill)

    trades: list[InflectTrade] = []
    for (account_id, conid), group in groups.items():
        group.sort(
            key=lambda f: (
                int(f["trade_time_ms"]),
                str(f.get("trade_time") or ""),
                str(f.get("execution_id") or ""),
            )
        )
        trades.extend(_match_conid(account_id, conid, group))

    trades.sort(key=lambda t: t.open_time_ms)
    return trades


def _match_conid(
    account_id: str, conid: int, fills: list[dict[str, Any]]
) -> list[InflectTrade]:
    """Match one instrument's chronologically-ordered fills into trades."""
    trades: list[InflectTrade] = []
    lots: deque[dict[str, float]] = deque()
    pos_dir = 0  # +1 long, -1 short, 0 flat
    acc: Optional[dict[str, Any]] = None

    for fill in fills:
        sign = 1 if str(fill["side"]).upper() == "BUY" else -1
        price = _fill_price(fill)
        fill_qty = abs(float(fill["quantity"]))
        remaining = fill_qty

        while remaining > _EPS:
            # Protective guard: a sell while flat (no known long to close) is
            # missing basis, not a short. This fires both for a first-seen
            # sell and for the over-sell remainder left after a long flips to
            # flat. The only escape is explicit IBKR opening-short metadata,
            # which proves the short was genuinely opened.
            if (
                pos_dir == 0
                and sign < 0
                and not _is_explicit_opening_short(fill)
            ):
                trades.append(
                    _incomplete_basis_trade(
                        account_id, conid, fill, remaining, fill_qty
                    )
                )
                remaining = 0.0
                continue

            opening = pos_dir == 0 or sign == pos_dir
            if opening:
                if acc is None:
                    acc = _start_acc(account_id, conid, fill, sign)
                    pos_dir = sign
                open_q = remaining
                lots.append({"qty": open_q, "price": price, "multiplier": _fill_multiplier(fill)})
                acc["opened_qty"] += open_q
                acc["entry_notional"] += price * open_q
                acc["entry_cost_basis"] += price * open_q * _fill_multiplier(fill)
                acc["cur_abs_qty"] += open_q
                acc["max_abs_qty"] = max(acc["max_abs_qty"], acc["cur_abs_qty"])
                _alloc_commission(acc, fill, open_q, fill_qty)
                _add_fill(acc, fill)
                remaining = 0.0
            else:
                assert acc is not None
                lot = lots[0]
                close_q = min(remaining, lot["qty"])
                acc["gross_pnl"] += (
                    (price - lot["price"])
                    * close_q
                    * pos_dir
                    * lot["multiplier"]
                )
                acc["closed_qty"] += close_q
                acc["exit_notional"] += price * close_q
                acc["cur_abs_qty"] -= close_q
                acc["last_close_time"] = fill["trade_time"]
                acc["last_close_time_ms"] = int(fill["trade_time_ms"])
                _alloc_commission(acc, fill, close_q, fill_qty)
                _add_fill(acc, fill)

                lot["qty"] -= close_q
                if lot["qty"] <= _EPS:
                    lots.popleft()
                remaining -= close_q

                if not lots:
                    # Position is flat → the round-trip closes here. Any
                    # leftover `remaining` is an over-sell beyond the known
                    # long: the protective guard at the top of the loop turns
                    # it into a Needs-basis remainder (or a proven short if the
                    # fill carries explicit opening-short metadata).
                    pos_dir = 0
                    trades.append(_finalize(acc, status="CLOSED"))
                    acc = None

    if acc is not None:
        trades.append(_finalize(acc, status="OPEN"))

    return trades


def _start_acc(
    account_id: str, conid: int, open_fill: dict[str, Any], direction: int
) -> dict[str, Any]:
    return {
        "account_id": account_id,
        "conid": conid,
        "symbol": open_fill.get("symbol") or "",
        "sec_type": open_fill.get("sec_type"),
        "multiplier": _fill_multiplier(open_fill),
        "dir_sign": direction,
        "open_time": open_fill["trade_time"],
        "open_time_ms": int(open_fill["trade_time_ms"]),
        "first_open_execution_id": str(open_fill["execution_id"]),
        "opened_qty": 0.0,
        "entry_notional": 0.0,
        "entry_cost_basis": 0.0,
        "closed_qty": 0.0,
        "exit_notional": 0.0,
        "gross_pnl": 0.0,
        "commissions": 0.0,
        "max_abs_qty": 0.0,
        "cur_abs_qty": 0.0,
        "last_close_time": None,
        "last_close_time_ms": None,
        "fills": {},  # execution_id → InflectFill (deduped, insertion order)
    }


def _alloc_commission(
    acc: dict[str, Any], fill: dict[str, Any], applied_q: float, fill_qty: float
) -> None:
    """Add this fill's commission, prorated by the quantity applied here."""
    commission = _positive_float(fill.get("commission"))
    if commission is None or fill_qty <= _EPS:
        return
    acc["commissions"] += commission * (applied_q / fill_qty)


def _add_fill(acc: dict[str, Any], fill: dict[str, Any]) -> None:
    """Record a constituent fill (deduped by execution_id)."""
    eid = str(fill["execution_id"])
    if not acc["symbol"] and fill.get("symbol"):
        acc["symbol"] = fill["symbol"]
    if eid in acc["fills"]:
        return
    acc["fills"][eid] = InflectFill(
        execution_id=eid,
        conid=int(fill["conid"]),
        symbol=fill.get("symbol"),
        side=str(fill["side"]).upper(),
        quantity=abs(float(fill["quantity"])),
        price=_fill_price(fill),
        commission=_positive_float(fill.get("commission")),
        net_amount=_to_float(fill.get("net_amount")),
        multiplier=_fill_multiplier(fill),
        sec_type=fill.get("sec_type"),
        trade_time=fill["trade_time"],
        trade_time_ms=_to_int(fill.get("trade_time_ms")),
    )


def _finalize(acc: dict[str, Any], *, status: str) -> InflectTrade:
    opened = acc["opened_qty"]
    qty = acc["max_abs_qty"]
    avg_entry = acc["entry_notional"] / opened if opened > _EPS else 0.0
    fills = sorted(
        acc["fills"].values(),
        key=lambda f: (f.trade_time_ms if f.trade_time_ms is not None else 0),
    )
    direction = "LONG" if acc["dir_sign"] > 0 else "SHORT"
    trade_id = f"{acc['account_id']}:{acc['conid']}:{acc['first_open_execution_id']}"

    if status == "CLOSED":
        closed = acc["closed_qty"]
        avg_exit = acc["exit_notional"] / closed if closed > _EPS else None
        gross_pnl = acc["gross_pnl"]
        commissions = acc["commissions"]
        net_pnl = gross_pnl - commissions
        cost_basis = acc["entry_cost_basis"]
        return_pct = (net_pnl / cost_basis) * 100 if cost_basis else None
        close_time = acc["last_close_time"]
        close_time_ms = acc["last_close_time_ms"]
        hold = (
            int((close_time_ms - acc["open_time_ms"]) / 1000)
            if close_time_ms is not None
            else None
        )
        return InflectTrade(
            trade_id=trade_id,
            account_id=acc["account_id"],
            conid=acc["conid"],
            symbol=acc["symbol"],
            sec_type=acc["sec_type"],
            direction=direction,
            status="CLOSED",
            open_time=acc["open_time"],
            open_time_ms=acc["open_time_ms"],
            close_time=close_time,
            close_time_ms=close_time_ms,
            qty=qty,
            avg_entry=avg_entry,
            avg_exit=avg_exit,
            gross_pnl=gross_pnl,
            commissions=commissions,
            net_pnl=net_pnl,
            return_pct=return_pct,
            multiplier=acc["multiplier"],
            hold_duration_sec=hold,
            r_multiple=None,
            fills=fills,
        )

    # OPEN: no realized P&L, no close fields. Commissions paid so far are
    # surfaced as fact but net P&L stays None (excluded from calendar totals).
    return InflectTrade(
        trade_id=trade_id,
        account_id=acc["account_id"],
        conid=acc["conid"],
        symbol=acc["symbol"],
        sec_type=acc["sec_type"],
        direction=direction,
        status="OPEN",
        open_time=acc["open_time"],
        open_time_ms=acc["open_time_ms"],
        close_time=None,
        close_time_ms=None,
        qty=qty,
        avg_entry=avg_entry,
        avg_exit=None,
        gross_pnl=None,
        commissions=acc["commissions"],
        net_pnl=None,
        return_pct=None,
        multiplier=acc["multiplier"],
        hold_duration_sec=None,
        r_multiple=None,
        fills=fills,
    )


def _incomplete_basis_trade(
    account_id: str,
    conid: int,
    fill: dict[str, Any],
    unmatched_qty: float,
    fill_qty: float,
) -> InflectTrade:
    """A Needs-basis pseudo-trade for `unmatched_qty` shares of a sell that
    has no known long behind it.

    `unmatched_qty` is the portion of the fill that could not be matched: the
    whole fill for a first-seen flat sell, or just the over-sell remainder
    after a long→flat flip. Trade-level commission is prorated to that portion
    (the matched portion's share was already booked on the closing long). The
    embedded `InflectFill` still carries the real execution (full quantity and
    commission) so the detail view shows the true fill.
    """
    full_commission = _positive_float(fill.get("commission"))
    if full_commission is not None and fill_qty > _EPS:
        commission = full_commission * (unmatched_qty / fill_qty)
    else:
        commission = full_commission or 0.0
    fill_model = InflectFill(
        execution_id=str(fill["execution_id"]),
        conid=int(fill["conid"]),
        symbol=fill.get("symbol"),
        side=str(fill["side"]).upper(),
        quantity=abs(float(fill["quantity"])),
        price=_fill_price(fill),
        commission=full_commission,
        net_amount=_to_float(fill.get("net_amount")),
        multiplier=_fill_multiplier(fill),
        sec_type=fill.get("sec_type"),
        trade_time=fill["trade_time"],
        trade_time_ms=_to_int(fill.get("trade_time_ms")),
    )
    return InflectTrade(
        trade_id=f"{account_id}:{conid}:{fill['execution_id']}",
        account_id=account_id,
        conid=conid,
        symbol=fill.get("symbol") or "",
        sec_type=fill.get("sec_type"),
        direction="UNKNOWN",
        status="INCOMPLETE_BASIS",
        open_time=fill["trade_time"],
        open_time_ms=int(fill["trade_time_ms"]),
        close_time=None,
        close_time_ms=None,
        qty=unmatched_qty,
        avg_entry=0.0,
        avg_exit=_fill_price(fill),
        gross_pnl=None,
        commissions=commission,
        net_pnl=None,
        return_pct=None,
        multiplier=_fill_multiplier(fill),
        hold_duration_sec=None,
        r_multiple=None,
        fills=[fill_model],
    )


def _is_explicit_opening_short(fill: dict[str, Any]) -> bool:
    for key in (
        "position_effect",
        "positionEffect",
        "open_close",
        "openClose",
        "open_close_indicator",
        "openCloseIndicator",
    ):
        value = fill.get(key)
        if value is None:
            continue
        normalized = str(value).upper().strip().replace("-", "_").replace(" ", "_")
        if normalized in {"OPEN", "OPENING", "O", "SELL_TO_OPEN", "STO"}:
            return True
    return bool(fill.get("opens_position") or fill.get("is_opening"))


def _fill_price(fill: dict[str, Any]) -> float:
    """Per-unit execution price.

    Prefers the explicit `price` column. Falls back to `net_amount / quantity`
    when price is missing (some IBKR projections only carry net_amount).
    Returns 0.0 if neither is usable — a degenerate fill that cannot move P&L.
    """
    price = _to_float(fill.get("price"))
    if price is not None:
        return price
    net = _to_float(fill.get("net_amount"))
    qty = abs(float(fill["quantity"]))
    if net is not None and qty > _EPS:
        return abs(net) / qty
    return 0.0


def _fill_multiplier(fill: dict[str, Any]) -> float:
    for key in ("multiplier", "contract_multiplier", "contractMultiplier"):
        multiplier = _to_float(fill.get(key))
        if multiplier is not None and multiplier > 0:
            return multiplier
    if str(fill.get("sec_type") or "").upper() == "OPT":
        return 100.0
    return 1.0


def _positive_float(value: Any) -> Optional[float]:
    parsed = _to_float(value)
    return abs(parsed) if parsed is not None else None


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
