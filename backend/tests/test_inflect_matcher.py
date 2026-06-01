"""Unit tests for the FIFO round-trip matcher (spec §5).

The matcher is a pure transform from fill rows → InflectTrades, so these tests
build fill dicts directly (no DB) and assert on derived fields: direction,
status, qty, avg entry/exit, gross/net P&L, commission allocation, hold time,
and the stable trade_id.
"""

import pytest

from services.inflect.matcher import match_fills


def _fill(
    execution_id,
    side,
    quantity,
    price,
    *,
    conid=265598,
    account_id="DU1",
    commission=0.0,
    trade_time_ms=None,
    symbol="AAPL",
    sec_type="STK",
):
    return {
        "execution_id": execution_id,
        "account_id": account_id,
        "conid": conid,
        "symbol": symbol,
        "side": side,
        "quantity": quantity,
        "price": price,
        "net_amount": price * quantity,
        "commission": commission,
        "sec_type": sec_type,
        "trade_time": f"t{trade_time_ms}",
        "trade_time_ms": trade_time_ms,
    }


def test_simple_long_round_trip():
    """Buy 100 @ 10, sell 100 @ 12 → +200 gross, net of commissions."""
    fills = [
        _fill("e1", "BUY", 100, 10.0, commission=1.0, trade_time_ms=1_000),
        _fill("e2", "SELL", 100, 12.0, commission=1.0, trade_time_ms=5_000),
    ]
    trades = match_fills(fills)
    assert len(trades) == 1
    t = trades[0]
    assert t.trade_id == "DU1:265598:e1"
    assert t.direction == "LONG"
    assert t.status == "CLOSED"
    assert t.qty == 100
    assert t.avg_entry == 10.0
    assert t.avg_exit == 12.0
    assert t.gross_pnl == pytest.approx(200.0)
    assert t.commissions == pytest.approx(2.0)
    assert t.net_pnl == pytest.approx(198.0)
    assert t.hold_duration_sec == 4  # (5000 - 1000) ms
    assert t.r_multiple is None
    assert len(t.fills) == 2


def test_simple_short_round_trip():
    """Sell-to-open 50 @ 20, buy-to-close 50 @ 18 → +100 gross for a short."""
    fills = [
        _fill("s1", "SELL", 50, 20.0, trade_time_ms=1_000),
        _fill("s2", "BUY", 50, 18.0, trade_time_ms=2_000),
    ]
    trades = match_fills(fills)
    assert len(trades) == 1
    t = trades[0]
    assert t.direction == "SHORT"
    assert t.status == "CLOSED"
    assert t.gross_pnl == pytest.approx(100.0)
    assert t.net_pnl == pytest.approx(100.0)
    assert t.avg_entry == 20.0
    assert t.avg_exit == 18.0


def test_scale_in_then_full_exit_is_one_trade():
    """Buy 100 then 100 (avg 11), sell 200 @ 15 stays a single trade."""
    fills = [
        _fill("a", "BUY", 100, 10.0, trade_time_ms=1_000),
        _fill("b", "BUY", 100, 12.0, trade_time_ms=2_000),
        _fill("c", "SELL", 200, 15.0, trade_time_ms=3_000),
    ]
    trades = match_fills(fills)
    assert len(trades) == 1
    t = trades[0]
    assert t.qty == 200
    assert t.avg_entry == pytest.approx(11.0)
    assert t.avg_exit == pytest.approx(15.0)
    # (15-10)*100 + (15-12)*100 = 500 + 300 = 800
    assert t.gross_pnl == pytest.approx(800.0)


def test_scale_out_partial_then_flat_is_one_trade():
    """Buy 200, sell 100, sell 100 — one trade closing on the final flatten."""
    fills = [
        _fill("a", "BUY", 200, 10.0, trade_time_ms=1_000),
        _fill("b", "SELL", 100, 11.0, trade_time_ms=2_000),
        _fill("c", "SELL", 100, 13.0, trade_time_ms=4_000),
    ]
    trades = match_fills(fills)
    assert len(trades) == 1
    t = trades[0]
    assert t.qty == 200
    # (11-10)*100 + (13-10)*100 = 100 + 300 = 400
    assert t.gross_pnl == pytest.approx(400.0)
    assert t.close_time_ms == 4_000
    assert t.hold_duration_sec == 3


def test_still_open_position_is_open_trade():
    """A position that never flattens is reported OPEN with no P&L."""
    fills = [
        _fill("a", "BUY", 100, 10.0, trade_time_ms=1_000),
        _fill("b", "SELL", 40, 12.0, trade_time_ms=2_000),
    ]
    trades = match_fills(fills)
    assert len(trades) == 1
    t = trades[0]
    assert t.status == "OPEN"
    assert t.net_pnl is None
    assert t.gross_pnl is None
    assert t.avg_exit is None
    assert t.close_time is None
    assert t.qty == 100  # max abs size reached


