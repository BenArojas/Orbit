"""Phase 1 promises at the authenticated API boundary, without real brokers."""

import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace as NS

import httpx
import pytest
from eventkit import Event
from fastapi import FastAPI
from fastapi.testclient import TestClient
from ib_async import Contract, ContractDetails

from exceptions import IBKRError
from fastapi.responses import JSONResponse
from routers.execution_assistant import router as execution_router
from routers.market import router as market_router
from routers.product_data import router as data_router
from routers.watchlist import router as watchlist_router
from routers.ws import router as ws_router
from routers.options import router as options_router
from routers.moonmarket import router as portfolio_router
from services.db import DatabaseService
from services.execution_plan import ExecutionPlanService
from services.tws_broker_adapter import TwsBrokerAdapter
from services.tws_data import TwsDataService
from services.tws_live_policy import TwsLivePolicyService
from services.scanner import ScannerService
from sidecar_security import SidecarSecurityMiddleware


class FakeIB:
    def __init__(self):
        for name in ("connectedEvent", "disconnectedEvent", "orderStatusEvent",
                     "execDetailsEvent", "positionEvent", "commissionReportEvent", "errorEvent", "openOrderEvent"):
            setattr(self, name, Event())
        self.data_type, self.age, self.sent = 1, 0, 0
        self.history_requests = []
        self.head_offset_days = 0
        self.connected = True
        self.ticker = None
        self.requested_data_types = []
        self.fail_first_snapshot = False


    def isConnected(self):
        return self.connected

    def managedAccounts(self):
        return ["DU12345"]

    async def reqMatchingSymbolsAsync(self, symbol):
        return [NS(contract=Contract(conId=1, symbol=symbol, secType="STK"))]

    async def reqContractDetailsAsync(self, contract):
        conid = contract.conId or (3 if contract.right == "P" else 2)
        option = conid in (2, 3)
        return [ContractDetails(
            contract=Contract(
                conId=conid, symbol="NVDA", secType="OPT" if option else "STK",
                exchange="SMART", primaryExchange="NASDAQ", currency="USD",
                multiplier="100" if option else "", strike=150 if option else 0,
                right=("P" if conid == 3 else "C") if option else "", lastTradeDateOrContractMonth="20270115" if option else "",
            ),
            longName="NVIDIA", industry="Technology", category="Semiconductors",
        )]

    async def reqHistoricalDataAsync(self, contract, **kwargs):
        self.history_requests.append(kwargs)
        return [NS(date=date(2026, 11, 10) + timedelta(days=i),
                   open=100, high=102, low=99, close=101, volume=1000) for i in range(3)]

    async def reqHeadTimeStampAsync(self, contract, **kwargs):
        return datetime(2026, 11, 10, tzinfo=timezone.utc) - timedelta(days=self.head_offset_days)


    def reqMarketDataType(self, value):
        self.requested_data_types.append(value)

    async def reqTickersAsync(self, contract):
        if self.fail_first_snapshot:
            # Options never answer a delayed-frozen snapshot; the adapter must
            # fall through to the next market data type.
            self.fail_first_snapshot = False
            raise asyncio.TimeoutError
        return [NS(contract=contract, time=datetime.now(timezone.utc) - timedelta(seconds=self.age),
                   last=101, close=100, open=100, high=102, low=99, bid=100, ask=101,
                   bidSize=3, askSize=4, volume=1000, marketDataType=self.data_type, modelGreeks=None)]

    def cancelMktData(self, contract):
        pass

    def reqMktData(self, contract, snapshot=False):
        self.ticker = NS(
            contract=contract, time=datetime.now(timezone.utc), marketDataType=1,
            last=101, bid=100, ask=101, bidSize=3, askSize=4, high=102, low=99,
            volume=1000, updateEvent=Event(),
        )
        return self.ticker

    def positions(self):
        return [NS(account="DU12345", contract=Contract(
            conId=2, symbol="NVDA", secType="OPT", currency="USD", multiplier="100",
            strike=150, right="C", lastTradeDateOrContractMonth="20270115",
        ), position=1, avgCost=500)]

    def portfolio(self):
        return []

    def reqPnLSingle(self, account, model, conid):
        return NS(dailyPnL=float("nan"))

    def openTrades(self):
        return []

    async def accountSummaryAsync(self, account):
        return [NS(account=account, tag="DayTradesRemaining", value="3", currency="")]

    async def reqSecDefOptParamsAsync(self, *args):
        return [NS(exchange="SMART", tradingClass="NVDA", multiplier="100", expirations={"20270115"}, strikes={150})]

    def placeOrder(self, contract, order):
        self.sent += 1
        order.orderId = 10
        return NS(order=order, advancedError="", orderStatus=NS(status="Submitted"))


