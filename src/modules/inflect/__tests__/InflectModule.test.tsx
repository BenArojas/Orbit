/**
 * InflectModule tests — page-level account states and on-open sync behavior.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InflectModule } from "../InflectModule";
import { useAccountStore } from "@/orbit/OrderTicket/useAccountStore";
import { useInflectStore } from "@/store/inflect";

const apiMocks = vi.hoisted(() => ({
  moonmarketAccounts: vi.fn(),
  inflectCalendar: vi.fn(),
  inflectSync: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMocks,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/ui/BackToOrbitButton", () => ({
  BackToOrbitButton: () => <button type="button">Back</button>,
}));

vi.mock("@/components/ui/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

function renderModule() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InflectModule />
    </QueryClientProvider>,
  );
}

function accounts(accountId: string) {
  return {
    selected_account_id: accountId,
    accounts: [
      { account_id: accountId, label: accountId, selected: true, is_paper: true },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAccountStore.setState({ accounts: [], selectedAccountId: null });
  useInflectStore.setState({ page: "calendar", selectedTradeId: null });
  apiMocks.moonmarketAccounts.mockResolvedValue(accounts("DU1"));
  apiMocks.inflectCalendar.mockResolvedValue({
    account_id: "DU1",
    year: 2026,
    month: 6,
    days: [],
    weeks: [],
    total_net_pnl: 0,
    days_traded: 0,
  });
  apiMocks.inflectSync.mockResolvedValue({ account_id: "DU1", synced: 1 });
});

describe("InflectModule", () => {
  it("auto-syncs once when an account is ready and does not loop on rerender", async () => {
    apiMocks.moonmarketAccounts.mockResolvedValue(accounts("AUTO1"));
    apiMocks.inflectCalendar.mockResolvedValue({
      account_id: "AUTO1",
      year: 2026,
      month: 6,
      days: [],
      weeks: [],
      total_net_pnl: 0,
      days_traded: 0,
    });
    apiMocks.inflectSync.mockResolvedValue({ account_id: "AUTO1", synced: 1 });

    const { rerender } = renderModule();

    await waitFor(() => expect(apiMocks.inflectSync).toHaveBeenCalledTimes(1));
    expect(apiMocks.inflectSync).toHaveBeenCalledWith("AUTO1", undefined);

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InflectModule />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(apiMocks.inflectCalendar).toHaveBeenCalled());
    expect(apiMocks.inflectSync).toHaveBeenCalledTimes(1);
  });

  it("shows a page-level loading state while account data is loading", () => {
    apiMocks.moonmarketAccounts.mockReturnValue(new Promise(() => {}));

    renderModule();

    expect(screen.getByRole("status", { name: /loading inflect/i })).toBeInTheDocument();
  });

  it("shows a page-level error when account data fails", async () => {
    apiMocks.moonmarketAccounts.mockRejectedValue(new Error("accounts unavailable"));

    renderModule();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Inflect account data is unavailable.",
    );
  });
});
