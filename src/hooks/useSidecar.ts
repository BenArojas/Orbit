/** Rust owns process lifetime and the launch secret in dev and packaged builds. */
import { useEffect, useState } from "react";
import { sidecarRequest } from "@/lib/sidecarClient";
import { sidecarSession } from "@/lib/sidecarSession";

export type SidecarStatus = "starting" | "ready" | "error";

export function useSidecar() {
  const [status, setStatus] = useState<SidecarStatus>("starting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        await sidecarSession();
        for (let i = 0; i < 60 && !cancelled; i++) {
          try {
            // A stale or unrelated server on the port must never count as ready.
            const result = await sidecarRequest<{ authenticated: boolean }>("GET", "/session/status");
            if (result.authenticated && !cancelled) {
              setStatus("ready");
              return;
            }
          } catch {
            // Python/PyInstaller can take a few seconds to boot.
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!cancelled) throw new Error("Sidecar did not authenticate within 60 seconds");
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Sidecar startup failed");
        }
      }
    }
    void start();
    return () => { cancelled = true; };
  }, []);
  return { status, error };
}