class ImportSource:
    stopped = False
    incomplete = False

    async def get_watchlists(self):
        assert not self.stopped, "Client Portal must not be used after import"
        return [{"id": "42", "name": "Ideas"}, {"id": "43", "name": "Alerts"}]

    async def get_watchlist_items(self, watchlist_id):
        assert not self.stopped
        return [{"H": "Semiconductors"}, {"conid": 1, "symbol": "NVDA"}] if watchlist_id == "42" else []

    async def get_watchlist_raw(self, watchlist_id):
        if self.incomplete and watchlist_id == "43":
            return {}
        return {"data": {"instruments": await self.get_watchlist_items(watchlist_id)}}


def application(db, adapter, source):
    app = FastAPI()
    app.state.db, app.state.tws_adapter, app.state.ibkr = db, adapter, source
    app.state.product_data = TwsDataService(adapter, db)
    app.state.execution_plan_service = ExecutionPlanService()
    app.state.tws_live_policy = TwsLivePolicyService()
    for router in (market_router, data_router, watchlist_router, execution_router, ws_router, options_router, portfolio_router):
        app.include_router(router)
    app.add_middleware(SidecarSecurityMiddleware, secret="a" * 64)

    @app.exception_handler(IBKRError)
    async def failure(request, exc):
        return JSONResponse({"error": str(exc)}, status_code=502)

    @app.post("/test-stream/{action}")
    async def stream_event(action: str):
        if action == "tick":
            adapter._ib.ticker.updateEvent.emit()
        else:
            adapter._ib.connected = action == "connect"
            event = adapter._ib.connectedEvent if action == "connect" else adapter._ib.disconnectedEvent
            event.emit()
        return {}

    return app


async def setup(tmp_path, monkeypatch):
    monkeypatch.setattr("services.tws_broker_adapter.IB", FakeIB)
    adapter = TwsBrokerAdapter()
    adapter._state, adapter._connected_port = "connected", 4002
    db = DatabaseService(str(tmp_path / "orbit.db"))
    await db.initialize()
    adapter.attach_storage(db)
    source = ImportSource()
    return db, adapter, source


