/**
 * Runtime tests for the shared sidecar transport layer.
 *
 * Product API tests should focus on endpoint paths and payload/query encoding;
 * this file owns shared fetch/error/offline/no-content behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, sidecarRequest } from "@/lib/sidecarClient";
import { NetworkOfflineError } from "@/lib/network";

function noContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    json: async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
  } as unknown as Response;
}

function response(body: unknown, init: Partial<Response> = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

describe("sidecarRequest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns JSON for successful responses", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ status: "ok" }));

    await expect(sidecarRequest("GET", "/health")).resolves.toEqual({
      status: "ok",
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/health"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("treats 204 No Content as successful undefined", async () => {
    vi.mocked(fetch).mockResolvedValue(noContentResponse());

    await expect(sidecarRequest("DELETE", "/trigger-hits/42")).resolves.toBeUndefined();
  });

  it("throws ApiError for non-ok JSON responses", async () => {
    vi.mocked(fetch).mockResolvedValue(
      response(
        { message: "Bad request", code: "bad_request" },
        { ok: false, status: 400 },
      ),
    );

    await expect(sidecarRequest("GET", "/broken")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      body: { message: "Bad request", code: "bad_request" },
    });

    await expect(sidecarRequest("GET", "/broken")).rejects.toBeInstanceOf(ApiError);
  });

  it("passes AbortError through without converting it", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.mocked(fetch).mockRejectedValue(abort);

    await expect(sidecarRequest("GET", "/slow")).rejects.toBe(abort);
  });

  it("converts fetch TypeError to NetworkOfflineError when navigator is offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(sidecarRequest("GET", "/health")).rejects.toBeInstanceOf(
      NetworkOfflineError,
    );
  });
});