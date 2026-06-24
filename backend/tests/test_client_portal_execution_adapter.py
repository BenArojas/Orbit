import pytest

from services.client_portal_execution import ClientPortalExecutionAdapter
from services.moonmarket import MoonMarketService
from services.orders import OrderService
from models import MoonMarketOrderDraft


class _FakeIbkr:
    def __init__(self) -> None:
        self.requests: list[tuple[str, str, dict]] = []

    async def _request(self, method: str, endpoint: str, **kwargs):
        self.requests.append((method, endpoint, dict(kwargs)))
        return {"method": method, "endpoint": endpoint}

    async def brokerage_accounts(self) -> list[dict]:
        return [{"id": "DU123", "accountId": "DU123", "selected": True, "isPaper": True}]


class _RecordingExecution:
    def __init__(self) -> None:
        self.placed: list[tuple[str, list[dict[str, object]]]] = []

    async def preview_order(self, account_id: str, order_payload: dict[str, object]):
        return {"previewed": order_payload}

    async def place_orders(self, account_id: str, order_payloads: list[dict[str, object]]):
        self.placed.append((account_id, order_payloads))
        return {"placed": True}

    async def reply_order(self, reply_id: str, confirmed: bool):
        return {"reply_id": reply_id, "confirmed": confirmed}

    async def cancel_order(self, account_id: str, order_id: str):
        return {"order_id": order_id, "status": "cancelled"}

    async def modify_order(self, account_id: str, order_id: str, order_payload: dict[str, object]):
        return {"order_id": order_id, "payload": order_payload}


class _RecordingMoonMarketExecution:
    def __init__(self) -> None:
        self.live_orders_calls = 0
        self.order_rules_calls: list[tuple[int, bool]] = []
        self.account_summary_calls: list[str] = []
        self.revalidate_positions_calls: list[str] = []
        self.trades_calls: list[int] = []
        self.position_page_calls: list[tuple[str, int]] = []
        self.ledger_calls: list[str] = []
        self.all_periods_calls: list[str] = []

    async def live_orders(self):
        self.live_orders_calls += 1
        return {
            "orders": [
                {
                    "orderId": "order-1",
                    "conid": 265598,
                    "ticker": "AAPL",
                    "side": "BUY",
                    "orderType": "LMT",
                    "totalSize": 5,
                    "price": 180.0,
                }
            ]
        }

    async def order_rules(self, *, conid: int, is_buy: bool):
        self.order_rules_calls.append((conid, is_buy))
        return {"orderTypes": ["limit"], "tifTypes": ["DAY/o"]}

    async def account_summary(self, account_id: str):
        self.account_summary_calls.append(account_id)
        return {
            "buyingpower": {"amount": 40000.0, "currency": "USD"},
            "availablefunds": {"amount": 10000.0, "currency": "USD"},
            "totalcashvalue": {"amount": 10000.0, "currency": "USD"},
        }

    async def revalidate_positions(self, account_id: str):
        self.revalidate_positions_calls.append(account_id)
        return [
            {
                "acctId": account_id,
                "conid": 265598,
                "contractDesc": "AAPL",
                "position": 10,
                "mktPrice": 252.08,
                "mktValue": 2520.8,
            }
        ]

    async def trades(self, days: int):
        self.trades_calls.append(days)
        return [
            {
                "execution_id": "E-BUY-1",
                "accountId": "DU123",
                "conid": 265598,
                "symbol": "AAPL",
                "order_description": "BOT 5 AAPL",
                "side": "B",
                "trade_time_r": 1780500120000,
                "size": 5,
                "price": 185.12,
                "commission": 1.0,
                "net_amount": -925.6,
                "sec_type": "STK",
            }
        ]

    async def position_page(self, account_id: str, page: int):
        self.position_page_calls.append((account_id, page))
        if page == 0:
            return [
                {
                    "conid": 265598,
                    "ticker": "AAPL",
                    "name": "Apple Inc",
                    "assetClass": "STK",
                    "position": 5,
                    "mktPrice": 200.0,
                    "avgCost": 175.0,
                    "mktValue": 1000.0,
                    "unrealizedPnl": 125.0,
                    "dailyPnl": 10.0,
                    "currency": "USD",
                }
            ]
        return []

    async def ledger(self, account_id: str):
        self.ledger_calls.append(account_id)
        return {
            "BASE": {
                "currency": "USD",
                "secondkey": "BASE",
                "cashbalance": 100.0,
                "netliquidationvalue": 1100.0,
            }
        }

    async def all_periods(self, account_id: str):
        self.all_periods_calls.append(account_id)
        return {
            "currencyType": "base",
            "included": [account_id],
            account_id: {
                "1Y": {
                    "nav": [100000.0, 101250.0],
                    "cps": [0.0, 0.0125],
                    "dates": ["2026-01-01", "2026-01-02"],
                },
                "periods": ["1Y"],
                "baseCurrency": "USD",
            },
        }


