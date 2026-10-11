import asyncio
import datetime as dt
import json

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
        self.security_definition_calls = []
        self.fresh_security_definition_calls = []
        self.incomplete_security_definitions = set()
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

    async def security_definitions(self, conids):
        self.security_definition_calls.append(conids)
        return [
            row for row in self._security_definitions(conids)
            if row["conid"] not in self.incomplete_security_definitions
        ]

    async def security_definitions_fresh(self, conids):
        self.fresh_security_definition_calls.append(conids)
        return self._security_definitions(conids)

    @staticmethod
    def _security_definitions(conids):
        rows = {
            1: ("BAD", "NASDAQ", "US", "USD", True),
            2: ("AMB", "NASDAQ", "US", "USD", True),
            3: ("AMB", "TSE", "CA", "CAD", False),
            10: ("AAA", "NASDAQ", "US", "USD", True),
            11: ("BBB", "NASDAQ", "US", "USD", True),
            20: ("FOREIGN", "LSE", "GB", "GBP", False),
            21: ("CLASS.A", "NASDAQ", "US", "USD", True),
            90: ("ABSENT", "NYSE", "US", "USD", True),
        }
        return [
            {
                "conid": conid, "ticker": rows[conid][0], "assetClass": "STK",
                "listingExchange": rows[conid][1], "countryCode": rows[conid][2],
                "currency": rows[conid][3], "isUS": rows[conid][4],
            }
            for conid in conids if conid in rows
        ]


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
async def test_validated_public_snapshot_is_cached_before_ibkr_resolution_and_reused_by_revision(monkeypatch, tmp_path):
    FakeHttpClient.csv_text = CSV
    FakeHttpClient.fail = False
    FakeHttpClient.requests = []
    monkeypatch.setattr("services.rs_leaders.httpx.AsyncClient", FakeHttpClient)
    cache_path = tmp_path / "snapshot.json"
    initial_ibkr = FakeIBKR()
    initial = RSLeadersService(initial_ibkr, FakeIdentity(), cache_path=cache_path)

    source = await initial.refresh_source()

    assert source.phase == "verifying"
    assert initial_ibkr.searches == []
    cached = json.loads(cache_path.read_text())
    assert cached["snapshot"] is None
    assert [row["symbol"] for row in cached["records"]]
    assert len(FakeHttpClient.requests) == 2  # metadata plus pinned CSV

    restored = RSLeadersService(FakeIBKR(), FakeIdentity(), cache_path=cache_path)
    assert restored.get_snapshot().status == "verifying"
    before = len(FakeHttpClient.requests)
    repeated = await restored.refresh_source()
    assert repeated.source_revision == source.source_revision
    assert len(FakeHttpClient.requests) == before + 1  # unchanged revision needs metadata only
    result = await restored.resolve_leaders()
    assert [item.symbol for item in result.items] == ["AAA", "AMB", "BBB"]
    prior_metadata = FakeHttpClient.metadata
    try:
        FakeHttpClient.metadata = [{
            "sha": "b" * 40,
            "commit": {"committer": {"date": "2026-08-15T23:30:00Z"}},
        }]
        changed_source = await restored.refresh_source()
        assert changed_source.source_revision == "b" * 40
        assert restored.get_snapshot().status == "verifying"
        corrected = await restored.resolve_leaders()
        assert corrected.source_revision == "b" * 40
    finally:
        FakeHttpClient.metadata = prior_metadata


@pytest.mark.asyncio
async def test_leaders_validate_snapshot_cache_failure_and_published_values(monkeypatch, tmp_path, caplog):
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

    assert [item.symbol for item in result.items] == ["AAA", "AMB", "BBB"]
    assert [item.conid for item in result.items] == [10, 2, 11]
    assert result.eligible_count == 6
    assert result.items[0].published_percentile == 0
    assert result.items[1].published_percentile == 98
    assert result.items[2].published_percentile == 90
    assert result.freshness == "stale"
    assert result.evidence_session is None
    assert [symbol for symbol, _ in ibkr.searches] == ["BAD", "AAA", "AMB", "FOREIGN", "CLASS", "BBB"]
    assert any("BAD" in issue and "FOREIGN" in issue and "CLASS" in issue for issue in result.issues)
    assert "search errors 1, no exact matches 0, ambiguous matches 0" in caplog.text
    assert "contract request errors 0, unconfirmed contract identities 0, rejected contracts 2" in caplog.text
    assert (2, 3) in ibkr.security_definition_calls
    ibkr.incomplete_security_definitions.add(10)
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
    assert ibkr.security_definition_calls[-1] == (10, 20, 21, 90)
    assert ibkr.fresh_security_definition_calls[-1] == (10,)
    assert (tmp_path / "snapshot.json").exists()

    restored = RSLeadersService(
        FakeIBKR(), FakeIdentity(), cache_path=tmp_path / "snapshot.json",
        now=lambda: dt.datetime(2026, 10, 3, tzinfo=dt.UTC),
    )
    assert [item.symbol for item in restored.get_snapshot().items] == ["AAA", "AMB", "BBB"]

    before_retry = len(FakeHttpClient.requests)
    corrected = await service.refresh()
    assert [item.symbol for item in corrected.items] == ["BAD", "AAA", "AMB", "BBB"]
    assert [symbol for symbol, _ in ibkr.fresh_searches] == ["BAD", "FOREIGN", "CLASS"]
    assert "BAD" not in next(issue for issue in corrected.issues if issue.startswith("IBKR could not"))
    assert all(name in next(issue for issue in corrected.issues if issue.startswith("IBKR could not")) for name in ("FOREIGN", "CLASS"))
    assert (1,) in ibkr.fresh_security_definition_calls
    assert len(FakeHttpClient.requests) == before_retry + 1

    FakeHttpClient.fail = True
    failed_check = await restored.refresh()
    assert failed_check.status == "stale"
    assert [item.symbol for item in failed_check.items] == ["AAA", "AMB", "BBB"]
    assert any(issue.startswith("Fred source check failed; retaining the last validated revision") for issue in failed_check.issues)


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
    assert [item.symbol for item in result.items] == ["AAA", "AMB", "BBB"]
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
