type OrderResultProps = {
  previewResult: unknown;
  actionResult: unknown;
  replyId: string | null;
  onConfirm: (confirmed: boolean) => void;
  confirming: boolean;
  liveBlocked: boolean;
};

function stringifyResult(value: unknown): string {
  if (!value) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function OrderResult({
  previewResult,
  actionResult,
  replyId,
  onConfirm,
  confirming,
  liveBlocked,
}: OrderResultProps) {
  return (
    <div className="space-y-3 border-t border-border p-4">
      {previewResult ? (
        <div className="rounded-md border border-border bg-[var(--bg-1)] p-3">
          <div className="text-[11px] font-semibold uppercase text-[var(--text-3)]">Preview</div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--text-2)]">
            {stringifyResult(previewResult)}
          </pre>
        </div>
      ) : null}
      {actionResult ? (
        <div className="rounded-md border border-border bg-[var(--bg-1)] p-3">
          <div className="text-[11px] font-semibold uppercase text-[var(--text-3)]">Result</div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--text-2)]">
            {stringifyResult(actionResult)}
          </pre>
        </div>
      ) : null}
      {replyId ? (
        <div className="flex gap-2 rounded-md border border-[var(--clr-orange)]/50 bg-[var(--clr-orange)]/10 p-3">
          <button
            type="button"
            onClick={() => onConfirm(true)}
            disabled={confirming || liveBlocked}
            className="rounded-md border border-[var(--clr-green)]/60 px-3 py-1 text-[11px] text-[var(--clr-green)] disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => onConfirm(false)}
            disabled={confirming}
            className="rounded-md border border-border px-3 py-1 text-[11px] text-[var(--text-2)] disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      ) : null}
    </div>
  );
}
