from __future__ import annotations

from typing import TYPE_CHECKING

from models.broker_session import BrokerSessionMode, BrokerSessionSwitchTarget

if TYPE_CHECKING:
    from services.ibkr import IBKRService
    from services.tws_broker_adapter import TwsBrokerAdapter

_CP_MODULES = ["parallax", "moonmarket", "inflect"]
_TWS_MODULES = ["tws-execution-assistant"]


class BrokerSessionService:
    """Process-local broker session mode derived from live connection state.

    Priority:
      1. TWS adapter connected  → "tws"     (wins over CP if both somehow active)
      2. CP Web API authenticated → "client_portal"
      3. Neither                → "none"

    TWS wins when both are active — explicit priority until the dual-session
    design is settled (see AGENTS.md human-approval gate).
    set_mode() is kept for API backward-compat but is now a no-op; mode is
    fully derived from adapter/auth state.
    """

    def __init__(self, ibkr: IBKRService, tws_adapter: TwsBrokerAdapter) -> None:
        self._ibkr = ibkr
        self._tws_adapter = tws_adapter

    def current_mode(self) -> BrokerSessionMode:
        if self._tws_adapter.is_connected():
            return "tws"
        return "client_portal" if self._ibkr.state.authenticated else "none"

    def set_mode(self, target: BrokerSessionSwitchTarget) -> None:  # noqa: ARG002
        # ponytail: no-op. Mode is now connection-derived; kept for API compat.
        pass

    def available_modules(self) -> list[str]:
        mode = self.current_mode()
        if mode == "client_portal":
            return list(_CP_MODULES)
        # tws mode: TWS module active. none mode: TWS module is the setup entry
        # point — the user must open it to connect; no CP modules are available.
        return list(_TWS_MODULES)
