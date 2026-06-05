/**
 * Tests for useLiveQuotes — pinning the "no churn" subscription contract.
 *
 * The bug these tests prevent: when MarketPulse adds a newly-resolved
 * conid to its tracked list, the hook used to drain ALL existing
 * subscriptions in the effect cleanup, then re-subscribe everything in
 * the new effect body. On cold load that meant a 12-deep cascade of
 * full subscribe-storms — each new conid resolution caused N umd + N+1
 * smd commands hitting IBKR. The user felt this as the "3-5s stuck and
 * buggy" navigation experience.
 *
 * The fix: subscribe/unsubscribe only the delta (new/removed conids);
 * never drain the whole set on a dep change. The unmount cleanup is
 * the only place that drains everything.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLiveQuotes } from "../useLiveQuotes";

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock("../useWebSocket", () => ({
  useWebSocket: () => ({
    status: "connected",
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    addHandler: () => () => {},
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useLiveQuotes — subscription churn", () => {
  it("subscribes once per conid on mount", () => {
    renderHook(() => useLiveQuotes([265598, 320227571]));
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(mockSubscribe).toHaveBeenCalledWith(265598);
    expect(mockSubscribe).toHaveBeenCalledWith(320227571);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it("adding a new conid does NOT re-subscribe the existing ones", () => {
    const { rerender } = renderHook(
      ({ conids }: { conids: number[] }) => useLiveQuotes(conids),
      { initialProps: { conids: [265598, 320227571] } },
    );
    expect(mockSubscribe).toHaveBeenCalledTimes(2);

    // Simulate a third conid resolving later (the MarketPulse cold-load case)
    rerender({ conids: [265598, 320227571, 756733] });

    // Critical: only ONE new subscribe call (for the new conid), no
    // unsubscribe/re-subscribe of the existing two.
    expect(mockSubscribe).toHaveBeenCalledTimes(3);
    expect(mockSubscribe).toHaveBeenLastCalledWith(756733);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it("removing a conid unsubscribes only the removed one", () => {
    const { rerender } = renderHook(
      ({ conids }: { conids: number[] }) => useLiveQuotes(conids),
      { initialProps: { conids: [265598, 320227571, 756733] } },
    );
    expect(mockSubscribe).toHaveBeenCalledTimes(3);

    rerender({ conids: [265598, 756733] });

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).toHaveBeenCalledWith(320227571);
    // The remaining two stay subscribed — no further subscribe calls.
    expect(mockSubscribe).toHaveBeenCalledTimes(3);
  });

  it("re-rendering with an identical conid list does nothing", () => {
    const { rerender } = renderHook(
      ({ conids }: { conids: number[] }) => useLiveQuotes(conids),
      { initialProps: { conids: [265598, 320227571] } },
    );
    expect(mockSubscribe).toHaveBeenCalledTimes(2);

    // Brand-new array, same contents — React's dep comparison should
    // see the same joined-string key and not re-run.
    rerender({ conids: [265598, 320227571] });
    rerender({ conids: [265598, 320227571] });

    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it("unmount drains the whole subscription set exactly once", () => {
    const { unmount } = renderHook(() => useLiveQuotes([265598, 320227571, 756733]));
    expect(mockSubscribe).toHaveBeenCalledTimes(3);
    expect(mockUnsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(3);
    expect(mockUnsubscribe).toHaveBeenCalledWith(265598);
    expect(mockUnsubscribe).toHaveBeenCalledWith(320227571);
    expect(mockUnsubscribe).toHaveBeenCalledWith(756733);
  });
});
