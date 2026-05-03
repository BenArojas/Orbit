/**
 * Tests for useGateway feedback layer (Phase 8.10) + Task 3.6 retry config.
 *
 * Covers:
 *   - logout / restartGateway / factoryReset emit success toasts on resolve
 *   - same actions emit error toasts on reject
 *   - same actions invalidate IBKR-dependent queries (and ONLY those)
 *   - cheap actions (start / stop / provision) do NOT toast or invalidate
 *   - Task 3.6: gateway-status query uses retry:1 / retryDelay:1_500
 *
 * The hook reaches for `toast` and `api`; both are mocked here so we can
 * assert call shape without standing up a full IBKR backend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("sonner", () => {
  return {
    toast: {
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("@/lib/api", () => {
  return {
    api: {
      gatewayStatus: vi.fn(),
      gatewayProvision: vi.fn(),
      gatewayStart: vi.fn(),
      gatewayStop: vi.fn(),
      gatewayLogout: vi.fn(),
      gatewayResetSession: vi.fn(),
      gatewayFactoryReset: vi.fn(),
    },
  };
});

import { toast } from "sonner";
import { api } from "@/lib/api";
import { useGateway } from "@/hooks/useGateway";
import type { GatewayStatusResponse } from "@/lib/api";

const toastSuccess = toast.success as unknown as ReturnType<typeof vi.fn>;
const toastError = toast.error as unknown as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────────

const RUNNING: GatewayStatusResponse = {
  state: "running",
  running: true,
  authenticated: true,
  auth_required: false,
  auth_message: "",
  session_dropped: false,
  provisioned: true,
  error: null,
  gateway_url: "https://localhost:5001",
  gateway_home: "/tmp/parallax",
  platform: "Test",
} as unknown as GatewayStatusResponse;

function makeWrapper(qc: QueryClient) {
  // Functional wrapper avoids a JSX file just to host one provider.
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: qc },
      children,
    );
  };
}

function freshClient(): QueryClient {
  return new QueryClient({
    // gcTime defaults to 5 minutes — leave it.  With gcTime: 0, queries
    // without observers get reaped before assertions can inspect them,
    // making `getQueryState(...)` return undefined sporadically.
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
}

/**
 * Pull the predicate out of the most recent invalidateQueries call that had
 * one. We rely on this instead of inspecting QueryState directly because
 * setQueryData-without-observer queries can be GC'd before the test
 * assertion runs in some timing windows — testing the predicate itself
 * is both more reliable and a stronger guarantee.
 */
