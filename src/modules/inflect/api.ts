/**
 * Inflect sidecar contract.
 *
 * Owns Inflect endpoint paths, query-string encoding, request payload types,
 * and response types. Transport mechanics stay in "@/lib/sidecarClient".
 */

import { sidecarRequest } from "@/lib/sidecarClient";

// ── Journal / setups ────────────────────────────────────────
// ── Trades / calendar ───────────────────────────────────────
// ── Sync / backfill ─────────────────────────────────────────
// ── Basis recovery ──────────────────────────────────────────
// ── Storage maintenance ─────────────────────────────────────
// ── API functions ───────────────────────────────────────────

export interface InflectJournalEntry {
  trade_id: string;
  account_id: string;
  conid: number;
  setup: string | null;
  notes: string | null;
  tags: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface InflectJournalUpsertRequest {
  setup: string | null;
  notes: string | null;
  tags: string[];
}

export interface InflectSetupsResponse {
  setups: string[];
}

export interface InflectFill {
  execution_id: string;
  conid: number;
  symbol: string | null;
  side: string;
  quantity: number;
  price: number | null;
  commission: number | null;
  net_amount: number | null;
  sec_type: string | null;
  multiplier: number | null;
  trade_time: string;
  trade_time_ms: number | null;
}

export interface InflectTrade {
  trade_id: string;
  account_id: string;
  conid: number;
  symbol: string;
  sec_type: string | null;
  direction: "LONG" | "SHORT" | "UNKNOWN";
  status: "OPEN" | "CLOSED" | "INCOMPLETE_BASIS";
  open_time: string;
  open_time_ms: number;
  close_time: string | null;
  close_time_ms: number | null;
  qty: number;
  avg_entry: number;
  avg_exit: number | null;
  gross_pnl: number | null;
  commissions: number;
  net_pnl: number | null;
  return_pct: number | null;
  hold_duration_sec: number | null;
  r_multiple: number | null;
  multiplier: number;
  fills: InflectFill[];
  journal_entry: InflectJournalEntry | null;
}

export interface InflectTradesResponse {
  account_id: string;
  trades: InflectTrade[];
}

export interface InflectSymbol {
  conid: number;
  symbol: string;
}

export interface InflectSymbolsResponse {
  account_id: string;
  symbols: InflectSymbol[];
}

export interface InflectCalendarDay {
  date: string;
  net_pnl: number;
  trade_count: number;
}

export interface InflectWeekRollup {
  week_index: number;
  net_pnl: number;
  trading_days: number;
}

export interface InflectCalendarResponse {
  account_id: string;
  year: number;
  month: number;
  days: InflectCalendarDay[];
  weeks: InflectWeekRollup[];
  total_net_pnl: number;
  days_traded: number;
}

export interface InflectSyncResponse {
  account_id: string;
  synced: number;
}

export type InflectTradeStatus = "OPEN" | "CLOSED" | "INCOMPLETE_BASIS";

export type InflectBackfillQueueStatus =
  | "pending"
  | "running"
  | "resolved"
  | "still_needs_basis"
  | "failed"
  | "rate_limited"
  | "max_days_rejected";

export interface InflectBackfillStatusItem {
  account_id: string;
  conid: number;
  status: InflectBackfillQueueStatus;
  attempts: number;
  days_used: number | null;
  last_checked_ms: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface InflectBackfillStatusResponse {
  account_id: string;
  items: InflectBackfillStatusItem[];
}

export interface BasisLot {
  id: number;
  account_id: string;
  conid: number;
  side: "LONG" | "SHORT";
  quantity: number;
  entry_date: string;
  entry_price: number;
  commission: number | null;
  note: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BasisLotUpsertRequest {
  conid: number;
  side: "LONG" | "SHORT";
  quantity: number;
  entry_date: string;
  entry_price: number;
  commission?: number | null;
  note?: string | null;
}

export interface BasisAuditEntry {
  id: number;
  account_id: string;
  conid: number;
  action: string;
  source: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

export interface BasisAuditResponse {
  account_id: string;
  conid: number;
  items: BasisAuditEntry[];
}

export interface InflectStorageStatsResponse {
  file_size_bytes: number;
  table_counts: Record<string, number>;
  raw_json_bytes: number;
}

export interface InflectStorageCleanupRequest {
  before_date: string;
  confirm: boolean;
}

export interface InflectStorageCleanupResponse {
  before_date: string;
  cleared_raw_payloads: number;
  deleted_rows: number;
  export_recommended: boolean;
  message: string;
}

export const inflectApi = {
    inflectSetups: (signal?: AbortSignal) =>
        sidecarRequest<InflectSetupsResponse>("GET", "/inflect/setups", undefined, signal),
    
      inflectCalendar: (year: number, month: number, accountId?: string, signal?: AbortSignal) => {
        const params = new URLSearchParams({ year: String(year), month: String(month) });
        if (accountId) params.set("account_id", accountId);
        return sidecarRequest<InflectCalendarResponse>("GET", `/inflect/calendar?${params.toString()}`, undefined, signal);
      },
    
      inflectTrades: (
        opts: { accountId?: string; from?: number; to?: number; status?: InflectTradeStatus } = {},
        signal?: AbortSignal,
      ) => {
        const params = new URLSearchParams();
        if (opts.accountId) params.set("account_id", opts.accountId);
        if (opts.from != null) params.set("from", String(opts.from));
        if (opts.to != null) params.set("to", String(opts.to));
        if (opts.status) params.set("status", opts.status);
        const qs = params.toString();
        return sidecarRequest<InflectTradesResponse>("GET", `/inflect/trades${qs ? `?${qs}` : ""}`, undefined, signal);
      },
    
      inflectTrade: (tradeId: string, accountId?: string, signal?: AbortSignal) => {
        const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
        return sidecarRequest<InflectTrade>("GET", `/inflect/trades/${encodeURIComponent(tradeId)}${qs}`, undefined, signal);
      },
    
      inflectSymbols: (
        opts: { accountId?: string; from?: number; to?: number } = {},
        signal?: AbortSignal,
      ) => {
        const params = new URLSearchParams();
        if (opts.accountId) params.set("account_id", opts.accountId);
        if (opts.from != null) params.set("from", String(opts.from));
        if (opts.to != null) params.set("to", String(opts.to));
        const qs = params.toString();
        return sidecarRequest<InflectSymbolsResponse>(
          "GET",
          `/inflect/symbols${qs ? `?${qs}` : ""}`,
          undefined,
          signal,
        );
      },
    
      inflectSaveJournal: (
        tradeId: string,
        body: InflectJournalUpsertRequest,
        accountId?: string,
        signal?: AbortSignal,
      ) => {
        const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
        return sidecarRequest<InflectJournalEntry>(
          "PUT",
          `/inflect/trades/${encodeURIComponent(tradeId)}/journal${qs}`,
          body,
          signal,
        );
      },
    
      inflectSync: (accountId?: string, signal?: AbortSignal) => {
        const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
        return sidecarRequest<InflectSyncResponse>("POST", `/inflect/sync${qs}`, undefined, signal);
      },
    
      inflectBackfillStatus: (
        opts: { accountId: string; conid?: number },
        signal?: AbortSignal,
      ) => {
        const params = new URLSearchParams({ account_id: opts.accountId });
        if (opts.conid != null) params.set("conid", String(opts.conid));
        return sidecarRequest<InflectBackfillStatusResponse>(
          "GET",
          `/inflect/backfill-status?${params.toString()}`,
          undefined,
          signal,
        );
      },
    
      inflectBasisLots: (
        opts: { accountId: string; conid: number },
        signal?: AbortSignal,
      ) => {
        const params = new URLSearchParams({
          account_id: opts.accountId,
          conid: String(opts.conid),
        });
        return sidecarRequest<BasisLot[]>(
          "GET",
          `/inflect/basis-lots?${params.toString()}`,
          undefined,
          signal,
        );
      },
    
      inflectCreateBasisLot: (accountId: string, body: BasisLotUpsertRequest) =>
        sidecarRequest<BasisLot>(
          "POST",
          `/inflect/basis-lots?account_id=${encodeURIComponent(accountId)}`,
          body,
        ),
    
      inflectUpdateBasisLot: (lotId: number, accountId: string, body: BasisLotUpsertRequest) =>
        sidecarRequest<BasisLot>(
          "PUT",
          `/inflect/basis-lots/${lotId}?account_id=${encodeURIComponent(accountId)}`,
          body,
        ),
    
      inflectDeleteBasisLot: (lotId: number, accountId: string) =>
        sidecarRequest<{ deleted: boolean }>(
          "DELETE",
          `/inflect/basis-lots/${lotId}?account_id=${encodeURIComponent(accountId)}`,
        ),
    
      inflectBasisAudit: (
        opts: { accountId: string; conid: number },
        signal?: AbortSignal,
      ) => {
        const params = new URLSearchParams({
          account_id: opts.accountId,
          conid: String(opts.conid),
        });
        return sidecarRequest<BasisAuditResponse>(
          "GET",
          `/inflect/basis-audit?${params.toString()}`,
          undefined,
          signal,
        );
      },
    
      inflectStorage: (signal?: AbortSignal) =>
        sidecarRequest<InflectStorageStatsResponse>("GET", "/inflect/storage", undefined, signal),
    
      inflectStorageCleanup: (body: InflectStorageCleanupRequest) =>
        sidecarRequest<InflectStorageCleanupResponse>(
          "POST",
          "/inflect/storage/cleanup",
          body,
        ),
}
