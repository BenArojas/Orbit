"""InflectService — calendar aggregation, trade queries, and journal CRUD.

Round-trip trades are derived on demand by running the FIFO `matcher` over the
shared `fills` projection (never persisted in v1). The service owns three
concerns:

  * calendar(...)  — bucket CLOSED-trade net P&L by close date (US/Eastern),
                     with weekly rollups + month totals (spec §6, B3).
  * trades(...) / trade(...) — FIFO-derived trades in a window, joined with
                     journal entries (B4/B5).
  * save_journal / setups / sync — journal upsert, the fixed setup vocabulary,
                     and a force-sync that delegates to MoonMarket's
                     ibkr → trades → upsert_fills path (B5).

Account resolution reuses MoonMarket's account store (D3, single-account v1).
All SQLite goes through `DatabaseService`; all IBKR through `MoonMarketService`
/ `IBKRService`. Typed exceptions only.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from constants.inflect import SETUP_OPTIONS, TRADING_DAY_TZ
from exceptions import IBKRAuthError, IBKRConnectionError, IBKRRateLimitError
from models.inflect import (
    BasisLot,
    BasisLotUpsertRequest,
    InflectBackfillStatusItem,
    InflectBackfillStatusResponse,
    InflectCalendarDay,
    InflectCalendarResponse,
    InflectSetupsResponse,
    InflectSyncResponse,
    InflectTrade,
    InflectTradesResponse,
    InflectWeekRollup,
    JournalEntry,
    JournalUpsertRequest,
)
from services.db import DatabaseService
from services.inflect.matcher import match_fills
from services.inflect.pa_transactions import PaBackfillResult
from services.moonmarket import MoonMarketService

# Upper bound for "open-ended" fill windows (≈ year 2100 in epoch ms). The
# matcher must see every fill from a position's open, so reads start at 0;
# this caps the other end when the caller gives no explicit `to`.
_FAR_FUTURE_MS = 4_102_444_800_000


class InflectTradeNotFoundError(LookupError):
    """Raised when a resolved account has no matching derived trade."""


class InflectBasisLotNotFoundError(LookupError):
    """Raised when a manual basis lot is missing for the resolved account."""


class InflectService:
    def __init__(
        self,
        ibkr,
        db: DatabaseService,
        moonmarket: MoonMarketService,
    ) -> None:
        self.ibkr = ibkr
        self.db = db
        self.moonmarket = moonmarket
        self._position_cache: dict[tuple[str, int], float | None] = {}

    # ── Calendar ───────────────────────────────────────────────

    async def calendar(
        self, account_id: str | None, year: int, month: int
    ) -> InflectCalendarResponse:
        """Per-day net realized P&L + weekly rollups for one month (ET)."""
        resolved = await self._resolve_account(account_id)
        tz = ZoneInfo(TRADING_DAY_TZ)

        month_start = datetime(year, month, 1, tzinfo=tz)
        next_month = (
            datetime(year + 1, 1, 1, tzinfo=tz)
            if month == 12
            else datetime(year, month + 1, 1, tzinfo=tz)
        )
        end_ms = int(next_month.timestamp() * 1000) - 1

        trades = await self._matched_trades(resolved, end_ms)

        day_pnl: dict[str, float] = defaultdict(float)
        day_count: dict[str, int] = defaultdict(int)
        for trade in trades:
            if (
                trade.status != "CLOSED"
                or trade.close_time_ms is None
                or trade.net_pnl is None
            ):
                continue
            closed = datetime.fromtimestamp(trade.close_time_ms / 1000, tz).date()
            if closed.year != year or closed.month != month:
                continue
            key = closed.isoformat()
            day_pnl[key] += trade.net_pnl
            day_count[key] += 1

        days = [
            InflectCalendarDay(
                date=key,
                net_pnl=round(day_pnl[key], 2),
                trade_count=day_count[key],
            )
            for key in sorted(day_pnl)
        ]

        weeks = self._week_rollups(year, month, tz, day_pnl)
        total_net = round(sum(day_pnl.values()), 2)

        return InflectCalendarResponse(
            account_id=resolved,
            year=year,
            month=month,
            days=days,
            weeks=weeks,
            total_net_pnl=total_net,
            days_traded=len(day_pnl),
        )

    def _week_rollups(
        self,
        year: int,
        month: int,
        tz: ZoneInfo,
        day_pnl: dict[str, float],
    ) -> list[InflectWeekRollup]:
        """Group day buckets into the month grid's weeks (Sunday-start rows)."""
        first = datetime(year, month, 1, tzinfo=tz)
        # Sunday-start grid offset: Sun=0, Mon=1, … Sat=6.
        offset = (first.weekday() + 1) % 7
        next_month = (
            datetime(year + 1, 1, 1, tzinfo=tz)
            if month == 12
            else datetime(year, month + 1, 1, tzinfo=tz)
        )
        days_in_month = (next_month - timedelta(days=1)).day
        max_week = (days_in_month + offset - 1) // 7 + 1

        week_pnl: dict[int, float] = defaultdict(float)
        week_days: dict[int, int] = defaultdict(int)
        for key, pnl in day_pnl.items():
            day = datetime.fromisoformat(key).day
            week_index = (day + offset - 1) // 7 + 1
            week_pnl[week_index] += pnl
            week_days[week_index] += 1

        return [
            InflectWeekRollup(
                week_index=wi,
                net_pnl=round(week_pnl[wi], 2),
                trading_days=week_days[wi],
            )
            for wi in range(1, max_week + 1)
        ]

    # ── Trades ─────────────────────────────────────────────────

    async def trades(
        self,
        account_id: str | None,
        from_ms: int | None = None,
        to_ms: int | None = None,
        status: str | None = None,
    ) -> InflectTradesResponse:
        """FIFO-derived trades overlapping [from_ms, to_ms], newest first."""
        resolved = await self._resolve_account(account_id)
        end_ms = to_ms if to_ms is not None else _FAR_FUTURE_MS
        matched = await self._matched_trades(resolved, end_ms)

        selected: list[InflectTrade] = []
        for trade in matched:
            if status and trade.status != status:
                continue
            ref_ms = self._reference_ms(trade)
            if from_ms is not None and ref_ms < from_ms:
                continue
            if to_ms is not None and ref_ms > to_ms:
                continue
            selected.append(trade)

        selected = await self._apply_current_holdings_guard(selected)
        await self._attach_journal(selected)
        selected.sort(key=self._reference_ms, reverse=True)
        return InflectTradesResponse(account_id=resolved, trades=selected)

    async def trade(
        self, trade_id: str, account_id: str | None
    ) -> InflectTrade | None:
        """One trade by id, with constituent fills + journal entry."""
        resolved = await self._resolve_account(account_id)
        matched = await self._matched_trades(resolved, _FAR_FUTURE_MS)
        for candidate in matched:
            if candidate.trade_id == trade_id:
                guarded = await self._apply_current_holdings_guard([candidate])
                candidate = guarded[0]
                await self._attach_journal([candidate])
                return candidate
        return None

    # ── Journal CRUD ───────────────────────────────────────────

    async def save_journal(
        self, trade_id: str, account_id: str | None, payload: JournalUpsertRequest
    ) -> JournalEntry:
        """Upsert setup/notes/tags for a trade; returns the stored entry."""
        resolved = await self._resolve_account(account_id)
        self._conid_from_trade_id(trade_id)
        trade = await self._find_trade(resolved, trade_id)
        if trade is None:
            raise InflectTradeNotFoundError(trade_id)
        await self.db.upsert_journal_entry(
            trade_id=trade_id,
            account_id=resolved,
            conid=trade.conid,
            setup=payload.setup,
            notes=payload.notes,
            tags=payload.tags,
        )
        row = await self.db.get_journal_entry(trade_id)
        assert row is not None  # just upserted
        return self._journal_from_row(row)

    def setups(self) -> InflectSetupsResponse:
        return InflectSetupsResponse(setups=list(SETUP_OPTIONS))

    async def backfill_status(
        self, account_id: str | None, conid: int | None = None
    ) -> InflectBackfillStatusResponse:
        resolved = await self._resolve_account(account_id)
        rows = await self.db.list_backfill_status(resolved)
        items = [
            InflectBackfillStatusItem(**row)
            for row in rows
            if conid is None or int(row["conid"]) == int(conid)
        ]
        return InflectBackfillStatusResponse(account_id=resolved, items=items)

    async def sync(self, account_id: str | None) -> InflectSyncResponse:
        """Force a fills sync via MoonMarket's ibkr → upsert_fills path."""
        resolved = await self._resolve_account(account_id)
        response = await self.moonmarket.trades(
            account_id=resolved, days=7, db=None
        )
        accepted = await self.db.upsert_fills(
            [
                trade.model_dump()
                if hasattr(trade, "model_dump")
                else dict(trade)
                for trade in response.trades
            ]
        )
        return InflectSyncResponse(account_id=resolved, synced=accepted)

    async def apply_pa_backfill_result(
        self,
        account_id: str | None,
        conid: int,
        result: PaBackfillResult,
    ) -> dict[str, Any]:
        """Import already-fetched PA rows, rerun matching, re-key, and audit.

        This method deliberately consumes a `PaBackfillResult` and never calls
        `/pa/transactions`; the backfill scheduler owns pacing and fetch timing.
        """
        resolved = await self._resolve_account(account_id)
        target_conid = int(conid)
        before = await self._matched_trades_for_conid(resolved, target_conid)

        fills = self._normalize_pa_rows(resolved, target_conid, result.rows)
        deduped = await self._dedupe_pa_fills(resolved, target_conid, fills)
        imported = await self.db.upsert_fills(deduped)

        after = await self._matched_trades_for_conid(resolved, target_conid)
        await self._rekey_vanished_journals(before, after)

        status = (
            "still_needs_basis"
            if any(trade.status == "INCOMPLETE_BASIS" for trade in after)
            else "resolved"
        )
        last_error = self._pa_backfill_last_error(result)
        await self.db.set_backfill_status(
            resolved,
            target_conid,
            status=status,
            days_used=result.days_used,
            last_error=last_error,
        )
        await self.db.insert_basis_audit(
            account_id=resolved,
            conid=target_conid,
            action="auto_backfill",
            source="PA_TRANSACTION",
            before_json=json.dumps(
                self._trade_summaries(before), sort_keys=True
            ),
            after_json=json.dumps(
                self._trade_summaries(after), sort_keys=True
            ),
        )
        return {
            "account_id": resolved,
            "conid": target_conid,
            "imported": imported,
            "status": status,
            "days_used": result.days_used,
            "fallback_days": result.fallback_days,
        }

    # ── Manual Basis Lots ─────────────────────────────────────

    async def list_basis_lots(
        self, account_id: str | None, conid: int
    ) -> list[BasisLot]:
        resolved = await self._resolve_account(account_id)
        rows = await self.db.list_basis_lots(resolved, int(conid))
        return [self._basis_lot_from_row(row) for row in rows]

    async def create_basis_lot(
        self, account_id: str | None, payload: BasisLotUpsertRequest
    ) -> BasisLot:
        resolved = await self._resolve_account(account_id)
        before = await self._matched_trades_for_conid(resolved, int(payload.conid))
        row = await self.db.create_basis_lot(
            account_id=resolved,
            conid=payload.conid,
            side=payload.side,
            quantity=payload.quantity,
            entry_date=payload.entry_date,
            entry_price=payload.entry_price,
            commission=payload.commission,
            note=payload.note,
        )
        after = await self._matched_trades_for_conid(resolved, int(payload.conid))
        await self._rekey_vanished_journals(before, after)
        await self._audit_lot_change(
            account_id=resolved,
            conid=int(payload.conid),
            action="lot_create",
            before=before,
            after=after,
        )
        return self._basis_lot_from_row(row)

    async def update_basis_lot(
        self,
        *,
        lot_id: int,
        account_id: str | None,
        payload: BasisLotUpsertRequest,
    ) -> BasisLot:
        resolved = await self._resolve_account(account_id)
        old_row = await self._basis_lot_row(resolved, lot_id)
        before_conids = {int(payload.conid)}
        if old_row is not None:
            before_conids.add(int(old_row["conid"]))
        before = await self._matched_trades_for_conids(resolved, before_conids)
        row = await self.db.update_basis_lot(
            lot_id=lot_id,
            account_id=resolved,
            conid=payload.conid,
            side=payload.side,
            quantity=payload.quantity,
            entry_date=payload.entry_date,
            entry_price=payload.entry_price,
            commission=payload.commission,
            note=payload.note,
        )
        if row is None:
            raise InflectBasisLotNotFoundError(str(lot_id))
        after = await self._matched_trades_for_conids(
            resolved, {int(row["conid"]), *before_conids}
        )
        await self._rekey_vanished_journals(before, after)
        await self._audit_lot_change(
            account_id=resolved,
            conid=int(row["conid"]),
            action="lot_update",
            before=before,
            after=after,
        )
        return self._basis_lot_from_row(row)

    async def delete_basis_lot(
        self, *, lot_id: int, account_id: str | None
    ) -> bool:
        resolved = await self._resolve_account(account_id)
        old_row = await self._basis_lot_row(resolved, lot_id)
        if old_row is None:
            raise InflectBasisLotNotFoundError(str(lot_id))
        conid = int(old_row["conid"])
        before = await self._matched_trades_for_conid(resolved, conid)
        deleted = await self.db.delete_basis_lot(lot_id, resolved)
        if not deleted:
            raise InflectBasisLotNotFoundError(str(lot_id))
        after = await self._matched_trades_for_conid(resolved, conid)
        await self._rekey_vanished_journals(before, after)
        await self._audit_lot_change(
            account_id=resolved,
            conid=conid,
            action="lot_delete",
            before=before,
            after=after,
        )
        return True

    # ── Internals ──────────────────────────────────────────────

    async def _matched_trades(
        self, account_id: str, end_ms: int
    ) -> list[InflectTrade]:
        """Run the FIFO matcher over every fill up to end_ms.

        Reads from 0 (not the window start) so positions opened before the
        window resolve correctly — the matcher needs a trade's opening fills to
        compute its P&L. Acceptable for v1 history sizes (plan risk #4).
        """
        fills = await self.db.list_fills_for_account_range(account_id, 0, end_ms)
        fills = [
            *await self._manual_lot_fills(account_id, end_ms),
            *fills,
        ]
        return match_fills(fills)

    async def _matched_trades_for_conid(
        self, account_id: str, conid: int
    ) -> list[InflectTrade]:
        matched = await self._matched_trades(account_id, _FAR_FUTURE_MS)
        return [
            trade
            for trade in matched
            if trade.account_id == account_id and trade.conid == int(conid)
        ]

    async def _matched_trades_for_conids(
        self, account_id: str, conids: set[int]
    ) -> list[InflectTrade]:
        matched = await self._matched_trades(account_id, _FAR_FUTURE_MS)
        target_conids = {int(conid) for conid in conids}
        return [
            trade
            for trade in matched
            if trade.account_id == account_id and trade.conid in target_conids
        ]

    async def _manual_lot_fills(
        self, account_id: str, end_ms: int
    ) -> list[dict[str, Any]]:
        rows = await self.db.fetch_all(
            """
            SELECT *
            FROM basis_lots
            WHERE account_id = ?
            ORDER BY entry_date ASC, created_at ASC, id ASC
            """,
            (account_id,),
        )
        fills: list[dict[str, Any]] = []
        for offset_ms, row in enumerate(rows):
            trade_time_ms = self._basis_lot_trade_time_ms(row, offset_ms)
            if trade_time_ms > end_ms:
                continue
            side = str(row["side"]).upper()
            fill = {
                "execution_id": f"LOT:{int(row['id'])}",
                "account_id": account_id,
                "conid": int(row["conid"]),
                "symbol": row.get("symbol"),
                "side": "BUY" if side == "LONG" else "SELL",
                "quantity": float(row["quantity"]),
                "price": float(row["entry_price"]),
                "net_amount": float(row["entry_price"]) * float(row["quantity"]),
                "commission": self._to_float(row.get("commission")),
                "sec_type": row.get("sec_type"),
                "trade_time": datetime.fromtimestamp(
                    trade_time_ms / 1000, ZoneInfo(TRADING_DAY_TZ)
                ).isoformat(),
                "trade_time_ms": trade_time_ms,
                "source": "MANUAL_LOT",
            }
            if side == "SHORT":
                fill["position_effect"] = "OPEN"
            fills.append(fill)
        return fills

    @staticmethod
    def _basis_lot_trade_time_ms(row: dict[str, Any], offset_ms: int) -> int:
        entry = datetime.strptime(str(row["entry_date"]), "%Y-%m-%d")
        entry = entry.replace(tzinfo=ZoneInfo(TRADING_DAY_TZ))
        return int(entry.timestamp() * 1000) + offset_ms

    async def _basis_lot_row(
        self, account_id: str, lot_id: int
    ) -> dict[str, Any] | None:
        rows = await self.db.fetch_all(
            """
            SELECT *
            FROM basis_lots
            WHERE account_id = ? AND id = ?
            """,
            (account_id, int(lot_id)),
        )
        return rows[0] if rows else None

    async def _audit_lot_change(
        self,
        *,
        account_id: str,
        conid: int,
        action: str,
        before: list[InflectTrade],
        after: list[InflectTrade],
    ) -> None:
        await self.db.insert_basis_audit(
            account_id=account_id,
            conid=conid,
            action=action,
            source="MANUAL",
            before_json=json.dumps(
                self._trade_summaries(before), sort_keys=True
            ),
            after_json=json.dumps(
                self._trade_summaries(after), sort_keys=True
            ),
        )

    def _normalize_pa_rows(
        self, account_id: str, conid: int, rows: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for seq, row in enumerate(rows, start=1):
            row_conid = self._to_int(
                self._first_value(row, ("conid", "contractId", "contract_id"))
            )
            if row_conid is not None and row_conid != conid:
                continue
            side = self._pa_side(row)
            quantity = self._pa_quantity(row)
            trade_time_ms = self._pa_trade_time_ms(row)
            if side is None or quantity is None or trade_time_ms is None:
                continue
            price = self._to_float(
                self._first_value(
                    row, ("price", "tradePrice", "transactionPrice", "costPrice")
                )
            )
            trade_time = self._pa_trade_time(row, trade_time_ms)
            normalized.append(
                {
                    "execution_id": f"PA:{conid}:{trade_time_ms}:{seq}",
                    "account_id": account_id,
                    "conid": conid,
                    "symbol": self._first_value(row, ("symbol", "ticker")),
                    "description": self._first_value(
                        row, ("description", "assetDescription")
                    ),
                    "side": side,
                    "quantity": quantity,
                    "price": price,
                    "net_amount": self._to_float(
                        self._first_value(row, ("net_amount", "netAmount", "amount"))
                    ),
                    "commission": self._to_float(
                        self._first_value(row, ("commission", "commissions"))
                    ),
                    "sec_type": self._first_value(row, ("sec_type", "secType")),
                    "trade_time": trade_time,
                    "trade_time_ms": trade_time_ms,
                    "source": "PA_TRANSACTION",
                    "raw_json": row,
                }
            )
        return normalized

    async def _dedupe_pa_fills(
        self, account_id: str, conid: int, fills: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        if not fills:
            return []
        existing = [
            fill
            for fill in await self.db.list_fills_for_account_range(
                account_id, 0, _FAR_FUTURE_MS
            )
            if int(fill["conid"]) == int(conid)
        ]
        existing_pks = {
            (str(fill["account_id"]), str(fill["execution_id"]))
            for fill in existing
        }
        existing_content = {self._fill_content_key(fill) for fill in existing}

        accepted: list[dict[str, Any]] = []
        seen_content: set[tuple[Any, ...]] = set()
        for fill in fills:
            pk = (str(fill["account_id"]), str(fill["execution_id"]))
            content_key = self._fill_content_key(fill)
            if pk in existing_pks:
                continue
            if content_key in existing_content or content_key in seen_content:
                continue
            accepted.append(fill)
            seen_content.add(content_key)
        return accepted

    async def _rekey_vanished_journals(
        self, before: list[InflectTrade], after: list[InflectTrade]
    ) -> None:
        after_ids = {trade.trade_id for trade in after}
        for old_trade in before:
            if old_trade.trade_id in after_ids:
                continue
            journal = await self.db.get_journal_entry(old_trade.trade_id)
            if journal is None:
                continue
            successor = self._successor_trade(old_trade, after)
            if successor is not None:
                await self.db.rekey_journal_entry(
                    old_trade.trade_id, successor.trade_id
                )

    @staticmethod
    def _successor_trade(
        old_trade: InflectTrade, candidates: list[InflectTrade]
    ) -> InflectTrade | None:
        same_contract = [
            trade
            for trade in candidates
            if trade.account_id == old_trade.account_id
            and trade.conid == old_trade.conid
        ]
        recovered = [
            trade for trade in same_contract if trade.status != "INCOMPLETE_BASIS"
        ]
        if not recovered:
            recovered = same_contract
        if not recovered:
            return None

        old_execution_ids = {fill.execution_id for fill in old_trade.fills}
        covering = [
            trade
            for trade in recovered
            if old_execution_ids
            & {fill.execution_id for fill in trade.fills}
        ]
        if covering:
            return sorted(covering, key=lambda trade: trade.open_time_ms)[0]
        return sorted(recovered, key=lambda trade: trade.open_time_ms)[0]

    @staticmethod
    def _fill_content_key(fill: dict[str, Any]) -> tuple[Any, ...]:
        price = fill.get("price")
        return (
            int(fill["conid"]),
            str(fill["side"]).upper(),
            float(fill["quantity"]),
            None if price is None else float(price),
            int(fill["trade_time_ms"]),
        )

    @classmethod
    def _pa_side(cls, row: dict[str, Any]) -> str | None:
        raw = cls._first_value(
            row,
            (
                "side",
                "buySell",
                "buy_sell",
                "transactionType",
                "tradeType",
            ),
        )
        if raw is None:
            return None
        value = str(raw).strip().upper()
        if value in {"BUY", "BOT", "B"}:
            return "BUY"
        if value in {"SELL", "SLD", "S"}:
            return "SELL"
        return None

    @classmethod
    def _pa_quantity(cls, row: dict[str, Any]) -> float | None:
        value = cls._to_float(
            cls._first_value(row, ("quantity", "qty", "shares", "units"))
        )
        if value is None:
            return None
        return abs(value)

    @classmethod
    def _pa_trade_time_ms(cls, row: dict[str, Any]) -> int | None:
        explicit = cls._to_int(
            cls._first_value(row, ("trade_time_ms", "tradeTimeMs", "time_ms"))
        )
        if explicit is not None:
            return explicit
        raw = cls._first_value(
            row, ("trade_time", "dateTime", "datetime", "tradeDate", "date")
        )
        parsed = cls._parse_datetime(raw)
        if parsed is None:
            return None
        return int(parsed.timestamp() * 1000)

    @classmethod
    def _pa_trade_time(cls, row: dict[str, Any], trade_time_ms: int) -> str:
        raw = cls._first_value(row, ("trade_time", "dateTime", "datetime"))
        if raw is not None:
            return str(raw)
        return datetime.fromtimestamp(
            trade_time_ms / 1000, ZoneInfo(TRADING_DAY_TZ)
        ).isoformat()

    @staticmethod
    def _parse_datetime(value: Any) -> datetime | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    parsed = datetime.strptime(text, fmt)
                    break
                except ValueError:
                    parsed = None
            if parsed is None:
                return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo(TRADING_DAY_TZ))
        return parsed

    @staticmethod
    def _pa_backfill_last_error(result: PaBackfillResult) -> str | None:
        if result.rejected_long_history and result.fallback_days is not None:
            return f"max_days_rejected; fallback_days={result.fallback_days}"
        if result.rejected_long_history:
            return "max_days_rejected"
        return None

    @staticmethod
    def _trade_summaries(trades: list[InflectTrade]) -> list[dict[str, Any]]:
        return [
            {
                "trade_id": trade.trade_id,
                "status": trade.status,
                "direction": trade.direction,
                "qty": trade.qty,
                "open_time_ms": trade.open_time_ms,
                "close_time_ms": trade.close_time_ms,
                "fill_execution_ids": [
                    fill.execution_id for fill in trade.fills
                ],
            }
            for trade in sorted(trades, key=lambda item: item.open_time_ms)
        ]

    async def current_position(self, account_id: str, conid: int) -> float | None:
        """Return IBKR's current signed aggregate position for one contract.

        This is a display-only sanity check. It is cached per service instance
        so repeated UI reads do not re-poll the portfolio endpoint.
        """
        key = (account_id, conid)
        if key in self._position_cache:
            return self._position_cache[key]
        if self.ibkr is None:
            self._position_cache[key] = None
            return None

        payload = await self.ibkr._request(
            "GET", f"/portfolio2/{account_id}/positions"
        )
        position = self._position_from_payload(payload, conid)
        self._position_cache[key] = position
        return position

    async def _apply_current_holdings_guard(
        self, trades: list[InflectTrade]
    ) -> list[InflectTrade]:
        guarded: list[InflectTrade] = []
        for trade in trades:
            if trade.status != "OPEN" or trade.direction != "SHORT":
                guarded.append(trade)
                continue

            try:
                position = await self.current_position(trade.account_id, trade.conid)
            except (IBKRAuthError, IBKRConnectionError, IBKRRateLimitError):
                guarded.append(trade)
                continue

            if position is not None and position >= 0:
                guarded.append(
                    trade.model_copy(
                        update={
                            "direction": "UNKNOWN",
                            "status": "INCOMPLETE_BASIS",
                            "avg_entry": 0.0,
                            "gross_pnl": None,
                            "net_pnl": None,
                            "return_pct": None,
                        }
                    )
                )
                continue

            guarded.append(trade)
        return guarded

    @classmethod
    def _position_from_payload(cls, payload: Any, conid: int) -> float | None:
        total = 0.0
        matched = False
        for row in cls._position_rows(payload):
            row_conid = cls._to_int(
                cls._first_value(
                    row, ("conid", "contractId", "contract_id", "conId")
                )
            )
            if row_conid != conid:
                continue
            quantity = cls._to_float(
                cls._first_value(row, ("position", "quantity", "pos", "qty"))
            )
            if quantity is None:
                continue
            total += quantity
            matched = True
        return total if matched else None

    @classmethod
    def _position_rows(cls, payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        if not isinstance(payload, dict):
            return []
        for key in ("positions", "data", "results"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
        return [payload]

    @staticmethod
    def _first_value(row: dict[str, Any], keys: tuple[str, ...]) -> Any:
        for key in keys:
            if key in row and row[key] is not None:
                return row[key]
        return None

    @staticmethod
    def _to_float(value: Any) -> float | None:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _to_int(value: Any) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    async def _find_trade(
        self, account_id: str, trade_id: str
    ) -> InflectTrade | None:
        matched = await self._matched_trades(account_id, _FAR_FUTURE_MS)
        for trade in matched:
            if trade.trade_id == trade_id and trade.account_id == account_id:
                return trade
        return None

    async def _attach_journal(self, trades: list[InflectTrade]) -> None:
        if not trades:
            return
        rows: list[dict] = []
        account_ids = {trade.account_id for trade in trades}
        for account_id in account_ids:
            conids = [
                trade.conid for trade in trades if trade.account_id == account_id
            ]
            rows.extend(
                await self.db.get_journal_entries_for_conids(
                    conids, account_id=account_id
                )
            )
        by_trade_key = {(row["trade_id"], row["account_id"]): row for row in rows}
        for trade in trades:
            row = by_trade_key.get((trade.trade_id, trade.account_id))
            if row is not None:
                trade.journal_entry = self._journal_from_row(row)

    @staticmethod
    def _reference_ms(trade: InflectTrade) -> int:
        """The date a trade is filed under: close time if closed, else open."""
        if trade.status == "CLOSED" and trade.close_time_ms is not None:
            return trade.close_time_ms
        return trade.open_time_ms

    @staticmethod
    def _conid_from_trade_id(trade_id: str) -> int:
        # trade_id = f"{account_id}:{conid}:{first_open_execution_id}"
        parts = trade_id.split(":", 2)
        if len(parts) < 3:
            raise ValueError(f"Malformed trade_id: {trade_id!r}")
        return int(parts[1])

    @staticmethod
    def _journal_from_row(row: dict) -> JournalEntry:
        return JournalEntry(
            trade_id=row["trade_id"],
            account_id=row["account_id"],
            conid=int(row["conid"]),
            setup=row.get("setup"),
            notes=row.get("notes"),
            tags=row.get("tags") or [],
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    @staticmethod
    def _basis_lot_from_row(row: dict) -> BasisLot:
        return BasisLot(
            id=int(row["id"]),
            account_id=row["account_id"],
            conid=int(row["conid"]),
            side=row["side"],
            quantity=float(row["quantity"]),
            entry_date=row["entry_date"],
            entry_price=float(row["entry_price"]),
            commission=(
                None if row.get("commission") is None else float(row["commission"])
            ),
            note=row.get("note"),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    async def _resolve_account(self, account_id: str | None) -> str:
        """Resolve to a concrete account id via MoonMarket's account store.

        Raises MoonMarketAccountNotFoundError for unknown / unavailable
        accounts (the router maps it to a 404).
        """
        return await self.moonmarket._resolve_account_id(account_id)
