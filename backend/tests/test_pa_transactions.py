import pytest

from exceptions import IBKRRateLimitError, IBKRRequestError
from services.inflect.pa_transactions import fetch_transactions


class _FakeIBKR:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    async def _request(self, method, endpoint, params=None):
        self.requests.append((method, endpoint, params))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


@pytest.mark.asyncio
async def test_fetch_transactions_returns_365_day_rows_without_fallback():
    ibkr = _FakeIBKR(
        [
            {
                "transactions": [
                    {"conid": 265598, "quantity": 10, "price": 100.0},
                ]
            }
        ]
    )

    result = await fetch_transactions(ibkr, "DU123", 265598)

    assert result.rows == [{"conid": 265598, "quantity": 10, "price": 100.0}]
    assert result.days_used == 365
    assert result.rejected_long_history is False
    assert result.still_needs_basis is False
    assert ibkr.requests == [
        (
            "GET",
            "/pa/transactions",
            {"accountId": "DU123", "conid": "265598", "days": 365},
        )
    ]


@pytest.mark.asyncio
async def test_fetch_transactions_flags_90_day_fallback_when_365_is_rejected():
    ibkr = _FakeIBKR(
        [
            IBKRRequestError(400, "days exceeds the supported history window"),
        ]
    )

    result = await fetch_transactions(ibkr, "DU123", 265598)

    assert result.rows == []
    assert result.days_used == 365
    assert result.rejected_long_history is True
    assert result.fallback_days == 90
    assert result.still_needs_basis is True
    assert ibkr.requests == [
        (
            "GET",
            "/pa/transactions",
            {"accountId": "DU123", "conid": "265598", "days": 365},
        ),
    ]


@pytest.mark.asyncio
async def test_fetch_transactions_empty_365_window_flags_fallback_and_still_needs_basis():
    ibkr = _FakeIBKR(
        [
            {"transactions": []},
        ]
    )

    result = await fetch_transactions(ibkr, "DU123", 265598)

    assert result.rows == []
    assert result.days_used == 365
    assert result.rejected_long_history is True
    assert result.fallback_days == 90
    assert result.still_needs_basis is True
    assert ibkr.requests == [
        (
            "GET",
            "/pa/transactions",
            {"accountId": "DU123", "conid": "265598", "days": 365},
        ),
    ]


@pytest.mark.asyncio
async def test_fetch_transactions_rate_limit_propagates_to_scheduler():
    ibkr = _FakeIBKR(
        [
            IBKRRateLimitError("/pa/transactions", retry_after=900),
        ]
    )

    with pytest.raises(IBKRRateLimitError):
        await fetch_transactions(ibkr, "DU123", 265598)

    assert ibkr.requests == [
        (
            "GET",
            "/pa/transactions",
            {"accountId": "DU123", "conid": "265598", "days": 365},
        )
    ]
