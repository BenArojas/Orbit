# Orbit module entry — current decision

`OrbitModuleEntry` owns shared authentication access to Client Portal-dependent module routes. Direct Parallax and MoonMarket routes retain their requested location while showing a locked/connect state when access is unavailable.
The launcher consumes the shared module registry. Authentication access and selected-account readiness remain separate responsibilities.
TWS Assistant uses its existing exclusive broker-session mode; Parallax and MoonMarket must not be enabled through an incompatible TWS session.
Inflect routes and availability are retired.
See [module boundaries](../../architecture/modules.md) and [frontend architecture](../../architecture/frontend.md). Changing Parallax's internal landing view must preserve these boundaries.
