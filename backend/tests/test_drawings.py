"""
Tests for the chart_drawings CRUD — both the DB layer and the router.

DB layer:  TestDrawingsDB    — real in-memory SQLite (no mocks)
Router:    TestDrawingsCRUD  — FastAPI TestClient with mocked DB

Refs: Branch 1 of docs/drawing-tools-plan.md
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_db
from routers.drawings import router
from services.db import DatabaseService


# ═══════════════════════════════════════════════════════════════
#  DB Layer Tests
# ═══════════════════════════════════════════════════════════════


@pytest.fixture()
def db():
    """
    Fresh in-memory DatabaseService with tables created.
    Destroyed at end of test — zero persistence between tests.
    """
    svc = DatabaseService(db_path=":memory:")
    svc._conn = svc._connect()
    svc._create_tables()
    return svc


@pytest.fixture()
def sample_anchors() -> str:
    return json.dumps([{"time": 1700000000, "price": 175.5}])


@pytest.fixture()
def sample_style() -> str:
    return json.dumps({"line_color": "#2962FF", "line_width": 2})


class TestDrawingsDB:
    """Full round-trip tests against a real in-memory database."""

    @pytest.mark.asyncio
    async def test_save_and_get_drawing(self, db: DatabaseService, sample_anchors: str):
        drawing_id = await db.save_drawing(
            conid=12345,
            kind="horizontal_line",
            anchors_json=sample_anchors,
        )
        assert drawing_id > 0

        row = await db.get_drawing(drawing_id)
        assert row is not None
        assert row["conid"] == 12345
        assert row["kind"] == "horizontal_line"
        assert row["anchors_json"] == sample_anchors
        assert row["style_json"] is None
        assert row["created_at"] is not None
        assert row["updated_at"] is None

    @pytest.mark.asyncio
    async def test_list_drawings_scoped_to_conid(
        self, db: DatabaseService, sample_anchors: str
    ):
        """Drawings for conid A must NOT appear in a list for conid B."""
        await db.save_drawing(conid=111, kind="horizontal_line", anchors_json=sample_anchors)
        await db.save_drawing(conid=111, kind="trend_line", anchors_json=sample_anchors)
        await db.save_drawing(conid=999, kind="ray", anchors_json=sample_anchors)

        rows_111 = await db.list_drawings(111)
        assert len(rows_111) == 2
        assert all(r["conid"] == 111 for r in rows_111)

        rows_999 = await db.list_drawings(999)
        assert len(rows_999) == 1
        assert rows_999[0]["kind"] == "ray"

    @pytest.mark.asyncio
    async def test_update_anchors_only(self, db: DatabaseService, sample_anchors: str):
        """Updating anchors must leave style intact."""
        drawing_id = await db.save_drawing(
            conid=12345,
            kind="trend_line",
            anchors_json=sample_anchors,
            style_json='{"line_color": "#ff0000"}',
        )

        new_anchors = json.dumps([
            {"time": 1700000000, "price": 175.5},
            {"time": 1700086400, "price": 180.0},
        ])
        ok = await db.update_drawing(drawing_id, anchors_json=new_anchors)
        assert ok is True

        row = await db.get_drawing(drawing_id)
        assert row is not None
        assert json.loads(row["anchors_json"]) == json.loads(new_anchors)
        assert row["style_json"] == '{"line_color": "#ff0000"}'  # untouched

    @pytest.mark.asyncio
    async def test_update_style_only(self, db: DatabaseService, sample_anchors: str):
        """Updating style must leave anchors intact."""
        drawing_id = await db.save_drawing(
            conid=12345,
            kind="rectangle",
            anchors_json=sample_anchors,
        )

        new_style = json.dumps({"line_color": "#00ff00", "line_width": 3})
        ok = await db.update_drawing(drawing_id, style_json=new_style)
        assert ok is True

        row = await db.get_drawing(drawing_id)
        assert row is not None
        assert row["anchors_json"] == sample_anchors  # untouched
        assert json.loads(row["style_json"]) == json.loads(new_style)
        assert row["updated_at"] is not None

    @pytest.mark.asyncio
    async def test_delete_drawing(self, db: DatabaseService, sample_anchors: str):
        drawing_id = await db.save_drawing(
            conid=12345,
            kind="vertical_line",
            anchors_json=sample_anchors,
        )
        deleted = await db.delete_drawing(drawing_id)
        assert deleted is True
        assert await db.get_drawing(drawing_id) is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_drawing(self, db: DatabaseService):
        deleted = await db.delete_drawing(999999)
        assert deleted is False


# ═══════════════════════════════════════════════════════════════
#  Router Tests (TestClient + mocked DB)
# ═══════════════════════════════════════════════════════════════


def _make_db_row(
    drawing_id: int = 1,
    conid: int = 12345,
    kind: str = "horizontal_line",
    anchors: list | None = None,
    style: dict | None = None,
) -> dict:
    """Build a DB-shaped dict as DatabaseService.get_drawing would return."""
    return {
        "id": drawing_id,
        "conid": conid,
        "kind": kind,
        "anchors_json": json.dumps(anchors or [{"time": 1700000000, "price": 175.5}]),
        "style_json": json.dumps(style) if style else None,
        "created_at": "2026-01-01 12:00:00",
        "updated_at": None,
    }


@pytest.fixture()
def app_and_db():
    """FastAPI test app with a fully-mocked DatabaseService."""
    app = FastAPI()
    app.include_router(router)

    db = MagicMock()
    db.save_drawing = AsyncMock(return_value=1)
    db.get_drawing = AsyncMock(return_value=_make_db_row())
    db.update_drawing = AsyncMock(return_value=True)
    db.delete_drawing = AsyncMock(return_value=True)
    db.list_drawings = AsyncMock(return_value=[_make_db_row()])

    app.dependency_overrides[get_db] = lambda: db
    return app, db


class TestDrawingsCRUD:
    """Router-level HTTP tests. DB is mocked; we test routing + serialisation."""

    def test_post_drawing_persists(self, app_and_db):
        """POST then GET round-trip — response contains the saved fields."""
        app, _ = app_and_db
        client = TestClient(app)

        payload = {
            "conid": 12345,
            "kind": "horizontal_line",
            "anchors": [{"time": 1700000000, "price": 175.5}],
        }
        r = client.post("/drawings", json=payload)
        assert r.status_code == 201
        data = r.json()
        assert data["conid"] == 12345
        assert data["kind"] == "horizontal_line"
        assert len(data["anchors"]) == 1
        assert data["anchors"][0]["price"] == 175.5
        assert "id" in data

    def test_put_drawing_partial_update_anchors_only(self, app_and_db):
        """PUT with only anchors leaves style unchanged (router honours partial)."""
        app, db = app_and_db
        client = TestClient(app)

        new_anchors = [
            {"time": 1700000000, "price": 175.5},
            {"time": 1700086400, "price": 180.0},
        ]
        db.get_drawing = AsyncMock(return_value=_make_db_row(
            anchors=new_anchors,
            style={"line_color": "#ff0000"},
        ))

        r = client.put("/drawings/1", json={"anchors": new_anchors})
        assert r.status_code == 200
        data = r.json()
        assert len(data["anchors"]) == 2
        # style persisted via DB stub
        assert data["style"]["line_color"] == "#ff0000"

    def test_put_drawing_partial_update_style_only(self, app_and_db):
        """PUT with only style leaves anchors unchanged."""
        app, db = app_and_db
        client = TestClient(app)

        db.get_drawing = AsyncMock(return_value=_make_db_row(
            style={"line_color": "#00ff00", "line_width": 3},
        ))

        r = client.put("/drawings/1", json={"style": {"line_color": "#00ff00", "line_width": 3}})
        assert r.status_code == 200
        data = r.json()
        assert data["style"]["line_color"] == "#00ff00"
        # anchors from stub — still 1 anchor
        assert len(data["anchors"]) == 1

    def test_delete_drawing_returns_404_when_missing(self, app_and_db):
        """DELETE a non-existent id returns 404 and the correct error body."""
        app, db = app_and_db
        db.delete_drawing = AsyncMock(return_value=False)

        client = TestClient(app)
        r = client.delete("/drawings/999")
        assert r.status_code == 404
        assert "999" in r.json()["detail"]

    def test_list_drawings_scoped_to_conid(self, app_and_db):
        """GET /drawings/{conid} returns only drawings for that conid."""
        app, db = app_and_db
        db.list_drawings = AsyncMock(return_value=[
            _make_db_row(drawing_id=1, conid=12345),
            _make_db_row(drawing_id=2, conid=12345, kind="trend_line"),
        ])

        client = TestClient(app)
        r = client.get("/drawings/12345")
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 2
        assert all(d["conid"] == 12345 for d in data)

    def test_post_drawing_rejects_empty_anchors(self, app_and_db):
        """POST with anchors=[] must return 422 with an actionable error message."""
        app, _ = app_and_db
        client = TestClient(app)

        r = client.post("/drawings", json={
            "conid": 12345,
            "kind": "horizontal_line",
            "anchors": [],
        })
        assert r.status_code == 422
        assert "anchors" in r.json()["detail"].lower()

    def test_post_drawing_rejects_invalid_line_width(self, app_and_db):
        """POST with line_width outside [1..4] must return 422."""
        app, _ = app_and_db
        client = TestClient(app)

        r = client.post("/drawings", json={
            "conid": 12345,
            "kind": "horizontal_line",
            "anchors": [{"time": 1700000000, "price": 175.5}],
            "style": {"line_width": 10},
        })
        assert r.status_code == 422
        assert "line_width" in r.json()["detail"].lower()
