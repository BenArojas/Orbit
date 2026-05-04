"""
Tests for backend/scripts/summarize_request_log.py — Phase 8 / Task 4.3.

Strategy: write a synthetic JSONL fixture to a temp file, call summarize()
with that path, and capture stdout.  Assert that the expected aggregate
values appear in the output.
"""

from __future__ import annotations

import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

# Stub heavy deps so the test can be collected in the sandbox without
# a full backend environment (same pattern as other backend tests).
# polars itself IS available and needed, so we do NOT stub it.
sys.modules.setdefault("pandas_ta", __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock())
sys.modules.setdefault("pandas", __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock())

from scripts.summarize_request_log import summarize  # noqa: E402


# ── Fixture helpers ─────────────────────────────────────────────────────────


def _make_log(tmp_path: Path, rows: list[dict]) -> Path:
    """Write a list of dicts as JSONL to a temp file and return the path."""
    log_file = tmp_path / "requests.log"
    with log_file.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")
    return log_file


def _capture(log_path: Path) -> str:
    """Run summarize() and return everything printed to stdout."""
    buf = io.StringIO()
    with redirect_stdout(buf):
        summarize(log_path)
    return buf.getvalue()


# Shared synthetic dataset — 10 rows that exercise all three report sections.
_BASE_TS = "2026-04-29T13:00:00.000Z"
_TS_OFFSET = [0, 1, 2, 3, 4, 5, 10, 15, 20, 25]  # seconds after base


def _ts(offset_sec: int) -> str:
    """Return a simple ISO timestamp offset_sec seconds after _BASE_TS."""
    # Just embed the offset directly — close enough for bucket math.
    base_minute = "2026-04-29T13:00"
    return f"{base_minute}:{offset_sec:02d}.000Z"


_SYNTHETIC_ROWS = [
    # /gateway/status — 5 hits, mix of durations
    {"ts": _ts(0),  "kind": "http", "method": "GET", "path": "/gateway/status", "query": "", "status": 200, "duration_ms": 10.0, "client": "127.0.0.1"},
    {"ts": _ts(1),  "kind": "http", "method": "GET", "path": "/gateway/status", "query": "", "status": 200, "duration_ms": 20.0, "client": "127.0.0.1"},
    {"ts": _ts(2),  "kind": "http", "method": "GET", "path": "/gateway/status", "query": "", "status": 200, "duration_ms": 30.0, "client": "127.0.0.1"},
    {"ts": _ts(3),  "kind": "http", "method": "GET", "path": "/gateway/status", "query": "", "status": 200, "duration_ms": 40.0, "client": "127.0.0.1"},
    {"ts": _ts(4),  "kind": "http", "method": "GET", "path": "/gateway/status", "query": "", "status": 200, "duration_ms": 50.0, "client": "127.0.0.1"},
    # /market/quote — 3 hits
    {"ts": _ts(5),  "kind": "http", "method": "GET", "path": "/market/quote/265598", "query": "", "status": 200, "duration_ms": 100.0, "client": "127.0.0.1"},
    {"ts": _ts(10), "kind": "http", "method": "GET", "path": "/market/quote/265598", "query": "", "status": 200, "duration_ms": 200.0, "client": "127.0.0.1"},
    {"ts": _ts(15), "kind": "http", "method": "GET", "path": "/market/quote/265598", "query": "", "status": 500, "duration_ms": 50.0,  "client": "127.0.0.1"},
    # /health — 1 hit, 4xx
    {"ts": _ts(20), "kind": "http", "method": "GET", "path": "/health",           "query": "", "status": 404, "duration_ms": 5.0,   "client": "127.0.0.1"},
    # WS event — should be excluded from HTTP aggregates
    {"ts": _ts(25), "kind": "ws_connect", "path": "/ws", "client": "127.0.0.1"},
]


# ── Tests ────────────────────────────────────────────────────────────────────


