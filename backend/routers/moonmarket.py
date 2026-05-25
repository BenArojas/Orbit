"""
MoonMarket router — portfolio, orders, transactions for the MoonMarket module.

For the Orbit foundation this exposes only a health route, proving that the
single consolidated sidecar serves the `/moonmarket` prefix alongside
Parallax's existing routes. Portfolio/orders/transactions endpoints are
added in later plans.
"""
from fastapi import APIRouter

router = APIRouter(prefix="/moonmarket", tags=["moonmarket"])


@router.get("/health")
async def moonmarket_health() -> dict[str, str]:
    return {"module": "moonmarket", "status": "ok"}
