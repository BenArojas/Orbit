/**
 * useIbkrReadyTier unit tests — Phase 8 / Task 3.4 (4-tier, 800ms total)
 *
 * Tests the staggered gate hook in isolation by mocking useIbkrReady.
 * Uses fake timers to verify tier delays without real waiting.
 *
 * Tier map (Task 3.4):
 *   Tier 1 —   0ms — MarketPulse, ArcGaugeRow
 *   Tier 2 — 200ms — SectorPerformancePanel, RRGPanel
 *   Tier 3 — 400ms — WatchlistSidebar, TriggerWatchlist
 *   Tier 4 — 800ms — TriggerRules, AlertLog
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIbkrReadyTier, TIER_DELAY_MS, type Tier } from "../hooks/useIbkrReadyTier";

// Mock the GatewayContext module so we can control ibkrReady.
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

describe("useIbkrReadyTier (4 tiers, 800ms total)", () => {
  // ── Constants ──────────────────────────────────────────────

  describe("TIER_DELAY_MS constants", () => {
    it("has exactly 4 tiers", () => {
      expect(Object.keys(TIER_DELAY_MS)).toHaveLength(4);
    });

    it("tier 1 is immediate (0ms)", () => {
      expect(TIER_DELAY_MS[1]).toBe(0);
    });

    it("tier 2 is 200ms", () => {
      expect(TIER_DELAY_MS[2]).toBe(200);
    });

    it("tier 3 is 400ms", () => {
      expect(TIER_DELAY_MS[3]).toBe(400);
    });

    it("tier 4 is 800ms (total cascade duration)", () => {
      expect(TIER_DELAY_MS[4]).toBe(800);
    });
  });

  // ── Tier 1 (0ms) ──────────────────────────────────────────

  describe("tier 1 — immediate (MarketPulse, ArcGaugeRow)", () => {
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

  // ── Tier 4 (800ms) ────────────────────────────────────────

  describe("tier 4 — 800ms (TriggerRules, AlertLog)", () => {
    it("returns false at 799ms", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(4));
      act(() => { vi.advanceTimersByTime(799); });
      expect(result.current).toBe(false);
    });

    it("returns true at exactly 800ms", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(4));
      act(() => { vi.advanceTimersByTime(800); });
      expect(result.current).toBe(true);
    });
  });

  // ── Cascade ordering ───────────────────────────────────────

  describe("all tiers fire in ascending order", () => {
    it("at t=200ms: tiers 1+2 ready, 3+4 not", () => {
      mockIbkrReady = true;
      const hooks = ([1, 2, 3, 4] as Tier[]).map((t) =>
        renderHook(() => useIbkrReadyTier(t)),
      );
      act(() => { vi.advanceTimersByTime(200); });
      expect(hooks.map((h) => h.result.current)).toEqual([true, true, false, false]);
    });

    it("at t=400ms: tiers 1+2+3 ready, 4 not", () => {
      mockIbkrReady = true;
      const hooks = ([1, 2, 3, 4] as Tier[]).map((t) =>
        renderHook(() => useIbkrReadyTier(t)),
      );
      act(() => { vi.advanceTimersByTime(400); });
      expect(hooks.map((h) => h.result.current)).toEqual([true, true, true, false]);
    });

    it("at t=800ms: all 4 tiers ready", () => {
      mockIbkrReady = true;
      const hooks = ([1, 2, 3, 4] as Tier[]).map((t) =>
        renderHook(() => useIbkrReadyTier(t)),
      );
      act(() => { vi.advanceTimersByTime(800); });
      expect(hooks.map((h) => h.result.current)).toEqual([true, true, true, true]);
    });
  });

  // ── Reset on disconnect ────────────────────────────────────

  describe("reset on disconnect", () => {
    it("resets to false when ibkrReady drops, re-staggers on reconnect", () => {
      mockIbkrReady = true;
      const { result, rerender } = renderHook(() => useIbkrReadyTier(3));
      act(() => { vi.advanceTimersByTime(400); });
      expect(result.current).toBe(true);

      // Simulate disconnect
      mockIbkrReady = false;
      rerender();
      expect(result.current).toBe(false);

      // Reconnect — the 400ms delay must apply again
      mockIbkrReady = true;
      rerender();
      act(() => { vi.advanceTimersByTime(399); });
      expect(result.current).toBe(false);

      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current).toBe(true);
    });

    it("tier 1 also resets to false on disconnect and recovers immediately", () => {
      mockIbkrReady = true;
      const { result, rerender } = renderHook(() => useIbkrReadyTier(1));
      act(() => { vi.advanceTimersByTime(0); });
      expect(result.current).toBe(true);

      mockIbkrReady = false;
      rerender();
      expect(result.current).toBe(false);

      mockIbkrReady = true;
      rerender();
      act(() => { vi.advanceTimersByTime(0); });
      expect(result.current).toBe(true);
    });
  });
});
