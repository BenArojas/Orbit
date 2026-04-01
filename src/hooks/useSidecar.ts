/**
 * Sidecar lifecycle hook — starts and stops the Python FastAPI backend.
 *
 * In dev mode (npm run tauri dev), you typically run the backend manually:
 *   cd backend && uv run uvicorn main:app --reload --port 8000
 *
 * In production (npm run tauri build), this hook spawns the sidecar
 * automatically when the app launches and kills it on close.
 *
 * The hook polls /health until the backend responds, so the UI can
 * show a "connecting..." state during startup.
 *
 * Hub integration:
 *   When the Hub launches, this hook moves to the Hub's App.tsx.
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
 * Set to true during development when you run the backend manually.
 * When false, this hook spawns uvicorn as a child process.
 *
 * In production builds, Tauri sets import.meta.env.DEV = false.
 */
const DEV_MODE = import.meta.env.DEV;

const HEALTH_POLL_INTERVAL = 1000; // 1 second
const HEALTH_MAX_RETRIES = 30;     // 30 seconds max wait

export function useSidecar(): UseSidecarReturn {
  const [status, setStatus] = useState<SidecarStatus>(
    DEV_MODE ? "dev" : "starting"
  );
  const [error, setError] = useState<string | null>(null);
  const childRef = useRef<Child | null>(null);

  // ── Poll /health until the backend is up ──

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
    setError("Backend did not start within 30 seconds");
  }, []);

  // ── Spawn the sidecar process ──

  useEffect(() => {
    if (DEV_MODE) {
      // In dev mode, just poll until the manually-started backend responds
      waitForBackend();
      return;
    }

    let cancelled = false;

    async function spawn() {
      try {
        // Spawn: uv run uvicorn main:app --host 127.0.0.1 --port 8000
        // The working directory is the backend/ folder relative to the binary.
        const command = Command.create("uv", [
          "run", "uvicorn", "main:app",
          "--host", "127.0.0.1",
          "--port", "8000",
        ]);

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

        // Wait for the backend to respond to /health
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
      // Kill the sidecar when the app closes
      if (childRef.current) {
        childRef.current.kill().catch(() => {
          // Best effort — process may already be dead
        });
      }
    };
  }, [waitForBackend]);

  return { status, error };
}
