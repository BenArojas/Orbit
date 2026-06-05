import { create } from "zustand";
import type { MoonMarketAccount } from "@/lib/api";

type AccountState = {
  accounts: MoonMarketAccount[];
  selectedAccountId: string | null;
  setAccounts: (accounts: MoonMarketAccount[], defaultAccountId?: string | null) => void;
  setSelectedAccountId: (accountId: string | null) => void;
  selectedAccount: () => MoonMarketAccount | null;
};

export const useAccountStore = create<AccountState>()((set, get) => ({
  accounts: [],
  selectedAccountId: null,

  setAccounts: (accounts, defaultAccountId = null) => {
    set((state) => {
      const currentStillExists = state.selectedAccountId
        ? accounts.some((account) => account.account_id === state.selectedAccountId)
        : false;
      return {
        accounts,
        selectedAccountId: currentStillExists
          ? state.selectedAccountId
          : defaultAccountId ?? accounts[0]?.account_id ?? null,
      };
    });
  },

  setSelectedAccountId: (accountId) => set({ selectedAccountId: accountId }),

  selectedAccount: () => {
    const { accounts, selectedAccountId } = get();
    return accounts.find((account) => account.account_id === selectedAccountId) ?? null;
  },
}));
