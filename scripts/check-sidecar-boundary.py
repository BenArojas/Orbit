"""Smoke the real Python/PyInstaller entry point without user data or broker orders.

Run from backend with its uv environment:
  uv run python ../scripts/check-sidecar-boundary.py
  uv run python ../scripts/check-sidecar-boundary.py --binary /absolute/sidecar
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect


ROOT = Path(__file__).resolve().parents[1]


def request(base, method, path, secret=None, body=None):
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-Orbit-Session"] = secret
    req = Request(base + path, method=method, headers=headers,
                  data=json.dumps(body).encode() if body is not None else None)
    try:
        with urlopen(req, timeout=2) as response:
            return response.status, json.load(response)
    except HTTPError as exc:
        return exc.code, json.load(exc)


def smoke(binary: Path | None):
    command = [str(binary)] if binary else [sys.executable, str(ROOT / "backend/run.py")]
    old_secret = None
    for launch in range(2):
        secret = secrets.token_hex(32)
        with tempfile.TemporaryDirectory(prefix="orbit-boundary-") as directory:
            data = Path(directory)
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            env = {
                **os.environ, "BACKEND_PORT": str(port),
                "SQLITE_DB_PATH": str(data / "test.db"),
                "PARALLAX_GATEWAY_HOME": str(data / "gateway"),
                "IBKR_GATEWAY_PORT": "9", "PARALLAX_REQUEST_LOG": "0",
            }
            env.pop("ORBIT_SESSION_SECRET", None)
            base = f"http://127.0.0.1:{port}"
            log_path = data / "sidecar.log"
            with log_path.open("wb") as log:
                process = subprocess.Popen(
                    command + ["--native-session"], cwd=ROOT / "backend",
                    env=env, stdin=subprocess.PIPE, stdout=log, stderr=log,
                )
                try:
                    process.stdin.write((secret + "\n").encode())
                    process.stdin.flush()
                    deadline = time.monotonic() + 60
                    while True:
                        if process.poll() is not None:
                            raise RuntimeError("Sidecar exited before readiness")
                        try:
                            if request(base, "GET", "/session/status", secret)[0] == 200:
                                break
                        except (URLError, TimeoutError, ConnectionError):
                            pass
                        if time.monotonic() >= deadline:
                            raise RuntimeError("Sidecar did not become ready")
                        time.sleep(0.1)
                    assert request(base, "PUT", "/settings/theme_mode", body={"value": "light"})[0] == 401
                    assert request(base, "GET", "/settings")[0] == 401
                    saved = request(base, "PUT", "/settings/theme_mode", secret, {"value": "light"})
                    assert saved[0] == 200, saved
                    assert request(base, "GET", "/settings", secret)[1]["theme_mode"] == "light"
                    assert request(base, "POST", "/execution-assistant/live/arm", secret, {})[0] == 403
                    assert request(base, "POST", "/moonmarket/orders", secret, {})[0] == 403
                    if old_secret:
                        assert request(base, "GET", "/session/status", old_secret)[0] == 401
                    stream_url = f"ws://127.0.0.1:{port}/execution-assistant/ws"
                    try:
                        with connect(stream_url, open_timeout=2):
                            raise AssertionError("Anonymous stream accepted")
                    except InvalidStatus:
                        pass
                    with connect(stream_url, subprotocols=["orbit-session", secret], open_timeout=2) as ws:
                        assert json.loads(ws.recv(timeout=2))["type"] == "tws_stream_status"
                finally:
                    try:
                        process.stdin.write(b"shutdown\n")
                        process.stdin.close()
                    except BrokenPipeError:
                        pass
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
            assert process.returncode == 0, "Sidecar did not shut down cleanly"
            assert secret not in log_path.read_text(errors="replace")
            old_secret = secret
        print(f"PASS isolated launch {launch + 1}: HTTP, WebSocket, legacy-route lockdown, no secret in logs")
    print("PASS launch rotation rejects the previous credential; no broker orders sent")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path)
    args = parser.parse_args()
    smoke(args.binary.resolve() if args.binary else None)
