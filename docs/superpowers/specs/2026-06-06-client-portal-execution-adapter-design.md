# Client Portal execution adapter — current decision

`IBKRService` owns Client Portal HTTP transport, authentication and pacing. `ClientPortalExecutionAdapter` owns execution/account endpoint paths, payload conventions and response wire details.
MoonMarket and shared order workflows consume adapter intent methods rather than constructing broker requests in product routers.
TWS execution uses its separate `TwsBrokerAdapter`; the Parallax redesign does not introduce a broker handoff.
Retired Inflect execution adapters are outside the active product.
See [backend architecture](../../architecture/backend.md) and [module boundaries](../../architecture/modules.md). Existing execution and confirmation behavior must remain intact.
