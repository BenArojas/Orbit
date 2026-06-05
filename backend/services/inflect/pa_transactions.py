from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from exceptions import IBKRRequestError


DEFAULT_DAYS = 365
FALLBACK_DAYS = 90


class PaTransactionsClient(Protocol):
    async def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs: Any,
    ) -> dict[str, Any] | list[dict[str, Any]]:
        ...


@dataclass(frozen=True)
class PaBackfillResult:
    rows: list[dict[str, Any]]
    days_used: int
    rejected_long_history: bool
    fallback_days: int | None = None

    @property
    def still_needs_basis(self) -> bool:
        return len(self.rows) == 0


async def fetch_transactions(
    ibkr: PaTransactionsClient,
    account_id: str,
    conid: int,
    days: int = DEFAULT_DAYS,
) -> PaBackfillResult:
    """Fetch one paced /pa/transactions window.

    The scheduler owns the 16-minute cadence, so this helper never performs
    an immediate second request. If the preferred 365-day window is rejected or
    empty, it returns fallback_days=90 and lets the scheduler enqueue that
    fallback on the next eligible tick.
    """
    try:
        rows = await _fetch_window(ibkr, account_id, conid, days)
    except IBKRRequestError:
        if days <= FALLBACK_DAYS:
            raise
        return PaBackfillResult(
            rows=[],
            days_used=days,
            rejected_long_history=True,
            fallback_days=FALLBACK_DAYS,
        )

    if rows or days <= FALLBACK_DAYS:
        return PaBackfillResult(
            rows=rows,
            days_used=days,
            rejected_long_history=False,
        )

    return PaBackfillResult(
        rows=[],
        days_used=days,
        rejected_long_history=True,
        fallback_days=FALLBACK_DAYS,
    )


async def _fetch_window(
    ibkr: PaTransactionsClient,
    account_id: str,
    conid: int,
    days: int,
) -> list[dict[str, Any]]:
    payload = await ibkr._request(
        "GET",
        "/pa/transactions",
        params={
            "accountId": account_id,
            "conid": str(conid),
            "days": days,
        },
    )
    return _extract_rows(payload)


def _extract_rows(payload: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return payload

    rows = payload.get("transactions")
    if isinstance(rows, list):
        return rows

    data = payload.get("data")
    if isinstance(data, list):
        return data

    return []
