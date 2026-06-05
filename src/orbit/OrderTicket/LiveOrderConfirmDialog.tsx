import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function LiveOrderConfirmDialog({
  open,
  accountId,
  message,
  confirmLabel = "Confirm Live Order",
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  accountId: string | null;
  message: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !pending) onCancel(); }}>
      <DialogContent aria-label="Confirm live order" className="max-w-sm border-[var(--clr-red)]/40 bg-[var(--bg-2)]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold text-[var(--clr-red)]">Real-money order</DialogTitle>
          <DialogDescription className="text-[11px] leading-snug text-[var(--text-2)]">
            This will be sent to your LIVE IBKR account{accountId ? ` ${accountId}` : ""}. {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--bg-3)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
            style={{ background: "var(--clr-red)" }}
          >
            {pending ? "Sending..." : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
