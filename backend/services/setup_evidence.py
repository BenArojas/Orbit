from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import exchange_calendars as xcals

from constants.ibkr_history import VALID_TIMEFRAMES

EASTERN = ZoneInfo("America/New_York")
US_EXTENDED = "us_equity_extended"
INTRADAY_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400}


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def setup_timestamps(row: dict) -> dict:
    for field in ("created_at", "updated_at", "archived_at", "checked_at", "evidence_at", "reviewed_at"):
        value = row.get(field)
        if value:
            try:
                if datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is None:
                    row[field] = parse_utc(value).isoformat()
            except (TypeError, ValueError):
                pass
    return row


def evidence_is_current(
    evidence_at: str | None, timeframe: str, now: datetime, *, outside_rth: bool = True
) -> bool:
    if not evidence_at or timeframe not in VALID_TIMEFRAMES:
        return False
    try:
        evidence = parse_utc(evidence_at)
        if evidence > now:
            return False
        local_now = now.astimezone(EASTERN)
        calendar = xcals.get_calendar("XNYS")
        sessions = calendar.sessions_in_range(
            local_now.date() - timedelta(days=14), local_now.date()
        )
        eligible = []
        for session in sessions:
            opening = calendar.session_open(session).to_pydatetime().astimezone(EASTERN)
            closing = calendar.session_close(session).to_pydatetime().astimezone(EASTERN)
            if outside_rth:
                opening = opening.replace(hour=4, minute=0)
                closing += timedelta(hours=4)
            if opening <= local_now:
                eligible.append((session.date(), opening, closing))
        if not eligible:
            return False
        date, opening, closing = eligible[-1]
        evidence_date = evidence.astimezone(timezone.utc).date()
        if timeframe == "1D":
            return evidence_date == date
        if timeframe == "1W":
            return evidence_date.isocalendar()[:2] == date.isocalendar()[:2]
        if timeframe == "1M":
            return (evidence_date.year, evidence_date.month) == (date.year, date.month)
        seconds = INTRADAY_SECONDS[timeframe]
        end = min(local_now, closing - timedelta(microseconds=1))
        bucket = opening + timedelta(seconds=int((end - opening).total_seconds() // seconds) * seconds)
        # The existing engine checks the latest available bar, including a forming bar.
        earliest = max(opening, bucket - timedelta(seconds=seconds)) if local_now < closing else bucket
        return earliest <= evidence.astimezone(EASTERN) <= end
    except (TypeError, ValueError, KeyError, OverflowError, RuntimeError):
        return False
