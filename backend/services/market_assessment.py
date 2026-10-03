"""Completed-session Market assessment for Parallax."""

from __future__ import annotations

import asyncio
import datetime as dt
import itertools
import logging
import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from zoneinfo import ZoneInfo

import exchange_calendars as xcals
import pandas as pd

from constants import SECTOR_ETFS
from models.market_assessment import (
    MarketAssessmentResponse,
    MarketInstrumentEvidence,
    MarketParticipation,
    PreviousMarketAssessment,
)
from services.indicators import IndicatorService
from services.ibkr import IBKRService

log = logging.getLogger("parallax.services.market_assessment")

INDEX_SYMBOLS = ("SPY", "QQQ", "IWM")
ALL_SYMBOLS = (*INDEX_SYMBOLS, *(item["symbol"] for item in SECTOR_ETFS))
RETRY_SECONDS = 300
RETRY_CACHE_SECONDS = 240
POST_CLOSE_BUFFER = dt.timedelta(minutes=5)
EASTERN = ZoneInfo("America/New_York")


@dataclass
class _AssessmentFlight:
    task: asyncio.Task[MarketAssessmentResponse]
    callers: int = 0


def _iso_utc(value: dt.datetime | None) -> str | None:
    return value.astimezone(dt.UTC).isoformat().replace("+00:00", "Z") if value else None


def _bar_date(value: Any) -> dt.date | None:
    try:
        if isinstance(value, str):
            raw = value.strip()
            if len(raw) == 8 and raw.isdigit():
                return dt.datetime.strptime(raw, "%Y%m%d").date()
            if raw.isdigit():
                value = int(raw)
            else:
                return dt.datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
        number = int(value)
        if 10_000_101 <= number <= 99_991_231:
            return dt.datetime.strptime(str(number), "%Y%m%d").date()
        timestamp = number / 1000 if abs(number) > 10_000_000_000 else number
        return dt.datetime.fromtimestamp(timestamp, tz=dt.UTC).date()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _positive_close(value: Any) -> float | None:
    try:
        close = float(value)
    except (TypeError, ValueError):
        return None
    return close if math.isfinite(close) and close > 0 else None


def _posture(index_trends: tuple[str, ...], above_count: int) -> str:
    if all(trend == "constructive" for trend in index_trends) and above_count >= 8:
        return "broad"
    if sum(trend == "weak" for trend in index_trends) >= 2 and above_count <= 3:
        return "defensive"
    return "selective"


