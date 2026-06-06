import { describe, expect, it, vi } from "vitest";
import {
  buildOrderRefreshPlan,
  buildOrderChain,
  buildOrderDraft,
  buildOrderSubmission,
  classifyOrderResult,
  deriveOrderTracker,
  orderTypesFromRules,
  outsideRthOrderTypesFromRules,
  type OrderLifecycleInput,
} from "../orderLifecycle";

function baseInput(overrides: Partial<OrderLifecycleInput> = {}): OrderLifecycleInput {
  return {
    conid: 265598,
    assetClass: "STK",
    side: "BUY",
    quantity: 5,
    orderType: "LMT",
    tif: "DAY",
    price: "180",
    auxPrice: "",
    trailingType: "%",
    trailingAmt: "",
    outsideRth: false,
    canUseOutsideRth: true,
    takeProfitEnabled: false,
    stopLossEnabled: false,
    profitTakerPrice: "",
    stopLossPrice: "",
    newClientOrderId: () => "parent-1",
    ...overrides,
  };
}

describe("OrderTicket lifecycle draft construction", () => {
  it("normalizes a base limit order draft", () => {
    expect(buildOrderDraft(baseInput({ outsideRth: true }))).toEqual({
      conid: 265598,
      assetClass: "STK",
      side: "BUY",
      quantity: 5,
      orderType: "LMT",
      tif: "DAY",
      price: 180,
      auxPrice: undefined,
      trailingType: undefined,
      trailingAmt: undefined,
      outsideRTH: true,
    });
  });

  it("normalizes IBKR order-rule wire values into ticket order types", () => {
    expect(orderTypesFromRules(["MKT", "LMT", "STP LMT", "trailing_stop_limit"])).toEqual([
      "MKT",
      "LMT",
      "STP_LIMIT",
      "TRAILLMT",
    ]);
  });

  it("uses the fallback outside-RTH order types only when rules are absent", () => {
    expect([...outsideRthOrderTypesFromRules(undefined)]).toEqual(["LMT", "STP_LIMIT", "TRAILLMT"]);
    expect([...outsideRthOrderTypesFromRules([])]).toEqual([]);
  });

  it("builds a stock bracket chain from protective order settings", () => {
    const result = buildOrderChain(baseInput({
      takeProfitEnabled: true,
      stopLossEnabled: true,
      profitTakerPrice: "190",
      stopLossPrice: "175",
    }));

    expect(result.errors).toEqual([]);
    expect(result.orders).toEqual([
      expect.objectContaining({ side: "BUY", cOID: "parent-1" }),
      {
        conid: 265598,
        assetClass: "STK",
        parentId: "parent-1",
        side: "SELL",
        quantity: 5,
        orderType: "LMT",
        tif: "GTC",
        price: 190,
        isSingleGroup: true,
      },
      {
        conid: 265598,
        assetClass: "STK",
        parentId: "parent-1",
        side: "SELL",
        quantity: 5,
        orderType: "STP",
        tif: "GTC",
        price: 175,
        isSingleGroup: true,
      },
    ]);
  });

  it("keeps option orders single-leg even when protective toggles are enabled", () => {
    const createId = vi.fn(() => "parent-1");

    const result = buildOrderChain(baseInput({
      assetClass: "OPT",
      takeProfitEnabled: true,
      stopLossEnabled: true,
      profitTakerPrice: "190",
      stopLossPrice: "175",
      newClientOrderId: createId,
    }));

    expect(result.errors).toEqual([]);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({ assetClass: "OPT" });
    expect(result.orders[0]).not.toHaveProperty("cOID");
    expect(createId).not.toHaveBeenCalled();
  });

  it("returns validation errors instead of bracket orders when protective prices are missing", () => {
    const result = buildOrderChain(baseInput({
      takeProfitEnabled: true,
      stopLossEnabled: true,
    }));

    expect(result.orders).toEqual([]);
    expect(result.errors).toEqual([
      "Profit taker price is required.",
      "Stop loss price is required.",
    ]);
  });

  it("returns submit validation errors before building orders", () => {
    const result = buildOrderSubmission(baseInput({
      quantity: 0,
      orderType: "STP_LIMIT",
      price: "0",
      auxPrice: "",
    }));

    expect(result.orders).toEqual([]);
    expect(result.errors).toEqual([
      "Quantity must be greater than zero.",
      "Stop-limit orders require both a stop price and a limit price.",
      "Limit price must be greater than zero.",
    ]);
  });
});

