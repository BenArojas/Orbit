from __future__ import annotations

from typing import TYPE_CHECKING

from models.tws_execution_assistant import ReconciliationSummary, TwsStatusResponse

if TYPE_CHECKING:
    from services.broker_session import BrokerSessionService


class TwsStatusService:
    """Read-only TWS status for Slice 2.

    Returns a static stub — no TWS socket, no ib_async, no adapter in this slice.
    Slice 4 will replace the stub with a real adapter state.
    """

    def __init__(self, broker_session: BrokerSessionService) -> None:
        self._session = broker_session

    def get_status(self) -> TwsStatusResponse:
        return TwsStatusResponse(
            mode=self._session.current_mode(),
            connected=False,
            adapter_state="not_initialized",
            kill_switch_active=False,
            reconciliation_summary=ReconciliationSummary(),
        )
