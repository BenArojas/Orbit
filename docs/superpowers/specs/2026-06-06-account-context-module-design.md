# Orbit account context — current decision

Orbit owns shared account selection and hydration. MoonMarket and the shared OrderTicket consume the same selected account and paper/live readiness state.
`OrbitAccountProvider` and `useOrbitAccountContext()` own the frontend seam. Product pages must not duplicate account hydration or invent a fallback account.
Account readiness is separate from top-level module authentication. TWS keeps its own exclusive broker-session workflow.
Inflect is retired and is not a consumer of this boundary.
See [module boundaries](../../architecture/modules.md). This document records current ownership, not an outstanding implementation task.