describe("OrderTicket lifecycle result parsing", () => {
  it("classifies reply-required IBKR responses", () => {
    expect(classifyOrderResult({
      account_id: "DU12345",
      result: [{ id: 123, message: ["Confirm this order?"], messageOptions: ["Yes", "No"] }],
    })).toEqual({
      kind: "reply_required",
      replyId: "123",
      orderId: null,
      rejected: false,
    });
  });

  it("classifies final order responses from nested data rows", () => {
    expect(classifyOrderResult({
      account_id: "DU12345",
      result: { data: [{ order_id: "order-1", order_status: "Submitted" }] },
    })).toEqual({
      kind: "submitted",
      replyId: null,
      orderId: "order-1",
      rejected: false,
    });
  });

  it("classifies rejected or inactive order rows without treating them as submitted", () => {
    expect(classifyOrderResult({
      account_id: "DU12345",
      result: [{ order_id: "order-1", order_status: "Inactive" }],
    })).toEqual({
      kind: "rejected",
      replyId: null,
      orderId: "order-1",
      rejected: true,
    });
  });

  it("classifies explicit IBKR error rows as rejected", () => {
    expect(classifyOrderResult({
      account_id: "DU12345",
      result: [{ error: "10/Order rejected: insufficient margin" }],
    })).toEqual({
      kind: "rejected",
      replyId: null,
      orderId: null,
      rejected: true,
    });
  });
});

