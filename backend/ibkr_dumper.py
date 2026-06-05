"""
IBKR response dumper — saves one valid response per endpoint to backend/dev_samples/.

Usage:
    PARALLAX_DUMP_IBKR=1 uvicorn main:app ...

Behaviour:
  - Only active when PARALLAX_DUMP_IBKR=1.
  - For each endpoint key, saves the FIRST valid (non-empty, non-error) response.
  - Subsequent calls for the same endpoint are no-ops (one sample per endpoint).
  - Files are named: dev_samples/{endpoint_slug}_{timestamp}.json
  - Thread-safe via a module-level set of already-dumped endpoints.
"""

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("parallax.ibkr_dumper")

# Set of endpoint keys already dumped this process run (in-memory dedup)
_dumped: set[str] = set()

# Path is relative to this file's directory
_SAMPLES_DIR = Path(__file__).parent / "dev_samples"

_ENABLED = os.getenv("PARALLAX_DUMP_IBKR", "0").strip() == "1"


def _is_valid(response: Any) -> bool:
    """Return True if response looks like a real, non-error payload."""
    if response is None:
        return False
    if isinstance(response, list):
        return len(response) > 0
    if isinstance(response, dict):
        # IBKR error responses typically have "error" key
        if "error" in response:
            return False
        return len(response) > 0
    return False


def _slug(endpoint: str) -> str:
    """Turn an endpoint string into a safe filename component."""
    # Replace any non-alphanumeric characters with underscores
    return re.sub(r"[^a-zA-Z0-9]+", "_", endpoint).strip("_")


def dump_if_first(endpoint: str, response: Any) -> None:
    """
    Save *response* to dev_samples/ if:
      1. PARALLAX_DUMP_IBKR=1 is set.
      2. This endpoint has not been dumped yet this run.
      3. The response is valid (non-empty, no error key).

    Args:
        endpoint: Human-readable endpoint key, e.g. "scanner_run" or
                  "marketdata_snapshot". Used as the filename prefix.
        response: The raw response object returned by IBKRService._request().
    """
    if not _ENABLED:
        return

    if endpoint in _dumped:
        return  # Already saved one sample for this endpoint

    if not _is_valid(response):
        log.debug("Skipping dump for '%s' — response invalid or empty.", endpoint)
        return

    _dumped.add(endpoint)

    try:
        _SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = int(time.time())
        filename = _SAMPLES_DIR / f"{_slug(endpoint)}_{timestamp}.json"
        with open(filename, "w", encoding="utf-8") as fh:
            json.dump(response, fh, indent=2, default=str)
        log.info("IBKR dump saved: %s", filename)
    except Exception as exc:  # noqa: BLE001
        log.warning("Failed to dump IBKR response for '%s': %s", endpoint, exc)
