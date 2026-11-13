"""TWS provenance and durable broker records for the Orbit product."""

from fastapi import APIRouter, Depends, Query

from deps import get_db, get_product_data, get_tws_adapter

router = APIRouter(prefix="/data", tags=["data"])


@router.get("/account")
async def account(adapter=Depends(get_tws_adapter)):
    return await adapter.data_account()


@router.get("/holdings")
async def holdings(adapter=Depends(get_tws_adapter)):
    adapter._require_data_connection()
    return {"source": "tws", "positions": [
        p.model_dump(mode="json") for p in adapter.get_reconciliation().positions
    ]}


@router.get("/executions")
async def executions(adapter=Depends(get_tws_adapter), db=Depends(get_db)):
    await adapter.flush_storage()
    return {"items": await db.broker_executions(), "source": "tws",
            "historical_coverage": "Only fills observed by Orbit or returned by reqExecutions are included."}


@router.get("/history/{conid}")
async def history(
    conid: int, period: str = Query("1y"), bar: str = Query("1d"),
    data=Depends(get_product_data),
):
    return await data.history(conid, period=period, bar=bar)


@router.get("/contracts/{conid}")
async def contract(conid: int, data=Depends(get_product_data)):
    return await data.contract_info(conid)
