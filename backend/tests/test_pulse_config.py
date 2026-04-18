"""
Tests for the pulse-config router (Phase 8.9+).

Covers:
  - GET  /pulse-config        — returns the stored list in display order
  - PUT  /pulse-config        — replaces the list atomically
  - PUT  /pulse-config        — rejects duplicate labels
  - PUT  /pulse-config        — rejects payloads over MAX_ITEMS
  - POST /pulse-config/reset  — restores DEFAULT_PULSE_ITEMS
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_db
from routers.pulse_config import router, MAX_ITEMS


def _rows(*pairs: tuple[str, str]) -> list[dict]:
    """Shorthand: build DB-shaped rows from (label, resolve) pairs."""
    return [
        {"position": i, "label": label, "resolve": resolve}
        for i, (label, resolve) in enumerate(pairs)
    ]


@pytest.fixture
def app_and_db():
    app = FastAPI()
    app.include_router(router)

    db = MagicMock()
    db.get_pulse_config = AsyncMock(return_value=_rows(("SPY", "SPY"), ("QQQ", "QQQ")))
    db.replace_pulse_config = AsyncMock(return_value=None)
    db.reset_pulse_config = AsyncMock(return_value=_rows(("SPX", "SPX")))

    app.dependency_overrides[get_db] = lambda: db
    return app, db


def test_get_returns_items_in_order(app_and_db):
    app, _ = app_and_db
    client = TestClient(app)
    r = client.get("/pulse-config")
    assert r.status_code == 200
    data = r.json()
    assert data == {
        "items": [
            {"label": "SPY", "resolve": "SPY"},
            {"label": "QQQ", "resolve": "QQQ"},
        ]
    }


def test_put_replaces_list(app_and_db):
    app, db = app_and_db
    # After the write, GET returns the new list
    db.get_pulse_config = AsyncMock(
        return_value=_rows(("SPY", "SPY"), ("IWM", "IWM"), ("GLD", "GLD"))
    )

    client = TestClient(app)
    r = client.put(
        "/pulse-config",
        json={
            "items": [
                {"label": "SPY", "resolve": "SPY"},
                {"label": "IWM", "resolve": "IWM"},
                {"label": "GLD", "resolve": "GLD"},
            ]
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert [i["label"] for i in data["items"]] == ["SPY", "IWM", "GLD"]
    db.replace_pulse_config.assert_awaited_once_with(
        [("SPY", "SPY"), ("IWM", "IWM"), ("GLD", "GLD")]
    )


def test_put_rejects_duplicate_labels(app_and_db):
    """Two rows with the same label would run the same IBKR queries twice."""
    app, db = app_and_db
    client = TestClient(app)
    r = client.put(
        "/pulse-config",
        json={
            "items": [
                {"label": "SPY", "resolve": "SPY"},
                {"label": "SPY", "resolve": "SPY"},
            ]
        },
    )
    assert r.status_code == 400
    db.replace_pulse_config.assert_not_awaited()


def test_put_rejects_empty_label(app_and_db):
    """Blank labels are nonsensical on the bar; min_length=1 catches this."""
    app, db = app_and_db
    client = TestClient(app)
    r = client.put(
        "/pulse-config",
        json={"items": [{"label": "", "resolve": "SPY"}]},
    )
    assert r.status_code == 422
    db.replace_pulse_config.assert_not_awaited()


def test_put_rejects_too_many_items(app_and_db):
    """Guardrail: stops users from hammering IBKR with dozens of tickers."""
    app, db = app_and_db
    client = TestClient(app)
    items = [
        {"label": f"T{i}", "resolve": f"T{i}"}
        for i in range(MAX_ITEMS + 1)
    ]
    r = client.put("/pulse-config", json={"items": items})
    assert r.status_code == 422
    db.replace_pulse_config.assert_not_awaited()


def test_put_allows_empty_list(app_and_db):
    """An empty list hides the bar — a legitimate state, not an error."""
    app, db = app_and_db
    db.get_pulse_config = AsyncMock(return_value=[])

    client = TestClient(app)
    r = client.put("/pulse-config", json={"items": []})
    assert r.status_code == 200
    assert r.json() == {"items": []}
    db.replace_pulse_config.assert_awaited_once_with([])


def test_reset_returns_defaults(app_and_db):
    app, db = app_and_db
    client = TestClient(app)
    r = client.post("/pulse-config/reset")
    assert r.status_code == 200
    data = r.json()
    assert data == {"items": [{"label": "SPX", "resolve": "SPX"}]}
    db.reset_pulse_config.assert_awaited_once()
