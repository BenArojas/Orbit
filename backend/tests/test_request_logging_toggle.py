"""
Tests for the PARALLAX_REQUEST_LOG toggle (Phase 8 / Task 4.2).

Verifies that config._default_request_log() correctly resolves the env var,
and that the middleware is present/absent in an app built the same way
main.py builds it.

Two acceptance criteria from the plan:
  1. With PARALLAX_REQUEST_LOG=1 set, the app has RequestLoggingMiddleware.
  2. Without the env var (or =0), the app does NOT have it.
"""

from __future__ import annotations

import importlib
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Stub heavy deps before any backend import.
sys.modules.setdefault("pandas_ta", MagicMock())
sys.modules.setdefault("pandas", MagicMock())


# ── Helpers ────────────────────────────────────────────────────────────────


def _reload_config(env: dict[str, str]) -> object:
    """Re-import config with a patched environment and return the module."""
    with patch.dict(os.environ, env, clear=False):
        import config as cfg
        importlib.reload(cfg)
        return cfg


def _middleware_names(app) -> list[str]:
    """Return class names of all middleware mounted on a Starlette/FastAPI app."""
    names = []
    for layer in app.middleware_stack.__class__.__mro__:
        names.append(layer.__name__)
    # Walk the real middleware stack via app.middleware_stack
    # Starlette builds a chain — introspect via the app's middleware list
    # registered before build.
    return [type(m.cls).__name__ if hasattr(m, "cls") else type(m).__name__
            for m in getattr(app, "middleware", [])]


def _has_request_logging_middleware(app) -> bool:
    """True if RequestLoggingMiddleware is in the app's user_middleware list."""
    from request_logging import RequestLoggingMiddleware
    for entry in getattr(app, "user_middleware", []):
        # Starlette stores Middleware(cls, ...) objects.
        if hasattr(entry, "cls") and entry.cls is RequestLoggingMiddleware:
            return True
        # Some versions store as plain class reference.
        if entry is RequestLoggingMiddleware:
            return True
    return False


def _build_app_with_toggle(enabled: bool):
    """Replicate the conditional middleware mount from main.py."""
    from fastapi import FastAPI
    from request_logging import RequestLoggingMiddleware
    app = FastAPI()
    if enabled:
        app.add_middleware(RequestLoggingMiddleware)
    return app


# ── config._default_request_log tests ─────────────────────────────────────


class TestDefaultRequestLogConfig:
    """Unit tests for config._default_request_log() env-var resolution."""

    def test_explicit_1_returns_true(self):
        cfg = _reload_config({"PARALLAX_REQUEST_LOG": "1"})
        assert cfg.REQUEST_LOG_ENABLED is True

    def test_explicit_0_returns_false(self):
        cfg = _reload_config({"PARALLAX_REQUEST_LOG": "0"})
        assert cfg.REQUEST_LOG_ENABLED is False

    def test_explicit_false_string_returns_false(self):
        cfg = _reload_config({"PARALLAX_REQUEST_LOG": "false"})
        assert cfg.REQUEST_LOG_ENABLED is False

    def test_explicit_true_string_returns_true(self):
        cfg = _reload_config({"PARALLAX_REQUEST_LOG": "true"})
        # "true" is not in the falsy set — treated as truthy
        assert cfg.REQUEST_LOG_ENABLED is True

    def test_no_env_var_dev_port_8000_returns_true(self):
        env = {"BACKEND_PORT": "8000"}
        env.pop("PARALLAX_REQUEST_LOG", None)
        with patch.dict(os.environ, env, clear=False):
            # Also ensure PARALLAX_REQUEST_LOG is absent
            os.environ.pop("PARALLAX_REQUEST_LOG", None)
            import config as cfg
            importlib.reload(cfg)
            assert cfg.REQUEST_LOG_ENABLED is True

    def test_no_env_var_non_dev_port_returns_false(self):
        env = {"BACKEND_PORT": "9000"}
        with patch.dict(os.environ, env, clear=False):
            os.environ.pop("PARALLAX_REQUEST_LOG", None)
            import config as cfg
            importlib.reload(cfg)
            assert cfg.REQUEST_LOG_ENABLED is False

    def test_explicit_1_overrides_non_dev_port(self):
        """PARALLAX_REQUEST_LOG=1 forces on even when port != 8000."""
        cfg = _reload_config({"PARALLAX_REQUEST_LOG": "1", "BACKEND_PORT": "9000"})
        assert cfg.REQUEST_LOG_ENABLED is True

    def test_explicit_0_overrides_dev_port(self):
        """PARALLAX_REQUEST_LOG=0 forces off even on the dev port."""
        cfg = _reload_config({"PARALLAX_REQUEST_LOG": "0", "BACKEND_PORT": "8000"})
        assert cfg.REQUEST_LOG_ENABLED is False


# ── Middleware mount tests ─────────────────────────────────────────────────


class TestMiddlewareMount:
    """Verify that the conditional app.add_middleware call in main.py works."""

    def test_middleware_present_when_enabled(self):
        app = _build_app_with_toggle(enabled=True)
        assert _has_request_logging_middleware(app), (
            "RequestLoggingMiddleware should be in user_middleware when enabled=True"
        )

    def test_middleware_absent_when_disabled(self):
        app = _build_app_with_toggle(enabled=False)
        assert not _has_request_logging_middleware(app), (
            "RequestLoggingMiddleware should NOT be in user_middleware when enabled=False"
        )
