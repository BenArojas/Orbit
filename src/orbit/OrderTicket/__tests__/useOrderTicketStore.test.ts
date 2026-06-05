import { beforeEach, describe, expect, it } from "vitest";
import { useOrderTicketStore } from "../useOrderTicketStore";

describe("useOrderTicketStore", () => {
  beforeEach(() => {
    useOrderTicketStore.setState({ isOpen: false, target: null });
  });

  it("opens and closes around a conid target", () => {
    useOrderTicketStore.getState().open({ conid: 265598, symbol: "AAPL", side: "SELL" });

    expect(useOrderTicketStore.getState().isOpen).toBe(true);
    expect(useOrderTicketStore.getState().target).toEqual({ conid: 265598, symbol: "AAPL", side: "SELL" });

    useOrderTicketStore.getState().close();

    expect(useOrderTicketStore.getState().isOpen).toBe(false);
    expect(useOrderTicketStore.getState().target).toBeNull();
  });
});
