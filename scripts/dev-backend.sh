#!/usr/bin/env bash
# Parallax dev-mode backend launcher.
#
# Why this exists:
#   `uvicorn --reload` runs as a parent watcher that doesn't always propagate
#   shutdown signals to the worker process — and SIGHUP (sent when you close
#   the terminal window) skips lifespan shutdown entirely. Either path leaves
#   the IBKR Gateway JVM running on port 5001 as an orphan, and the next dev
#   launch hits "port already in use" until you Factory Reset the Gateway.
#
#   This wrapper:
#     1. Traps SIGINT/SIGTERM/SIGHUP/EXIT.
#     2. On signal, reads ~/.parallax/gateway/gateway.pid and kills the
#        recorded process group (SIGTERM, then SIGKILL after 5 s).
#     3. Otherwise just execs `uv run uvicorn ...` so you get the same dev
#        experience plus a cleanup safety net.
#
# Usage:
#   ./scripts/dev-backend.sh
# Run from the repo root. Equivalent to the old:
#   cd backend && uv run uvicorn main:app --reload --port 8000

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${HOME}/.parallax/gateway/gateway.pid"

cleanup_gateway() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 0
  fi

  local pid pgid
  pid="$(grep -E '^pid=' "$PID_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)"
  pgid="$(grep -E '^pgid=' "$PID_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)"

  # Prefer pgid (kills the JVM + any helpers in one shot).
  local target=""
  if [[ -n "$pgid" ]]; then
    target="-${pgid}"   # negative arg = whole process group
  elif [[ -n "$pid" ]]; then
    target="$pid"
  else
    return 0
  fi

  if ! kill -0 "${pgid:-$pid}" 2>/dev/null; then
    # Already gone — nothing to do, but tidy up the stale file.
    rm -f "$PID_FILE"
    return 0
  fi

  echo "[dev-backend] Killing Gateway process group (target=$target)..." >&2
  kill -TERM "$target" 2>/dev/null || true

  # Give the JVM 5 s to exit cleanly before we escalate.
  for _ in $(seq 1 50); do
    if ! kill -0 "${pgid:-$pid}" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done

  if kill -0 "${pgid:-$pid}" 2>/dev/null; then
    echo "[dev-backend] SIGKILL ${target}" >&2
    kill -KILL "$target" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
}

on_signal() {
  echo "[dev-backend] caught signal — shutting down" >&2
  if [[ -n "${UVICORN_PID:-}" ]]; then
    # Forward to uvicorn so it gets a chance to run lifespan shutdown.
    # If uvicorn already exited (kill -9 etc) this is a harmless no-op.
    kill -TERM "$UVICORN_PID" 2>/dev/null || true
    wait "$UVICORN_PID" 2>/dev/null || true
  fi
  cleanup_gateway
  exit 0
}

trap on_signal INT TERM HUP
trap cleanup_gateway EXIT

# IMPORTANT: do NOT `exec` uvicorn — that replaces this shell, killing all
# our traps before they can ever fire.  Run uvicorn as a child so bash stays
# alive to catch SIGHUP (terminal-close) which uvicorn itself ignores.
cd "${REPO_ROOT}/backend"
uv run uvicorn main:app --reload --port 8000 &
UVICORN_PID=$!

# `wait` blocks until uvicorn exits.  When a trapped signal arrives, bash
# interrupts the wait, runs the trap, then on_signal exits explicitly.
wait "$UVICORN_PID"
