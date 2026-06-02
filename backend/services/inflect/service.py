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

from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from constants.inflect import SETUP_OPTIONS, TRADING_DAY_TZ
from models.inflect import (
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
from services.moonmarket import MoonMarketService

# Upper bound for "open-ended" fill windows (≈ year 2100 in epoch ms). The
# matcher must see every fill from a position's open, so reads start at 0;
# this caps the other end when the caller gives no explicit `to`.
_FAR_FUTURE_MS = 4_102_444_800_000


class InflectTradeNotFoundError(LookupError):
    """Raised when a resolved account has no matching derived trade."""


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
        return match_fills(fills)

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

    async def _resolve_account(self, account_id: str | None) -> str:
        """Resolve to a concrete account id via MoonMarket's account store.

        Raises MoonMarketAccountNotFoundError for unknown / unavailable
        accounts (the router maps it to a 404).
        """
        return await self.moonmarket._resolve_account_id(account_id)