class MarketAssessmentService:
    """Resolve, fetch, and classify one year of regular-hours daily evidence."""

    def __init__(
        self,
        ibkr: IBKRService,
        *,
        now: Callable[[], dt.datetime] | None = None,
        calendar: Any | None = None,
    ) -> None:
        self.ibkr = ibkr
        self._now = now or (lambda: dt.datetime.now(EASTERN))
        self._calendar = calendar or xcals.get_calendar("XNYS")
        self._cache: dict[str, tuple[float, MarketAssessmentResponse]] = {}
        self._inflight: dict[str, _AssessmentFlight] = {}
        self._previous: PreviousMarketAssessment | None = None

    def _session_context(self) -> tuple[dt.date, list[dt.date], bool, dt.datetime]:
        now = self._now().astimezone(EASTERN)
        today = now.date()
        start = today - dt.timedelta(days=370)
        end = today + dt.timedelta(days=20)
        sessions = list(self._calendar.sessions_in_range(
            pd.Timestamp(start), pd.Timestamp(end)
        ))
        session_dates = [session.date() for session in sessions]
        closes = {
            session.date(): self._calendar.session_close(session).to_pydatetime()
            for session in sessions
        }
        completed = [
            session_date for session_date in session_dates
            if closes[session_date].astimezone(EASTERN) + POST_CLOSE_BUFFER <= now
        ]
        if not completed:
            raise ValueError("XNYS schedule does not include a completed session")
        expected = completed[-1]
        is_open = any(
            self._calendar.session_open(session).to_pydatetime().astimezone(EASTERN)
            <= now
            < self._calendar.session_close(session).to_pydatetime().astimezone(EASTERN)
            for session in sessions if session.date() == today
        )
        next_close = next(
            (
                closes[session_date] + POST_CLOSE_BUFFER
                for session_date in session_dates
                if closes[session_date] + POST_CLOSE_BUFFER > now.astimezone(dt.UTC)
            ),
            None,
        )
        if next_close is None:
            raise ValueError("XNYS schedule does not include the next session close")
        eligible = [session_date for session_date in session_dates if session_date <= expected]
        return expected, eligible, is_open, next_close

    async def get_assessment(self) -> MarketAssessmentResponse:
        now = self._now().astimezone(EASTERN)
        try:
            expected, sessions, market_open, next_reconcile = self._session_context()
        except Exception as exc:
            log.warning("XNYS schedule unavailable for Market assessment: %s", exc)
            unavailable = self._unavailable(_iso_utc(now), f"XNYS session schedule unavailable: {exc}")
            return unavailable.model_copy(update={
                "next_reconcile_at": _iso_utc(now + dt.timedelta(seconds=RETRY_SECONDS)),
            })

        cache_key = expected.isoformat()
        hit = self._cache.get(cache_key)
        if hit and hit[0] > now.timestamp():
            return hit[1].model_copy(update={
                "next_reconcile_at": _iso_utc(next_reconcile),
                "market_open": market_open,
            })

        flight = self._inflight.get(cache_key)
        if flight is None:
            task = asyncio.create_task(
                self._calculate(expected, sessions, market_open, next_reconcile)
            )
            flight = _AssessmentFlight(task)
            self._inflight[cache_key] = flight
            task.add_done_callback(
                lambda completed, key=cache_key, current=flight: self._finish_flight(key, current, completed)
            )
        flight.callers += 1
        try:
            return await asyncio.shield(flight.task)
        finally:
            flight.callers -= 1
            if flight.callers == 0 and self._inflight.get(cache_key) is flight:
                self._inflight.pop(cache_key, None)
                if not flight.task.done():
                    flight.task.cancel()

    def _finish_flight(
        self,
        cache_key: str,
        flight: _AssessmentFlight,
        task: asyncio.Task[MarketAssessmentResponse],
    ) -> None:
        if self._inflight.get(cache_key) is flight:
            self._inflight.pop(cache_key, None)
        try:
            task.exception()
        except asyncio.CancelledError:
            pass

    def _unavailable(self, calculated_at: str, issue: str) -> MarketAssessmentResponse:
        return MarketAssessmentResponse(
            status="incomplete", posture=None, expected_session=None, evidence_session=None,
            calculated_at=calculated_at,
            indices=[MarketInstrumentEvidence(symbol=s, unavailable_reason=issue) for s in INDEX_SYMBOLS],
            sectors=[MarketInstrumentEvidence(symbol=s["symbol"], name=s["name"], unavailable_reason=issue) for s in SECTOR_ETFS],
            participation=MarketParticipation(
                available=0, missing=11, confirmed_above=0,
                possible_above_min=0, possible_above_max=11,
            ),
            issues=[issue], previous_assessment=self._previous,
        )

    async def _calculate(
        self,
        expected: dt.date,
        sessions: list[dt.date],
        market_open: bool,
        next_reconcile: dt.datetime,
    ) -> MarketAssessmentResponse:
        resolved = await asyncio.gather(
            *(self.ibkr.get_conid(symbol) for symbol in ALL_SYMBOLS),
            return_exceptions=True,
        )
        conids: dict[str, int] = {
            symbol: result for symbol, result in zip(ALL_SYMBOLS, resolved)
            if isinstance(result, int)
        }
        histories = await asyncio.gather(
            *(
                self.ibkr.history_fresh(conids[symbol], period="1y", bar="1d", outside_rth=False)
                if symbol in conids else asyncio.sleep(0, result=None)
                for symbol in ALL_SYMBOLS
            ),
            return_exceptions=True,
        )
        bars_by_symbol: dict[str, dict[dt.date, float]] = {}
        fetch_issues: dict[str, str] = {}
        for symbol, raw in zip(ALL_SYMBOLS, histories):
            if isinstance(raw, BaseException):
                fetch_issues[symbol] = "Daily history request failed"
                log.warning("Market assessment history failed for %s: %s", symbol, raw)
                continue
            if not isinstance(raw, dict):
                fetch_issues[symbol] = "Instrument could not be resolved"
                continue
            bars: dict[dt.date, float] = {}
            raw_bars = raw.get("data")
            if not isinstance(raw_bars, list):
                fetch_issues[symbol] = "Provider returned an invalid daily history response"
                bars_by_symbol[symbol] = bars
                continue
            for bar in raw_bars:
                if not isinstance(bar, dict):
                    continue
                session_date = _bar_date(bar.get("t"))
                close = _positive_close(bar.get("c"))
                if session_date in sessions and close is not None:
                    bars[session_date] = close
            bars_by_symbol[symbol] = bars
            if not bars:
                fetch_issues[symbol] = "No valid regular-session daily closes"

        required100 = sessions[-100:]
        required200 = sessions[-200:]
        index_evidence: list[MarketInstrumentEvidence] = []
        sector_evidence: list[MarketInstrumentEvidence] = []
        for symbol in INDEX_SYMBOLS:
            index_evidence.append(self._instrument(
                symbol, conids.get(symbol), bars_by_symbol.get(symbol, {}), required100,
                required200, expected, fetch_issues.get(symbol), is_index=True,
            ))
        for item in SECTOR_ETFS:
            symbol = item["symbol"]
            evidence = self._instrument(
                symbol, conids.get(symbol), bars_by_symbol.get(symbol, {}), required100,
                required200, expected, fetch_issues.get(symbol), is_index=False,
            )
            evidence = evidence.model_copy(update={"name": item["name"]})
            sector_evidence.append(evidence)

        above = sum(item.above_sma50 is True for item in sector_evidence)
        missing = sum(item.above_sma50 is None for item in sector_evidence)
        available = len(sector_evidence) - missing
        possible_min, possible_max = above, above + missing
        trends = [item.trend for item in index_evidence]
        options = [
            (trend,) if trend else ("constructive", "weak", "mixed")
            for trend in trends
        ]
        outcomes = {
            _posture(tuple(combo), count)
            for combo in itertools.product(*options)
            for count in range(possible_min, possible_max + 1)
        }
        posture = next(iter(outcomes)) if len(outcomes) == 1 else None
        has_missing = any(trend is None for trend in trends) or missing > 0
        status = "incomplete" if posture is None else "partial" if has_missing else "complete"
        issues = [
            f"{evidence.symbol}: {evidence.unavailable_reason}"
            for evidence in (*index_evidence, *sector_evidence)
            if evidence.unavailable_reason
        ]
        if missing:
            issues.append(f"{missing} sector ETF value(s) unavailable; participation range is {possible_min}-{possible_max} of 11")
        if any(item.sma200 is None for item in index_evidence):
            issues.append("SMA200 context unavailable for one or more indices")
        previous_assessment = self._previous
        calculated_at = _iso_utc(self._now())
        response = MarketAssessmentResponse(
            status=status,
            posture=posture,
            expected_session=expected.isoformat(),
            evidence_session=expected.isoformat() if posture is not None else None,
            calculated_at=calculated_at,
            indices=index_evidence,
            sectors=sector_evidence,
            participation=MarketParticipation(
                available=available, missing=missing, confirmed_above=above,
                possible_above_min=possible_min, possible_above_max=possible_max,
            ),
            issues=issues,
            previous_assessment=previous_assessment,
            next_reconcile_at=_iso_utc(next_reconcile),
            market_open=market_open,
        )
        ttl = RETRY_CACHE_SECONDS
        self._cache[expected.isoformat()] = (self._now().timestamp() + ttl, response)
        if posture is not None:
            self._previous = PreviousMarketAssessment(
                posture=posture,
                evidence_session=expected.isoformat(),
                calculated_at=calculated_at,
            )
        return response

    @staticmethod
    def _instrument(
        symbol: str,
        conid: int | None,
        bars: dict[dt.date, float],
        required100: list[dt.date],
        required200: list[dt.date],
        expected: dt.date,
        fetch_issue: str | None,
        *,
        is_index: bool,
    ) -> MarketInstrumentEvidence:
        latest_date = max(bars, default=None)
        current = len(required100) == 100 and latest_date == expected and all(
            date in bars for date in required100
        )
        closes100 = [bars[date] for date in required100 if date in bars]
        close = bars.get(expected)
        ema21 = IndicatorService.ema_series(closes100, 21)[-1] if current else None
        sma50 = sum(closes100[-50:]) / 50 if current else None
        trend = None
        above_sma50 = None
        if current and close is not None and ema21 is not None and sma50 is not None:
            if close > ema21 and close > sma50:
                trend = "constructive"
            elif close < ema21 and close < sma50:
                trend = "weak"
            else:
                trend = "mixed"
            above_sma50 = close > sma50
        closes200 = [bars[date] for date in required200 if date in bars]
        sma200 = sum(closes200) / 200 if len(required200) == 200 and len(closes200) == 200 else None
        if fetch_issue:
            reason = fetch_issue
        elif not conid:
            reason = "Instrument could not be resolved"
        elif not bars:
            reason = "No valid regular-session daily closes"
        elif latest_date != expected:
            reason = f"Latest close is dated {latest_date.isoformat()}, expected {expected.isoformat()}"
        elif not current:
            reason = "Fewer than 100 consecutive scheduled completed-session closes"
        else:
            reason = None
        return MarketInstrumentEvidence(
            symbol=symbol, conid=conid,
            session_date=latest_date.isoformat() if latest_date else None,
            close=close if current else None,
            ema21=ema21 if is_index else None,
            sma50=sma50,
            sma200=sma200 if is_index else None,
            trend=trend if is_index else None,
            above_sma50=above_sma50 if not is_index else None,
            unavailable_reason=reason,
        )