async def test_tws_data_import_and_broker_records_survive_restart_without_cp(tmp_path, monkeypatch):
    db, adapter, source = await setup(tmp_path, monkeypatch)
    app = application(db, adapter, source)
    headers = {"X-Orbit-Session": "a" * 64}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test", headers=headers) as client:
        source.incomplete = True
        assert (await client.post("/watchlist/import-client-portal")).status_code == 422
        assert (await client.get("/watchlist/import-status")).json() == {"imported": False, "local_list_count": 0}
        source.incomplete = False
        imported = await client.post("/watchlist/import-client-portal")
        assert imported.json() == {"imported": True, "list_count": 2}
        await db.execute("INSERT INTO settings (key, value) VALUES ('theme', 'light')")
        await db.execute("INSERT INTO trigger_rules (name, conid) VALUES ('alert', 1)")
        await db.execute("UPDATE trigger_rules SET conid=NULL, watchlist_name='Ideas'")
        await db.execute("INSERT INTO trigger_conditions (rule_id, indicator, condition, threshold) VALUES (1, 'close', 'above', 100)")
        await db.execute("INSERT INTO chart_drawings (conid, kind, anchors_json) VALUES (1, 'ray', '[]')")
        quote = (await client.get("/market/quote/1")).json()
        assert quote["lastPrice"] == 101 and quote["entry_data_eligible"] is True
        history = (await client.get("/data/history/1?period=5y&bar=1w")).json()
        # The window reaches IBKR's earliest available data, so the window high
        # is a verified all-time high (D56).
        assert history["coverage"]["ath_status"] == "verified"
        assert history["coverage"]["ath"] == 102
        assert adapter._ib.history_requests[-1]["barSizeSetting"] == "1 week"
        assert adapter._ib.history_requests[-1]["useRTH"] is True
        # A window that starts after the earliest available data can only be partial.
        adapter._ib.head_offset_days = 30
        partial = (await client.get("/data/history/1?period=5y&bar=1w")).json()
        assert partial["coverage"]["ath_status"] == "partial"
        assert partial["coverage"]["ath"] is None and partial["coverage"]["window_high"] == 102
        adapter._ib.head_offset_days = 0

        search = adapter._ib.reqMatchingSymbolsAsync
        async def timed_out(symbol):
            return None
        adapter._ib.reqMatchingSymbolsAsync = timed_out
        # A broker search timeout must surface as a failure, not "not found".
        assert (await client.get("/market/search?q=NVDA")).status_code == 502
        adapter._ib.reqMatchingSymbolsAsync = search
        contract = (await client.get("/data/contracts/1")).json()
        assert contract["sector_etf"] == "SMH"
        position = (await client.get("/data/holdings")).json()["positions"][0]
        assert (position["account"], position["sec_type"], position["multiplier"], position["strike"],
                position["right"], position["expiry"]) == ("DU12345", "OPT", "100", 150, "C", "20270115")
        assert position["market_price"] is None and position["market_data_freshness"] == "unknown"
        option = (await client.get("/moonmarket/options/contract/1?expiration=20270115&strike=150")).json()["data"]["call"]
        assert option["right"] == "C" and option["greeks_status"] == "unavailable"
        assert option["bidSize"] == 3 and option["askSize"] == 4
        account = (await client.get("/data/account")).json()
        # D55: day-trade counting was retired by FINRA (Notice 26-10); Orbit
        # reports the rule status, not an unverifiable count or gate.
        assert account["day_trade_rule"]["status"] == "retired"
        assert account["day_trade_rule"]["legacy_day_trades_remaining"]["value"] == "3"
        assert "intraday_entry_authorized" not in account

        execution = NS(execId="fill-1", acctNumber="DU12345", shares=1, price=5,
                       side="BOT", orderId=10, permId=20, orderRef="external", time=datetime.now(timezone.utc))
        fill = NS(execution=execution, contract=adapter._ib.positions()[0].contract)
        trade = NS(order=NS(orderRef="external"))
        adapter._ib.execDetailsEvent.emit(trade, fill)
        adapter._ib.execDetailsEvent.emit(trade, fill)
        report = NS(execId="fill-1", commission=1.25, currency="USD", realizedPNL=0)
        adapter._ib.commissionReportEvent.emit(trade, fill, report)
        adapter._ib.commissionReportEvent.emit(trade, fill, report)
        records = (await client.get("/data/executions")).json()["items"]
        assert len(records) == 1 and records[0]["commission"]["amount"] == "1.25"
        assert records[0]["ownership"] == "unmatched"
        assert (await client.get("/moonmarket/accounts")).json()["selected_account_id"] == "DU12345"
        assert len((await client.get("/moonmarket/trades")).json()["trades"]) == 1
        missing_valuation = await client.get("/moonmarket/portfolio")
        assert missing_valuation.status_code == 502
        assert "Holdings valuation unavailable" in missing_valuation.json()["error"]
    await adapter.flush_storage()
    # The existing /ws caller receives TWS ticks and resubscribes after reconnect.
    with TestClient(app) as sync_client:
        with sync_client.websocket_connect("/ws", subprotocols=["orbit-session", "a" * 64]) as ws:
            assert ws.receive_json()["type"] == "connection_status"
            assert ws.receive_json()["type"] == "auth_state"
            ws.send_json({"action": "subscribe", "conid": 1})
            assert ws.receive_json()["type"] == "subscription_status"
            sync_client.post("/test-stream/tick", headers=headers)
            assert ws.receive_json()["last"] == 101
            sync_client.post("/test-stream/disconnect", headers=headers)
            assert ws.receive_json()["ws_ready"] is False
            assert ws.receive_json()["authenticated"] is False
            sync_client.post("/test-stream/connect", headers=headers)
            assert ws.receive_json()["ws_ready"] is True
            assert ws.receive_json()["authenticated"] is True
            sync_client.post("/test-stream/tick", headers=headers)
            assert ws.receive_json()["market_data_type"] == "live"
    await db.close()
    source.stopped = True
    db = DatabaseService(str(tmp_path / "orbit.db"))
    await db.initialize()
    adapter.attach_storage(db)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(application(db, adapter, source)),
                                base_url="http://test", headers=headers) as client:
        assert (await client.post("/watchlist/import-client-portal")).json()["imported"] is False
        assert (await client.get("/watchlist/lists")).json() == [{"id": "42", "name": "Ideas"}, {"id": "43", "name": "Alerts"}]
        assert (await client.get("/watchlist/42/instruments")).json()["items"][0]["symbol"] == "NVDA"
        assert (await client.get("/data/executions")).json()["items"] == records
        assert await db.get_setting("theme") == "light"
        assert len(await db.get_trigger_rules()) == 1
        assert len(await db.list_drawings(1)) == 1
        scanner = ScannerService(ibkr=TwsDataService(adapter, db), db=db)
        await scanner._evaluate_due_rules()
        assert len(await db.get_trigger_hits()) == 1
        scanner._rule_state.clear()
        await scanner._evaluate_due_rules()
        assert len(await db.get_trigger_hits()) == 1
    await db.close()


