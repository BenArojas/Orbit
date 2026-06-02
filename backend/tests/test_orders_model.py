import pytest
from pydantic import ValidationError

from models import MoonMarketOrderDraft


def test_trail_requires_trailing_fields():
    with pytest.raises(ValidationError):
        MoonMarketOrderDraft(
            conid=265598, side="SELL", quantity=5, orderType="TRAIL", tif="GTC"
        )


def test_trail_accepts_trailing_fields():
    order = MoonMarketOrderDraft(
        conid=265598,
        side="SELL",
        quantity=5,
        orderType="TRAIL",
        tif="GTC",
        trailingType="%",
        trailingAmt=5,
    )
    assert order.trailing_type == "%"
    assert order.trailing_amt == 5
    assert order.outside_rth is False


def test_traillmt_requires_price():
    with pytest.raises(ValidationError):
        MoonMarketOrderDraft(
            conid=265598,
            side="SELL",
            quantity=5,
            orderType="TRAILLMT",
            tif="GTC",
            trailingType="amt",
            trailingAmt=2,
        )


def test_traillmt_accepts_price_and_outside_rth():
    order = MoonMarketOrderDraft(
        conid=265598,
        side="SELL",
        quantity=5,
        orderType="TRAILLMT",
        tif="GTC",
        trailingType="amt",
        trailingAmt=2,
        price=178.0,
        outsideRTH=True,
    )
    assert order.price == 178.0
    assert order.outside_rth is True
