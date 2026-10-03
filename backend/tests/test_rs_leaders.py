import asyncio
import datetime as dt

import pytest
from fastapi import HTTPException

from exceptions import IBKRError
from models.rs import RSRatingRequest
from routers.rs import get_ratings
from services.rs_leaders import RSLeadersService


class FakeResponse:
    def __init__(self, *, metadata=None, text=""):
        self._metadata = metadata
        self.text = text

    def raise_for_status(self):
        return None

    def json(self):
        return self._metadata


class FakeHttpClient:
    metadata = [{
        "sha": "a" * 40,
        "commit": {"committer": {"date": "2026-08-14T23:30:00Z"}},
    }]
    csv_text = ""
    fail = False
    requests = []

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, url, **_kwargs):
        self.requests.append(url)
        if self.fail:
            raise OSError("source unavailable")
        return FakeResponse(metadata=self.metadata) if "api.github.com" in url else FakeResponse(text=self.csv_text)


class FakeIdentity:
    def __init__(self):
        self.cached = []

    async def cache_resolved_identity(self, **kwargs):
        self.cached.append(kwargs)


class FakeIBKR:
    def __init__(self):
        self.searches = []
        self.fresh_searches = []
        self.bad_attempts = 0

    async def search(self, symbol, sec_type="STK"):
        self.searches.append((symbol, sec_type))
        if symbol == "BAD":
            self.bad_attempts += 1
            if self.bad_attempts == 1:
                raise IBKRError("lookup temporarily unavailable")
            return [{"conid": 1, "symbol": "BAD", "secType": "STK"}]
        if symbol == "AMB":
            return [
                {"conid": 2, "symbol": "AMB", "secType": "STK"},
                {"conid": 3, "symbol": "AMB", "secType": "STK"},
            ]
        conids = {"AAA": 10, "BBB": 11, "FOREIGN": 20, "CLASS": 21}
        return [{"conid": conids[symbol], "symbol": symbol, "secType": "STK", "companyName": symbol}]

    async def search_fresh(self, symbol, sec_type="STK"):
        self.fresh_searches.append((symbol, sec_type))
        return await self.search(symbol, sec_type)

    async def contract_info(self, conid):
        symbol = {1: "BAD", 10: "AAA", 11: "BBB", 20: "FOREIGN", 21: "CLASS.A", 90: "ABSENT"}[conid]
        return {
            "conid": conid, "symbol": symbol, "instrument_type": "STK",
            "listing_exchange": "LSE" if conid == 20 else "NASDAQ",
            "currency": "USD",
        }

    async def contract_info_fresh(self, conid):
        return await self.contract_info(conid)


CSV = """Rank,Ticker,Sector,Relative Strength,Percentile,Price,AvgVol50
1,BAD,Tech,150,99,10,500000
2,AAA,Tech,100,0,10,500000
3,AMB,Health,99,98,25,1000000
4,FOREIGN,Finance,95,90,22,600000
5,CLASS,Finance,94,90,22,600000
6,BBB,Finance,90,90,22,600000
7,CHEAP,Tech,200,99,9.99,1000000
8,THIN,Tech,190,99,15,499999
9,NO_RS,Tech,,99,15,1000000
"""


