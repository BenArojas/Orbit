import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parallaxApi } from "@/modules/parallax/api";

describe("API client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats 204 No Content responses as successful void calls", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as Response);

    await expect(parallaxApi.dismissTriggerHit(42)).resolves.toBeUndefined();
  });
});
