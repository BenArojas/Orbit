# api/orders.py
import logging
from typing import List, Dict, Any
from fastapi import HTTPException
from prot import ServiceProtocol


log = logging.getLogger("ibkr.orders")

class OrdersMixin:
    async def get_live_orders(self: ServiceProtocol) -> List[Dict[str, Any]]:
        try:
            await self._req("GET", "/iserver/account/orders", params={"force": "true"})
            orders_data = await self._req("GET", "/iserver/account/orders")
            return orders_data.get("orders", [])
        except Exception as e:
            log.exception("Failed to fetch live orders: %s", e)
            return []

    async def cancel_order(self: ServiceProtocol, account_id: str, order_id: str) -> Dict[str, Any]:
        try:
            return await self._req("DELETE", f"/iserver/account/{account_id}/order/{order_id}")
        except Exception as e:
            log.exception(f"Failed to cancel order {order_id}: {e}")
            raise HTTPException(status_code=500, detail="Could not cancel order")

    async def modify_order(self: ServiceProtocol, account_id: str, order_id: str, new_order_data: Dict[str, Any]) -> Dict[str, Any]:
        try:
            live_orders = await self.get_live_orders()
            original_order = next((o for o in live_orders if str(o.get("orderId")) == order_id), None)
            if not original_order:
                raise HTTPException(status_code=404, detail=f"Live order with ID {order_id} not found.")

            order_payload = {
                "conid": original_order.get("conid"),
                "orderType": original_order.get("origOrderType"),
                "side": original_order.get("side"),
                "tif": original_order.get("timeInForce"),
                "quantity": original_order.get("totalSize"),
                "price": original_order.get("price")
            }
            order_payload.update(new_order_data)
            
            return await self._req("POST", f"/iserver/account/{account_id}/order/{order_id}", json=order_payload)
        except HTTPException as http_exc:
            raise http_exc
        except Exception as e:
            log.exception(f"An unexpected error occurred while modifying order {order_id}: {e}")
            raise HTTPException(status_code=500, detail="Could not modify order")
    
    async def preview_order(self: ServiceProtocol, account_id: str, order: Dict[str, Any]) -> Dict[str, Any]:
        try:
            payload = {"orders": [order]}
            response = await self._req("POST", f"/iserver/account/{account_id}/orders/whatif", json=payload)
            # Custom warning logic can remain here
            return response
        except Exception as e:
            log.exception(f"Failed to preview order: {e}")
            raise HTTPException(status_code=500, detail="Could not preview order")

    async def place_order(self: ServiceProtocol, account_id: str, orders: List[Dict[str, Any]]) -> Dict[str, Any]:
        try:
            payload = {"orders": orders}
            return await self._req("POST", f"/iserver/account/{account_id}/orders", json=payload)
        except Exception as e:
            log.exception(f"Failed to place order: {e}")
            raise HTTPException(status_code=500, detail="Could not place order")
            
    async def reply_to_confirmation(self: ServiceProtocol, reply_id: str, confirmed: bool) -> Dict[str, Any]:
        try:
            payload = {"confirmed": confirmed}
            return await self._req("POST", f"/iserver/reply/{reply_id}", json=payload)
        except Exception as e:
            log.exception(f"Failed to reply to confirmation {reply_id}: {e}")
            raise HTTPException(status_code=500, detail="Could not reply to order confirmation")