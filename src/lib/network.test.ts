/**
 * Tests for Phase 8.1-F network offline detection.
 *
 * Covers:
 *   - `ensureOnline()` throws NetworkOfflineError when navigator.onLine = false
 *   - `ensureOnline()` is a no-op when online
 *   - Singleton toast id on show / dismiss
 *   - `initNetworkMonitor` wires offline/online window events
 *   - `online` event triggers queryClient.invalidateQueries
 *   - Returned cleanup removes listeners
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

// toast is imported from sonner — mock it to observe calls.
vi.mock("sonner", () => {
  return {
    toast: {
      error: vi.fn(),
      dismiss: vi.fn(),
    },
  };
});

import { toast } from "sonner";
import {
  NETWORK_OFFLINE_MESSAGE,
  NETWORK_OFFLINE_TOAST_ID,
  NetworkOfflineError,
  dismissOfflineToast,
  ensureOnline,
  initNetworkMonitor,
  showOfflineToast,
} from "./network";

// Typed helpers onto the mocked sonner module.
const toastError = toast.error as unknown as ReturnType<typeof vi.fn>;
const toastDismiss = toast.dismiss as unknown as ReturnType<typeof vi.fn>;

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

describe("ensureOnline", () => {
  beforeEach(() => {
    toastError.mockClear();
    toastDismiss.mockClear();
    setOnline(true);
  });

  it("is a no-op when navigator.onLine is true", () => {
    expect(() => ensureOnline()).not.toThrow();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("throws NetworkOfflineError when navigator.onLine is false", () => {
    setOnline(false);
    expect(() => ensureOnline()).toThrow(NetworkOfflineError);
  });

  it("fires the singleton toast when offline", () => {
    setOnline(false);
    try {
      ensureOnline();
    } catch {
      /* expected */
    }
    expect(toastError).toHaveBeenCalledWith(
      NETWORK_OFFLINE_MESSAGE,
      expect.objectContaining({ id: NETWORK_OFFLINE_TOAST_ID, duration: Infinity }),
    );
  });
});

describe("showOfflineToast / dismissOfflineToast", () => {
  beforeEach(() => {
    toastError.mockClear();
    toastDismiss.mockClear();
  });

  it("show uses the singleton id + infinite duration", () => {
    showOfflineToast();
    expect(toastError).toHaveBeenCalledTimes(1);
    const [, opts] = toastError.mock.calls[0];
    expect(opts).toMatchObject({
      id: NETWORK_OFFLINE_TOAST_ID,
      duration: Infinity,
    });
  });

  it("dismiss targets the singleton id", () => {
    dismissOfflineToast();
    expect(toastDismiss).toHaveBeenCalledWith(NETWORK_OFFLINE_TOAST_ID);
  });
});

describe("initNetworkMonitor", () => {
  let queryClient: QueryClient;
  // Keep this as `any` — the exact MockInstance generic signature on QueryClient's
  // generic `invalidateQueries` is painful to thread through vi.spyOn.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let invalidateSpy: any;

  beforeEach(() => {
    toastError.mockClear();
    toastDismiss.mockClear();
    setOnline(true);
    queryClient = new QueryClient();
    invalidateSpy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    invalidateSpy.mockRestore();
    queryClient.clear();
  });

  it("shows toast on window 'offline' event", () => {
    const cleanup = initNetworkMonitor(queryClient);
    window.dispatchEvent(new Event("offline"));
    expect(toastError).toHaveBeenCalledWith(
      NETWORK_OFFLINE_MESSAGE,
      expect.objectContaining({ id: NETWORK_OFFLINE_TOAST_ID }),
    );
    cleanup();
  });

  it("dismisses toast and invalidates queries on window 'online' event", () => {
    const cleanup = initNetworkMonitor(queryClient);
    window.dispatchEvent(new Event("online"));
    expect(toastDismiss).toHaveBeenCalledWith(NETWORK_OFFLINE_TOAST_ID);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("cleanup removes both listeners", () => {
    const cleanup = initNetworkMonitor(queryClient);
    cleanup();
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(toastError).not.toHaveBeenCalled();
    expect(toastDismiss).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("NetworkOfflineError", () => {
  it("has the expected name and default message", () => {
    const err = new NetworkOfflineError();
    expect(err.name).toBe("NetworkOfflineError");
    expect(err.message).toBe(NETWORK_OFFLINE_MESSAGE);
  });

  it("is an Error instance", () => {
    expect(new NetworkOfflineError()).toBeInstanceOf(Error);
  });
});
