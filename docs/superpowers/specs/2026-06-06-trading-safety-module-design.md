# Trading Safety — current decision

Orbit is decision support, never autonomous trading. Shared Trading Safety owns order-action eligibility and real-money confirmation requirements.
Preview is read-only. Paper mutations follow the existing paper policy; live place/reply/cancel/modify require policy-backed real-money confirmation.
Unknown accounts, rejected or incomplete decisions and unreachable policy fail closed. The backend checks eligibility again before forwarding broker mutations.
TWS keeps its existing allowlisted armed-session policy and adapter checks. The Parallax redesign does not change execution permissions.
See [module boundaries](../../architecture/modules.md), the canonical safety rules. No implementation task is implied by this document.
