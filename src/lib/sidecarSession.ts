import { invoke, isTauri } from "@tauri-apps/api/core";

// Memory only. No browser storage, URL parameter, DOM field, or exported value.
let pending: Promise<string> | undefined;

export function sidecarSession(): Promise<string> {
  if (!isTauri()) {
    return Promise.reject(new Error("Open Orbit in the desktop app to access its sidecar."));
  }
  if (!pending) {
    pending = invoke<string>("sidecar_session").catch(() => {
      pending = undefined;
      throw new Error("The desktop sidecar could not start.");
    });
  }
  return pending;
}

export async function sessionHeaders(): Promise<Record<string, string>> {
  return { "X-Orbit-Session": await sidecarSession() };
}

export async function sessionProtocols(): Promise<string[]> {
  return ["orbit-session", await sidecarSession()];
}