@pytest.mark.parametrize("data_type,age", [(2, 0), (4, 0), (0, 0), (1, 6), (1, -6), (3, 6)])
async def test_unusable_quotes_cannot_authorize_paper_entry(tmp_path, monkeypatch, data_type, age):

    db, adapter, source = await setup(tmp_path, monkeypatch)
    adapter._ib.data_type, adapter._ib.age = data_type, age
    app = application(db, adapter, source)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test",
                                headers={"X-Orbit-Session": "a" * 64}) as client:
        draft = (await client.post("/execution-assistant/plans/draft", json={
            "conid": 1, "symbol": "NVDA", "side": "BUY", "quantity": 1, "order_type": "MKT",
        })).json()
        plan_id = draft["plan_id"]
        assert (await client.post(f"/execution-assistant/plans/{plan_id}/validate")).json()["status"] == "valid"
        denied = await client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
        assert denied.status_code == 409
        assert denied.json()["detail"]["error"] == "entry_market_data_unavailable"
        assert adapter._ib.sent == 0
        override = await client.post("/execution-assistant/orders/override", json={
            "intent": "place", "plan_id": plan_id, "override_codes": ["TEST"],
        })
        # The legacy override route must not bypass quote authorization.
        assert override.status_code == 409
        assert adapter._ib.sent == 0
    await db.close()


async def test_snapshot_falls_back_when_delayed_frozen_has_no_data(tmp_path, monkeypatch):
    # Options never answer a delayed-frozen snapshot; the quote path must fall
    # through to live rather than returning an empty snapshot.
    db, adapter, source = await setup(tmp_path, monkeypatch)
    adapter._ib.fail_first_snapshot = True
    app = application(db, adapter, source)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test",
                                headers={"X-Orbit-Session": "a" * 64}) as client:
        quote = (await client.get("/market/quote/2")).json()
        assert quote["bid"] == 100 and quote["ask"] == 101
        assert quote["market_data_type"] == "live" and quote["entry_data_eligible"] is True
        assert adapter._ib.requested_data_types[:2] == [4, 1]
    await db.close()


async def test_fresh_delayed_quote_authorizes_paper_entry(tmp_path, monkeypatch):

    # D54: delayed streaming data is acceptable for paper entries and carries a
    # visible delayed label; only frozen/stale/unknown data is refused.
    db, adapter, source = await setup(tmp_path, monkeypatch)
    adapter._ib.data_type = 3
    app = application(db, adapter, source)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test",
                                headers={"X-Orbit-Session": "a" * 64}) as client:
        quote = (await client.get("/market/quote/1")).json()
        assert quote["market_data_type"] == "delayed"
        assert quote["entry_data_eligible"] is True

        draft = (await client.post("/execution-assistant/plans/draft", json={
            "conid": 1, "symbol": "NVDA", "side": "BUY", "quantity": 1, "order_type": "MKT",
        })).json()
        plan_id = draft["plan_id"]
        assert (await client.post(f"/execution-assistant/plans/{plan_id}/validate")).json()["status"] == "valid"
        placed = await client.post(f"/execution-assistant/plans/{plan_id}/place-paper")
        assert placed.status_code == 200
        assert adapter._ib.sent == 1
    await db.close()

