import { X } from "lucide-react";
import { useAccountStore } from "./useAccountStore";
import { OrderForm } from "./OrderForm";
import { useOrderTicketStore } from "./useOrderTicketStore";

export function OrderTicket() {
  const isOpen = useOrderTicketStore((state) => state.isOpen);
  const target = useOrderTicketStore((state) => state.target);
  const close = useOrderTicketStore((state) => state.close);
  const selectedAccount = useAccountStore((state) => state.selectedAccount());

  if (!isOpen || !target) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Order Ticket"
        className="flex h-full w-full max-w-[420px] flex-col border-l border-border bg-[var(--bg-2)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">Order Ticket</div>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="truncate text-[18px] font-semibold">{target.symbol ?? `#${target.conid}`}</h2>
              <span className="font-data text-[11px] text-[var(--text-3)]">#{target.conid}</span>
            </div>
            <span className={selectedAccount?.is_paper ? "mt-2 inline-flex rounded border border-[var(--clr-green)]/50 px-2 py-0.5 text-[10px] text-[var(--clr-green)]" : "mt-2 inline-flex rounded border border-[var(--clr-red)]/50 px-2 py-0.5 text-[10px] text-[var(--clr-red)]"}>
              {selectedAccount?.is_paper ? "PAPER" : "LIVE"}
            </span>
          </div>
          <button type="button" onClick={close} aria-label="Close order ticket" className="rounded-md border border-border p-1.5 text-[var(--text-3)] hover:text-[var(--text-1)]">
            <X className="h-4 w-4" />
          </button>
        </header>
        <OrderForm target={target} />
      </aside>
    </div>
  );
}
