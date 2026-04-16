/**
 * useIbkrReadyTier unit tests (Phase 7.4a)
 *
 * Tests the staggered gate hook in isolation by mocking useIbkrReady.
 * Uses fake timers to verify tier delays without real waiting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIbkrReadyTier } from "../hooks/useIbkrReadyTier";

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

describe("useIbkrReadyTier", () => {
  describe("tier 1 (no delay)", () => {
    it("returns false when ibkrReady is false", () => {
      mockIbkrReady = false;
      const { result } = renderHook(() => useIbkrReadyTier(1));
      expect(result.current).toBe(false);
    });

    it("returns true immediately when ibkrReady becomes true", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(1));
      // No timer needed — tier 1 fires synchronously
      act(() => { vi.advanceTimersByTime(0); });
      expect(result.current).toBe(true);
    });
  });

  describe("tier 2 (800ms delay)", () => {
    it("returns false immediately even when ibkrReady is true", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(2));
      expect(result.current).toBe(false);
    });

    it("returns false before 800ms have elapsed", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(2));
      act(() => { vi.advanceTimersByTime(799); });
      expect(result.current).toBe(false);
    });

    it("returns true at exactly 800ms", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(2));
      act(() => { vi.advanceTimersByTime(800); });
      expect(result.current).toBe(true);
    });
  });

  describe("tier 3 (2000ms delay)", () => {
    it("returns false before 2000ms have elapsed", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(3));
      act(() => { vi.advanceTimersByTime(1_999); });
      expect(result.current).toBe(false);
    });

    it("returns true at exactly 2000ms", () => {
      mockIbkrReady = true;
      const { result } = renderHook(() => useIbkrReadyTier(3));
      act(() => { vi.advanceTimersByTime(2_000); });
      expect(result.current).toBe(true);
    });
  });

  describe("reset on disconnect", () => {
    it("resets to false when ibkrReady drops, re-staggers on reconnect", () => {
      mockIbkrReady = true;
      const { result, rerender } = renderHook(() => useIbkrReadyTier(2));
      act(() => { vi.advanceTimersByTime(800); });
      expect(result.current).toBe(true);

      // Simulate disconnect
      mockIbkrReady = false;
      rerender();
      expect(result.current).toBe(false);

      // Reconnect — delay should apply again
      mockIbkrReady = true;
      rerender();
      act(() => { vi.advanceTimersByTime(799); });
      expect(result.current).toBe(false);

      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current).toBe(true);
    });
  });
});
