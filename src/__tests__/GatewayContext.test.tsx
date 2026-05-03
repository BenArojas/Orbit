/**
 * Tests for GatewayProvider — Phase 8 / Task 3.7
 *
 * Covers the WS auth_state subscription introduced in GatewayContext:
 *   - auth_state push (authenticated: false) writes into TanStack cache immediately
 *   - auth_state push (authenticated: true) clears session_dropped + auth_required
 *   - non-auth_state WS messages are ignored
 *   - missing `authenticated` field is ignored
 *
 * Strategy: we mock useWebSocket so we control message delivery and mock
 * useGateway so we don't need a real backend. The GatewayProvider under
 * test is the real implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import React from "react";

// ── Mocks ──────────────────────────────────────────────────────────────────

// We'll capture the addHandler callback so tests can fire messages manually.
let capturedHandler: ((msg: Record<string, unknown>) => void) | null = null;

vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    status: "connected",
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn(),
    addHandler: (h: (msg: Record<string, unknown>) => void) => {
      capturedHandler = h;
      // Return cleanup fn
      return () => { capturedHandler = null; };
    },
  }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    gatewayStatus: vi.fn(),
  },
}));

vi.mock("@/hooks/useGateway", () => ({
  useGateway: () => ({
    status: RUNNING_AUTH,
    isRunning: true,
    isAuthenticated: true,
    needsLogin: false,
    isProvisioning: false,
    sessionDropped: false,
    provision: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    logout: vi.fn(),
    restartGateway: vi.fn(),
    factoryReset: vi.fn(),
    actionError: null,
    actionLoading: false,
    refetch: vi.fn(),
  }),
}));

import { GatewayProvider } from "@/context/GatewayContext";
import type { GatewayStatusResponse } from "@/lib/api";

// ── Fixtures ───────────────────────────────────────────────────────────────

const RUNNING_AUTH: GatewayStatusResponse = {
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

const GATEWAY_QUERY_KEY = ["gateway-status"];

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(GatewayProvider, null, children),
    );
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GatewayProvider — Task 3.7 WS auth_state subscription", () => {
  beforeEach(() => {
    capturedHandler = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("auth_state push (authenticated: false) sets authenticated=false in cache", async () => {
    const qc = freshClient();
    // Seed the cache with a running+authenticated state.
    qc.setQueryData<GatewayStatusResponse>(GATEWAY_QUERY_KEY, RUNNING_AUTH);

    const { result } = renderHook(() => useQueryClient(), {
      wrapper: makeWrapper(qc),
    });

    // Handler should be registered after mount.
    expect(capturedHandler).not.toBeNull();

    await act(async () => {
      capturedHandler!({
        type: "auth_state",
        authenticated: false,
        session_dropped: true,
      });
    });

    const cached = result.current.getQueryData<GatewayStatusResponse>(GATEWAY_QUERY_KEY);
    expect(cached?.authenticated).toBe(false);
    expect(cached?.session_dropped).toBe(true);
  });

  it("auth_state push (authenticated: true) clears session_dropped and auth_required", async () => {
    const qc = freshClient();
    qc.setQueryData<GatewayStatusResponse>(GATEWAY_QUERY_KEY, {
      ...RUNNING_AUTH,
      authenticated: false,
      session_dropped: true,
      auth_required: true,
    });

    const { result } = renderHook(() => useQueryClient(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      capturedHandler!({
        type: "auth_state",
        authenticated: true,
        session_dropped: false,
      });
    });

    const cached = result.current.getQueryData<GatewayStatusResponse>(GATEWAY_QUERY_KEY);
    expect(cached?.authenticated).toBe(true);
    expect(cached?.session_dropped).toBe(false);
    expect(cached?.auth_required).toBe(false);
  });

  it("non-auth_state WS messages are ignored — cache unchanged", async () => {
    const qc = freshClient();
    qc.setQueryData<GatewayStatusResponse>(GATEWAY_QUERY_KEY, RUNNING_AUTH);

    const { result } = renderHook(() => useQueryClient(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      capturedHandler!({ type: "market_data", conid: 265598, price: 200.5 });
    });

    const cached = result.current.getQueryData<GatewayStatusResponse>(GATEWAY_QUERY_KEY);
    expect(cached).toEqual(RUNNING_AUTH);
  });

  it("auth_state message missing authenticated field is ignored", async () => {
    const qc = freshClient();
    qc.setQueryData<GatewayStatusResponse>(GATEWAY_QUERY_KEY, RUNNING_AUTH);

    const { result } = renderHook(() => useQueryClient(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      capturedHandler!({ type: "auth_state" /* no authenticated field */ });
    });

    const cached = result.current.getQueryData<GatewayStatusResponse>(GATEWAY_QUERY_KEY);
    // Unchanged
    expect(cached?.authenticated).toBe(true);
  });

  it("auth_state push does NOT trigger a network call to /gateway/status", async () => {
    const { api } = await import("@/lib/api");
    const statusSpy = api.gatewayStatus as ReturnType<typeof vi.fn>;
    statusSpy.mockClear();

    const qc = freshClient();
    qc.setQueryData<GatewayStatusResponse>(GATEWAY_QUERY_KEY, RUNNING_AUTH);

    renderHook(() => useQueryClient(), { wrapper: makeWrapper(qc) });

    await act(async () => {
      capturedHandler!({
        type: "auth_state",
        authenticated: false,
        session_dropped: true,
      });
    });

    // setQueryData writes directly — no network call needed.
    expect(statusSpy).not.toHaveBeenCalled();
  });
});
