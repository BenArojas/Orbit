/**
 * Tests for the pulse-config Zustand store.
 *
 * Primary focus is the staleTime-Infinity invalidation hook added in
 * Phase 8.9 / Commit E: save() and reset() must drop cached ["conid"],
 * ["quote"], and ["candles"] query entries so the next MarketPulse
 * render re-resolves with the new ticker list (e.g. after SLV→XAGUSD
 * swap or a "Reset to defaults" click).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared QueryClient before importing the store so the store's
// top-level `import { queryClient }` picks up the spied instance.
vi.mock("@/lib/query", () => {
  const removeQueries = vi.fn();
  return {
    queryClient: { removeQueries },
    // Re-exposed on the mock module so tests can inspect calls.
    __removeQueries: removeQueries,
  };
});

// Mock the backend API so no real fetch goes out.
vi.mock("@/lib/api", () => {
  return {
    api: {
      getPulseConfig: vi.fn(),
      setPulseConfig: vi.fn(),
      resetPulseConfig: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
// @ts-expect-error — the mock exports __removeQueries under the hood.
import { __removeQueries } from "@/lib/query";
import { usePulseConfigStore, DEFAULT_PULSE_ITEMS } from "./pulseConfig";

const mockedApi = api as unknown as {
  getPulseConfig: ReturnType<typeof vi.fn>;
  setPulseConfig: ReturnType<typeof vi.fn>;
  resetPulseConfig: ReturnType<typeof vi.fn>;
};

const removeQueriesMock = __removeQueries as ReturnType<typeof vi.fn>;

beforeEach(() => {
  removeQueriesMock.mockClear();
  mockedApi.getPulseConfig.mockReset();
  mockedApi.setPulseConfig.mockReset();
  mockedApi.resetPulseConfig.mockReset();
  // Reset store to its initial state before each test.
  usePulseConfigStore.setState({
    items: [...DEFAULT_PULSE_ITEMS],
    isLoaded: false,
    isSaving: false,
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePulseConfigStore.save", () => {
  it("flushes conid/quote/candle caches on success", async () => {
    mockedApi.setPulseConfig.mockResolvedValueOnce({
      items: [{ label: "SPY", resolve: "SPY", sec_type: "" }],
    });

    await usePulseConfigStore
      .getState()
      .save([{ label: "SPY", resolve: "SPY", sec_type: "" }]);

    const keys = removeQueriesMock.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toEqual([["conid"], ["quote"], ["candles"]]);
  });

  it("does NOT flush caches when save fails (cache stays consistent with reverted state)", async () => {
    mockedApi.setPulseConfig.mockRejectedValueOnce(new Error("boom"));

    await expect(
      usePulseConfigStore.getState().save([
        { label: "SPY", resolve: "SPY", sec_type: "" },
      ]),
    ).rejects.toThrow("boom");

    expect(removeQueriesMock).not.toHaveBeenCalled();
  });
});

describe("usePulseConfigStore.reset", () => {
  it("flushes conid/quote/candle caches on success", async () => {
    mockedApi.resetPulseConfig.mockResolvedValueOnce({
      items: [...DEFAULT_PULSE_ITEMS],
    });

    await usePulseConfigStore.getState().reset();

    const keys = removeQueriesMock.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toEqual([["conid"], ["quote"], ["candles"]]);
  });

  it("does NOT flush caches when reset fails", async () => {
    mockedApi.resetPulseConfig.mockRejectedValueOnce(new Error("down"));

    await expect(usePulseConfigStore.getState().reset()).rejects.toThrow("down");

    expect(removeQueriesMock).not.toHaveBeenCalled();
  });
});