@pytest.mark.asyncio
async def test_leaders_validate_snapshot_cache_failure_and_published_values(monkeypatch, tmp_path):
    FakeHttpClient.csv_text = CSV
    FakeHttpClient.fail = False
    FakeHttpClient.requests = []
    monkeypatch.setattr("services.rs_leaders.httpx.AsyncClient", FakeHttpClient)
    ibkr = FakeIBKR()
    service = RSLeadersService(
        ibkr, FakeIdentity(), cache_path=tmp_path / "snapshot.json",
        now=lambda: dt.datetime(2026, 10, 3, tzinfo=dt.UTC),
    )

    result = await service.refresh()

    assert [item.symbol for item in result.items] == ["AAA", "BBB"]
    assert [item.conid for item in result.items] == [10, 11]
    assert result.eligible_count == 6
    assert result.items[0].published_percentile == 0
    assert result.items[1].published_percentile == 90
    assert result.freshness == "stale"
    assert result.evidence_session is None
    assert [symbol for symbol, _ in ibkr.searches] == ["BAD", "AAA", "AMB", "FOREIGN", "CLASS", "BBB"]
    assert any("BAD" in issue and "FOREIGN" in issue and "CLASS" in issue for issue in result.issues)
    ratings = await service.ratings([
        {"conid": 10, "symbol": "AAA", "sec_type": "STK"},
        {"conid": 20, "symbol": "FOREIGN", "sec_type": "STK"},
        {"conid": 21, "symbol": "CLASS", "sec_type": "STK"},
        {"conid": 90, "symbol": "ABSENT", "sec_type": "STK"},
        {"conid": 13, "symbol": "AAA", "sec_type": "OPT"},
    ], [10, 20, 21, 90, 13])
    assert ratings.status == "stale"
    assert ratings.items[0].published_percentile == 0
    assert ratings.items[0].status == "rated"
    assert ratings.items[1].status == "unverified"
    assert ratings.items[2].status == "unverified"
    assert ratings.items[3].status == "not_published"
    assert ratings.items[4].status == "unverified"
    assert (tmp_path / "snapshot.json").exists()

    restored = RSLeadersService(
        FakeIBKR(), FakeIdentity(), cache_path=tmp_path / "snapshot.json",
        now=lambda: dt.datetime(2026, 10, 3, tzinfo=dt.UTC),
    )
    assert [item.symbol for item in restored.get_snapshot().items] == ["AAA", "BBB"]

    before_retry = len(FakeHttpClient.requests)
    corrected = await service.refresh()
    assert [item.symbol for item in corrected.items] == ["BAD", "AAA", "BBB"]
    assert [symbol for symbol, _ in ibkr.fresh_searches] == ["BAD", "AMB", "FOREIGN", "CLASS"]
    assert "BAD" not in next(issue for issue in corrected.issues if issue.startswith("IBKR could not"))
    assert all(name in next(issue for issue in corrected.issues if issue.startswith("IBKR could not")) for name in ("AMB", "FOREIGN", "CLASS"))
    assert len(FakeHttpClient.requests) == before_retry + 1

    FakeHttpClient.fail = True
    failed_check = await restored.refresh()
    assert failed_check.status == "stale"
    assert [item.symbol for item in failed_check.items] == ["AAA", "BBB"]
    assert any("last valid snapshot" in issue for issue in failed_check.issues)


@pytest.mark.asyncio
async def test_cancelling_one_refresh_caller_keeps_shared_work_for_other(monkeypatch, tmp_path):
    started = asyncio.Event()
    release = asyncio.Event()
    cancelled = asyncio.Event()

    class BlockingClient(FakeHttpClient):
        async def get(self, url, **kwargs):
            try:
                started.set()
                await release.wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise
            return await super().get(url, **kwargs)

    BlockingClient.csv_text = CSV
    BlockingClient.fail = False
    monkeypatch.setattr("services.rs_leaders.httpx.AsyncClient", BlockingClient)
    service = RSLeadersService(FakeIBKR(), FakeIdentity(), cache_path=tmp_path / "snapshot.json")

    abandoned = asyncio.create_task(service.refresh())
    await started.wait()
    retained = asyncio.create_task(service.refresh())
    await asyncio.sleep(0)
    abandoned.cancel()
    with pytest.raises(asyncio.CancelledError):
        await abandoned
    assert not cancelled.is_set()

    release.set()
    result = await retained
    assert [item.symbol for item in result.items] == ["AAA", "BBB"]
    assert not cancelled.is_set()


@pytest.mark.asyncio
async def test_ratings_disconnect_cancels_identity_lookup():
    cancelled = asyncio.Event()

    class Identity:
        async def get_many(self, _conids):
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                cancelled.set()
                raise

    class DisconnectedRequest:
        async def is_disconnected(self):
            return True

    with pytest.raises(HTTPException) as error:
        await get_ratings(RSRatingRequest(conids=[10]), DisconnectedRequest(), service=None, identity=Identity())

    assert error.value.status_code == 499
    assert cancelled.is_set()
