/**
 * Contract tests for MoonMarket endpoint paths and request encoding.
 *
 * These tests intentionally mock fetch at the transport boundary. Runtime
 * behavior such as 204 parsing and ApiError handling is covered by
 * src/lib/sidecarClient.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moonmarketApi } from "@/modules/moonmarket/api";
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
    await moonmarketApi.moonmarketAccounts();

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/moonmarket/accounts");
    expect(options).toMatchObject({ method: "GET" });
  });

  it("encodes account ids for portfolio and performance endpoints", async () => {
    await moonmarketApi.moonmarketPortfolio("DU 123");
    await moonmarketApi.moonmarketPerformance("DU 123", "YTD");

    const portfolioUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    const performanceUrl = String(vi.mocked(fetch).mock.calls[1][0]);

    expect(portfolioUrl).toContain("/moonmarket/portfolio?account_id=DU%20123");
    expect(performanceUrl).toContain("/moonmarket/performance?account_id=DU%20123&period=YTD");
  });

  it("encodes account ids and days for trades and live orders endpoints", async () => {
    await moonmarketApi.moonmarketTrades("DU 123", 7);
    await moonmarketApi.moonmarketLiveOrders("DU 123");

    const tradesUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    const liveOrdersUrl = String(vi.mocked(fetch).mock.calls[1][0]);

    expect(tradesUrl).toContain("/moonmarket/trades?account_id=DU%20123&days=7");
    expect(liveOrdersUrl).toContain("/moonmarket/live-orders?account_id=DU%20123");
  });

  it("calls MoonMarket order preview and placement endpoints", async () => {
    const order = { conid: 265598, side: "BUY" as const, quantity: 5, orderType: "LMT" as const, tif: "DAY" as const, price: 180 };

    await moonmarketApi.moonmarketPreviewOrder({ account_id: "DU 123", order });
    await moonmarketApi.moonmarketPlaceOrders({ account_id: "DU 123", orders: [order] });

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

    await moonmarketApi.moonmarketReplyOrder("DU 123", "reply/1", true);
    await moonmarketApi.moonmarketCancelOrder("DU 123", "order/1");
    await moonmarketApi.moonmarketModifyOrder("DU 123", "order/1", order);

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/moonmarket/orders/DU%20123/reply/reply%2F1");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ confirmed: true });
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("/moonmarket/orders/DU%20123/order%2F1");
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({ method: "DELETE" });
    expect(vi.mocked(fetch).mock.calls[2][1]).toMatchObject({ method: "PATCH" });
  });

  it("encodes the MoonMarket trading safety order-action endpoint", async () => {
    await moonmarketApi.moonmarketTradingSafetyOrderAction("DU 123", "place");

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/moonmarket/trading-safety/order-action?account_id=DU%20123&action=place");
    expect(options).toMatchObject({ method: "GET" });
  });

  it("calls MoonMarket position revalidation endpoint", async () => {
    await moonmarketApi.moonmarketRevalidatePositions("DU 123");

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/moonmarket/accounts/DU%20123/positions/revalidate");
    expect(options).toMatchObject({ method: "POST" });
  });

  it("calls MoonMarket contract order rules endpoint", async () => {
    await moonmarketApi.moonmarketOrderRules("DU 123", 265598, "SELL");

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/moonmarket/accounts/DU%20123/contracts/265598/order-rules?side=SELL");
    expect(options).toMatchObject({ method: "GET" });
  });

  it("encodes MoonMarket options chain endpoints", async () => {
    await moonmarketApi.moonmarketOptionExpirations(265598, "AAPL Class A");
    await moonmarketApi.moonmarketOptionChain(265598, "JUN24");
    await moonmarketApi.moonmarketOptionContract(265598, "JUN24", 180);

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
      "/moonmarket/options/expirations/265598?symbol=AAPL%20Class%20A",
    );
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain(
      "/moonmarket/options/chain/265598?expiration=JUN24",
    );
    expect(String(vi.mocked(fetch).mock.calls[2][0])).toContain(
      "/moonmarket/options/contract/265598?expiration=JUN24&strike=180",
    );
  });
});
