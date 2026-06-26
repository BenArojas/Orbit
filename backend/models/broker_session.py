from typing import Literal

from pydantic import BaseModel

BrokerSessionMode = Literal["none", "client_portal", "tws"]

# Accepted switch targets — "none" is not a valid explicit switch target.
# Unauthenticated mode is derived automatically from IBKR state.
BrokerSessionSwitchTarget = Literal["client_portal", "tws"]


class BrokerSessionModeResponse(BaseModel):
    mode: BrokerSessionMode
    available_modules: list[str]
