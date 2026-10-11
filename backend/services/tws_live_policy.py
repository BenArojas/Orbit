from __future__ import annotations

from dataclasses import dataclass

from models.tws_execution_assistant import (
    TwsLiveAllowlistRequest,
    TwsLiveArmRequest,
    TwsLivePolicyStatus,
)
from services.tws_broker_adapter import TwsPlaceOrderGuardError


@dataclass(frozen=True)
class _LiveKey:
    account_id: str
    host: str
    port: int


class TwsLivePolicyService:
    """Process-local live trading allowlist and arm state."""

    def __init__(self) -> None:
        self._allowlist: set[_LiveKey] = set()
        self._armed: _LiveKey | None = None

    def _key(self, account_id: str, host: str, port: int) -> _LiveKey:
        return _LiveKey(account_id=account_id.strip(), host=host.strip() or "127.0.0.1", port=port)

    def _current_key(self, *, account_id: str | None, host: str, port: int | None) -> _LiveKey | None:
        if not account_id or port is None:
            return None
        return self._key(account_id, host, port)

    def status(
        self,
        *,
        account_id: str | None,
        host: str,
        port: int | None,
        is_connected: bool,
        is_paper_port: bool,
    ) -> TwsLivePolicyStatus:
        current = self._current_key(account_id=account_id, host=host, port=port)
        if not is_connected or current != self._armed:
            self._armed = None
        return TwsLivePolicyStatus(
            connected_account_id=account_id,
            connected_host=host,
            connected_port=port,
            is_paper_port=is_paper_port,
            allowlisted=current in self._allowlist if current else False,
            armed=current == self._armed if current else False,
        )

    def allow(self, req: TwsLiveAllowlistRequest) -> None:
        self._allowlist.add(self._key(req.account_id, req.host, req.port))

    def arm(
        self,
        req: TwsLiveArmRequest,
        *,
        account_id: str | None,
        host: str,
        port: int | None,
        is_connected: bool,
        is_paper_port: bool,
    ) -> None:
        if not is_connected:
            raise TwsPlaceOrderGuardError("not_connected")
        if is_paper_port:
            raise TwsPlaceOrderGuardError("paper_port_cannot_arm_live")
        current = self._current_key(account_id=account_id, host=host, port=port)
        requested = self._key(req.account_id, req.host, req.port)
        if current is None or requested != current:
            raise TwsPlaceOrderGuardError("live_session_mismatch")
        if current not in self._allowlist:
            raise TwsPlaceOrderGuardError("live_session_not_allowlisted")
        self._armed = current

    def disarm(self) -> None:
        self._armed = None

    def assert_live_allowed(
        self,
        *,
        account_id: str | None,
        host: str,
        port: int | None,
        is_connected: bool,
        is_paper_port: bool,
    ) -> None:
        status = self.status(
            account_id=account_id,
            host=host,
            port=port,
            is_connected=is_connected,
            is_paper_port=is_paper_port,
        )
        if not is_connected:
            raise TwsPlaceOrderGuardError("not_connected")
        if is_paper_port:
            raise TwsPlaceOrderGuardError("paper_port_cannot_live_trade")
        if not status.allowlisted:
            raise TwsPlaceOrderGuardError("live_session_not_allowlisted")
        if not status.armed:
            raise TwsPlaceOrderGuardError("live_session_not_armed")
