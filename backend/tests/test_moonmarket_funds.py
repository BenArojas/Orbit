import pytest

from services.moonmarket import MoonMarketService


class _FakeIbkr:
    def __init__(self, summary: dict) -> None:
        self._summary = summary
        self.calls: list[str] = []

    async def ensure_accounts(self) -> None:
        return None

    async def brokerage_accounts(self) -> list[dict]:
        return [{"id": "DU123", "accountId": "DU123", "isPaper": True, "selected": True}]

    async def _request(self, method: str, endpoint: str, **kwargs):
        self.calls.append(endpoint)
        return self._summary


@pytest.mark.asyncio
async def test_account_funds_parses_buying_power_from_summary():
    summary = {
        "buyingpower": {"amount": 40000.0, "currency": "USD"},
        "availablefunds": {"amount": 10000.0, "currency": "USD"},
        "totalcashvalue": {"amount": 10000.0, "currency": "USD"},
    }
    service = MoonMarketService(_FakeIbkr(summary))

    funds = await service.account_funds("DU123")

    assert funds.account_id == "DU123"
    assert funds.buying_power == 40000.0
    assert funds.available_funds == 10000.0
    assert funds.cash == 10000.0
    assert funds.currency == "USD"


@pytest.mark.asyncio
async def test_account_funds_handles_flat_numeric_values():
    summary = {"buyingpower": 25000.0, "availablefunds": 5000.0, "totalcashvalue": 5000.0}
    service = MoonMarketService(_FakeIbkr(summary))

    funds = await service.account_funds("DU123")

    assert funds.buying_power == 25000.0
    assert funds.available_funds == 5000.0
