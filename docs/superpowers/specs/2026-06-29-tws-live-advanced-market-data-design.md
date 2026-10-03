# TWS Assistant — current decisions

TWS Assistant is an active, user-controlled execution-support module. TWS mode is exclusive with Client Portal-dependent Parallax and MoonMarket.
Broker construction and mutations stay behind `TwsBrokerAdapter`. Live mutations retain allowlisted session arming, review/confirmation and immediate backend policy checks. Disconnection clears arming.
Advanced order packages preserve per-lot isolation and linked protection; see [advanced order decisions](2026-06-30-tws-advanced-order-types-design.md).
The TWS-owned `/execution-assistant/ws` stream provides quote, bar and depth updates with entitlement and unavailable states. Existing REST recovery/fallback behavior remains available.
Do not invent Level 2 data or label an unknown/delayed entitlement as real-time. A competing broker session can prevent data access.
Draft chart lines edit planning inputs, not placed orders. Scenario calculations are previews, not automatic order repair.
Remaining package-replacement work is described in [the active follow-up](2026-07-01-scale-out-cockpit-v2-design.md). Verification gaps are tracked in PROJECT_PLAN.md.
Completed live-trading, market-data and chart-line implementation plans have been removed; these decisions remain current.
