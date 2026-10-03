# TWS advanced orders — current decisions

Existing advanced workflows include scale-out ladders, brackets, fixed/percent trailing stops, GTD, MOC, LOC and the narrow single-price-condition path.
Scale-out ladders are long-only. Each independently protected lot has its own quantity-sized parent entry, linked target, protective stop/trail and close fallback. Never share one parent across independent lot exit groups.
Backend code owns order IDs, links and OCA construction. Packages remain process-local; live submission retains armed-session and backend policy gates.
Do not expose unsafe per-leg management that leaves a linked package unprotected. Whole-lot cancellation and supported price-only modification follow the existing broker constraints.
Quantity/structure replacement remains a separate follow-up; see [package replacement](2026-07-01-scale-out-cockpit-v2-design.md).
Trailing-stop downside is an estimate. Orbit does not autonomously repair or rebalance orders after submission.
This preserves shipped decisions, not a fresh implementation authorization.
