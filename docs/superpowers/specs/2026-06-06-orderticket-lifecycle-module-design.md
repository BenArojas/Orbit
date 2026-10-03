# Shared OrderTicket lifecycle — current decision

`src/orbit/OrderTicket` owns shared order drafting, validation, submission-result classification, tracking and post-submit refresh behavior.
Framework-neutral lifecycle helpers hide parsing, bracket construction, stock/option eligibility and broker-result normalization. The React lifecycle hook coordinates them; rendering components remain focused on inputs and presentation.
Reply-required, rejected and unknown outcomes must remain distinguishable from successful submission. Existing Trading Safety and real-money confirmation gates remain authoritative.
Single-leg option orders are supported; option brackets remain deferred and rejected by the existing boundary.
See [module boundaries](../../architecture/modules.md). This is current ownership guidance, not a new order feature or migration plan.