describe("OrderTicket lifecycle fill-state derivation", () => {
  it("derives a filled tracker from live order status and matching post-submit trades", () => {
    expect(deriveOrderTracker({
      trackedOrder: {
        orderId: "order-1",
        submittedAt: 1_000,
        order: {
          conid: 265598,
          assetClass: "STK",
          side: "BUY",
          quantity: 3,
          orderType: "MKT",
          tif: "DAY",
        },
      },
      liveOrders: [{
        order_id: "order-1",
        conid: 265598,
        symbol: "AAPL",
        description: "BUY 3 AAPL MARKET",
        side: "BUY",
        order_type: "MKT",
        quantity: 3,
        remaining_quantity: 0,
        limit_price: null,
        aux_price: null,
        trailing_type: null,
        trailing_amt: null,
        outside_rth: false,
        tif: "DAY",
        status: "Filled",
      }],
      trades: [{
        execution_id: "E1",
        account_id: "DU12345",
        conid: 265598,
        symbol: "AAPL",
        description: null,
        side: "BUY",
        quantity: 3,
        price: 181.25,
        net_amount: null,
        commission: null,
        sec_type: "STK",
        trade_time: "2026-06-04T19:40:00+00:00",
        trade_time_ms: 1_100,
      }],
      currentPrice: 181.25,
    })).toEqual({
      orderId: "order-1",
      orderType: "MKT",
      status: "filled",
      quantity: 3,
      filledQuantity: 3,
      averagePrice: 181.25,
    });
  });

  it("ignores matching trades that predate submit time and keeps the order pending", () => {
    expect(deriveOrderTracker({
      trackedOrder: {
        orderId: "order-1",
        submittedAt: 1_000,
        order: {
          conid: 265598,
          assetClass: "STK",
          side: "BUY",
          quantity: 5,
          orderType: "LMT",
          tif: "DAY",
          price: 180,
        },
      },
      liveOrders: [{
        order_id: "order-1",
        conid: 265598,
        symbol: "AAPL",
        description: "BUY 5 AAPL LIMIT 180.00",
        side: "BUY",
        order_type: "LMT",
        quantity: 5,
        remaining_quantity: 5,
        limit_price: 180,
        aux_price: null,
        trailing_type: null,
        trailing_amt: null,
        outside_rth: false,
        tif: "DAY",
        status: "Submitted",
      }],
      trades: [{
        execution_id: "E-old",
        account_id: "DU12345",
        conid: 265598,
        symbol: "AAPL",
        description: null,
        side: "BUY",
        quantity: 3,
        price: 179.9,
        net_amount: null,
        commission: null,
        sec_type: "STK",
        trade_time: "2026-06-04T19:39:00+00:00",
        trade_time_ms: 900,
      }],
      currentPrice: 181.1,
    })).toEqual({
      orderId: "order-1",
      orderType: "LMT",
      status: "pending",
      liveStatus: "Submitted",
      quantity: 5,
      filledQuantity: 0,
      currentPrice: 181.1,
      limitPrice: 180,
      distancePercent: 0.61,
      remainingQuantity: 5,
    });
  });

  it("derives a partial fill from remaining quantity", () => {
    expect(deriveOrderTracker({
      trackedOrder: {
        orderId: "order-1",
        submittedAt: 1_000,
        order: {
          conid: 265598,
          assetClass: "STK",
          side: "BUY",
          quantity: 5,
          orderType: "LMT",
          tif: "DAY",
          price: 180,
        },
      },
      liveOrders: [{
        order_id: "order-1",
        conid: 265598,
        symbol: "AAPL",
        description: "BUY 5 AAPL LIMIT 180.00",
        side: "BUY",
        order_type: "LMT",
        quantity: 5,
        remaining_quantity: 2,
        limit_price: 180,
        aux_price: null,
        trailing_type: null,
        trailing_amt: null,
        outside_rth: false,
        tif: "DAY",
        status: "Submitted",
      }],
      trades: [],
      currentPrice: 181.1,
    })).toEqual({
      orderId: "order-1",
      orderType: "LMT",
      status: "partial",
      liveStatus: "Submitted",
      quantity: 5,
      filledQuantity: 3,
      currentPrice: 181.1,
      limitPrice: 180,
      distancePercent: 0.61,
      remainingQuantity: 2,
    });
  });
});

describe("OrderTicket lifecycle refresh planning", () => {
  it("plans revalidation and quote invalidation after a submitted order", () => {
    expect(buildOrderRefreshPlan({
      accountId: "DU12345",
      conid: 265598,
      reason: "submitted",
    })).toEqual({
      revalidatePositions: true,
      invalidateQueryKeys: [
        ["moonmarket", "portfolio", "DU12345"],
        ["moonmarket", "live-orders", "DU12345"],
        ["moonmarket", "funds", "DU12345"],
        ["moonmarket", "trades", "DU12345"],
        ["market", "quote", 265598],
      ],
    });
  });

  it("plans account refreshes after a filled order without revalidating positions", () => {
    expect(buildOrderRefreshPlan({
      accountId: "DU12345",
      conid: 265598,
      reason: "filled",
    })).toEqual({
      revalidatePositions: false,
      invalidateQueryKeys: [
        ["moonmarket", "portfolio", "DU12345"],
        ["moonmarket", "funds", "DU12345"],
        ["moonmarket", "live-orders", "DU12345"],
        ["moonmarket", "trades", "DU12345"],
      ],
    });
  });

  it("uses the same account refresh set after a cancelled order", () => {
    expect(buildOrderRefreshPlan({
      accountId: "DU12345",
      conid: 265598,
      reason: "cancelled",
    })).toEqual({
      revalidatePositions: false,
      invalidateQueryKeys: [
        ["moonmarket", "portfolio", "DU12345"],
        ["moonmarket", "funds", "DU12345"],
        ["moonmarket", "live-orders", "DU12345"],
        ["moonmarket", "trades", "DU12345"],
      ],
    });
  });
});
