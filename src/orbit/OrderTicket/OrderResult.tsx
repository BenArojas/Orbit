type OrderResultProps = {
  previewResult: unknown;
  actionResult: unknown;
  replyId: string | null;
  orderTracker: OrderTrackerState | null;
  onConfirm: (confirmed: boolean) => void;
  confirming: boolean;
};

export type OrderTrackerState = {
  orderId: string;
  orderType: string;
  status: "filled" | "partial" | "pending" | "submitted";
  liveStatus?: string | null;
  quantity?: number | null;
  filledQuantity?: number | null;
  averagePrice?: number | null;
  currentPrice?: number | null;
  limitPrice?: number | null;
  distancePercent?: number | null;
  remainingQuantity?: number | null;
};

type PreviewPayload = {
  amount?: Record<string, unknown>;
  equity?: Record<string, unknown>;
  position?: Record<string, unknown>;
  warn?: unknown;
  warns?: unknown;
  error?: unknown;
};

function unwrapResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("result" in value)) return value;
  return (value as { result: unknown }).result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function resultRows(value: unknown): Array<Record<string, unknown>> {
  const payload = unwrapResult(value);
  if (Array.isArray(payload)) return payload.filter(Boolean).filter((row) => typeof row === "object") as Array<Record<string, unknown>>;
  const record = asRecord(payload);
  const data = record?.data;
  if (Array.isArray(data)) return data.filter(Boolean).filter((row) => typeof row === "object") as Array<Record<string, unknown>>;
  return record ? [record] : [];
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function cleanIbkrMessage(value: unknown): string | null {
  const text = Array.isArray(value) ? value.map(textValue).filter(Boolean).join("\n") : textValue(value);
  if (!text) return null;
  return text.replace(/^\d+\//, "").replace(/<[^>]*>/g, "").trim();
}

function previewPayload(value: unknown): PreviewPayload | null {
  const payload = unwrapResult(value);
  const record = asRecord(payload);
  if (!record) return null;
  return record as PreviewPayload;
}

function firstOrderId(value: unknown): string | null {
  for (const row of resultRows(value)) {
    const id = textValue(row.order_id) ?? textValue(row.orderId);
    if (id) return id;
  }
  return null;
}

const NON_ACCEPTED_STATUSES = new Set(["rejected", "inactive", "cancelled", "canceled"]);

// Reads the order status echoed back on a place/reply row, if any.
function rowOrderStatus(value: unknown): string | null {
  for (const row of resultRows(value)) {
    const status = textValue(row.order_status) ?? textValue(row.status);
    if (status) return status;
  }
  return null;
}

function statusIsAccepted(status: string | null): boolean {
  if (!status) return true;
  return !NON_ACCEPTED_STATUSES.has(status.toLowerCase());
}

function resultError(value: unknown): string | null {
  for (const row of resultRows(value)) {
    const error = cleanIbkrMessage(row.error);
    if (error) return error;
  }
  return null;
}

function fallbackText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function Fact({ label, value, tone }: { label: string; value: unknown; tone?: "green" | "red" | "cyan" }) {
  const rendered = textValue(value) ?? "-";
  const toneClass =
    tone === "green"
      ? "text-[var(--clr-green)]"
      : tone === "red"
        ? "text-[var(--clr-red)]"
        : tone === "cyan"
          ? "text-[var(--clr-cyan)]"
          : "text-[var(--text-1)]";
  return (
    <div className="rounded border border-border bg-[var(--bg-2)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-2)]">{label}</div>
      <div className={`mt-1 font-data text-[13px] font-semibold ${toneClass}`}>{rendered}</div>
    </div>
  );
}

function PreviewCard({ result }: { result: unknown }) {
  const preview = previewPayload(result);
  if (!preview) return null;
  const amount = asRecord(preview.amount);
  const equity = asRecord(preview.equity);
  const position = asRecord(preview.position);
  const warning = cleanIbkrMessage(preview.warn) ?? cleanIbkrMessage(preview.warns);
  const error = cleanIbkrMessage(preview.error);

  return (
    <section className="rounded-md border border-border bg-[var(--bg-1)] p-3">
      <div className="text-[11px] font-semibold uppercase text-[var(--text-2)]">Order Preview</div>
      {error ? (
        <div className="mt-3 rounded border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-2 text-[12px] text-[var(--clr-red)]">
          {error}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Fact label="Estimated Total" value={amount?.total ?? amount?.amount} tone="cyan" />
          <Fact label="Commission" value={amount?.commission} />
          <Fact label="Equity After" value={equity?.after} />
          <Fact label="Position After" value={position?.after} tone="green" />
        </div>
      )}
      {warning ? (
        <div className="mt-3 rounded border border-[var(--clr-orange)]/50 bg-[var(--clr-orange)]/10 p-2 text-[12px] leading-relaxed text-[var(--clr-orange)]">
          {warning}
        </div>
      ) : null}
    </section>
  );
}

function ConfirmationCard({
  actionResult,
  onConfirm,
  confirming,
}: Pick<OrderResultProps, "actionResult" | "onConfirm" | "confirming">) {
  const row = resultRows(actionResult).find((item) => textValue(item.id));
  const message = cleanIbkrMessage(row?.message) ?? "IBKR needs confirmation before submitting this order.";
  if (!row) return null;

  return (
    <section className="rounded-md border border-[var(--clr-orange)]/50 bg-[var(--clr-orange)]/10 p-3">
      <div className="text-[11px] font-semibold uppercase text-[var(--clr-orange)]">Confirmation Required</div>
      <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-1)]">{message}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onConfirm(true)}
          disabled={confirming}
          className="rounded-md border border-[var(--clr-green)]/60 bg-[var(--clr-green)]/10 px-3 py-2 text-[12px] font-semibold text-[var(--clr-green)] disabled:opacity-50"
        >
          {confirming ? "Submitting..." : "Confirm and Submit"}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(false)}
          disabled={confirming}
          className="rounded-md border border-border px-3 py-2 text-[12px] text-[var(--text-1)] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function SubmittedCard({ actionResult }: { actionResult: unknown }) {
  const orderId = firstOrderId(actionResult);
  if (!orderId) return null;
  const status = rowOrderStatus(actionResult);
  if (!statusIsAccepted(status)) {
    // Not a successful submission: render neutral styling and surface the status
    // instead of the green "Order Submitted" success card.
    return (
      <section className="rounded-md border border-border bg-[var(--bg-1)] p-3">
        <div className="text-[11px] font-semibold uppercase text-[var(--text-2)]">Order Not Accepted</div>
        <div className="mt-2 font-data text-[12px] text-[var(--text-1)]">Order ID {orderId}</div>
        <p className="mt-1 text-[11px] text-[var(--clr-orange)]">{status}</p>
      </section>
    );
  }
  return (
    <section className="rounded-md border border-[var(--clr-green)]/50 bg-[var(--clr-green)]/10 p-3">
      <div className="text-[11px] font-semibold uppercase text-[var(--clr-green)]">Order Submitted</div>
      <div className="mt-2 font-data text-[12px] text-[var(--text-1)]">Order ID {orderId}</div>
      <p className="mt-1 text-[11px] text-[var(--text-2)]">Portfolio, funds, and live orders are refreshing.</p>
    </section>
  );
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function OrderTrackerCard({ tracker }: { tracker: OrderTrackerState }) {
  const filled = tracker.status === "filled";
  const partial = tracker.status === "partial";
  const heading = filled ? "Order Filled" : partial ? "Partially Filled" : "Order Tracker";
  return (
    <section className={filled ? "rounded-md border border-[var(--clr-green)]/50 bg-[var(--clr-green)]/10 p-3" : "rounded-md border border-[var(--clr-cyan)]/45 bg-[var(--clr-cyan)]/10 p-3"}>
      <div className={filled ? "text-[11px] font-semibold uppercase text-[var(--clr-green)]" : "text-[11px] font-semibold uppercase text-[var(--clr-cyan)]"}>
        {heading}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Fact label="Status" value={filled ? "Filled" : partial ? "Partially Filled" : tracker.liveStatus ?? "Pending"} tone={filled ? "green" : "cyan"} />
        <Fact label="Order ID" value={tracker.orderId} />
        {filled ? (
          <>
            <Fact label="Filled" value={`${formatQuantity(tracker.filledQuantity)} shares`} tone="green" />
            <Fact label="Avg Price" value={`$${formatNumber(tracker.averagePrice)} avg`} />
          </>
        ) : (
          <>
            {partial ? <Fact label="Filled" value={formatQuantity(tracker.filledQuantity)} tone="cyan" /> : null}
            <Fact label="Current Price" value={`$${formatNumber(tracker.currentPrice)}`} />
            <Fact label="Distance" value={tracker.distancePercent == null ? "--" : `${formatNumber(tracker.distancePercent)}% away`} tone="cyan" />
            <Fact label="Limit Price" value={tracker.limitPrice == null ? "--" : `$${formatNumber(tracker.limitPrice)}`} />
            <Fact label="Remaining" value={formatQuantity(tracker.remainingQuantity ?? tracker.quantity)} />
          </>
        )}
      </div>
    </section>
  );
}

function ErrorCard({ actionResult }: { actionResult: unknown }) {
  const error = resultError(actionResult);
  if (!error) return null;
  return (
    <section className="rounded-md border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-3 text-[12px] text-[var(--clr-red)]">
      {error}
    </section>
  );
}

export function OrderResult({
  previewResult,
  actionResult,
  replyId,
  orderTracker,
  onConfirm,
  confirming,
}: OrderResultProps) {
  const knownAction =
    firstOrderId(actionResult) || resultError(actionResult) || resultRows(actionResult).some((row) => textValue(row.id));

  return (
    <div className="space-y-3 border-t border-border p-4">
      {previewResult ? <PreviewCard result={previewResult} /> : null}
      {actionResult ? <ErrorCard actionResult={actionResult} /> : null}
      {orderTracker ? <OrderTrackerCard tracker={orderTracker} /> : null}
      {actionResult && !orderTracker ? <SubmittedCard actionResult={actionResult} /> : null}
      {replyId ? (
        <ConfirmationCard
          actionResult={actionResult}
          onConfirm={onConfirm}
          confirming={confirming}
        />
      ) : null}
      {actionResult && !knownAction ? (
        <section className="rounded-md border border-border bg-[var(--bg-1)] p-3">
          <div className="text-[11px] font-semibold uppercase text-[var(--text-2)]">IBKR Response</div>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--text-2)]">
            {fallbackText(actionResult)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
