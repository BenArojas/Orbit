"""Fred's published RS snapshot, validated and resolved for Parallax."""

from __future__ import annotations

import asyncio
import csv
import datetime as dt
import io
import json
import logging
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from exceptions import IBKRAuthError, IBKRError
from models.rs import RSItem, RSLeadersResponse, RSLeadersSourceResponse, RSRatingItem, RSRatingsResponse
from services.ibkr import IBKRService
from services.instrument_identity import InstrumentIdentityService

log = logging.getLogger("parallax.services.rs_leaders")

SOURCE = "Fred6725"
OUTPUT_PATH = "output/rs_stocks.csv"
COMMIT_URL = "https://api.github.com/repos/Fred6725/rs-log/commits"
RAW_URL = "https://raw.githubusercontent.com/Fred6725/rs-log/{revision}/output/rs_stocks.csv"
REQUIRED_COLUMNS = {
    "Rank", "Ticker", "Sector", "Relative Strength", "Percentile", "Price", "AvgVol50",
}
SCHEMA_VERSION = 2
STALE_AFTER = dt.timedelta(days=4)
SOURCE_TIMEOUT_SECONDS = 10.0
MAX_LEADERS = 30
MAX_RESOLUTION_ATTEMPTS = 120
RESOLUTION_ISSUE_PREFIX = "IBKR could not uniquely verify US listings for: "
US_LISTING_EXCHANGES = {
    "AMEX", "ARCA", "BATS", "CBOE", "IEX", "NASDAQ", "NYSE",
    "NYSE AMERICAN", "NYSE ARCA", "NYSE CHICAGO", "NYSE NATIONAL",
}


@dataclass
class _RefreshFlight:
    task: asyncio.Task[Any]
    callers: int = 0


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _parse_time(value: Any) -> dt.datetime:
    if not isinstance(value, str):
        raise ValueError("Fred source commit has no publication timestamp")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Fred source commit timestamp is missing its timezone")
    return parsed.astimezone(dt.UTC)


def _number(row: dict[str, str | None], column: str) -> float | None:
    raw = (row.get(column) or "").strip()
    if not raw:
        return None
    try:
        result = float(raw)
    except ValueError as exc:
        raise ValueError(f"Fred CSV has an invalid {column} value") from exc
    if not math.isfinite(result):
        raise ValueError(f"Fred CSV has a non-finite {column} value")
    return result


def _parse_csv(payload: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(payload))
    if not reader.fieldnames or REQUIRED_COLUMNS - set(reader.fieldnames):
        missing = sorted(REQUIRED_COLUMNS - set(reader.fieldnames or []))
        raise ValueError(f"Fred CSV is missing required columns: {', '.join(missing)}")

    records: list[dict[str, Any]] = []
    symbols: set[str] = set()
    for line, row in enumerate(reader, start=2):
        if None in row:
            raise ValueError(f"Fred CSV row {line} has extra fields")
        ticker = (row.get("Ticker") or "").strip().upper()
        try:
            source_rank = int((row.get("Rank") or "").strip())
        except ValueError as exc:
            raise ValueError(f"Fred CSV row {line} has an invalid Rank") from exc
        if not ticker or source_rank <= 0:
            raise ValueError(f"Fred CSV row {line} has no valid ticker or rank")
        if ticker in symbols:
            raise ValueError(f"Fred CSV has duplicate ticker {ticker}")
        symbols.add(ticker)

        percentile_value = _number(row, "Percentile")
        percentile = None
        if percentile_value is not None:
            if not percentile_value.is_integer() or not 0 <= percentile_value <= 99:
                raise ValueError(f"Fred CSV row {line} has an invalid Percentile")
            percentile = int(percentile_value)
        records.append({
            "source_rank": source_rank,
            "symbol": ticker,
            "sector": (row.get("Sector") or "").strip() or None,
            "raw_strength": _number(row, "Relative Strength"),
            "published_percentile": percentile,
            "source_price": _number(row, "Price"),
            "avg_volume_50": _number(row, "AvgVol50"),
        })
    if not records:
        raise ValueError("Fred CSV contains no stock rows")
    return records


def _qualifies(row: dict[str, Any]) -> bool:
    return (
        row["source_price"] is not None
        and row["source_price"] >= 10
        and row["avg_volume_50"] is not None
        and row["avg_volume_50"] >= 500_000
        and row["raw_strength"] is not None
    )


