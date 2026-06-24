import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "../useAccountStore";

describe("useAccountStore", () => {
  beforeEach(() => {
    useAccountStore.setState({ accounts: [], selectedAccountId: null });
  });

  it("hydrates accounts and selects the backend default", () => {
    useAccountStore.getState().setAccounts(
      [
        { account_id: "DU12345", label: "Paper", selected: true, is_paper: true },
        { account_id: "U12345", label: "Live", selected: false, is_paper: false },
      ],
      "U12345",
    );

    expect(useAccountStore.getState().selectedAccountId).toBe("U12345");
    expect(useAccountStore.getState().selectedAccount()?.account_id).toBe("U12345");
    expect(useAccountStore.getState().selectedAccount()?.is_paper).toBe(false);
  });

  it("keeps a user-selected account when it still exists after hydration", () => {
    useAccountStore.getState().setSelectedAccountId("DU12345");
    useAccountStore.getState().setAccounts(
      [
        { account_id: "DU12345", label: "Paper", selected: true, is_paper: true },
        { account_id: "U12345", label: "Live", selected: false, is_paper: false },
      ],
      "U12345",
    );

    expect(useAccountStore.getState().selectedAccountId).toBe("DU12345");
  });
});
