# api/market.py
import logging
import time
import asyncio
import httpx
from cache import cached, account_specific_key_builder, option_key_builder, snapshot_key_builder, history_cache_key_builder
from prot import ServiceProtocol


log = logging.getLogger("ibkr.market")

class MarketDataMixin:
    @cached(ttl=3600)
    async def get_scanner_params(self: ServiceProtocol):
        log.info("Fetching IServer scanner parameters...")
        return await self._req("GET", "/iserver/scanner/params")

    async def run_scanner(self: ServiceProtocol, scanner_payload: dict):
        log.info("Running IServer scanner with payload: %s", scanner_payload)
        return await self._req("POST", "/iserver/scanner/run", json=scanner_payload)
    
    @cached(ttl=3600, key_builder=account_specific_key_builder)
    async def get_conid(self: ServiceProtocol, symbol: str, sec_type: str = "STK") -> str | None:
        try:
            res = await self._req("GET", "/iserver/secdef/search", params={"symbol": symbol, "secType": sec_type})
            return res[0]["conid"] if res else None
        except httpx.HTTPStatusError as exc:
            log.warning("secdef search failed %s %s", exc.response.status_code, symbol)
            return None
        
    @cached(ttl=3600) 
    async def search(self: ServiceProtocol, symbol, name=False, secType=""):
        q = {"symbol": symbol}
        if name: q["name"] = str(name).lower()
        if secType: q["secType"] = secType
        return await self._req("GET", "/iserver/secdef/search", params=q)
    
    @cached(ttl=3600)
    async def search_detailed(self: ServiceProtocol, conid: int):
        response = await self._req("GET", f"/trsrv/secdef?conids={conid}")
        return response.get('secdef', [])[0] if response.get('secdef') else None

    @cached(ttl=3600, key_builder=option_key_builder)
    async def get_strikes_for_month(self: ServiceProtocol, conid: int, month: str) -> dict:
        params = {"conid": conid, "secType": "OPT", "month": month}
        return await self._req("GET", "/iserver/secdef/strikes", params=params)
    
    @cached(ttl=3600, key_builder=option_key_builder)
    async def get_contract_info(self: ServiceProtocol, conid: int, month: str, strike: float, right: str) -> list:
        params = {"conid": conid, "secType": "OPT", "month": month, "strike": strike, "right": right}
        return await self._req("GET", "/iserver/secdef/info", params=params)

    async def check_market_data_availability(self: ServiceProtocol, conid):
        q = {"conids": str(conid), "fields": "6509"}
        response = await self._req("GET", "/iserver/marketdata/snapshot", params=q)
        if response and len(response) > 0 and "6509" in response[0]:
            availability = response[0]["6509"]
            log.info(f"Market data availability for {conid}: {availability}")
            return availability
        return None

    async def snapshot(self: ServiceProtocol, conids, fields, timeout=5, interval=1):
        await self.ensure_accounts()
        q = {"conids": ",".join(map(str, conids)), "fields": fields}
        start_time = time.time()
        requested_fields = fields.split(',')
        log.info(f"Starting snapshot poll for conids: {conids} with fields: {fields}")

        while time.time() - start_time < timeout:
            response = await self._req("GET", "/iserver/marketdata/snapshot", params=q)
            if response and isinstance(response, list):
                all_data_present = True
                conids_in_response = {str(item.get('conid')) for item in response}

                if not set(map(str, conids)).issubset(conids_in_response):
                    all_data_present = False
                else:
                    for item in response:
                        if not all(field in item for field in requested_fields):
                            all_data_present = False
                            break
                if all_data_present:
                    log.info(f"Successfully received complete snapshot for conids: {conids}")
                    return response

            log.info(f"All requested fields not yet available. Retrying in {interval}s...")
            await asyncio.sleep(interval)

        log.warning(f"Snapshot request for conids {conids} timed out after {timeout}s.")
        return response # Return whatever was last received
    
    @cached(ttl=1500, key_builder=history_cache_key_builder)
    async def history(self:ServiceProtocol, conid, period="1w", bar="15min"):
        await self.ensure_accounts()
        q = {"conid": conid, "period": period, "bar": bar, "outsideRth": "true"}
        return await self._req("GET", "/iserver/marketdata/history", params=q)