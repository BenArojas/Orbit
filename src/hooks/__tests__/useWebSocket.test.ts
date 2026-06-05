/**
 * Tests for useWebSocket — subscription ref-counting.
 *
 * The singleton must keep a conid subscribed as long as ANY consumer
 * holds a subscription on it. unsubscribe() decrements; only the last
 * release emits the server-side unsubscribe.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocket, __resetWebSocketSingletonForTests } from "../useWebSocket";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    // Note: real browser WebSocket fires onclose asynchronously; this mock fires it synchronously.
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  __resetWebSocketSingletonForTests();
});

describe("useWebSocket subscription refcounting", () => {
  it("only emits one subscribe to the server when two consumers subscribe to the same conid", () => {
    const { result: a } = renderHook(() => useWebSocket());
    const { result: b } = renderHook(() => useWebSocket());

    const sock = MockWebSocket.instances[0];
    act(() => sock.open());

    act(() => {
      a.current.subscribe(123);
      b.current.subscribe(123);
    });

    const subMsgs = sock.sent.filter((s) => s.includes('"action":"subscribe"') && s.includes('"conid":123'));
    expect(subMsgs).toHaveLength(1);
  });

  it("keeps the subscription alive when one of two consumers unsubscribes", () => {
    const { result: a } = renderHook(() => useWebSocket());
    const { result: b } = renderHook(() => useWebSocket());

    const sock = MockWebSocket.instances[0];
    act(() => sock.open());

    act(() => {
      a.current.subscribe(123);
      b.current.subscribe(123);
      a.current.unsubscribe(123);
    });

    const unsubMsgs = sock.sent.filter((s) => s.includes('"action":"unsubscribe"') && s.includes('"conid":123'));
    expect(unsubMsgs).toHaveLength(0);
  });

  it("emits the server-side unsubscribe only when the last consumer releases", () => {
    const { result: a } = renderHook(() => useWebSocket());
    const { result: b } = renderHook(() => useWebSocket());

    const sock = MockWebSocket.instances[0];
    act(() => sock.open());

    act(() => {
      a.current.subscribe(123);
      b.current.subscribe(123);
      a.current.unsubscribe(123);
      b.current.unsubscribe(123);
    });

    const unsubMsgs = sock.sent.filter((s) => s.includes('"action":"unsubscribe"') && s.includes('"conid":123'));
    expect(unsubMsgs).toHaveLength(1);
  });

  it("re-subscribes each held conid exactly once on reconnect", () => {
    const { result: a } = renderHook(() => useWebSocket());
    const { result: b } = renderHook(() => useWebSocket());

    let sock = MockWebSocket.instances[0];
    act(() => sock.open());

    act(() => {
      a.current.subscribe(123);
      b.current.subscribe(123);
      a.current.subscribe(456);
    });

    // Simulate disconnect → reconnect
    // Fake timers must be installed BEFORE the disconnect so that the
    // reconnect setTimeout() is captured and can be advanced.
    vi.useFakeTimers();
    act(() => sock.onclose?.());
    act(() => { vi.advanceTimersByTime(1500); });
    vi.useRealTimers();

    sock = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => sock.open());

    const subMsgs = sock.sent.filter((s) => s.includes('"action":"subscribe"'));
    // 123 and 456 each subscribed exactly once on reconnect — refcount of 2 for 123 should NOT cause 2 messages.
    expect(subMsgs.filter((s) => s.includes('"conid":123'))).toHaveLength(1);
    expect(subMsgs.filter((s) => s.includes('"conid":456'))).toHaveLength(1);
  });

  it("ignores unsubscribe when conid was never subscribed", () => {
    const { result } = renderHook(() => useWebSocket());
    const sock = MockWebSocket.instances[0];
    act(() => sock.open());

    act(() => { result.current.unsubscribe(999); });

    const unsubMsgs = sock.sent.filter((s) => s.includes('"action":"unsubscribe"'));
    expect(unsubMsgs).toHaveLength(0);
  });
});
