/**
 * Deep sidecar transport runtime.
 *
 * This is the only frontend module that owns base URL construction, fetch,
 * JSON/no-content parsing, ApiError construction, abort passthrough, and
 * offline error translation.
 *
 * Product API modules should call sidecarRequest/request from here and should
 * not call fetch directly.
 */


import { API_BASE } from "@/config/endpoints";
import { ensureOnline, NetworkOfflineError, showOfflineToast } from "./network";

// ── API Error ───────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(body.message as string || `API error ${status}`);
    this.name = "ApiError";
  }
}

export async function sidecarRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  // Phase 8.1-F — fast-fail if the browser already knows we're offline.
  // Skips the fetch + retry chain entirely and surfaces the toast
  // immediately rather than making the user wait ~3.5 s for the
  // backend's retry budget to drain.
  ensureOnline();

  const url = `${API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    signal,
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, options);
    let data: unknown;
    if (res.status !== 204) {
      try {
        data = await res.json();
      } catch (err) {
        if (res.ok) {
          return undefined as T;
        }
        data = {
          message:
            err instanceof Error
              ? err.message
              : `API error ${res.status}`,
        };
      }
    }

    if (!res.ok) {
      const body =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : { message: `API error ${res.status}` };
      throw new ApiError(res.status, body);
    }
    return data as T;
  } catch (err) {
    // Caller cancelled the request (TanStack Query unmount, key supersession,
    // route change). Rethrow without the offline-check chain so cancellation
    // doesn't surface a misleading "you're offline" toast.
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    // `fetch()` throws a TypeError on network failure (DNS, no route,
    // sidecar down, etc.). If we've since gone offline, upgrade the
    // error so retry logic skips it and the singleton toast fires.
    if (err instanceof TypeError && typeof navigator !== "undefined" && navigator.onLine === false) {
      showOfflineToast();
      throw new NetworkOfflineError();
    }
    throw err;
  }
}