import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useInflectBackfill } from "@/hooks/useInflectBackfill";
import { useInflectTrade } from "@/hooks/useTradeJournal";
import { BackfillStatus } from "./BackfillStatus";
import { BasisBadge } from "./BasisBadge";
import { JournalEditor } from "./JournalEditor";
import {
  formatHold,
  formatMoney,
  formatNumber,
  formatPercent,
  formatSignedMoney,
  formatTradeDirection,
  formatTradeStatus,
  isNeedsBasisTrade,
} from "./format";
import type { InflectFill } from "./types";

type DebugFill = InflectFill & {
  multiplier?: number | string | null;
};

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "green" | "red" }) {
  return (
    <div className="rounded-md border border-border bg-[var(--bg-1)] px-2.5 py-1.5">
      <div className="text-[9px] uppercase text-[var(--text-3)]">{label}</div>
      <div
        className={cn(
          "font-data text-[13px]",
          tone === "green" && "text-[var(--clr-green)]",
          tone === "red" && "text-[var(--clr-red)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function formatFillTime(value: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatDebugValue(value: number | string | null | undefined): string {
  if (value == null || value === "") return "--";
  return String(value);
}

function FillRow({ fill }: { fill: InflectFill }) {
  const debugFill = fill as DebugFill;
  return (
    <tr className="border-b border-border/70 last:border-0">
      <td className="px-2 py-1.5">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px]",
            fill.side === "BUY"
              ? "bg-[var(--clr-green)]/15 text-[var(--clr-green)]"
              : "bg-[var(--clr-red)]/15 text-[var(--clr-red)]",
          )}
        >
          {fill.side}
        </span>
      </td>
      <td className="px-2 py-1.5 text-right font-data">{formatNumber(fill.quantity)}</td>
      <td className="px-2 py-1.5 text-right font-data">{formatMoney(fill.price)}</td>
      <td className="px-2 py-1.5 text-right font-data text-[var(--text-3)]">
        {formatMoney(fill.commission)}
      </td>
      <td className="px-2 py-1.5 font-data text-[var(--text-3)]">{fill.execution_id}</td>
      <td className="px-2 py-1.5 font-data text-[var(--text-3)]">
        {formatFillTime(fill.trade_time)}
      </td>
      <td className="px-2 py-1.5 text-right font-data text-[var(--text-3)]">
        {formatMoney(fill.net_amount)}
      </td>
      <td className="px-2 py-1.5 font-data text-[var(--text-3)]">
        {formatDebugValue(fill.sec_type)}
      </td>
      <td className="px-2 py-1.5 text-right font-data text-[var(--text-3)]">
        {fill.conid}
      </td>
      <td className="px-2 py-1.5 text-right font-data text-[var(--text-3)]">
        {formatDebugValue(debugFill.multiplier)}
      </td>
    </tr>
  );
}

export function TradeDetail({
  tradeId,
  accountId,
  onClose,
}: {
  tradeId: string;
  accountId: string | null;
  onClose: () => void;
}) {
  const tradeQuery = useInflectTrade(tradeId, accountId ?? undefined);
  const trade = tradeQuery.data;

  const net = trade?.net_pnl ?? null;
  const tone = net != null && net > 0 ? "green" : net != null && net < 0 ? "red" : undefined;
  const needsBasis = trade ? isNeedsBasisTrade(trade) : false;
  const backfillQuery = useInflectBackfill({
    accountId,
    conid: trade?.conid,
    enabled: needsBasis,
  });

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-[var(--bg-2)]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold">
            {trade ? trade.symbol || `#${trade.conid}` : "Trade"}
          </h3>
          <p className="text-[10px] text-[var(--text-3)]">{tradeId}</p>
        </div>
        <button
          type="button"
          aria-label="Close trade detail"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-[var(--text-3)] hover:text-[var(--text-1)]"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {tradeQuery.isLoading ? (
          <div className="min-h-[160px] animate-pulse rounded-md border border-border bg-[var(--bg-1)]" />
        ) : tradeQuery.error || !trade ? (
          <div className="rounded-md border border-[var(--clr-red)]/50 bg-[var(--clr-red)]/10 p-3 text-[12px] text-[var(--clr-red)]">
            Trade detail is unavailable.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="Direction"
                value={needsBasis ? <BasisBadge /> : formatTradeDirection(trade.direction)}
              />
              <Stat
                label="Status"
                value={needsBasis ? <BasisBadge /> : formatTradeStatus(trade.status)}
              />
              <Stat label="Net P&L" value={formatSignedMoney(net)} tone={tone} />
              <Stat label="Return" value={formatPercent(trade.return_pct)} tone={tone} />
              <Stat label="Gross P&L" value={formatSignedMoney(trade.gross_pnl)} />
              <Stat label="Commissions" value={formatMoney(trade.commissions)} />
              <Stat label="Qty" value={formatNumber(trade.qty)} />
              <Stat label="Hold" value={formatHold(trade.hold_duration_sec)} />
              <Stat label="Avg Entry" value={formatMoney(trade.avg_entry)} />
              <Stat label="Avg Exit" value={formatMoney(trade.avg_exit)} />
            </div>

            {needsBasis ? (
              <section
                id="basis-repair"
                className="rounded-md border border-[var(--clr-orange)]/50 bg-[var(--clr-orange)]/10 p-3"
              >
                <div className="mb-1">
                  <BasisBadge />
                </div>
                <p className="text-[12px] text-[var(--text-2)]">
                  Opening basis is missing — this row can't be fully classified yet.
                </p>
                <a
                  href="#basis-repair"
                  className="mt-2 inline-flex text-[11px] font-medium text-[var(--clr-orange)] hover:text-[var(--text-1)]"
                >
                  Repair basis
                </a>
              </section>
            ) : null}

            {needsBasis ? (
              <BackfillStatus
                item={backfillQuery.data ?? null}
                isLoading={backfillQuery.isLoading}
                onAddManualLot={() => {
                  window.location.hash = "basis-repair";
                }}
              />
            ) : null}

            <div>
              <div className="mb-1 text-[10px] uppercase text-[var(--text-3)]">
                Fills ({trade.fills.length})
              </div>
              <div className="overflow-x-auto rounded-md border border-border bg-[var(--bg-2)]">
                <table className="w-full min-w-[720px] text-left text-[11px]">
                  <thead className="border-b border-border text-[9px] uppercase text-[var(--text-3)]">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Side</th>
                      <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                      <th className="px-2 py-1.5 text-right font-medium">Price</th>
                      <th className="px-2 py-1.5 text-right font-medium">Comm.</th>
                      <th className="px-2 py-1.5 font-medium">Exec ID</th>
                      <th className="px-2 py-1.5 font-medium">Fill Time</th>
                      <th className="px-2 py-1.5 text-right font-medium">Net</th>
                      <th className="px-2 py-1.5 font-medium">Sec Type</th>
                      <th className="px-2 py-1.5 text-right font-medium">Conid</th>
                      <th className="px-2 py-1.5 text-right font-medium">Mult.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trade.fills.map((fill) => (
                      <FillRow key={fill.execution_id} fill={fill} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] uppercase text-[var(--text-3)]">Journal</div>
              <JournalEditor
                tradeId={trade.trade_id}
                accountId={accountId}
                entry={trade.journal_entry}
              />
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
