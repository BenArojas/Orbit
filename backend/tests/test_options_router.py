from fastapi import FastAPI
from fastapi.testclient import TestClient

from deps import require_ibkr_auth
from routers.options import router as options_router


class _FakeIbkr:
    def __init__(self) -> None:
        self.requests: list[tuple[str, str, dict]] = []

    async def search(self, symbol: str, sec_type: str = ""):
        self.requests.append(("SEARCH", symbol, {"sec_type": sec_type}))
        return [
            {
                "conid": 265598,
                "symbol": symbol,
                "sections": [
                    {"secType": "STK", "exchange": "SMART"},
                    {"secType": "OPT", "months": "JUN24;JUL24", "exchange": "SMART"},
                ],
            }
        ]

    async def _request(self, method: str, endpoint: str, **kwargs):
        self.requests.append((method, endpoint, dict(kwargs)))
        params = kwargs.get("params") or {}
        if endpoint == "/iserver/secdef/strikes":
            assert params == {"conid": 265598, "secType": "OPT", "month": "JUN24"}
            return {"call": [175.0, 180.0], "put": [180.0, 185.0]}
        if endpoint == "/iserver/secdef/info":
            right = params["right"]
            return [
                {
                    "conid": 7001 if right == "C" else 7002,
                    "strike": params["strike"],
                    "right": right,
                    "symbol": "AAPL",
                }
            ]
        raise AssertionError(f"Unexpected request: {method} {endpoint}")

    async def option_expirations(self, symbol: str, underlying_conid: int) -> list[str]:
        rows = await self.search(symbol=symbol, sec_type="STK")
        for row in rows:
            if int(row["conid"]) != underlying_conid:
                continue
            for section in row.get("sections") or []:
                if section.get("secType") == "OPT":
                    return [month for month in section.get("months", "").split(";") if month]
        return []

    async def option_strikes(self, underlying_conid: int, month: str) -> dict[str, list[float]]:
        return await self._request(
            "GET",
            "/iserver/secdef/strikes",
            params={"conid": underlying_conid, "secType": "OPT", "month": month},
        )

    async def option_contract_info(
        self,
        underlying_conid: int,
        month: str,
        strike: float,
        right: str,
    ) -> list[dict]:
        return await self._request(
            "GET",
            "/iserver/secdef/info",
            params={
                "conid": underlying_conid,
                "secType": "OPT",
                "month": month,
                "strike": strike,
                "right": right,
            },
        )

    async def snapshot(self, conids: list[int], fields: str) -> list[dict]:
        self.requests.append(("SNAPSHOT", ",".join(str(conid) for conid in conids), {"fields": fields}))
        return [
            {
                "conid": 7001,
                "31": "4.20",
                "84": "4.10",
                "86": "4.30",
                "85": "12",
                "88": "15",
                "7762": "150",
                "7308": "0.62",
            },
            {
                "conid": 7002,
                "31": "3.90",
                "84": "3.80",
                "86": "4.00",
                "85": "10",
                "88": "14",
                "7762": "110",
                "7308": "-0.38",
            },
        ]


def _client(fake: _FakeIbkr) -> TestClient:
    app = FastAPI()
    app.include_router(options_router)
    app.dependency_overrides[require_ibkr_auth] = lambda: fake
    return TestClient(app)


def test_expirations_use_symbol_hint_but_underlying_conid_route_key():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/options/expirations/265598?symbol=AAPL")

    assert resp.status_code == 200
    assert resp.json() == {
        "underlying_conid": 265598,
        "symbol": "AAPL",
        "expirations": ["JUN24", "JUL24"],
    }


def test_chain_returns_sorted_union_of_call_and_put_strikes():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/options/chain/265598?expiration=JUN24")

    assert resp.status_code == 200
    assert resp.json() == {
        "underlying_conid": 265598,
        "expiration": "JUN24",
        "all_strikes": [175.0, 180.0, 185.0],
        "chain": {},
    }


def test_contract_loads_call_put_contracts_and_snapshots_quotes():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/options/contract/265598?expiration=JUN24&strike=180")

    assert resp.status_code == 200
    body = resp.json()
    assert body["strike"] == 180.0
    assert body["data"]["call"]["contractId"] == 7001
    assert body["data"]["call"]["bid"] == 4.10
    assert body["data"]["call"]["ask"] == 4.30
    assert body["data"]["call"]["delta"] == 0.62
    assert body["data"]["put"]["contractId"] == 7002
    assert body["data"]["put"]["delta"] == -0.38


def test_window_loads_multiple_strike_pairs_in_one_request():
    fake = _FakeIbkr()
    resp = _client(fake).get(
        "/moonmarket/options/window/265598?expiration=JUN24&strikes=180&strikes=185"
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["underlying_conid"] == 265598
    assert body["expiration"] == "JUN24"
    assert sorted(body["strikes"].keys()) == ["180.00", "185.00"]
    assert body["strikes"]["180.00"]["call"]["contractId"] == 7001
    assert body["strikes"]["180.00"]["put"]["contractId"] == 7002
    assert body["strikes"]["185.00"]["call"]["contractId"] == 7001
    # Pacing path exercised: one snapshot burst per strike, not one giant burst.
    snapshot_calls = [req for req in fake.requests if req[0] == "SNAPSHOT"]
    assert len(snapshot_calls) == 2


def test_window_requires_at_least_one_strike():
    fake = _FakeIbkr()
    resp = _client(fake).get("/moonmarket/options/window/265598?expiration=JUN24")

    assert resp.status_code == 422
