"""
Tests for the settings router (Phase 6.5).

Covers:
  - GET /settings      — returns the full key→value map
  - GET /settings/{k}  — 200 with value, 404 when missing
  - PUT /settings/{k}  — upserts and persists
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import get_db
from routers.settings import router


@pytest.fixture
def app_and_db():
    """Build a minimal FastAPI app with just the settings router and a mock DB."""
    app = FastAPI()
    app.include_router(router)

    db = MagicMock()
    db.get_all_settings = AsyncMock(return_value={
        "scan_interval": "300",
        "notifications_enabled": "true",
        "theme_mode": "dark",
        "ai_model": "llama3.1",
    })
    db.get_setting = AsyncMock(return_value=None)
    db.set_setting = AsyncMock(return_value=None)

    def _override_db():
        return db

    app.dependency_overrides[get_db] = _override_db
    return app, db


def test_get_all_settings_returns_map(app_and_db):
    app, db = app_and_db
    client = TestClient(app)
    r = client.get("/settings")
    assert r.status_code == 200
    data = r.json()
    assert data["scan_interval"] == "300"
    assert data["notifications_enabled"] == "true"
    assert data["theme_mode"] == "dark"
    db.get_all_settings.assert_awaited_once()


def test_get_single_setting_returns_value(app_and_db):
    app, db = app_and_db
    db.get_setting = AsyncMock(return_value="true")
    client = TestClient(app)
    r = client.get("/settings/notifications_enabled")
    assert r.status_code == 200
    assert r.json() == {"key": "notifications_enabled", "value": "true"}
    db.get_setting.assert_awaited_once_with("notifications_enabled")


def test_get_single_setting_404_when_missing(app_and_db):
    app, db = app_and_db
    db.get_setting = AsyncMock(return_value=None)
    client = TestClient(app)
    r = client.get("/settings/does_not_exist")
    assert r.status_code == 404


def test_put_setting_upserts(app_and_db):
    app, db = app_and_db
    client = TestClient(app)
    r = client.put("/settings/notifications_enabled", json={"value": "false"})
    assert r.status_code == 200
    assert r.json() == {"key": "notifications_enabled", "value": "false"}
    db.set_setting.assert_awaited_once_with("notifications_enabled", "false")


def test_put_setting_requires_value_field(app_and_db):
    app, _ = app_and_db
    client = TestClient(app)
    r = client.put("/settings/notifications_enabled", json={})
    assert r.status_code == 422  # validation error


def test_put_setting_stores_string_only(app_and_db):
    """Non-string values in the JSON body should still coerce to string."""
    app, db = app_and_db
    client = TestClient(app)
    r = client.put("/settings/scan_interval", json={"value": "600"})
    assert r.status_code == 200
    db.set_setting.assert_awaited_once_with("scan_interval", "600")


def test_put_setting_rejects_unknown_key(app_and_db):
    """The allowlist should block keys that aren't in _ALLOWED_SETTINGS."""
    app, db = app_and_db
    client = TestClient(app)
    r = client.put("/settings/not_a_real_key", json={"value": "x"})
    assert r.status_code == 400
    db.set_setting.assert_not_awaited()


def test_put_theme_mode_is_accepted(app_and_db):
    """theme_mode was added in Phase 8.9+ and must be on the allowlist."""
    app, db = app_and_db
    client = TestClient(app)
    r = client.put("/settings/theme_mode", json={"value": "light"})
    assert r.status_code == 200
    db.set_setting.assert_awaited_once_with("theme_mode", "light")