function lastPredicate(
  spy: ReturnType<typeof vi.spyOn>,
): ((q: { queryKey: unknown }) => boolean) | undefined {
  for (let i = spy.mock.calls.length - 1; i >= 0; i--) {
    const arg = spy.mock.calls[i][0] as
      | { predicate?: (q: { queryKey: unknown }) => boolean }
      | undefined;
    if (arg?.predicate) return arg.predicate;
  }
  return undefined;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("useGateway feedback — toasts + IBKR cache invalidation", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    (api.gatewayStatus as ReturnType<typeof vi.fn>).mockResolvedValue(RUNNING);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("logout success → success toast + IBKR predicate invalidates the right keys", async () => {
    const qc = freshClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    (api.gatewayLogout as ReturnType<typeof vi.fn>).mockResolvedValue(RUNNING);

    const { result } = renderHook(() => useGateway(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(toastSuccess).toHaveBeenCalledWith("Logged out of IBKR");
    expect(toastError).not.toHaveBeenCalled();

    // The hook should have called invalidateQueries with a predicate that
    // matches IBKR-session-dependent keys but spares local-only keys.
    const predicate = lastPredicate(invalidateSpy);
    expect(predicate).toBeDefined();
    expect(predicate!({ queryKey: ["quote", 12345] })).toBe(true);
    expect(predicate!({ queryKey: ["watchlists"] })).toBe(true);
    expect(predicate!({ queryKey: ["sectors", "performance"] })).toBe(true);
    expect(predicate!({ queryKey: ["screener-presets"] })).toBe(true);
    expect(predicate!({ queryKey: ["ai", "status"] })).toBe(false);
    expect(predicate!({ queryKey: ["gateway-status"] })).toBe(false);
    expect(predicate!({ queryKey: ["watchlist-configs"] })).toBe(false);
    expect(predicate!({ queryKey: ["trigger-rules"] })).toBe(false);
  });

  it("logout failure → error toast, no success toast", async () => {
    const qc = freshClient();
    (api.gatewayLogout as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("connect refused"),
    );

    const { result } = renderHook(() => useGateway(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain("Logout failed");
    expect(toastError.mock.calls[0][0]).toContain("connect refused");
  });

  it("restartGateway success → success toast + IBKR predicate fires", async () => {
    const qc = freshClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    (api.gatewayResetSession as ReturnType<typeof vi.fn>).mockResolvedValue(
      RUNNING,
    );

    const { result } = renderHook(() => useGateway(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.restartGateway();
    });

    expect(toastSuccess).toHaveBeenCalledWith("Gateway restarted");
    const predicate = lastPredicate(invalidateSpy);
    expect(predicate).toBeDefined();
    expect(predicate!({ queryKey: ["watchlists"] })).toBe(true);
    expect(predicate!({ queryKey: ["gateway-status"] })).toBe(false);
  });

  it("factoryReset failure → error toast", async () => {
    const qc = freshClient();
    (api.gatewayFactoryReset as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("disk full"),
    );

    const { result } = renderHook(() => useGateway(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.factoryReset();
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain("Factory reset failed");
  });

  it("start / stop / provision do not emit toasts or invalidate IBKR cache", async () => {
    const qc = freshClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    (api.gatewayStart as ReturnType<typeof vi.fn>).mockResolvedValue(RUNNING);
    (api.gatewayStop as ReturnType<typeof vi.fn>).mockResolvedValue(RUNNING);
    (api.gatewayProvision as ReturnType<typeof vi.fn>).mockResolvedValue(RUNNING);

    const { result } = renderHook(() => useGateway(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.start();
      await result.current.stop();
      await result.current.provision();
    });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    // None of the lifecycle actions should have invoked the IBKR predicate
    // path of invalidateQueries.  The catch-block fallback (which uses
    // queryKey, not predicate, on action failure) is allowed.
    expect(lastPredicate(invalidateSpy)).toBeUndefined();
  });
});

// ── Task 3.6 — gateway-status retry config ─────────────────────────────────
//
// Spy on QueryClient.fetchQuery / the underlying query options to verify
// retry: 1 and retryDelay: 1_500.  We inspect the query state after one
// failure to confirm TanStack obeys the single-retry setting.

describe("useGateway — Task 3.6 retry config", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("gateway-status query uses retry:1 and retryDelay:1_500", async () => {
    // Read the options TanStack Query actually registered for the
    // gateway-status query by inspecting the query cache entry after mount.
    (api.gatewayStatus as ReturnType<typeof vi.fn>).mockResolvedValue(RUNNING);

    const qc = freshClient();
    const { result } = renderHook(() => useGateway(), {
      wrapper: makeWrapper(qc),
    });

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => result.current.status !== null);

    const entry = qc
      .getQueryCache()
      .find({ queryKey: ["gateway-status"] }) as unknown as {
      options: { retry?: number; retryDelay?: number };
    };

    expect(entry).toBeDefined();
    expect(entry.options.retry).toBe(1);
    expect(entry.options.retryDelay).toBe(1_500);
  });

  it("gateway-status query does NOT use the old burst settings (retry:3 / retryDelay:500)", async () => {
    (api.gatewayStatus as ReturnType<typeof vi.fn>).mockResolvedValue(RUNNING);

    const qc = freshClient();
    const { result } = renderHook(() => useGateway(), {
      wrapper: makeWrapper(qc),
    });

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => result.current.status !== null);

    const entry = qc
      .getQueryCache()
      .find({ queryKey: ["gateway-status"] }) as unknown as {
      options: { retry?: number; retryDelay?: number };
    };

    expect(entry.options.retry).not.toBe(3);
    expect(entry.options.retryDelay).not.toBe(500);
  });
});
