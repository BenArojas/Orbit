# TWS scale-out package replacement — active follow-up

Owner: TWS Assistant. Status: deferred; implementation is not authorized by the Parallax redesign.
Next action: review a focused broker-mutation proposal before implementing replacement beyond current supported price-only modification.

Existing scale-out planning, scenario previews and package grouping are shipped. The current Flow Sheet is the active presentation; earlier cockpit redesign instructions are completed history.
Package replacement belongs in the Execution Plan panel, reached from Manage Scale-Out. Show current versus proposed lots and the exact broker mutations before submission.
Replacement must reread current broker state and account for actual filled/remaining quantities. It must preserve per-lot protection, existing confirmation and live arming gates, and explicit ambiguous-outcome handling.
Do not modify linked quantities one leg at a time or rely on stale frontend package state. Existing broker OCA constraints limit which modifications are possible.
No autonomous repair, database package persistence or extra order kinds are approved by this follow-up.
See [advanced order decisions](2026-06-30-tws-advanced-order-types-design.md).
