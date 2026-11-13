import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { sidecarRequest } from "./sidecarClient";
import { sessionProtocols } from "./sidecarSession";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

it("shares one native session across mutations and streams without a URL or browser-storage secret", async () => {
  const secret = "a".repeat(64); // Test credential only.
  vi.mocked(invoke).mockResolvedValue(secret);
  const fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ saved: true }),
  });
  vi.stubGlobal("fetch", fetch);
  await sidecarRequest("PUT", "/settings/example", { value: "test" });
  await sidecarRequest("DELETE", "/drawings/1");
  expect(await sessionProtocols()).toEqual(["orbit-session", secret]);
  expect(invoke).toHaveBeenCalledTimes(1);
  for (const [url, options] of fetch.mock.calls) {
    expect(url).not.toContain(secret);
    expect(options.headers["X-Orbit-Session"]).toBe(secret);
    expect(options.body ?? "").not.toContain(secret);
  }
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(secret);
});
