"""Trading Safety policy for order mutations."""

from __future__ import annotations

from models import TradingSafetyAction, TradingSafetyConfirmation, TradingSafetyDecision
from services.ibkr import IBKRService
from services.moonmarket import MoonMarketService


class TradingSafetyPolicy:
    """Evaluates whether Orbit should allow a trading action for an account."""

    def __init__(self, ibkr: IBKRService) -> None:
        self.moonmarket = MoonMarketService(ibkr)

    async def evaluate_order_action(
        self,
        account_id: str,
        action: TradingSafetyAction,
    ) -> TradingSafetyDecision:
        accounts = await self.moonmarket.accounts()
        account = next((item for item in accounts.accounts if item.account_id == account_id), None)
        if account is None:
            await self.moonmarket._resolve_account_id(account_id)

        if account and not account.is_paper:
            return TradingSafetyDecision(
                account_id=account_id,
                action=action,
                allowed=True,
                mode="live_confirmation_required",
                confirmation=TradingSafetyConfirmation(
                    required=True,
                    title="Real-money order",
                    message=self._live_confirmation_message(action),
                    confirm_label=self._live_confirm_label(action),
                ),
            )

        return TradingSafetyDecision(
            account_id=account_id,
            action=action,
            allowed=True,
            mode="paper_allowed",
            confirmation=TradingSafetyConfirmation(
                required=False,
                title=None,
                message=None,
                confirm_label=None,
            ),
        )

    def _live_confirmation_message(self, action: TradingSafetyAction) -> str:
        if action == "place":
            return "Review and confirm before sending this live order to IBKR."
        return "Review and confirm before sending this live order action to IBKR."

    def _live_confirm_label(self, action: TradingSafetyAction) -> str:
        if action == "place":
            return "Place Live Order"
        if action == "modify":
            return "Submit Live Change"
        if action == "cancel":
            return "Cancel Live Order"
        return "Confirm Live Order"
