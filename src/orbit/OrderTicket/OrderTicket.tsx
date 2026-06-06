import { X } from "lucide-react";
import { useOrbitAccountContext } from "@/orbit/accountContext";
import { OrderForm } from "./OrderForm";
import { useOrderTicketStore } from "./useOrderTicketStore";

export function OrderTicket() {
  const isOpen = useOrderTicketStore((state) => state.isOpen);
  const target = useOrderTicketStore((state) => state.target);
  const close = useOrderTicketStore((state) => state.close);
  const { selectedAccount, readyState: accountReadyState } = useOrbitAccountContext();

  if (!isOpen || !target) return null;

  const assetClass = target.assetClass ?? "STK";
  const title = target.description ?? target.symbol ?? `#${target.conid}`;
  const accountBadge = accountReadyState === "loading"
    ? { label: "ACCOUNT LOADING", className: "border-border text-[var(--text-3)]" }
    : accountReadyState === "error"
      ? { label: "ACCOUNT ERROR", className: "border-[var(--clr-red)]/50 text-[var(--clr-red)]" }
      : accountReadyState === "empty"
        ? { label: "NO ACCOUNT", className: "border-border text-[var(--text-3)]" }
        : selectedAccount?.is_paper
          ? { label: "PAPER", className: "border-[var(--clr-green)]/50 text-[var(--clr-green)]" }
          : { label: "LIVE", className: "border-[var(--clr-red)]/50 text-[var(--clr-red)]" };

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
              <h2 className="truncate text-[18px] font-semibold">{title}</h2>
              <span className="font-data text-[11px] text-[var(--text-3)]">#{target.conid}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={`inline-flex rounded border px-2 py-0.5 text-[10px] ${accountBadge.className}`}>
                {accountBadge.label}
              </span>
              <span className="inline-flex rounded border border-border px-2 py-0.5 text-[10px] text-[var(--text-3)]">
                {assetClass === "OPT" ? "OPTION" : "STOCK"}
              </span>
            </div>
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
