"""
Public-boundary test for GET /execution-assistant/reconciliation.

Critical promise: Orbit does not silently claim orders it did not create —
unmanaged orders must be correctly identified and surfaced at the API boundary.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_tws_adapter
from routers.execution_assistant import router as ea_router
from models.tws_execution_assistant import (
    OrderSnapshot,
    PositionSnapshot,
    ReconciliationSnapshot,
)


class _AdapterStub:
    def get_reconciliation(self) -> ReconciliationSnapshot:
        return ReconciliationSnapshot(
            position_count=1,
            open_order_count=2,
            unmanaged_order_count=1,
            positions=[
                PositionSnapshot(conid=265598, symbol="AAPL", position=10.0, avg_cost=150.0),
            ],
            open_orders=[
                OrderSnapshot(
                    order_id=1,
                    conid=265598,
                    symbol="AAPL",
                    side="BUY",
                    quantity=5.0,
                    order_type="LMT",
                    lmt_price=180.0,
                    status="Submitted",
                    is_unmanaged=False,
                ),
                OrderSnapshot(
                    order_id=2,
                    conid=265598,
                    symbol="AAPL",
                    side="SELL",
                    quantity=3.0,
                    order_type="MKT",
                    lmt_price=None,
                    status="Submitted",
                    is_unmanaged=True,
                ),
            ],
        )


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(ea_router)
    app.dependency_overrides[get_tws_adapter] = lambda: _AdapterStub()
    return TestClient(app)


def test_reconciliation_returns_positions_and_orders():
    r = _client().get("/execution-assistant/reconciliation")
    assert r.status_code == 200
    body = r.json()
    assert body["position_count"] == 1
    assert body["open_order_count"] == 2
    assert len(body["positions"]) == 1
    assert len(body["open_orders"]) == 2


def test_unmanaged_orders_are_flagged():
    """Orders not created by Orbit must be marked is_unmanaged=true."""
    r = _client().get("/execution-assistant/reconciliation")
    orders = r.json()["open_orders"]
    unmanaged = [o for o in orders if o["is_unmanaged"]]
    managed = [o for o in orders if not o["is_unmanaged"]]
    assert len(unmanaged) == 1
    assert len(managed) == 1
    assert r.json()["unmanaged_order_count"] == 1


def test_lmt_price_is_null_for_market_orders():
    r = _client().get("/execution-assistant/reconciliation")
    mkt_order = next(o for o in r.json()["open_orders"] if o["order_type"] == "MKT")
    assert mkt_order["lmt_price"] is None
