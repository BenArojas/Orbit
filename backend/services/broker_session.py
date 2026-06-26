from __future__ import annotations

from typing import TYPE_CHECKING

from models.broker_session import BrokerSessionMode, BrokerSessionSwitchTarget

if TYPE_CHECKING:
    from services.ibkr import IBKRService

_CP_MODULES = ["parallax", "moonmarket", "inflect"]
_TWS_MODULES = ["tws-execution-assistant"]


class BrokerSessionService:
    """Process-local broker session mode.

    Derives none/client_portal from IBKR auth state.
    tws must be set explicitly via set_mode. No DB persistence in Slice 1.
    """

    def __init__(self, ibkr: IBKRService) -> None:
        self._ibkr = ibkr
        self._tws_override = False

    def current_mode(self) -> BrokerSessionMode:
        if self._tws_override:
            return "tws"
        return "client_portal" if self._ibkr.state.authenticated else "none"

    def set_mode(self, target: BrokerSessionSwitchTarget) -> None:
        self._tws_override = target == "tws"

    def available_modules(self) -> list[str]:
        mode = self.current_mode()
        if mode == "tws":
            return list(_TWS_MODULES)
        if mode == "client_portal":
            return list(_CP_MODULES)
        return []
