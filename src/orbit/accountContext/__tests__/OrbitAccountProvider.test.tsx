import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  moonmarketAccounts: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      moonmarketAccounts: mockApi.moonmarketAccounts,
    },
  };
});

import { OrbitAccountProvider, useAccountStore, useOrbitAccountContext } from "../index";

function makeWrapper(enabled = true) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <OrbitAccountProvider enabled={enabled}>{children}</OrbitAccountProvider>
      </QueryClientProvider>
    );
  };
}

describe("OrbitAccountProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({ accounts: [], selectedAccountId: null });
    mockApi.moonmarketAccounts.mockResolvedValue({
      selected_account_id: "U12345",
      accounts: [
        { account_id: "DU12345", label: "Paper", selected: false, is_paper: true },
        { account_id: "U12345", label: "Live", selected: true, is_paper: false },
      ],
    });
  });

  it("hydrates the shared account context and derives live/paper state", async () => {
    const { result } = renderHook(() => useOrbitAccountContext(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(mockApi.moonmarketAccounts).toHaveBeenCalledTimes(1);
    expect(result.current.accounts).toHaveLength(2);
    expect(result.current.selectedAccountId).toBe("U12345");
    expect(result.current.selectedAccount?.label).toBe("Live");
    expect(result.current.accountMode).toBe("live");
    expect(result.current.isLiveAccount).toBe(true);
    expect(result.current.isPaperAccount).toBe(false);
    expect(result.current.readyState).toBe("ready");
  });

  it("keeps a user-selected account when it still exists after hydration", async () => {
    useAccountStore.setState({
      accounts: [{ account_id: "DU12345", label: "Paper", selected: true, is_paper: true }],
      selectedAccountId: "DU12345",
    });

    const { result } = renderHook(() => useOrbitAccountContext(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.selectedAccountId).toBe("DU12345");
    expect(result.current.accountMode).toBe("paper");
    expect(result.current.isPaperAccount).toBe(true);
  });

  it("exposes an idle state without fetching until account hydration is enabled", () => {
    const { result } = renderHook(() => useOrbitAccountContext(), {
      wrapper: makeWrapper(false),
    });

    expect(mockApi.moonmarketAccounts).not.toHaveBeenCalled();
    expect(result.current.readyState).toBe("idle");
    expect(result.current.isReady).toBe(false);
  });

  it("exposes account query errors through the shared context", async () => {
    mockApi.moonmarketAccounts.mockRejectedValue(new Error("accounts unavailable"));

    const { result } = renderHook(() => useOrbitAccountContext(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.readyState).toBe("error"));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.isReady).toBe(false);
  });
});