def test_two_sequential_round_trips_same_conid():
    """Open→flat→open→flat produces two distinct trades, keyed by their opens."""
    fills = [
        _fill("o1", "BUY", 10, 10.0, trade_time_ms=1_000),
        _fill("c1", "SELL", 10, 11.0, trade_time_ms=2_000),
        _fill("o2", "BUY", 10, 20.0, trade_time_ms=3_000),
        _fill("c2", "SELL", 10, 22.0, trade_time_ms=4_000),
    ]
    trades = match_fills(fills)
    assert [t.trade_id for t in trades] == ["DU1:265598:o1", "DU1:265598:o2"]
    assert trades[0].gross_pnl == pytest.approx(10.0)
    assert trades[1].gross_pnl == pytest.approx(20.0)


def test_flip_long_to_short_splits_into_two_trades():
    """Buy 100, then sell 150: closes the long (50 left over opens a short)."""
    fills = [
        _fill("a", "BUY", 100, 10.0, commission=2.0, trade_time_ms=1_000),
        _fill("b", "SELL", 150, 12.0, commission=3.0, trade_time_ms=2_000),
        _fill("c", "BUY", 50, 11.0, commission=1.0, trade_time_ms=3_000),
    ]
    trades = match_fills(fills)
    assert len(trades) == 2

    long_trade, short_trade = trades
    assert long_trade.direction == "LONG"
    assert long_trade.status == "CLOSED"
    assert long_trade.qty == 100
    assert long_trade.gross_pnl == pytest.approx(200.0)  # (12-10)*100
    # Closing fill b's commission (3.0 over 150qty) is prorated: 100/150 → 2.0
    assert long_trade.commissions == pytest.approx(2.0 + 2.0)

    assert short_trade.direction == "SHORT"
    assert short_trade.status == "CLOSED"
    assert short_trade.qty == 50
    assert short_trade.gross_pnl == pytest.approx(50.0)  # (12-11)*50 short
    # 50/150 of b's 3.0 commission (=1.0) + c's full 1.0
    assert short_trade.commissions == pytest.approx(1.0 + 1.0)


def test_return_pct_is_net_over_cost_basis():
    """return_pct = net P&L / (avg_entry * qty) * 100."""
    fills = [
        _fill("a", "BUY", 100, 10.0, trade_time_ms=1_000),
        _fill("b", "SELL", 100, 11.0, trade_time_ms=2_000),
    ]
    t = match_fills(fills)[0]
    # net 100 over cost 1000 = 10%
    assert t.return_pct == pytest.approx(10.0)


def test_multiple_conids_are_matched_independently():
    """Fills for different conids never net against each other."""
    fills = [
        _fill("a", "BUY", 1, 10.0, conid=1, trade_time_ms=1_000),
        _fill("x", "BUY", 1, 50.0, conid=2, trade_time_ms=1_500),
        _fill("b", "SELL", 1, 12.0, conid=1, trade_time_ms=2_000),
        _fill("y", "SELL", 1, 55.0, conid=2, trade_time_ms=2_500),
    ]
    trades = match_fills(fills)
    by_conid = {t.conid: t for t in trades}
    assert by_conid[1].gross_pnl == pytest.approx(2.0)
    assert by_conid[2].gross_pnl == pytest.approx(5.0)


def test_single_leg_option_round_trip():
    """Options ride the same matcher via sec_type/conid (spec D8)."""
    fills = [
        _fill(
            "o1", "BUY", 2, 1.50, conid=999, sec_type="OPT",
            symbol="AAPL  260101C00200000", commission=1.30, trade_time_ms=1_000,
        ),
        _fill(
            "o2", "SELL", 2, 2.50, conid=999, sec_type="OPT",
            symbol="AAPL  260101C00200000", commission=1.30, trade_time_ms=2_000,
        ),
    ]
    t = match_fills(fills)[0]
    assert t.sec_type == "OPT"
    assert t.gross_pnl == pytest.approx(2.0)  # (2.50-1.50)*2
    assert t.net_pnl == pytest.approx(2.0 - 2.60)


def test_fills_without_trade_time_ms_are_skipped():
    """Unplaceable fills (no timestamp) don't produce trades."""
    fills = [_fill("a", "BUY", 1, 10.0, trade_time_ms=None)]
    assert match_fills(fills) == []


def test_empty_input():
    assert match_fills([]) == []
