from __future__ import annotations

from typing import Literal, TypedDict

TwsOrderType = Literal["MKT", "LMT", "STP", "STP LMT"]
TwsPriceField = Literal["limit_price", "stop_price"]


class TwsOrderCapability(TypedDict):
    can_draft: bool
    can_modify: bool
    price_fields: tuple[TwsPriceField, ...]


TWS_ORDER_CAPABILITIES: dict[TwsOrderType, TwsOrderCapability] = {
    "MKT": {"can_draft": True, "can_modify": True, "price_fields": ()},
    "LMT": {"can_draft": True, "can_modify": True, "price_fields": ("limit_price",)},
    "STP": {"can_draft": True, "can_modify": True, "price_fields": ("stop_price",)},
    "STP LMT": {"can_draft": True, "can_modify": True, "price_fields": ("stop_price", "limit_price")},
}


def required_price_fields(order_type: TwsOrderType) -> tuple[TwsPriceField, ...]:
    return TWS_ORDER_CAPABILITIES[order_type]["price_fields"]


def can_modify_order_type(order_type: str) -> bool:
    return order_type in TWS_ORDER_CAPABILITIES and TWS_ORDER_CAPABILITIES[order_type]["can_modify"]  # type: ignore[index]
