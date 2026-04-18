/**
 * useIbkrReadyTier unit tests
 *
 * Expanded to 9 tiers at 250ms each (Phase 8 / Task 8.9).
 * Tests the staggered gate hook in isolation by mocking useIbkrReady.
 * Uses fake timers to verify tier delays without real waiting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIbkrReadyTier, TIER_DELAY_MS, type Tier } from "../hooks/useIbkrReadyTier";

// Mock the GatewayContext module so we can control ibkrReady
let mockIbkrReady = false;
vi.mock("@/context/GatewayContext", () => ({
  useIbkrReady: () => mockIbkrReady,
}));

beforeEach(() => {
  mockIbkrReady = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useIbkrReadyTier (9 tiers, 250ms stagger)", () => {
  describe("TIER_DELAY_MS constants", () => {
    it("has exactly 9 tiers", () => {
      expect(Object.keys(TIER_DELAY_MS)).toHaveLength(9);
    });

    it("tier 1 is immediate (0ms)", () => {
      expect(TIER_DELAY_MS[1]).toBe(0);
    });

    it("each subsequent tier is +250ms", () => {
      for (let t = 2; t <= 9; t++) {
        const tier = t as Tier;
        const prev = (t - 1) as Tier;
        expect(TIER_DELAY_MS[tier] - TIER_DELAY_MS[prev]).toBe(250);
      }
    });

    it("tier 9 is 2000ms (total cascade duration)", () => {
      expect(TIER_DELAY_MS[9]).toBe(2_000);
    });
  });

  describe("tier 1 (no delay)", () => {
    it("returns false when ibkrReady is false", () => {
      mockIbkrReady = false;
      const { result } = renderHook(() => useIbkrReadyTier(1));
      expect(result.current).toBe(false);
    });

    it("returns true immediately when ibkrReady becomes true", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(1));
      act(() => { vi.advanceTimersByTime(0); });
      expect(result.current).toBe(true);
    });
  });

  describe("tier 5 (1000ms — watchlist sidebar)", () => {
    it("returns false before 1000ms elapses", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(5));
      act(() => { vi.advanceTimersByTime(999); });
      expect(result.current).toBe(false);
    });

    it("returns true at exactly 1000ms", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(5));
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(result.current).toBe(true);
    });
  });

  describe("tier 9 (2000ms — alert log)", () => {
    it("returns false before 2000ms elapses", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(9));
      act(() => { vi.advanceTimersByTime(1_999); });
      expect(result.current).toBe(false);
    });

    it("returns true at exactly 2000ms", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(9));
      act(() => { vi.advanceTimersByTime(2_000); });
      expect(result.current).toBe(true);
    });
  });

  describe("all tiers fire in ascending order", () => {
    it("at t=1000ms, tiers 1-5 are ready and 6-9 are not", () => {
      mockIbkrReady = true;
      const tierHooks = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) =>
        renderHook(() => useIbkrReadyTier(t as Tier))
      );
      act(() => { vi.advanceTimersByTime(1_000); });
      const ready = tierHooks.map((h) => h.result.current);
      expect(ready).toEqual([true, true, true, true, true, false, false, false, false]);
    });
  });

  describe("reset on disconnect", () => {
    it("resets to false when ibkrReady drops, re-staggers on reconnect", () => {
      mockIbkrReady = true;
      const { result, rerender } = renderHook(() => useIbkrReadyTier(3));
      act(() => { vi.advanceTimersByTime(500); });
      expect(result.current).toBe(true);

      // Simulate disconnect
      mockIbkrReady = false;
      rerender();
      expect(result.current).toBe(false);

      // Reconnect — delay should apply again
      mockIbkrReady = true;
      rerender();
      act(() => { vi.advanceTimersByTime(499); });
      expect(result.current).toBe(false);

      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current).toBe(true);
    });
  });
});
