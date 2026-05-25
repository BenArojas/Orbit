/**
 * Sidecar lifecycle hook — starts and stops the Python FastAPI backend.
 *
 * In dev mode (npm run tauri dev), you typically run the backend manually:
 *   cd backend && uv run uvicorn main:app --reload --port 8000
 *
 * In production (npm run tauri build), this hook spawns the PyInstaller
 * sidecar binary automatically on launch and kills it on close.
 *
 * The hook polls /health until the backend responds, so the UI can
 * show a "connecting..." state during startup.
 *
 * Orbit integration:
 *   When Orbit launches, this hook moves to Orbit's App.tsx.
 *   The sidecar command changes to serve both Parallax and MoonMarket
 *   from one consolidated FastAPI app. The health check stays the same.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Command, type Child } from "@tauri-apps/plugin-shell";
import { api } from "@/lib/api";

export type SidecarStatus = "starting" | "ready" | "error" | "dev";

interface UseSidecarReturn {
  status: SidecarStatus;
  error: string | null;
}

/**
 * True during `npm run tauri dev` — backend is run manually in that case.
 * In production builds, Tauri sets import.meta.env.DEV = false.
 */
const DEV_MODE = import.meta.env.DEV;

// Must match the `externalBin` entry in tauri.conf.json and the scope
// entry in capabilities/default.json.
const SIDECAR_NAME = "binaries/parallax-backend";

const HEALTH_POLL_INTERVAL = 1000; // ms
const HEALTH_MAX_RETRIES = 60;     // 60s — PyInstaller cold start can be slow

export function useSidecar(): UseSidecarReturn {
  const [status, setStatus] = useState<SidecarStatus>(
    DEV_MODE ? "dev" : "starting"
  );
  const [error, setError] = useState<string | null>(null);
  const childRef = useRef<Child | null>(null);

  // ── Poll /health until the backend is up ──────────────────────────────────

  const waitForBackend = useCallback(async () => {
    for (let i = 0; i < HEALTH_MAX_RETRIES; i++) {
      try {
        const health = await api.health();
        if (health.status === "ok" || health.status === "degraded") {
          setStatus("ready");
          return;
        }
      } catch {
        // Backend not ready yet — keep polling
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL));
    }
    setStatus("error");
    setError("Backend did not start within 60 seconds");
  }, []);

  // ── Spawn the sidecar process ─────────────────────────────────────────────

  useEffect(() => {
    if (DEV_MODE) {
      // In dev mode, just poll until the manually-started backend responds.
      waitForBackend();
      return;
    }

    let cancelled = false;

    async function spawn() {
      try {
        // Production: launch the PyInstaller-bundled sidecar binary.
        // Tauri resolves the binary path and appends the target triple suffix
        // automatically based on the current platform.
        const command = Command.sidecar(SIDECAR_NAME);

        command.stdout.on("data", (line) => {
          console.log("[sidecar]", line);
        });
        command.stderr.on("data", (line) => {
          console.error("[sidecar]", line);
        });
        command.on("error", (err) => {
          if (!cancelled) {
            setStatus("error");
            setError(`Sidecar error: ${err}`);
          }
        });

        const child = await command.spawn();
        childRef.current = child;

        // Wait for the backend to respond to /health.
        // PyInstaller cold-start includes Python interpreter extraction — allow
        // up to 60 seconds on slow machines or first launch.
        await waitForBackend();
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(`Failed to start sidecar: ${err}`);
        }
      }
    }

    spawn();

    return () => {
      cancelled = true;
      // Kill the sidecar when the app closes — best effort.
      childRef.current?.kill().catch(() => {});
    };
  }, [waitForBackend]);

  return { status, error };
}
