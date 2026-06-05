/**
 * Toast integration tests (Phase 7.2 — shadcn Sonner)
 *
 * The custom Zustand store was replaced with shadcn's Sonner library.
 * These tests verify:
 *   1. The sonner module exports the expected API surface.
 *   2. toast methods are callable without throwing (no DOM needed).
 *   3. Callers can spy on toast methods — pattern used in component tests.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { toast } from "sonner";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sonner toast API surface", () => {
  it("exports success, error, warning, info, and dismiss", () => {
    expect(typeof toast.success).toBe("function");
    expect(typeof toast.error).toBe("function");
    expect(typeof toast.warning).toBe("function");
    expect(typeof toast.info).toBe("function");
    expect(typeof toast.dismiss).toBe("function");
  });

  it("toast.success() does not throw without a mounted Toaster", () => {
    expect(() => toast.success("Rule created")).not.toThrow();
  });

  it("toast.error() does not throw without a mounted Toaster", () => {
    expect(() => toast.error("Failed to update rule")).not.toThrow();
  });

  it("toast.warning() does not throw without a mounted Toaster", () => {
    expect(() => toast.warning("Session may have dropped")).not.toThrow();
  });

  it("toast.info() does not throw without a mounted Toaster", () => {
    expect(() => toast.info("Connecting to IBKR...")).not.toThrow();
  });

  it("toast.dismiss() with no args does not throw", () => {
    expect(() => toast.dismiss()).not.toThrow();
  });
});

describe("sonner toast spy interception", () => {
  // Pattern for component-level mutation tests: spy on sonner methods.

  it("spied toast.success records call arguments", () => {
    const spy = vi.spyOn(toast, "success");
    toast.success("Trigger rule created");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith("Trigger rule created");
  });

  it("spied toast.error records call arguments", () => {
    const spy = vi.spyOn(toast, "error");
    toast.error("Failed to create trigger rule");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith("Failed to create trigger rule");
  });

  it("spied toast.error records multiple distinct calls", () => {
    const spy = vi.spyOn(toast, "error");
    toast.error("Failed to update trigger rule");
    toast.error("Failed to delete trigger rule");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, "Failed to update trigger rule");
    expect(spy).toHaveBeenNthCalledWith(2, "Failed to delete trigger rule");
  });
});
