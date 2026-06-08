/**
 * Task 3.5 — staleTime / refetchInterval audit tests
 *
 * Strategy: spy on `useQuery` from @tanstack/react-query so we can assert
 * the options object each query is called with, without standing up a real
 * QueryClient or network layer.
 *
 * Key cases:
 *   1. useAiStatus — staleTime must switch between 5_000 (setup) and 30_000
 *      (ready) based on ollamaState. This is the only *dynamic* timing in
 *      the audit; all others are static literals.
 *   2. useAiStatus — ai/models staleTime: Infinity + refetchInterval: false
 *      (static data, invalidated by refresh mutation)
 *   3. TIER_DELAY_MS constants — sanity-check the 4-tier cascade from Task 3.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ── capture useQuery call options ────────────────────────────────────────────

type QueryOptions = {
  queryKey: unknown[];
  staleTime?: number;
  refetchInterval?: number | false;
  enabled?: boolean;
  [k: string]: unknown;
};

let capturedOptions: QueryOptions[] = [];

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (opts: QueryOptions) => {
      capturedOptions.push(opts);
      // Return a stable inert result so the hook doesn't crash.
      return {
        data: undefined,
        isLoading: false,
        isError: false,
        error: null,
        status: "pending" as const,
        isPending: true,
        isSuccess: false,
        isFetching: false,
        isRefetching: false,
        isLoadingError: false,
        isRefetchError: false,
        isPlaceholderData: false,
        isStale: false,
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        failureCount: 0,
        failureReason: null,
        fetchStatus: "idle" as const,
        refetch: vi.fn(),
        remove: vi.fn(),
      };
    },
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
      error: null,
      data: undefined,
      reset: vi.fn(),
    }),
  };
});

// ── mock AI store ─────────────────────────────────────────────────────────────
// useAiStatus calls `useAiStore()` without a selector — mock returns the state
// object directly. `mockOllamaState` is varied per-test to exercise both
// setup-mode and ready-mode staleTime values.

let mockOllamaState: string = "not_installed";

vi.mock("@/store", () => ({
  useAiStore: () => ({
    ollamaState: mockOllamaState,
    selectedModel: null,
    availableModels: [],
    platform: "darwin",
    ollamaError: null,
    setOllamaStatus: vi.fn(),
    setAvailableModels: vi.fn(),
  }),
}));

vi.mock("@/modules/parallax/api", () => ({
  parallaxApi: {
    aiStatus: vi.fn().mockResolvedValue({}),
    aiModels: vi.fn().mockResolvedValue([]),
    aiSelectModel: vi.fn().mockResolvedValue({}),
    aiRefresh: vi.fn().mockResolvedValue({}),
  },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function findOpts(key: unknown[]): QueryOptions | undefined {
  return capturedOptions.find(
    (o) =>
      o.queryKey[0] === key[0] &&
      (key.length === 1 || o.queryKey[1] === key[1]),
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Task 3.5 — query timing audit", () => {
  beforeEach(() => {
    capturedOptions = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── useAiStatus ───────────────────────────────────────────────────────────

  describe("useAiStatus", () => {
    it("ai/status staleTime is 5_000 when Ollama is not ready (setup mode)", async () => {
      mockOllamaState = "not_installed";
      const { useAiStatus } = await import("@/hooks/useAiStatus");
      renderHook(() => useAiStatus());

      const opts = findOpts(["ai", "status"]);
      expect(opts).toBeDefined();
      expect(opts!.staleTime).toBe(5_000);
    });

    it("ai/status staleTime is 30_000 when Ollama is ready (heartbeat mode)", async () => {
      mockOllamaState = "ready";
      const { useAiStatus } = await import("@/hooks/useAiStatus");
      renderHook(() => useAiStatus());

      const opts = findOpts(["ai", "status"]);
      expect(opts).toBeDefined();
      expect(opts!.staleTime).toBe(30_000);
    });

    it("ai/models staleTime is Infinity — static, invalidated by refresh mutation", async () => {
      mockOllamaState = "ready";
      const { useAiStatus } = await import("@/hooks/useAiStatus");
      renderHook(() => useAiStatus());

      const opts = findOpts(["ai", "models"]);
      expect(opts).toBeDefined();
      expect(opts!.staleTime).toBe(Infinity);
      expect(opts!.refetchInterval).toBe(false);
    });

    it("refetchInterval is 10_000 (setup) vs 60_000 (ready)", async () => {
      // Setup mode
      mockOllamaState = "not_installed";
      const { useAiStatus } = await import("@/hooks/useAiStatus");
      renderHook(() => useAiStatus());
      const setupInterval = findOpts(["ai", "status"])?.refetchInterval as number;

      capturedOptions = [];

      // Ready mode
      mockOllamaState = "ready";
      renderHook(() => useAiStatus());
      const readyInterval = findOpts(["ai", "status"])?.refetchInterval as number;

      expect(setupInterval).toBe(10_000);
      expect(readyInterval).toBe(60_000);
      expect(setupInterval).toBeLessThan(readyInterval);
    });

    it("ai/status staleTime is always refetchInterval / 2", async () => {
      for (const state of ["not_installed", "ready"] as const) {
        mockOllamaState = state;
        capturedOptions = [];
        const { useAiStatus } = await import("@/hooks/useAiStatus");
        renderHook(() => useAiStatus());

        const opts = findOpts(["ai", "status"])!;
        const interval = opts.refetchInterval as number;
        expect(opts.staleTime).toBe(interval / 2);
      }
    });
  });

  // ── TIER_DELAY_MS — cascade constants ─────────────────────────────────────

  describe("TIER_DELAY_MS — 4-tier cascade", () => {
    it("has correct delay ms for all 4 tiers", async () => {
      const { TIER_DELAY_MS } = await import("@/hooks/useIbkrReadyTier");
      expect(TIER_DELAY_MS[1]).toBe(0);
      expect(TIER_DELAY_MS[2]).toBe(200);
      expect(TIER_DELAY_MS[3]).toBe(400);
      expect(TIER_DELAY_MS[4]).toBe(800);
    });

    it("total cascade time is 800ms (down from 2000ms in the 9-tier design)", async () => {
      const { TIER_DELAY_MS } = await import("@/hooks/useIbkrReadyTier");
      const maxDelay = Math.max(...Object.values(TIER_DELAY_MS));
      expect(maxDelay).toBe(800);
    });

    it("only 4 tiers exist", async () => {
      const { TIER_DELAY_MS } = await import("@/hooks/useIbkrReadyTier");
      expect(Object.keys(TIER_DELAY_MS)).toHaveLength(4);
    });
  });
});
