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

  it("encodes account ids and days for trades and live orders endpoints", async () => {
    await api.moonmarketTrades("DU 123", 7);
    await api.moonmarketLiveOrders("DU 123");

    const tradesUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    const liveOrdersUrl = String(vi.mocked(fetch).mock.calls[1][0]);

    expect(tradesUrl).toContain("/moonmarket/trades?account_id=DU%20123&days=7");
    expect(liveOrdersUrl).toContain("/moonmarket/live-orders?account_id=DU%20123");
  });

  it("calls MoonMarket order preview and placement endpoints", async () => {
    const order = { conid: 265598, side: "BUY" as const, quantity: 5, orderType: "LMT" as const, tif: "DAY" as const, price: 180 };

    await api.moonmarketPreviewOrder({ account_id: "DU 123", order });
    await api.moonmarketPlaceOrders({ account_id: "DU 123", orders: [order] });

    const previewUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    const previewOptions = vi.mocked(fetch).mock.calls[0][1];
    const placeUrl = String(vi.mocked(fetch).mock.calls[1][0]);
    const placeOptions = vi.mocked(fetch).mock.calls[1][1];

    expect(previewUrl).toContain("/moonmarket/orders/preview");
    expect(previewOptions).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(previewOptions?.body))).toEqual({ account_id: "DU 123", order });
    expect(placeUrl).toContain("/moonmarket/orders");
    expect(placeOptions).toMatchObject({ method: "POST" });
  });

  it("encodes MoonMarket order reply, cancel, and modify endpoints", async () => {
    const order = { conid: 265598, side: "BUY" as const, quantity: 5, orderType: "LMT" as const, tif: "DAY" as const, price: 181 };

    await api.moonmarketReplyOrder("DU 123", "reply/1", true);
    await api.moonmarketCancelOrder("DU 123", "order/1");
    await api.moonmarketModifyOrder("DU 123", "order/1", order);

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/moonmarket/orders/DU%20123/reply/reply%2F1");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ confirmed: true });
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("/moonmarket/orders/DU%20123/order%2F1");
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({ method: "DELETE" });
    expect(vi.mocked(fetch).mock.calls[2][1]).toMatchObject({ method: "PATCH" });
  });
});
