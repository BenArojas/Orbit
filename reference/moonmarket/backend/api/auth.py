# api/auth.py
import logging
import httpx
from prot import ServiceProtocol
from models import AuthStatusDTO

log = logging.getLogger("ibkr.auth")

class AuthMixin:
    async def sso_validate(self: ServiceProtocol) -> bool:
        try:
            await self._req("GET", "/sso/validate")
            return True
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                return False
            raise

    async def tickle(self: ServiceProtocol) -> bool:
        data = await self._req("POST", "/tickle")
        self.state.ibkr_authenticated = True
        self.state.ibkr_session_token = data.get("session")
        return True
    
    async def ensure_accounts(self: ServiceProtocol):
        self.state.accounts_cache = await self._req("GET", "/iserver/accounts")
        self.state.accounts_fetched = True

    async def auth_status(self: ServiceProtocol) -> dict:
        try:
            return await self._req("POST", "/iserver/auth/status")
        except Exception as e:
            log.warning(f"Could not retrieve auth status from IBKR: {e}")
            return {"authenticated": False, "connected": False, "message": "Failed to contact auth server."}
    
    async def check_and_authenticate(self: ServiceProtocol) -> AuthStatusDTO:
        status = await self.auth_status()
        is_authenticated = status.get("authenticated", False)
        is_connected = status.get("connected", False)
        is_session_valid = is_authenticated and is_connected
        
        self.state.ibkr_authenticated = is_session_valid
        if not is_session_valid:
            self.state.ibkr_session_token = None

        return AuthStatusDTO(
            authenticated=is_session_valid,
            websocket_ready=self.state.ws_connected,
            message=status.get("message", "Status checked.")
        )
        
    async def logout(self: ServiceProtocol):
        try:
            log.info("Calling IBKR API to terminate session...")
            response = await self._req("POST", "/logout")
            log.info("Successfully logged out from IBKR API.")
            return response
        except Exception as e:
            log.error(f"Error during IBKR API logout call: {e}")
            raise
        finally:
            log.info("Clearing local IBKR session state.")
            self.state.ibkr_authenticated = False
            self.state.ibkr_session_token = None
            self.state.accounts_cache.clear()