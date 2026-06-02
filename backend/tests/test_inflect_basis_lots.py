from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.inflect import get_inflect_service, require_inflect_service, router
from services.db import DatabaseService
from services.inflect.service import InflectService


class _FakeMoon:
    async def _resolve_account_id(self, account_id):
        return account_id or "DU1"


def _memory_db() -> DatabaseService:
    db = DatabaseService(db_path=":memory:")
    db._conn = db._connect()
    db._create_tables()
    db._migrate()
    return db


def _service() -> InflectService:
    return InflectService(
        ibkr=SimpleNamespace(),
        db=_memory_db(),
        moonmarket=_FakeMoon(),
    )


def _client(service: InflectService) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_inflect_service] = lambda: service
    app.dependency_overrides[require_inflect_service] = lambda: service
    return TestClient(app)


@pytest.mark.asyncio
async def test_db_basis_lots_crud_round_trip():
    db = _memory_db()

    created = await db.create_basis_lot(
        account_id="DU1",
        conid=265598,
        side="LONG",
        quantity=10,
        entry_date="2026-05-01",
        entry_price=180.25,
        commission=1.5,
        note="opening lot",
    )

    assert created["id"] > 0
    assert created["account_id"] == "DU1"
    assert created["conid"] == 265598
    assert created["side"] == "LONG"
    assert created["quantity"] == 10.0
    assert created["entry_date"] == "2026-05-01"
    assert created["entry_price"] == 180.25
    assert created["commission"] == 1.5
    assert created["note"] == "opening lot"

    assert await db.list_basis_lots("DU1", 999) == []
    listed = await db.list_basis_lots("DU1", 265598)
    assert [lot["id"] for lot in listed] == [created["id"]]

    updated = await db.update_basis_lot(
        lot_id=created["id"],
        account_id="DU1",
        conid=265598,
        side="SHORT",
        quantity=5,
        entry_date="2026-05-02",
        entry_price=181,
        commission=None,
        note=None,
    )
    assert updated is not None
    assert updated["side"] == "SHORT"
    assert updated["quantity"] == 5.0
    assert updated["entry_date"] == "2026-05-02"
    assert updated["entry_price"] == 181.0
    assert updated["commission"] is None
    assert updated["note"] is None

    assert await db.update_basis_lot(
        lot_id=created["id"],
        account_id="DU2",
        conid=265598,
        side="LONG",
        quantity=1,
        entry_date="2026-05-03",
        entry_price=1,
        commission=None,
        note=None,
    ) is None

    assert await db.delete_basis_lot(created["id"], "DU2") is False
    assert await db.delete_basis_lot(created["id"], "DU1") is True
    assert await db.list_basis_lots("DU1", 265598) == []


def test_basis_lot_router_crud_round_trip():
    service = _service()
    client = _client(service)

    create = client.post(
        "/inflect/basis-lots?account_id=DU1",
        json={
            "conid": 265598,
            "side": "LONG",
            "quantity": 10,
            "entry_date": "2026-05-01",
            "entry_price": 180.25,
            "commission": 1.5,
            "note": "opening lot",
        },
    )
    assert create.status_code == 200
    lot = create.json()
    assert lot["id"] > 0
    assert lot["account_id"] == "DU1"

    listed = client.get("/inflect/basis-lots?account_id=DU1&conid=265598")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [lot["id"]]

    update = client.put(
        f"/inflect/basis-lots/{lot['id']}?account_id=DU1",
        json={
            "conid": 265598,
            "side": "SHORT",
            "quantity": 5,
            "entry_date": "2026-05-02",
            "entry_price": 181,
            "commission": None,
            "note": None,
        },
    )
    assert update.status_code == 200
    assert update.json()["side"] == "SHORT"
    assert update.json()["commission"] is None

    missing = client.put(
        f"/inflect/basis-lots/{lot['id']}?account_id=DU2",
        json={
            "conid": 265598,
            "side": "LONG",
            "quantity": 1,
            "entry_date": "2026-05-03",
            "entry_price": 1,
        },
    )
    assert missing.status_code == 404
    assert missing.json()["detail"]["error"] == "inflect_basis_lot_not_found"

    delete = client.delete(f"/inflect/basis-lots/{lot['id']}?account_id=DU1")
    assert delete.status_code == 200
    assert delete.json() == {"deleted": True}
    assert client.get("/inflect/basis-lots?account_id=DU1&conid=265598").json() == []


@pytest.mark.parametrize(
    "payload",
    [
        {
            "conid": 265598,
            "side": "BUY",
            "quantity": 10,
            "entry_date": "2026-05-01",
            "entry_price": 180.25,
        },
        {
            "conid": 265598,
            "side": "LONG",
            "quantity": 0,
            "entry_date": "2026-05-01",
            "entry_price": 180.25,
        },
        {
            "conid": 265598,
            "side": "LONG",
            "quantity": 10,
            "entry_date": "2026-05-01T09:30:00",
            "entry_price": 180.25,
        },
        {
            "conid": 265598,
            "side": "LONG",
            "quantity": 10,
            "entry_date": "2026-05-01",
            "entry_price": 0,
        },
        {
            "conid": 265598,
            "side": "LONG",
            "quantity": 10,
            "entry_date": "2026-05-01",
            "entry_price": 180.25,
            "commission": -0.01,
        },
    ],
)
def test_basis_lot_router_rejects_bad_input(payload):
    resp = _client(_service()).post(
        "/inflect/basis-lots?account_id=DU1",
        json=payload,
    )

    assert resp.status_code == 422
