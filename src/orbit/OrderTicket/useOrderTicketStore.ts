import { create } from "zustand";
import type { MoonMarketOrderDraft, MoonMarketOrderSide } from "@/lib/api";

export type OrderTicketTarget = {
  mode?: "create" | "modify";
  conid: number;
  symbol?: string;
  side?: MoonMarketOrderSide;
  orderId?: string;
  draft?: Partial<MoonMarketOrderDraft>;
};

type OrderTicketState = {
  isOpen: boolean;
  target: OrderTicketTarget | null;
  open: (target: OrderTicketTarget) => void;
  close: () => void;
};

export const useOrderTicketStore = create<OrderTicketState>()((set) => ({
  isOpen: false,
  target: null,
  open: (target) => set({ isOpen: true, target }),
  close: () => set({ isOpen: false, target: null }),
}));