class TestTopEndpoints:
    def test_gateway_status_appears_as_top_endpoint(self, tmp_path):
        log = _make_log(tmp_path, _SYNTHETIC_ROWS)
        out = _capture(log)
        assert "/gateway/status" in out

    def test_top_endpoint_hit_count_is_correct(self, tmp_path):
        """gateway/status has 5 hits — the number 5 must appear on its line."""
        log = _make_log(tmp_path, _SYNTHETIC_ROWS)
        out = _capture(log)
        # Find the line containing the path and verify the count appears
        for line in out.splitlines():
            if "/gateway/status" in line:
                assert "5" in line, f"Expected hit count 5 on line: {line!r}"
                break
        else:
            pytest.fail("/gateway/status not found in output")

    def test_p50_for_gateway_status(self, tmp_path):
        """Median of [10, 20, 30, 40, 50] = 30.0."""
        log = _make_log(tmp_path, _SYNTHETIC_ROWS)
        out = _capture(log)
        for line in out.splitlines():
            if "/gateway/status" in line:
                assert "30.0" in line, f"Expected p50=30.0 on line: {line!r}"
                break

    def test_second_endpoint_present(self, tmp_path):
        log = _make_log(tmp_path, _SYNTHETIC_ROWS)
        out = _capture(log)
        assert "/market/quote/265598" in out


class TestBuckets:
    def test_bucket_section_header_present(self, tmp_path):
        log = _make_log(tmp_path, _SYNTHETIC_ROWS)
        out = _capture(log)
        assert "5-Second Bucket" in out or "Bucket" in out

    def test_bucket_contains_nonzero_counts(self, tmp_path):
        """At least one bucket should show count >= 1."""
        log = _make_log(tmp_path, _SYNTHETIC_ROWS)
        out = _capture(log)
        # Buckets section follows the header — look for a digit after 2026
        bucket_lines = [
            l for l in out.splitlines()
            if "2026" in l and l.strip() and not l.startswith("=")
        ]
        assert len(bucket_lines) > 0, "Expected at least one bucket line with a timestamp"


class TestErrorSummary:
    def test_5xx_count_is_correct(self, tmp_path):
        """1 row with status 500."""
        log = _make_log(tmp_path, _SYNTHETIC_ROWS)
        out = _capture(log)
        # Look for "5xx responses       : 1"
        assert "5xx" in out
        for line in out.splitlines():
            if "5xx" in line:
                assert "1" in line, f"Expected 5xx count=1 on line: {line!r}"
                break

    def test_4xx_count_is_correct(self, tmp_path):
        """1 row with status 404."""
        log = _make_log(tmp_path, _SYNTHETIC_ROWS)
        out = _capture(log)
        assert "4xx" in out
        for line in out.splitlines():
            if "4xx" in line:
                assert "1" in line, f"Expected 4xx count=1 on line: {line!r}"
                break

    def test_error_breakdown_shows_health_path(self, tmp_path):
        """/health 404 should appear in the per-path error table."""
        log = _make_log(tmp_path, _SYNTHETIC_ROWS)
        out = _capture(log)
        assert "/health" in out

    def test_total_http_count(self, tmp_path):
        """9 HTTP rows (ws_connect excluded)."""
        log = _make_log(tmp_path, _SYNTHETIC_ROWS)
        out = _capture(log)
        for line in out.splitlines():
            if "Total HTTP" in line:
                assert "9" in line, f"Expected total=9 on line: {line!r}"
                break
        else:
            pytest.fail("Total HTTP requests line not found in output")


class TestEdgeCases:
    def test_ws_only_log_does_not_crash(self, tmp_path):
        """A log with only WS events should not raise — just report no HTTP rows."""
        rows = [
            {"ts": _ts(0), "kind": "ws_connect",    "path": "/ws", "client": "127.0.0.1"},
            {"ts": _ts(5), "kind": "ws_disconnect",  "path": "/ws", "duration_ms": 500.0, "client": "127.0.0.1"},
        ]
        log = _make_log(tmp_path, rows)
        out = _capture(log)  # must not raise
        assert "no HTTP rows" in out or "No HTTP" in out

    def test_single_row_log(self, tmp_path):
        rows = [
            {"ts": _ts(0), "kind": "http", "method": "GET", "path": "/ping", "query": "", "status": 200, "duration_ms": 7.5, "client": "127.0.0.1"},
        ]
        log = _make_log(tmp_path, rows)
        out = _capture(log)
        assert "/ping" in out
        assert "7.5" in out
