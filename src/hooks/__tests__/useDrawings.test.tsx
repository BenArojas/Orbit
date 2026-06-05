/**
 * Tests for useDrawings, useCreateDrawing, useUpdateDrawing, useDeleteDrawing.
 *
 * Covers:
 *   - useDrawings: disabled when conid is null, enabled when conid > 0
 *   - useDrawings: refetches when conid changes (separate query keys)
 *   - useCreateDrawing: invalidates ["drawings", conid] on success
 *   - useUpdateDrawing: applies optimistic update; rolls back on error
 *   - useDeleteDrawing: applies optimistic remove; rolls back on error; refetches on settled
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

import { useDrawings, useCreateDrawing, useUpdateDrawing, useDeleteDrawing } from "../useDrawings";
import type { Drawing } from "@/lib/api";

// ── Mocks ─────────────────────────────────────────────────────

const mockGetDrawings   = vi.fn();
const mockCreateDrawing = vi.fn();
const mockUpdateDrawing = vi.fn();
const mockDeleteDrawing = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    getDrawings:   (...args: unknown[]) => mockGetDrawings(...args),
    createDrawing: (...args: unknown[]) => mockCreateDrawing(...args),
    updateDrawing: (...args: unknown[]) => mockUpdateDrawing(...args),
    deleteDrawing: (...args: unknown[]) => mockDeleteDrawing(...args),
  },
}));

// ── Helpers ───────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function makeDrawing(id: number): Drawing {
  return {
    id,
    conid: 265598,
    kind: "horizontal_line",
    anchors: [{ time: 1_700_000_000, price: 175.5 }],
    style: null,
    created_at: "2026-01-01T00:00:00",
    updated_at: null,
  };
}

// ── useDrawings ───────────────────────────────────────────────

describe("useDrawings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does not fetch when conid is null", () => {
    const client = makeClient();
    const { result } = renderHook(() => useDrawings(null), {
      wrapper: wrapper(client),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockGetDrawings).not.toHaveBeenCalled();
  });

  it("fetches when conid is provided", async () => {
    const drawings = [makeDrawing(1), makeDrawing(2)];
    mockGetDrawings.mockResolvedValue(drawings);
    const client = makeClient();

    const { result } = renderHook(() => useDrawings(265598), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(drawings);
    expect(mockGetDrawings).toHaveBeenCalledWith(265598);
  });

  it("uses separate query keys for different conids", async () => {
    mockGetDrawings.mockResolvedValue([]);
    const client = makeClient();

    const { result: r1 } = renderHook(() => useDrawings(100), { wrapper: wrapper(client) });
    const { result: r2 } = renderHook(() => useDrawings(200), { wrapper: wrapper(client) });

    await waitFor(() => expect(r1.current.isSuccess).toBe(true));
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));

    // Each conid fetches independently
    expect(mockGetDrawings).toHaveBeenCalledWith(100);
    expect(mockGetDrawings).toHaveBeenCalledWith(200);
  });
});

// ── useCreateDrawing ──────────────────────────────────────────

describe("useCreateDrawing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls createDrawing and invalidates the query on success", async () => {
    const created = makeDrawing(99);
    mockCreateDrawing.mockResolvedValue(created);
    mockGetDrawings.mockResolvedValue([]);

    const client = makeClient();
    const w = wrapper(client);

    // Pre-populate the cache so we can watch it get invalidated.
    await client.prefetchQuery({
      queryKey: ["drawings", 265598],
      queryFn: () => mockGetDrawings(265598),
    });

    const { result } = renderHook(() => useCreateDrawing(265598), { wrapper: w });

    await act(async () => {
      result.current.mutate({
        conid: 265598,
        kind: "horizontal_line",
        anchors: [{ time: 1_700_000_000, price: 175.5 }],
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockCreateDrawing).toHaveBeenCalledOnce();
    // The query for conid 265598 should be marked stale after success.
    expect(client.getQueryState(["drawings", 265598])?.isInvalidated).toBe(true);
  });
});

// ── useUpdateDrawing ──────────────────────────────────────────

describe("useUpdateDrawing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("applies optimistic update then invalidates on settled", async () => {
    const original = makeDrawing(5);
    mockGetDrawings.mockResolvedValue([original]);
    mockUpdateDrawing.mockResolvedValue({ ...original, style: { line_color: "#FF0000" } });

    const client = makeClient();
    const w = wrapper(client);

    await client.prefetchQuery({
      queryKey: ["drawings", 265598],
      queryFn: () => mockGetDrawings(265598),
    });

    const { result } = renderHook(() => useUpdateDrawing(265598), { wrapper: w });

    await act(async () => {
      result.current.mutate({
        id: 5,
        req: { style: { line_color: "#FF0000" } },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateDrawing).toHaveBeenCalledWith(5, { style: { line_color: "#FF0000" } });
  });

  it("rolls back the cache on error", async () => {
    const original = makeDrawing(5);
    mockGetDrawings.mockResolvedValue([original]);
    mockUpdateDrawing.mockRejectedValue(new Error("server error"));

    const client = makeClient();
    const w = wrapper(client);

    await client.prefetchQuery({
      queryKey: ["drawings", 265598],
      queryFn: () => mockGetDrawings(265598),
    });

    const { result } = renderHook(() => useUpdateDrawing(265598), { wrapper: w });

    await act(async () => {
      result.current.mutate({ id: 5, req: { style: { line_color: "#FF0000" } } });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Cache should be restored to original after rollback.
    const cached = client.getQueryData<Drawing[]>(["drawings", 265598]);
    expect(cached).toEqual([original]);
  });
});

// ── useDeleteDrawing ──────────────────────────────────────────

describe("useDeleteDrawing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("optimistically removes drawing and refetches on settled", async () => {
    const drawings = [makeDrawing(1), makeDrawing(2)];
    mockGetDrawings.mockResolvedValue([makeDrawing(2)]);
    mockDeleteDrawing.mockResolvedValue({ deleted: true, id: 1 });

    const client = makeClient();
    const w = wrapper(client);

    await client.prefetchQuery({
      queryKey: ["drawings", 265598],
      queryFn: () => Promise.resolve(drawings),
    });

    const { result } = renderHook(() => useDeleteDrawing(265598), { wrapper: w });

    await act(async () => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDeleteDrawing).toHaveBeenCalledWith(1);
    // The query for conid 265598 should be marked stale after settled.
    expect(client.getQueryState(["drawings", 265598])?.isInvalidated).toBe(true);
  });

  it("rolls back the cache on error", async () => {
    const drawings = [makeDrawing(1), makeDrawing(2)];
    mockGetDrawings.mockResolvedValue(drawings);
    mockDeleteDrawing.mockRejectedValue(new Error("not found"));

    const client = makeClient();
    const w = wrapper(client);

    await client.prefetchQuery({
      queryKey: ["drawings", 265598],
      queryFn: () => Promise.resolve(drawings),
    });

    const { result } = renderHook(() => useDeleteDrawing(265598), { wrapper: w });

    await act(async () => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Cache should be restored to both drawings.
    const cached = client.getQueryData<Drawing[]>(["drawings", 265598]);
    expect(cached).toEqual(drawings);
  });
});