def _security_types(row: dict[str, Any]) -> set[str]:
    types: set[str] = set()
    sec_type = row.get("secType") or row.get("sec_type")
    if isinstance(sec_type, str) and sec_type:
        types.add(sec_type.upper())
    for section in row.get("sections") or []:
        if isinstance(section, dict) and isinstance(section.get("secType"), str):
            types.add(section["secType"].upper())
    return types


def _is_verified_us_stock(contract: Any, conid: int, symbol: str) -> bool | None:
    if not isinstance(contract, dict):
        return None
    try:
        actual_conid = int(contract.get("conid"))
    except (TypeError, ValueError):
        return None
    actual_symbol = str(contract.get("ticker") or "").strip().upper()
    instrument_type = str(contract.get("assetClass") or "").strip().upper()
    exchange = str(contract.get("listingExchange") or "").strip().upper()
    country = str(contract.get("countryCode") or "").strip().upper()
    currency = str(contract.get("currency") or "").strip().upper()
    is_us = contract.get("isUS")
    if not actual_symbol or not instrument_type or not exchange or not country or not currency or not isinstance(is_us, bool):
        return None
    if actual_conid != conid or actual_symbol != symbol.upper() or instrument_type != "STK":
        return False
    return country == "US" and is_us and currency == "USD" and exchange in US_LISTING_EXCHANGES


def _definitions_by_conid(definitions: Any) -> dict[int, dict[str, Any]]:
    result = {}
    for definition in definitions if isinstance(definitions, list) else []:
        if not isinstance(definition, dict):
            continue
        try:
            conid = int(definition.get("conid"))
        except (TypeError, ValueError):
            continue
        result[conid] = definition
    return result


