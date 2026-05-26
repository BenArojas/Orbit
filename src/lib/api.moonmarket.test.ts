import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function okJson(body: unknown = {}): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("MoonMarket API client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the MoonMarket accounts endpoint", async () => {
    await api.moonmarketAccounts();

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/moonmarket/accounts");
    expect(options).toMatchObject({ method: "GET" });
  });

  it("encodes account ids for portfolio and performance endpoints", async () => {
    await api.moonmarketPortfolio("DU 123");
    await api.moonmarketPerformance("DU 123", "YTD");

    const portfolioUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    const performanceUrl = String(vi.mocked(fetch).mock.calls[1][0]);

    expect(portfolioUrl).toContain("/moonmarket/portfolio?account_id=DU%20123");
    expect(performanceUrl).toContain("/moonmarket/performance?account_id=DU%20123&period=YTD");
  });
});
