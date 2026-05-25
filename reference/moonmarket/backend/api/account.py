# api/account.py
import logging
import asyncio
from typing import List, Dict, Any, Optional
from fastapi import HTTPException
from pydantic import ValidationError
from models import (
    AccountDetailsDTO, AccountInfoDTO, AccountPermissions, BriefAccountInfoDTO, 
    LedgerDTO, LedgerEntry, OwnerInfoDTO, PermissionsDTO
)
from cache import cached, account_specific_key_builder
from utils import calculate_days_to_expiry
from prot import ServiceProtocol


log = logging.getLogger("ibkr.account")

class AccountMixin:
    async def positions(self: ServiceProtocol, account_id: str):
        all_positions = []
        page_id = 0
        while True:
            pos_page = await self._req("GET", f"/portfolio/{account_id}/positions/{page_id}")
            if not pos_page:
                break
            all_positions.extend(pos_page)
            page_id += 1
        self.state.positions[account_id] = all_positions
        return all_positions

    async def get_position_by_conid(self: ServiceProtocol, account_id: str, conid: int) -> Optional[dict]:
        account_positions = self.state.positions.get(account_id)
        if account_positions is None:
            account_positions = await self.positions(account_id)
        return next((pos for pos in account_positions if pos.get("conid") == conid), None)
    
    async def get_related_positions(self: ServiceProtocol, account_id: str, stock_conid: int, stock_ticker: str) -> Dict[str, Any]:
        all_positions = self.state.positions.get(account_id) or await self.positions(account_id)
        stock_position = None
        option_positions = []
        for pos in all_positions:
            if pos.get("conid") == stock_conid:
                stock_position = pos
            elif pos.get("assetClass") == "OPT" and stock_ticker in pos.get("contractDesc", ""):
                pos["daysToExpire"] = calculate_days_to_expiry(pos.get("contractDesc", ""))
                option_positions.append(pos)
        return {"stock": stock_position, "options": option_positions}

    async def get_available_accounts(self: ServiceProtocol) -> List[BriefAccountInfoDTO]:
        raw_accounts = await self._req("GET", "/portfolio/accounts")
        if not isinstance(raw_accounts, list):
            return []
        return [BriefAccountInfoDTO.model_validate(acc) for acc in raw_accounts]

    @cached(ttl=1200, key_builder=account_specific_key_builder)
    async def get_account_permissions(self: ServiceProtocol, account_id: str) -> AccountPermissions:
        """
        Fetches and parses trading permissions for a specific account.
        """
        try:
            data = await self._req("GET", "/iserver/accounts")
            
            acct_props = data.get("acctProps", {}).get(account_id, {})
            allow_features = data.get("allowFeatures", {})
            
            # --- FIX #1: Get allowed_assets from the correct dictionary ('allowFeatures') ---
            allowed_assets = allow_features.get("allowedAssetTypes", "")
            
            # This will now correctly evaluate to True if "OPT" is in the string
            allow_options = "OPT" in allowed_assets.split(',')

            # This will now correctly evaluate to True if the string is not empty
            can_trade = bool(allowed_assets)

            # --- FIX #2: Infer margin status from allowed asset types ---
            # The 'tradingType' field isn't in this API response.
            # We can infer margin if assets like FUT or CFD are permitted.
            is_margin = "FUT" in allowed_assets or "CFD" in allowed_assets
            
            return AccountPermissions(
                canTrade=can_trade,
                allowOptionsTrading=allow_options,
                allowCryptoTrading=allow_features.get("allowCrypto", False),
                isMarginAccount=is_margin,
                supportsFractions=acct_props.get("supportsFractions", False)
            )
        except Exception as e:
            log.exception(f"Failed to parse account permissions for {account_id}: {e}")
            return AccountPermissions(
                canTrade=False, allowOptionsTrading=False, allowCryptoTrading=False,
                isMarginAccount=False, supportsFractions=False
            )
    
    @cached(ttl=120, key_builder=account_specific_key_builder) 
    async def get_account_summary(self: ServiceProtocol, account_id: str) -> Dict[str, Any]:
        """ Fetches account summary details like cash, net liquidation value, etc. """
        try:
            # This is a standard endpoint to get account values
            response = await self._req("GET", f"/portfolio/{account_id}/summary")
            return response
        except Exception as e:
            log.exception(f"Failed to fetch account summary for {account_id}: {e}")
            raise HTTPException(status_code=500, detail="Could not fetch account summary")

    async def get_pnl(self: ServiceProtocol) -> Dict[str, Any]:
        """
        Fetches the partitioned PnL data using the official endpoint.
        The response contains PnL data for all accounts in the session.
        """
        try:
            return await self._req("GET", "/iserver/account/pnl/partitioned")
        except Exception as e:
            log.exception(f"Failed to fetch partitioned PnL: {e}")
            return {} # Return an empty dict on failure
    
    async def get_account_details(self: ServiceProtocol, accountId: str ) -> AccountDetailsDTO:
        """Fetch complete account details from multiple endpoints"""
        # Run all three API calls concurrently
        results = await asyncio.gather(
            self._req("GET", f"/acesws/{accountId}/signatures-and-owners"),
            self._req("GET", "/portfolio/accounts"),
            self._req("GET", "/iserver/accounts"),
            return_exceptions=True # Prevents one failure from stopping others
        )

        owner_resp, portfolio_resp, accounts_resp = results
        
        
        # --- Process owner_resp ---
        if isinstance(owner_resp, Exception):
            log.error(f"Failed to fetch owner info: {owner_resp}")
            owner_info = OwnerInfoDTO(userName="", entityName="", roleId="")
        else:
            owner_data = {}
            if owner_resp.get("users"):
                user = owner_resp["users"][0]
                entity = user.get("entity", {})
                owner_data = {
                    "userName": user.get("userName"),
                    "entityName": entity.get("entityName"),
                    "roleId": user.get("roleId")
                }

            owner_info = OwnerInfoDTO(
                userName=owner_data.get("userName", ""),
                entityName=owner_data.get("entityName", ""),
                roleId=owner_data.get("roleId", "")
            )
            
        # --- Process portfolio_resp ---
        if isinstance(portfolio_resp, Exception):
            log.error(f"Failed to fetch account info: {portfolio_resp}")
            account_info = AccountInfoDTO(
                accountId=accountId, accountTitle="", accountType="", 
                tradingType="", baseCurrency="USD", ibEntity="", 
                clearingStatus="", isPaper=False
            )
        else:
            account_data = next((acc for acc in portfolio_resp if acc.get("accountId") == accountId), {})
            account_info = AccountInfoDTO(
                accountId=account_data.get("accountId", accountId),
                accountTitle=account_data.get("accountTitle", ""),
                accountType=account_data.get("type", ""),
                tradingType=account_data.get("tradingType", ""),
                baseCurrency=account_data.get("currency", "USD"),
                ibEntity=account_data.get("ibEntity", ""),
                clearingStatus=account_data.get("clearingStatus", ""),
                isPaper=account_data.get("isPaper", False)
            )

        # --- Process accounts_resp ---
        if isinstance(accounts_resp, Exception):
            log.error(f"Failed to fetch permissions: {accounts_resp}")
            permissions = PermissionsDTO(
                allowFXConv=False, allowCrypto=False, 
                allowEventTrading=False, supportsFractions=False
            )
        else:
            permissions_data = accounts_resp.get("allowFeatures", {})
            acct_props = accounts_resp.get("acctProps", {}).get(accountId, {})
            permissions = PermissionsDTO(
                allowFXConv=permissions_data.get("allowFXConv", False),
                allowCrypto=permissions_data.get("allowCrypto", False),
                allowEventTrading=permissions_data.get("allowEventTrading", False),
                supportsFractions=acct_props.get("supportsFractions", False)
            )

        return AccountDetailsDTO(
            owner=owner_info,
            account=account_info,
            permissions=permissions
        )
    
    async def account_performance(self: ServiceProtocol, accountId: str, period: str = "1Y") -> list[dict]:
        """
        Fetches historical account NAV data from /pa/performance for the primary account
        and transforms it into the format required by the frontend chart.

        :param period: The period for which to fetch data (e.g., "1D", "1M", "1Y").
        :return: A list of dictionaries, e.g., [{'time': 1609459200, 'value': 100500.75}, ...]
        """
        

        # Use the primary account ID fetched and stored in app_state
        payload = {
            "acctIds": [accountId], 
            "period": period
        }
        headers = {"Content-Type": "application/json"}

        return await self._req(
            "POST", 
            "/pa/performance",
            json=payload,  
            headers=headers
            )
        
    async def account_watchlists(self: ServiceProtocol):
        params ={
            "SC": "USER_WATCHLIST"
        }
        response = await self._req("GET", "/iserver/watchlists", params = params)
        if not response: return None
        # Extract just ID and name from user_lists
        watchlists = {}
        if 'data' in response and 'user_lists' in response['data']:
            for watchlist in response['data']['user_lists']:
                watchlists[watchlist['id']] = watchlist['name']
        
        return watchlists

    @cached(ttl=1500, key_builder=account_specific_key_builder)
    async def account_allocation(self: ServiceProtocol, account_id: str):
        data = await self._req("GET", f"/portfolio/{account_id}/allocation")
        self.state.allocation = data
        return data

    @cached(ttl=300, key_builder=account_specific_key_builder)
    async def combo_positions(self: ServiceProtocol, acct: str | None = None, nocache: bool = False):
        params = {"nocache": str(nocache).lower()}
        return await self._req("GET", f"/portfolio/{acct}/combo/positions", params=params)

    @cached(ttl=300, key_builder=account_specific_key_builder)
    async def ledger(self: ServiceProtocol, account_id: str) -> LedgerDTO:
        raw_data: Dict[str, Dict[str, Any]] = await self._req("GET", f"/portfolio/{account_id}/ledger")
        
        base_currency_entry = raw_data.get("BASE", {})
        base_currency = base_currency_entry.get("currency") or base_currency_entry.get("secondkey")
        
        if not base_currency or base_currency == "BASE":
            log.warning(f"Could not conclusively determine base currency from IBKR ledger data for account {account_id}. Defaulting to USD.")
            base_currency = "USD"

        ledgers: List[LedgerEntry] = []
        
        for currency_key, data_payload in raw_data.items():
            if not isinstance(data_payload, dict) or not data_payload:
                log.warning(f"Skipping non-dictionary or empty ledger entry for key '{currency_key}'. Data: {data_payload}")
                continue
            
            try:
                # model_validate will now map snake_case payload keys to snake_case model fields directly
                ledgers.append(LedgerEntry.model_validate(data_payload))
            except ValidationError as e:
                log.error(f"Pydantic validation error for ledger entry '{currency_key}': {e}. Raw data: {data_payload}")
                continue
            except Exception as e:
                log.error(f"Unexpected error processing ledger entry '{currency_key}': {e}. Raw data: {data_payload}")
                continue

        return LedgerDTO(baseCurrency=base_currency, ledgers=ledgers)