@pytest.mark.asyncio
async def test_order_execution_methods_send_client_portal_order_requests():
    ibkr = _FakeIbkr()
    adapter = ClientPortalExecutionAdapter(ibkr)
    order_payload = {
        "conid": 265598,
        "orderType": "LMT",
        "side": "BUY",
        "tif": "DAY",
        "quantity": 5.0,
        "price": 180.0,
    }

    await adapter.preview_order("DU123", order_payload)
    await adapter.place_orders("DU123", [order_payload])
    await adapter.reply_order("reply-1", confirmed=True)
    await adapter.cancel_order("DU123", "order-1")
    await adapter.modify_order("DU123", "order-1", order_payload)

    assert ibkr.requests == [
        (
            "POST",
            "/iserver/account/DU123/orders/whatif",
            {"json": {"orders": [order_payload]}},
        ),
        (
            "POST",
            "/iserver/account/DU123/orders",
            {"json": {"orders": [order_payload]}},
        ),
        ("POST", "/iserver/reply/reply-1", {"json": {"confirmed": True}}),
        ("DELETE", "/iserver/account/DU123/order/order-1", {}),
        (
            "POST",
            "/iserver/account/DU123/order/order-1",
            {"json": order_payload},
        ),
    ]


@pytest.mark.asyncio
async def test_account_execution_methods_send_live_order_and_rule_requests():
    ibkr = _FakeIbkr()
    adapter = ClientPortalExecutionAdapter(ibkr)

    await adapter.live_orders()
    await adapter.order_rules(conid=265598, is_buy=False)

    assert ibkr.requests == [
        ("GET", "/iserver/account/orders", {"params": {"force": "true"}}),
        ("GET", "/iserver/account/orders", {}),
        (
            "POST",
            "/iserver/contract/rules",
            {"json": {"conid": 265598, "exchange": "SMART", "isBuy": False}},
        ),
    ]


@pytest.mark.asyncio
async def test_account_execution_methods_send_funds_and_position_refresh_requests():
    ibkr = _FakeIbkr()
    adapter = ClientPortalExecutionAdapter(ibkr)

    await adapter.account_summary("DU123")
    await adapter.revalidate_positions("DU123")

    assert ibkr.requests == [
        ("GET", "/portfolio/DU123/summary", {}),
        ("POST", "/portfolio/DU123/positions/invalidate", {"json": {}}),
    ]


@pytest.mark.asyncio
async def test_account_execution_methods_send_trade_portfolio_and_performance_requests():
    ibkr = _FakeIbkr()
    adapter = ClientPortalExecutionAdapter(ibkr)

    await adapter.trades(days=7)
    await adapter.position_page("DU123", 0)
    await adapter.ledger("DU123")
    await adapter.all_periods("DU123")

    assert ibkr.requests == [
        ("GET", "/iserver/account/trades", {"params": {"days": 7}}),
        ("GET", "/portfolio/DU123/positions/0", {}),
        ("GET", "/portfolio/DU123/ledger", {}),
        ("POST", "/pa/allperiods", {"json": {"acctIds": ["DU123"]}}),
    ]


@pytest.mark.asyncio
async def test_order_service_places_normalized_payloads_through_execution_adapter():
    ibkr = _FakeIbkr()
    execution = _RecordingExecution()
    service = OrderService(ibkr, execution=execution)
    order = MoonMarketOrderDraft(
        conid=265598,
        orderType="STP_LIMIT",
        side="SELL",
        tif="DAY",
        quantity=5,
        price=174.0,
        auxPrice=175.0,
    )

    result = await service.place("DU123", [order])

    assert result == {"placed": True}
    assert execution.placed == [
        (
            "DU123",
            [
                {
                    "conid": 265598,
                    "orderType": "STP LMT",
                    "side": "SELL",
                    "tif": "DAY",
                    "quantity": 5.0,
                    "price": 174.0,
                    "auxPrice": 175.0,
                }
            ],
        )
    ]
    assert ibkr.requests == []