class RSLeadersService:
    """Fetches pinned published output and caches public ranking data only."""

    def __init__(
        self,
        ibkr: IBKRService,
        identity: InstrumentIdentityService,
        *,
        cache_path: Path | None = None,
        now: Any = _utc_now,
    ) -> None:
        self.ibkr = ibkr
        self.identity = identity
        self.cache_path = cache_path or Path.home() / ".parallax" / "rs_snapshot_v2.json"
        self._now = now
        self._snapshot: RSLeadersResponse | None = None
        self._records: list[dict[str, Any]] = []
        self._source_revision: str | None = None
        self._source_published_at: dt.datetime | None = None
        self._source_fetched_at: dt.datetime | None = None
        self._source_issue: str | None = None
        self._loaded = False
        self._flights: dict[str, _RefreshFlight] = {}

    def get_snapshot(self) -> RSLeadersResponse:
        self._load_cache()
        if self._records and (self._snapshot is None or self._snapshot.source_revision != self._source_revision):
            return RSLeadersResponse(
                status="verifying", source_revision=self._source_revision,
                source_published_at=self._source_published_at,
                fetched_at=self._source_fetched_at,
                freshness=self._freshness(self._source_published_at, self._now().astimezone(dt.UTC)) if self._source_published_at else "unknown",
                eligible_count=sum(_qualifies(row) for row in self._records),
                issues=[self._source_issue or "Verifying US listings for the saved published ranking."],
            )
        if self._snapshot is None:
            return RSLeadersResponse(
                status="unavailable", freshness="unknown",
                issues=["No saved Fred RS snapshot is available."],
            )
        return self._with_current_freshness(self._snapshot)

    async def refresh(self) -> RSLeadersResponse:
        await self.refresh_source()
        return await self.resolve_leaders()

    async def refresh_source(self) -> RSLeadersSourceResponse:
        self._load_cache()
        return await self._run_shared("source", self._refresh_source)

    async def resolve_leaders(self) -> RSLeadersResponse:
        self._load_cache()
        return await self._run_shared("resolution", self._resolve_leaders)

    async def _run_shared(self, key: str, operation: Callable[[], Awaitable[Any]]) -> Any:
        flight = self._flights.get(key)
        if flight is None or flight.task.done():
            task = asyncio.create_task(operation())
            flight = _RefreshFlight(task)
            self._flights[key] = flight
            task.add_done_callback(lambda completed, name=key, current=flight: self._finish_refresh(name, current, completed))
        flight.callers += 1
        try:
            return await asyncio.shield(flight.task)
        finally:
            flight.callers -= 1
            if flight.callers == 0 and self._flights.get(key) is flight:
                self._flights.pop(key, None)
                if not flight.task.done():
                    flight.task.cancel()

    async def ratings(self, identities: list[dict[str, Any]], conids: list[int]) -> RSRatingsResponse:
        self._load_cache()
        by_symbol = {row["symbol"]: row for row in self._records}
        identity_by_conid = {int(row["conid"]): row for row in identities}
        snapshot = self.get_snapshot()
        source_available = bool(self._records) and self._source_revision is not None
        source_freshness = self._freshness(self._source_published_at, self._now().astimezone(dt.UTC)) if self._source_published_at else "unknown"
        source_status = "unavailable" if not source_available else "stale" if source_freshness == "stale" or self._source_issue else "available"
        items: list[RSRatingItem] = []
        stock_conids = tuple(sorted({
            conid for conid in conids
            if (identity := identity_by_conid.get(conid))
            and str(identity.get("symbol", "")).strip()
            and str(identity.get("sec_type", "")).upper() == "STK"
        }))
        definitions_by_conid: dict[int, dict[str, Any]] = {}
        if stock_conids:
            try:
                definitions_by_conid = _definitions_by_conid(
                    await self.ibkr.security_definitions(stock_conids)
                )
                missing = tuple(
                    conid for conid in stock_conids
                    if _is_verified_us_stock(
                        definitions_by_conid.get(conid), conid,
                        str(identity_by_conid[conid].get("symbol", "")).strip().upper(),
                    ) is None
                )
                if missing:
                    definitions_by_conid.update(_definitions_by_conid(
                        await self.ibkr.security_definitions_fresh(missing)
                    ))
            except IBKRAuthError:
                raise
            except IBKRError as exc:
                log.warning("Could not verify US stock listings for ratings: %s", exc)
        for conid in conids:
            identity = identity_by_conid.get(conid)
            symbol = str(identity.get("symbol", "")).strip().upper() if identity else ""
            sec_type = str(identity.get("sec_type", "")).upper() if identity else ""
            verified = bool(
                identity and symbol and sec_type == "STK"
                and _is_verified_us_stock(definitions_by_conid.get(conid), conid, symbol) is True
            )
            record = by_symbol.get(symbol) if verified else None
            items.append(RSRatingItem(
                conid=conid,
                symbol=symbol or None,
                status=("unverified" if not verified else "rated" if record else "not_published" if source_available else "source_unavailable"),
                sector=record["sector"] if record else None,
                raw_strength=record["raw_strength"] if record else None,
                published_percentile=record["published_percentile"] if record else None,
                source_price=record["source_price"] if record else None,
                avg_volume_50=record["avg_volume_50"] if record else None,
            ))
        return RSRatingsResponse(
            status=source_status,
            source_revision=self._source_revision or snapshot.source_revision,
            source_published_at=self._source_published_at or snapshot.source_published_at,
            evidence_session=None,
            freshness=source_freshness,
            items=items,
        )

    async def _refresh_source(self) -> RSLeadersSourceResponse:
        try:
            metadata, csv_text = await self._fetch_pinned_csv()
            revision, published_at = metadata
            records = _parse_csv(csv_text) if csv_text is not None else self._records
            if not records:
                raise ValueError("Fred source CSV is unavailable for its published revision")
            self._records = records
            self._source_revision = revision
            self._source_published_at = published_at
            if csv_text is not None:
                self._source_fetched_at = self._now().astimezone(dt.UTC)
            self._source_issue = None
            if self._snapshot is not None:
                cleaned_issues = [issue for issue in self._snapshot.issues if not issue.startswith("Fred source check failed")]
                status = "stale" if self._freshness(published_at, self._now().astimezone(dt.UTC)) == "stale" else "available"
                self._snapshot = self._snapshot.model_copy(update={"issues": cleaned_issues, "status": status})
            self._persist_cache()
            issues = []
        except (httpx.HTTPError, ValueError, csv.Error, OSError, KeyError, TypeError) as exc:
            self._source_issue = f"Fred source check failed; retaining the last validated revision: {exc}"
            log.warning("Fred source metadata/download/validation failed: %s", exc)
            issues = [self._source_issue]
            if not self._records:
                return RSLeadersSourceResponse(phase="unavailable", issues=issues)
        return RSLeadersSourceResponse(
            phase="verifying", source_revision=self._source_revision,
            source_published_at=self._source_published_at,
            fetched_at=self._source_fetched_at,
            freshness=self._freshness(self._source_published_at, self._now().astimezone(dt.UTC)) if self._source_published_at else "unknown",
            eligible_count=sum(_qualifies(row) for row in self._records),
            issues=issues,
        )

    async def _resolve_leaders(self) -> RSLeadersResponse:
        if not self._records:
            if self._snapshot is not None:
                return self._snapshot
            return RSLeadersResponse(
                status="unavailable", freshness="unknown",
                issues=[self._source_issue or "No validated Fred RS source data is available."],
            )

        revision = self._source_revision
        published_at = self._source_published_at
        records = self._records
        eligible = sorted(
            (row for row in records if _qualifies(row)),
            key=lambda row: (-row["raw_strength"], row["source_rank"], row["symbol"]),
        )
        selected: list[RSItem] = []
        issues: list[str] = [self._source_issue] if self._source_issue else []
        unresolved: list[str] = []
        cached_items = {
            item.symbol: item for item in (self._snapshot.items if self._snapshot else [])
            if item.conid is not None
        }
        retry_symbols = set()
        for issue in self._snapshot.issues if self._snapshot else []:
            if issue.startswith(RESOLUTION_ISSUE_PREFIX):
                retry_symbols.update(issue[len(RESOLUTION_ISSUE_PREFIX):].rstrip(".").split(", "))
        attempts = 0
        search_errors = 0
        search_no_matches = 0
        search_ambiguous = 0
        contract_errors = 0
        contract_unconfirmed = 0
        contract_rejected = 0
        for record in eligible:
            if len(selected) >= MAX_LEADERS:
                break
            cached = cached_items.get(record["symbol"])
            if cached is not None:
                selected.append(RSItem(conid=cached.conid, company_name=cached.company_name, **record))
                continue
            if attempts >= MAX_RESOLUTION_ATTEMPTS:
                issues.append(f"Stopped after {MAX_RESOLUTION_ATTEMPTS} stock identity checks to keep IBKR resolution bounded.")
                break
            attempts += 1
            try:
                if record["symbol"] in retry_symbols:
                    matches = await self.ibkr.search_fresh(record["symbol"], sec_type="STK")
                else:
                    matches = await self.ibkr.search(record["symbol"], sec_type="STK")
            except IBKRAuthError:
                raise
            except IBKRError as exc:
                search_errors += 1
                log.warning("IBKR identity lookup failed for Fred ticker %s: %s", record["symbol"], exc)
                unresolved.append(record["symbol"])
                continue

            exact: dict[int, dict[str, Any]] = {}
            for match in matches if isinstance(matches, list) else []:
                if not isinstance(match, dict):
                    continue
                if str(match.get("symbol") or "").strip().upper() != record["symbol"]:
                    continue
                if "STK" not in _security_types(match):
                    continue
                try:
                    conid = int(match.get("conid"))
                except (TypeError, ValueError):
                    continue
                if conid > 0:
                    exact[conid] = match
            if not exact:
                search_no_matches += 1
                unresolved.append(record["symbol"])
                continue
            contract_error = False
            try:
                if record["symbol"] in retry_symbols:
                    definitions = await self.ibkr.security_definitions_fresh(tuple(sorted(exact)))
                else:
                    definitions = await self.ibkr.security_definitions(tuple(sorted(exact)))
                definitions_by_conid = _definitions_by_conid(definitions)
                verification = {
                    conid: _is_verified_us_stock(definitions_by_conid.get(conid), conid, record["symbol"])
                    for conid in exact
                }
                if record["symbol"] not in retry_symbols and None in verification.values():
                    definitions = await self.ibkr.security_definitions_fresh(tuple(sorted(exact)))
                    definitions_by_conid = _definitions_by_conid(definitions)
                    verification = {
                        conid: _is_verified_us_stock(definitions_by_conid.get(conid), conid, record["symbol"])
                        for conid in exact
                    }
            except IBKRAuthError:
                raise
            except IBKRError as exc:
                contract_error = True
                contract_errors += 1
                log.warning("IBKR contract verification failed for Fred ticker %s: %s", record["symbol"], exc)
                verification = {}
            verified_conids = [candidate for candidate, result in verification.items() if result is True]
            if len(verified_conids) != 1 or any(result is None for result in verification.values()):
                if len(verified_conids) > 1:
                    search_ambiguous += 1
                elif not contract_error and any(result is None for result in verification.values()):
                    contract_unconfirmed += 1
                elif not contract_error and verification:
                    contract_rejected += 1
                unresolved.append(record["symbol"])
                continue
            conid = verified_conids[0]
            match = exact[conid]
            company_name = str(match.get("companyName") or match.get("companyHeader") or "").strip() or None
            await self.identity.cache_resolved_identity(
                conid=conid,
                symbol=record["symbol"],
                company_name=company_name or "",
                sec_type="STK",
            )
            selected.append(RSItem(conid=conid, company_name=company_name, **record))

        if unresolved:
            expected = min(MAX_LEADERS, len(eligible))
            log.warning(
                "Fred leader listing resolution incomplete: %d of %d eligible leaders verified after %d IBKR candidates "
                "(search errors %d, no exact matches %d, ambiguous matches %d, contract request errors %d, "
                "unconfirmed contract identities %d, rejected contracts %d)",
                len(selected), expected, attempts, search_errors, search_no_matches, search_ambiguous,
                contract_errors, contract_unconfirmed, contract_rejected,
            )
            issues.append(f"{RESOLUTION_ISSUE_PREFIX}{', '.join(unresolved)}.")
        eligible_count = len(eligible)
        expected = min(MAX_LEADERS, eligible_count)
        if len(selected) < expected:
            issues.append(f"{len(selected)} of {expected} eligible leaders currently have verified US listings.")
        fetched_at = self._source_fetched_at or (self._now().astimezone(dt.UTC) if published_at else None)
        freshness = self._freshness(published_at, self._now().astimezone(dt.UTC)) if published_at else "unknown"
        self._snapshot = RSLeadersResponse(
            status="stale" if freshness == "stale" or self._source_issue else "available",
            source_revision=revision,
            source_published_at=published_at,
            fetched_at=fetched_at,
            evidence_session=None,
            freshness=freshness,
            eligible_count=eligible_count,
            items=selected,
            issues=issues,
        )
        self._persist_cache()
        return self._snapshot

    async def _fetch_pinned_csv(self) -> tuple[tuple[str, dt.datetime], str | None]:
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "Orbit-Parallax"}
        async with httpx.AsyncClient(timeout=SOURCE_TIMEOUT_SECONDS, headers=headers) as client:
            metadata_response = await client.get(
                COMMIT_URL,
                params={"path": OUTPUT_PATH, "per_page": "1", "sha": "main"},
            )
            metadata_response.raise_for_status()
            metadata = metadata_response.json()
            if not isinstance(metadata, list) or not metadata or not isinstance(metadata[0], dict):
                raise ValueError("Fred source has no published stock CSV revision")
            commit = metadata[0]
            revision = commit.get("sha")
            commit_data = commit.get("commit")
            committer = commit_data.get("committer") if isinstance(commit_data, dict) else None
            if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", revision):
                raise ValueError("Fred source revision is invalid")
            if not isinstance(committer, dict):
                raise ValueError("Fred source commit metadata is invalid")
            published_at = _parse_time(committer.get("date"))
            if self._source_revision == revision:
                return (revision, published_at), None
            csv_response = await client.get(RAW_URL.format(revision=revision))
            csv_response.raise_for_status()
            return (revision, published_at), csv_response.text

    def _with_current_freshness(self, snapshot: RSLeadersResponse) -> RSLeadersResponse:
        if snapshot.source_published_at is None:
            return snapshot
        freshness = self._freshness(snapshot.source_published_at, self._now().astimezone(dt.UTC))
        issues = list(snapshot.issues)
        source_issue = self._source_issue or next((issue for issue in issues if issue.startswith("Fred source check failed")), None)
        if source_issue and source_issue not in issues:
            issues.append(source_issue)
        source_failed = source_issue is not None
        return snapshot.model_copy(update={
            "freshness": freshness,
            "status": "stale" if freshness == "stale" or source_failed else snapshot.status if snapshot.status in {"unavailable", "verifying"} else "available",
            "issues": issues,
        })

    @staticmethod
    def _freshness(published_at: dt.datetime, now: dt.datetime) -> str:
        return "stale" if now - published_at > STALE_AFTER else "unknown"

    def _load_cache(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            envelope = json.loads(self.cache_path.read_text(encoding="utf-8"))
            if not isinstance(envelope, dict) or envelope.get("schema_version") != SCHEMA_VERSION:
                return
            snapshot_data = envelope.get("snapshot")
            records = envelope.get("records")
            if snapshot_data is not None and not isinstance(snapshot_data, dict) or not isinstance(records, list):
                return
            validated_records = [self._validate_cached_record(row) for row in records]
            snapshot = RSLeadersResponse.model_validate(snapshot_data) if isinstance(snapshot_data, dict) else None
            self._snapshot = self._with_current_freshness(snapshot) if snapshot else None
            self._records = validated_records
            fallback_revision = snapshot.source_revision if snapshot else None
            cached_revision = envelope.get("source_revision")
            self._source_revision = cached_revision if isinstance(cached_revision, str) and re.fullmatch(r"[0-9a-fA-F]{40}", cached_revision) else fallback_revision
            self._source_published_at = self._cached_time(envelope.get("source_published_at")) or (snapshot.source_published_at if snapshot else None)
            self._source_fetched_at = self._cached_time(envelope.get("source_fetched_at")) or (snapshot.fetched_at if snapshot else None)
            source_issue = envelope.get("source_issue")
            self._source_issue = source_issue if isinstance(source_issue, str) and source_issue else None
        except FileNotFoundError:
            return
        except (OSError, ValueError, TypeError, KeyError) as exc:
            log.warning("Ignoring invalid saved Fred RS snapshot: %s", exc)

    @staticmethod
    def _cached_time(value: Any) -> dt.datetime | None:
        if not isinstance(value, str):
            return None
        try:
            return _parse_time(value)
        except ValueError:
            return None

    @staticmethod
    def _validate_cached_record(value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("saved RS row is invalid")
        source_rank = value.get("source_rank")
        symbol = value.get("symbol")
        sector = value.get("sector")
        if isinstance(source_rank, bool) or not isinstance(source_rank, int) or source_rank <= 0:
            raise ValueError("saved RS rank is invalid")
        if not isinstance(symbol, str) or not symbol.strip():
            raise ValueError("saved RS symbol is invalid")
        if sector is not None and not isinstance(sector, str):
            raise ValueError("saved RS sector is invalid")

        record = {"source_rank": source_rank, "symbol": symbol.strip().upper(), "sector": sector}
        for field in ("raw_strength", "source_price", "avg_volume_50"):
            number = value.get(field)
            if number is not None and (
                isinstance(number, bool)
                or not isinstance(number, (int, float))
                or not math.isfinite(number)
            ):
                raise ValueError(f"saved RS {field} is invalid")
            record[field] = number

        percentile = value.get("published_percentile")
        if percentile is not None and (
            isinstance(percentile, bool)
            or not isinstance(percentile, int)
            or not 0 <= percentile <= 99
        ):
            raise ValueError("saved RS percentile is invalid")
        record["published_percentile"] = percentile
        return record

    def _persist_cache(self) -> None:
        if self._snapshot is None and not self._records:
            return
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            envelope = {
                "schema_version": SCHEMA_VERSION,
                "snapshot": self._snapshot.model_dump(mode="json") if self._snapshot else None,
                "source_revision": self._source_revision,
                "source_published_at": self._source_published_at.isoformat() if self._source_published_at else None,
                "source_fetched_at": self._source_fetched_at.isoformat() if self._source_fetched_at else None,
                "source_issue": self._source_issue,
                "records": self._records,
            }
            temp_path = self.cache_path.with_suffix(self.cache_path.suffix + ".tmp")
            with temp_path.open("w", encoding="utf-8") as target:
                json.dump(envelope, target, separators=(",", ":"), allow_nan=False)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temp_path, self.cache_path)
        except OSError as exc:
            log.warning("Could not persist Fred RS snapshot: %s", exc)

    def _finish_refresh(self, key: str, flight: _RefreshFlight, task: asyncio.Task[Any]) -> None:
        if self._flights.get(key) is flight:
            self._flights.pop(key, None)
        try:
            task.exception()
        except asyncio.CancelledError:
            pass