@pytest.mark.asyncio
async def test_moonmarket_service_reads_live_orders_and_rules_through_execution_adapter():
    ibkr = _FakeIbkr()
    execution = _RecordingMoonMarketExecution()
    service = MoonMarketService(ibkr, execution=execution)

    live_orders = await service.live_orders("DU123")
    rules = await service.order_rules(account_id="DU123", conid=265598, side="SELL")

    assert live_orders.account_id == "DU123"
    assert [order.order_id for order in live_orders.orders] == ["order-1"]
    assert rules.account_id == "DU123"
    assert rules.side == "SELL"
    assert rules.rules == {"orderTypes": ["limit"], "tifTypes": ["DAY/o"]}
    assert execution.live_orders_calls == 1
    assert execution.order_rules_calls == [(265598, False)]
    assert ibkr.requests == []


@pytest.mark.asyncio
async def test_moonmarket_service_reads_funds_and_revalidates_positions_through_execution_adapter():
    ibkr = _FakeIbkr()
    execution = _RecordingMoonMarketExecution()
    service = MoonMarketService(ibkr, execution=execution)

    funds = await service.account_funds("DU123")
    positions = await service.revalidate_positions("DU123")

    assert funds.account_id == "DU123"
    assert funds.buying_power == 40000.0
    assert funds.available_funds == 10000.0
    assert funds.cash == 10000.0
    assert funds.currency == "USD"
    assert positions.account_id == "DU123"
    assert positions.positions == [
        {
            "acctId": "DU123",
            "conid": 265598,
            "contractDesc": "AAPL",
            "position": 10,
            "mktPrice": 252.08,
            "mktValue": 2520.8,
        }
    ]
    assert execution.account_summary_calls == ["DU123"]
    assert execution.revalidate_positions_calls == ["DU123"]
    assert ibkr.requests == []


@pytest.mark.asyncio
async def test_moonmarket_service_reads_trades_portfolio_and_performance_through_execution_adapter():
    ibkr = _FakeIbkr()
    execution = _RecordingMoonMarketExecution()
    service = MoonMarketService(ibkr, execution=execution)

    trades = await service.trades("DU123", days=7)
    portfolio = await service.portfolio("DU123")
    performance = await service.performance("DU123", period="1Y")

    assert trades.account_id == "DU123"
    assert trades.summary.total_trades == 1
    assert [trade.execution_id for trade in trades.trades] == ["E-BUY-1"]
    assert portfolio.account_id == "DU123"
    assert [position.symbol for position in portfolio.positions] == ["AAPL", "CASH"]
    assert portfolio.total_market_value == 1100.0
    assert performance.account_id == "DU123"
    assert performance.period == "1Y"
    assert performance.nav.values == [100000.0, 101250.0]
    assert performance.cumulative_return.values == [0.0, 0.0125]
    assert performance.period_return.values == [0.0, 0.0125]
    assert execution.trades_calls == [7]
    assert execution.position_page_calls == [("DU123", 0), ("DU123", 1)]
    assert execution.ledger_calls == ["DU123"]
    assert execution.all_periods_calls == ["DU123"]
    assert ibkr.requests == []


@pytest.mark.asyncio
async def test_adapter_portfolio_positions_uses_portfolio2_endpoint():
    ibkr = _FakeIbkr()
    adapter = ClientPortalExecutionAdapter(ibkr)

    await adapter.portfolio_positions("DU123")

    assert ibkr.requests == [("GET", "/portfolio2/DU123/positions", {})]


@pytest.mark.asyncio
async def test_inflect_current_position_reads_through_execution_adapter():
    from services.db import DatabaseService
    from services.inflect.service import InflectService

    class _RecordingInflectExecution:
        def __init__(self) -> None:
            self.portfolio_positions_calls: list[str] = []

        async def portfolio_positions(self, account_id: str):
            self.portfolio_positions_calls.append(account_id)
            return [{"conid": 1, "position": 5}]

    db = DatabaseService(db_path=":memory:")
    db._conn = db._connect()
    db._create_tables()
    db._migrate()
    ibkr = _FakeIbkr()
    execution = _RecordingInflectExecution()
    service = InflectService(ibkr=ibkr, db=db, moonmarket=None, execution=execution)

    position = await service.current_position("DU123", 1)

    assert position == 5.0
    assert execution.portfolio_positions_calls == ["DU123"]
    assert ibkr.requests == []
